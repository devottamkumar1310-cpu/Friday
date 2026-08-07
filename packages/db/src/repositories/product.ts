import { desc, eq, sql } from 'drizzle-orm';
import { feedback, productEvents } from '../schema/product';
import type { Executor } from './executor';

/** Product telemetry and learner feedback — CR-007. */
export function productRepository(db: Executor) {
  return {
    async recordEvent(input: {
      userId: string | null;
      name: string;
      properties?: Record<string, string | number | boolean> | null;
    }): Promise<void> {
      await db.insert(productEvents).values({
        userId: input.userId,
        name: input.name,
        properties: input.properties ?? null,
      });
    },

    async submitFeedback(input: {
      userId: string;
      kind: string;
      message: string;
      path: string | null;
    }): Promise<typeof feedback.$inferSelect> {
      const [row] = await db.insert(feedback).values(input).returning();
      if (!row) throw new Error('Insert into feedback returned no row.');
      return row;
    },

    async listFeedbackFor(userId: string, limit = 20): Promise<(typeof feedback.$inferSelect)[]> {
      return db
        .select()
        .from(feedback)
        .where(eq(feedback.userId, userId))
        .orderBy(desc(feedback.createdAt))
        .limit(limit);
    },

    /** Liveness probe. Cheapest possible round trip that proves a real connection. */
    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
  };
}
