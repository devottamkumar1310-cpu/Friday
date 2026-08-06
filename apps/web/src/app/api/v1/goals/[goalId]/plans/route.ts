import { authedRoute, requireParam } from '@/lib/api/handler';
import { listPlans, toWirePlan } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => ({
    data: (await listPlans(user, requireParam(params, 'goalId'))).map(toWirePlan),
  }),
});
