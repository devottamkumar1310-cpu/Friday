import { RecordConsentRequestSchema } from '@friday/contracts';
import { authedRoute } from '@/lib/api/handler';
import { recordConsent } from '@/modules/identity/identity.service';

export const runtime = 'nodejs';

export const POST = authedRoute({
  body: RecordConsentRequestSchema,
  handler: async ({ user, body, meta }) => ({
    status: 201,
    data: await recordConsent(user, body, meta),
  }),
});
