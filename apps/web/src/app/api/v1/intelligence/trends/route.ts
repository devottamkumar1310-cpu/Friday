import { ApiError, ERROR_CODES } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { getTrends } from '@/modules/intelligence/intelligence.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId');
    if (!goalId) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'goalId is required.');
    const period = req.nextUrl.searchParams.get('period') ?? '30d';
    const days = Number(period.replace('d', '')) || 30;
    return { data: await getTrends(user, goalId, days) };
  },
});
