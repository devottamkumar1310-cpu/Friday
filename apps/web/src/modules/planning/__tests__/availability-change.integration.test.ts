import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLearner,
  destroyLearner,
  liveMinutes,
  liveTasks,
  minutesByDay,
  setTaskStatus,
  snapshotLedger,
  type Ledger,
  type LedgerTask,
  type Learner,
} from './fixtures';
import { setAvailability } from '../../identity/settings.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * Availability adaptation, in both directions, on real rows.
 *
 * A study plan is a promise about the learner's calendar, so the moment their
 * calendar changes the promise is void. The failure this guards against is the
 * quiet one: the learner gives away four evenings a week, the app says "saved",
 * and the plan carries on slotting two hours into a Thursday that no longer
 * exists. Every day of that plan is now a small lie, and the learner discovers
 * it one missed evening at a time.
 *
 * Adapting downwards is the safety-critical direction and gets the most
 * assertions. But a planner that only ever shrinks is broken too — a learner who
 * frees up their week should get that time used, or FRIDAY is quietly wasting
 * the thing it is supposed to be managing.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function pending(ledger: Ledger): LedgerTask[] {
  return liveTasks(ledger).filter((t) => t.status === 'pending');
}

/** The shape `setAvailability` takes — the same payload the settings form posts. */
function everyDay(dailyMinutes: number) {
  const endHour = 9 + Math.floor(dailyMinutes / 60);
  const endMinute = dailyMinutes % 60;
  return {
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: '09:00:00',
      endTime: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
      kind: 'available' as const,
    })),
  };
}

function describe_(label: string, ledger: Ledger): string {
  const days = [...minutesByDay(pending(ledger)).entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${label}: v${ledger.planVersion} (${ledger.verdict}) avail=${ledger.availableMinutes}m ${days
    .map(([d, m]) => `${d.slice(5)}=${m}m`)
    .join(' ')}`;
}

describe('availability adaptation (database-backed, both directions)', () => {
  let learner: Learner;
  let initial: Ledger;
  let reduced: Ledger;
  let expanded: Ledger;
  let unchanged: Ledger;
  let startedTaskId: string;
  /** Captured while the reduced plan was the live one — see the spec below. */
  let reducedNextActionTaskId: string | null;

  beforeAll(async () => {
    // Two hours a day.
    learner = await createLearner({ dailyMinutes: 120, targetDays: 45 });
    initial = await snapshotLedger(learner);

    // The learner is mid-session on something when their week changes.
    const first = [...pending(initial)].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    )[0]!;
    startedTaskId = first.id;
    await setTaskStatus(startedTaskId, 'in_progress');

    // Term starts: two hours a day becomes thirty minutes.
    await setAvailability(learner.user, everyDay(30));
    reduced = await snapshotLedger(learner);

    // Asked *now*, while the 30-minute plan is the active one. Asking after the
    // later changes would be asking about a different plan.
    reducedNextActionTaskId =
      (await getNextAction(learner.user, learner.goal.id, 30)).action?.taskId ?? null;

    // Holidays: three hours a day.
    await setAvailability(learner.user, everyDay(180));
    expanded = await snapshotLedger(learner);

    // Saving the identical availability again must not churn the plan.
    await setAvailability(learner.user, everyDay(180));
    unchanged = await snapshotLedger(learner);

    // eslint-disable-next-line no-console -- the progression IS the evidence
    console.log(
      [
        '',
        '────────── AVAILABILITY ──────────',
        describe_('120m/day (initial)', initial),
        describe_(' 30m/day (reduced)', reduced),
        describe_('180m/day (expanded)', expanded),
        describe_('180m/day (re-saved)', unchanged),
        '──────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  // ── DOWNWARDS ───────────────────────────────────────────────────────────

  it('a large reduction actually triggers a re-plan', () => {
    expect(reduced.planVersion!).toBeGreaterThan(initial.planVersion!);
    expect(reduced.planReason).toBe('availability_changed');
  });

  it('the new plan fits the reduced capacity — no impossible day', () => {
    for (const [date, minutes] of minutesByDay(pending(reduced))) {
      expect(minutes, `${date} must fit 30 minutes`).toBeLessThanOrEqual(30);
    }
    expect(reduced.availableMinutes!).toBeLessThan(initial.availableMinutes!);
  });

  it('old pending tasks are retired, not left behind at the old capacity', () => {
    const stale = pending(reduced).filter((t) => t.planId === initial.planId);
    expect(stale.map((t) => `${t.conceptTitle} @ ${t.scheduledDate}`)).toStrictEqual([]);
  });

  it('in-progress work survives the constraint change', () => {
    const row = reduced.allTasks.find((t) => t.id === startedTaskId);
    expect(row?.status).toBe('in_progress');
  });

  it('no concept is scheduled twice', () => {
    const withConcept = pending(reduced).filter((t) => t.conceptId);
    expect(new Set(withConcept.map((t) => t.conceptId)).size).toBe(withConcept.length);
  });

  it('the verdict tells the truth about a now-harder goal', () => {
    // Cutting capacity by three quarters must be allowed to say so. What FRIDAY
    // may not do is keep reporting `on_track` off the back of capacity the
    // learner has explicitly taken away.
    expect(['on_track', 'at_risk', 'not_feasible']).toContain(reduced.verdict);
    if (reduced.verdict === 'on_track') {
      expect(reduced.availableMinutes!).toBeGreaterThanOrEqual(reduced.requiredMinutes!);
    }
  });

  it('the next action is not a stale one from the pre-change plan', () => {
    expect(reducedNextActionTaskId, 'a 30-minute day still has work that fits').not.toBeNull();

    const row = reduced.allTasks.find((t) => t.id === reducedNextActionTaskId);
    expect(row, 'the recommendation must come from the post-change plan').toBeDefined();
    expect(row!.planId).toBe(reduced.planId);
    expect(row!.planStatus).toBe('active');
    expect(row!.estimatedMinutes).toBeLessThanOrEqual(30);
    expect(row!.scheduledDate >= todayIso()).toBe(true);
  });

  // ── UPWARDS ─────────────────────────────────────────────────────────────

  it('an increase is adapted to as well — the planner expands', () => {
    expect(expanded.planVersion!).toBeGreaterThan(reduced.planVersion!);
    expect(expanded.availableMinutes!).toBeGreaterThan(reduced.availableMinutes!);

    // Freed-up time is actually used: more work is brought into the near
    // horizon than the 30-minute week could hold.
    expect(liveMinutes(expanded)).toBeGreaterThan(liveMinutes(reduced));
  });

  it('the expanded plan still respects the new per-day ceiling', () => {
    for (const [date, minutes] of minutesByDay(pending(expanded))) {
      expect(minutes, `${date} must fit 180 minutes`).toBeLessThanOrEqual(180);
    }
  });

  it('expanding does not duplicate or strand anything', () => {
    const withConcept = pending(expanded).filter((t) => t.conceptId);
    expect(new Set(withConcept.map((t) => t.conceptId)).size).toBe(withConcept.length);
    expect(pending(expanded).filter((t) => t.planId !== expanded.planId)).toStrictEqual([]);
  });

  // ── NO-OP ───────────────────────────────────────────────────────────────

  it('re-saving identical availability does not churn the plan', () => {
    /**
     * The materiality gate's actual job, on the trigger most likely to fire
     * spuriously — a settings form that posts on every blur. Saving the same
     * numbers must be free.
     */
    expect(unchanged.planVersion).toBe(expanded.planVersion);
    expect(unchanged.planId).toBe(expanded.planId);
  });
});
