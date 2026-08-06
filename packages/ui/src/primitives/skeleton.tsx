import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Loading placeholder.
 *
 * SYSTEM_ARCHITECTURE §4.4: every async surface ships a skeleton, never a
 * spinner. A skeleton preserves layout and communicates *what* is arriving,
 * so the page does not jump when it does.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      // Decorative: the live region announcing the load lives on the container.
      aria-hidden
      {...props}
    />
  );
}

/** Convenience for the common case of several stacked lines of text. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
