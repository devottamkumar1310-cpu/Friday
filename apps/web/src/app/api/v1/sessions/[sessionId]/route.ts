import { authedRoute, requireParam } from '@/lib/api/handler';
import { getSession } from '@/modules/execution/execution.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => ({
    data: await getSession(user, requireParam(params, 'sessionId')),
  }),
});
