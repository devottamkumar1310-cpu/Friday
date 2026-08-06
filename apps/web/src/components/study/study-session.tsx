'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, X } from 'lucide-react';
import { ApiClientError, ERROR_CODES, type FsrsRatingSchema } from '@friday/contracts';
import type { z } from 'zod';
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Textarea,
  toast,
} from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * The study session — the screen where learning actually happens, and the one
 * that produces the evidence everything else is computed from.
 *
 * Timing is **client-displayed but server-authoritative**: this counter is for
 * the learner's benefit, and the minutes sent on completion are what the
 * server records. The clock is wall-time based rather than an interval
 * accumulator, so a backgrounded tab (where browsers throttle timers) does not
 * silently under-count the session.
 */

type Rating = z.infer<typeof FsrsRatingSchema>;

export interface StudyConcept {
  id: string;
  title: string;
  description: string | null;
  mastery: number;
  estimatedMinutes: number;
}

const RATINGS: { value: Rating; label: string; help: string }[] = [
  { value: 'again', label: 'Again', help: "Didn't stick — I'd get this wrong now" },
  { value: 'hard', label: 'Hard', help: 'Got there, but it was a struggle' },
  { value: 'good', label: 'Good', help: 'Solid — I could do this again' },
  { value: 'easy', label: 'Easy', help: 'Effortless, I already knew it' },
];

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function StudySession({
  taskId,
  goalId,
  taskTitle,
  taskType,
  estimatedMinutes,
  concepts,
  existingSessionId,
}: {
  taskId: string;
  goalId: string;
  taskTitle: string;
  taskType: string;
  estimatedMinutes: number;
  concepts: StudyConcept[];
  existingSessionId: string | null;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  // Wall-clock anchors, so throttled timers cannot lose time.
  const startedAtRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  // Set once the session is finishing, so the unload warning does not fire on
  // our own navigation away.
  const leavingRef = useRef(false);

  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!sessionId || paused) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();

    const tick = () => {
      const anchor = startedAtRef.current;
      if (anchor === null) return;
      setElapsedSeconds(accumulatedRef.current + Math.floor((Date.now() - anchor) / 1000));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sessionId, paused]);

  // Leaving mid-session loses the timer, and the session stays open server-side
  // (E-19 would then block the next start). Warn rather than lose it silently.
  useEffect(() => {
    if (!sessionId) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [sessionId]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.call('startSession', {
        body: { goalId, taskId, originatedFrom: 'recommendation' },
      });
      setSessionId(result.data.id);
      startedAtRef.current = Date.now();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === ERROR_CODES.SESSION_ALREADY_ACTIVE) {
        setError(
          'You already have a session running. Finish or abandon that one before starting another.',
        );
      } else {
        setError(e instanceof ApiClientError ? e.message : 'Could not start the session.');
      }
    } finally {
      setStarting(false);
    }
  }, [goalId, taskId]);

  function togglePause() {
    setPaused((wasPaused) => {
      if (wasPaused) {
        startedAtRef.current = Date.now();
        return false;
      }
      const anchor = startedAtRef.current;
      if (anchor !== null) accumulatedRef.current += Math.floor((Date.now() - anchor) / 1000);
      startedAtRef.current = null;
      return true;
    });
  }

  async function complete() {
    if (!sessionId) return;
    const rated = concepts.filter((c) => ratings[c.id]);
    if (rated.length === 0) {
      setError('Rate at least one concept — that rating is what moves your mastery.');
      return;
    }

    setCompleting(true);
    setError(null);
    try {
      const result = await api.call('completeSession', {
        params: { sessionId },
        body: {
          activeMinutes: Math.max(1, Math.round(elapsedSeconds / 60)),
          ratings: rated.map((c) => ({ conceptId: c.id, rating: ratings[c.id]! })),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });

      // Showing the delta is the point (pain point P10): invisible progress is
      // why study tools get abandoned.
      const delta = result.data.changes.mastery[0];
      toast.success(
        delta
          ? `Mastery ${Math.round(delta.before * 100)}% → ${Math.round(delta.after * 100)}%`
          : 'Session recorded.',
      );
      leavingRef.current = true;
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the session.');
    } finally {
      setCompleting(false);
    }
  }

  async function abandon() {
    if (!sessionId) {
      router.push('/dashboard');
      return;
    }
    try {
      await api.call('abandonSession', { params: { sessionId } });
      toast('Session abandoned — nothing was recorded.');
    } catch {
      // Best effort: the learner is leaving either way.
    }
    leavingRef.current = true;
    router.push('/dashboard');
    router.refresh();
  }

  const overrun = elapsedSeconds > estimatedMinutes * 60;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{taskType}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{taskTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Planned for {estimatedMinutes} minutes
          </p>
        </div>

        <div className="text-right">
          <div
            className={
              overrun
                ? 'font-mono text-4xl tabular-nums text-warning'
                : 'font-mono text-4xl tabular-nums'
            }
            role="timer"
            aria-live="off"
          >
            {formatClock(elapsedSeconds)}
          </div>
          <p className="text-xs text-muted-foreground">
            {sessionId ? (paused ? 'Paused' : 'Running') : 'Not started'}
          </p>
        </div>
      </div>

      {error && (
        <Callout tone="danger" title="Something went wrong">
          {error}
        </Callout>
      )}

      {!sessionId ? (
        <Card>
          <CardHeader>
            <CardTitle>Ready when you are</CardTitle>
            <CardDescription>
              The clock starts when you do. FRIDAY records the time you actually spend, not the time
              you planned.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={start} disabled={starting}>
              {starting ? (
                <Spinner label="Starting…" />
              ) : (
                <>
                  <Play className="size-4" aria-hidden /> Start studying
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={() => router.push('/dashboard')}>
              Back
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={togglePause}>
              {paused ? (
                <>
                  <Play className="size-4" aria-hidden /> Resume
                </>
              ) : (
                <>
                  <Pause className="size-4" aria-hidden /> Pause
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={abandon}>
              <X className="size-4" aria-hidden /> Abandon
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>What you are covering</CardTitle>
              <CardDescription>
                When you finish, rate how each one went. That rating is the evidence FRIDAY uses to
                update your mastery and schedule the next review — so an honest answer is worth more
                than a generous one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {concepts.map((concept) => (
                <fieldset key={concept.id} className="space-y-3">
                  <legend className="text-sm font-medium">
                    {concept.title}
                    <span className="ml-2 font-normal text-muted-foreground">
                      currently {Math.round(concept.mastery * 100)}%
                    </span>
                  </legend>
                  {concept.description ? (
                    <p className="text-sm text-muted-foreground">{concept.description}</p>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {RATINGS.map((option) => {
                      const selected = ratings[concept.id] === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setRatings((prev) => ({ ...prev, [concept.id]: option.value }))
                          }
                          className={
                            selected
                              ? 'rounded-md border border-primary bg-primary/10 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                              : 'rounded-md border border-border px-3 py-2 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                          }
                        >
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="block text-xs text-muted-foreground">{option.help}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              <div className="space-y-1.5">
                <label htmlFor="notes" className="text-sm font-medium">
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything you want to remember — what confused you, what clicked."
                  maxLength={2000}
                />
              </div>

              <Button onClick={complete} disabled={completing} className="w-full sm:w-auto">
                {completing ? <Spinner label="Saving…" /> : 'Finish session'}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
