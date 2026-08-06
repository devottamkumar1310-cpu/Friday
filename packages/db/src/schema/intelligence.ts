import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { goals } from './curriculum';
import { users } from './identity';
import { feasibilityVerdict } from './planning';

/**
 * Intelligence tables — DATABASE_DESIGN §4.7.
 *
 * `directives` and its three enums are **deferred to Phase 4** (Proactivity),
 * following the precedent set in Phase 0 and Phase 1: a migration introduces
 * the tables the phase actually needs. Nothing here blocks that addition.
 */

export const insightType = pgEnum('insight_type', [
  'weakness',
  'strength',
  'trend',
  'risk',
  'milestone',
  'root_cause',
  'recommendation',
]);

/** Daily rollup, so trend charts are O(days) rather than O(events) (§10). */
export const progressSnapshots = pgTable(
  'progress_snapshots',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    /** Exam-weight-weighted mastery — **not** percentage of tasks completed. */
    weightedProgress: numeric('weighted_progress', { precision: 5, scale: 4 }).notNull(),
    conceptsMastered: integer('concepts_mastered').notNull().default(0),
    conceptsTotal: integer('concepts_total').notNull(),
    minutesStudied: integer('minutes_studied').notNull().default(0),
    accuracyRate: numeric('accuracy_rate', { precision: 4, scale: 3 }),
    adherenceRate: numeric('adherence_rate', { precision: 4, scale: 3 }),
    verdict: feasibilityVerdict('verdict'),
    projectedCompletionDate: date('projected_completion_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('snapshots_goal_date_key').on(t.goalId, t.snapshotDate),
    index('snapshots_goal_date_idx').on(t.goalId, t.snapshotDate),
  ],
);

export const insights = pgTable(
  'insights',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
    type: insightType('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: smallint('severity').notNull().default(2),
    conceptIds: uuid('concept_ids')
      .array()
      .default(sql`'{}'::uuid[]`),
    /**
     * The data that justifies the claim — **mandatory**. An insight FRIDAY
     * cannot source is an insight it should not state (§4.7).
     */
    evidence: jsonb('evidence').notNull(),
    isDismissed: boolean('is_dismissed').notNull().default(false),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('insights_user_active_idx')
      .on(t.userId, t.createdAt)
      .where(sql`not ${t.isDismissed}`),
  ],
);

export type ProgressSnapshotRow = typeof progressSnapshots.$inferSelect;
export type NewProgressSnapshotRow = typeof progressSnapshots.$inferInsert;
export type InsightRow = typeof insights.$inferSelect;
export type NewInsightRow = typeof insights.$inferInsert;
