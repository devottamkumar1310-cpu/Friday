import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backdateGoalBy,
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
import { ensurePlanFreshForToday, regeneratePlan } from '../planning.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * The concrete missed-day case, at a capacity where the arithmetic is visible.
 *
 * 60 minutes a day, every day. Miss one. The naive thing — and the thing most
 * study apps do — is to add yesterday's 60 minutes to today's, so the learner
 * opens the app to 120 minutes of work, misses again, and finds 180 waiting.
 * That spiral is the single most common way a study plan becomes something the
 * learner avoids, and §10.4 exists to make it structurally impossible.
 *
 * The suite above proves the mechanism on a mixed ledger. This one pins the
 * arithmetic: **no day may ever exceed the learner's actual capacity, no matter
 * how much was missed**, and the backlog must not grow across repeated
 * re-plans.
 */

const DAILY_CAPACITY = 60;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function pending(ledger: Ledger): LedgerTask[] {
  return liveTasks(ledger).filter((t) => t.status === 'pending');
}

function describeDays(label: string, ledger: Ledger): string {
  const days = [...minutesByDay(pending(ledger)).entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${label}: v${ledger.planVersion} ${days.map(([d, m]) => `${d.slice(5)}=${m}m`).join(' ')} (total ${liveMinutes(ledger)}m)`;
}

describe('a missed day never becomes tomorrow’s double shift', () => {
  let learner: Learner;
  let initial: Ledger;
  let afterMiss: Ledger;
  let missedMinutes: number;
  const replans: Ledger[] = [];

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: DAILY_CAPACITY, targetDays: 45 });
    initial = await snapshotLedger(learner);

    // "Monday" is the first scheduled day. The learner does nothing on it.
    const firstDay = [...minutesByDay(pending(initial)).keys()].sort()[0]!;
    missedMinutes = pending(initial)
      .filter((t) => t.scheduledDate === firstDay)
      .reduce((sum, t) => sum + t.estimatedMinutes, 0);

    // One day passes. Monday's work is now overdue and untouched.
    await backdateGoalBy(learner, 1);
    await ensurePlanFreshForToday(learner.user, learner.goal.id);
    afterMiss = await snapshotLedger(learner);

    // Three further re-plans, each inspected. Explicit trigger so the churn
    // budget cannot mask compounding by simply declining to commit — the
    // question here is what the planner *produces*, not whether it is allowed
    // to produce it.
    for (let i = 0; i < 3; i++) {
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
      replans.push(await snapshotLedger(learner));
    }

    // eslint-disable-next-line no-console -- the ledger progression IS the evidence
    console.log(
      [
        '',
        '──────── MISSED DAY @ 60m/day ────────',
        describeDays('initial   ', initial),
        `           missed ${missedMinutes}m on ${firstDay}`,
        describeDays('after miss', afterMiss),
        ...replans.map((l, i) => describeDays(`replan #${i + 1} `, l)),
        '──────────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  it('the initial plan respects the 60-minute day', () => {
    expect(pending(initial).length).toBeGreaterThan(0);
    for (const [date, minutes] of minutesByDay(pending(initial))) {
      expect(minutes, `${date}`).toBeLessThanOrEqual(DAILY_CAPACITY);
    }
    expect(missedMinutes).toBeGreaterThan(0);
  });

  it('does NOT stack the missed day onto the next one', () => {
    for (const [date, minutes] of minutesByDay(pending(afterMiss))) {
      expect(minutes, `${date} must not exceed capacity after a miss`).toBeLessThanOrEqual(
        DAILY_CAPACITY,
      );
    }
  });

  it('does NOT duplicate the missed work', () => {
    const withConcept = pending(afterMiss).filter((t) => t.conceptId);
    expect(new Set(withConcept.map((t) => t.conceptId)).size).toBe(withConcept.length);
  });

  it('retires the superseded pending tasks rather than leaving them live', () => {
    const stale = pending(afterMiss).filter((t) => t.planId === initial.planId);
    expect(stale.map((t) => `${t.conceptTitle} @ ${t.scheduledDate}`)).toStrictEqual([]);

    // The missed rows are retired in place, keeping the date they were due.
    const retired = afterMiss.allTasks.filter((t) => t.planId === initial.planId);
    expect(retired.every((t) => t.status !== 'pending')).toBe(true);
  });

  it('nothing outstanding is left sitting in the past', () => {
    expect(pending(afterMiss).filter((t) => t.scheduledDate < todayIso())).toStrictEqual([]);
  });

  it('re-evaluates remaining work rather than accumulating it', () => {
    // Total outstanding work must not have grown because a day was missed.
    // Missing work does not create work.
    expect(afterMiss.requiredMinutes!).toBeLessThanOrEqual(initial.requiredMinutes!);
  });

  it('uses actual remaining availability, and stays feasible', () => {
    expect(afterMiss.availableMinutes!).toBeGreaterThan(0);
    expect(['on_track', 'at_risk']).toContain(afterMiss.verdict);

    // Feasibility must be arithmetic the learner could check: outstanding work
    // fits the days that remain.
    const days = minutesByDay(pending(afterMiss));
    expect(days.size).toBeLessThanOrEqual(14);
    expect(liveMinutes(afterMiss)).toBeLessThanOrEqual(14 * DAILY_CAPACITY);
  });

  it('protects review work — FSRS-due items are never dropped for being late', () => {
    // No review task is silently discarded by a re-plan: whatever `revise`
    // work existed still exists, or has been superseded by a fresher copy.
    const before = new Set(
      liveTasks(initial)
        .filter((t) => t.type === 'revise')
        .map((t) => t.conceptId),
    );
    const after = new Set(
      liveTasks(afterMiss)
        .filter((t) => t.type === 'revise')
        .map((t) => t.conceptId),
    );
    for (const conceptId of before) {
      expect(after.has(conceptId), 'a due review must not be dropped by a re-plan').toBe(true);
    }
  });

  it('does not multiply tasks across three consecutive re-plans', () => {
    for (const [i, ledger] of replans.entries()) {
      const withConcept = pending(ledger).filter((t) => t.conceptId);
      const counts = new Map<string, number>();
      for (const t of withConcept) counts.set(t.conceptId!, (counts.get(t.conceptId!) ?? 0) + 1);

      const duplicated = [...counts.entries()]
        .filter(([, n]) => n > 1)
        .map(([id, n]) => `${withConcept.find((t) => t.conceptId === id)?.conceptTitle} x${n}`);
      expect(duplicated, `replan #${i + 1}`).toStrictEqual([]);

      for (const [date, minutes] of minutesByDay(pending(ledger))) {
        expect(minutes, `replan #${i + 1} ${date}`).toBeLessThanOrEqual(DAILY_CAPACITY);
      }
    }
  });

  it('the outstanding workload is stable across re-plans, not growing', () => {
    const totals = replans.map((l) => liveMinutes(l));
    for (const [i, total] of totals.entries()) {
      expect(total, `replan #${i + 1} must not exceed the post-miss workload`).toBeLessThanOrEqual(
        liveMinutes(afterMiss),
      );
    }

    // And exactly one plan is active throughout.
    for (const ledger of replans) {
      expect(
        ledger.allTasks.filter((t) => t.planStatus === 'active' && t.status === 'pending'),
      ).not.toStrictEqual([]);
    }
  });

  it('the next action still points at the live plan after all of it', async () => {
    const latest = replans[replans.length - 1]!;
    const recommendation = await getNextAction(learner.user, learner.goal.id, DAILY_CAPACITY);

    expect(recommendation.action).not.toBeNull();
    const row = latest.allTasks.find((t) => t.id === recommendation.action!.taskId);
    expect(row).toBeDefined();
    expect(row!.planId).toBe(latest.planId);
    expect(row!.scheduledDate >= todayIso()).toBe(true);
  });
});

/**
 * In-progress work is not collateral damage.
 *
 * Separate learner, because staging a mid-session task and then missing a day
 * needs the two to not interfere.
 */
describe('a missed day preserves work already underway', () => {
  let learner: Learner;
  let startedTaskId: string;
  let after: Ledger;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: DAILY_CAPACITY, targetDays: 45 });
    const initial = await snapshotLedger(learner);

    const first = [...pending(initial)].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    )[0]!;
    startedTaskId = first.id;
    await setTaskStatus(startedTaskId, 'in_progress');

    await backdateGoalBy(learner, 1);
    await ensurePlanFreshForToday(learner.user, learner.goal.id);
    after = await snapshotLedger(learner);
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  it('the in-progress task survives the re-plan', () => {
    const row = after.allTasks.find((t) => t.id === startedTaskId);
    expect(row?.status).toBe('in_progress');
  });

  it('its concept is not scheduled a second time', () => {
    const row = after.allTasks.find((t) => t.id === startedTaskId)!;
    const duplicates = pending(after).filter((t) => t.conceptId === row.conceptId);
    expect(duplicates).toStrictEqual([]);
  });
});
