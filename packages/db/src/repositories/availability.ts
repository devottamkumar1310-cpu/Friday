import { eq } from 'drizzle-orm';
import { availabilityRules, type AvailabilityRuleRow } from '../schema/identity';
import type { Executor } from './executor';

/** Weekly availability rules + temporary overrides (DATABASE_DESIGN §4.1). */
export function availabilityRepository(db: Executor) {
  return {
    async listForUser(userId: string): Promise<AvailabilityRuleRow[]> {
      return db.select().from(availabilityRules).where(eq(availabilityRules.userId, userId));
    },

    async replaceAll(
      userId: string,
      rules: Omit<typeof availabilityRules.$inferInsert, 'id' | 'userId' | 'createdAt'>[],
    ): Promise<void> {
      await db.delete(availabilityRules).where(eq(availabilityRules.userId, userId));
      if (rules.length === 0) return;
      await db.insert(availabilityRules).values(rules.map((r) => ({ ...r, userId })));
    },
  };
}

export type AvailabilityRepository = ReturnType<typeof availabilityRepository>;
