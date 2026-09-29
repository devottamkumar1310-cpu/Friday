'use client';

import { useState } from 'react';
import { ApiClientError } from '@friday/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@friday/ui';
import { api } from '@/lib/api/client';
import { PracticeRunner, type PracticeQuestion } from './practice-runner';

export interface PracticeConcept {
  id: string;
  title: string;
  mastery: number;
  provisional: boolean;
}

export function PracticeStarter({
  goalId,
  concepts,
}: {
  goalId: string;
  concepts: PracticeConcept[];
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{
    attemptId: string;
    questions: PracticeQuestion[];
    servedFromCache: boolean;
  } | null>(null);

  // Solving mode: the picker's heading and explanation are gone, because the
  // question is the only thing that matters now.
  if (session) {
    return (
      <PracticeRunner
        attemptId={session.attemptId}
        questions={session.questions}
        servedFromCache={session.servedFromCache}
      />
    );
  }

  if (concepts.length === 0) {
    return (
      <EmptyState
        title="Nothing to practise yet"
        description="Practice targets concepts you have already studied. Complete a study session first, and they will appear here."
      />
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.call('createPracticeSet', {
        body: { goalId, conceptIds: chosen, questionCount: 5, difficulty: 3 },
      });
      setSession({
        attemptId: result.data.attemptId,
        questions: result.data.questions as PracticeQuestion[],
        servedFromCache: result.data.servedFromCache,
      });
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not build a practice set. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick what to practise</CardTitle>
        <CardDescription>Ranked by what it costs to leave weak.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Callout tone="warning" title="No practice set">
            {error}
          </Callout>
        )}

        <ul className="space-y-2">
          {concepts.map((concept) => {
            const active = chosen.includes(concept.id);
            return (
              <li key={concept.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setChosen((prev) =>
                      prev.includes(concept.id)
                        ? prev.filter((id) => id !== concept.id)
                        : [...prev, concept.id],
                    )
                  }
                  className={[
                    'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-border-strong',
                  ].join(' ')}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{concept.title}</span>
                    {concept.provisional ? (
                      <Badge variant="outline" className="text-[10px]">
                        provisional
                      </Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round(concept.mastery * 100)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <Button size="lg" className="w-full" onClick={start} disabled={chosen.length === 0 || busy}>
          {busy ? (
            <Spinner label="Building your set…" />
          ) : chosen.length > 0 ? (
            `Practise ${chosen.length} topic${chosen.length === 1 ? '' : 's'}`
          ) : (
            'Pick a topic to start'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
