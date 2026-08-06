import { and, desc, eq } from 'drizzle-orm';
import { consents, type ConsentRow } from '../schema/identity';
import type { Executor } from './executor';

/**
 * Consent repository — the DPDP / GDPR audit trail (NFR-3.8).
 *
 * Append-only: a withdrawal is a new row with `granted = false`, never an
 * update. The history of what was agreed, and when, is the record that matters.
 */
export function consentsRepository(db: Executor) {
  return {
    async record(input: {
      userId: string;
      consentType: string;
      granted: boolean;
      version: string;
      guardianEmail?: string | null;
      ipAddress?: string | null;
    }): Promise<ConsentRow> {
      const [row] = await db.insert(consents).values(input).returning();
      if (!row) throw new Error('Insert into consents returned no row.');
      return row;
    },

    async listForUser(userId: string): Promise<ConsentRow[]> {
      return db
        .select()
        .from(consents)
        .where(eq(consents.userId, userId))
        .orderBy(desc(consents.createdAt));
    },

    /** Current state of one consent type: the most recent row wins. */
    async isGranted(userId: string, consentType: string): Promise<boolean> {
      const [row] = await db
        .select({ granted: consents.granted })
        .from(consents)
        .where(and(eq(consents.userId, userId), eq(consents.consentType, consentType)))
        .orderBy(desc(consents.createdAt))
        .limit(1);
      return row?.granted ?? false;
    },
  };
}

export type ConsentsRepository = ReturnType<typeof consentsRepository>;
