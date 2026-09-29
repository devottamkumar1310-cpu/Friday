'use client';

import { useState } from 'react';
import { ApiClientError } from '@friday/contracts';
import { Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from '@friday/ui';
import { PracticeRunner, type PracticeQuestion } from '@/components/practice/practice-runner';

export function MockTestStarter({
  goalId,
  conceptIds,
}: {
  goalId: string;
  conceptIds: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{
    attemptId: string;
    questions: PracticeQuestion[];
    servedFromCache: boolean;
  } | null>(null);

  if (session) {
    // We reuse PracticeRunner for the actual answering flow.
    // In a future Phase 5 expansion, we would add sectional timing here.
    return (
      <PracticeRunner
        attemptId={session.attemptId}
        questions={session.questions}
        servedFromCache={session.servedFromCache}
      />
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/assessments/mock-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId, questionCount: 15, difficulty: 4 }),
      });
      if (!res.ok) throw new Error('Failed to create mock test');
      const result = await res.json();
      
      setSession({
        attemptId: result.data.attemptId,
        questions: result.data.questions as PracticeQuestion[],
        servedFromCache: result.data.servedFromCache,
      });
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not generate Mock Test. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Full Mock Test</CardTitle>
        <CardDescription>
          A comprehensive assessment across your entire curriculum.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Callout tone="warning" title="Test generation failed">
            {error}
          </Callout>
        )}

        <div className="rounded border bg-muted/20 p-4 space-y-2">
          <p className="font-medium text-sm">Test Configuration</p>
          <ul className="text-sm text-muted-foreground list-disc pl-4">
            <li>Length: 15 questions</li>
            <li>Scope: All curriculum concepts</li>
            <li>Difficulty: Advanced (Level 4)</li>
          </ul>
        </div>

        <Button size="lg" className="w-full" onClick={start} disabled={busy || conceptIds.length === 0}>
          {busy ? (
            <Spinner label="Generating your Mock Test…" />
          ) : (
            'Start Mock Test'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
