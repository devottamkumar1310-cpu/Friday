import * as React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

/**
 * Empty and error states.
 *
 * SYSTEM_ARCHITECTURE §4.4 requires four states on every async surface:
 * loading, empty, error, success. Skeleton covers loading; these cover the two
 * that are most often skipped. An empty state always names the action that
 * fills it, and an error state always offers a way forward.
 */

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-subtle-foreground" aria-hidden>
        {icon ?? <Inbox className="size-8" />}
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Shown in small print — support cannot help without it. */
  requestId?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  requestId,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
    >
      <AlertTriangle className="size-7 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
      {requestId && (
        <p className="font-mono text-xs text-subtle-foreground">Reference: {requestId}</p>
      )}
    </div>
  );
}
