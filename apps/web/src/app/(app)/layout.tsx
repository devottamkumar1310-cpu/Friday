import { AppSidebar } from '@/components/app/app-sidebar';
import { MobileNav } from '@/components/app/mobile-nav';
import { CommandPalette } from '@/components/app/command-palette';
import { requireUser } from '@/lib/auth/server';
import { RevenueCatProvider } from '@/components/app/revenuecat-provider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware only checked that a cookie exists; this is the real validation.
  const user = await requireUser();

  return (
    <RevenueCatProvider userId={user.id}>
      <div className="flex min-h-dvh bg-background">
        <AppSidebar userDisplayName={user.displayName} />
        
        <div className="flex flex-1 flex-col min-w-0">
          <MobileNav userDisplayName={user.displayName} />
          
          <main id="main" className="flex-1 w-full max-w-5xl mx-auto px-4 py-8 md:px-8 lg:px-12">
            {children}
          </main>
        </div>
      </div>
      {/* Global command palette — Cmd/Ctrl+K from anywhere in the app */}
      <CommandPalette />
    </RevenueCatProvider>
  );
}

