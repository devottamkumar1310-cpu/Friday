import { publicRoute } from '@/lib/api/handler';
import { checkHealth } from '@/modules/platform/health.service';

export const runtime = 'nodejs';
// Never cached: a cached health check is worse than none, because it reports
// the state of some earlier moment with total confidence.
export const dynamic = 'force-dynamic';

/**
 * Deployment health probe.
 *
 * Outside `/api/v1` on purpose. That prefix is the learner-facing contract,
 * versioned and enumerated in `@friday/contracts`; this is an operational
 * endpoint for load balancers and uptime monitors, with a different audience
 * and a different compatibility promise.
 *
 * Returns 503 when a dependency is down so a load balancer takes the instance
 * out of rotation rather than sending it traffic it cannot serve.
 */
export const GET = publicRoute({
  handler: async () => {
    const report = await checkHealth();
    return { data: report, status: report.status === 'ok' ? 200 : 503 };
  },
});
