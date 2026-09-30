'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  Brain,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Database,
  Dumbbell,
  Menu,
  MessageCircle,
  Settings,
  Target,
  TrendingUp,
} from 'lucide-react';
import { cn, DialogHeader as SheetHeader, Sheet, SheetContent, SheetTitle, SheetTrigger } from '@friday/ui';
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

export function MobileNav({ userDisplayName }: { userDisplayName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="lg:hidden flex h-14 items-center justify-between px-4 border-b border-border bg-surface sticky top-0 z-30">
      <Link href="/dashboard" className="text-sm font-bold tracking-tight text-foreground">
        FRIDAY
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button className="p-2 -mr-2 text-subtle-foreground hover:text-foreground">
            <Menu className="size-5" />
            <span className="sr-only">Open menu</span>
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="w-72 p-0 flex flex-col bg-surface-raised">
          <SheetHeader className="p-4 border-b border-border text-left">
            <SheetTitle className="text-sm font-bold">FRIDAY</SheetTitle>
          </SheetHeader>

          <nav className="flex-1 overflow-y-auto p-4 space-y-6">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-2 text-xs font-semibold text-muted-foreground tracking-wider">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
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
             <div className="flex items-center gap-3">
               <div className="flex-1 min-w-0">
                 <p className="text-sm font-medium truncate">{userDisplayName}</p>
               </div>
               <ThemeToggle />
             </div>
             <SignOutButton />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
