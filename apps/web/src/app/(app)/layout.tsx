import Link from 'next/link';
import { SignOutButton } from '@/components/app/sign-out-button';
import { requireUser } from '@/lib/auth/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware only checked that a cookie exists; this is the real validation.
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
              FRIDAY
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                Mission Control
              </Link>
              <Link href="/progress" className="hover:text-foreground">
                Progress
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.displayName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
