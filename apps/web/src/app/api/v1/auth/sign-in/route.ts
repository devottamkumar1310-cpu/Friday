import { SignInRequestSchema } from '@friday/contracts';
import { publicRoute } from '@/lib/api/handler';
import { signIn } from '@/modules/identity/identity.service';
import { SESSION_COOKIE, sessionCookieOptions } from '@/modules/identity/session';

export const runtime = 'nodejs';

export const POST = publicRoute({
  body: SignInRequestSchema,
  handler: async ({ body, meta }) => {
    const { user, token } = await signIn(body, meta);

    return {
      data: { user },
      cookies: [
        { action: 'set', name: SESSION_COOKIE, value: token, options: sessionCookieOptions() },
      ],
    };
  },
});
