import {
  CONTENT_GENERATOR_PROMPT,
  estimateCostUsd,
  generateQuestions,
  modelIdFor,
  tierFor,
} from '@friday/ai';
import { deriveRatingFromAccuracy, review, updateMastery } from '@friday/core';
import { ApiError, ERROR_CODES } from '@friday/contracts';
import {
  assessmentRepository,
  curriculumRepository,
  executionRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  questionBankRepository,
  type AttemptRow,
  type QuestionRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { getModelProvider, pricedProviderName, recordAiCall } from '../ai/provider';
import { toCoreMasteryState, toCoreMemoryState } from '../shared/mappers';
import { EVENTS, trackEvent } from '../platform/analytics.service';

/**
 * Assessment service — roadmap 2.7 (generation + cache + exposure) and 2.8
 * (the practice flow: serve → answer → grade → evidence → mastery update).
 *
 * Cache-first by construction. A generated question is a shared asset keyed by
 * `concept_key`; generation only happens on a miss, and every served question
 * is recorded as an exposure so the same learner never sees it twice
 * (NFR-4.5, cost control 2).
 */

const DEFAULT_QUESTION_COUNT = 5;

export interface CreatePracticeSetInput {
  goalId: string;
  conceptIds: string[];
  questionCount?: number;
  difficulty?: number;
}

export interface PracticeSetResult {
  assessmentId: string;
  attemptId: string;
  questions: { id: string; type: string; stem: string; options: unknown }[];
  /** True when the set was served entirely from cache — no model call. */
  servedFromCache: boolean;
}

/**
 * Assembles a practice set, generating only what the cache cannot supply.
 *
 * Answers and explanations are deliberately **not** returned here — they are
 * withheld until the response is submitted (API_SPECIFICATION §5.7).
 */
export async function createPracticeSet(
  user: UserRow,
  input: CreatePracticeSetInput,
): Promise<PracticeSetResult> {
  const db = getDb();

  const goal = await goalsRepository(db).findById(user.id, input.goalId);
  if (!goal) throw ApiError.notFound();

  const concepts = await curriculumRepository(db).findConceptsByIds(user.id, input.conceptIds);
  if (concepts.length === 0) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'No such concepts.');

  const wanted = input.questionCount ?? DEFAULT_QUESTION_COUNT;
  const difficulty = input.difficulty ?? 3;
  const perConcept = Math.max(1, Math.ceil(wanted / concepts.length));

  const bank = questionBankRepository(db);
  const selected: QuestionRow[] = [];
  let generatedAny = false;

  for (const concept of concepts) {
    // A concept with no canonical key is private: its questions cannot be
    // shared, and with no key there is nothing to generate against either
    // (ADR-016). Correct behaviour, higher cost — so we skip rather than
    // silently generate unshareable content.
    if (!concept.conceptKey) {
      logger.info('skipping question generation for a private concept', { conceptId: concept.id });
      continue;
    }

    const cached = await bank.findUnseenForConcept(
      user.id,
      concept.conceptKey,
      difficulty,
      perConcept,
    );
    selected.push(...cached);

    const shortfall = perConcept - cached.length;
    if (shortfall <= 0) continue;

    const generated = await generateAndStore(
      user,
      concept.conceptKey,
      concept.title,
      difficulty,
      shortfall,
    );
    generatedAny = generatedAny || generated.length > 0;
    selected.push(...generated);
  }

  if (selected.length === 0) {
    throw new ApiError(
      ERROR_CODES.NO_QUESTIONS_AVAILABLE,
      'No questions are available for these concepts yet.',
    );
  }

  const trimmed = selected.slice(0, wanted);

  const assessment = await assessmentRepository(db).create({
    userId: user.id,
    goalId: input.goalId,
    type: 'practice_set',
    title: `Practice: ${concepts.map((c) => c.title).join(', ')}`.slice(0, 200),
    conceptIds: concepts.map((c) => c.id),
  });

  const attempt = await assessmentRepository(db).createAttempt({
    assessmentId: assessment.id,
    userId: user.id,
    maxScore: trimmed.length.toFixed(2),
  });

  await bank.recordExposures(
    user.id,
    trimmed.map((q) => q.id),
  );
  await bank.recordServed(
    trimmed.map((q) => q.id),
    [],
  );

  return {
    assessmentId: assessment.id,
    attemptId: attempt.id,
    questions: trimmed.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: q.options,
    })),
    servedFromCache: !generatedAny,
  };
}

