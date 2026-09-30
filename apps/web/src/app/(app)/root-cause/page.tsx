import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, FileText, Target } from 'lucide-react';
import { Badge, Button, PageHeader } from '@friday/ui';
import { requireUser } from '@/lib/auth/server';
import { getRootCauseAttribution } from '@/modules/intelligence/intelligence.service';
import { z } from 'zod';

export const metadata: Metadata = { title: 'Root Cause Analysis' };

const UuidSchema = z.string().uuid();

export default async function RootCausePage({
  searchParams,
}: {
  searchParams: Promise<{ goalId: string; weakConceptId: string }>;
}) {
  const user = await requireUser();

  const params = await searchParams;
  const goalId = params.goalId ?? undefined;
  const weakConceptId = params.weakConceptId ?? undefined;

  if (!goalId || !weakConceptId) {
    notFound();
  }

  const weakResult = UuidSchema.safeParse(weakConceptId);
  const goalResult = UuidSchema.safeParse(goalId);

  if (!weakResult.success || !goalResult.success) {
    notFound();
  }

  const result = await getRootCauseAttribution(user, goalResult.data, weakResult.data);

  const chain = (result.chain ?? []) as {
    conceptId: string;
    mastery?: number;
    readiness?: number;
    strength?: number;
  }[];

  const root = chain.length > 0 ? chain[chain.length - 1] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
          <Link href="/progress">
            <ArrowLeft className="mr-1.5 size-3.5" aria-hidden />
            Back to Progress
          </Link>
        </Button>
        <PageHeader
          eyebrow="Root cause investigation"
          title="Why am I struggling here?"
          description="FRIDAY traces your learning history through the prerequisite chain to find where understanding actually broke down — not just which topic to revise."
        />
      </div>

      {/* The chain — an investigation, not a chart. */}
      <section aria-labelledby="chain-heading" className="animate-enter space-y-4">
        <div>
          <h2
            id="chain-heading"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            The dependency chain
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each step depends on the one below it. The root cause is the earliest
            prerequisite with low mastery.
          </p>
        </div>

        {chain.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-medium text-foreground">This is a foundational concept.</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              No prerequisites to trace — direct practice is the fastest way forward.
            </p>
          </div>
        ) : (
          <ol className="space-y-0" aria-label="Root cause chain">
            {chain.map((step, i) => {
              const mastery = step.mastery ?? 0;
              const masteryPct = Math.round(mastery * 100);
              const isRoot = i === chain.length - 1;

              // Low mastery is attention (warning), never shame (danger).
              const masteryColor = masteryPct < 70 ? 'text-warning' : 'text-success';
              const masteryBar = masteryPct < 70 ? 'bg-warning' : 'bg-success';

              return (
                <li key={step.conceptId} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={[
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                        isRoot
                          ? 'bg-warning/15 text-warning ring-1 ring-warning/30'
                          : 'bg-muted text-muted-foreground',
                      ].join(' ')}
                      aria-label={`Step ${i + 1}${isRoot ? ' — root cause' : ''}`}
                    >
                      {i + 1}
                    </div>
                    {i < chain.length - 1 && (
                      <div className="my-1 w-px flex-1 bg-border" aria-hidden />
                    )}
                  </div>

                  <div
                    className={[
                      'mb-4 min-w-0 flex-1 rounded-xl border p-4',
                      isRoot
                        ? 'border-warning/30 bg-warning/5'
                        : 'border-border bg-surface',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          'font-mono text-xs',
                          isRoot ? 'text-warning' : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        {step.conceptId}
                      </span>
                      {isRoot && (
                        <Badge variant="warning" className="text-[10px]">
                          Root cause
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Mastery</span>
                        <span className={`font-semibold tabular-nums ${masteryColor}`}>
                          {masteryPct}%
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={masteryPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Mastery: ${masteryPct}%`}
                      >
                        <div
                          className={`h-full rounded-full ${masteryBar}`}
                          style={{ width: `${masteryPct}%` }}
                        />
                      </div>
                    </div>

                    {(step.readiness !== undefined || step.strength !== undefined) && (
                      <div className="mt-3 flex gap-5 text-xs text-muted-foreground">
                        {step.readiness !== undefined && (
                          <span>
                            Readiness{' '}
                            <span className="font-semibold tabular-nums text-foreground">
                              {Math.round(step.readiness * 100)}%
                            </span>
                          </span>
                        )}
                        {step.strength !== undefined && (
                          <span>
                            Strength{' '}
                            <span className="font-semibold tabular-nums text-foreground">
                              {Math.round(step.strength * 100)}%
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* FRIDAY's conclusion + next move. */}
      {root && (
        <section
          aria-labelledby="conclusion-heading"
          className="animate-enter rounded-xl border border-border bg-surface-raised p-6"
          style={{ ['--enter-delay' as string]: '80ms' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10"
              aria-hidden
            >
              <Target className="size-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="conclusion-heading" className="font-semibold text-foreground">
                FRIDAY&apos;s conclusion
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Your errors here appear connected to weak{' '}
                <span className="font-mono text-xs text-foreground">{root.conceptId}</span>{' '}
                recall. Strengthening the prerequisite first produces faster mastery gains
                than re-reading the dependent concept.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/practice">
                    Practise the root cause
                    <ArrowRight className="ml-1.5 size-4" aria-hidden />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard">Back to Mission Control</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Evidence — collapsed, honest about what it is. */}
      {result.evidence && (
        <section aria-label="Supporting evidence">
          <details className="group rounded-xl border border-border bg-surface">
            <summary className="flex cursor-pointer select-none items-center gap-2.5 px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              What evidence supports this?
              <span className="ml-auto text-xs text-subtle-foreground group-open:hidden">
                Show
              </span>
              <span className="ml-auto hidden text-xs text-subtle-foreground group-open:inline">
                Hide
              </span>
            </summary>
            <div className="border-t border-border px-4 pt-3 pb-4">
              <p className="mb-2 text-xs text-muted-foreground">
                Raw signals from your session history that informed this attribution.
              </p>
              <pre className="overflow-auto rounded-md bg-muted px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {JSON.stringify(result.evidence, null, 2)}
              </pre>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
