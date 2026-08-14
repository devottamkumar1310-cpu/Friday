import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identifyMissedTasks } from '@friday/core';
import {
  backdateGoalBy,
  createLearner,
  destroyLearner,
  liveMinutes,
  liveTasks,
  listPlanVersions,
  setTaskStatus,
  snapshotLedger,
  type Ledger,
  type Learner,
} from './fixtures';
import { ensurePlanFreshForToday, regeneratePlan } from '../planning.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * Missed-work redistribution, proven against real rows.
 *
 * The claim under test is the one in AI_DECISION_ENGINE §10.4: FRIDAY does not
 * carry a backlog. Work the learner missed does not pile up and does not get
 * shoved into tomorrow — it goes back into the candidate pool and competes for
 * placement on merit, which means some of it legitimately never returns.
 *
 * That claim is easy to *assert* and hard to *prove*, because "the plan
 * version went up" is true of a re-plan that did nothing useful, and also of
 * one that quietly doubled the learner's workload. So every test here compares
 * whole ledgers — every task row for the goal, on every plan version — before
 * and after. The interesting failures all live in rows the active plan does
 * not mention.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function byConcept(tasks: ReturnType<typeof liveTasks>): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) {
    if (!t.conceptId) continue;
    m.set(t.conceptId, (m.get(t.conceptId) ?? 0) + 1);
  }
  return m;
}

function describeLedger(label: string, ledger: Ledger): string {
  const live = liveTasks(ledger);
  return [
    `${label}: plan v${ledger.planVersion} (${ledger.planReason}, ${ledger.verdict})`,
    `  rows total=${ledger.allTasks.length} live=${live.length} liveMinutes=${liveMinutes(ledger)}`,
    `  byStatus=${JSON.stringify(
      ledger.allTasks.reduce<Record<string, number>>((a, t) => {
        a[t.status] = (a[t.status] ?? 0) + 1;
        return a;
      }, {}),
    )}`,
    `  livePlanVersions=${JSON.stringify([...new Set(live.map((t) => t.planVersion))])}`,
  ].join('\n');
}

