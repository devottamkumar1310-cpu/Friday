'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { ApiClientError } from '@friday/contracts';
import { Badge, Button, toast } from '@friday/ui';
import { api } from '@/lib/api/client';

export interface FactView {
  id: string;
  category: string;
  statement: string;
  confidence: number;
  reinforcementCount: number;
  isUserEdited: boolean;
}

/**
 * FR-7.6: the learner can see, correct, and delete what FRIDAY believes.
 *
 * Deletion is a hard delete server-side, so the confirmation is real rather
 * than decorative — there is nothing to restore afterwards.
 */
export function FactList({ facts }: { facts: FactView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  if (facts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        FRIDAY has not formed any beliefs about you yet. These appear as it observes how you study —
        and every one will cite the evidence behind it.
      </p>
    );
  }

  async function remove(fact: FactView) {
    if (!window.confirm(`Delete this belief permanently?\n\n"${fact.statement}"`)) return;
    setPending(fact.id);
    try {
      await api.call('deleteFact', { params: { factId: fact.id } });
      toast.success('Deleted.');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Could not delete that belief.');
    } finally {
      setPending(null);
    }
  }

  return (
    <ul className="divide-y divide-border">
      {facts.map((fact) => (
        <li key={fact.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{fact.category.replace('_', ' ')}</Badge>
              {fact.isUserEdited ? <Badge variant="outline">edited by you</Badge> : null}
            </div>
            <p className="mt-1 text-sm">{fact.statement}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              confidence {fact.confidence.toFixed(2)} · seen {fact.reinforcementCount}×
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void remove(fact)}
            disabled={pending === fact.id}
            aria-label={`Delete belief: ${fact.statement}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
