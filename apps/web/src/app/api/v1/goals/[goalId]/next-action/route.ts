import { authedRoute, requireParam } from '@/lib/api/handler';
import { getNextAction } from '@/modules/next-action/next-action.service';

export const runtime = 'nodejs';

/**
 * The hot path — API_SPECIFICATION §5.5. NFR-1.7: no LLM call anywhere on
 * this path; ranking comes entirely from `packages/core/priority`.
 */
export const GET = authedRoute({
  handler: async ({ user, params, req }) => {
    const availableMinutes = Number(req.nextUrl.searchParams.get('availableMinutes') ?? '60');
    return { data: await getNextAction(user, requireParam(params, 'goalId'), availableMinutes) };
  },
});
