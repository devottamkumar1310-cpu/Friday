import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@friday/ui';

/**
 * FRIDAY intelligence language, enforced structurally:
 * NOTICED → MEANS → CHANGING → WHY. Deterministic systems decide; this
 * component only phrases what the engine already computed. No bare
 * "AI Insight" cards, no invented numbers, no numeric confidence.
 */

export interface IntelligenceBlockProps {
  eyebrow?: string;
  statement: string;
  meaning?: string;
  changing?: string;
  evidence?: string;
  alarming?: boolean;
  action?: { label: string; href: string };
  className?: string;
}

export function IntelligenceBlock({
  eyebrow = 'Observation',
  statement,
  meaning,
  changing,
  evidence,
  alarming = false,
  action,
  className,
}: IntelligenceBlockProps) {
  return (
    <article
      className={cn(
        'animate-enter rounded-xl border bg-surface p-5',
        alarming ? 'border-warning/40' : 'border-border',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ai-accent">
        <Sparkles className="size-3.5" aria-hidden />
        {eyebrow}
      </p>
      <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">{statement}</p>
      {meaning && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">What this means — </span>
          {meaning}
        </p>
      )}
      {changing && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">What FRIDAY is changing — </span>
          {changing}
        </p>
      )}
      {evidence && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-subtle-foreground">
          <span className="font-medium uppercase tracking-wider">Why — </span>
          {evidence}
        </p>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {action.label}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </article>
  );
}

export interface AdaptationCardProps {
  statement: string;
  evidence?: string;
  before?: string;
  now?: string;
  reason?: string;
  href?: string;
  hrefLabel?: string;
}

/** "FRIDAY adapted your plan" — before → now + reason. Pulse once. */
export function AdaptationCard({
  statement,
  evidence,
  before,
  now,
  reason,
  href = '/plan',
  hrefLabel = 'View changes',
}: AdaptationCardProps) {
  return (
    <article className="animate-enter animate-adapt rounded-xl border border-border bg-ai-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-ai-accent">
        Friday adapted your plan
      </p>
      <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">{statement}</p>
      {before && now && (
        <dl className="mt-3 space-y-1.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Before</dt>
            <dd className="text-muted-foreground line-through decoration-muted-foreground/60">
              {before}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Now</dt>
            <dd className="font-medium text-foreground">{now}</dd>
          </div>
        </dl>
      )}
      {(reason ?? evidence) && (
        <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
          <span className="font-medium uppercase tracking-wider">Reason — </span>
          {reason ?? evidence}
        </p>
      )}
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {hrefLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </article>
  );
}
