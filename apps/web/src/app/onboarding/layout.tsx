import Link from 'next/link';
import { SignOutButton } from '@/components/app/sign-out-button';

/**
 * Onboarding shell.
 *
 * Onboarding used to have no chrome at all — no wordmark, no navigation, no way
 * out. A learner who got this far and stalled had exactly two options: finish,
 * or clear their cookies. Being unable to leave a screen is how a product
 * teaches someone that it is not on their side.
 *
 * So: a header thin enough not to compete with the step itself, carrying the
 * two things that were missing — proof of where you are, and a way out.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-3">
          <Link
            href="/"
            className="rounded-md text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            FRIDAY
          </Link>
          <SignOutButton />
        </div>
      </header>

      {children}
    </div>
  );
}
