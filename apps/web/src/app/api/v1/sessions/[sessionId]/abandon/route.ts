import { authedRoute, requireParam } from '@/lib/api/handler';
import { abandonSession } from '@/modules/execution/execution.service';

export const runtime = 'nodejs';

/** No evidence is recorded — an abandoned session must not move mastery (E-15). */
export const POST = authedRoute({
  handler: async ({ user, params }) => {
    await abandonSession(user, requireParam(params, 'sessionId'));
    return { data: { abandoned: true } };
  },
});
