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
  Input,
  Spinner,
  toast,
} from '@friday/ui';
import { api } from '@/lib/api/client';
import { inputModeFor } from './input-mode';

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
  const [typed, setTyped] = useState('');
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
  const mode = question ? inputModeFor(question) : 'unanswerable';
  const hasAnswer = mode === 'choice' ? selected !== null : typed.trim().length > 0;

  async function submitAnswer() {
    if (!question || !hasAnswer) return;
    setBusy(true);
    try {
      const result = await api.call('submitResponse', {
        params: { attemptId },
        body: {
          questionId: question.id,
          answer: mode === 'choice' ? { selected: [selected as string] } : { value: typed.trim() },
        },
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
      setTyped('');
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
          {/* "Question 1 of 1" announces a set that is over before it starts.
              A single question is a quick check, and saying so is honest. */}
          {questions.length === 1
            ? 'Quick check'
            : `Question ${index + 1} of ${questions.length} · ${correctCount} correct so far`}
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
          {mode === 'value' && (
            <div className="space-y-1.5">
              <label htmlFor="practice-answer" className="text-sm font-medium">
                Your answer
              </label>
              <Input
                id="practice-answer"
                // `inputMode` rather than `type="number"`, so a wrong keystroke
                // is visible and correctable instead of being silently dropped.
                inputMode={question.type === 'numeric' ? 'decimal' : 'text'}
                autoComplete="off"
                value={typed}
                disabled={!!graded}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !graded && hasAnswer) {
                    e.preventDefault();
                    void submitAnswer();
                  }
                }}
              />
              {question.type === 'numeric' ? (
                <p className="text-xs text-muted-foreground">
                  A number. Units are not needed — the stem states them.
                </p>
              ) : null}
            </div>
          )}

          {mode === 'unanswerable' && (
            <Callout tone="warning" title="This question cannot be displayed">
              It arrived in a format this screen does not know how to render. Skip it — it will not
              count against you — and report it so it can be fixed.
            </Callout>
          )}

          <fieldset className="space-y-2" disabled={!!graded} hidden={mode !== 'choice'}>
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
              {/* A typed answer has no option to highlight, so the correct
                  value has to be stated outright or the feedback is useless. */}
              {mode === 'value' && !graded.isCorrect && graded.correctAnswer.value ? (
                <p className="mb-1.5 font-medium">The answer is {graded.correctAnswer.value}.</p>
              ) : null}
              {graded.explanation}
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {mode === 'unanswerable' ? (
              <Button onClick={next} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : isLast ? 'Finish' : 'Skip this question'}
              </Button>
            ) : !graded ? (
              <Button onClick={submitAnswer} disabled={!hasAnswer || busy}>
                {busy ? <Spinner label="Checking…" /> : 'Check answer'}
              </Button>
            ) : (
              <Button onClick={next} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : isLast ? 'Finish' : 'Next question'}
              </Button>
            )}

            {/*
              Skip. A set with no way past a question the learner cannot answer
              is a dead end, and the honest options are "I do not know this" and
              "this question is broken" — not "answer or leave".

              It advances without submitting, so nothing is recorded as wrong:
              a skipped question is absence of evidence, not evidence of
              absence, and grading it would poison the mastery signal.
            */}
            {!graded ? (
              <Button variant="ghost" onClick={next} disabled={busy}>
                {isLast ? 'Skip and finish' : 'Skip'}
              </Button>
            ) : null}

            <Button variant="ghost" size="sm" onClick={report} className="ml-auto">
              <Flag className="size-4" aria-hidden /> Report a problem
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
