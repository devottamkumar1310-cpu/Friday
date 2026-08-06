import { UpdateMeRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { getMePayload, updateProfile } from '@/modules/identity/identity.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: await getMePayload(user) }),
});

export const PATCH = authedRoute({
  body: UpdateMeRequestSchema,
  handler: async ({ user, body }) => {
    const updated = await updateProfile(user, body);
    return { data: await getMePayload(updated) };
  },
});
