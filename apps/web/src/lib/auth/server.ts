import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { UserRow } from '@friday/db';
import { getMePayload, resolveSession } from '@/modules/identity/identity.service';
import { SESSION_COOKIE } from '@/modules/identity/session';

/**
 * Server-side session access for React Server Components.
 *
 * Middleware only checks that a cookie exists — it runs on the edge, where the
 * database and node crypto are unavailable. This is where a session is actually
 * validated, so every protected page verifies for real rather than trusting the
 * redirect that got it here.
 */

export async function getCurrentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const resolved = await resolveSession(token);
  return resolved?.user ?? null;
}

/** For pages that require a session. Redirects rather than throwing. */
export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

/**
 * For pages that additionally require onboarding to be unblocked — FR-1.6.
 * A learner with no date of birth, or a minor without guardian consent, is sent
 * to finish that before reaching anything that creates a Goal.
 */
export async function requireOnboardedUser(): Promise<UserRow> {
  const user = await requireUser();
  const { onboarding } = await getMePayload(user);

  if (onboarding.blockedBy === 'date_of_birth') redirect('/onboarding/date-of-birth');
  if (onboarding.blockedBy === 'guardian_consent') redirect('/onboarding/guardian-consent');

  return user;
}
