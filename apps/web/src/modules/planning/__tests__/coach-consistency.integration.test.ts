import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPacket } from '@friday/ai';
import { getDb, studySessions } from '@friday/db';
import { createLearner, destroyLearner, liveTasks, snapshotLedger, type Learner } from './fixtures';
import { getAdaptiveProfile } from '../../adaptive/adaptive.service';
import { getMissionControl } from '../../mission-control/mission-control.service';
import { buildLearnerContext } from '../../ai/context-builder';
import { regeneratePlan } from '../planning.service';

/**
 * The Coach and the planner cannot be allowed to disagree.
 *
 * They are the two things in the product that talk to the learner about the
 * same decision, and they reach it by different routes — one renders a packet
 * for a language model, the other writes rows. If the panel shows a 15-minute
 * task and the Coach says "give it 25 minutes", the learner has caught the
 * product contradicting itself about the one thing it claims to know, and no
 * amount of correct arithmetic elsewhere recovers that.
 *
 * These assertions are deliberately about the **context packet**, not about
 * generated text. The packet is the contract: it is deterministic, it is what
 * the model is given, and a guarantee made there is one that holds on every
 * call rather than most of the time. Asserting on model output would be
 * measuring the weather.
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

describe('the Coach and the planner read one adaptive state', () => {
  describe('a learner the engine can read', () => {
    let learner: Learner;
    let rendered: string;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
      await stageSessions(learner, [
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
      ]);
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

      const packet = await buildLearnerContext(learner.user, learner.goal.id, 'coach');
      rendered = renderPacket(packet);
    });

    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('the Coach is told the same band the dashboard renders', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      expect(profile.band).not.toBe('unknown');
      expect(rendered).toContain(`Band: ${profile.band}`);
    });

    it('the Coach is told the same session budget the planner enforced', async () => {
      const profile = await getAdaptiveProfile(learner.user);

      // The exact sentence, not a number that happens to appear somewhere.
      expect(rendered).toContain(`sessions are sized at ${profile.targetSessionMinutes} minutes`);
    });

    it('that budget is the one the persisted tasks were actually built to', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      const ledger = await snapshotLedger(learner);
      const tasks = liveTasks(ledger);

      expect(tasks.length).toBeGreaterThan(0);
      for (const task of tasks) {
        expect(
          task.estimatedMinutes,
          `${task.conceptTitle} is ${task.estimatedMinutes}m but the Coach is told ${profile.targetSessionMinutes}m`,
        ).toBeLessThanOrEqual(profile.targetSessionMinutes);
      }
    });

    it('and the one the dashboard recommendation was fitted to', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      const mission = await getMissionControl(
        learner.user,
        learner.goal.id,
        profile.targetSessionMinutes,
      );

      expect(mission.nextAction.action).not.toBeNull();
      expect(mission.nextAction.action!.estimatedMinutes).toBeLessThanOrEqual(
        profile.targetSessionMinutes,
      );

      // eslint-disable-next-line no-console -- the agreement IS the evidence
      console.log(
        [
          '',
          '───── COACH / PLANNER AGREEMENT ─────',
          `engine dial   : ${profile.targetSessionMinutes} min`,
          `Coach told    : "sessions are sized at ${profile.targetSessionMinutes} minutes"`,
          `dashboard task: ${mission.nextAction.action!.estimatedMinutes} min`,
          '─────────────────────────────────────',
          '',
        ].join('\n'),
      );
    });

    it('the Coach is forbidden from claiming changes the product does not make', () => {
      // Workload, difficulty, ordering and guidance were all removed from the
      // profile because nothing consumed them. The packet says so out loud, so
      // a model cannot reintroduce them from its own sense of what an adaptive
      // tutor ought to say.
      expect(rendered).toContain('This is the ONLY plan change');
      expect(rendered).toMatch(/Do not claim workload, difficulty, ordering or guidance changed/);
    });

    it('the Coach is given the same observations and decisions as the panel', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      for (const observation of profile.observations) {
        expect(rendered).toContain(observation.statement);
      }
      for (const decision of profile.decisions) {
        expect(rendered).toContain(decision.change);
      }
    });
  });

  describe('a learner the engine cannot read yet', () => {
    let learner: Learner;
    let rendered: string;

    beforeAll(async () => {
      learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
      await stageSessions(learner, [{ daysAgo: 1, status: 'completed', minutes: 30 }]);
      const packet = await buildLearnerContext(learner.user, learner.goal.id, 'coach');
      rendered = renderPacket(packet);
    });

    afterAll(async () => {
      if (learner) await destroyLearner(learner);
    });

    it('the Coach is instructed to say so rather than infer a pattern', async () => {
      const profile = await getAdaptiveProfile(learner.user);
      expect(profile.band).toBe('unknown');

      expect(rendered).toContain('Too little evidence to adapt');
      expect(rendered).toMatch(/Do NOT infer a study pattern/);
    });

    it('no session-budget claim is put in front of the Coach at all', () => {
      // The dashboard passes `undefined` for an unknown band and the planner
      // leaves tasks naturally sized. The Coach must not be handed a number
      // that nothing enforced.
      expect(rendered).not.toContain('sessions are sized at');
    });

    it('no continuity claim is available to be repeated', () => {
      expect(rendered).toMatch(/Continuity: NOT ESTABLISHED|Too little evidence/);
    });
  });
});
