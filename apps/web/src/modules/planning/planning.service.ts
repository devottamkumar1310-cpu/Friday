import {
  DEFAULT_PRIORITY_CONFIG,
  ENGINE_VERSION,
  assessFeasibility,
  computeScopeTriage,
  decideReplan,
  generatePlan,
  identifyMissedTasks,
  type ConceptEdge as CoreConceptEdge,
  type ReplanTriggerClass,
  type ConceptNode as CoreConceptNode,
  type MasteryState as CoreMasteryState,
} from '@friday/core';
import { ApiError, ERROR_CODES } from '@friday/contracts';
import {
  availabilityRepository,
  curriculumRepository,
  executionRepository,
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
import { toCoreMasteryState, toCoreMemoryState } from '../shared/mappers';
import { buildCapacityWindows, hasAnyAvailability } from './availability';

const WINDOW_DAYS = 14;

/**
 * Plan `reason` values written by an automatic trigger.
 *
 * These are the only commits the churn budget counts. `initial` (sign-up) and
 * `user_request` (the learner pressed the button) are deliberately excluded.
 */
const AUTOMATIC_REASONS = new Set([
  'session_completed',
  'session_abandoned',
  'new_day',
  // A constraint change the learner made deliberately, but the *re-plan* is
  // still automatic, so it spends from the same budget as the rest.
  'availability_changed',
]);

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
  /** Concepts with a task the learner has already started — never re-scheduled. */
  inFlightConceptIds: Set<string>;
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

  const inFlight = await planningRepository(db).listInFlightTasks(userId, goal.id);
  const inFlightLinks = await planningRepository(db).listTaskConceptsForTasks(
    userId,
    inFlight.map((t) => t.id),
  );
  const inFlightConceptIds = new Set(
    inFlightLinks.filter((l) => l.isPrimary).map((l) => l.conceptId),
  );

  return {
    today,
    targetDate,
    concepts,
    edges,
    windowCapacity,
    fullHorizonCapacity,
    inFlightConceptIds,
  };
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

/**
 * What the learner already knows, in the shape the scheduler expects.
 *
 * This is the adaptive loop's missing link. Both plan generation and
 * re-generation passed `masteryStates: new Map()` — an empty map — which meant
 * the scheduler treated every concept as though it had never been studied. A
 * learner could master half their syllabus, press "rebuild my plan", and get
 * back a plan identical to the one they started with.
 *
 * Feeding the real state in is what makes three behaviours emerge from the
 * engine that already exists, with no new logic:
 *
 *   completed  → mastery rises, the readiness gate opens for what it unlocks,
 *                and the concept's own remaining work falls, so it stops being
 *                scheduled.
 *   weak       → a low mastery against a high exam weight is exactly the
 *                `Impact` term, so struggling topics rise up the ranking.
 *   missed     → already handled: `identifyMissedTasks` marks them and the
 *                scheduler re-derives placement from current state rather than
 *                pushing a backlog forward (§10.4).
 */
async function loadMasteryStates(
  userId: string,
  materials: PlanMaterials,
): Promise<Map<string, CoreMasteryState>> {
  const rows = await memoryRepository(getDb()).listMasteryStates(
    userId,
    materials.concepts.map((c) => c.id),
  );
  return new Map(rows.map((row) => [row.conceptId, toCoreMasteryState(row)]));
}

/**
 * A plan's tasks as `{conceptId, scheduledDate}` — the shape `computeDrift`
 * compares. Tasks carry their concept through `task_concepts`, so the join is
 * what makes the previous and candidate plans comparable at all.
 */
async function loadPlanTaskSnapshots(
  userId: string,
  planId: string,
): Promise<{ conceptId: string; scheduledDate: string }[]> {
  const db = getDb();
  const taskRows = await planningRepository(db).listTasksForPlan(userId, planId);
  if (taskRows.length === 0) return [];

  const links = await planningRepository(db).listTaskConceptsForTasks(
    userId,
    taskRows.map((t) => t.id),
  );
  const conceptByTaskId = new Map(
    links.filter((l) => l.isPrimary).map((l) => [l.taskId, l.conceptId]),
  );

  return taskRows.flatMap((t) => {
    const conceptId = conceptByTaskId.get(t.id);
    return conceptId ? [{ conceptId, scheduledDate: t.scheduledDate }] : [];
  });
}

async function persistPlan(
  userId: string,
  goal: GoalRow,
  version: number,
  reason: string,
  materials: PlanMaterials,
  /**
   * Tasks on the outgoing plan that were due and not done (§10.4). Retired as
   * `rescheduled` rather than `cancelled` so the learner's history records the
   * miss. Empty for the initial plan, which supersedes nothing.
   */
  missedTaskIds: string[] = [],
): Promise<PlanRow> {
  const db = getDb();
  const memoryStates = await memoryRepository(db).listAllMemoryStates(userId);
  const masteryStates = await loadMasteryStates(userId, materials);

  const scheduling = generatePlan({
    today: materials.today,
    windowDays: WINDOW_DAYS,
    targetDate: materials.targetDate,
    concepts: toCoreConcepts(materials.concepts),
    edges: toCoreEdges(materials.edges),
    masteryStates,
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
    inFlightConceptIds: materials.inFlightConceptIds,
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
    if (activePlan) {
      await planning.supersede(userId, activePlan.id);
      // In the same transaction as the supersede, so there is no instant in
      // which both versions' tasks are live. Every task read path filters by
      // goal, not by plan, so a gap here is a doubled workload on screen.
      const retired = await planning.retireSupersededTasks(userId, activePlan.id, missedTaskIds);
      logger.info('superseded plan tasks retired', {
        goalId: goal.id,
        supersededVersion: activePlan.version,
        ...retired,
      });
    }

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
  /**
   * Why the re-plan is happening.
   *
   * `explicit` — the learner pressed the button. Always commits, never
   * rate-limited, because they asked and are watching.
   *
   * Anything else is automatic, and both guards in §10.3 then apply: the
   * materiality gate discards a candidate that barely differs, and the churn
   * budget caps automatic commits at one per 24h and three per week. Those two
   * are what stop a plan that reshuffles itself under the learner every time
   * they finish anything — which is the failure mode automatic triggering
   * invites.
   */
  trigger: ReplanTriggerClass = 'explicit',
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

  /**
   * §10.4 debt model: name the missed work, but do not write anything yet.
   *
   * This used to mark the rows `rescheduled` here, before the materiality gate
   * had decided anything. When the gate then declined to commit — immaterial
   * diff, or churn budget spent — the outgoing tasks had already been retired
   * and no new plan replaced them, so the work simply vanished from the
   * learner's queue. The marking belongs with the commit, inside the same
   * transaction as the supersede, and that is where it now happens.
   */
  const missedTaskIds = activePlan
    ? identifyMissedTasks(
        (await planningRepository(db).listPendingTasks(user.id, goalId)).map((t) => ({
          taskId: t.id,
          conceptId: t.id, // identification is by task; the concept is irrelevant here
          scheduledDate: t.scheduledDate,
          status: t.status,
        })),
        materials.today.toISOString().slice(0, 10),
      ).map((m) => m.taskId)
    : [];

  const nextVersion = activePlan ? activePlan.version + 1 : 1;

  // Build the candidate plan's structural facts before deciding whether to
  // commit, so the materiality gate compares like-for-like (§10.2 DIFF stage).
  //
  // "Like-for-like" was not true: the candidate was built from empty mastery
  // and empty memory while the committed plan below is built from real state,
  // so the drift the gate measured was partly an artefact of the two being
  // computed differently. Both now see the same learner.
  const candidateMastery = await loadMasteryStates(user.id, materials);
  const candidateMemory = await memoryRepository(db).listAllMemoryStates(user.id);

  const scheduling = generatePlan({
    today: materials.today,
    windowDays: WINDOW_DAYS,
    targetDate: materials.targetDate,
    concepts: toCoreConcepts(materials.concepts),
    edges: toCoreEdges(materials.edges),
    masteryStates: candidateMastery,
    memoryStates: new Map(candidateMemory.map((m) => [m.conceptId, toCoreMemoryState(m)])),
    windowCapacity: materials.windowCapacity,
    projectionDailyCapacityMinutes:
      materials.fullHorizonCapacity.reduce((s, w) => s + w.capacityMinutes, 0) /
      Math.max(1, materials.fullHorizonCapacity.length),
    learner: { reliability: 1.0, pace: 1.0 },
    config: DEFAULT_PRIORITY_CONFIG,
    inFlightConceptIds: materials.inFlightConceptIds,
  });

  // Same reason: the committed plan's feasibility is computed with real reps,
  // so the candidate's must be too or the verdict comparison is meaningless.
  const feasibilityConcepts = toFeasibilityConcepts(
    materials.concepts,
    materials.edges,
    candidateMemory.map((m) => ({ conceptId: m.conceptId, reps: m.reps })),
  );
  const newFeasibility = assessFeasibility(
    feasibilityConcepts,
    materials.fullHorizonCapacity,
    { reliability: 1.0, pace: 1.0 },
    DEFAULT_PRIORITY_CONFIG.feasibilityBufferFraction,
  );

  /**
   * The outgoing plan, keyed the same way as the candidate: by **concept**.
   *
   * This mapped `conceptId: t.id` — the task row's own uuid — while the
   * candidate side below is keyed by real concept ids. The two sets were
   * therefore disjoint by construction, so `computeDrift`'s first two
   * components (task-date change, next-7-day concept churn) both returned a
   * flat 1.0 no matter what the scheduler produced. Drift could never fall
   * below 0.5 against a materiality threshold of 0.15, which meant the gate
   * declared *every* candidate material and §10.3's "discard a plan that barely
   * differs" never once fired. Two byte-identical plans scored 0.5.
   *
   * The number was also being logged and returned to callers as if it meant
   * something, which is the worse half of the bug.
   */
  const previousTasks = activePlan ? await loadPlanTaskSnapshots(user.id, activePlan.id) : [];
  const newTasks = scheduling.days.flatMap((d) =>
    d.tasks.map((t) => ({ conceptId: t.conceptId, scheduledDate: d.date })),
  );

  /**
   * Real churn state, derived from plan history rather than assumed zero.
   *
   * Counts **only automatic commits**. §10.3's budget exists to stop the plan
   * reshuffling itself under a learner who is not asking for it; a plan they
   * requested, and the initial plan built at sign-up, are not that.
   *
   * Counting every version instead — the first version of this — spent the
   * whole 24-hour budget on the learner's own onboarding, so every automatic
   * trigger returned `churn_budget_exceeded` and the feature never fired once.
   */
  const versions = await planningRepository(db).listVersions(user.id, goalId);
  const now = Date.now();
  const automatic = versions.filter((v) => AUTOMATIC_REASONS.has(v.reason));
  const churn = {
    changesLast24h: automatic.filter((v) => now - v.createdAt.getTime() < 86_400_000).length,
    changesLast7d: automatic.filter((v) => now - v.createdAt.getTime() < 7 * 86_400_000).length,
  };

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
    trigger,
    DEFAULT_PRIORITY_CONFIG.driftMaterialityThreshold,
    churn,
  );

  if (!decision.shouldCommit) {
    return {
      committed: false,
      reason: decision.reason,
      plan: activePlan ?? null,
      drift: decision.drift,
    };
  }

  const plan = await persistPlan(
    user.id,
    goal,
    nextVersion,
    reason ?? 'user_request',
    materials,
    missedTaskIds,
  );
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

/** Task listing for the plan view — API_SPECIFICATION §5.4. */
export async function listTasks(
  user: UserRow,
  filters: { goalId?: string; from?: string; to?: string; status?: string },
): Promise<{ task: TaskRow; concepts: { id: string; title: string }[] }[]> {
  const db = getDb();

  const goalId = filters.goalId ?? (await goalsRepository(db).listForUser(user.id))[0]?.id;
  if (!goalId) return [];

  const tasks =
    filters.from && filters.to
      ? await planningRepository(db).listTasksInWindow(user.id, goalId, filters.from, filters.to)
      : await planningRepository(db).listPendingTasks(user.id, goalId);

  const filtered = filters.status ? tasks.filter((t) => t.status === filters.status) : tasks;
  return hydrateTasksWithConcepts(user.id, filtered);
}

export async function updateTask(
  user: UserRow,
  taskId: string,
  patch: { status?: string; scheduledDate?: string; skippedReason?: string },
): Promise<{ task: TaskRow; concepts: { id: string; title: string }[] }> {
  const updated = await planningRepository(getDb()).updateTaskStatus(user.id, taskId, {
    ...(patch.status ? { status: patch.status as TaskRow['status'] } : {}),
    ...(patch.status === 'completed' ? { completedAt: new Date() } : {}),
    ...(patch.skippedReason !== undefined ? { skippedReason: patch.skippedReason } : {}),
  });
  if (!updated) throw ApiError.notFound();
  const [hydrated] = await hydrateTasksWithConcepts(user.id, [updated]);
  if (!hydrated) throw ApiError.notFound();
  return hydrated;
}

/**
 * Everything the study screen needs for one task, in a single request.
 *
 * Four round trips on the most latency-sensitive screen in the product would
 * be four chances to show a spinner; this collapses them into one.
 */
export async function getStudyTask(user: UserRow, taskId: string) {
  const db = getDb();

  const task = await planningRepository(db).findTask(user.id, taskId);
  if (!task) throw ApiError.notFound();

  const taskConcepts = await planningRepository(db).listTaskConceptsForTasks(user.id, [task.id]);
  const conceptRows = await curriculumRepository(db).findConceptsByIds(
    user.id,
    taskConcepts.map((tc) => tc.conceptId),
  );
  const masteryRows = await memoryRepository(db).listMasteryStates(
    user.id,
    conceptRows.map((c) => c.id),
  );
  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, Number(m.mastery)]));

  // E-19: one active session per learner. Surfacing it lets the UI resume
  // rather than fail on a second start.
  const active = await executionRepository(db).findActiveSession(user.id);
  const resumable = active && active.taskId === task.id ? active : null;

  return {
    task,
    goalId: task.goalId,
    concepts: conceptRows.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      mastery: masteryByConcept.get(c.id) ?? 0,
      estimatedMinutes: c.estimatedMinutes,
    })),
    activeSessionId: resumable?.id ?? null,
    /**
     * When the session actually began, from the row rather than the browser.
     *
     * The clock used to start at zero in React state on every mount, so a
     * learner who switched tabs, opened a formula in another app, or simply
     * reloaded came back to `00:00` — and finishing then recorded a minute of
     * study against an hour of work. The row has carried `started_at` since
     * Phase 1; this endpoint was throwing it away.
     */
    activeSessionStartedAt: resumable?.startedAt.toISOString() ?? null,
  };
}

