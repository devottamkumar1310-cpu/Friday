import { eq } from 'drizzle-orm';
import { userPreferences, type UserPreferencesRow } from '../schema/identity';
import type { Executor } from './executor';

export function preferencesRepository(db: Executor) {
  return {
    /** Idempotent: called on every sign-up, safe to retry. */
    async ensureDefaults(userId: string): Promise<void> {
      await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
    },

    async get(userId: string): Promise<UserPreferencesRow | undefined> {
      const [row] = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      return row;
    },

    async update(
      userId: string,
      patch: Partial<Omit<UserPreferencesRow, 'userId' | 'updatedAt'>>,
    ): Promise<void> {
      await db.update(userPreferences).set(patch).where(eq(userPreferences.userId, userId));
    },
  };
}

export type PreferencesRepository = ReturnType<typeof preferencesRepository>;
