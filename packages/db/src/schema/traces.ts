import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { goals } from './curriculum';
import { users } from './identity';

/**
 * `decision_traces` — AI_DECISION_ENGINE §13.1. Per DP10: no decision reaches
 * a learner without a durable trace of the inputs, candidates, scores,
 * configuration, and confidence that produced it (I-10).
 *
 * **Deviation, reported per the Phase 0 working agreement:** specified as
 * `PARTITION BY RANGE (computed_at)` (monthly). Shipped here as an ordinary
 * table for the same reason as `execution.ts` — see PHASE_1_REPORT.md.
 */

export const decisionType = pgEnum('decision_type', [
  'next_action',
  'plan_generation',
  'revision_schedule',
  'feasibility',
  'diagnosis',
  'directive',
  'assessment_selection',
  'scope_triage',
]);

export const decisionTraces = pgTable(
  'decision_traces',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
    type: decisionType('type').notNull(),

    engineVersion: text('engine_version').notNull(),
    configVersion: text('config_version').notNull(),
    inputSnapshotHash: text('input_snapshot_hash').notNull(),
    inputSnapshot: jsonb('input_snapshot'),

    candidates: jsonb('candidates').notNull(),
    excluded: jsonb('excluded'),
    selectedEntityId: uuid('selected_entity_id'),
    selectedScore: numeric('selected_score', { precision: 10, scale: 4 }),
    modifiersApplied: jsonb('modifiers_applied'),
    constraintsRelaxed: text('constraints_relaxed').array(),

    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    confidenceInputs: jsonb('confidence_inputs').notNull(),
    dominantFactor: text('dominant_factor'),
    explanation: jsonb('explanation'),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    latencyMs: integer('latency_ms'),
    cacheHit: boolean('cache_hit').notNull().default(false),
    requestId: text('request_id'),
    supersededBy: uuid('superseded_by'),
  },
  (t) => [
    index('decision_traces_user_type_time_idx').on(t.userId, t.type, t.computedAt),
    index('decision_traces_request_idx').on(t.requestId),
  ],
);

export type DecisionTraceRow = typeof decisionTraces.$inferSelect;
export type NewDecisionTraceRow = typeof decisionTraces.$inferInsert;
