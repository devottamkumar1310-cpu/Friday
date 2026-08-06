import { ApiError } from '@friday/contracts';
import {
  DEFAULT_PRIORITY_CONFIG,
  computeRetentionHealth,
  computeVelocity,
  computeWeightedProgress,
  rankWeakConcepts,
  retrievability,
  type WeakConcept,
} from '@friday/core';
import {
  curriculumRepository,
  executionRepository,
  getDb,
  goalsRepository,
  intelligenceRepository,
  memoryRepository,
  planningRepository,
  type UserRow,
} from '@friday/db';
import {
  buildOutDegree,
  toCoreConcept,
  toCoreMasteryState,
  toCoreMemoryState,
} from '../shared/mappers';

/**
 * Intelligence service — roadmap 2.1 (progress, weighted completion, on-track
 * verdict) and 2.2 (weak-concept ranking with evidence drill-down).
 *
 * Every number here comes from `packages/core`. This layer gathers rows,
 * delegates, and serialises — it does not compute (A1/DP1).
 */

interface GoalScope {
  goalId: string;
  conceptInputs: {
    concept: ReturnType<typeof toCoreConcept>;
    masteryState: ReturnType<typeof toCoreMasteryState> | null;
    retrievability: number;
    directUnlockCount: number;
  }[];
  memoryStates: { retrievability: number; dueAt: Date; reps: number }[];
  plan: Awaited<ReturnType<ReturnType<typeof planningRepository>['findActive']>>;
  goal: NonNullable<Awaited<ReturnType<ReturnType<typeof goalsRepository>['findById']>>>;
}

async function loadGoalScope(user: UserRow, goalId: string, now: Date): Promise<GoalScope> {
  const db = getDb();

  const goal = await goalsRepository(db).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  const curriculum = await curriculumRepository(db).findByGoal(user.id, goalId);
  if (!curriculum) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).listConcepts(user.id, curriculum.id);
  const edges = await curriculumRepository(db).listEdges(user.id, curriculum.id);
  const conceptIds = concepts.map((c) => c.id);

  const masteryRows = await memoryRepository(db).listMasteryStates(user.id, conceptIds);
  const memoryRows = await memoryRepository(db).listMemoryStates(user.id, conceptIds);
  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, m]));
  const memoryByConcept = new Map(memoryRows.map((m) => [m.conceptId, m]));
  const outDegree = buildOutDegree(edges);

  const conceptInputs = concepts.map((c) => {
    const memoryRow = memoryByConcept.get(c.id);
    const memoryState = memoryRow ? toCoreMemoryState(memoryRow) : null;
    const masteryRow = masteryByConcept.get(c.id);
    return {
      concept: toCoreConcept(c),
      masteryState: masteryRow ? toCoreMasteryState(masteryRow) : null,
      retrievability: retrievability(memoryState, now),
      directUnlockCount: outDegree.get(c.id) ?? 0,
    };
  });

  return {
    goalId,
    conceptInputs,
    memoryStates: memoryRows.map((m) => ({
      retrievability: retrievability(toCoreMemoryState(m), now),
      dueAt: m.dueAt,
      reps: m.reps,
    })),
    plan: await planningRepository(db).findActive(user.id, goalId),
    goal,
  };
}

export interface ProgressReport {
  weightedProgress: number;
  rawProgress: number;
  conceptsMastered: number;
  conceptsTotal: number;
  conceptsInProgress: number;
  conceptsNotStarted: number;
  verdict: 'on_track' | 'at_risk' | 'not_feasible';
  projectedCompletionDate: string | null;
  daysRemaining: number;
  velocity: { perWeek: number; requiredPerWeek: number; trend: string };
  retentionHealth: { dueNow: number; overdue: number; atRisk: number };
  adherence: { last7d: number | null; last30d: number | null };
}

