import { authedRoute } from '@/lib/api/handler';
import { listInsights } from '@/modules/intelligence/intelligence.service';
import { getDb } from '@/db';
import { decisionTraces } from '@/db/schema/intelligence';
import { and, eq } from 'drizzle-orm';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId') ?? undefined;

    // 1. List persisted DB insights (existing behavior)
    const dbInsights = await listInsights(user, goalId);

    // 2. Validate DB insights with trace ownership
    const db = getDb();
    const validatedDb = await Promise.all(dbInsights.map(async (i) => {
      if (i.decisionTraceId) {
        const trace = await db
          .select()
          .from(decisionTraces)
          .where(and(
            eq(decisionTraces.id, i.decisionTraceId),
            eq(decisionTraces.userId, user.id),
          ))
          .limit(1);
        if (trace.length === 0) {
          return { ...i, evidence: null };
        }
      }
      return { ...i, evidence: i.evidence };
    }));

    return {
      data: validatedDb.map((i) => ({
        id: i.id,
        type: i.type,
        title: i.title,
        body: i.body,
        severity: i.severity,
        conceptIds: i.conceptIds ?? [],
        evidence: i.evidence,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  },
});