/** Generates, self-checks, and persists questions for one canonical concept. */
async function generateAndStore(
  user: UserRow,
  conceptKey: string,
  conceptTitle: string,
  difficulty: number,
  count: number,
): Promise<QuestionRow[]> {
  const db = getDb();
  const bank = questionBankRepository(db);
  const startedAt = Date.now();

  try {
    const result = await generateQuestions(getModelProvider(), {
      conceptKey,
      conceptTitle,
      difficulty,
      count,
    });

    await recordAiCall({
      userId: user.id,
      agent: 'content_generator',
      model: result.modelId,
      promptVersion: result.promptVersion,
      status: result.rejected.length > 0 ? 'repaired' : 'ok',
      usage: result.usage,
      costUsd: estimateCostUsd(tierFor('content_generator'), result.usage, pricedProviderName()),
      latencyMs: Date.now() - startedAt,
    });

    if (result.questions.length === 0) return [];

    const rows = await bank.insertMany(
      result.questions.map((q) => ({
        conceptKey,
        type: q.type,
        status: 'active' as const,
        difficulty: q.difficulty,
        stem: q.stem,
        options: q.options ?? null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        generationMeta: { promptVersion: result.promptVersion, model: result.modelId },
      })),
    );

    await bank.linkConceptKeys(
      rows.map((r) => ({ questionId: r.id, conceptKey, isPrimary: true })),
    );
    return rows;
  } catch (error) {
    // A6 / NFR-2.2: generation failing degrades practice, it does not break it.
    // The caller serves whatever the cache had.
    logger.warn('question generation failed; serving cache only', { conceptKey });
    await recordAiCall({
      userId: user.id,
      agent: 'content_generator',
      model: modelIdFor('content_generator'),
      promptVersion: CONTENT_GENERATOR_PROMPT.version,
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown',
    }).catch(() => undefined);
    return [];
  }
}

export interface SubmitResponseInput {
  attemptId: string;
  questionId: string;
  answer: { selected?: string[]; value?: string };
  responseMs?: number;
}

export interface SubmitResponseResult {
  isCorrect: boolean;
  correctAnswer: unknown;
  explanation: string;
  gradingMethod: string;
}

/**
 * Grades one response deterministically.
 *
 * MCQ grading is exact comparison — no model involved, which is both correct
 * and the Shipathon cut (§6.3, "MCQ-only questions, no LLM grading"). Mastery
 * is **not** updated here: a per-response update would let a learner's estimate
 * swing on a single item, and §5.2's evidence weighting is designed around
 * attempt-level accuracy. The update happens on submit.
 */
export async function submitResponse(
  user: UserRow,
  input: SubmitResponseInput,
): Promise<SubmitResponseResult> {
  const db = getDb();

  const attempt = await assessmentRepository(db).findAttempt(user.id, input.attemptId);
  if (!attempt) throw ApiError.notFound();
  if (attempt.submittedAt) throw new ApiError(ERROR_CODES.ATTEMPT_ALREADY_SUBMITTED);

  const question = await questionBankRepository(db).findById(input.questionId);
  if (!question) throw ApiError.notFound();

  const isCorrect = gradeAnswer(question, input.answer);

  await assessmentRepository(db).insertResponse({
    attemptId: attempt.id,
    questionId: question.id,
    userId: user.id,
    answer: input.answer,
    isCorrect,
    score: isCorrect ? '1.00' : '0.00',
    gradingMethod: 'deterministic',
    responseMs: input.responseMs ?? null,
  });

  return {
    isCorrect,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    gradingMethod: 'deterministic',
  };
}

function gradeAnswer(
  question: QuestionRow,
  answer: { selected?: string[]; value?: string },
): boolean {
  const key = question.correctAnswer as { selected?: string[]; value?: string };

  if (key.selected) {
    const expected = [...key.selected].sort();
    const given = [...(answer.selected ?? [])].sort();
    return expected.length === given.length && expected.every((v, i) => v === given[i]);
  }

  if (key.value !== undefined) {
    const normalise = (v: string) => v.trim().toLowerCase();
    // Numeric answers compare by value, so "2.50" and "2.5" agree.
    if (question.type === 'numeric') {
      const expected = Number(key.value);
      const given = Number(answer.value);
      return (
        Number.isFinite(expected) && Number.isFinite(given) && Math.abs(expected - given) < 1e-9
      );
    }
    return normalise(key.value) === normalise(answer.value ?? '');
  }

  return false;
}

export interface SubmitAttemptResult {
  attempt: AttemptRow;
  score: number;
  maxScore: number;
  conceptBreakdown: { conceptId: string; accuracy: number; correct: number; total: number }[];
  masteryChanges: { conceptId: string; before: number; after: number; delta: number }[];
}

/**
 * Finalises an attempt: scores it, then converts per-concept accuracy into
 * evidence and runs the same mastery and FSRS updates a session does.
 *
 * This is the closing half of the loop for roadmap 2.8 — practice is only worth
 * building if the engine learns from it, and it learns through exactly the same
 * path session ratings take (§5.2, §5.4).
 */
