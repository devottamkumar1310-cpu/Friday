import { UpdateFactRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import { deleteFact, toWireFact, updateFact } from '@/modules/memory/memory.service';

export const runtime = 'nodejs';

export const PATCH = authedRoute({
  body: UpdateFactRequestSchema,
  handler: async ({ user, params, body }) => ({
    data: toWireFact(await updateFact(user, requireParam(params, 'factId'), body)),
  }),
});

/** Honoured immediately — the row is deleted, not archived (FR-7.6). */
export const DELETE = authedRoute({
  handler: async ({ user, params }) => {
    await deleteFact(user, requireParam(params, 'factId'));
    return { data: { deleted: true } };
  },
});
