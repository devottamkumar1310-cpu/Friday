import { and, asc, desc, eq } from 'drizzle-orm';
import {
  coachMessages,
  coachThreads,
  type CoachMessageRow,
  type CoachThreadRow,
  type NewCoachMessageRow,
  type NewCoachThreadRow,
} from '../schema/coach';
import type { Executor } from './executor';

/** Coach threads and messages — DATABASE_DESIGN §4.8. */
export function coachRepository(db: Executor) {
  return {
    async createThread(input: NewCoachThreadRow): Promise<CoachThreadRow> {
      const [row] = await db.insert(coachThreads).values(input).returning();
      if (!row) throw new Error('Insert into coach_threads returned no row.');
      return row;
    },

    async findThread(userId: string, threadId: string): Promise<CoachThreadRow | undefined> {
      const [row] = await db
        .select()
        .from(coachThreads)
        .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)))
        .limit(1);
      return row;
    },

    async listThreads(userId: string): Promise<CoachThreadRow[]> {
      return db
        .select()
        .from(coachThreads)
        .where(and(eq(coachThreads.userId, userId), eq(coachThreads.isArchived, false)))
        .orderBy(desc(coachThreads.lastMessageAt));
    },

    async archiveThread(userId: string, threadId: string): Promise<void> {
      await db
        .update(coachThreads)
        .set({ isArchived: true })
        .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)));
    },

    async setThreadTitle(userId: string, threadId: string, title: string): Promise<void> {
      await db
        .update(coachThreads)
        .set({ title })
        .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)));
    },

    async touchThread(userId: string, threadId: string): Promise<void> {
      await db
        .update(coachThreads)
        .set({ lastMessageAt: new Date() })
        .where(and(eq(coachThreads.id, threadId), eq(coachThreads.userId, userId)));
    },

    async appendMessage(input: NewCoachMessageRow): Promise<CoachMessageRow> {
      const [row] = await db.insert(coachMessages).values(input).returning();
      if (!row) throw new Error('Insert into coach_messages returned no row.');
      return row;
    },

    async listMessages(userId: string, threadId: string): Promise<CoachMessageRow[]> {
      return db
        .select()
        .from(coachMessages)
        .where(and(eq(coachMessages.threadId, threadId), eq(coachMessages.userId, userId)))
        .orderBy(asc(coachMessages.createdAt));
    },
  };
}

export type CoachRepository = ReturnType<typeof coachRepository>;
