'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../lib/cn';

export interface ProgressProps extends React.ComponentPropsWithoutRef<
  typeof ProgressPrimitive.Root
> {
  /** 0–100. */
  value?: number;
  tone?: 'primary' | 'success' | 'warning' | 'destructive';
}

const TONE: Record<NonNullable<ProgressProps['tone']>, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

export const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(function Progress({ className, value = 0, tone = 'primary', ...props }, ref) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={clamped}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full w-full flex-1 transition-transform duration-(--duration-slow)',
          TONE[tone],
        )}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});

export interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}

/**
 * Circular progress. Mission Control's headline figure is goal completion, and
 * a ring reads as a single glanceable state in a way a bar does not.
 */
export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 8,
  className,
  label,
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="stroke-muted"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-(--duration-slow) ease-(--ease-out)"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
        />
      </svg>
      <span className="absolute text-xl font-semibold tabular-nums">{Math.round(clamped)}%</span>
    </div>
  );
}
