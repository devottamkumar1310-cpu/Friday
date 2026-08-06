import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { concepts } from './curriculum';
import { users } from './identity';

/**
 * Learning-memory tables — DATABASE_DESIGN §4.6. Derived, materialised state:
 * the engine's working memory of what a learner knows (`mastery_states`) and
 * when they'll forget it (`memory_states`, FSRS-5).
 */

/** One row per (user, concept). The engine's working state. */
export const masteryStates = pgTable(
  'mastery_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    mastery: numeric('mastery', { precision: 4, scale: 3 }).notNull().default('0'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0'),
    evidenceCount: integer('evidence_count').notNull().default(0),
    distinctSources: integer('distinct_sources').notNull().default(0),
    outcomeVariance: numeric('outcome_variance', { precision: 4, scale: 3 }).notNull().default('0'),
    totalMinutes: integer('total_minutes').notNull().default(0),
    accuracyRate: numeric('accuracy_rate', { precision: 4, scale: 3 }),
    firstStudiedAt: timestamp('first_studied_at', { withTimezone: true }),
    lastEvidenceAt: timestamp('last_evidence_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.conceptId] }),
    check('mastery_states_mastery_range', sql`${t.mastery} between 0 and 1`),
  ],
);

/** FSRS-5. The ONLY source of revision scheduling. `retrievability` is computed, never stored. */
export const memoryStates = pgTable(
  'memory_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    stability: numeric('stability', { precision: 10, scale: 4 }).notNull().default('0'),
    difficulty: numeric('difficulty', { precision: 6, scale: 4 }).notNull().default('5'),
    elapsedDays: integer('elapsed_days').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    /** 0 new, 1 learning, 2 review, 3 relearning. */
    state: smallint('state').notNull().default(0),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.conceptId] })],
);

export type MasteryStateRow = typeof masteryStates.$inferSelect;
export type NewMasteryStateRow = typeof masteryStates.$inferInsert;
export type MemoryStateRow = typeof memoryStates.$inferSelect;
export type NewMemoryStateRow = typeof memoryStates.$inferInsert;
