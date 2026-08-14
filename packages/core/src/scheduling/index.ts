/**
 * `core/scheduling` — greedy constraint scheduler with near-horizon
 * materialisation. SYSTEM_ARCHITECTURE §6.3, DATABASE_DESIGN §4.3.
 * IMPLEMENTATION_ROADMAP 1.7.
 *
 * Materialises concrete blocks/tasks for a 14-day window only; everything
 * beyond it is a coarse week-granularity projection (ADR-014). Not an ILP
 * solver — deliberately greedy, fast, incremental, explainable.
 *
 * **M0 simplifications, flagged per AI_DECISION_ENGINE §1.1:**
 *   - Step 4 (assessment checkpoints) and step 6 (local repair pass) are
 *     deferred; nothing here requires them to be added later without an
 *     interface change (§18.4).
 *   - Urgency cannot be known before placement (it is *derived from* plan
 *     position at M0), so the initial ranking pass omits it and placement
 *     order is decided by Impact, DecayRisk, Readiness, and Cost only.
 *     Urgency is assigned after placement, from where a concept landed.
 */

import type { PriorityConfig } from '../config';
import {
  breakCycles,
  buildGraph,
  computeReadiness,
  directUnlockCount,
  topologicalOrder,
  type Graph,
} from '../graph';
import { effectiveMastery } from '../mastery';
import { retrievability } from '../retention';
import type {
  AvailabilityWindow,
  ConceptEdge,
  ConceptNode,
  LearnerFactors,
  MasteryState,
  MemoryState,
} from '../types';

export type TaskType = 'learn' | 'practice' | 'revise';

export interface ScheduledTask {
  conceptId: string;
  type: TaskType;
  estimatedMinutes: number;
  structuralFactors: {
    impact: number;
    urgency: number;
    leverage: number;
    readiness: number;
    cost: number;
  };
  structuralScore: number;
}

export interface ScheduledDay {
  date: string;
  capacityMinutes: number;
  plannedMinutes: number;
  tasks: ScheduledTask[];
}

export interface ProjectionWeek {
  week: string;
  conceptIds: string[];
  plannedMinutes: number;
}

export interface SchedulingResult {
  windowStart: string;
  windowEnd: string;
  days: ScheduledDay[];
  projection: ProjectionWeek[];
  /** Concepts that could not be placed anywhere in the window or projection horizon. */
  unscheduledConceptIds: string[];
  /** Prerequisite cycles broken to guarantee termination (E-5). */
  brokenCycles: ConceptEdge[];
}

export interface SchedulingInput {
  today: Date;
  windowDays: number;
  targetDate: Date;
  concepts: ConceptNode[];
  edges: ConceptEdge[];
  masteryStates: Map<string, MasteryState>;
  memoryStates: Map<string, MemoryState>;
  /** Daily capacity for the materialised window, in calendar order starting today. */
  windowCapacity: AvailabilityWindow[];
  /** Average daily capacity to use for the projection beyond the window. */
  projectionDailyCapacityMinutes: number;
  learner: LearnerFactors;
  config: PriorityConfig;
  /** Hard prerequisite threshold — edges at or above this block placement (I-4). */
  hardPrerequisiteStrength?: number;
  /**
   * Concepts the learner already has an unfinished task for.
   *
   * A re-plan supersedes *intentions*, not work in flight: a task the learner
   * has already started keeps its row and its date. Without this, the new plan
   * had no way to know that, and cheerfully scheduled a second task for the
   * same concept — so a learner mid-session on Projectile Motion came back to
   * find it queued twice, once in progress and once fresh.
   *
   * They stay in the graph rather than being filtered out by the caller,
   * because their dependents' readiness still depends on them.
   */
  inFlightConceptIds?: ReadonlySet<string>;
}

const DAY_MS = 86_400_000;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function normaliseLeverageCount(count: number): number {
  return Math.min(1, count / 10);
}

/**
 * Placement-time value: readiness gate x (impact + decay risk), no urgency
 * term (it does not exist yet — see module doc), divided by cost^delta.
 */
