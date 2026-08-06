import {
  DEFAULT_PRIORITY_CONFIG,
  ENGINE_VERSION,
  assessFeasibility,
  computeScopeTriage,
  decideReplan,
  generatePlan,
  identifyMissedTasks,
  type ConceptEdge as CoreConceptEdge,
  type ConceptNode as CoreConceptNode,
} from '@friday/core';
import { ApiError, ERROR_CODES } from '@friday/contracts';
import {
  availabilityRepository,
  curriculumRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  tracesRepository,
  type ConceptEdgeRow,
  type ConceptRow,
  type GoalRow,
  type PlanRow,
  type TaskRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { buildCapacityWindows, hasAnyAvailability } from './availability';

const WINDOW_DAYS = 14;

function toCoreConcepts(rows: ConceptRow[]): CoreConceptNode[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    examWeight: Number(r.examWeight),
    estimatedMinutes: r.estimatedMinutes,
    status: r.status,
  }));
}

function toCoreEdges(rows: ConceptEdgeRow[]): CoreConceptEdge[] {
  return rows.map((r) => ({
    fromConceptId: r.fromConceptId,
    toConceptId: r.toConceptId,
    type: r.type,
    strength: Number(r.strength),
  }));
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

interface PlanMaterials {
  today: Date;
  targetDate: Date;
  concepts: ConceptRow[];
  edges: ConceptEdgeRow[];
  windowCapacity: Awaited<ReturnType<typeof buildCapacityWindows>>;
  fullHorizonCapacity: Awaited<ReturnType<typeof buildCapacityWindows>>;
}

async function loadPlanMaterials(userId: string, goal: GoalRow): Promise<PlanMaterials> {
  const db = getDb();
  const rules = await availabilityRepository(db).listForUser(userId);
  if (!hasAnyAvailability(rules)) {
    throw new ApiError(ERROR_CODES.NO_AVAILABILITY_DEFINED);
  }

  const curriculum = await curriculumRepository(db).findByGoal(userId, goal.id);
  if (!curriculum) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).listConcepts(userId, curriculum.id);
  const edges = await curriculumRepository(db).listEdges(userId, curriculum.id);

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const targetDate = new Date(goal.targetDate + 'T00:00:00Z');
  const horizonDays = daysBetween(today, targetDate);

  const fullHorizonCapacity = buildCapacityWindows(rules, today, horizonDays);
  const windowCapacity = fullHorizonCapacity.slice(0, WINDOW_DAYS);

  return { today, targetDate, concepts, edges, windowCapacity, fullHorizonCapacity };
}

/** Feasibility's per-concept input (§9). M0: no separate practice/review estimation yet. */
function toFeasibilityConcepts(
  concepts: ConceptRow[],
  edges: ConceptEdgeRow[],
  memoryRepoRows: { conceptId: string; reps: number }[],
) {
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== 'prerequisite_of') continue;
    outDegree.set(e.fromConceptId, (outDegree.get(e.fromConceptId) ?? 0) + 1);
  }
  const studiedIds = new Set(memoryRepoRows.filter((m) => m.reps > 0).map((m) => m.conceptId));

  return concepts
    .filter(
      (c) => c.status !== 'excluded' && c.status !== 'mastered' && c.status !== 'already_known',
    )
    .map((c) => {
      const leverage =
        1 + DEFAULT_PRIORITY_CONFIG.lambda * Math.min(1, (outDegree.get(c.id) ?? 0) / 10);
      const isReview = studiedIds.has(c.id);
      return {
        conceptId: c.id,
        remainingLearnMinutes: isReview ? 0 : c.estimatedMinutes,
        remainingPracticeMinutes: 0,
        projectedReviewMinutes: isReview ? Math.round(c.estimatedMinutes * 0.2) : 0,
        impactTimesLeverage: Number(c.examWeight) * leverage,
      };
    });
}

