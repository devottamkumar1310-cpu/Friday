'use client';

import Link from 'next/link';
import { Clock, PlayCircle } from 'lucide-react';
import { Button } from '@friday/ui';
import { WhyThis, type WhyThisProps } from '@/components/progress/why-this';

export interface MissionAction {
  taskId: string;
  title: string;
  estimatedMinutes: number;
  rationale: string;
  why: WhyThisProps | null;
}

/**
 * MissionCard — the one thing to do now.
 *
 * Answers WHAT (title), HOW LONG (display minutes), WHY (rationale) and
 * WHY NOW (factor breakdown, one click away). The Start action owns the
 * saturation on the screen. Data is the live Next Action — never invented.
 */
export function MissionCard({ action }: { action: MissionAction }) {
  return (
    <section
      aria-label="Next mission"
      className="animate-enter overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm"
    >
      <div className="h-1 bg-primary" aria-hidden />
      <div className="flex flex-col gap-8 p-6 sm:p-8 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Next mission
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {action.title}
            </h2>
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                {action.estimatedMinutes}
              </span>
              <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                min of focused work
              </span>
            </p>
          </div>

          <div className="max-w-xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Why this now
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{action.rationale}</p>
          </div>

          {action.why && (
            <details className="group max-w-xl rounded-lg border border-border bg-background/60">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:text-primary">
                <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                See why FRIDAY chose this
                <span className="ml-auto text-xs font-normal text-subtle-foreground group-open:hidden">
                  Show
                </span>
                <span className="ml-auto hidden text-xs font-normal text-subtle-foreground group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="border-t border-border px-4 py-4">
                <WhyThis {...action.why} />
              </div>
            </details>
          )}
        </div>

        <div className="flex shrink-0 flex-col justify-center md:w-64 md:pt-10">
          <Button asChild size="lg" className="h-14 w-full text-base font-semibold">
            <Link href={`/study/${action.taskId}`} prefetch>
              <PlayCircle className="mr-2 size-5" aria-hidden />
              Start Session
            </Link>
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            After this session, your plan adapts.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The calm counterpart: nothing left that fits today. No shame, no red. */
export function MissionComplete({ planHref = '/plan' }: { planHref?: string }) {
  return (
    <section
      aria-label="Next mission"
      className="animate-enter rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-success">Done for today</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
        You completed today&apos;s plan.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Nothing else fits the time you have left. FRIDAY will have your next move ready tomorrow.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-5">
        <Link href={planHref}>Review your plan</Link>
      </Button>
    </section>
  );
}
