import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { users } from './identity';

/**
 * Platform tables — DATABASE_DESIGN §4.9.
 *
 * Scoped to what Phase 2 actually needs: `ai_calls` (NFR-7.4 — every model
 * interaction is logged and replayable), `usage_counters` (§5.3 cost control
 * #4, the per-user budget ceiling), and `feature_flags` (the Coach is a risky
 * subsystem and ships behind a toggle, per the release plan). `audit_log` is
 * deferred to Phase 4 with the admin console it exists to serve.
 *
 * **Deviation, consistent with Phase 1:** `ai_calls` is specified as monthly
 * `PARTITION BY RANGE (created_at)`. It ships here as an ordinary table for the
 * same reason the Phase 1 log tables did — see PHASE_1_REPORT.md D-6 and the
 * changelog's deferred-items ledger.
 */

/** Every model interaction. The substrate for replay, cost control, and evals. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'curriculum_architect' | 'coach' | 'content_generator' | … */
    agent: text('agent').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedTokens: integer('cached_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms'),
    /** 'ok' | 'validation_failed' | 'repaired' | 'fallback' | 'error'. */
    status: text('status').notNull(),
    /** Redacted. Reproducing a bad response means replaying this packet (§5.4). */
    contextPacket: jsonb('context_packet'),
    error: text('error'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_calls_user_time_idx').on(t.userId, t.createdAt)],
);

/** Cost governance (FR-12.3). One row per user per month bucket. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    period: date('period').notNull(),
    aiCostUsd: numeric('ai_cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    aiCalls: integer('ai_calls').notNull().default(0),
    tokensIn: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
    tokensOut: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  isEnabled: boolean('is_enabled').notNull().default(false),
  rolloutPercentage: smallint('rollout_percentage').notNull().default(0),
  userAllowlist: uuid('user_allowlist')
    .array()
    .default(sql`'{}'::uuid[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AiCallRow = typeof aiCalls.$inferSelect;
export type NewAiCallRow = typeof aiCalls.$inferInsert;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