function placementScore(
  graph: Graph,
  concept: ConceptNode,
  mastery: MasteryState | undefined,
  memory: MemoryState | undefined,
  now: Date,
  prerequisiteEffectiveMastery: { effectiveMastery: number; strength: number }[],
  config: PriorityConfig,
): {
  score: number;
  impact: number;
  leverage: number;
  readiness: number;
  cost: number;
  isReview: boolean;
} {
  const rawMastery = mastery?.mastery ?? 0;
  const R = retrievability(memory ?? null, now);
  const mEff = effectiveMastery(rawMastery, R, config.phi);
  const gap = 1 - mEff;
  const leverage = 1 + config.lambda * normaliseLeverageCount(directUnlockCount(graph, concept.id));
  const impact = clamp01(concept.examWeight * gap * leverage);

  const reps = memory?.reps ?? 0;
  const established = Math.min(1, reps / config.repsMin);
  const decayRisk = clamp01((1 - R) * established);
  const isReview = reps > 0;

  const readiness = computeReadiness(prerequisiteEffectiveMastery, config.theta);
  const cost = Math.max(1, concept.estimatedMinutes);

  const valueTerm = config.alpha * impact + config.gamma * decayRisk;
  const score = readiness * (valueTerm / Math.pow(cost, config.delta));

  return { score, impact, leverage, readiness, cost, isReview };
}

export function generatePlan(input: SchedulingInput): SchedulingResult {
  const hardStrength = input.hardPrerequisiteStrength ?? 0.5;
  const broken = breakCyclesForScheduling(input.concepts, input.edges);
  const acyclicEdges = broken.edges;
  const graph = buildGraph(input.concepts, acyclicEdges);

  const order = topologicalOrder(input.concepts, acyclicEdges);
  const learned = new Set(
    input.concepts
      .filter((c) => ['learned', 'mastered', 'already_known'].includes(c.status))
      .map((c) => c.id),
  );
  const inFlight = input.inFlightConceptIds ?? new Set<string>();
  const eligibleQueue = order.filter((id) => {
    const c = graph.nodes.get(id);
    if (!c) return false;
    return c.status !== 'excluded' && c.status !== 'mastered' && c.status !== 'already_known';
  });

  const days: ScheduledDay[] = input.windowCapacity.map((w) => ({
    date: w.date,
    capacityMinutes: w.capacityMinutes,
    plannedMinutes: 0,
    tasks: [],
  }));

  const dueConceptIds = new Set(
    Array.from(input.memoryStates.entries())
      .filter(([, m]) => m.dueAt.getTime() <= input.today.getTime())
      .map(([conceptId]) => conceptId),
  );

  /**
   * Seeded with the in-flight concepts, which is what makes them behave
   * correctly on both counts at once.
   *
   * Every candidate filter below already skips what is in this set, so an
   * in-flight concept gets no second task — the duplication this input exists
   * to prevent. And `isPlaceable`/`prerequisiteInputs` treat membership as
   * "handled", so a concept the learner is *currently working through* satisfies
   * its dependents' prerequisites.
   *
   * Filtering them out of the eligible queue instead — the obvious first
   * implementation — got the first half right and the second half catastrophically
   * wrong. The concept vanished from the graph's notion of what was covered, so
   * every dependent failed its prerequisite check, and because the seeded
   * curriculum hangs almost entirely off one root, starting the first task and
   * then changing availability produced a **completely empty plan**. The learner
   * opens the app to nothing to do.
   */
  const scheduledConceptIds = new Set<string>(inFlight);
  const scheduledDateOf = new Map<string, string>();

  for (const day of days) {
    let remaining = day.capacityMinutes;
    const dayIndex = days.indexOf(day);
    const asOf = new Date(input.today.getTime() + dayIndex * DAY_MS);

    // (a) due reviews first — retention debt is never deferred (§6.3 step 3a, DP8).
    const dueToday = eligibleQueue.filter(
      (id) => dueConceptIds.has(id) && !scheduledConceptIds.has(id),
    );
    remaining = placeCandidates(dueToday, 'revise');

    // (b) fill remaining capacity by descending placement score, respecting readiness.
    const learnCandidates = eligibleQueue.filter(
      (id) => !dueConceptIds.has(id) && !scheduledConceptIds.has(id) && isPlaceable(id),
    );
    const ranked = learnCandidates
      .map((id) => {
        const concept = graph.nodes.get(id)!;
        const mastery = input.masteryStates.get(id);
        const memory = input.memoryStates.get(id);
        const prereqs = prerequisiteInputs(id);
        const scored = placementScore(graph, concept, mastery, memory, asOf, prereqs, input.config);
        return { id, concept, scored };
      })
      .filter((r) => r.scored.readiness >= 0.05)
      .sort((a, b) => b.scored.score - a.scored.score);

    remaining = placeRanked(ranked);

    function placeCandidates(ids: string[], type: TaskType): number {
      let cap = remaining;
      for (const id of ids) {
        if (cap <= 0) break;
        const concept = graph.nodes.get(id)!;
        const minutes = Math.min(concept.estimatedMinutes, Math.max(cap, 0));
        if (minutes < Math.min(15, concept.estimatedMinutes)) continue;
        const mastery = input.masteryStates.get(id);
        const memory = input.memoryStates.get(id);
        const prereqs = prerequisiteInputs(id);
        const scored = placementScore(graph, concept, mastery, memory, asOf, prereqs, input.config);
        day.tasks.push({
          conceptId: id,
          type,
          estimatedMinutes: minutes,
          structuralFactors: {
            impact: scored.impact,
            urgency: 0, // assigned after full placement, see below
            leverage: scored.leverage,
            readiness: scored.readiness,
            cost: scored.cost,
          },
          structuralScore: scored.score,
        });
        day.plannedMinutes += minutes;
        cap -= minutes;
        scheduledConceptIds.add(id);
        scheduledDateOf.set(id, day.date);
      }
      return cap;
    }

    function placeRanked(ranked: { id: string }[]): number {
      return placeCandidates(
        ranked.map((r) => r.id),
        'learn',
      );
    }

    function prerequisiteInputs(conceptId: string) {
      return (graph.prerequisitesOf.get(conceptId) ?? []).map((edge) => {
        const prereqLearned =
          learned.has(edge.fromConceptId) || scheduledConceptIds.has(edge.fromConceptId);
        const mastery = input.masteryStates.get(edge.fromConceptId)?.mastery ?? 0;
        return {
          effectiveMastery: prereqLearned ? Math.max(mastery, input.config.theta) : mastery,
          strength: edge.strength,
        };
      });
    }

    function isPlaceable(conceptId: string): boolean {
      // I-4: never place a concept before a hard prerequisite that has
      // neither been learned already nor scheduled on an earlier day.
      const prereqs = graph.prerequisitesOf.get(conceptId) ?? [];
      return prereqs
        .filter((e) => e.strength >= hardStrength)
        .every((e) => learned.has(e.fromConceptId) || scheduledConceptIds.has(e.fromConceptId));
    }
  }

  // Assign urgency from plan position (M0 §1.1): earlier placement -> higher
  // urgency, normalised against the window length.
  for (const day of days) {
    const dayIndex = days.findIndex((d) => d.date === day.date);
    const positionUrgency = clamp01(1 - dayIndex / Math.max(1, days.length - 1));
    for (const task of day.tasks) {
      task.structuralFactors.urgency = positionUrgency;
    }
  }

  const scheduledOrLearned = new Set([...scheduledConceptIds, ...learned]);
  const unscheduled = input.concepts
    .filter((c) => c.status !== 'excluded' && !scheduledOrLearned.has(c.id))
    .map((c) => c.id);

  const projection = buildProjection(
    unscheduled,
    input.concepts,
    input.projectionDailyCapacityMinutes,
    days.length > 0 ? new Date(input.today.getTime() + days.length * DAY_MS) : input.today,
    input.targetDate,
  );

  return {
    windowStart: days[0]?.date ?? toDateKey(input.today),
    windowEnd: days[days.length - 1]?.date ?? toDateKey(input.today),
    days,
    projection,
    unscheduledConceptIds: projection.stillUnscheduled,
    brokenCycles: broken.brokenEdges,
  };
}

