import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { concepts } from './curriculum';
import { users } from './identity';

/**
 * Learning-memory tables — DATABASE_DESIGN §4.6. Derived, materialised state:
 * the engine's working memory of what a learner knows (`mastery_states`), when
 * they'll forget it (`memory_states`, FSRS-5), and what it has come to believe
 * about them (`learner_facts`).
 *
 * `memory_chunks` is **deferred to Phase 3** — it is the only object in the
 * whole schema requiring pgvector (D11), and semantic retrieval is not a Phase 2
 * deliverable.
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

export const factCategory = pgEnum('fact_category', [
  'learning_style',
  'misconception',
  'strength',
  'weakness',
  'preference',
  'constraint',
  'motivation',
  'goal_context',
]);

/**
 * Reflective memory (FR-7.4) — what FRIDAY believes about this learner.
 *
 * `evidence_refs` is `NOT NULL` and every write must populate it: a belief the
 * system cannot source is a belief it should not hold. That is enforced at the
 * schema level rather than by prompt instruction (§5.8).
 */
export const learnerFacts = pgTable(
  'learner_facts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: factCategory('category').notNull(),
    /** Human-readable and user-editable — the learner can correct it (FR-7.6). */
    statement: text('statement').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('0.5'),
    evidenceRefs: jsonb('evidence_refs')
      .notNull()
      .default(sql`'[]'::jsonb`),
    conceptIds: uuid('concept_ids')
      .array()
      .default(sql`'{}'::uuid[]`),
    reinforcementCount: integer('reinforcement_count').notNull().default(1),
    lastReinforcedAt: timestamp('last_reinforced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    isUserEdited: boolean('is_user_edited').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('facts_user_conf_idx')
      .on(t.userId, t.confidence)
      .where(sql`not ${t.isArchived}`),
  ],
);

export type MasteryStateRow = typeof masteryStates.$inferSelect;
export type NewMasteryStateRow = typeof masteryStates.$inferInsert;
export type MemoryStateRow = typeof memoryStates.$inferSelect;
export type NewMemoryStateRow = typeof memoryStates.$inferInsert;
export type LearnerFactRow = typeof learnerFacts.$inferSelect;
export type NewLearnerFactRow = typeof learnerFacts.$inferInsert;
