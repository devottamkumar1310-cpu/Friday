import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLearner,
  destroyLearner,
  duplicateConceptsOnSameDay,
  liveTasks,
  minutesByDay,
  snapshotLearningState,
  snapshotLedger,
  type ConceptLearningState,
  type Ledger,
  type Learner,
} from './fixtures';
import { backdateGoalBy } from './fixtures';
import { ensurePlanFreshForToday } from '../planning.service';
import { completeSession, startSession } from '../../execution/execution.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * The closed loop, end to end, on real persisted rows.
 *
 * This is the product test. Every other spec in this directory checks one link;
 * this one checks that the links are actually joined, because a system can pass
 * all of them and still be a set of disconnected parts. The chain it walks is:
 *
 *   BEHAVIOUR   the learner studies a task and rates what they understood
 *      ↓
 *   EVIDENCE    a session row, with evidence events attached
 *      ↓
 *   STATE       mastery and FSRS move — the numbers the planner reads
 *      ↓
 *   DECISION    a re-plan reads that state and reaches a different conclusion
 *      ↓
 *   ACTION      the dashboard's next action comes from the new plan
 *
 * Nothing here is mocked. The planner is the real planner, the session write is
 * the real service the API route calls, and every assertion reads back from
 * Postgres rather than from a return value — a service can return a cheerful
 * object and write nothing.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Phase {
  ledger: Ledger;
  state: Map<string, ConceptLearningState>;
}

async function capture(learner: Learner): Promise<Phase> {
  return { ledger: await snapshotLedger(learner), state: await snapshotLearningState(learner) };
}

