import { getDb, productRepository } from '@friday/db';
import { logger } from '@friday/observability';

/**
 * Product analytics — CR-007.
 *
 * The launch questions this exists to answer, and nothing beyond them:
 *
 *   1. Do learners finish onboarding, or drop out at availability or goal?
 *   2. Does the loop close — does a session or practice actually get completed?
 *   3. Do they come back?
 *   4. Is the Coach used, and does it fail?
 *
 * Recorded server-side from actions that already happened. No browser script,
 * no cookie, no device fingerprint, no third party. That is partly a privacy
 * position — most of FRIDAY's learners are minors under the DPDP Act — and
 * partly an accuracy one: a server-side event cannot be lost to an ad blocker.
 *
 * `recordEvent` is the seam. PostHog remains the intended destination
 * (SYSTEM_ARCHITECTURE §2); pointing this at it later is a change to one
 * function, not to the twelve call sites.
 */

/**
 * The closed vocabulary. A fixed list rather than free-form strings, because
 * an event name nobody agreed on is a metric nobody can compute — one typo and
 * a funnel silently loses a step.
 */
export const EVENTS = {
  signedUp: 'user.signed_up',
  availabilitySet: 'onboarding.availability_set',
  goalUpdated: 'goal.updated',
  goalCreated: 'goal.created',
  sessionStarted: 'session.started',
  sessionCompleted: 'session.completed',
  sessionAbandoned: 'session.abandoned',
  practiceCompleted: 'practice.completed',
  coachTurn: 'coach.turn',
  feedbackSubmitted: 'feedback.submitted',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Small non-identifying dimensions: counts, enums, durations. Never free text. */
export type EventProperties = Record<string, string | number | boolean>;

/**
 * Records one event.
 *
 * Never throws and never blocks the caller's outcome. Analytics that can fail a
 * learner's session is worse than no analytics — the write is best-effort by
 * design, and a failure is a log line, not an error the learner sees.
 */
export async function recordEvent(
  userId: string | null,
  name: EventName,
  properties?: EventProperties,
): Promise<void> {
  try {
    await productRepository(getDb()).recordEvent({ userId, name, properties });
  } catch (error) {
    logger.warn('failed to record product event', {
      event: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Fire-and-forget, for call sites on a latency-sensitive path. */
export function trackEvent(
  userId: string | null,
  name: EventName,
  properties?: EventProperties,
): void {
  void recordEvent(userId, name, properties);
}
