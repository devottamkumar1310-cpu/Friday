import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  assessments,
  attempts,
  questionConceptKeys,
  questionExposures,
  questions,
  responses,
  type AssessmentRow,
  type AttemptRow,
  type NewAssessmentRow,
  type NewAttemptRow,
  type NewQuestionRow,
  type NewResponseRow,
  type QuestionRow,
  type ResponseRow,
} from '../schema/assessment';
import type { Executor } from './executor';

/**
 * Assessment repository — DATABASE_DESIGN §4.5.
 *
 * Split deliberately in two. The **question bank** is shared content keyed by
 * canonical concept, so its methods take no `userId` — there is no such thing
 * as "my" question. Everything a learner *does* with a question (exposure,
 * attempt, response) is user-scoped as usual (NFR-3.3).
 */
export function questionBankRepository(db: Executor) {
  return {
    async insertMany(rows: NewQuestionRow[]): Promise<QuestionRow[]> {
      if (rows.length === 0) return [];
      return db.insert(questions).values(rows).returning();
    },

    async linkConceptKeys(rows: (typeof questionConceptKeys.$inferInsert)[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(questionConceptKeys).values(rows).onConflictDoNothing();
    },

    async findById(questionId: string): Promise<QuestionRow | undefined> {
      const [row] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
      return row;
    },

    async findByIds(questionIds: string[]): Promise<QuestionRow[]> {
      if (questionIds.length === 0) return [];
      return db.select().from(questions).where(inArray(questions.id, questionIds));
    },

    /**
     * The cache lookup that makes generated content pay for itself: active
     * questions for a concept at a difficulty, excluding anything this learner
     * has already been shown.
     */
    async findUnseenForConcept(
      userId: string,
      conceptKey: string,
      difficulty: number,
      limit: number,
    ): Promise<QuestionRow[]> {
      const seen = db
        .select({ questionId: questionExposures.questionId })
        .from(questionExposures)
        .where(eq(questionExposures.userId, userId));

      return db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.conceptKey, conceptKey),
            eq(questions.difficulty, difficulty),
            eq(questions.status, 'active'),
            notInArray(questions.id, seen),
          ),
        )
        .limit(limit);
    },

    async recordExposures(userId: string, questionIds: string[]): Promise<void> {
      if (questionIds.length === 0) return;
      await db
        .insert(questionExposures)
        .values(questionIds.map((questionId) => ({ userId, questionId })))
        .onConflictDoUpdate({
          target: [questionExposures.userId, questionExposures.questionId],
          set: {
            timesSeen: sql`${questionExposures.timesSeen} + 1`,
            lastSeenAt: new Date(),
          },
        });
    },

    async recordServed(questionIds: string[], correctIds: string[]): Promise<void> {
      if (questionIds.length === 0) return;
      await db
        .update(questions)
        .set({ timesServed: sql`${questions.timesServed} + 1` })
        .where(inArray(questions.id, questionIds));
      if (correctIds.length > 0) {
        await db
          .update(questions)
          .set({ timesCorrect: sql`${questions.timesCorrect} + 1` })
          .where(inArray(questions.id, correctIds));
      }
    },

    /** User-reported bad question → quarantine (§5.7, guardrails table). */
    async report(questionId: string): Promise<void> {
      await db
        .update(questions)
        .set({
          reportedCount: sql`${questions.reportedCount} + 1`,
          status: sql`case when ${questions.reportedCount} + 1 >= 3 then 'quarantined'::question_status else ${questions.status} end`,
        })
        .where(eq(questions.id, questionId));
    },
  };
}

export function assessmentRepository(db: Executor) {
  return {
    async create(input: NewAssessmentRow): Promise<AssessmentRow> {
      const [row] = await db.insert(assessments).values(input).returning();
      if (!row) throw new Error('Insert into assessments returned no row.');
      return row;
    },

    async findById(userId: string, assessmentId: string): Promise<AssessmentRow | undefined> {
      const [row] = await db
        .select()
        .from(assessments)
        .where(and(eq(assessments.id, assessmentId), eq(assessments.userId, userId)))
        .limit(1);
      return row;
    },

    async createAttempt(input: NewAttemptRow): Promise<AttemptRow> {
      const [row] = await db.insert(attempts).values(input).returning();
      if (!row) throw new Error('Insert into attempts returned no row.');
      return row;
    },

    async findAttempt(userId: string, attemptId: string): Promise<AttemptRow | undefined> {
      const [row] = await db
        .select()
        .from(attempts)
        .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)))
        .limit(1);
      return row;
    },

    async submitAttempt(
      userId: string,
      attemptId: string,
      patch: Pick<AttemptRow, 'score' | 'maxScore' | 'conceptBreakdown' | 'timeSpentSeconds'>,
    ): Promise<AttemptRow | undefined> {
      const [row] = await db
        .update(attempts)
        .set({ ...patch, submittedAt: new Date() })
        .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)))
        .returning();
      return row;
    },

    async recentAttempts(userId: string, limit = 3): Promise<AttemptRow[]> {
      return db
        .select()
        .from(attempts)
        .where(eq(attempts.userId, userId))
        .orderBy(desc(attempts.startedAt))
        .limit(limit);
    },

    async insertResponse(input: NewResponseRow): Promise<ResponseRow> {
      const [row] = await db.insert(responses).values(input).returning();
      if (!row) throw new Error('Insert into responses returned no row.');
      return row;
    },

    async listResponses(userId: string, attemptId: string): Promise<ResponseRow[]> {
      return db
        .select()
        .from(responses)
        .where(and(eq(responses.attemptId, attemptId), eq(responses.userId, userId)));
    },
  };
}

export type QuestionBankRepository = ReturnType<typeof questionBankRepository>;
export type AssessmentRepository = ReturnType<typeof assessmentRepository>;
