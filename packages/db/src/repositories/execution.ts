import { and, desc, eq } from 'drizzle-orm';
import {
  evidenceEvents,
  learningEvents,
  studySessions,
  type NewEvidenceEventRow,
  type NewLearningEventRow,
  type NewStudySessionRow,
  type StudySessionRow,
} from '../schema/execution';
import type { Executor } from './executor';

/** Sessions and the evidence/event logs — DATABASE_DESIGN §4.4. */
export function executionRepository(db: Executor) {
  return {
    async createSession(input: NewStudySessionRow): Promise<StudySessionRow> {
      const [row] = await db.insert(studySessions).values(input).returning();
      if (!row) throw new Error('Insert into study_sessions returned no row.');
      return row;
    },

    async findActiveSession(userId: string): Promise<StudySessionRow | undefined> {
      const [row] = await db
        .select()
        .from(studySessions)
        .where(and(eq(studySessions.userId, userId), eq(studySessions.status, 'active')))
        .limit(1);
      return row;
    },

    async findSession(userId: string, sessionId: string): Promise<StudySessionRow | undefined> {
      const [row] = await db
        .select()
        .from(studySessions)
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Reads a session and holds a row lock until the enclosing transaction ends.
     *
     * `findSession` is an ordinary SELECT, so two concurrent completions of the
     * same session both read `status = 'active'`, both passed the guard, and
     * both committed — measured: two evidence events and two mastery updates
     * from one sitting. The guard was never wrong, it was just not atomic; a
     * double-tapped Finish button was enough to inflate the learner's mastery.
     *
     * `FOR UPDATE` makes the loser block until the winner commits, at which
     * point it re-reads `status = 'completed'` and the existing guard rejects it
     * correctly. Must be called inside a transaction to mean anything.
     */
    async findSessionForUpdate(
      userId: string,
      sessionId: string,
    ): Promise<StudySessionRow | undefined> {
      const [row] = await db
        .select()
        .from(studySessions)
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
        .limit(1)
        .for('update');
      return row;
    },

    async completeSession(
      userId: string,
      sessionId: string,
      patch: Pick<StudySessionRow, 'activeMinutes' | 'notes' | 'selfRating'> & { endedAt: Date },
    ): Promise<StudySessionRow | undefined> {
      const [row] = await db
        .update(studySessions)
        .set({ ...patch, status: 'completed' })
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
        .returning();
      return row;
    },

    async abandonSession(userId: string, sessionId: string): Promise<void> {
      await db
        .update(studySessions)
        .set({ status: 'abandoned', endedAt: new Date() })
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)));
    },

    async recentSessions(userId: string, limit = 5): Promise<StudySessionRow[]> {
      return db
        .select()
        .from(studySessions)
        .where(eq(studySessions.userId, userId))
        .orderBy(desc(studySessions.startedAt))
        .limit(limit);
    },

    async insertEvidence(rows: NewEvidenceEventRow[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(evidenceEvents).values(rows);
    },

    async insertLearningEvent(row: NewLearningEventRow): Promise<void> {
      await db.insert(learningEvents).values(row);
    },
  };
}

export type ExecutionRepository = ReturnType<typeof executionRepository>;
