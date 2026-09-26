import { authedRoute } from '@/lib/api/handler';
import { getRootCauseAttribution } from '@/modules/intelligence/intelligence.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId') ?? undefined;
    const weakConceptId = req.nextUrl.searchParams.get('weakConceptId') ?? undefined;

    if (!weakConceptId) {
      return { error: 'weakConceptId is required' };
    }

    const result = await getRootCauseAttribution(user, goalId, weakConceptId);

    return {
      data: {
        weakConceptId: result.weakConceptId,
        chain: result.chain,
        evidence: result.evidence,
      },
    };
  },
});