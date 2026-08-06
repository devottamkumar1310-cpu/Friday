import { Badge } from '@friday/ui';

/**
 * Weak concepts with their evidence — roadmap 2.2's drill-down half.
 *
 * Every row shows what the claim rests on. A concept flagged weak on one
 * observation is labelled provisional rather than asserted, because "you are
 * weak at this" from a single data point is a guess, and the learner deserves
 * to see which it is (DP6).
 */

export interface WeakConceptView {
  conceptId: string;
  title: string;
  mastery: number;
  examWeight: number;
  evidence: {
    evidenceCount: number;
    beliefConfidence: number;
    lastEvidenceAt: string | null;
    provisional: boolean;
  };
}

export function WeakConceptList({ concepts }: { concepts: WeakConceptView[] }) {
  if (concepts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is flagged weak yet. Weak concepts appear once there is evidence to rank them —
        studying something is what produces that evidence.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {concepts.map((concept) => (
        <li key={concept.conceptId} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{concept.title}</span>
              {concept.evidence.provisional ? (
                <Badge variant="outline" className="text-[10px]">
                  provisional
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {concept.evidence.evidenceCount}{' '}
              {concept.evidence.evidenceCount === 1 ? 'observation' : 'observations'}
              {concept.evidence.lastEvidenceAt
                ? ` · last ${concept.evidence.lastEvidenceAt.slice(0, 10)}`
                : ''}
              {` · exam weight ${Math.round(concept.examWeight * 100)}%`}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-mono text-sm tabular-nums">
              {Math.round(concept.mastery * 100)}%
            </div>
            <div className="text-[11px] text-subtle-foreground">mastery</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
