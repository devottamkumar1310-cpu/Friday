import {
  DEFAULT_PRIORITY_CONFIG,
  ENGINE_VERSION,
  assessConfidence,
  computeDecayRisk,
  describeDecayRisk,
  describeImpact,
  effectiveMastery,
  renderRationale,
  retrievability,
  scoreFromStructural,
  selectAction,
  type ScoredCandidate,
} from '@friday/core';
import { ApiError, type NextActionResponse } from '@friday/contracts';
import {
  curriculumRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  tracesRepository,
  type TaskRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';

const ALTERNATES_COUNT = 2;

interface Candidate {
  task: TaskRow;
  conceptId: string;
  conceptTitle: string;
  scored: ScoredCandidate;
  mastery: number;
}

async function buildCandidates(userId: string, goalId: string, now: Date): Promise<Candidate[]> {
  const db = getDb();
  const tasks = await planningRepository(db).listPendingTasks(userId, goalId);
  if (tasks.length === 0) return [];

  const taskConceptRows = await planningRepository(db).listTaskConceptsForTasks(
    userId,
    tasks.map((t) => t.id),
  );
  const conceptIdByTaskId = new Map(
    taskConceptRows.filter((tc) => tc.isPrimary).map((tc) => [tc.taskId, tc.conceptId]),
  );
  const conceptIds = [...new Set(conceptIdByTaskId.values())];

  const concepts = await curriculumRepository(db).findConceptsByIds(userId, conceptIds);
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const masteryStates = await memoryRepository(db).listMasteryStates(userId, conceptIds);
  const masteryByConceptId = new Map(masteryStates.map((m) => [m.conceptId, m]));
  const memoryStates = await memoryRepository(db).listMemoryStates(userId, conceptIds);
  const memoryByConceptId = new Map(memoryStates.map((m) => [m.conceptId, m]));

  const candidates: Candidate[] = [];

  for (const task of tasks) {
    const conceptId = conceptIdByTaskId.get(task.id);
    if (!conceptId) continue;
    const concept = conceptById.get(conceptId);
    if (!concept || concept.status === 'excluded') continue;

    const masteryRow = masteryByConceptId.get(conceptId);
    const mastery = masteryRow ? Number(masteryRow.mastery) : 0;
    const memoryRow = memoryByConceptId.get(conceptId);
    const memoryState = memoryRow
      ? {
          conceptId,
          stability: Number(memoryRow.stability),
          difficulty: Number(memoryRow.difficulty),
          reps: memoryRow.reps,
          lapses: memoryRow.lapses,
          state: memoryRow.state,
          lastReviewAt: memoryRow.lastReviewAt,
          dueAt: memoryRow.dueAt,
        }
      : null;

    const retrievabilityValue = retrievability(memoryState, now);
    const decayRisk = computeDecayRisk(
      retrievabilityValue,
      memoryState?.reps ?? 0,
      DEFAULT_PRIORITY_CONFIG.repsMin,
    );
    const mEff = effectiveMastery(mastery, retrievabilityValue, DEFAULT_PRIORITY_CONFIG.phi);

    const structural = (task.structuralFactors ?? {
      impact: 0,
      urgency: 0,
      leverage: 1,
      readiness: 1,
      cost: task.estimatedMinutes,
    }) as { impact: number; urgency: number; readiness: number; cost: number };

    const scored = scoreFromStructural(
      conceptId,
      structural,
      decayRisk,
      DEFAULT_PRIORITY_CONFIG,
      describeImpact(Number(concept.examWeight), mEff),
      describeDecayRisk(retrievabilityValue, (memoryState?.reps ?? 0) > 0),
    );
    scored.taskId = task.id;

    candidates.push({ task, conceptId, conceptTitle: concept.title, scored, mastery });
  }

  return candidates;
}

export async function getNextAction(
  user: UserRow,
  goalId: string,
  availableMinutes: number,
): Promise<NextActionResponse['data']> {
  const goal = await goalsRepository(getDb()).findById(user.id, goalId);
  if (!goal) throw ApiError.notFound();

  const now = new Date();
  const candidates = await buildCandidates(user.id, goalId, now);

  const computedAt = now.toISOString();
  if (candidates.length === 0) {
    return { action: null, why: null, alternates: [], computedAt, cacheHit: false };
  }

  const lastTrace = (await tracesRepository(getDb()).listRecent(user.id, 'next_action', 1))[0];
  const currentRecommendationConceptId = lastTrace?.selectedEntityId
    ? (candidates.find((c) => c.task.id === lastTrace.selectedEntityId)?.conceptId ?? null)
    : null;

  const durationByConceptId = new Map(
    candidates.map((c) => [c.conceptId, c.task.estimatedMinutes]),
  );

  const selection = selectAction({
    ranked: candidates.map((c) => c.scored),
    currentRecommendationConceptId,
    overrideFired: false,
    availableMinutes,
    durationByConceptId,
    minViableMinutes: DEFAULT_PRIORITY_CONFIG.minViableMinutes,
    hysteresisMargin: DEFAULT_PRIORITY_CONFIG.hysteresisMargin,
  });

  if (!selection.selected) {
    return { action: null, why: null, alternates: [], computedAt, cacheHit: false };
  }

  const chosen = candidates.find((c) => c.conceptId === selection.selected!.conceptId)!;
  const ranked = [...candidates].sort((a, b) => b.scored.adjustedScore - a.scored.adjustedScore);
  const runnerUp = ranked.find((c) => c.conceptId !== chosen.conceptId);

  const chosenMasteryState = await memoryRepository(getDb()).getMasteryState(
    user.id,
    chosen.conceptId,
  );
  const confidence = assessConfidence({
    beliefConfidence: chosenMasteryState ? Number(chosenMasteryState.confidence) : 0,
    topScore: chosen.scored.adjustedScore,
    runnerUpScore: runnerUp?.scored.adjustedScore ?? null,
    dataSufficiency: Math.min(1, (chosenMasteryState?.evidenceCount ?? 0) / 10),
    wasStableAcrossRecompute: currentRecommendationConceptId === chosen.conceptId,
    constraintsRelaxed: !selection.fitsWindow,
  });

  const rationale = renderRationale(
    chosen.scored.dominantFactor,
    chosen.scored.factors,
    chosen.conceptTitle,
    availableMinutes,
  );

  await tracesRepository(getDb()).record({
    userId: user.id,
    goalId,
    type: 'next_action',
    engineVersion: ENGINE_VERSION,
    configVersion: DEFAULT_PRIORITY_CONFIG.configVersion,
    inputSnapshotHash: `candidates-${candidates.length}-${computedAt}`,
    candidates: ranked.slice(0, 10).map((c) => ({
      taskId: c.task.id,
      conceptId: c.conceptId,
      score: c.scored.adjustedScore,
      factors: c.scored.factors,
    })),
    excluded: [],
    selectedEntityId: chosen.task.id,
    selectedScore: chosen.scored.adjustedScore.toFixed(4),
    modifiersApplied: chosen.scored.modifiersApplied,
    confidence: confidence.score.toFixed(3),
    confidenceInputs: confidence.inputs,
    dominantFactor: chosen.scored.dominantFactor,
    explanation: { rationale, factors: chosen.scored.factors },
  });

  logger.info('next action computed', {
    goalId,
    taskId: chosen.task.id,
    dominant: chosen.scored.dominantFactor,
  });

  return {
    action: {
      taskId: chosen.task.id,
      type: chosen.task.type,
      title: chosen.task.title,
      estimatedMinutes: chosen.task.estimatedMinutes,
      concepts: [{ id: chosen.conceptId, title: chosen.conceptTitle, mastery: chosen.mastery }],
      rationale,
    },
    why: {
      priorityScore: chosen.scored.adjustedScore,
      factors: chosen.scored.factors,
      dominantFactor: chosen.scored.dominantFactor,
      confidence: { score: confidence.score, band: confidence.band },
    },
    alternates: ranked
      .filter((c) => c.conceptId !== chosen.conceptId)
      .slice(0, ALTERNATES_COUNT)
      .map((c) => ({
        taskId: c.task.id,
        title: c.task.title,
        estimatedMinutes: c.task.estimatedMinutes,
        priorityScore: c.scored.adjustedScore,
      })),
    computedAt,
    cacheHit: false,
  };
}

export async function skipNextAction(
  user: UserRow,
  goalId: string,
  taskId: string,
  reason: string | undefined,
  availableMinutes: number,
): Promise<NextActionResponse['data']> {
  const task = await planningRepository(getDb()).findTask(user.id, taskId);
  if (!task) throw ApiError.notFound();

  await planningRepository(getDb()).updateTaskStatus(user.id, taskId, {
    status: 'skipped',
    skippedReason: reason ?? null,
  });

  logger.info('next action skipped', { goalId, taskId, reason });

  return getNextAction(user, goalId, availableMinutes);
}