function buildProjection(
  unscheduledConceptIds: string[],
  concepts: ConceptNode[],
  dailyCapacity: number,
  startDate: Date,
  targetDate: Date,
): ProjectionWeek[] & { stillUnscheduled: string[] } {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const weeks = new Map<string, { conceptIds: string[]; plannedMinutes: number }>();
  let cursor = startDate.getTime();
  const horizon = targetDate.getTime();
  const stillUnscheduled: string[] = [];

  for (const id of unscheduledConceptIds) {
    const concept = byId.get(id);
    if (!concept) continue;
    if (dailyCapacity <= 0 || cursor > horizon) {
      stillUnscheduled.push(id);
      continue;
    }
    const week = isoWeek(new Date(cursor));
    const bucket = weeks.get(week) ?? { conceptIds: [], plannedMinutes: 0 };
    bucket.conceptIds.push(id);
    bucket.plannedMinutes += concept.estimatedMinutes;
    weeks.set(week, bucket);
    cursor += Math.ceil(concept.estimatedMinutes / Math.max(1, dailyCapacity)) * DAY_MS;
  }

  const result = Array.from(weeks.entries()).map(([week, v]) => ({
    week,
    ...v,
  })) as ProjectionWeek[] & {
    stillUnscheduled: string[];
  };
  result.stillUnscheduled = stillUnscheduled;
  return result;
}

function breakCyclesForScheduling(concepts: ConceptNode[], edges: ConceptEdge[]) {
  // I-6: the scheduler must terminate even on a malformed graph.
  return breakCycles(concepts, edges);
}
