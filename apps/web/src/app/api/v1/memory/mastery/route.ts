import { ApiError, ERROR_CODES } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { listMastery } from '@/modules/memory/memory.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const goalId = req.nextUrl.searchParams.get('goalId');
    if (!goalId) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'goalId is required.');
    const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100');
    return { data: await listMastery(user, goalId, limit) };
  },
});
