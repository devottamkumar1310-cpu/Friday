import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Inline busy indicator.
 *
 * §4.4 says loading surfaces use **skeletons, not spinners** — that rule is
 * about page and section loads, where a skeleton communicates shape. This is
 * for the case a skeleton cannot cover: a button mid-submit, or a stream
 * waiting on its first token, where there is no shape to preview yet.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2
        className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
        aria-hidden
      />
      {label ? <span className="text-sm">{label}</span> : null}
      <span className="sr-only">Loading</span>
    </span>
  );
}
