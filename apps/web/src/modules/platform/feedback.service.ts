import { getDb, productRepository, type FeedbackRow, type UserRow } from '@friday/db';
import { logger } from '@friday/observability';
import { EVENTS, trackEvent } from './analytics.service';

/**
 * Learner feedback — CR-007.
 *
 * The roadmap's private-beta plan calls for a feedback channel with daily
 * triage. Without one in the product, feedback arrives as messages to whoever
 * the learner happens to know, which is not a channel and does not survive
 * more than a handful of users.
 *
 * The message is free text a learner typed, which makes it untrusted input
 * forever: it is stored verbatim, rendered as text, and must never be
 * concatenated into a model prompt without `wrapUntrusted`.
 */

export const FEEDBACK_KINDS = ['bug', 'confusing', 'idea', 'praise', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  message: string;
  path?: string;
}

export interface FeedbackRecord {
  id: string;
  kind: string;
  message: string;
  path: string | null;
  status: string;
  createdAt: string;
}

/**
 * Strips a path down to its route.
 *
 * A learner reporting a problem on `/study/018f…` tells us the study screen is
 * involved; the id tells us nothing extra and links the report to a specific
 * task row. Query strings are dropped entirely — they are the likeliest place
 * for something personal to hide.
 */
export function normalisePath(path: string | undefined): string | null {
  if (!path) return null;
  const [withoutQuery] = path.split('?');
  if (!withoutQuery?.startsWith('/')) return null;
  return withoutQuery
    .split('/')
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
        ? ':id'
        : segment,
    )
    .join('/')
    .slice(0, 120);
}

export async function submitFeedback(
  user: UserRow,
  input: SubmitFeedbackInput,
): Promise<FeedbackRecord> {
  const row = await productRepository(getDb()).submitFeedback({
    userId: user.id,
    kind: input.kind,
    message: input.message.trim(),
    path: normalisePath(input.path),
  });

  logger.info('feedback submitted', { kind: row.kind, path: row.path });
  trackEvent(user.id, EVENTS.feedbackSubmitted, { kind: row.kind });

  return toWire(row);
}

/** A learner's own submissions, so the form can confirm it went somewhere. */
export async function listOwnFeedback(user: UserRow): Promise<FeedbackRecord[]> {
  const rows = await productRepository(getDb()).listFeedbackFor(user.id);
  return rows.map(toWire);
}

function toWire(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    path: row.path,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
