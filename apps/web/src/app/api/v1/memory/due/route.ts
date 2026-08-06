import { ApiError, ERROR_CODES } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { listDueReviews } from '@/modules/memory/memory.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId');
    if (!goalId) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'goalId is required.');
    return { data: await listDueReviews(user, goalId) };
  },
});
