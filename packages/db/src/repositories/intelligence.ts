import { and, desc, eq, gte } from 'drizzle-orm';
import {
  insights,
  progressSnapshots,
  type InsightRow,
  type NewInsightRow,
  type NewProgressSnapshotRow,
  type ProgressSnapshotRow,
} from '../schema/intelligence';
import type { Executor } from './executor';

/** Progress snapshots and insights — DATABASE_DESIGN §4.7. */
export function intelligenceRepository(db: Executor) {
  return {
    /** One row per goal per day; re-running the rollup overwrites rather than duplicates. */
    async upsertSnapshot(row: NewProgressSnapshotRow): Promise<ProgressSnapshotRow> {
      const [result] = await db
        .insert(progressSnapshots)
        .values(row)
        .onConflictDoUpdate({
          target: [progressSnapshots.goalId, progressSnapshots.snapshotDate],
          set: {
            weightedProgress: row.weightedProgress,
            conceptsMastered: row.conceptsMastered,
            conceptsTotal: row.conceptsTotal,
            minutesStudied: row.minutesStudied,
            accuracyRate: row.accuracyRate,
            adherenceRate: row.adherenceRate,
            verdict: row.verdict,
            projectedCompletionDate: row.projectedCompletionDate,
          },
        })
        .returning();
      if (!result) throw new Error('Upsert into progress_snapshots returned no row.');
      return result;
    },

    async listSnapshots(
      userId: string,
      goalId: string,
      since: string,
    ): Promise<ProgressSnapshotRow[]> {
      return db
        .select()
        .from(progressSnapshots)
        .where(
          and(
            eq(progressSnapshots.userId, userId),
            eq(progressSnapshots.goalId, goalId),
            gte(progressSnapshots.snapshotDate, since),
          ),
        )
        .orderBy(progressSnapshots.snapshotDate);
    },

    async createInsight(row: NewInsightRow): Promise<InsightRow> {
      const [result] = await db.insert(insights).values(row).returning();
      if (!result) throw new Error('Insert into insights returned no row.');
      return result;
    },

    async listInsights(userId: string, goalId?: string): Promise<InsightRow[]> {
      const conditions = [eq(insights.userId, userId), eq(insights.isDismissed, false)];
      if (goalId) conditions.push(eq(insights.goalId, goalId));
      return db
        .select()
        .from(insights)
        .where(and(...conditions))
        .orderBy(desc(insights.createdAt));
    },

    async dismissInsight(userId: string, insightId: string): Promise<void> {
      await db
        .update(insights)
        .set({ isDismissed: true })
        .where(and(eq(insights.id, insightId), eq(insights.userId, userId)));
    },
  };
}

export type IntelligenceRepository = ReturnType<typeof intelligenceRepository>;
