import { ApiError, ERROR_CODES } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { getWeakConcepts } from '@/modules/intelligence/intelligence.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId');
    if (!goalId) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'goalId is required.');
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '10');

    const weak = await getWeakConcepts(user, goalId, limit);
    return {
      data: weak.map((w) => ({
        ...w,
        evidence: {
          ...w.evidence,
          lastEvidenceAt: w.evidence.lastEvidenceAt?.toISOString() ?? null,
        },
      })),
    };
  },
});