async function persistPlan(
  userId: string,
  goal: GoalRow,
  version: number,
  reason: string,
  materials: PlanMaterials,
): Promise<PlanRow> {
  const db = getDb();
  const memoryStates = await memoryRepository(db).listAllMemoryStates(userId);

  const scheduling = generatePlan({
    today: materials.today,
    windowDays: WINDOW_DAYS,
    targetDate: materials.targetDate,
    concepts: toCoreConcepts(materials.concepts),
    edges: toCoreEdges(materials.edges),
    masteryStates: new Map(),
    memoryStates: new Map(
      memoryStates.map((m) => [
        m.conceptId,
        {
          conceptId: m.conceptId,
          stability: Number(m.stability),
          difficulty: Number(m.difficulty),
          reps: m.reps,
          lapses: m.lapses,
          state: m.state,
          lastReviewAt: m.lastReviewAt,
          dueAt: m.dueAt,
        },
      ]),
    ),
    windowCapacity: materials.windowCapacity,
    projectionDailyCapacityMinutes:
      materials.fullHorizonCapacity.reduce((s, w) => s + w.capacityMinutes, 0) /
      Math.max(1, materials.fullHorizonCapacity.length),
    learner: { reliability: 1.0, pace: 1.0 }, // E-1: cold start until a minimum sample exists
    config: DEFAULT_PRIORITY_CONFIG,
  });

  const feasibilityConcepts = toFeasibilityConcepts(
    materials.concepts,
    materials.edges,
    memoryStates.map((m) => ({ conceptId: m.conceptId, reps: m.reps })),
  );
  const feasibility = assessFeasibility(
    feasibilityConcepts,
    materials.fullHorizonCapacity,
    { reliability: 1.0, pace: 1.0 },
    DEFAULT_PRIORITY_CONFIG.feasibilityBufferFraction,
  );

  const windowStart = scheduling.windowStart;
  const windowEnd = scheduling.windowEnd;

  return db.transaction(async (tx) => {
    const planning = planningRepository(tx);

    const activePlan = await planning.findActive(userId, goal.id);
    if (activePlan) await planning.supersede(userId, activePlan.id);

    const plan = await planning.create({
      goalId: goal.id,
      userId,
      version,
      status: 'active',
      supersedesId: activePlan?.id ?? null,
      reason,
      windowStart,
      windowEnd,
      projection: scheduling.projection,
      verdict: feasibility.verdict,
      requiredMinutes: Math.round(feasibility.requiredMinutes),
      availableMinutes: Math.round(feasibility.availableMinutes),
      slackMinutes: Math.round(feasibility.slackMinutes),
      projectedCompletionDate: feasibility.projectedCompletionDate,
      reliabilityFactor: '1.0',
      diffSummary: null,
      generatedBy: `scheduler_${ENGINE_VERSION}`,
    });

    const conceptById = new Map(materials.concepts.map((c) => [c.id, c]));

    for (const day of scheduling.days) {
      if (day.tasks.length === 0) continue;
      const [block] = await planning.insertBlocks([
        {
          planId: plan.id,
          userId,
          scheduledDate: day.date,
          plannedMinutes: day.plannedMinutes,
        },
      ]);
      if (!block) continue;

      const taskRows = await planning.insertTasks(
        day.tasks.map((t) => ({
          blockId: block.id,
          planId: plan.id,
          goalId: goal.id,
          userId,
          type: t.type,
          status: 'pending' as const,
          title: `${t.type === 'revise' ? 'Review' : 'Learn'}: ${conceptById.get(t.conceptId)?.title ?? t.conceptId}`,
          estimatedMinutes: t.estimatedMinutes,
          structuralScore: t.structuralScore.toFixed(4),
          structuralFactors: t.structuralFactors,
          scheduledDate: day.date,
        })),
      );

      await planning.insertTaskConcepts(
        taskRows.map((taskRow, i) => ({
          taskId: taskRow.id,
          conceptId: day.tasks[i]!.conceptId,
          userId,
          isPrimary: true,
        })),
      );
    }

    await tracesRepository(tx).record({
      userId,
      goalId: goal.id,
      type: 'plan_generation',
      engineVersion: ENGINE_VERSION,
      configVersion: DEFAULT_PRIORITY_CONFIG.configVersion,
      inputSnapshotHash: hashInputs(materials),
      candidates: scheduling.days.flatMap((d) => d.tasks),
      excluded: scheduling.unscheduledConceptIds,
      selectedEntityId: plan.id,
      selectedScore: null,
      confidence: '1.000',
      confidenceInputs: { note: 'Plan generation is D2 — fully deterministic (§3).' },
      dominantFactor: null,
      explanation: { verdict: feasibility.verdict, reason },
    });

    logger.info('plan generated', { goalId: goal.id, version, verdict: feasibility.verdict });

    return plan;
  });
}

