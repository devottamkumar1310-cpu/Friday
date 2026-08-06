import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { goals } from './curriculum';
import { users } from './identity';
import { tasks } from './planning';

/**
 * Execution tables — DATABASE_DESIGN §4.4.
 *
 * **Deviation from the frozen schema, reported per the Phase 0 working
 * agreement:** `study_sessions`, `evidence_events`, and `learning_events` are
 * specified as `PARTITION BY RANGE` (monthly, on their timestamp column).
 * Phase 1 ships them as ordinary tables — the append-only shape, columns, and
 * indexes are otherwise exact. Partitioning is an operational scaling
 * concern (D7; needed at the "<10k DAU" stage per DATABASE_DESIGN §10) with
 * no bearing on the domain engine's correctness, and retrofitting it later is
 * an additive migration, not a redesign. Flagged here rather than silently
 * dropped — see PHASE_1_REPORT.md.
 */

export const sessionStatus = pgEnum('session_status', [
  'active',
  'paused',
  'completed',
  'abandoned',
]);
export const evidenceSource = pgEnum('evidence_source', [
  'self_rating',
  'question_response',
  'assessment',
  'coach_check',
  'inferred',
]);
export const fsrsRating = pgEnum('fsrs_rating', ['again', 'hard', 'good', 'easy']);

export const studySessions = pgTable(
  'study_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    status: sessionStatus('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    plannedMinutes: integer('planned_minutes'),
    activeMinutes: integer('active_minutes').notNull().default(0),
    pausedSeconds: integer('paused_seconds').notNull().default(0),
    focusScore: numeric('focus_score', { precision: 3, scale: 2 }),
    selfRating: fsrsRating('self_rating'),
    notes: text('notes'),
    /** 'recommendation'|'plan'|'manual'|'directive' — powers the North Star metric. */
    originatedFrom: text('originated_from'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('study_sessions_user_start_idx').on(t.userId, t.startedAt)],
);

/** Every signal that legitimately moves mastery — the input to the learning engine. */
export const evidenceEvents = pgTable(
  'evidence_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id').notNull(),
    conceptId: uuid('concept_id').notNull(),
    sessionId: uuid('session_id'),
    source: evidenceSource('source').notNull(),
    outcome: numeric('outcome', { precision: 4, scale: 3 }).notNull(),
    difficulty: smallint('difficulty'),
    responseMs: integer('response_ms'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('1.0'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('evidence_events_user_concept_time_idx').on(t.userId, t.conceptId, t.occurredAt)],
);

/** Immutable audit + replay log. Nothing is ever updated or deleted here (D3). */
export const learningEvents = pgTable(
  'learning_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id').notNull(),
    goalId: uuid('goal_id'),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    payload: jsonb('payload').notNull(),
    requestId: text('request_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_events_user_time_idx').on(t.userId, t.occurredAt)],
);

export type StudySessionRow = typeof studySessions.$inferSelect;
export type NewStudySessionRow = typeof studySessions.$inferInsert;
export type EvidenceEventRow = typeof evidenceEvents.$inferSelect;
export type NewEvidenceEventRow = typeof evidenceEvents.$inferInsert;
export type LearningEventRow = typeof learningEvents.$inferSelect;
export type NewLearningEventRow = typeof learningEvents.$inferInsert;
