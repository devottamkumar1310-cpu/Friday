import Link from 'next/link';
import { Badge, Button } from '@friday/ui';
import { ArrowRight, BrainCircuit } from 'lucide-react';

export interface WeakConceptView {
  conceptId: string;
  title: string;
  mastery: number;
  examWeight: number;
  goalId: string;
  evidence?: {
    evidenceCount: number;
    beliefConfidence: number;
    lastEvidenceAt: string | null;
    provisional: boolean;
  };
}

export function WeakConceptList({ goalId, concepts }: { goalId: string; concepts: WeakConceptView[] }) {
  if (concepts.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        FRIDAY needs more evidence to identify weak concepts. Keep studying.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {concepts.map((concept) => (
        <div key={concept.conceptId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-muted transition-colors">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="truncate text-base font-semibold text-foreground">{concept.title}</span>
              {concept.evidence?.provisional && (
                <Badge variant="outline" className="text-[10px] bg-background/50">Provisional</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
               <span className="flex items-center gap-1 font-mono text-warning">
                  <BrainCircuit className="size-3" aria-hidden />
                  {Math.round(concept.mastery * 100)}% Mastery
                </span>
               <span className="text-border-strong">•</span>
               <span>{Math.round(concept.examWeight * 100)}% Exam Weight</span>
               
               {concept.evidence && (
                 <>
                   <span className="text-border-strong">•</span>
                   <span>
                     {concept.evidence.evidenceCount} {concept.evidence.evidenceCount === 1 ? 'observation' : 'observations'}
                   </span>
                 </>
               )}
            </div>
          </div>

          <div className="shrink-0 flex items-center">
            <Button asChild size="sm" variant="secondary" className="w-full sm:w-auto font-medium">
              <Link href={`/root-cause?goalId=${goalId}&weakConceptId=${concept.conceptId}`}>
                Follow the root cause
                <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
