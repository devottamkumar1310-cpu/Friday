import { authedRoute } from '@/lib/api/handler';
import { listInsights } from '@/modules/intelligence/intelligence.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId') ?? undefined;
    const insights = await listInsights(user, goalId);
    return {
      data: insights.map((i) => ({
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
