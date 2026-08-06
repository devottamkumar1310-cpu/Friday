'use client';

import { Toaster as Sonner, toast } from 'sonner';

/**
 * Toasts.
 *
 * Wraps sonner rather than reimplementing it: it already handles the difficult
 * parts — focus management, screen-reader announcements, hover-to-pause, and
 * stacking. The wrapper exists so the styling stays on our tokens and so the
 * rest of the app imports from one place.
 */

export type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      // Bottom-right on desktop, but sonner moves to top on mobile widths where
      // a bottom toast would sit under the thumb.
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-surface text-foreground border border-border rounded-lg shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground rounded-md',
          cancelButton: 'bg-muted text-muted-foreground rounded-md',
          error: 'border-destructive',
          success: 'border-success',
          warning: 'border-warning',
        },
      }}
      {...props}
    />
  );
}

export { toast };
