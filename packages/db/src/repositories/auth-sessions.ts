import { and, eq, gt, lt } from 'drizzle-orm';
import { authSessions, users, type AuthSessionRow, type UserRow } from '../schema/identity';
import type { Executor } from './executor';

export interface SessionWithUser {
  session: AuthSessionRow;
  user: UserRow;
}

/**
 * Session repository.
 *
 * Sessions are database rows rather than stateless JWTs (ADR-007), which is
 * what makes revocation immediate and global: deleting the row ends the session
 * everywhere, with no token-lifetime window to wait out.
 */
export function authSessionsRepository(db: Executor) {
  return {
    async create(input: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
    }): Promise<AuthSessionRow> {
      const [row] = await db.insert(authSessions).values(input).returning();
      if (!row) throw new Error('Insert into auth_sessions returned no row.');
      return row;
    },

    /**
     * UNSCOPED by user, but scoped by a secret only the holder possesses — the
     * token hash *is* the authorization. Expired rows are filtered here so a
     * stale session can never resolve to a user.
     */
    async findActiveByTokenHash(tokenHash: string): Promise<SessionWithUser | undefined> {
      const [row] = await db
        .select({ session: authSessions, user: users })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, new Date())))
        .limit(1);
      return row;
    },

    async listForUser(userId: string): Promise<AuthSessionRow[]> {
      return db
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.userId, userId), gt(authSessions.expiresAt, new Date())))
        .orderBy(authSessions.lastActiveAt);
    },

    /** Sliding expiry. Rotation of the token itself happens in the service. */
    async touch(sessionId: string, expiresAt: Date): Promise<void> {
      await db
        .update(authSessions)
        .set({ lastActiveAt: new Date(), expiresAt })
        .where(eq(authSessions.id, sessionId));
    },

    /** Scoped: a learner may only revoke their own device. */
    async deleteForUser(userId: string, sessionId: string): Promise<void> {
      await db
        .delete(authSessions)
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)));
    },

    async deleteByTokenHash(tokenHash: string): Promise<void> {
      await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
    },

    async deleteAllForUser(userId: string): Promise<void> {
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
    },

    /** Housekeeping. Expired rows are already unusable; this reclaims space. */
    async deleteExpired(): Promise<void> {
      await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
    },
  };
}

export type AuthSessionsRepository = ReturnType<typeof authSessionsRepository>;
