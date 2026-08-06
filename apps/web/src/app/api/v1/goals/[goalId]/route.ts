import { authedRoute, requireParam } from '@/lib/api/handler';
import { getGoal, toWireGoal } from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => ({
    data: toWireGoal(await getGoal(user, requireParam(params, 'goalId'))),
  }),
});
