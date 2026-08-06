'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Flag, XCircle } from 'lucide-react';
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
  Spinner,
  toast,
} from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * Practice runner — roadmap 2.8's flow, given a face.
 *
 * Answers are graded server-side one at a time and the explanation is returned
 * immediately, because feedback at the moment of being wrong is when it lands.
 * Mastery is *not* moved per question — it updates on submit from attempt-level
 * accuracy, which is what §5.2's evidence weighting is designed around.
 */

export interface PracticeQuestion {
  id: string;
  type: string;
  stem: string;
  options?: { id: string; text: string }[] | null;
}

interface Graded {
  isCorrect: boolean;
  correctAnswer: { selected?: string[]; value?: string };
  explanation: string;
}

export function PracticeRunner({
  attemptId,
  questions,
  servedFromCache,
}: {
  attemptId: string;
  questions: PracticeQuestion[];
  servedFromCache: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [busy, setBusy] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState<{
    score: number;
    maxScore: number;
    masteryChanges: { conceptId: string; before: number; after: number; delta: number }[];
  } | null>(null);

  const question = questions[index];
  const isLast = index === questions.length - 1;

  async function submitAnswer() {
    if (!question || selected === null) return;
    setBusy(true);
    try {
      const result = await api.call('submitResponse', {
        params: { attemptId },
        body: { questionId: question.id, answer: { selected: [selected] } },
      });
      setGraded(result.data as Graded);
      if (result.data.isCorrect) setCorrectCount((c) => c + 1);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Could not submit that answer.');
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (!isLast) {
      setIndex((i) => i + 1);
      setSelected(null);
      setGraded(null);
      return;
    }

    setBusy(true);
    try {
      const result = await api.call('submitAttempt', { params: { attemptId } });
      setFinished({
        score: result.data.score,
        maxScore: result.data.maxScore,
        masteryChanges: result.data.masteryChanges,
      });
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Could not finish the set.');
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    if (!question) return;
    try {
      await api.call('reportQuestion', { params: { questionId: question.id } });
      toast('Reported. Repeated reports quarantine a question.');
    } catch {
      toast.error('Could not report that question.');
    }
  }

  if (finished) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {finished.score} of {finished.maxScore} correct
          </CardTitle>
          <CardDescription>
            Your answers are now evidence — mastery and review dates have been updated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {finished.masteryChanges.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {finished.masteryChanges.map((change) => (
                <li key={change.conceptId} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-muted-foreground">Mastery updated</span>
                  <span className="font-mono text-xs tabular-nums">
                    {Math.round(change.before * 100)}% → {Math.round(change.after * 100)}%
                    <span className={change.delta >= 0 ? 'ml-2 text-success' : 'ml-2 text-warning'}>
                      {change.delta >= 0 ? '+' : ''}
                      {Math.round(change.delta * 100)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => router.push('/dashboard')}>Back to Mission Control</Button>
            <Button variant="secondary" onClick={() => router.push('/progress')}>
              See progress
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!question) {
    return (
      <Callout tone="warning" title="No questions available">
        There are no practice questions for these concepts yet.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Question {index + 1} of {questions.length} · {correctCount} correct so far
        </p>
        {!servedFromCache && <Badge variant="ai">newly generated</Badge>}
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
        aria-label="Practice progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-normal leading-relaxed">{question.stem}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2" disabled={!!graded}>
            <legend className="sr-only">Answer options</legend>
            {(question.options ?? []).map((option) => {
              const isChosen = selected === option.id;
              const isRight = graded?.correctAnswer.selected?.includes(option.id);
              const showWrong = graded && isChosen && !graded.isCorrect;

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isChosen}
                  onClick={() => setSelected(option.id)}
                  className={[
                    'flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    graded && isRight ? 'border-success bg-success/10' : '',
                    showWrong ? 'border-destructive bg-destructive/10' : '',
                    !graded && isChosen ? 'border-primary bg-primary/5' : '',
                    !graded && !isChosen ? 'border-border hover:border-border-strong' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs uppercase text-muted-foreground">
                    {option.id}
                  </span>
                  <span className="flex-1">{option.text}</span>
                  {graded && isRight ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Correct" />
                  ) : null}
                  {showWrong ? (
                    <XCircle className="size-4 shrink-0 text-destructive" aria-label="Incorrect" />
                  ) : null}
                </button>
              );
            })}
          </fieldset>

          {graded && (
            <Callout
              tone={graded.isCorrect ? 'success' : 'warning'}
              title={graded.isCorrect ? 'Correct' : 'Not quite'}
            >
              {graded.explanation}
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!graded ? (
              <Button onClick={submitAnswer} disabled={selected === null || busy}>
                {busy ? <Spinner label="Checking…" /> : 'Check answer'}
              </Button>
            ) : (
              <Button onClick={next} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : isLast ? 'Finish' : 'Next question'}
              </Button>
            )}

            <Button variant="ghost" size="sm" onClick={report}>
              <Flag className="size-4" aria-hidden /> Report a problem
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
