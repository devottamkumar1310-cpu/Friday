import type { FsrsRating } from '@friday/core';
import { review, updateMastery } from '@friday/core';
import {
  ApiError,
  ERROR_CODES,
  type CompleteSessionRequest,
  type StartSessionRequest,
} from '@friday/contracts';
import {
  executionRepository,
  getDb,
  goalsRepository,
  memoryRepository,
  planningRepository,
  type StudySessionRow,
  type UserRow,
} from '@friday/db';
import { logger } from '@friday/observability';
import { EVENTS, trackEvent } from '../platform/analytics.service';
import { replanQuietly } from '../planning/planning.service';

/**
 * Sessions and the evidence -> mastery/retention update — SYSTEM_ARCHITECTURE
 * §6.4 and API_SPECIFICATION §5.6. "The most important write in the system":
 * mastery and memory state are updated inside the same transaction as the
 * session write, and the Next Action cache is invalidated only after commit.
 */

/** §5.4 unifies self-rating into an outcome scalar for the mastery update. */
const RATING_OUTCOME: Record<FsrsRating, number> = {
  again: 0.15,
  hard: 0.45,
  good: 0.8,
  easy: 1.0,
};

export async function startSession(
  user: UserRow,
  input: StartSessionRequest,
): Promise<StudySessionRow> {
  const db = getDb();
  const goal = await goalsRepository(db).findById(user.id, input.goalId);
  if (!goal) throw ApiError.notFound();

  const existing = await executionRepository(db).findActiveSession(user.id);
  if (existing) throw new ApiError(ERROR_CODES.SESSION_ALREADY_ACTIVE); // E-19

  if (input.taskId) {
    const task = await planningRepository(db).findTask(user.id, input.taskId);
    if (!task) throw ApiError.notFound();
  }

  const session = await executionRepository(db).createSession({
    userId: user.id,
    goalId: input.goalId,
    taskId: input.taskId ?? null,
    status: 'active',
    originatedFrom: input.originatedFrom,
  });

  // Paired with `session.completed`: the ratio between them is how many
  // sessions get started and never finished, which is the number that says
  // whether the study screen works.
  trackEvent(user.id, EVENTS.sessionStarted, { originatedFrom: input.originatedFrom });

  return session;
}

export interface CompleteSessionResult {
  session: StudySessionRow;
  changes: {
    mastery: { conceptId: string; before: number; after: number; delta: number }[];
    retention: {
      conceptId: string;
      previousDue: string | null;
      nextDue: string;
      intervalDays: number;
    }[];
  };
}

