import { authedRoute, requireParam } from '@/lib/api/handler';
import { getFeasibility } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => {
    const { feasibility, remediationOptions } = await getFeasibility(
      user,
      requireParam(params, 'goalId'),
    );
    return {
      data: {
        verdict: feasibility.verdict,
        requiredMinutes: Math.round(feasibility.requiredMinutes),
        availableMinutes: Math.round(feasibility.availableMinutes),
        slackMinutes: Math.round(feasibility.slackMinutes),
        slackPercent: Math.round(feasibility.slackFraction * 1000) / 10,
        projectedCompletionDate: feasibility.projectedCompletionDate,
        confidenceIntervalDays: feasibility.confidenceIntervalDays,
        remediationOptions,
      },
    };
  },
});
