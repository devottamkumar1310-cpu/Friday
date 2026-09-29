import { SignUpRequestSchema } from '@friday/contracts';
import { publicRoute } from '@/lib/api/handler';
import { signUp } from '@/modules/identity/identity.service';
import { SESSION_COOKIE, sessionCookieOptions } from '@/modules/identity/session';
import { RATE_LIMITS } from '@/lib/api/rate-limit';

// Argon2id is a native addon and the session write needs a real connection, so
// this cannot run on the edge runtime.
export const runtime = 'nodejs';

export const POST = publicRoute({
  body: SignUpRequestSchema,
  rateLimit: RATE_LIMITS.signUp,
  handler: async ({ body, meta }) => {
    const { user, token } = await signUp(body, meta);

    return {
      status: 201,
      data: { user, requiresVerification: !user.emailVerified },
      cookies: [
        { action: 'set', name: SESSION_COOKIE, value: token, options: sessionCookieOptions() },
      ],
    };
  },
});
