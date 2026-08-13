import { RegeneratePlanRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { regeneratePlan, toWirePlan } from '@/modules/planning/planning.service';
import { RATE_LIMITS } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';

/**
 * The replanning engine's manual trigger (M0 §1.1 — nightly cron and drift
 * detection wiring are Phase 3). Runs the full §10.2 pipeline: snapshot,
 * recompute, diff, materiality gate, commit-or-discard.
 */
export const POST = authedRoute({
  body: RegeneratePlanRequestSchema,
  rateLimit: RATE_LIMITS.replan,
  handler: async ({ user, params, body }) => {
    const result = await regeneratePlan(user, requireParam(params, 'goalId'), body.reason);
    return {
      data: {
        committed: result.committed,
        reason: result.reason,
        plan: result.plan ? toWirePlan(result.plan) : null,
        drift: { drift: result.drift.drift, verdictChanged: result.drift.verdictChanged },
      },
    };
  },
});
