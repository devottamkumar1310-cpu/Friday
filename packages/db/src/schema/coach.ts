import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../ids';
import { goals } from './curriculum';
import { users } from './identity';
import { aiCalls } from './platform';

/** Coach tables — DATABASE_DESIGN §4.8. */

export const coachThreads = pgTable(
  'coach_threads',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    /** Auto-generated at the haiku tier once the thread has content. */
    title: text('title'),
    conceptIds: uuid('concept_ids')
      .array()
      .default(sql`'{}'::uuid[]`),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('coach_threads_user_idx').on(t.userId, t.lastMessageAt)],
);

export const coachMessages = pgTable(
  'coach_messages',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => coachThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'user' | 'assistant' | 'tool'. */
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'),
    /**
     * The exact context the model saw, so a bad answer is reproducible rather
     * than guessed at (§5.4).
     */
    contextPacketRef: uuid('context_packet_ref').references(() => aiCalls.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('coach_messages_thread_idx').on(t.threadId, t.createdAt)],
);

export type CoachThreadRow = typeof coachThreads.$inferSelect;
export type NewCoachThreadRow = typeof coachThreads.$inferInsert;
export type CoachMessageRow = typeof coachMessages.$inferSelect;
export type NewCoachMessageRow = typeof coachMessages.$inferInsert;