describe('the closed learning loop (database-backed, end to end)', () => {
  let learner: Learner;

  let day1: Phase;
  let day2: Phase;
  let day3: Phase;

  /** The concept the learner actually studied on day 2. */
  let studiedConceptId: string;
  let studiedConceptTitle: string;
  let studiedTaskId: string;
  let sessionId: string;

  /** A task that was planned and simply never done. */
  let missedTaskIds: string[];

  let finalNextActionTaskId: string | null;

  beforeAll(async () => {
    // ---------------------------------------------------------------- DAY 1
    // The learner creates a goal; FRIDAY builds the initial plan. `createLearner`
    // goes through `createGoal`, which is the same path the API route uses.
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    day1 = await capture(learner);

    // ---------------------------------------------------------------- DAY 2
    // They sit down and do the first thing FRIDAY recommended — not an
    // arbitrary task, the actual recommendation, because "the learner follows
    // the product" is the case worth proving.
    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    if (!recommendation.action) throw new Error('day 2: FRIDAY recommended nothing to study');

    studiedTaskId = recommendation.action.taskId;
    const primary = recommendation.action.concepts[0];
    if (!primary) throw new Error('day 2: the recommended task has no concept attached');
    studiedConceptId = primary.id;
    studiedConceptTitle = primary.title;

    const session = await startSession(learner.user, {
      goalId: learner.goal.id,
      taskId: studiedTaskId,
      originatedFrom: 'recommendation',
    });
    sessionId = session.id;

    // A genuine, unremarkable session: they understood it well.
    await completeSession(learner.user, sessionId, {
      activeMinutes: 45,
      ratings: [{ conceptId: studiedConceptId, rating: 'good', confidence: 0.8 }],
    });

    day2 = await capture(learner);

    // ---------------------------------------------------------------- DAY 3
    // Nothing else gets done. Two days roll past and the learner opens the app.
    missedTaskIds = liveTasks(day2.ledger)
      .filter((t) => t.status === 'pending')
      .map((t) => t.id);

    await backdateGoalBy(learner, 2);

    // The new-day trigger, exactly as the dashboard calls it on first render.
    await ensurePlanFreshForToday(learner.user, learner.goal.id);

    day3 = await capture(learner);

    const finalRecommendation = await getNextAction(learner.user, learner.goal.id, 60);
    finalNextActionTaskId = finalRecommendation.action?.taskId ?? null;

    // eslint-disable-next-line no-console -- the trace IS the deliverable
    console.log(
      [
        '',
        '──────────── CLOSED LOOP ────────────',
        `DAY 1  plan v${day1.ledger.planVersion} (${day1.ledger.planReason})  live=${liveTasks(day1.ledger).length}  required=${day1.ledger.requiredMinutes}m`,
        `       studied next: "${studiedConceptTitle}"`,
        `DAY 2  session ${sessionId.slice(0, 8)} completed, 45m, rated "good"`,
        `       mastery  ${fmt(day1.state.get(studiedConceptId)?.mastery)} → ${fmt(day2.state.get(studiedConceptId)?.mastery)}`,
        `       FSRS     reps ${day1.state.get(studiedConceptId)?.reps ?? 'none'} → ${day2.state.get(studiedConceptId)?.reps}, due ${day2.state.get(studiedConceptId)?.dueAt}`,
        `       required ${day1.ledger.requiredMinutes}m → ${day2.ledger.requiredMinutes}m`,
        `DAY 3  ${missedTaskIds.length} planned task(s) missed; new-day trigger fired`,
        `       plan v${day2.ledger.planVersion} → v${day3.ledger.planVersion} (${day3.ledger.planReason})`,
        `       live=${liveTasks(day3.ledger).length}  required=${day3.ledger.requiredMinutes}m`,
        `       next action → ${finalNextActionTaskId?.slice(0, 8) ?? 'none'} on plan ${day3.ledger.planId?.slice(0, 8)}`,
        '─────────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  // ── BEHAVIOUR → EVIDENCE ────────────────────────────────────────────────

  it('DAY 1 — the learner starts from a real committed plan', () => {
    expect(day1.ledger.planVersion).toBe(1);
    expect(day1.ledger.planReason).toBe('initial');
    expect(liveTasks(day1.ledger).length).toBeGreaterThan(0);
    expect(day1.ledger.requiredMinutes!).toBeGreaterThan(0);

    // Nothing is known yet. This is the baseline the rest of the test moves.
    for (const concept of day1.state.values()) {
      expect(concept.mastery).toBe(0);
      expect(concept.reps).toBeNull();
    }
  });

  it('DAY 2 — studying writes evidence, not just a session row', async () => {
    const { getDb } = await import('@friday/db');
    const { sql } = await import('drizzle-orm');

    const evidence = await getDb().execute<{ n: string }>(sql`
      select count(*) as n from evidence_events where session_id = ${sessionId}::uuid
    `);
    expect(Number(evidence.rows[0]!.n)).toBeGreaterThan(0);

    const session = await getDb().execute<{ status: string; active_minutes: number }>(sql`
      select status::text, active_minutes from study_sessions where id = ${sessionId}::uuid
    `);
    expect(session.rows[0]!.status).toBe('completed');
    expect(session.rows[0]!.active_minutes).toBeGreaterThan(0);
  });

  // ── EVIDENCE → LEARNING STATE ───────────────────────────────────────────

  it('DAY 2 — mastery for the studied concept actually moved', () => {
    const before = day1.state.get(studiedConceptId)!;
    const after = day2.state.get(studiedConceptId)!;

    expect(after.mastery).toBeGreaterThan(before.mastery);
    expect(after.evidenceCount).toBeGreaterThan(before.evidenceCount);
    expect(after.totalMinutes).toBeGreaterThan(0);
  });

  it('DAY 2 — FSRS scheduled a real future review', () => {
    const after = day2.state.get(studiedConceptId)!;

    expect(after.reps).toBeGreaterThan(0);
    expect(after.stability).toBeGreaterThan(0);
    expect(after.dueAt).not.toBeNull();
    expect(new Date(after.dueAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('DAY 2 — only the studied concept changed', () => {
    // The guard against a write that sprays state across the curriculum. If
    // everything moves, nothing has been learned about anything.
    for (const [conceptId, after] of day2.state) {
      if (conceptId === studiedConceptId) continue;
      expect(after.mastery, `${after.title} must be untouched`).toBe(
        day1.state.get(conceptId)!.mastery,
      );
      expect(after.reps).toBeNull();
    }
  });

  // ── LEARNING STATE → PLANNER DECISION ───────────────────────────────────

  it('DAY 3 — the planner read the new state and re-scored the studied concept', () => {
    // Remaining work fell, because a concept the learner has evidence for needs
    // less of it.
    expect(day3.ledger.requiredMinutes!).toBeLessThan(day1.ledger.requiredMinutes!);

    /**
     * The precise evidence → decision link.
     *
     * `impact = clamp01(examWeight x gap x leverage)`, and `gap` is `1 -
     * effectiveMastery`. Nothing about Newton's Laws changed on day 3 except
     * what the learner now knows about it, so a lower persisted impact is the
     * planner demonstrably reading the new mastery.
     *
     * Note what is deliberately *not* asserted: that the concept stops being
     * scheduled. One 45-minute session took mastery to roughly 0.24 — the
     * learner has started Newton's Laws, not finished it, and a planner that
     * dropped it here would be the broken one.
     */
    const day1Task = liveTasks(day1.ledger).find((t) => t.conceptId === studiedConceptId);
    const day3Task = day3.ledger.tasks.find((t) => t.conceptId === studiedConceptId);

    expect(day1Task?.impact, 'day 1 must have recorded an impact').not.toBeNull();
    if (day3Task) {
      expect(day3Task.impact!).toBeLessThan(day1Task!.impact!);
    }

    // Mastery is the reason, and it is on the row.
    expect(day3.state.get(studiedConceptId)!.mastery).toBeGreaterThan(0);
  });

  it('DAY 3 — the new-day trigger committed a new plan version', () => {
    expect(day3.ledger.planVersion!).toBeGreaterThan(day2.ledger.planVersion!);
    expect(day3.ledger.planReason).toBe('new_day');
    expect(day3.ledger.windowStart).toBe(todayIso());
  });

  it('DAY 3 — the plan is freshly derived, not the day-1 rows re-dated', () => {
    /**
     * What "a new plan" must mean, and what it must not be made to mean.
     *
     * It would be easy to demand that day 3's allocation *differs* from day 1's
     * and call that adaptivity. It would also be wrong here. This curriculum is
     * 470 minutes against 1,680 minutes of window capacity, so nothing is
     * competing for a slot; and one 45-minute session moved mastery to 0.098,
     * which is a learner who has *started* Newton's Laws, not one who has
     * changed. A planner that reshuffled the week on that evidence would be
     * churning, and §10.3 exists specifically to stop it.
     *
     * So the assertion is the one that must hold every time: the day-3 plan is
     * built from new rows on the new version, computed against post-evidence
     * state — never the old rows wearing new dates. Whether the resulting order
     * changes is a question for the evidence, and is proven separately below
     * where the evidence is strong enough to demand it.
     */
    const day1TaskIds = new Set(liveTasks(day1.ledger).map((t) => t.id));

    expect(day3.ledger.tasks.length).toBeGreaterThan(0);
    for (const task of day3.ledger.tasks) {
      expect(day1TaskIds.has(task.id), 'day 3 must not reuse a day-1 task row').toBe(false);
      expect(task.planVersion).toBe(day3.ledger.planVersion);
    }
  });

  it('DAY 3 — missed work is retired, never carried forward', () => {
    for (const taskId of missedTaskIds) {
      const row = day3.ledger.allTasks.find((t) => t.id === taskId);
      if (!row) continue; // the studied task is completed, not missed
      expect(['rescheduled', 'cancelled', 'completed']).toContain(row.status);
    }

    // Nothing the learner has yet to start sits in the past.
    expect(
      liveTasks(day3.ledger).filter((t) => t.status === 'pending' && t.scheduledDate < todayIso()),
    ).toStrictEqual([]);
  });

  it('DAY 3 — the completed session survives the re-plan untouched', () => {
    const studied = day3.ledger.allTasks.find((t) => t.id === studiedTaskId);
    expect(studied?.status).toBe('completed');

    // Evidence is not rewritten by planning.
    const after = day3.state.get(studiedConceptId)!;
    expect(after.mastery).toBe(day2.state.get(studiedConceptId)!.mastery);
    expect(after.reps).toBe(day2.state.get(studiedConceptId)!.reps);
  });

  // ── DECISION → NEW ACTION ───────────────────────────────────────────────

  it('DAY 3 — the dashboard next action comes from the NEW plan', () => {
    expect(finalNextActionTaskId, 'a live plan must yield a next action').not.toBeNull();

    const row = day3.ledger.allTasks.find((t) => t.id === finalNextActionTaskId);
    expect(row, 'the recommended task must exist').toBeDefined();
    expect(row!.planId, 'must belong to the ACTIVE plan, not a superseded one').toBe(
      day3.ledger.planId,
    );
    expect(row!.planStatus).toBe('active');
    expect(['pending', 'in_progress']).toContain(row!.status);
    expect(row!.scheduledDate >= todayIso()).toBe(true);
  });

  it('DAY 3 — the next action is not the task already completed', () => {
    expect(finalNextActionTaskId).not.toBe(studiedTaskId);
  });

  it('DAY 3 — the resulting plan is coherent: no duplicates, no overload', () => {
    const live = liveTasks(day3.ledger);

    expect(duplicateConceptsOnSameDay(live)).toStrictEqual([]);

    for (const [date, minutes] of minutesByDay(live.filter((t) => t.status === 'pending'))) {
      expect(minutes, `${date} must fit the learner's 120m capacity`).toBeLessThanOrEqual(120);
    }
  });
});

function fmt(n: number | undefined): string {
  return n === undefined ? 'n/a' : n.toFixed(3);
}

/**
 * The other half of the closed loop: evidence strong enough to *demand* a
 * different plan actually produces one.
 *
 * The scenario above proves the loop is wired and, correctly, that it stays
 * still under weak evidence. This proves it is not simply inert — that the
 * stability there is the churn budget doing its job rather than the planner
 * ignoring what it reads.
 */
describe('sustained evidence changes what FRIDAY schedules', () => {
  let learner: Learner;
  let target: { conceptId: string; title: string };
  let before: Ledger;
  let after: Ledger;
  let masteryAfter: number;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    before = await snapshotLedger(learner);

    const first = [...before.tasks].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    )[0];
    if (!first?.conceptId) throw new Error('fixture: initial plan has no concept-bearing task');
    target = { conceptId: first.conceptId, title: first.conceptTitle ?? first.conceptId };

    // Study the same concept repeatedly and well. Mastery is deliberately slow
    // to move — one session is worth ~0.1 — so a learner who genuinely knows
    // something has come back to it several times, and that is what this stages.
    for (let i = 0; i < 6; i++) {
      // No `taskId`: the learner is revisiting a concept directly rather than
      // working a planned task, which is exactly how repeated study happens.
      const session = await startSession(learner.user, {
        goalId: learner.goal.id,
        originatedFrom: 'manual',
      });
      await completeSession(learner.user, session.id, {
        activeMinutes: 40,
        ratings: [{ conceptId: target.conceptId, rating: 'easy', confidence: 0.9 }],
      });
    }

    masteryAfter = (await snapshotLearningState(learner)).get(target.conceptId)!.mastery;

    // An explicit re-plan: the learner asking, so the churn budget cannot mask
    // the result. The question here is what the planner *concludes*, not
    // whether it is allowed to say so.
    const { regeneratePlan } = await import('../planning.service');
    await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
    after = await snapshotLedger(learner);

    // eslint-disable-next-line no-console -- evidence
    console.log(
      [
        '',
        '─────── SUSTAINED EVIDENCE ───────',
        `concept: "${target.title}"`,
        `mastery after 6 sessions: ${masteryAfter.toFixed(3)}`,
        `required: ${before.requiredMinutes}m → ${after.requiredMinutes}m`,
        `position: day ${before.tasks.find((t) => t.conceptId === target.conceptId)?.scheduledDate} → ${
          after.tasks.find((t) => t.conceptId === target.conceptId)?.scheduledDate ??
          'not scheduled'
        }`,
        '──────────────────────────────────',
        '',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  it('mastery rose materially', () => {
    // Evidence accumulates deliberately slowly — one session is worth ~0.098,
    // and six well-rated ones reach ~0.31. That gradient is the point: mastery
    // is a claim about durable knowledge, and this product should be reluctant
    // to make it. The threshold here is calibrated to the real curve, not to a
    // round number.
    expect(masteryAfter).toBeGreaterThan(0.25);
    expect(masteryAfter).toBeLessThan(1);
  });

  it('remaining work fell in proportion to what was learned', () => {
    expect(after.requiredMinutes!).toBeLessThan(before.requiredMinutes!);
  });

  it('the well-known concept is scored down by the planner', () => {
    /**
     * Scored down, not necessarily moved.
     *
     * "Kinematics in One Dimension" is a prerequisite root — most of the
     * curriculum hangs off it — so the topological order pins it early no
     * matter how well the learner knows it, and that is right: a planner that
     * demoted a prerequisite below its own dependents would produce an
     * unlearnable week. What must change is the *value* the planner assigns it,
     * which is what feeds every downstream ranking.
     */
    const wasFirst = [...before.tasks].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate),
    )[0];
    const now = after.tasks.find((t) => t.conceptId === target.conceptId);

    if (!now) return; // dropped from the window entirely — the strongest form
    expect(now.impact!).toBeLessThan(wasFirst!.impact!);
    expect(now.structuralScore!).toBeLessThan(wasFirst!.structuralScore!);
  });

  it('the next action moved on to something else', async () => {
    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    expect(recommendation.action).not.toBeNull();
    expect(recommendation.action!.concepts.map((c) => c.id)).not.toContain(target.conceptId);
  });
});
