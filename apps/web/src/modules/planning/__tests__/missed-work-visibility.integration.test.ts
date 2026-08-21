import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backdateGoalBy,
  createLearner,
  destroyLearner,
  liveTasks,
  snapshotLedger,
  type Learner,
} from './fixtures';
import { getMissionControl } from '../../mission-control/mission-control.service';
import { ensurePlanFreshForToday, regeneratePlan } from '../planning.service';

/**
 * The learner has to be able to tell that redistribution happened.
 *
 * FRIDAY has done the right thing with missed work since Phase 3 — retire it,
 * re-derive placement, never stack it onto tomorrow. But doing the right thing
 * invisibly is indistinguishable from not doing it. The learner who missed a
 * day opens the app, sees a normal-looking list, and has no way to know whether
 * they got away with it or whether the debt is hiding somewhere off screen.
 *
 * So one sentence, and only when it is true. These tests exist to make sure it
 * is never the *other* thing — a reassurance the product cannot back, which is
 * worse than silence: a learner told "nothing was added" who then finds a
 * doubled Tuesday has learned not to believe the next claim either.
 */

describe('missed-work redistribution is visible and true', () => {
  describe('a learner who missed a day', () => {
    let learner: Learner;
    let change: { statement: string; evidence: string } | null;
    let capacity: number;
    let planned: number;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 60, targetDays: 45 });

      // One day passes with nothing done.
      await backdateGoalBy(learner, 1);
      await ensurePlanFreshForToday(learner.user, learner.goal.id);

      const mission = await getMissionControl(learner.user, learner.goal.id, 60);
      change = mission.planChange;
      capacity = mission.today.capacityMinutes;
      planned = mission.today.plannedMinutes;

      // eslint-disable-next-line no-console -- the sentence IS the deliverable
      console.log(
        [
          '',
          '──────── MISSED-WORK LINE ────────',
          `statement: ${change?.statement ?? '(none)'}`,
          `evidence : ${change?.evidence ?? '(none)'}`,
          `today    : ${planned} min planned of ${capacity} min capacity`,
          '──────────────────────────────────',
          '',
        ].join('\n'),
      );
    });

    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('says something at all', () => {
      expect(change, 'a learner who missed a day must be told what happened').not.toBeNull();
      expect(change!.statement).toMatch(/missed task/);
    });

    it('the count is the number of rows actually retired', async () => {
      const ledger = await snapshotLedger(learner);
      const rescheduled = ledger.allTasks.filter((t) => t.status === 'rescheduled').length;

      const stated = Number(/^(\d+)/.exec(change!.statement)?.[1]);
      expect(stated, 'the sentence must quote the ledger').toBe(rescheduled);
      expect(rescheduled).toBeGreaterThan(0);
    });

    it('the reassurance is only given when today genuinely fits', () => {
      if (change!.evidence.includes('Nothing was added')) {
        expect(planned).toBeLessThanOrEqual(capacity);
        expect(change!.evidence).toContain(`${planned} min of ${capacity}`);
      } else {
        // The alternative wording makes no capacity claim at all.
        expect(change!.evidence).not.toContain('Nothing was added');
      }
    });

    it('and today really was not stacked', () => {
      expect(planned).toBeLessThanOrEqual(capacity);
    });

    it('capacity is the learner’s availability, not a tautology', () => {
      /**
       * The check that makes the one above mean anything.
       *
       * `capacityMinutes` used to be the sum of today's own task minutes, so
       * `planned <= capacity` held by construction and the pair rendered as
       * "90 min of 90" whatever the learner had actually made time for. Nothing
       * could ever read as over capacity — including a day that genuinely was.
       *
       * This learner declared 60 minutes a day, so that is the number the
       * product must be quoting back at them.
       */
      expect(capacity).toBe(60);
      expect(planned).not.toBe(0);
    });

    it('today excludes the rows the re-plan just retired', async () => {
      const mission = await getMissionControl(learner.user, learner.goal.id, 60);
      const statuses = mission.today.tasks.map((t) => t.status);

      // `listTasksInWindow` filters by date, not status, so retired work used
      // to reappear in today's list and inflate every total drawn from it.
      expect(statuses).not.toContain('rescheduled');
      expect(statuses).not.toContain('cancelled');
    });
  });

  describe('a learner who missed nothing', () => {
    let learner: Learner;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 60, targetDays: 45 });
      // An explicit re-plan with no missed work behind it.
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
    });

    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('is told nothing, rather than reassured about a problem they did not have', async () => {
      const mission = await getMissionControl(learner.user, learner.goal.id, 60);

      // There is deliberately no "nothing changed" wording. A reassurance
      // nobody asked for reads as one the system needed to give.
      expect(mission.planChange).toBeNull();
    });
  });

  describe('a brand-new learner', () => {
    let learner: Learner;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 60, targetDays: 45 });
    });

    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('sees no redistribution claim on their first plan', async () => {
      const mission = await getMissionControl(learner.user, learner.goal.id, 60);
      expect(mission.planChange).toBeNull();
    });

    it('and the initial plan records an honest empty diff rather than nothing', async () => {
      const ledger = await snapshotLedger(learner);
      expect(liveTasks(ledger).length).toBeGreaterThan(0);

      // `diff_summary` used to be written as literal `null` on every plan ever
      // created. An initial plan supersedes nothing, so zero is the honest
      // value — and a zero that was actually computed is what lets the panel
      // trust the field instead of guessing.
      const { getDb } = await import('@friday/db');
      const { sql } = await import('drizzle-orm');
      const rows = await getDb().execute<{ diff: unknown }>(sql`
        select diff_summary as diff from plans
         where goal_id = ${learner.goal.id} and status = 'active'
      `);
      const diff = rows.rows[0]!.diff as { rescheduledCount: number } | null;

      expect(diff).not.toBeNull();
      expect(diff!.rescheduledCount).toBe(0);
    });
  });
});
