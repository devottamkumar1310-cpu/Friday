/**
 * `core/retention` — FSRS-5 wrapper (ADR-008). IMPLEMENTATION_ROADMAP 1.3.
 *
 * The only source of revision scheduling (DATABASE_DESIGN §4.6). Retrievability
 * `R` is computed at read time from `(stability, now - lastReviewAt)` and is
 * never persisted (§5.4) — storing it would mean rewriting every row daily.
 */

import { Rating, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';
import type { Card as FsrsCard, Grade, State } from 'ts-fsrs';
import type { FsrsRating, MemoryState } from '../types';

const engine = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: false }));

const RATING_MAP: Record<FsrsRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** §5.4 — unifies self-rating, accuracy, completion, and abandonment into one rating. */
export function deriveRatingFromAccuracy(accuracy: number): FsrsRating {
  if (accuracy < 0.4) return 'again';
  if (accuracy < 0.7) return 'hard';
  if (accuracy < 0.9) return 'good';
  return 'easy';
}

function toFsrsCard(state: MemoryState | null, now: Date): FsrsCard {
  if (!state) return createEmptyCard(now);
  return {
    due: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.lastReviewAt
      ? Math.max(0, Math.floor((now.getTime() - state.lastReviewAt.getTime()) / 86_400_000))
      : 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state as State,
    last_review: state.lastReviewAt ?? undefined,
  };
}

function fromFsrsCard(conceptId: string, card: FsrsCard): MemoryState {
  return {
    conceptId,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    lastReviewAt: card.last_review ?? now(),
    dueAt: card.due,
  };
}

function now(): Date {
  return new Date();
}

/**
 * Applies one review to a memory state (D3). Returns the new state — never
 * mutates the input, so the caller controls persistence (SYSTEM_ARCHITECTURE
 * A3: the domain core has no I/O).
 */
export function review(
  conceptId: string,
  state: MemoryState | null,
  rating: FsrsRating,
  at: Date = now(),
): MemoryState {
  const card = toFsrsCard(state, at);
  const outcome = engine.repeat(card, at);
  const chosen = outcome[RATING_MAP[rating]];
  if (!chosen) throw new Error(`FSRS repeat() did not return a card for rating "${rating}".`);
  return fromFsrsCard(conceptId, chosen.card);
}

/**
 * Retrievability `R(c)` — computed, never stored (§5.4). Undefined memory
 * (never studied) returns 0: "a concept you have never learned cannot be
 * forgotten" (§6.4) is enforced by the caller via `Established`, not here.
 */
export function retrievability(state: MemoryState | null, at: Date = now()): number {
  if (!state || state.reps === 0) return 0;
  const card = toFsrsCard(state, at);
  return engine.get_retrievability(card, at, false) as number;
}

export function isDue(state: MemoryState | null, at: Date = now()): boolean {
  if (!state) return false;
  return state.dueAt.getTime() <= at.getTime();
}

/** Days overdue, floor 0. Used to rank triage when many concepts are due at once (E-13). */
export function daysOverdue(state: MemoryState | null, at: Date = now()): number {
  if (!state) return 0;
  return Math.max(0, (at.getTime() - state.dueAt.getTime()) / 86_400_000);
}

/**
 * Forecasts the review load for the next `days`, for feasibility's
 * `projectedReviews` term (§9). Approximates by walking the interval schedule
 * forward under a "good" rating at each step — a reasonable expectation absent
 * a crystal ball, and it is what keeps a plan honest about future review debt.
 */
export function projectReviewCount(
  state: MemoryState | null,
  days: number,
  from: Date = now(),
): number {
  if (!state) return 0;
  let card = toFsrsCard(state, from);
  let cursor = from.getTime();
  const horizon = from.getTime() + days * 86_400_000;
  let count = 0;
  let guard = 0;
  while (card.due.getTime() <= horizon && guard < 1000) {
    guard++;
    const at = new Date(Math.max(cursor, card.due.getTime()));
    const outcome = engine.repeat(card, at);
    const chosen = outcome[Rating.Good]!;
    card = chosen.card;
    cursor = at.getTime();
    count++;
  }
  return count;
}
