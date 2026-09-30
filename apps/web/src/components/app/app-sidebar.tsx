'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Brain,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Database,
  Dumbbell,
  MessageCircle,
  Search,
  Settings,
  Target,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@friday/ui';
import { SignOutButton } from '@/components/app/sign-out-button';
import { ThemeToggle } from '@/components/app/theme-toggle';

const GROUPS = [
  {
    label: 'MISSION',
    items: [
      { href: '/dashboard', label: 'Mission Control', icon: Target },
      { href: '/plan', label: 'Plan', icon: CalendarDays },
    ],
  },
  {
    label: 'LEARN',
    items: [
      { href: '/progress', label: 'Progress', icon: BarChart3 },
      { href: '/practice', label: 'Practice', icon: Dumbbell },
      { href: '/mock-test', label: 'Mock Test', icon: ClipboardList },
      { href: '/root-cause', label: 'Root Cause', icon: Brain },
      { href: '/weekly-review', label: 'Weekly Review', icon: TrendingUp },
    ],
  },
  {
    label: 'THINK',
    items: [
      { href: '/coach', label: 'Coach', icon: MessageCircle },
      { href: '/memory', label: 'Memory', icon: Database },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/billing', label: 'Billing', icon: CreditCard },
    ],
  },
];

export function AppSidebar({ userDisplayName }: { userDisplayName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-surface-raised sticky top-0 h-dvh">
      <div className="flex h-14 items-center px-4 border-b border-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          FRIDAY
        </Link>
      </div>

      {/* Cmd+K search hint */}
      <div className="px-3 pt-4">
        <button
          className="w-full flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
            window.dispatchEvent(event);
          }}
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 text-left text-xs">Search...</span>
          <kbd className="hidden xl:inline text-[10px] border border-border rounded px-1 py-0.5 bg-background font-mono">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground tracking-wider">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    isActive(href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-subtle-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-4 space-y-4">
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{userDisplayName}</p>
          </div>
          <ThemeToggle />
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
