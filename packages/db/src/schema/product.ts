import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { users } from './identity';

/**
 * Product telemetry and learner feedback — added for Launch Readiness (CR-007).
 *
 * Two append-only tables. Nothing existing changes, and nothing reads these on
 * a request path, so they cannot affect the learning loop.
 *
 * **Why not PostHog.** SYSTEM_ARCHITECTURE §2 names PostHog for product
 * analytics, and it remains the intended destination. It is not what ships at
 * launch: PostHog is a third-party browser script that sets identifiers, and
 * FRIDAY's learners are mostly 16–18, where India's DPDP Act requires
 * verifiable guardian consent. Shipping client-side tracking before the consent
 * surface that would govern it exists is the wrong order. These events are
 * recorded server-side from actions the learner has already taken, carry no
 * device or browser identity, and can be exported to PostHog later — the seam
 * is `recordEvent`, not the storage.
 */

/**
 * What happened, not who was watching.
 *
 * There is no session id, IP, user agent, or referrer here. The questions a
 * launch actually needs answered — do learners finish onboarding, does the loop
 * close, does anyone come back — are all answerable from a user id and a name.
 */
export const productEvents = pgTable(
  'product_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** Null once a learner is deleted: the count stays, the person does not. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dotted and past-tense, e.g. `session.completed`. See EVENTS in the service. */
    name: text('name').notNull(),
    /**
     * Small, non-identifying dimensions only — counts, enum values, durations.
     * Never free text a learner typed, and never anything a model generated.
     */
    properties: jsonb('properties').$type<Record<string, string | number | boolean>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('product_events_name_time_idx').on(table.name, table.occurredAt),
    index('product_events_user_idx').on(table.userId, table.occurredAt),
  ],
);

/** Unsolicited feedback from a learner. The private beta's feedback channel. */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 'bug' | 'idea' | 'confusing' | 'praise' | 'other'. */
    kind: text('kind').notNull(),
    /** What the learner wrote. Treated as untrusted input everywhere it is read. */
    message: text('message').notNull(),
    /** Where they were when they sent it — a path, never a full URL with a query. */
    path: text('path'),
    /** 'new' | 'triaged' | 'closed'. Moved by hand during the beta. */
    status: text('status').notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('feedback_status_idx').on(table.status, table.createdAt)],
);

export type ProductEventRow = typeof productEvents.$inferSelect;
export type NewProductEventRow = typeof productEvents.$inferInsert;
export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedbackRow = typeof feedback.$inferInsert;
