import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { getRootCauseAttribution } from '@/modules/intelligence/intelligence.service';
import { z } from 'zod';

const WeakConceptIdSchema = z.string().uuid();

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
    return;
  }

  // Validate UUID format
  const weakResult = WeakConceptIdSchema.safeParse(weakConceptId);
  if (!weakResult.success) {
    notFound();
    return;
  }

  const goalResult = WeakConceptIdSchema.safeParse(goalId);
  if (!goalResult.success) {
    notFound();
    return;
  }

  const result = await getRootCauseAttribution(user, goalResult.data, weakResult.data);

  const chain = result.chain ?? [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">Root Cause Analysis</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Why is this concept weak?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          FRIDAY analyzes your learning history to understand the root cause.
        </p>
      </div>

      <div className="space-y-6">

        {/* Weak concept header */}
        <div>
          <h2 className="text-lg font-medium mb-3">Weak Concept</h2>
          <p className="text-muted-foreground">
            Concept ID: {result.weakConceptId}
          </p>
        </div>

        {/* Chain of prerequisites */}
        <div>
          <h2 className="text-lg font-medium mb-3">Root-Cause Chain</h2>
          {chain.length === 0 ? (
            <p className="text-muted-foreground">
              No prerequisite chain found for this concept.
            </p>
          ) : (
            <ol className="list-decimal pl-5 space-y-2">
              {chain.map((step: any, i: number) => (
                <li key={i} className="p-3 rounded border border-border">
                  <div className="font-medium">Concept {step.conceptId}</div>
                  <div className="text-sm">
                    Mastery: {step.mastery?.toFixed(2) || 'N/A'}, Readiness: {
                      step.readiness?.toFixed(2) || 'N/A'
                    }, Strength: {step.strength?.toFixed(2) || 'N/A'}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Evidence section */}
        {result.evidence ? (
          <div>
            <h2 className="text-lg font-medium mb-3">Supporting Evidence</h2>
            <pre className="p-3 rounded border border-border text-sm overflow-auto">
              {JSON.stringify(result.evidence, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-muted-foreground">
            No specific evidence recorded for this root-cause attribution.
          </p>
        )}

        {/* Actionable insight */}
        <div>
          <h2 className="text-lg font-medium mb-3">What Should I Do Next?</h2>
          <p className="text-muted-foreground">
            Based on the chain analysis, FRIDAY recommends focusing on strengthening
            the prerequisite concepts shown above. Consider reviewing those
            concepts before returning to this one.
          </p>
        </div>
      </div>
    </main>
  );
}