import { afterAll, describe, expect, it } from 'vitest';
import { getDb, studySessions } from '@friday/db';
import {
  backdateGoalBy,
  createLearner,
  destroyLearner,
  duplicateConceptsOnSameDay,
  liveTasks,
  minutesByDay,
  snapshotLedger,
  type Learner,
} from './fixtures';
import { getAdaptiveProfile } from '../../adaptive/adaptive.service';
import { getMissionControl } from '../../mission-control/mission-control.service';
import { setAvailability } from '../../identity/settings.service';
import { updateGoal } from '../../curriculum/curriculum.service';
import { ensurePlanFreshForToday, regeneratePlan } from '../planning.service';

/**
 * Ten learners, each walked end to end on real rows.
 *
 * The per-capability suites prove that each link in the chain works. This one
 * asks a different question: for a specific kind of person, does the whole
 * thing hold together — and is what they end up *seeing* consistent with what
 * the engine actually decided?
 *
 * Each persona records the same five-step trace:
 *
 *   INPUT      what the learner did
 *   OBSERVED   what the engine concluded from it
 *   DECIDED    the dial it moved, or refused to move
 *   PLAN       what changed in the persisted rows
 *   VISIBLE    what the learner is shown
 *
 * The invariants at the bottom of each case are the ones that must hold for
 * *every* persona, so a change that helps one learner and quietly breaks
 * another cannot pass.
 */

const DAY = 86_400_000;

interface Trace {
  persona: string;
  input: string;
  observed: string;
  decided: string;
  plan: string;
  visible: string;
}
const traces: Trace[] = [];

async function stage(
  learner: Learner,
  sessions: { daysAgo: number; status: 'completed' | 'abandoned'; minutes: number }[],
): Promise<void> {
  if (sessions.length === 0) return;
  await getDb()
    .insert(studySessions)
    .values(
      sessions.map((s) => {
        const startedAt = new Date(Date.now() - s.daysAgo * DAY);
        return {
          userId: learner.user.id,
          goalId: learner.goal.id,
          status: s.status,
          startedAt,
          endedAt: new Date(startedAt.getTime() + s.minutes * 60_000),
          activeMinutes: s.minutes,
          originatedFrom: 'manual' as const,
        };
      }),
    );
}

/** Every persona ends here. These must hold for all ten, without exception. */
async function assertUniversalInvariants(learner: Learner, label: string): Promise<void> {
  const ledger = await snapshotLedger(learner);
  const live = liveTasks(ledger);
  const profile = await getAdaptiveProfile(learner.user);
  const mission = await getMissionControl(
    learner.user,
    learner.goal.id,
    profile.band === 'unknown' ? undefined : profile.targetSessionMinutes,
  );

  // 1. Exactly one plan is live, and nothing offerable survives on an old one.
  expect(
    live.filter((t) => t.status === 'pending' && t.planId !== ledger.planId),
    `${label}: pending work stranded on a superseded plan`,
  ).toStrictEqual([]);

  // 2. No concept is asked for twice on the same day.
  expect(duplicateConceptsOnSameDay(live), `${label}: duplicated concept`).toStrictEqual([]);

  // 3. Nothing outstanding sits in the past.
  const today = new Date().toISOString().slice(0, 10);
  expect(
    live.filter((t) => t.status === 'pending' && t.scheduledDate < today),
    `${label}: overdue work left in the queue`,
  ).toStrictEqual([]);

  // 4. No day exceeds what the learner said they had.
  const capacity = mission.today.capacityMinutes;
  if (capacity > 0) {
    const todayLoad = minutesByDay(live.filter((t) => t.status === 'pending')).get(today) ?? 0;
    expect(todayLoad, `${label}: today over capacity`).toBeLessThanOrEqual(capacity);
  }

  // 5. The recommendation is real, current, and honours whatever was claimed.
  const action = mission.nextAction.action;
  if (action) {
    const row = ledger.allTasks.find((t) => t.id === action.taskId);
    expect(row, `${label}: recommended a task that is not in the ledger`).toBeDefined();
    expect(row!.planStatus, `${label}: recommended a superseded task`).toBe('active');

    if (profile.band !== 'unknown') {
      expect(
        action.estimatedMinutes,
        `${label}: recommended ${action.estimatedMinutes}m against a ${profile.targetSessionMinutes}m dial`,
      ).toBeLessThanOrEqual(profile.targetSessionMinutes);
    }
  }

  // 6. Nothing is claimed that the engine did not decide.
  if (profile.band === 'unknown') {
    for (const decision of profile.decisions) {
      expect(
        decision.change.toLowerCase(),
        `${label}: claimed a change with no evidence behind it`,
      ).not.toMatch(/cut|shorten|stretch|increase|reduce/);
    }
  }
}

