import { authedRoute, requireParam } from '@/lib/api/handler';
import { getCurrentPlan, toWirePlan } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => ({
    data: toWirePlan(await getCurrentPlan(user, requireParam(params, 'goalId'))),
  }),
});
