import {
  computeAdaptiveProfile,
  type AdaptiveProfile,
  type SessionObservation,
} from '@friday/core';
import { executionRepository, getDb, type StudySessionRow, type UserRow } from '@friday/db';

/**
 * The adaptive profile, derived on read.
 *
 * Nothing is stored. The profile is a pure function of `study_sessions`, which
 * the system already writes on every completion and abandonment, so persisting
 * it would create a second copy of the truth that can drift from the first —
 * and the failure mode of a stale adaptive profile is the product confidently
 * telling a learner something about themselves that stopped being true a week
 * ago. Recomputing costs one indexed query over at most `SESSION_HISTORY_LIMIT`
 * rows.
 *
 * This is why no migration ships with this feature.
 */

/**
 * How far back to read.
 *
 * The engine reads two consecutive 14-day windows — the current one, and the
 * one before it, which is what the continuity line ("two weeks ago you were
 * struggling") is derived from. This is a row cap so a heavy user's history
 * cannot grow the query without bound.
 *
 * If a learner is prolific enough to hit the cap, the *older* window is the one
 * that gets truncated, so the engine sees less history than really exists and
 * falls back to `unknown` for the prior band — which suppresses the transition
 * rather than fabricating one. The failure direction is silence, never fiction.
 */
export const SESSION_HISTORY_LIMIT = 200;

/**
 * Pure mapping from stored rows to engine input.
 *
 * Exported so the Coach's context builder — which already reads sessions for
 * its own "recent activity" section — can derive the profile from the rows it
 * has in hand instead of issuing a second query for the same table.
 */
export function profileFromSessionRows(
  rows: StudySessionRow[],
  timeZone: string,
  now = new Date(),
): AdaptiveProfile {
  const sessions: SessionObservation[] = rows.map((row) => ({
    startedAt: row.startedAt,
    status: row.status,
    activeMinutes: row.activeMinutes,
    plannedMinutes: row.plannedMinutes,
  }));

  // Consistency is counted in the learner's own calendar days — see the engine.
  return computeAdaptiveProfile({ sessions, timeZone, now });
}

export async function getAdaptiveProfile(user: UserRow): Promise<AdaptiveProfile> {
  const rows = await executionRepository(getDb()).recentSessions(user.id, SESSION_HISTORY_LIMIT);
  return profileFromSessionRows(rows, user.timezone);
}
