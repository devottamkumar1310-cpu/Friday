import { UpdatePreferencesRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { getPreferences, updatePreferences } from '@/modules/identity/settings.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user }) => ({ data: await getPreferences(user) }),
});

export const PATCH = authedRoute({
  body: UpdatePreferencesRequestSchema,
  handler: async ({ user, body }) => ({ data: await updatePreferences(user, body) }),
});
