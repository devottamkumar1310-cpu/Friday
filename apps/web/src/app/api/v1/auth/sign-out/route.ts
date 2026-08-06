import { authedRoute } from '@/lib/api/handler';
import { signOut } from '@/modules/identity/identity.service';
import { SESSION_COOKIE } from '@/modules/identity/session';

export const runtime = 'nodejs';

export const POST = authedRoute({
  handler: async ({ req }) => {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    // Deleting the row is what actually ends the session — clearing the cookie
    // alone would leave a usable token in anyone else's hands (ADR-007).
    if (token) await signOut(token);

    return {
      data: { signedOut: true as const },
      cookies: [{ action: 'delete', name: SESSION_COOKIE }],
    };
  },
});