export async function completeSession(
  user: UserRow,
  sessionId: string,
  input: CompleteSessionRequest,
): Promise<CompleteSessionResult> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const execution = executionRepository(tx);
    const memory = memoryRepository(tx);

    /**
     * Locked, not merely read.
     *
     * The status guard below is correct and was not enough: two concurrent
     * completions both read `active`, both passed it, and both committed, so one
     * sitting produced two evidence events and two mastery updates. A
     * double-tapped Finish button was sufficient. `findSessionForUpdate` makes
     * the loser wait for the winner to commit, after which it reads
     * `completed` and this same guard rejects it.
     */
    const session = await execution.findSessionForUpdate(user.id, sessionId);
    if (!session) throw ApiError.notFound();
    if (session.status !== 'active') throw new ApiError(ERROR_CODES.SESSION_NOT_ACTIVE);

    const now = new Date();

    /**
     * The duration of record, bounded by wall-clock.
     *
     * The client reports *effective* study time — total elapsed minus whatever
     * was paused — and that subtraction is the right one. But the client is
     * also the one place we cannot verify: pause state lives in `localStorage`,
     * so clearing storage mid-session loses the paused total and inflates the
     * figure, and the request schema on its own would accept a flat 1440.
     *
     * The server knows exactly one thing the client cannot argue with:
     * `started_at`. No session can have consumed more time than has passed
     * since it began. Pause only ever *reduces* effective time, so clamping to
     * the elapsed wall-clock is always safe and never truncates an honest
     * session.
     *
     * This matters beyond tidiness — `activeMinutes` feeds `totalMinutes` on
     * the mastery row, which feeds pace, feasibility and every forecast the
     * product makes.
     */
    const wallClockMinutes = Math.max(
      1,
      Math.ceil((now.getTime() - session.startedAt.getTime()) / 60_000),
    );
    const effectiveMinutes = Math.min(input.activeMinutes, wallClockMinutes);

    if (effectiveMinutes < input.activeMinutes) {
      logger.warn('reported study time exceeded elapsed time; clamped', {
        sessionId,
        reported: input.activeMinutes,
        elapsed: wallClockMinutes,
      });
    }

    const masteryChanges: CompleteSessionResult['changes']['mastery'] = [];
    const retentionChanges: CompleteSessionResult['changes']['retention'] = [];

    for (const rating of input.ratings) {
      const masteryRow = await memory.getMasteryState(user.id, rating.conceptId);
      const priorMastery = masteryRow
        ? {
            conceptId: rating.conceptId,
            mastery: Number(masteryRow.mastery),
            confidence: Number(masteryRow.confidence),
            evidenceCount: masteryRow.evidenceCount,
            distinctSources: masteryRow.distinctSources,
            outcomeVariance: Number(masteryRow.outcomeVariance),
            lastEvidenceAt: masteryRow.lastEvidenceAt,
          }
        : {
            conceptId: rating.conceptId,
            mastery: 0,
            confidence: 0,
            evidenceCount: 0,
            distinctSources: 0,
            outcomeVariance: 0,
            lastEvidenceAt: null,
          };

      const evidence = {
        conceptId: rating.conceptId,
        source: 'self_rating' as const,
        outcome: RATING_OUTCOME[rating.rating],
        occurredAt: now,
      };

      const updated = updateMastery(priorMastery, evidence, { kBase: 0.3, kFloor: 0.05 }, now);
      await memory.upsertMasteryState({
        userId: user.id,
        conceptId: rating.conceptId,
        mastery: updated.mastery.toFixed(3),
        confidence: updated.confidence.toFixed(3),
        evidenceCount: updated.evidenceCount,
        distinctSources: Math.min(5, priorMastery.distinctSources + 1),
        outcomeVariance: priorMastery.outcomeVariance.toFixed(3),
        totalMinutes: (masteryRow?.totalMinutes ?? 0) + effectiveMinutes,
        firstStudiedAt: masteryRow?.firstStudiedAt ?? now,
        lastEvidenceAt: now,
      });

      masteryChanges.push({
        conceptId: rating.conceptId,
        before: priorMastery.mastery,
        after: updated.mastery,
        delta: updated.mastery - priorMastery.mastery,
      });

      const memoryRow = await memory.getMemoryState(user.id, rating.conceptId);
      const priorMemoryState = memoryRow
        ? {
            conceptId: rating.conceptId,
            stability: Number(memoryRow.stability),
            difficulty: Number(memoryRow.difficulty),
            reps: memoryRow.reps,
            lapses: memoryRow.lapses,
            state: memoryRow.state,
            lastReviewAt: memoryRow.lastReviewAt,
            dueAt: memoryRow.dueAt,
          }
        : null;

      const nextMemoryState = review(rating.conceptId, priorMemoryState, rating.rating, now);
      await memory.upsertMemoryState({
        userId: user.id,
        conceptId: rating.conceptId,
        stability: nextMemoryState.stability.toFixed(4),
        difficulty: nextMemoryState.difficulty.toFixed(4),
        reps: nextMemoryState.reps,
        lapses: nextMemoryState.lapses,
        state: nextMemoryState.state,
        lastReviewAt: nextMemoryState.lastReviewAt,
        dueAt: nextMemoryState.dueAt,
      });

      retentionChanges.push({
        conceptId: rating.conceptId,
        previousDue: priorMemoryState?.dueAt.toISOString() ?? null,
        nextDue: nextMemoryState.dueAt.toISOString(),
        intervalDays: Math.round((nextMemoryState.dueAt.getTime() - now.getTime()) / 86_400_000),
      });

      await execution.insertEvidence([
        {
          userId: user.id,
          conceptId: rating.conceptId,
          sessionId,
          source: 'self_rating',
          outcome: evidence.outcome.toFixed(3),
          confidence: rating.confidence?.toFixed(2) ?? null,
          occurredAt: now,
        },
      ]);
    }

    if (session.taskId) {
      await planningRepository(tx).updateTaskStatus(user.id, session.taskId, {
        status: 'completed',
        completedAt: now,
      });
    }

    const completed = await execution.completeSession(user.id, sessionId, {
      activeMinutes: effectiveMinutes,
      notes: input.notes ?? null,
      selfRating: input.ratings[0]?.rating ?? null,
      endedAt: now,
    });
    if (!completed) throw ApiError.notFound();

    await execution.insertLearningEvent({
      userId: user.id,
      goalId: session.goalId,
      eventType: 'session.completed',
      entityType: 'study_session',
      entityId: sessionId,
      payload: { masteryChanges, retentionChanges, activeMinutes: effectiveMinutes },
    });

    return {
      session: completed,
      changes: { mastery: masteryChanges, retention: retentionChanges },
    };
  });

  logger.info('session completed', { sessionId, conceptsUpdated: input.ratings.length });
  trackEvent(user.id, EVENTS.sessionCompleted, {
    // The clamped figure, from the row — analytics must agree with the record.
    activeMinutes: result.session.activeMinutes,
    conceptsRated: input.ratings.length,
  });

  // New evidence just landed, so the ranking that produced this task may no
  // longer hold. Awaited rather than fired-and-forgotten: the learner is about
  // to be shown their next action, and it should be computed from what they
  // just did. `replanQuietly` cannot throw, and the materiality gate means the
  // usual outcome is "nothing changed".
  await replanQuietly(user, result.session.goalId, 'session_completed', 'evidence');

  return result;
}