describe('missed-work redistribution (database-backed)', () => {
  let learner: Learner;
  let before: Ledger;
  let after: Ledger;
  let missedConceptIds: string[];
  let missedRows: ReturnType<typeof liveTasks>;
  let inProgressTaskId: string;
  let completedTaskId: string;
  let skippedTaskId: string;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });

    // Mark three *late* tasks with the states a real learner leaves behind, so
    // the re-plan has evidence to preserve. Taking them from the end of the
    // window rather than the start is what leaves the early days full of
    // untouched `pending` rows — which is the material the missed-work path
    // actually operates on.
    const initial = await snapshotLedger(learner);
    const byDate = [...initial.tasks].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    );
    expect(byDate.length).toBeGreaterThan(6);

    const late = byDate.slice(-3);
    completedTaskId = late[0]!.id;
    skippedTaskId = late[1]!.id;
    inProgressTaskId = late[2]!.id;
    await setTaskStatus(completedTaskId, 'completed');
    await setTaskStatus(skippedTaskId, 'skipped');
    await setTaskStatus(inProgressTaskId, 'in_progress');

    // Several days pass and none of the early work got done. Backdating the
    // goal is what makes those rows genuinely overdue.
    await backdateGoalBy(learner, 3);

    before = await snapshotLedger(learner);
    missedRows = liveTasks(before).filter(
      (t) => t.status === 'pending' && t.scheduledDate < todayIso(),
    );
    missedConceptIds = [
      ...new Set(missedRows.map((t) => t.conceptId).filter((id): id is string => !!id)),
    ];

    // The new-day trigger, exactly as the dashboard calls it.
    await ensurePlanFreshForToday(learner.user, learner.goal.id);

    after = await snapshotLedger(learner);

    // eslint-disable-next-line no-console -- the ledger diff IS the evidence
    console.log(
      ['', describeLedger('BEFORE', before), describeLedger('AFTER ', after), ''].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  it('detects the missed work', () => {
    const missed = identifyMissedTasks(
      before.allTasks.map((t) => ({
        taskId: t.id,
        conceptId: t.conceptId ?? t.id,
        scheduledDate: t.scheduledDate,
        status: t.status,
      })),
      todayIso(),
    );
    expect(missed.length).toBeGreaterThan(0);
    expect(missedConceptIds.length).toBeGreaterThan(0);
  });

  it('a new-day open actually triggers regeneration', () => {
    expect(before.windowStart! < todayIso()).toBe(true);
    expect(after.planVersion).toBeGreaterThan(before.planVersion!);
  });

  it('commits the new plan with the new_day reason', () => {
    expect(after.planReason).toBe('new_day');
    expect(after.planId).not.toBe(before.planId);
    expect(after.windowStart).toBe(todayIso());
  });

  it('retires superseded pending tasks instead of leaving them live', () => {
    // `in_progress` is deliberately exempt: the learner is mid-session on it,
    // and a re-plan does not get to cancel work already underway. Everything
    // still merely *intended* on the old version must be gone.
    const stale = liveTasks(after).filter(
      (t) => t.planId === before.planId && t.status === 'pending',
    );
    expect(stale.map((t) => `${t.conceptTitle} @ ${t.scheduledDate} (${t.status})`)).toStrictEqual(
      [],
    );
  });

  it('preserves in-progress work', async () => {
    const row = after.allTasks.find((t) => t.id === inProgressTaskId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('in_progress');
  });

  it('preserves completed and skipped evidence', () => {
    expect(after.allTasks.find((t) => t.id === completedTaskId)?.status).toBe('completed');
    expect(after.allTasks.find((t) => t.id === skippedTaskId)?.status).toBe('skipped');
  });

  it('does not blindly carry missed work forward', () => {
    expect(missedRows.length, 'scenario must actually produce missed work').toBeGreaterThan(1);

    // (a) nothing the learner has yet to start sits on a past date. An
    //     `in_progress` row keeps its original date on purpose — that is when
    //     the session began.
    const live = liveTasks(after);
    expect(
      live.filter((t) => t.status === 'pending' && t.scheduledDate < todayIso()),
    ).toStrictEqual([]);

    // (b) the §10.4 invariant proper: **no row is shifted forward**. Every
    //     missed task is retired in place, keeping the date it was due, so the
    //     history records a miss rather than quietly pretending the work was
    //     always meant for later. This is what "there is no backlog data
    //     structure" looks like from the outside.
    for (const missed of missedRows) {
      const now = after.allTasks.find((t) => t.id === missed.id);
      expect(now, 'missed task must still exist: ' + missed.conceptTitle).toBeDefined();
      expect(now!.status).toBe('rescheduled');
      expect(now!.scheduledDate).toBe(missed.scheduledDate);
    }

    // (c) work that comes back does so as *fresh rows on the new plan*,
    //     re-derived from priority — not the old rows wearing a new date.
    const returned = live.filter((t) => t.conceptId && missedConceptIds.includes(t.conceptId));
    for (const row of returned) {
      expect(row.planId).toBe(after.planId);
      expect(missedRows.some((m) => m.id === row.id)).toBe(false);
    }
  });

  it('carries exam weight into the placement it actually persisted', () => {
    /**
     * What this can and cannot prove, stated honestly.
     *
     * Raw "higher exam weight is scheduled earlier" is **false** end-to-end,
     * and correctly so: prerequisites outrank impact, so a 0.3-weight
     * foundation is supposed to precede a 0.9-weight topic that depends on it.
     * Asserting the monotonic version would be asserting a dial the product
     * does not have. The controlled proof that weight orders placement when
     * nothing else differs lives in core/scheduling's own suite.
     *
     * What belongs here is the wiring: that the exam weight sitting on the
     * concept row genuinely reached the scheduler, and is recorded in the
     * factor breakdown persisted against each task. A disconnected dial fails.
     */
    const rated = after.tasks.filter((t) => t.examWeight !== null && t.impact !== null);
    expect(rated.length).toBeGreaterThan(2);

    const pairs = rated.map((t) => [t.examWeight, t.impact] as [number, number]);
    const weights = [...new Set(pairs.map(([w]) => w))];
    expect(weights.length, 'need varied exam weights for this to mean anything').toBeGreaterThan(1);

    /**
     * Correlation rather than strict monotonicity, because impact is
     * `clamp01(examWeight x gap x leverage)`: a lower-weight concept that
     * unlocks more of the graph can legitimately out-score a higher-weight
     * leaf, and the clamp flattens ties at the top. Demanding monotonicity here
     * would be demanding that leverage stop mattering.
     */
    expect(pearson(pairs)).toBeGreaterThan(0.5);
  });

  it('respects future capacity — the plan never overloads a day', () => {
    // Scoped to what the *plan* schedules, which is the guarantee
    // `core/scheduling` makes and unit-tests. Work already in flight is
    // deliberately outside it: that task was started under the previous plan
    // and keeps its row, so it is carried, not re-decided.
    const perDay = new Map<string, number>();
    for (const t of after.tasks.filter((t) => t.status === 'pending')) {
      perDay.set(t.scheduledDate, (perDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
    }
    expect([...perDay.entries()].filter(([, minutes]) => minutes > 120)).toStrictEqual([]);

    // The carried in-flight work is the *only* thing allowed to push a day
    // over, and never by more than itself.
    const inFlightPerDay = new Map<string, number>();
    for (const t of liveTasks(after).filter((t) => t.status === 'in_progress')) {
      inFlightPerDay.set(
        t.scheduledDate,
        (inFlightPerDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes,
      );
    }
    const totalPerDay = new Map(perDay);
    for (const [date, minutes] of inFlightPerDay) {
      totalPerDay.set(date, (totalPerDay.get(date) ?? 0) + minutes);
    }
    for (const [date, minutes] of totalPerDay) {
      if (minutes <= 120) continue;
      expect(minutes - (inFlightPerDay.get(date) ?? 0)).toBeLessThanOrEqual(120);
    }
  });

  it('conserves meaningful workload, or reduces it for a stated reason', () => {
    /**
     * "Workload" here means *remaining work in the goal*, not *rows currently
     * materialised in the window* — and the difference matters.
     *
     * A fresh 14-day window legitimately materialises more near-horizon tasks
     * than a stale one whose first days have fallen into the past, so live-row
     * minutes can rise for an entirely honest reason. Asserting on that number
     * would fail a correct re-plan, and would pass a compounding one whose
     * extra rows happened to land outside the window.
     *
     * The invariant that actually holds: total remaining work only ever falls,
     * because the only thing that removes work is evidence of learning.
     */
    expect(after.requiredMinutes!).toBeLessThanOrEqual(before.requiredMinutes!);
    expect(after.requiredMinutes).toBeGreaterThan(0);

    // And no concept is counted twice in what the learner is being asked to do.
    const live = liveTasks(after).filter((t) => t.conceptId);
    expect(new Set(live.map((t) => t.conceptId)).size).toBe(live.length);
  });

  it('creates no impossible backlog', () => {
    const live = liveTasks(after);
    const horizonDays = 14;
    const dates = new Set(live.map((t) => t.scheduledDate));
    expect(dates.size).toBeLessThanOrEqual(horizonDays);
    expect(liveMinutes(after)).toBeLessThanOrEqual(horizonDays * 120);
  });

  it('does not compound tasks across repeated regeneration', async () => {
    const baseline = byConcept(liveTasks(await snapshotLedger(learner)));

    for (let i = 0; i < 3; i++) {
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
    }

    const repeated = await snapshotLedger(learner);
    const counts = byConcept(liveTasks(repeated));

    const duplicated = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([conceptId, n]) => {
        const rows = liveTasks(repeated).filter((t) => t.conceptId === conceptId);
        return `${rows[0]?.conceptTitle} x${n}: ${rows
          .map((r) => `v${r.planVersion}/${r.status}/${r.scheduledDate}`)
          .join(' + ')}`;
      });
    expect(duplicated).toStrictEqual([]);

    for (const [conceptId, n] of counts) {
      expect(n).toBeLessThanOrEqual(Math.max(1, baseline.get(conceptId) ?? 1));
    }

    const versions = await listPlanVersions(learner);
    expect(versions.filter((v) => v.status === 'active')).toHaveLength(1);
  });

  it('the dashboard recommendation matches the current plan', async () => {
    const current = await snapshotLedger(learner);
    const nextAction = await getNextAction(learner.user, learner.goal.id, 120);

    expect(nextAction.action, 'a plan with live tasks must yield a next action').not.toBeNull();
    const recommendedId = nextAction.action!.taskId;

    const row = current.allTasks.find((t) => t.id === recommendedId);
    expect(row, 'recommended task must exist in the ledger').toBeDefined();
    expect(row!.planId, 'recommended task must belong to the ACTIVE plan').toBe(current.planId);
    expect(['pending', 'in_progress']).toContain(row!.status);
    expect(row!.scheduledDate >= todayIso()).toBe(true);
  });
});

/** Pearson correlation over (x, y) pairs; 0 when either series is constant. */
function pearson(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 2) return 0;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}
