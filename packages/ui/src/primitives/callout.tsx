import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Inline message block.
 *
 * Distinct from `ErrorState`, which replaces a whole surface. A callout sits
 * *within* content that is still usable — a feasibility warning above a plan
 * the learner can still read, for instance.
 */
export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<CalloutTone, { classes: string; icon: React.ReactNode; role?: 'alert' }> = {
  info: { classes: 'border-border bg-muted/40', icon: <Info className="size-4" /> },
  success: {
    classes: 'border-success/30 bg-success/5',
    icon: <CheckCircle2 className="size-4 text-success" />,
  },
  warning: {
    classes: 'border-warning/40 bg-warning/5',
    icon: <AlertTriangle className="size-4 text-warning" />,
  },
  danger: {
    classes: 'border-destructive/40 bg-destructive/5',
    icon: <OctagonAlert className="size-4 text-destructive" />,
    role: 'alert',
  },
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function Callout({ tone = 'info', title, children, action, className }: CalloutProps) {
  const spec = TONE[tone];
  return (
    <div
      // Only danger interrupts a screen reader; a warning that hijacks focus
      // mid-task is worse than one that waits to be read.
      role={spec.role}
      className={cn('flex gap-3 rounded-lg border px-4 py-3', spec.classes, className)}
    >
      <div className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
        {spec.icon}
      </div>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