export async function abandonSession(user: UserRow, sessionId: string): Promise<void> {
  const db = getDb();

  // Read-guard-write in one transaction with the row locked, for the same
  // reason as `completeSession`: the check and the write must not be separable
  // by another request.
  const session = await db.transaction(async (tx) => {
    const execution = executionRepository(tx);
    const row = await execution.findSessionForUpdate(user.id, sessionId);
    if (!row) throw ApiError.notFound();

    /**
     * Terminal is terminal.
     *
     * `completeSession` has always rejected a non-active session; this path did
     * not, and an audit confirmed the consequence: `complete` then `abandon`
     * returned 200 and rewrote a finished session's status to `abandoned`. The
     * minutes and the evidence stayed, but every reader of `status` — completion
     * rate, band, trend, streak — then saw a session the learner had actually
     * finished as one they walked out on. A retry, a double-tap, or a tab left
     * open was enough to corrupt the learner's own history, silently, in the one
     * table the adaptive engine is built on.
     *
     * Same code as the completion path, so both replays fail the same way.
     */
    if (row.status !== 'active') throw new ApiError(ERROR_CODES.SESSION_NOT_ACTIVE);

    await execution.abandonSession(user.id, sessionId);
    return row;
  });

  trackEvent(user.id, EVENTS.sessionAbandoned);

  // A discarded session produced no evidence, but it did consume a slot the
  // plan had allocated. Re-deriving keeps the remaining window honest about
  // how much time is actually left in it.
  await replanQuietly(user, session.goalId, 'session_abandoned', 'evidence');
}

/** Session history for the UI — API_SPECIFICATION §5.6. */
export async function listSessions(user: UserRow, limit = 20) {
  const db = getDb();
  const sessions = await executionRepository(db).recentSessions(user.id, limit);

  const taskIds = [...new Set(sessions.map((s) => s.taskId).filter((id): id is string => !!id))];
  const tasks = await planningRepository(db).findTasksByIds(user.id, taskIds);
  const titleByTaskId = new Map(tasks.map((t) => [t.id, t.title]));

  return sessions.map((s) =>
    toWireSession(s, s.taskId ? (titleByTaskId.get(s.taskId) ?? null) : null),
  );
}

export async function getSession(user: UserRow, sessionId: string) {
  const db = getDb();
  const session = await executionRepository(db).findSession(user.id, sessionId);
  if (!session) throw ApiError.notFound();
  const task = session.taskId
    ? await planningRepository(db).findTask(user.id, session.taskId)
    : null;
  return toWireSession(session, task?.title ?? null);
}

export function toWireSession(session: StudySessionRow, taskTitle: string | null) {
  return {
    id: session.id,
    goalId: session.goalId,
    taskId: session.taskId,
    taskTitle,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    activeMinutes: session.activeMinutes,
    selfRating: session.selfRating,
    originatedFrom: session.originatedFrom,
  };
}
