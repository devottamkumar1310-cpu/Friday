'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Pause, Play, X } from 'lucide-react';
import { ApiClientError, ERROR_CODES, type FsrsRatingSchema } from '@friday/contracts';
import { reinforceCompletion } from '@friday/core';
import type { z } from 'zod';
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Textarea,
} from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * The study session.
 *
 * This is where learning actually happens and where the evidence everything
 * else is computed from is produced — so it is the one screen that should not
 * feel like the rest of the app. It used to feel exactly like the rest of the
 * app: full navigation overhead, a small left-aligned clock, and the entire
 * "how did it go" form live from second zero, which meant the screen asked you
 * to rate a session you had not had yet.
 *
 * It is now a **mode with three phases**:
 *
 *   focus   — the clock, the concepts, and one way to stop. Nothing else, and
 *             the app chrome is covered.
 *   rating  — asked *after* the work, which is the only time the answer means
 *             anything.
 *   done    — the mastery change shown as a screen you can read, instead of a
 *             four-second toast fired while the page navigates away.
 *
 * **Timing is server-authoritative.** The elapsed clock is derived from the
 * session row's `started_at`, not from React state, so navigating away and back
 * — or reloading, or switching device — resumes the real elapsed time. Before
 * this, leaving the page reset the clock to zero and finishing recorded one
 * minute against an hour of work.
 */

type Rating = z.infer<typeof FsrsRatingSchema>;
type Phase = 'idle' | 'focus' | 'rating' | 'done';

export interface StudyConcept {
  id: string;
  title: string;
  description: string | null;
  mastery: number;
  estimatedMinutes: number;
}

/** Asked about capability, not feeling — cheaper to answer and harder to game. */
const RATINGS: { value: Rating; label: string; help: string }[] = [
  { value: 'again', label: 'Not really', help: 'I would get this wrong now' },
  { value: 'hard', label: 'Roughly', help: 'I could, but it was a struggle' },
  { value: 'good', label: 'Yes', help: 'Solid — I could do this again' },
  { value: 'easy', label: 'Easily', help: 'Effortless, I already knew it' },
];

/** Local scratch for the things the server does not model: pause and drafts. */
interface LocalDraft {
  pausedMs: number;
  pausedAt: number | null;
  ratings: Record<string, Rating>;
  notes: string;
}

const EMPTY_DRAFT: LocalDraft = { pausedMs: 0, pausedAt: null, ratings: {}, notes: '' };

function draftKey(sessionId: string): string {
  return `friday:session:${sessionId}`;
}

