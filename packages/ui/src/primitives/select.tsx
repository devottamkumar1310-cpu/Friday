import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Native `<select>` rather than a Radix listbox.
 *
 * A styled div-based combobox has to reimplement keyboard navigation, type-
 * ahead, screen-reader semantics, and mobile behaviour — and usually gets the
 * last one wrong. The native control ships all of that, and on touch devices it
 * opens the platform picker, which is what learners expect. Novelty budget is
 * spent on the learning engine (A8), not on a dropdown.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-11 w-full appearance-none rounded-md border border-input bg-surface px-3 py-2 pr-9 text-sm',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:outline-destructive',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
});
