import { and, eq, sql } from 'drizzle-orm';
import {
  aiCalls,
  featureFlags,
  usageCounters,
  type AiCallRow,
  type FeatureFlagRow,
  type NewAiCallRow,
  type UsageCounterRow,
} from '../schema/platform';
import type { Executor } from './executor';

/** AI call log, cost counters, feature flags — DATABASE_DESIGN §4.9. */
export function platformRepository(db: Executor) {
  return {
    /** NFR-7.4: every model interaction is recorded, successful or not. */
    async recordAiCall(row: NewAiCallRow): Promise<AiCallRow> {
      const [result] = await db.insert(aiCalls).values(row).returning();
      if (!result) throw new Error('Insert into ai_calls returned no row.');
      return result;
    },

    /**
     * Rolls a call's cost into the user's month bucket. Called after every AI
     * interaction so the budget ceiling in §5.3 is enforceable on the next one.
     */
    async accrueUsage(
      userId: string,
      period: string,
      delta: { costUsd: number; tokensIn: number; tokensOut: number },
    ): Promise<void> {
      await db
        .insert(usageCounters)
        .values({
          userId,
          period,
          aiCostUsd: delta.costUsd.toFixed(4),
          aiCalls: 1,
          tokensIn: delta.tokensIn,
          tokensOut: delta.tokensOut,
        })
        .onConflictDoUpdate({
          target: [usageCounters.userId, usageCounters.period],
          set: {
            aiCostUsd: sql`${usageCounters.aiCostUsd} + ${delta.costUsd.toFixed(4)}`,
            aiCalls: sql`${usageCounters.aiCalls} + 1`,
            tokensIn: sql`${usageCounters.tokensIn} + ${delta.tokensIn}`,
            tokensOut: sql`${usageCounters.tokensOut} + ${delta.tokensOut}`,
          },
        });
    },

    async getUsage(userId: string, period: string): Promise<UsageCounterRow | undefined> {
      const [row] = await db
        .select()
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period)))
        .limit(1);
      return row;
    },

    async getFlag(key: string): Promise<FeatureFlagRow | undefined> {
      const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
      return row;
    },

    async upsertFlag(row: typeof featureFlags.$inferInsert): Promise<void> {
      await db
        .insert(featureFlags)
        .values(row)
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { isEnabled: row.isEnabled, rolloutPercentage: row.rolloutPercentage },
        });
    },
  };
}

export type PlatformRepository = ReturnType<typeof platformRepository>;