function readDraft(sessionId: string): LocalDraft {
  if (typeof window === 'undefined') return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(draftKey(sessionId));
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<LocalDraft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

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
  existingSessionStartedAt,
}: {
  taskId: string;
  goalId: string;
  taskTitle: string;
  taskType: string;
  estimatedMinutes: number;
  concepts: StudyConcept[];
  existingSessionId: string | null;
  existingSessionStartedAt: string | null;
}) {
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    existingSessionStartedAt ? Date.parse(existingSessionStartedAt) : null,
  );
  // Resuming an already-running session lands straight in focus, not on a
  // "ready when you are" card for something already under way.
  const [phase, setPhase] = useState<Phase>(existingSessionId ? 'focus' : 'idle');

  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pausedMs, setPausedMs] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState<
    { conceptId: string; before: number; after: number; delta: number }[] | null
  >(null);
  /**
   * When FRIDAY will bring each concept back.
   *
   * The completion response has always carried this — `nextDue` and
   * `intervalDays`, straight from the FSRS write — and the screen threw it away
   * and printed a sentence about review timing instead. The learner was told
   * the trick existed without being shown it happening to them.
   */
  const [review, setReview] = useState<
    { conceptId: string; nextDue: string; intervalDays: number }[] | null
  >(null);

  const leavingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Rehydrate pause and any half-written answers for a session already running.
  useEffect(() => {
    if (!existingSessionId) return;
    const draft = readDraft(existingSessionId);
    setPausedMs(draft.pausedMs);
    setPausedAt(draft.pausedAt);
    setRatings(draft.ratings);
    setNotes(draft.notes);
  }, [existingSessionId]);

  // Persist the parts the server does not know about.
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        draftKey(sessionId),
        JSON.stringify({ pausedMs, pausedAt, ratings, notes } satisfies LocalDraft),
      );
    } catch {
      // A full or disabled localStorage must not break a session. The clock is
      // server-derived regardless; only pause and drafts are at stake.
    }
  }, [sessionId, pausedMs, pausedAt, ratings, notes]);

  /**
   * Elapsed time, derived rather than accumulated.
   *
   * `now - startedAt - pausedTime`. Because both anchors are absolute, a
   * throttled background tab, a reload, or a ten-minute detour into another app
   * all resolve to the correct number on the next tick.
   */
  useEffect(() => {
    if (startedAtMs === null || phase === 'done') return;

    const tick = () => {
      const frozen = pausedAt !== null ? Date.now() - pausedAt : 0;
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAtMs - pausedMs - frozen) / 1000)),
      );
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs, pausedMs, pausedAt, phase]);

  // Leaving mid-session no longer loses the clock, but it does leave the
  // session open server-side, and E-19 will then block the next start.
  useEffect(() => {
    if (!sessionId || phase === 'done') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [sessionId, phase]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.call('startSession', {
        body: { goalId, taskId, originatedFrom: 'recommendation' },
      });
      setSessionId(result.data.id);
      setStartedAtMs(Date.parse(result.data.startedAt) || Date.now());
      setPhase('focus');
    } catch (e) {
      if (e instanceof ApiClientError && e.code === ERROR_CODES.SESSION_ALREADY_ACTIVE) {
        setError('You already have a session running somewhere else.');
      } else {
        setError(e instanceof ApiClientError ? e.message : 'Could not start the session.');
      }
    } finally {
      setStarting(false);
    }
  }, [goalId, taskId]);

  function togglePause() {
    if (pausedAt === null) {
      setPausedAt(Date.now());
    } else {
      setPausedMs((ms) => ms + (Date.now() - pausedAt));
      setPausedAt(null);
    }
  }

  function clearDraft() {
    if (sessionId && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(draftKey(sessionId));
      } catch {
        /* nothing to do */
      }
    }
  }

  async function complete() {
    if (!sessionId) return;
    const rated = concepts.filter((c) => ratings[c.id]);
    if (rated.length === 0) {
      setError('Pick an answer for at least one topic — that is what moves your mastery.');
      errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

      clearDraft();
      leavingRef.current = true;
      // Shown as a screen, not a toast. This is the payoff of the whole loop
      // (pain point P10) and it used to vanish in four seconds mid-navigation.
      setOutcome(result.data.changes.mastery);
      setReview(result.data.changes.retention);
      setPhase('done');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the session.');
    } finally {
      setCompleting(false);
    }
  }

  async function abandon() {
    if (sessionId) {
      try {
        await api.call('abandonSession', { params: { sessionId } });
      } catch {
        // Best effort: the learner is leaving either way.
      }
      clearDraft();
    }
    leavingRef.current = true;
    router.push('/dashboard');
    router.refresh();
  }

  const minutes = Math.max(1, Math.round(elapsedSeconds / 60));
  const overrun = elapsedSeconds > estimatedMinutes * 60;

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="mx-auto max-w-md space-y-6 py-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10">
          <Check className="size-7 text-success" aria-hidden />
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {minutes} minute{minutes === 1 ? '' : 's'} done.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{taskTitle}</p>
        </div>

        {outcome && outcome.length > 0 ? (
          <Card>
            <CardContent className="space-y-4 pt-6">
              {outcome.map((change) => {
                const concept = concepts.find((c) => c.id === change.conceptId);
                return (
                  <div key={change.conceptId} className="space-y-2">
                    <p className="text-sm font-medium">{concept?.title ?? 'Topic'}</p>
                    <div className="flex items-center justify-center gap-3 text-2xl font-semibold tabular-nums">
                      <span className="text-muted-foreground">
                        {Math.round(change.before * 100)}%
                      </span>
                      <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
                      <span className="text-success">{Math.round(change.after * 100)}%</span>
                    </div>
                    {(() => {
                      // The scheduled review, named. This is the FSRS write that
                      // just happened, not a description of what FSRS does.
                      const due = review?.find((r) => r.conceptId === change.conceptId);
                      if (!due) return null;
                      const when =
                        due.intervalDays <= 0
                          ? 'later today'
                          : due.intervalDays === 1
                            ? 'tomorrow'
                            : `in ${due.intervalDays} days`;
                      return (
                        <p className="text-center text-xs text-muted-foreground">
                          Back {when} ·{' '}
                          {new Date(due.nextDue).toLocaleDateString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </p>
                      );
                    })()}
                  </div>
                );
              })}
              <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                Those dates are when you would be about to forget it. Coming back then is what makes
                it stick.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/*
          Reinforces what the learner *did*, not what it produced.

          This used to read "FRIDAY will adjust your plan based on this session.
          Come back tomorrow to see what moved up." — true, and about the system.
          The learner has just done the hard part, and the screen spent its one
          moment of their attention describing machinery.

          Mastery movement is still shown above, but it is not what gets praised:
          it is an outcome they did not directly control and cannot repeat on
          purpose. Sitting down and staying is the repeatable act, so that is the
          one named. The plan still re-derives itself either way.
        */}
        <p className="text-sm leading-relaxed">
          {reinforceCompletion({ activeMinutes: minutes, estimatedMinutes })}
        </p>

        <div className="space-y-2">
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              router.push('/dashboard');
              router.refresh();
            }}
          >
            See updated plan
          </Button>
        </div>
      </div>
    );
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{taskType}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{taskTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">About {estimatedMinutes} minutes</p>
        </div>

        {error && (
          <Callout tone="danger" title={error}>
            <Button variant="secondary" size="sm" onClick={() => router.push('/dashboard')}>
              Take me to it
            </Button>
          </Callout>
        )}

        <Card>
          <CardHeader>
            <CardTitle>What you are covering</CardTitle>
            <CardDescription>
              The clock starts when you do, and FRIDAY records the time you actually spend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {concepts.map((concept) => (
                <li key={concept.id} className="rounded-md border border-border px-3 py-2.5">
                  <p className="text-sm font-medium">{concept.title}</p>
                  {concept.description ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {concept.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            <Button size="lg" className="w-full" onClick={start} disabled={starting}>
              {starting ? (
                <Spinner label="Starting…" />
              ) : (
                <>
                  <Play className="size-4" aria-hidden /> Start studying
                </>
              )}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => router.push('/dashboard')}>
              Not now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Focus and rating ──────────────────────────────────────────────────────
  // `fixed inset-0` covers the app shell. Navigation during a session is a
  // distraction with no upside, and there is exactly one way out of here.
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="text-center">
          <p className="truncate text-sm text-muted-foreground">{taskTitle}</p>
          <div
            className={
              overrun
                ? 'mt-2 font-mono text-6xl font-light tabular-nums tracking-tight text-warning'
                : 'mt-2 font-mono text-6xl font-light tabular-nums tracking-tight'
            }
            role="timer"
            aria-live="off"
          >
            {formatClock(elapsedSeconds)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {pausedAt !== null ? 'Paused' : `of about ${estimatedMinutes} min`}
          </p>
        </header>

        {error && (
          <div ref={errorRef} className="mt-4">
            <Callout tone="warning" title={error} />
          </div>
        )}

        {phase === 'focus' ? (
          <>
            <div className="mt-8 flex-1">
              <ul className="space-y-2">
                {concepts.map((concept) => (
                  <li key={concept.id} className="rounded-lg border border-border px-4 py-3">
                    <p className="font-medium">{concept.title}</p>
                    {concept.description ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {concept.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 space-y-2">
              <Button size="lg" className="w-full" onClick={() => setPhase('rating')}>
                I&rsquo;m done studying
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={togglePause}>
                  {pausedAt !== null ? (
                    <>
                      <Play className="size-4" aria-hidden /> Resume
                    </>
                  ) : (
                    <>
                      <Pause className="size-4" aria-hidden /> Pause
                    </>
                  )}
                </Button>
                {/* Separated from Pause and confirmed: this used to sit twelve
                    pixels away and discard the session on a single tap. */}
                <Button variant="ghost" className="flex-1" onClick={() => setConfirmAbandon(true)}>
                  <X className="size-4" aria-hidden /> Discard
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-8 flex-1 space-y-6">
              <p className="text-sm text-muted-foreground">
                Answer honestly — this is what FRIDAY schedules your next review from. A generous
                answer only costs you later.
              </p>

              {concepts.map((concept) => (
                <fieldset key={concept.id} className="space-y-3">
                  <legend className="text-base font-medium">
                    Could you explain {concept.title} to someone right now?
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
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
                          className={[
                            'min-h-16 rounded-lg border px-3 py-2.5 text-left transition-colors',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:border-border-strong active:bg-muted',
                          ].join(' ')}
                        >
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {selected ? <Check className="size-4" aria-hidden /> : null}
                            {option.label}
                          </span>
                          <span
                            className={
                              selected
                                ? 'mt-0.5 block text-xs text-primary-foreground/80'
                                : 'mt-0.5 block text-xs text-muted-foreground'
                            }
                          >
                            {option.help}
                          </span>
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
                  placeholder="What confused you, what clicked."
                  maxLength={2000}
                />
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <Button size="lg" className="w-full" onClick={complete} disabled={completing}>
                {completing ? <Spinner label="Saving…" /> : 'Save and finish'}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setPhase('focus')}>
                Back to studying
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this session?</DialogTitle>
            <DialogDescription>
              Your {minutes} minute{minutes === 1 ? '' : 's'} will not be saved and nothing will
              change in your plan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmAbandon(false)}>
              Keep studying
            </Button>
            <Button variant="destructive" onClick={abandon}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
