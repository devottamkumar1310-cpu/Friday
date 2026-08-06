import { authedRoute, requireParam } from '@/lib/api/handler';
import { getMissionControl } from '@/modules/mission-control/mission-control.service';

export const runtime = 'nodejs';

/**
 * Mission Control — Today's Mission, Next Action, Progress, Risks, and
 * recommendation rationale in one response. Everything here is a direct
 * projection of `packages/core` output; no LLM call is made to produce it.
 */
export const GET = authedRoute({
  handler: async ({ user, params, req }) => {
    const availableMinutesParam = req.nextUrl.searchParams.get('availableMinutes');
    const goalId = requireParam(params, 'goalId');
    return {
      data: await getMissionControl(
        user,
        goalId,
        availableMinutesParam ? Number(availableMinutesParam) : undefined,
      ),
    };
  },
});
