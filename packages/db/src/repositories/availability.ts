import { eq, sql } from 'drizzle-orm';
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
      /**
       * Serialised per learner, because "replace" is a delete and an insert.
       *
       * Two concurrent saves — a double-tapped Save button is enough — could
       * interleave those four statements and leave a *blended* rule set behind:
       * some days at the old capacity and some at the new, which is a week the
       * learner never asked for and cannot see is wrong. Measured in the
       * adversarial pass, where the plan was then built against one capacity
       * while the stored rules claimed another.
       *
       * Taking the owning `users` row first means the second writer waits for
       * the first to finish rather than writing into the middle of it. The
       * caller is expected to supply a transaction; without one the lock would
       * be released immediately and this would be decorative.
       */
      await db.execute(sql`select 1 from users where id = ${userId} for update`);
      await db.delete(availabilityRules).where(eq(availabilityRules.userId, userId));
      if (rules.length === 0) return;
      await db.insert(availabilityRules).values(rules.map((r) => ({ ...r, userId })));
    },
  };
}

export type AvailabilityRepository = ReturnType<typeof availabilityRepository>;
