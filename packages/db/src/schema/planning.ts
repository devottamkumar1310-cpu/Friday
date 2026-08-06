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
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { concepts, goals } from './curriculum';
import { users } from './identity';

/**
 * Planning tables — DATABASE_DESIGN §4.3. Near-horizon materialisation
 * (ADR-014): a plan version materialises concrete `study_blocks`/`tasks` for
 * its `[window_start, window_end]` only; everything beyond lives in
 * `projection` as a coarse concept -> target-week mapping.
 */

export const planStatus = pgEnum('plan_status', ['active', 'superseded', 'archived']);
export const feasibilityVerdict = pgEnum('feasibility_verdict', [
  'on_track',
  'at_risk',
  'not_feasible',
]);
export const taskType = pgEnum('task_type', [
  'learn',
  'practice',
  'revise',
  'assess',
  'project',
  'break',
]);
export const taskStatus = pgEnum('task_status', [
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'rescheduled',
  'cancelled',
]);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: planStatus('status').notNull().default('active'),
    supersedesId: uuid('supersedes_id'),
    /** 'initial'|'nightly'|'drift'|'availability_change'|'user_request'|'scope_change'. */
    reason: text('reason').notNull(),
    reasonDetail: jsonb('reason_detail'),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    /** Beyond the window: concept -> target week + minutes. */
    projection: jsonb('projection').notNull(),
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
    verdict: feasibilityVerdict('verdict').notNull(),
    requiredMinutes: integer('required_minutes').notNull(),
    availableMinutes: integer('available_minutes').notNull(),
    slackMinutes: integer('slack_minutes').notNull(),
    projectedCompletionDate: date('projected_completion_date'),
    reliabilityFactor: numeric('reliability_factor', { precision: 4, scale: 3 })
      .notNull()
      .default('1.0'),
    /** What changed vs. the superseded plan, for "what changed" UI (§10.2 diff). */
    diffSummary: jsonb('diff_summary'),
    generatedBy: text('generated_by').notNull().default('scheduler_v1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plans_goal_version_key').on(t.goalId, t.version),
    uniqueIndex('plans_one_active')
      .on(t.goalId)
      .where(sql`${t.status} = 'active'`),
    index('plans_goal_active_idx')
      .on(t.goalId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const studyBlocks = pgTable(
  'study_blocks',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduledDate: date('scheduled_date').notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    plannedMinutes: integer('planned_minutes').notNull(),
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('study_blocks_user_date_idx').on(t.userId, t.scheduledDate)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    blockId: uuid('block_id').references(() => studyBlocks.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: taskType('type').notNull(),
    status: taskStatus('status').notNull().default('pending'),
    title: text('title').notNull(),
    estimatedMinutes: integer('estimated_minutes').notNull(),
    position: integer('position').notNull().default(0),
    /**
     * STRUCTURAL priority only (AI_DECISION_ENGINE §6.0) — {impact, urgency,
     * leverage, readiness, cost}. Volatile terms are never stored, and there
     * is deliberately no `rationale` column: the explanation is rendered at
     * request time from the live factor table (§12.2).
     */
    structuralScore: numeric('structural_score', { precision: 8, scale: 4 }),
    structuralFactors: jsonb('structural_factors'),
    scheduledDate: date('scheduled_date').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedReason: text('skipped_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_user_date_status_idx')
      .on(t.userId, t.scheduledDate, t.status)
      .where(sql`${t.status} in ('pending', 'in_progress')`),
    index('tasks_plan_idx').on(t.planId),
  ],
);

export const taskConcepts = pgTable(
  'task_concepts',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.conceptId] })],
);

export type PlanRow = typeof plans.$inferSelect;
export type NewPlanRow = typeof plans.$inferInsert;
export type StudyBlockRow = typeof studyBlocks.$inferSelect;
export type NewStudyBlockRow = typeof studyBlocks.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskConceptRow = typeof taskConcepts.$inferSelect;
