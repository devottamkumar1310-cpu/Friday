import { UpdateMeRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { SESSION_COOKIE } from '@/modules/identity/session';
import { deleteAccount, getMePayload, updateProfile } from '@/modules/identity/identity.service';

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

export const DELETE = authedRoute({
  handler: async ({ user }) => {
    await deleteAccount(user);
    return {
      data: { success: true },
      cookies: [{ action: 'delete', name: SESSION_COOKIE }],
    };
  },
});
