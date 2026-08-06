import { authedRoute } from '@/lib/api/handler';
import { listFacts, toWireFact } from '@/modules/memory/memory.service';

export const runtime = 'nodejs';

/** FR-7.6: what FRIDAY believes about you, and where each belief came from. */
export const GET = authedRoute({
  handler: async ({ user, req }) => {
    const category = req.nextUrl.searchParams.get('category') ?? undefined;
    const facts = await listFacts(user, category as Parameters<typeof listFacts>[1] | undefined);
    return { data: facts.map(toWireFact) };
  },
});
