import Link from 'next/link';
import { MainNav } from '@/components/app/main-nav';
import { SignOutButton } from '@/components/app/sign-out-button';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { requireUser } from '@/lib/auth/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware only checked that a cookie exists; this is the real validation.
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              href="/dashboard"
              className="shrink-0 rounded-md text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              FRIDAY
            </Link>
            <MainNav />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden max-w-32 truncate text-sm text-muted-foreground md:inline">
              {user.displayName}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
