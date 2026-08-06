import { SetAvailabilityRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { getAvailability, setAvailability } from '@/modules/identity/settings.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: await getAvailability(user) }),
});

/** PUT replaces the whole set — a weekly grid has no meaningful partial edit. */
export const PUT = authedRoute({
  body: SetAvailabilityRequestSchema,
  handler: async ({ user, body }) => ({ data: await setAvailability(user, body) }),
});
