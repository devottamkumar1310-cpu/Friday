import { authedRoute } from '@/lib/api/handler';
import { getRootCauseAttribution } from '@/modules/intelligence/intelligence.service';
import { ApiError, ERROR_CODES } from '@friday/contracts';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId') ?? '';
    const weakConceptId = req.nextUrl.searchParams.get('weakConceptId') ?? '';

    if (!weakConceptId) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'weakConceptId is required.');
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