export async function getProgress(
  user: UserRow,
  goalId: string,
  now = new Date(),
): Promise<ProgressReport> {
  const scope = await loadGoalScope(user, goalId, now);
  const { phi } = DEFAULT_PRIORITY_CONFIG;

  const progress = computeWeightedProgress(scope.conceptInputs, phi);
  const retention = computeRetentionHealth(scope.memoryStates, now);

  const daysRemaining = Math.max(
    0,
    Math.round((new Date(scope.goal.targetDate).getTime() - now.getTime()) / 86_400_000),
  );

  // Velocity needs a prior data point. Snapshots supply it once there is
  // history; before that we report zero movement rather than extrapolating
  // from a single observation, which would be noise dressed as a trend.
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const snapshots = await intelligenceRepository(getDb()).listSnapshots(user.id, goalId, since);
  const earliest = snapshots[0];

  const velocity = computeVelocity({
    progressStart: earliest ? Number(earliest.weightedProgress) : progress.weightedProgress,
    progressEnd: progress.weightedProgress,
    windowDays: 7,
    daysRemaining,
  });

  return {
    weightedProgress: progress.weightedProgress,
    rawProgress: progress.rawProgress,
    conceptsMastered: progress.conceptsMastered,
    conceptsTotal: progress.conceptsTotal,
    conceptsInProgress: progress.conceptsInProgress,
    conceptsNotStarted: progress.conceptsNotStarted,
    verdict: scope.plan?.verdict ?? 'not_feasible',
    projectedCompletionDate: scope.plan?.projectedCompletionDate ?? null,
    daysRemaining,
    velocity,
    retentionHealth: retention,
    adherence: await computeAdherence(user, now),
  };
}

/**
 * ρ observed rather than promised — planned minutes vs. minutes actually
 * completed. Returns null below a minimum sample, because a single session is
 * not an adherence rate (E-1, Q7).
 */
async function computeAdherence(
  user: UserRow,
  now: Date,
): Promise<{ last7d: number | null; last30d: number | null }> {
  const sessions = await executionRepository(getDb()).recentSessions(user.id, 50);
  const windowRate = (days: number): number | null => {
    const cutoff = now.getTime() - days * 86_400_000;
    const inWindow = sessions.filter((s) => s.startedAt.getTime() >= cutoff);
    if (inWindow.length < 3) return null;
    const planned = inWindow.reduce((sum, s) => sum + (s.plannedMinutes ?? s.activeMinutes), 0);
    const actual = inWindow.reduce((sum, s) => sum + s.activeMinutes, 0);
    return planned > 0 ? Math.min(1, actual / planned) : null;
  };
  return { last7d: windowRate(7), last30d: windowRate(30) };
}

export async function getWeakConcepts(
  user: UserRow,
  goalId: string,
  limit = 10,
  now = new Date(),
): Promise<WeakConcept[]> {
  const scope = await loadGoalScope(user, goalId, now);
  return rankWeakConcepts(scope.conceptInputs, {
    phi: DEFAULT_PRIORITY_CONFIG.phi,
    lambda: DEFAULT_PRIORITY_CONFIG.lambda,
    limit,
  });
}

/**
 * Writes today's rollup so trend charts stay O(days) rather than O(events)
 * (§10). Idempotent — running it twice in a day overwrites rather than
 * duplicating, so it is safe to call from a request path.
 */
export async function recordProgressSnapshot(
  user: UserRow,
  goalId: string,
  now = new Date(),
): Promise<void> {
  const report = await getProgress(user, goalId, now);
  await intelligenceRepository(getDb()).upsertSnapshot({
    userId: user.id,
    goalId,
    snapshotDate: now.toISOString().slice(0, 10),
    weightedProgress: report.weightedProgress.toFixed(4),
    conceptsMastered: report.conceptsMastered,
    conceptsTotal: report.conceptsTotal,
    minutesStudied: 0,
    adherenceRate: report.adherence.last7d?.toFixed(3) ?? null,
    verdict: report.verdict,
    projectedCompletionDate: report.projectedCompletionDate,
  });
}

export async function getTrends(
  user: UserRow,
  goalId: string,
  periodDays = 30,
  now = new Date(),
): Promise<{ date: string; weightedProgress: number; conceptsMastered: number }[]> {
  const since = new Date(now.getTime() - periodDays * 86_400_000).toISOString().slice(0, 10);
  const snapshots = await intelligenceRepository(getDb()).listSnapshots(user.id, goalId, since);
  return snapshots.map((s) => ({
    date: s.snapshotDate,
    weightedProgress: Number(s.weightedProgress),
    conceptsMastered: s.conceptsMastered,
  }));
}

export async function listInsights(user: UserRow, goalId?: string) {
  return intelligenceRepository(getDb()).listInsights(user.id, goalId);
}

export async function dismissInsight(user: UserRow, insightId: string): Promise<void> {
  await intelligenceRepository(getDb()).dismissInsight(user.id, insightId);
}