export async function submitAttempt(
  user: UserRow,
  attemptId: string,
  now = new Date(),
): Promise<SubmitAttemptResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const assessments = assessmentRepository(tx);
    const memory = memoryRepository(tx);

    const attempt = await assessments.findAttempt(user.id, attemptId);
    if (!attempt) throw ApiError.notFound();
    if (attempt.submittedAt) throw new ApiError(ERROR_CODES.ATTEMPT_ALREADY_SUBMITTED);

    const responses = await assessments.listResponses(user.id, attemptId);
    const questionIds = responses.map((r) => r.questionId);
    const questions = await questionBankRepository(tx).findByIds(questionIds);
    const conceptKeyByQuestion = new Map(questions.map((q) => [q.id, q.conceptKey]));

    const assessment = await assessments.findById(user.id, attempt.assessmentId);
    if (!assessment) throw ApiError.notFound();

    const concepts = await curriculumRepository(tx).findConceptsByIds(
      user.id,
      assessment.conceptIds,
    );
    const conceptByKey = new Map(
      concepts.filter((c) => c.conceptKey).map((c) => [c.conceptKey!, c]),
    );

    // Aggregate accuracy per concept — the unit §5.4 maps to an FSRS rating.
    const tally = new Map<string, { correct: number; total: number }>();
    for (const response of responses) {
      const key = conceptKeyByQuestion.get(response.questionId);
      const concept = key ? conceptByKey.get(key) : undefined;
      if (!concept) continue;
      const entry = tally.get(concept.id) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (response.isCorrect) entry.correct += 1;
      tally.set(concept.id, entry);
    }

    const correctCount = responses.filter((r) => r.isCorrect).length;
    const conceptBreakdown: SubmitAttemptResult['conceptBreakdown'] = [];
    const masteryChanges: SubmitAttemptResult['masteryChanges'] = [];

    for (const [conceptId, counts] of tally) {
      const accuracy = counts.total > 0 ? counts.correct / counts.total : 0;
      conceptBreakdown.push({ conceptId, accuracy, correct: counts.correct, total: counts.total });

      const masteryRow = await memory.getMasteryState(user.id, conceptId);
      const prior = masteryRow
        ? toCoreMasteryState(masteryRow)
        : {
            conceptId,
            mastery: 0,
            confidence: 0,
            evidenceCount: 0,
            distinctSources: 0,
            outcomeVariance: 0,
            lastEvidenceAt: null,
          };

      // `question_response` carries w_source 0.85 — far stronger than a
      // self-rating's 0.35, which is the whole reason practice is worth serving.
      const updated = updateMastery(
        prior,
        {
          conceptId,
          source: 'question_response',
          outcome: accuracy,
          occurredAt: now,
        },
        { kBase: 0.3, kFloor: 0.05 },
        now,
      );

      await memory.upsertMasteryState({
        userId: user.id,
        conceptId,
        mastery: updated.mastery.toFixed(3),
        confidence: updated.confidence.toFixed(3),
        evidenceCount: updated.evidenceCount,
        distinctSources: Math.min(5, prior.distinctSources + 1),
        outcomeVariance: prior.outcomeVariance.toFixed(3),
        totalMinutes: masteryRow?.totalMinutes ?? 0,
        accuracyRate: accuracy.toFixed(3),
        firstStudiedAt: masteryRow?.firstStudiedAt ?? now,
        lastEvidenceAt: now,
      });

      masteryChanges.push({
        conceptId,
        before: prior.mastery,
        after: updated.mastery,
        delta: updated.mastery - prior.mastery,
      });

      const memoryRow = await memory.getMemoryState(user.id, conceptId);
      const nextMemory = review(
        conceptId,
        memoryRow ? toCoreMemoryState(memoryRow) : null,
        deriveRatingFromAccuracy(accuracy),
        now,
      );
      await memory.upsertMemoryState({
        userId: user.id,
        conceptId,
        stability: nextMemory.stability.toFixed(4),
        difficulty: nextMemory.difficulty.toFixed(4),
        reps: nextMemory.reps,
        lapses: nextMemory.lapses,
        state: nextMemory.state,
        lastReviewAt: nextMemory.lastReviewAt,
        dueAt: nextMemory.dueAt,
      });

      await executionRepository(tx).insertEvidence([
        {
          userId: user.id,
          conceptId,
          source: 'question_response',
          outcome: accuracy.toFixed(3),
          occurredAt: now,
        },
      ]);
    }

    const submitted = await assessments.submitAttempt(user.id, attemptId, {
      score: correctCount.toFixed(2),
      maxScore: responses.length.toFixed(2),
      conceptBreakdown,
      timeSpentSeconds: Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000),
    });
    if (!submitted) throw ApiError.notFound();

    await executionRepository(tx).insertLearningEvent({
      userId: user.id,
      goalId: assessment.goalId,
      eventType: 'assessment.graded',
      entityType: 'attempt',
      entityId: attemptId,
      payload: { conceptBreakdown, masteryChanges },
    });

    logger.info('attempt submitted', {
      attemptId,
      score: correctCount,
      concepts: conceptBreakdown.length,
    });

    trackEvent(user.id, EVENTS.practiceCompleted, {
      score: correctCount,
      concepts: conceptBreakdown.length,
    });

    return {
      attempt: submitted,
      score: correctCount,
      maxScore: responses.length,
      conceptBreakdown,
      masteryChanges,
    };
  });
}

export async function reportQuestion(questionId: string): Promise<void> {
  await questionBankRepository(getDb()).report(questionId);
}
