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
import { canonicalConcepts, goals } from './curriculum';
import { users } from './identity';

/**
 * Assessment tables — DATABASE_DESIGN §4.5.
 *
 * `questions` and `question_concept_keys` are **shared across every learner**
 * and carry no `user_id` — that is the point. Generated content is expensive,
 * and reusing it across learners keyed by `concept_key` is one of five controls
 * holding AI spend to $0.60/user/month (NFR-4.5). Per-learner state lives in
 * `question_exposures` instead.
 */

export const questionType = pgEnum('question_type', [
  'mcq_single',
  'mcq_multi',
  'short_answer',
  'numeric',
  'true_false',
]);

export const questionStatus = pgEnum('question_status', [
  'draft',
  'active',
  'quarantined',
  'retired',
]);

export const assessmentType = pgEnum('assessment_type', [
  'diagnostic',
  'practice_set',
  'topic_quiz',
  'mock_test',
]);

/** SHARED across users — no `user_id` anywhere on this table (the cost lever). */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    /** The primary concept tested. Canonical vocabulary only (ADR-016). */
    conceptKey: text('concept_key')
      .notNull()
      .references(() => canonicalConcepts.key),
    type: questionType('type').notNull(),
    status: questionStatus('status').notNull().default('draft'),
    difficulty: smallint('difficulty').notNull(),
    stem: text('stem').notNull(),
    options: jsonb('options'),
    correctAnswer: jsonb('correct_answer').notNull(),
    explanation: text('explanation').notNull(),
    /** For LLM grading of open responses. Null for deterministically-graded types. */
    rubric: jsonb('rubric'),
    generationMeta: jsonb('generation_meta'),
    qualityScore: numeric('quality_score', { precision: 3, scale: 2 }),
    timesServed: integer('times_served').notNull().default(0),
    timesCorrect: integer('times_correct').notNull().default(0),
    reportedCount: integer('reported_count').notNull().default(0),
    /** Observed difficulty, reserved for future IRT calibration (ADR-009). */
    irtDifficulty: numeric('irt_difficulty', { precision: 5, scale: 3 }),
    irtDiscrimination: numeric('irt_discrimination', { precision: 5, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('questions_lookup_idx')
      .on(t.conceptKey, t.difficulty, t.status)
      .where(sql`${t.status} = 'active'`),
    check('questions_difficulty_range', sql`${t.difficulty} between 1 and 5`),
  ],
);

/** A question may test more than one concept. SHARED — canonical keys only. */
export const questionConceptKeys = pgTable(
  'question_concept_keys',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    conceptKey: text('concept_key')
      .notNull()
      .references(() => canonicalConcepts.key),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.conceptKey] })],
);

/** Per-learner exposure, so the same question is not served twice. */
export const questionExposures = pgTable(
  'question_exposures',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    timesSeen: integer('times_seen').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index('exposures_user_idx').on(t.userId, t.lastSeenAt),
  ],
);

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    type: assessmentType('type').notNull(),
    title: text('title').notNull(),
    conceptIds: uuid('concept_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    timeLimitSeconds: integer('time_limit_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assessments_user_goal_idx').on(t.userId, t.goalId)],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    score: numeric('score', { precision: 5, scale: 2 }),
    maxScore: numeric('max_score', { precision: 5, scale: 2 }),
    /** Per-concept accuracy, the input to the post-attempt mastery update. */
    conceptBreakdown: jsonb('concept_breakdown'),
    timeSpentSeconds: integer('time_spent_seconds'),
  },
  (t) => [index('attempts_user_idx').on(t.userId, t.startedAt)],
);

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    /** Denormalised for repository scoping (D2). No FK, matching the frozen DDL. */
    userId: uuid('user_id').notNull(),
    answer: jsonb('answer').notNull(),
    isCorrect: boolean('is_correct'),
    score: numeric('score', { precision: 5, scale: 2 }),
    /** 'deterministic' | 'llm_rubric'. */
    gradingMethod: text('grading_method'),
    graderFeedback: text('grader_feedback'),
    responseMs: integer('response_ms'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('responses_attempt_idx').on(t.attemptId)],
);

export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;
export type QuestionConceptKeyRow = typeof questionConceptKeys.$inferSelect;
export type QuestionExposureRow = typeof questionExposures.$inferSelect;
export type AssessmentRow = typeof assessments.$inferSelect;
export type NewAssessmentRow = typeof assessments.$inferInsert;
export type AttemptRow = typeof attempts.$inferSelect;
export type NewAttemptRow = typeof attempts.$inferInsert;
export type ResponseRow = typeof responses.$inferSelect;
export type NewResponseRow = typeof responses.$inferInsert;