function hashInputs(materials: PlanMaterials): string {
  // A lightweight, dependency-free stand-in for a cryptographic hash — enough
  // to distinguish input snapshots for trace correlation (§13.1). Swapping to
  // SHA-256 is a one-line change behind this function if that guarantee is
  // ever load-bearing.
  const payload = JSON.stringify({
    conceptCount: materials.concepts.length,
    edgeCount: materials.edges.length,
    today: materials.today.toISOString(),
    targetDate: materials.targetDate.toISOString(),
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `fnv-${(hash >>> 0).toString(16)}`;
}

export async function generateInitialPlan(user: UserRow, goal: GoalRow): Promise<PlanRow> {
  const materials = await loadPlanMaterials(user.id, goal);
  return persistPlan(user.id, goal, 1, 'initial', materials);
}

/**
 * §10.2 the re-plan pipeline, M0 manual-trigger only. Runs the scheduler
 * fresh from current state, diffs against the active plan, and commits only
 * if the materiality gate passes (§10.3) — or if the trigger is explicit.
 */
export async function regeneratePlan(
  user: UserRow,
  goalId: string,
  reason?: string,
): Promise<{
  committed: boolean;
  reason: string;
  plan: PlanRow | null;
  drift: { drift: number; verdictChanged: boolean };
}> {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  const activePlan = await planningRepository(db).findActive(user.id, goalId);
  const materials = await loadPlanMaterials(user.id, goal);

  // §10.4 debt model: identify missed work so it can be marked honestly, but
  // never shift it forward — the scheduler below re-derives placement from
  // current state, and a missed concept simply re-enters the candidate pool.
  if (activePlan) {
    const pending = await planningRepository(db).listPendingTasks(user.id, goalId);
    const missed = identifyMissedTasks(
      pending.map((t) => ({
        taskId: t.id,
        conceptId: t.id, // task-level identification is sufficient here
        scheduledDate: t.scheduledDate,
        status: t.status,
      })),
      materials.today.toISOString().slice(0, 10),
    );
    if (missed.length > 0) {
      await planningRepository(db).markMissedRescheduled(
        user.id,
        missed.map((m) => m.taskId),
      );
    }
  }

  const nextVersion = activePlan ? activePlan.version + 1 : 1;

  // Build the candidate plan's structural facts before deciding whether to
  // commit, so the materiality gate compares like-for-like (§10.2 DIFF stage).
  const scheduling = generatePlan({
    today: materials.today,
    windowDays: WINDOW_DAYS,
    targetDate: materials.targetDate,
    concepts: toCoreConcepts(materials.concepts),
    edges: toCoreEdges(materials.edges),
    masteryStates: new Map(),
    memoryStates: new Map(),
    windowCapacity: materials.windowCapacity,
    projectionDailyCapacityMinutes:
      materials.fullHorizonCapacity.reduce((s, w) => s + w.capacityMinutes, 0) /
      Math.max(1, materials.fullHorizonCapacity.length),
    learner: { reliability: 1.0, pace: 1.0 },
    config: DEFAULT_PRIORITY_CONFIG,
  });

  const feasibilityConcepts = toFeasibilityConcepts(materials.concepts, materials.edges, []);
  const newFeasibility = assessFeasibility(
    feasibilityConcepts,
    materials.fullHorizonCapacity,
    { reliability: 1.0, pace: 1.0 },
    DEFAULT_PRIORITY_CONFIG.feasibilityBufferFraction,
  );

  const previousTasks = activePlan
    ? (await planningRepository(db).listTasksForPlan(user.id, activePlan.id)).map((t) => ({
        conceptId: t.id,
        scheduledDate: t.scheduledDate,
      }))
    : [];
  const newTasks = scheduling.days.flatMap((d) =>
    d.tasks.map((t) => ({ conceptId: t.conceptId, scheduledDate: d.date })),
  );

  const decision = decideReplan(
    {
      previousTasks,
      newTasks,
      previousVerdict: activePlan?.verdict ?? 'not_feasible',
      newVerdict: newFeasibility.verdict,
      previousProjectedCompletionDate: activePlan?.projectedCompletionDate ?? null,
      newProjectedCompletionDate: newFeasibility.projectedCompletionDate,
      previousRequiredMinutes: activePlan?.requiredMinutes ?? 0,
      newRequiredMinutes: newFeasibility.requiredMinutes,
      today: materials.today.toISOString().slice(0, 10),
    },
    'explicit', // M0 §1.1: re-planning is manual trigger only
    DEFAULT_PRIORITY_CONFIG.driftMaterialityThreshold,
    { changesLast24h: 0, changesLast7d: 0 }, // explicit requests are never rate-limited
  );

  if (!decision.shouldCommit) {
    return {
      committed: false,
      reason: decision.reason,
      plan: activePlan ?? null,
      drift: decision.drift,
    };
  }

  const plan = await persistPlan(user.id, goal, nextVersion, reason ?? 'user_request', materials);
  return { committed: true, reason: decision.reason, plan, drift: decision.drift };
}

export async function getCurrentPlan(user: UserRow, goalId: string): Promise<PlanRow> {
  const plan = await planningRepository(getDb()).findActive(user.id, goalId);
  if (!plan) throw ApiError.notFound();
  return plan;
}

export async function listPlans(user: UserRow, goalId: string): Promise<PlanRow[]> {
  return planningRepository(getDb()).listVersions(user.id, goalId);
}

export async function getFeasibility(user: UserRow, goalId: string) {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  const materials = await loadPlanMaterials(user.id, goal);
  const memoryStates = await memoryRepository(db).listAllMemoryStates(user.id);
  const feasibilityConcepts = toFeasibilityConcepts(
    materials.concepts,
    materials.edges,
    memoryStates.map((m) => ({ conceptId: m.conceptId, reps: m.reps })),
  );
  const feasibility = assessFeasibility(
    feasibilityConcepts,
    materials.fullHorizonCapacity,
    { reliability: 1.0, pace: 1.0 },
    DEFAULT_PRIORITY_CONFIG.feasibilityBufferFraction,
  );

  const remediationOptions: {
    type: 'increase_hours' | 'reduce_scope' | 'extend_deadline';
    detail: string;
    conceptIds?: string[];
    impact: { verdict: string; slackPercent?: number };
  }[] = [];

  if (feasibility.verdict !== 'on_track') {
    const triage = computeScopeTriage(
      feasibilityConcepts,
      feasibility.availableMinutes,
      DEFAULT_PRIORITY_CONFIG.feasibilityBufferFraction,
      1.0,
    );
    if (triage.length > 0) {
      remediationOptions.push({
        type: 'reduce_scope',
        detail: `Drop ${triage.length} lowest-impact concept(s), freeing ~${Math.round(triage[triage.length - 1]!.cumulativeMinutesFreed)} minutes.`,
        conceptIds: triage.map((t) => t.conceptId),
        impact: { verdict: triage[triage.length - 1]!.verdictAfterCut },
      });
    }
    remediationOptions.push({
      type: 'increase_hours',
      detail: 'Add more weekly study minutes in availability settings.',
      impact: { verdict: 'on_track' },
    });
    remediationOptions.push({
      type: 'extend_deadline',
      detail: 'Move the target date later.',
      impact: { verdict: 'on_track' },
    });
  }

  return { feasibility, remediationOptions };
}

export async function getSchedule(user: UserRow, goalId: string) {
  const db = getDb();
  const plan = await planningRepository(db).findActive(user.id, goalId);
  if (!plan) throw ApiError.notFound();

  const tasks = await planningRepository(db).listTasksForPlan(user.id, plan.id);
  return { plan, tasks };
}

/** Attaches `{id, title}` concept refs to each task — TaskSchema's `concepts` field. */
export async function hydrateTasksWithConcepts(
  userId: string,
  taskRows: TaskRow[],
): Promise<{ task: TaskRow; concepts: { id: string; title: string }[] }[]> {
  const db = getDb();
  if (taskRows.length === 0) return [];

  const taskConceptRows = await planningRepository(db).listTaskConceptsForTasks(
    userId,
    taskRows.map((t) => t.id),
  );
  const conceptIds = [...new Set(taskConceptRows.map((tc) => tc.conceptId))];
  const concepts = await curriculumRepository(db).findConceptsByIds(userId, conceptIds);
  const conceptById = new Map(concepts.map((c) => [c.id, c]));

  const conceptsByTaskId = new Map<string, { id: string; title: string }[]>();
  for (const tc of taskConceptRows) {
    const concept = conceptById.get(tc.conceptId);
    if (!concept) continue;
    const list = conceptsByTaskId.get(tc.taskId) ?? [];
    list.push({ id: concept.id, title: concept.title });
    conceptsByTaskId.set(tc.taskId, list);
  }

  return taskRows.map((task) => ({ task, concepts: conceptsByTaskId.get(task.id) ?? [] }));
}

export function toWirePlan(plan: PlanRow) {
  return {
    id: plan.id,
    version: plan.version,
    status: plan.status,
    reason: plan.reason,
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd,
    verdict: plan.verdict,
    requiredMinutes: plan.requiredMinutes,
    availableMinutes: plan.availableMinutes,
    slackMinutes: plan.slackMinutes,
    projectedCompletionDate: plan.projectedCompletionDate,
    createdAt: plan.createdAt.toISOString(),
  };
}

export function toWireTask(task: TaskRow, concepts: { id: string; title: string }[]) {
  return {
    id: task.id,
    type: task.type,
    title: task.title,
    estimatedMinutes: task.estimatedMinutes,
    status: task.status,
    scheduledDate: task.scheduledDate,
    concepts,
  };
}