/**
 * Re-plan in the background, best effort.
 *
 * Every automatic trigger goes through here rather than calling
 * `regeneratePlan` directly, for one reason: **a re-plan must never be able to
 * fail the thing that triggered it.** A learner who has just finished fifty
 * minutes of work has earned their session record; losing it because the
 * scheduler threw would be an unforgivable trade.
 *
 * So this swallows and logs. The two §10.3 guards still apply inside
 * `regeneratePlan` — the materiality gate discards a candidate that barely
 * differs, and the churn budget caps automatic commits at one per 24h. The
 * common outcome of these calls is therefore "nothing changed", which is
 * correct and costs one scheduler run.
 */
export async function replanQuietly(
  user: UserRow,
  goalId: string,
  reason: string,
  trigger: ReplanTriggerClass,
): Promise<void> {
  try {
    const result = await regeneratePlan(user, goalId, reason, trigger);
    logger.info('automatic re-plan', {
      goalId,
      trigger,
      committed: result.committed,
      outcome: result.reason,
      drift: result.drift.drift,
    });
  } catch (error) {
    logger.warn('automatic re-plan failed; the active plan is unchanged', {
      goalId,
      trigger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The new-day trigger.
 *
 * A plan is a fourteen-day window with dates in it. Once today moves past the
 * day the window was built for, yesterday's unfinished work is still sitting on
 * yesterday's date and the near-horizon has quietly shrunk. Re-deriving on the
 * first visit of a new day is what turns "you missed Tuesday" from a growing
 * backlog into a re-ranked queue (§10.4 — FRIDAY never carries debt forward).
 *
 * Cheap to call on every dashboard render: it compares two date strings and
 * returns immediately on the overwhelmingly common path.
 */
export async function ensurePlanFreshForToday(user: UserRow, goalId: string): Promise<void> {
  const active = await planningRepository(getDb()).findActive(user.id, goalId);
  if (!active) return;

  const today = new Date().toISOString().slice(0, 10);
  if (active.windowStart >= today) return;

  await replanQuietly(user, goalId, 'new_day', 'temporal');
}
