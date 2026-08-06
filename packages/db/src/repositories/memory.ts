import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  learnerFacts,
  masteryStates,
  memoryStates,
  type LearnerFactRow,
  type MasteryStateRow,
  type MemoryStateRow,
  type NewLearnerFactRow,
} from '../schema/memory';
import type { Executor } from './executor';

/**
 * `mastery_states` and `memory_states` — DATABASE_DESIGN §4.6. Derived,
 * materialised state. `core/mastery` and `core/retention` compute the new
 * values; this repository only persists them (SYSTEM_ARCHITECTURE A3).
 */
export function memoryRepository(db: Executor) {
  return {
    async getMasteryState(userId: string, conceptId: string): Promise<MasteryStateRow | undefined> {
      const [row] = await db
        .select()
        .from(masteryStates)
        .where(and(eq(masteryStates.userId, userId), eq(masteryStates.conceptId, conceptId)))
        .limit(1);
      return row;
    },

    async listMasteryStates(userId: string, conceptIds: string[]): Promise<MasteryStateRow[]> {
      if (conceptIds.length === 0) return [];
      return db
        .select()
        .from(masteryStates)
        .where(and(eq(masteryStates.userId, userId), inArray(masteryStates.conceptId, conceptIds)));
    },

    async upsertMasteryState(row: typeof masteryStates.$inferInsert): Promise<MasteryStateRow> {
      const [result] = await db
        .insert(masteryStates)
        .values(row)
        .onConflictDoUpdate({
          target: [masteryStates.userId, masteryStates.conceptId],
          set: {
            mastery: row.mastery,
            confidence: row.confidence,
            evidenceCount: row.evidenceCount,
            distinctSources: row.distinctSources,
            outcomeVariance: row.outcomeVariance,
            totalMinutes: row.totalMinutes,
            accuracyRate: row.accuracyRate,
            firstStudiedAt: row.firstStudiedAt,
            lastEvidenceAt: row.lastEvidenceAt,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!result) throw new Error('Upsert into mastery_states returned no row.');
      return result;
    },

    async getMemoryState(userId: string, conceptId: string): Promise<MemoryStateRow | undefined> {
      const [row] = await db
        .select()
        .from(memoryStates)
        .where(and(eq(memoryStates.userId, userId), eq(memoryStates.conceptId, conceptId)))
        .limit(1);
      return row;
    },

    async listMemoryStates(userId: string, conceptIds: string[]): Promise<MemoryStateRow[]> {
      if (conceptIds.length === 0) return [];
      return db
        .select()
        .from(memoryStates)
        .where(and(eq(memoryStates.userId, userId), inArray(memoryStates.conceptId, conceptIds)));
    },

    async listAllMemoryStates(userId: string): Promise<MemoryStateRow[]> {
      return db.select().from(memoryStates).where(eq(memoryStates.userId, userId));
    },

    async upsertMemoryState(row: typeof memoryStates.$inferInsert): Promise<MemoryStateRow> {
      const [result] = await db
        .insert(memoryStates)
        .values(row)
        .onConflictDoUpdate({
          target: [memoryStates.userId, memoryStates.conceptId],
          set: {
            stability: row.stability,
            difficulty: row.difficulty,
            elapsedDays: row.elapsedDays,
            scheduledDays: row.scheduledDays,
            reps: row.reps,
            lapses: row.lapses,
            state: row.state,
            lastReviewAt: row.lastReviewAt,
            dueAt: row.dueAt,
          },
        })
        .returning();
      if (!result) throw new Error('Upsert into memory_states returned no row.');
      return result;
    },
  };
}

export type MemoryRepository = ReturnType<typeof memoryRepository>;

/**
 * Reflective memory (FR-7.4, FR-7.6) — DATABASE_DESIGN §4.6.
 *
 * Deletion is honoured immediately and for real: a learner who tells FRIDAY to
 * forget a belief about them should not find it archived-but-present.
 */
export function learnerFactsRepository(db: Executor) {
  return {
    async create(row: NewLearnerFactRow): Promise<LearnerFactRow> {
      const [result] = await db.insert(learnerFacts).values(row).returning();
      if (!result) throw new Error('Insert into learner_facts returned no row.');
      return result;
    },

    async list(userId: string, category?: LearnerFactRow['category']): Promise<LearnerFactRow[]> {
      const conditions = [eq(learnerFacts.userId, userId), eq(learnerFacts.isArchived, false)];
      if (category) conditions.push(eq(learnerFacts.category, category));
      return db
        .select()
        .from(learnerFacts)
        .where(and(...conditions))
        .orderBy(desc(learnerFacts.confidence));
    },

    async update(
      userId: string,
      factId: string,
      patch: Partial<Pick<LearnerFactRow, 'statement' | 'confidence' | 'isArchived'>>,
    ): Promise<LearnerFactRow | undefined> {
      const [row] = await db
        .update(learnerFacts)
        .set({ ...patch, isUserEdited: true })
        .where(and(eq(learnerFacts.id, factId), eq(learnerFacts.userId, userId)))
        .returning();
      return row;
    },

    /** Hard delete — FR-7.6 says honoured immediately, so it is not a soft flag. */
    async remove(userId: string, factId: string): Promise<boolean> {
      const deleted = await db
        .delete(learnerFacts)
        .where(and(eq(learnerFacts.id, factId), eq(learnerFacts.userId, userId)))
        .returning({ id: learnerFacts.id });
      return deleted.length > 0;
    },
  };
}

export type LearnerFactsRepository = ReturnType<typeof learnerFactsRepository>;
