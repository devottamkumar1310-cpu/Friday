import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@friday/contracts';
import {
  createLearner,
  destroyLearner,
  goalRow,
  duplicateConceptsOnSameDay,
  liveTasks,
  snapshotLearningState,
  snapshotLedger,
  type ConceptLearningState,
  type Ledger,
  type Learner,
} from './fixtures';
import { updateGoal } from '../../curriculum/curriculum.service';
import { completeSession, startSession } from '../../execution/execution.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * The exam moved. Prove the learner is not trapped.
 *
 * Goals were write-once — `POST` and `GET`, no `PATCH`, no `update` on the
 * repository — which meant the single most consequential input in the product
 * was the one the learner could not correct. An exam board shifts a date by
 * three weeks and FRIDAY goes on optimising towards a day that no longer
 * exists: every projection, every verdict, every priority computed against a
 * fiction, with no route out that does not abandon the learner's history.
 *
 * The fix has to clear two bars, and this suite is organised around them.
 * Moving the date must actually change what FRIDAY *plans* — a saved constraint
 * the planner never reads is the availability bug wearing a different hat. And
 * it must not touch what the learner *did*.
 */

describe('a learner can move their exam date, and the planner follows', () => {
  let learner: Learner;
  let studiedConceptId: string;

  let beforeChange: Ledger;
  let afterPullIn: Ledger;
  let afterPushOut: Ledger;
  let afterRename: Ledger;

  let evidenceBefore: Map<string, ConceptLearningState>;
  let evidenceAfter: Map<string, ConceptLearningState>;

  beforeAll(async () => {
    // A comfortable 120 days out, so pulling the date in is a real squeeze
    // rather than an instant impossibility.
    learner = await createLearner({ dailyMinutes: 60, targetDays: 120 });

    // Earn some history first — the point is that it survives.
    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    studiedConceptId = recommendation.action!.concepts[0]!.id;
    const session = await startSession(learner.user, {
      goalId: learner.goal.id,
      taskId: recommendation.action!.taskId,
      originatedFrom: 'recommendation',
    });
    await completeSession(learner.user, session.id, {
      activeMinutes: 40,
      ratings: [{ conceptId: studiedConceptId, rating: 'good' }],
    });

    beforeChange = await snapshotLedger(learner);
    evidenceBefore = await snapshotLearningState(learner);

    // The exam is brought forward to three weeks away.
    const soon = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    await updateGoal(learner.user, learner.goal.id, { targetDate: soon });
    afterPullIn = await snapshotLedger(learner);

    // ...and then pushed back out to six months.
    const later = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
    await updateGoal(learner.user, learner.goal.id, { targetDate: later });
    afterPushOut = await snapshotLedger(learner);

    // A pure rename must not disturb anything.
    await updateGoal(learner.user, learner.goal.id, { title: 'Physics, renamed' });
    afterRename = await snapshotLedger(learner);

    evidenceAfter = await snapshotLearningState(learner);

    // eslint-disable-next-line no-console -- the progression IS the evidence
    console.log(
      [
        '',
        '─────────── GOAL CHANGE ───────────',
        `before   : v${beforeChange.planVersion} target=${learner.goal.targetDate} verdict=${beforeChange.verdict} required=${beforeChange.requiredMinutes}m avail=${beforeChange.availableMinutes}m`,
        `pulled in: v${afterPullIn.planVersion} target=${soon} verdict=${afterPullIn.verdict} required=${afterPullIn.requiredMinutes}m avail=${afterPullIn.availableMinutes}m`,
        `pushed out: v${afterPushOut.planVersion} target=${later} verdict=${afterPushOut.verdict} required=${afterPushOut.requiredMinutes}m avail=${afterPushOut.availableMinutes}m`,
        `renamed  : v${afterRename.planVersion} (must equal ${afterPushOut.planVersion})`,
        '───────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  // ── THE DATE ACTUALLY CHANGES ───────────────────────────────────────────

  it('the new target date is persisted', async () => {
    const row = await goalRow(learner);
    expect(row.targetDate).not.toBe(learner.goal.targetDate);
  });

  it('pulling the exam forward re-plans and shrinks the available horizon', () => {
    expect(afterPullIn.planVersion!).toBeGreaterThan(beforeChange.planVersion!);
    expect(afterPullIn.planReason).toBe('goal_changed');
    expect(afterPullIn.availableMinutes!).toBeLessThan(beforeChange.availableMinutes!);
  });

  it('a squeezed horizon is allowed to say the goal got harder', () => {
    // What FRIDAY must never do is keep reporting the old verdict against a
    // horizon that no longer exists.
    expect(['on_track', 'at_risk', 'not_feasible']).toContain(afterPullIn.verdict);
    if (afterPullIn.verdict === 'on_track') {
      expect(afterPullIn.availableMinutes!).toBeGreaterThanOrEqual(afterPullIn.requiredMinutes!);
    }
  });

  it('pushing the exam back out re-plans and restores the horizon', () => {
    expect(afterPushOut.planVersion!).toBeGreaterThan(afterPullIn.planVersion!);
    expect(afterPushOut.availableMinutes!).toBeGreaterThan(afterPullIn.availableMinutes!);
  });

  it('the resulting plan is coherent — no duplicates, nothing stranded', () => {
    const live = liveTasks(afterPushOut);
    expect(duplicateConceptsOnSameDay(live)).toStrictEqual([]);
    expect(
      live.filter((t) => t.status === 'pending' && t.planId !== afterPushOut.planId),
    ).toStrictEqual([]);
  });

  it('the next action comes from the post-change plan', async () => {
    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    expect(recommendation.action).not.toBeNull();

    const row = afterRename.allTasks.find((t) => t.id === recommendation.action!.taskId);
    expect(row).toBeDefined();
    expect(row!.planId).toBe(afterRename.planId);
    expect(row!.planStatus).toBe('active');
  });

  // ── EVIDENCE IS UNTOUCHED ───────────────────────────────────────────────

  it('mastery and FSRS state survive the change exactly', () => {
    const before = evidenceBefore.get(studiedConceptId)!;
    const after = evidenceAfter.get(studiedConceptId)!;

    expect(after.mastery).toBe(before.mastery);
    expect(after.reps).toBe(before.reps);
    expect(after.stability).toBe(before.stability);
    expect(after.dueAt).toBe(before.dueAt);
    expect(after.evidenceCount).toBe(before.evidenceCount);
    expect(after.totalMinutes).toBe(before.totalMinutes);
  });

  it('the completed task keeps its completed status', () => {
    const completed = beforeChange.allTasks.filter((t) => t.status === 'completed');
    expect(completed.length).toBeGreaterThan(0);
    for (const task of completed) {
      expect(afterRename.allTasks.find((t) => t.id === task.id)?.status).toBe('completed');
    }
  });

  // ── A RENAME IS NOT A CONSTRAINT CHANGE ─────────────────────────────────

  it('renaming the goal does not churn the plan', () => {
    expect(afterRename.planVersion).toBe(afterPushOut.planVersion);
    expect(afterRename.planId).toBe(afterPushOut.planId);
  });

  // ── GUARDRAILS ──────────────────────────────────────────────────────────

  it('rejects a target date in the past rather than planning into it', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await expect(
      updateGoal(learner.user, learner.goal.id, { targetDate: yesterday }),
    ).rejects.toThrow(ApiError);
  });

  it('rejects a target date before the goal even started', async () => {
    // Would otherwise violate `goals_target_after_start` and surface as a 500.
    const row = await goalRow(learner);
    await expect(
      updateGoal(learner.user, learner.goal.id, { targetDate: row.startDate }),
    ).rejects.toThrow(ApiError);
  });

  it('will not let one learner edit another learner’s goal', async () => {
    const intruder = await createLearner({ dailyMinutes: 60, targetDays: 60 });
    try {
      await expect(updateGoal(intruder.user, learner.goal.id, { title: 'stolen' })).rejects.toThrow(
        ApiError,
      );

      // And the target goal is untouched.
      expect((await goalRow(learner)).title).not.toBe('stolen');
    } finally {
      await destroyLearner(intruder);
    }
  });
});
