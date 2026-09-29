import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, studySessions } from '@friday/db';
import { createLearner, destroyLearner, liveTasks, snapshotLedger, type Learner } from './fixtures';
import { getAdaptiveProfile } from '../../adaptive/adaptive.service';
import { getMissionControl } from '../../mission-control/mission-control.service';
import { regeneratePlan } from '../planning.service';

/**
 * Adaptive task sizing, proven on persisted rows.
 *
 * CR-017 removed a sentence because the product could not back it: the panel
 * said "about 15 minutes" and the task underneath said "50 min". The wire was
 * there — the dial reached the selector — but every task had been sized at plan
 * time from its concept's own estimate, so for a learner who studies in
 * fifteen-minute blocks against a curriculum of forty-minute concepts, nothing
 * ever fitted and the selector correctly handed back the top candidate whole.
 *
 * The fix is not a label. The **planner** now sizes blocks to the learner, the
 * remainder stays owed rather than being silently forgiven, and the number on
 * the persisted row is the number the panel quotes. This suite is what makes
 * that checkable: every assertion reads `tasks.estimated_minutes` back from
 * Postgres, because a caption is exactly what this was before.
 */

const DAY = 86_400_000;

async function stageSessions(
  learner: Learner,
  sessions: { daysAgo: number; status: 'completed' | 'abandoned'; minutes: number }[],
): Promise<void> {
  const rows = sessions.map((s) => {
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
  });
  await getDb().insert(studySessions).values(rows);
}

/** Short, frequently-abandoned sessions — the shape that shortens the dial. */
function strugglingHistory() {
  return [
    ...Array.from({ length: 5 }, (_, i) => ({
      daysAgo: i * 2 + 1,
      status: 'abandoned' as const,
      minutes: 4,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      daysAgo: i * 3 + 2,
      status: 'completed' as const,
      minutes: 11,
    })),
  ];
}

/** Long, reliably-finished sessions — the shape that lengthens it. */
function thrivingHistory() {
  return Array.from({ length: 12 }, (_, i) => ({
    daysAgo: i + 1,
    status: 'completed' as const,
    minutes: 55,
  }));
}

describe('adaptive task sizing (database-backed)', () => {
  describe('A · a new learner is not re-sized on evidence that does not exist', () => {
    let learner: Learner;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    });
    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('the band is unknown and tasks keep their natural size', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      expect(profile.band).toBe('unknown');

      const ledger = await snapshotLedger(learner);
      const sizes = new Set(liveTasks(ledger).map((t) => t.estimatedMinutes));

      // The seeded curriculum is 40–60 minute concepts. If sizing had fired for
      // a learner with no history, everything would be one uniform number.
      expect(sizes.size, 'natural variety, not one imposed block size').toBeGreaterThan(1);
      expect(Math.max(...sizes)).toBeGreaterThan(15);
    });
  });

  describe('B · a struggling learner gets blocks they can actually finish', () => {
    let learner: Learner;
    let budget: number;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
      await stageSessions(learner, strugglingHistory());

      const profile = await getAdaptiveProfile(learner.user);
      budget = profile.targetSessionMinutes;

      // Re-plan so the new budget is applied to persisted rows.
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
    });
    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('the dial actually moved down', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      expect(profile.band).not.toBe('unknown');
      expect(budget).toBeLessThan(40);
    });

    it('EVERY persisted task fits the budget', async () => {
      const ledger = await snapshotLedger(learner);
      const tasks = liveTasks(ledger);
      expect(tasks.length).toBeGreaterThan(0);

      const over = tasks
        .filter((t) => t.estimatedMinutes > budget)
        .map((t) => `${t.conceptTitle} ${t.estimatedMinutes}m > ${budget}m`);
      expect(over).toStrictEqual([]);
    });

    it('the recommendation the learner is shown fits it too', async () => {
      const mission = await getMissionControl(learner.user, learner.goal.id, budget);
      expect(mission.nextAction.action).not.toBeNull();
      expect(mission.nextAction.action!.estimatedMinutes).toBeLessThanOrEqual(budget);
    });

    it('the claim and the task now agree — CR-017 closed', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      const mission = await getMissionControl(
        learner.user,
        learner.goal.id,
        profile.targetSessionMinutes,
      );
      const action = mission.nextAction.action!;

      for (const decision of profile.decisions) {
        const quoted = Number(/(\d+) minutes/.exec(decision.change)?.[1]);
        if (Number.isNaN(quoted)) continue;
        expect(
          action.estimatedMinutes,
          `panel says ${quoted}m, task is ${action.estimatedMinutes}m`,
        ).toBeLessThanOrEqual(quoted);
      }

      // eslint-disable-next-line no-console -- the agreement IS the evidence
      console.log(
        [
          '',
          '──────── TASK SIZING ────────',
          `band   : ${profile.band}`,
          `claim  : ${profile.decisions[0]?.change ?? '(none)'}`,
          `dial   : ${profile.targetSessionMinutes} min`,
          `task   : ${action.title} — ${action.estimatedMinutes} min`,
          '─────────────────────────────',
          '',
        ].join('\n'),
      );
    });

    it('G · no work is fabricated to fill the budget', async () => {
      const ledger = await snapshotLedger(learner);
      const scheduled = liveTasks(ledger).reduce((s, t) => s + t.estimatedMinutes, 0);

      // The whole seeded curriculum is 470 minutes. Splitting redistributes
      // work; it must never manufacture any.
      expect(scheduled).toBeLessThanOrEqual(470);
    });

    it('the split work is not lost — the remainder is still owed', async () => {
      const ledger = await snapshotLedger(learner);
      // Required minutes come from feasibility, which reads mastery, not the
      // window. Splitting a concept across days must not reduce it.
      expect(ledger.requiredMinutes!).toBeGreaterThan(400);
    });
  });

  describe('D · a thriving learner is given room, not padding', () => {
    let learner: Learner;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 180, targetDays: 60 });
      await stageSessions(learner, thrivingHistory());
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
    });
    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('the dial moved up rather than down', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      expect(profile.band).not.toBe('unknown');
      expect(profile.targetSessionMinutes).toBeGreaterThanOrEqual(30);
    });

    it('F · nothing is stretched past its own estimate', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);

      // A generous budget is a ceiling, never a target. The largest concept in
      // the seeded curriculum is 60 minutes, so no task may exceed that however
      // much room the learner has.
      for (const task of liveTasks(ledger)) {
        expect(
          task.estimatedMinutes,
          `${task.conceptTitle} was inflated to fill ${profile.targetSessionMinutes}m`,
        ).toBeLessThanOrEqual(60);
      }
    });

    it('no concept is duplicated on a single day by the split logic', async () => {
      const ledger = await snapshotLedger(learner);
      const perDay = new Map<string, Set<string>>();
      for (const t of liveTasks(ledger)) {
        if (!t.conceptId) continue;
        const seen = perDay.get(t.scheduledDate) ?? new Set<string>();
        expect(seen.has(t.conceptId), `${t.conceptTitle} appears twice on ${t.scheduledDate}`).toBe(
          false,
        );
        seen.add(t.conceptId);
        perDay.set(t.scheduledDate, seen);
      }
    });

    it('capacity is still respected — a bigger budget is not a bigger day', async () => {
      const ledger = await snapshotLedger(learner);
      const perDay = new Map<string, number>();
      for (const t of liveTasks(ledger).filter((x) => x.status === 'pending')) {
        perDay.set(t.scheduledDate, (perDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
      }
      for (const [date, minutes] of perDay) {
        expect(minutes, `${date}`).toBeLessThanOrEqual(180);
      }
    });
  });
});
