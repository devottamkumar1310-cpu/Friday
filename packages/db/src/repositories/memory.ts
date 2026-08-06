import { and, eq, inArray } from 'drizzle-orm';
import {
  masteryStates,
  memoryStates,
  type MasteryStateRow,
  type MemoryStateRow,
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
