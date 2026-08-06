import { SkipActionRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { skipNextAction } from '@/modules/next-action/next-action.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: SkipActionRequestSchema,
  handler: async ({ user, params, body, req }) => {
    const availableMinutes = Number(req.nextUrl.searchParams.get('availableMinutes') ?? '60');
    const goalId = requireParam(params, 'goalId');
    return { data: await skipNextAction(user, goalId, body.taskId, body.reason, availableMinutes) };
  },
});
