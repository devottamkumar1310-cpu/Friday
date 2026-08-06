import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  accounts,
  users,
  type NewUserRow,
  type StoredOnboardingState,
  type UserRow,
} from '../schema/identity';
import type { Executor } from './executor';

/**
 * User repository.
 *
 * NFR-3.3: no query reaches the database without a scoped identifier. For this
 * aggregate the user *is* the scope, so every read is by id — except the three
 * lookups marked UNSCOPED below, which are the authentication entry points and
 * therefore cannot have an authenticated identity yet. They are deliberately
 * few, named for what they are, and the only functions in this file that can
 * return a row the caller has not already proven ownership of.
 */
export function usersRepository(db: Executor) {
  return {
    async create(input: NewUserRow): Promise<UserRow> {
      const [row] = await db.insert(users).values(input).returning();
      if (!row) throw new Error('Insert into users returned no row.');
      return row;
    },

    async findById(userId: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** UNSCOPED — sign-in entry point. No identity exists yet. */
    async findByEmailForAuth(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** UNSCOPED — OAuth callback entry point. */
    async findByProviderAccountForAuth(
      provider: string,
      providerAccountId: string,
    ): Promise<UserRow | undefined> {
      const [row] = await db
        .select({ user: users })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.userId))
        .where(
          and(
            eq(accounts.provider, provider),
            eq(accounts.providerAccountId, providerAccountId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row?.user;
    },

    /** UNSCOPED — sign-up uniqueness check. Returns existence only. */
    async emailExists(email: string): Promise<boolean> {
      const [row] = await db
        .select({ one: sql<number>`1` })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return row !== undefined;
    },

    async updateProfile(
      userId: string,
      patch: Partial<
        Pick<UserRow, 'displayName' | 'timezone' | 'locale' | 'avatarUrl' | 'onboardingState'>
      >,
    ): Promise<UserRow | undefined> {
      const [row] = await db
        .update(users)
        .set(patch)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      return row;
    },

    /**
     * Write-once. The `is null` predicate makes a second attempt a no-op at the
     * storage layer rather than relying on the caller to check first — changing
     * a date of birth would silently change minor status.
     */
    async setDateOfBirthIfUnset(
      userId: string,
      dateOfBirth: string,
      isMinor: boolean,
      onboardingState: StoredOnboardingState,
    ): Promise<UserRow | undefined> {
      const [row] = await db
        .update(users)
        .set({ dateOfBirth, isMinor, onboardingState })
        .where(and(eq(users.id, userId), isNull(users.dateOfBirth), isNull(users.deletedAt)))
        .returning();
      return row;
    },

    async markEmailVerified(userId: string): Promise<void> {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
    },

    async linkAccount(input: {
      userId: string;
      provider: string;
      providerAccountId: string;
      accessToken?: string | null;
      refreshToken?: string | null;
      expiresAt?: Date | null;
    }): Promise<void> {
      await db
        .insert(accounts)
        .values(input)
        .onConflictDoNothing({ target: [accounts.provider, accounts.providerAccountId] });
    },

    /** Soft delete. The 30-day grace before PII purge is a scheduled job. */
    async softDelete(userId: string): Promise<void> {
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    },
  };
}

export type UsersRepository = ReturnType<typeof usersRepository>;
