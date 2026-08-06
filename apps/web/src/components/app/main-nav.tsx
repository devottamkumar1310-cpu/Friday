'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  Brain,
  CalendarDays,
  Dumbbell,
  Menu,
  MessageSquare,
  Settings,
  Target,
  X,
} from 'lucide-react';
import { cn } from '@friday/ui';

/**
 * Primary navigation.
 *
 * Collapses to a disclosure menu below `sm` rather than a bottom bar: six
 * destinations is too many for a thumb row, and a bottom bar would cover the
 * study timer, which is the one thing that must stay visible mid-session.
 */

const LINKS = [
  { href: '/dashboard', label: 'Mission Control', icon: Target },
  { href: '/plan', label: 'Plan', icon: CalendarDays },
  { href: '/practice', label: 'Practice', icon: Dumbbell },
  { href: '/coach', label: 'Coach', icon: MessageSquare },
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function MainNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              isActive(href)
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        className="rounded-md p-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:hidden"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>

      {open && (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-full z-20 border-b border-border bg-surface shadow-lg sm:hidden"
        >
          <nav aria-label="Main" className="flex flex-col p-2">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  isActive(href)
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