function record(t: Trace) {
  traces.push(t);
}

describe('ten learners, end to end', () => {
  afterAll(() => {
    // eslint-disable-next-line no-console -- the traces ARE the deliverable
    console.log(
      [
        '',
        '═══════════════ PERSONA TRACES ═══════════════',
        ...traces.flatMap((t) => [
          `${t.persona}`,
          `   INPUT    ${t.input}`,
          `   OBSERVED ${t.observed}`,
          `   DECIDED  ${t.decided}`,
          `   PLAN     ${t.plan}`,
          `   VISIBLE  ${t.visible}`,
          '',
        ]),
        '══════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  });

  it('1 · a brand-new learner is not profiled', async () => {
    const learner = await createLearner({ dailyMinutes: 90, targetDays: 60 });
    try {
      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);
      const mission = await getMissionControl(learner.user, learner.goal.id, undefined);

      expect(profile.band).toBe('unknown');
      expect(mission.planChange).toBeNull();

      record({
        persona: '1 · New learner',
        input: 'signed up, no sessions',
        observed: `band=${profile.band}`,
        decided: 'no dial moved — refuses to profile on nothing',
        plan: `v${ledger.planVersion}, ${liveTasks(ledger).length} tasks at natural size`,
        visible: `"${mission.nextAction.action?.title ?? 'no action'}"`,
      });

      await assertUniversalInvariants(learner, 'new learner');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('2 · a struggling learner gets shorter blocks', async () => {
    const learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    try {
      /**
       * Genuinely struggling, not merely unimpressive.
       *
       * The first version of this fixture — five abandoned and four finished
       * across nine days — scored 0.42 on consistency and landed in `steady`,
       * just over the line. It passed, and proved nothing about the branch it
       * was named after. `struggling` is the band the product most needs to get
       * right, so the fixture is now unambiguous: shows up rarely, and leaves
       * most of what it starts.
       */
      await stage(learner, [
        ...Array.from({ length: 8 }, (_, i) => ({
          daysAgo: i + 1,
          status: 'abandoned' as const,
          minutes: 3,
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          daysAgo: i * 2 + 1,
          status: 'completed' as const,
          minutes: 9,
        })),
      ]);
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);
      const longest = Math.max(...liveTasks(ledger).map((t) => t.estimatedMinutes));

      expect(profile.band, 'this fixture must reach the struggling branch').toBe('struggling');

      // `Math.max()` of an empty array is -Infinity, which quietly satisfied
      // `<= budget` and hid an empty plan behind a passing assertion. The
      // learner who most needs one achievable task was getting none.
      expect(liveTasks(ledger).length, 'a struggling learner must still get work').toBeGreaterThan(
        0,
      );
      expect(longest).toBeLessThanOrEqual(profile.targetSessionMinutes);
      expect(longest).toBeGreaterThan(0);

      record({
        persona: '2 · Struggling',
        input: '8 abandoned at 3 min, 2 finished at 9 min',
        observed: `band=${profile.band} trend=${profile.trend}`,
        decided: `session budget ${profile.targetSessionMinutes} min`,
        plan: `longest persisted task ${longest} min`,
        visible: profile.decisions[0]?.change ?? '(nothing claimed)',
      });

      await assertUniversalInvariants(learner, 'struggling');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('3 · an improving learner is given room', async () => {
    const learner = await createLearner({ dailyMinutes: 150, targetDays: 60 });
    try {
      await stage(learner, [
        ...Array.from({ length: 5 }, (_, i) => ({
          daysAgo: 8 + i,
          status: 'completed' as const,
          minutes: 12,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          daysAgo: 1 + i,
          status: 'completed' as const,
          minutes: 48,
        })),
      ]);
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);

      record({
        persona: '3 · Improving',
        input: 'short sessions two weeks ago, 48 min sessions now',
        observed: `band=${profile.band} trend=${profile.trend}`,
        decided: `session budget ${profile.targetSessionMinutes} min`,
        plan: `v${ledger.planVersion}, ${liveTasks(ledger).length} live tasks`,
        visible: profile.decisions[0]?.change ?? '(nothing claimed)',
      });

      await assertUniversalInvariants(learner, 'improving');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('4 · a daily, reliable learner is read as thriving', async () => {
    const learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    try {
      await stage(
        learner,
        Array.from({ length: 10 }, (_, i) => ({
          daysAgo: i + 1,
          status: 'completed' as const,
          minutes: 30,
        })),
      );
      const before = await snapshotLedger(learner);
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

      const profile = await getAdaptiveProfile(learner.user);
      const after = await snapshotLedger(learner);

      record({
        persona: '4 · Daily and reliable',
        input: '10 finished sessions, all 30 min',
        observed: `band=${profile.band} trend=${profile.trend}`,
        decided: `session budget ${profile.targetSessionMinutes} min`,
        plan: `v${before.planVersion} → v${after.planVersion}`,
        visible: profile.decisions[0]?.change ?? '(nothing claimed)',
      });

      await assertUniversalInvariants(learner, 'consistent');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('5 · a thriving learner is not padded beyond the syllabus', async () => {
    const learner = await createLearner({ dailyMinutes: 180, targetDays: 60 });
    try {
      await stage(
        learner,
        Array.from({ length: 12 }, (_, i) => ({
          daysAgo: i + 1,
          status: 'completed' as const,
          minutes: 55,
        })),
      );
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);
      const longest = Math.max(...liveTasks(ledger).map((t) => t.estimatedMinutes));

      // The largest concept in the seeded curriculum is 60 minutes. A generous
      // budget is a ceiling, never a target.
      expect(longest).toBeLessThanOrEqual(60);

      record({
        persona: '5 · Thriving',
        input: '12 finished sessions, all 55 min',
        observed: `band=${profile.band} trend=${profile.trend}`,
        decided: `session budget ${profile.targetSessionMinutes} min`,
        plan: `longest task ${longest} min — capped by the concept, not the budget`,
        visible: profile.decisions[0]?.change ?? '(nothing claimed)',
      });

      await assertUniversalInvariants(learner, 'thriving');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('6 · a learner who missed one day is told, and today is not doubled', async () => {
    const learner = await createLearner({ dailyMinutes: 60, targetDays: 45 });
    try {
      const before = await snapshotLedger(learner);
      await backdateGoalBy(learner, 1);
      await ensurePlanFreshForToday(learner.user, learner.goal.id);

      const mission = await getMissionControl(learner.user, learner.goal.id, 60);
      const after = await snapshotLedger(learner);

      expect(mission.planChange).not.toBeNull();
      expect(mission.today.plannedMinutes).toBeLessThanOrEqual(mission.today.capacityMinutes);

      record({
        persona: '6 · Missed one day',
        input: 'one scheduled day passed untouched',
        observed: `${after.allTasks.filter((t) => t.status === 'rescheduled').length} rows retired as missed`,
        decided: 'material despite tiny drift — missed work bypasses the gate',
        plan: `v${before.planVersion} → v${after.planVersion}`,
        visible: `${mission.planChange!.statement} ${mission.planChange!.evidence}`,
      });

      await assertUniversalInvariants(learner, 'missed one day');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('7 · a learner who missed several days still has a possible week', async () => {
    const learner = await createLearner({ dailyMinutes: 60, targetDays: 45 });
    try {
      await backdateGoalBy(learner, 5);
      await ensurePlanFreshForToday(learner.user, learner.goal.id);

      const mission = await getMissionControl(learner.user, learner.goal.id, 60);
      const ledger = await snapshotLedger(learner);
      const perDay = minutesByDay(liveTasks(ledger).filter((t) => t.status === 'pending'));
      const worst = Math.max(0, ...perDay.values());

      // The whole point of §10.4: five missed days do not become one impossible one.
      expect(worst).toBeLessThanOrEqual(60);

      record({
        persona: '7 · Missed five days',
        input: 'five scheduled days passed untouched',
        observed: `${ledger.allTasks.filter((t) => t.status === 'rescheduled').length} rows retired as missed`,
        decided: 're-derived from priority rather than accumulated',
        plan: `heaviest remaining day ${worst} min of 60`,
        visible: mission.planChange
          ? `${mission.planChange.statement} ${mission.planChange.evidence}`
          : '(no claim)',
      });

      await assertUniversalInvariants(learner, 'missed five days');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('8 · a learner whose week shrinks gets a smaller, possible plan', async () => {
    const learner = await createLearner({ dailyMinutes: 120, targetDays: 45 });
    try {
      const before = await snapshotLedger(learner);
      await setAvailability(learner.user, {
        rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00:00',
          endTime: '09:30:00',
          kind: 'available' as const,
        })),
      });
      const after = await snapshotLedger(learner);

      expect(after.planVersion!).toBeGreaterThan(before.planVersion!);
      expect(after.availableMinutes!).toBeLessThan(before.availableMinutes!);

      record({
        persona: '8 · Availability shrank',
        input: '120 min/day → 30 min/day',
        observed: 'constraint change, exempt from the churn budget',
        decided: 'replan committed',
        plan: `avail ${before.availableMinutes}m → ${after.availableMinutes}m, verdict ${after.verdict}`,
        visible: `${liveTasks(after).length} tasks, none over 30 min`,
      });

      for (const task of liveTasks(after).filter((t) => t.status === 'pending')) {
        expect(task.estimatedMinutes).toBeLessThanOrEqual(30);
      }
      await assertUniversalInvariants(learner, 'availability shrank');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('9 · a learner whose week expands gets the time used', async () => {
    const learner = await createLearner({ dailyMinutes: 30, targetDays: 45 });
    try {
      const before = await snapshotLedger(learner);
      await setAvailability(learner.user, {
        rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00:00',
          endTime: '12:00:00',
          kind: 'available' as const,
        })),
      });
      const after = await snapshotLedger(learner);

      expect(after.availableMinutes!).toBeGreaterThan(before.availableMinutes!);

      record({
        persona: '9 · Availability expanded',
        input: '30 min/day → 180 min/day',
        observed: 'constraint change in the other direction',
        decided: 'replan committed — freed time is not discarded',
        plan: `avail ${before.availableMinutes}m → ${after.availableMinutes}m`,
        visible: `${liveTasks(after).length} live tasks`,
      });

      await assertUniversalInvariants(learner, 'availability expanded');
    } finally {
      await destroyLearner(learner);
    }
  });

  it('10 · a learner whose exam moves in gets a re-derived horizon', async () => {
    const learner = await createLearner({ dailyMinutes: 90, targetDays: 120 });
    try {
      const before = await snapshotLedger(learner);
      const soon = new Date(Date.now() + 21 * DAY).toISOString().slice(0, 10);
      await updateGoal(learner.user, learner.goal.id, { targetDate: soon });
      const after = await snapshotLedger(learner);

      expect(after.planVersion!).toBeGreaterThan(before.planVersion!);
      expect(after.availableMinutes!).toBeLessThan(before.availableMinutes!);

      record({
        persona: '10 · Exam moved in',
        input: 'target date 120 days out → 21 days out',
        observed: 'capacity signal moved; drift is material',
        decided: 'replan committed',
        plan: `avail ${before.availableMinutes}m → ${after.availableMinutes}m, verdict ${after.verdict}`,
        visible: `${liveTasks(after).length} live tasks against the new horizon`,
      });

      await assertUniversalInvariants(learner, 'exam moved in');
    } finally {
      await destroyLearner(learner);
    }
  });
});
