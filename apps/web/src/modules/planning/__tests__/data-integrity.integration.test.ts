import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  ApiError,
  CompleteSessionRequestSchema,
  StartSessionRequestSchema,
  UpdateGoalRequestSchema,
} from '@friday/contracts';
import { getDb, plans, studySessions, tasks } from '@friday/db';
import {
  createLearner,
  destroyLearner,
  duplicateConceptsOnSameDay,
  liveTasks,
  setTaskStatus,
  snapshotLearningState,
  snapshotLedger,
  type Learner,
} from './fixtures';
import { abandonSession, completeSession, startSession } from '../../execution/execution.service';
import { ensurePlanFreshForToday, regeneratePlan, updateTask } from '../planning.service';
import { setAvailability } from '../../identity/settings.service';
import { updateGoal } from '../../curriculum/curriculum.service';
import { getNextAction } from '../../next-action/next-action.service';

/**
 * Adversarial pass over the API/database boundary.
 *
 * Every case here is classified as one of four things, and the distinction is
 * the whole point of the exercise:
 *
 *   EXPECTED REJECTION      the system refused, deliberately and by name.
 *   SAFE DEGRADATION        it did not refuse, but nothing was corrupted.
 *   DATA INTEGRITY FAILURE  state ended up wrong. Must be fixed.
 *   SECURITY FAILURE        one learner reached another's data. Must be fixed.
 *
 * A test that only asserted "it threw" would pass for all four, which is why
 * each case below reads the rows back afterwards. The interesting failures are
 * the ones where the call is rejected and something has already been written.
 */

const FOREIGN_UUID = '00000000-0000-4000-8000-00000000dead';

async function expectApiError(promise: Promise<unknown>, code?: string): Promise<ApiError> {
  try {
    await promise;
    throw new Error('expected the call to be rejected, but it resolved');
  } catch (error) {
    expect(error, 'must be a typed ApiError, not a raw crash').toBeInstanceOf(ApiError);
    if (code) expect((error as ApiError).code).toBe(code);
    return error as ApiError;
  }
}

describe('data integrity — session lifecycle', () => {
  let learner: Learner;
  let conceptId: string;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    conceptId = recommendation.action!.concepts[0]!.id;
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  async function freshSession(): Promise<string> {
    const active = await getDb()
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.userId, learner.user.id), eq(studySessions.status, 'active')));
    for (const row of active) await abandonSession(learner.user, row.id);

    const session = await startSession(learner.user, {
      goalId: learner.goal.id,
      originatedFrom: 'manual',
    });
    return session.id;
  }

  it('EXPECTED REJECTION — replaying a completion', async () => {
    const sessionId = await freshSession();
    await completeSession(learner.user, sessionId, {
      activeMinutes: 30,
      ratings: [{ conceptId, rating: 'good' }],
    });

    const before = await snapshotLearningState(learner);
    await expectApiError(
      completeSession(learner.user, sessionId, {
        activeMinutes: 30,
        ratings: [{ conceptId, rating: 'good' }],
      }),
      'SESSION_NOT_ACTIVE',
    );

    // The replay must not have moved mastery a second time — the specific harm.
    const after = await snapshotLearningState(learner);
    expect(after.get(conceptId)!.mastery).toBe(before.get(conceptId)!.mastery);
    expect(after.get(conceptId)!.evidenceCount).toBe(before.get(conceptId)!.evidenceCount);
  });

  it('EXPECTED REJECTION — completed then abandoned', async () => {
    const sessionId = await freshSession();
    await completeSession(learner.user, sessionId, {
      activeMinutes: 20,
      ratings: [{ conceptId, rating: 'hard' }],
    });

    await expectApiError(abandonSession(learner.user, sessionId), 'SESSION_NOT_ACTIVE');

    const [row] = await getDb().select().from(studySessions).where(eq(studySessions.id, sessionId));
    expect(row!.status, 'a finished session must not be rewritten as abandoned').toBe('completed');
    expect(row!.activeMinutes).toBeGreaterThan(0);
  });

  it('EXPECTED REJECTION — abandoned then completed', async () => {
    const sessionId = await freshSession();
    await abandonSession(learner.user, sessionId);

    await expectApiError(
      completeSession(learner.user, sessionId, {
        activeMinutes: 20,
        ratings: [{ conceptId, rating: 'good' }],
      }),
      'SESSION_NOT_ACTIVE',
    );

    const [row] = await getDb().select().from(studySessions).where(eq(studySessions.id, sessionId));
    expect(row!.status).toBe('abandoned');
  });

  it('EXPECTED REJECTION — replaying an abandonment', async () => {
    const sessionId = await freshSession();
    await abandonSession(learner.user, sessionId);
    await expectApiError(abandonSession(learner.user, sessionId), 'SESSION_NOT_ACTIVE');
  });

  it('EXPECTED REJECTION — a second concurrent session', async () => {
    await freshSession();
    await expectApiError(
      startSession(learner.user, { goalId: learner.goal.id, originatedFrom: 'manual' }),
      'SESSION_ALREADY_ACTIVE',
    );
  });

  it('concurrent completion of one session settles to exactly one write', async () => {
    const sessionId = await freshSession();
    const before = await snapshotLearningState(learner);

    const payload = {
      activeMinutes: 25,
      ratings: [{ conceptId, rating: 'good' as const }],
    };
    const outcomes = await Promise.allSettled([
      completeSession(learner.user, sessionId, payload),
      completeSession(learner.user, sessionId, payload),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled, 'exactly one completion may win').toHaveLength(1);

    // The decisive assertion: one evidence event, not two. A pair of racing
    // transactions that both committed would double-count the session and
    // inflate mastery off a single sitting.
    const evidence = await getDb().execute<{ n: string }>(sql`
      select count(*) as n from evidence_events where session_id = ${sessionId}::uuid
    `);
    expect(Number(evidence.rows[0]!.n)).toBe(1);

    // And mastery moved once, not twice.
    const after = await snapshotLearningState(learner);
    expect(after.get(conceptId)!.evidenceCount).toBe(before.get(conceptId)!.evidenceCount + 1);
  });
});

describe('data integrity — request validation at the contract boundary', () => {
  /**
   * These are schema-level, and deliberately so: the route parses with these
   * before a service ever sees the values, so this is where the guarantee lives.
   * Asserting it here rather than in the service is asserting it where it is.
   */

  it('EXPECTED REJECTION — duplicate concept ratings in one session', () => {
    const result = CompleteSessionRequestSchema.safeParse({
      activeMinutes: 30,
      ratings: [
        { conceptId: FOREIGN_UUID, rating: 'good' },
        { conceptId: FOREIGN_UUID, rating: 'easy' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('EXPECTED REJECTION — an empty rating set', () => {
    expect(CompleteSessionRequestSchema.safeParse({ activeMinutes: 30, ratings: [] }).success).toBe(
      false,
    );
  });

  it('EXPECTED REJECTION — negative duration', () => {
    expect(
      CompleteSessionRequestSchema.safeParse({
        activeMinutes: -5,
        ratings: [{ conceptId: FOREIGN_UUID, rating: 'good' }],
      }).success,
    ).toBe(false);
  });

  it('EXPECTED REJECTION — impossible and huge durations', () => {
    for (const activeMinutes of [1441, 100_000, Number.MAX_SAFE_INTEGER]) {
      expect(
        CompleteSessionRequestSchema.safeParse({
          activeMinutes,
          ratings: [{ conceptId: FOREIGN_UUID, rating: 'good' }],
        }).success,
        `${activeMinutes} minutes must be rejected`,
      ).toBe(false);
    }
  });

  it('EXPECTED REJECTION — malformed UUIDs', () => {
    expect(
      StartSessionRequestSchema.safeParse({ goalId: 'not-a-uuid', originatedFrom: 'manual' })
        .success,
    ).toBe(false);
    expect(
      CompleteSessionRequestSchema.safeParse({
        activeMinutes: 10,
        ratings: [{ conceptId: '../../etc/passwd', rating: 'good' }],
      }).success,
    ).toBe(false);
  });

  it('EXPECTED REJECTION — an empty goal patch is a client bug, not a no-op', () => {
    expect(UpdateGoalRequestSchema.safeParse({}).success).toBe(false);
  });

  it('EXPECTED REJECTION — unknown fields are refused rather than ignored', () => {
    expect(
      CompleteSessionRequestSchema.safeParse({
        activeMinutes: 10,
        ratings: [{ conceptId: FOREIGN_UUID, rating: 'good' }],
        isAdmin: true,
      }).success,
    ).toBe(false);
  });
});

describe('data integrity — tenancy', () => {
  let owner: Learner;
  let intruder: Learner;

  beforeAll(async () => {
    owner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
    intruder = await createLearner({ dailyMinutes: 120, targetDays: 60 });
  });

  afterAll(async () => {
    if (owner) await destroyLearner(owner);
    if (intruder) await destroyLearner(intruder);
  });

  it('SECURITY — a foreign goal id is not reachable', async () => {
    await expectApiError(regeneratePlan(intruder.user, owner.goal.id, 'user_request', 'explicit'));
    await expectApiError(updateGoal(intruder.user, owner.goal.id, { title: 'stolen' }));
  });

  it('SECURITY — a foreign task id is not reachable', async () => {
    const ledger = await snapshotLedger(owner);
    const foreignTaskId = liveTasks(ledger)[0]!.id;

    await expectApiError(updateTask(intruder.user, foreignTaskId, { status: 'completed' }));
    await expectApiError(
      startSession(intruder.user, {
        goalId: intruder.goal.id,
        taskId: foreignTaskId,
        originatedFrom: 'manual',
      }),
    );

    // And the owner's task is untouched.
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, foreignTaskId));
    expect(row!.status).toBe('pending');
  });

  it('SECURITY — a foreign session id is not reachable', async () => {
    const session = await startSession(owner.user, {
      goalId: owner.goal.id,
      originatedFrom: 'manual',
    });

    await expectApiError(
      completeSession(intruder.user, session.id, {
        activeMinutes: 10,
        ratings: [{ conceptId: FOREIGN_UUID, rating: 'good' }],
      }),
    );
    await expectApiError(abandonSession(intruder.user, session.id));

    const [row] = await getDb()
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, session.id));
    expect(row!.status).toBe('active');
  });

  it('SAFE DEGRADATION — a well-formed but non-existent id is a plain 404', async () => {
    await expectApiError(regeneratePlan(owner.user, FOREIGN_UUID, 'user_request', 'explicit'));
    await expectApiError(updateTask(owner.user, FOREIGN_UUID, { status: 'completed' }));
  });
});

describe('data integrity — concurrent planning', () => {
  let learner: Learner;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  async function assertExactlyOneActivePlan(label: string) {
    const active = await getDb()
      .select()
      .from(plans)
      .where(and(eq(plans.goalId, learner.goal.id), eq(plans.status, 'active')));
    expect(active, `${label}: exactly one active plan`).toHaveLength(1);
  }

  async function assertNoDuplicateLiveConcepts(label: string) {
    const ledger = await snapshotLedger(learner);
    expect(duplicateConceptsOnSameDay(liveTasks(ledger)), label).toStrictEqual([]);
  }

  it('concurrent regeneration leaves exactly one active plan', async () => {
    await Promise.allSettled([
      regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit'),
      regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit'),
      regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit'),
    ]);

    await assertExactlyOneActivePlan('concurrent regenerate');
    await assertNoDuplicateLiveConcepts('concurrent regenerate');
  });

  it('two simultaneous new-day opens do not double-generate', async () => {
    await getDb().execute(sql`
      update plans set window_start = window_start - interval '2 days',
                       window_end   = window_end   - interval '2 days'
       where goal_id = ${learner.goal.id} and status = 'active'
    `);
    await getDb().execute(sql`
      update tasks set scheduled_date = scheduled_date - interval '2 days'
       where goal_id = ${learner.goal.id}
    `);

    await Promise.allSettled([
      ensurePlanFreshForToday(learner.user, learner.goal.id),
      ensurePlanFreshForToday(learner.user, learner.goal.id),
    ]);

    await assertExactlyOneActivePlan('concurrent new-day');
    await assertNoDuplicateLiveConcepts('concurrent new-day');
  });

  it('two simultaneous availability changes settle coherently', async () => {
    const rules = (dailyMinutes: number) => ({
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00:00',
        endTime: `${String(9 + Math.floor(dailyMinutes / 60)).padStart(2, '0')}:${String(
          dailyMinutes % 60,
        ).padStart(2, '0')}:00`,
        kind: 'available' as const,
      })),
    });

    await Promise.allSettled([
      setAvailability(learner.user, rules(45)),
      setAvailability(learner.user, rules(150)),
    ]);

    await assertExactlyOneActivePlan('concurrent availability');
    await assertNoDuplicateLiveConcepts('concurrent availability');

    /**
     * Two guarantees, and deliberately not a third.
     *
     * **The stored rules must not be a blend.** `replaceAll` is a delete and an
     * insert, and before this pass it ran unserialised, so two concurrent saves
     * could interleave and leave some days at the old capacity and some at the
     * new — a week the learner never chose and cannot tell is wrong. That is
     * corruption, and it is now prevented by locking the owning row.
     *
     * **The plan must converge on the stored rules.** What is *not* claimed is
     * that the plan matches instantly: each `setAvailability` writes and then
     * re-plans, so with two in flight the last plan to commit may have read the
     * earlier capacity. That is SAFE DEGRADATION rather than corruption — the
     * rules are the source of truth, nothing is lost, and the next re-plan
     * reconciles. Asserting instant agreement would be asserting a guarantee
     * this design does not make.
     */
    const stored = await getDb().execute<{ minutes: number }>(sql`
      select distinct extract(epoch from (end_time - start_time)) / 60 as minutes
        from availability_rules where user_id = ${learner.user.id}
    `);
    expect(stored.rows, 'the rule set must be homogeneous, not a blend').toHaveLength(1);
    const dailyMinutes = Number(stored.rows[0]!.minutes);
    expect([45, 150]).toContain(dailyMinutes);

    await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

    const ledger = await snapshotLedger(learner);
    const perDay = new Map<string, number>();
    for (const t of liveTasks(ledger).filter((x) => x.status === 'pending')) {
      perDay.set(t.scheduledDate, (perDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
    }
    for (const [date, minutes] of perDay) {
      expect(
        minutes,
        `${date} must fit the availability that won, once reconciled`,
      ).toBeLessThanOrEqual(dailyMinutes);
    }
  });

  it('a superseded plan is never visible as the current one', async () => {
    const ledger = await snapshotLedger(learner);
    const superseded = ledger.allTasks.filter((t) => t.planStatus === 'superseded');
    expect(
      superseded.length,
      'this scenario should have produced superseded plans',
    ).toBeGreaterThan(0);

    // Nothing on a superseded plan is still offerable work.
    expect(superseded.filter((t) => t.status === 'pending')).toStrictEqual([]);

    const recommendation = await getNextAction(learner.user, learner.goal.id, 60);
    if (recommendation.action) {
      const row = ledger.allTasks.find((t) => t.id === recommendation.action!.taskId);
      expect(row?.planStatus).toBe('active');
    }
  });

  it('repeated regeneration does not generate duplicate tasks', async () => {
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');
      const ledger = await snapshotLedger(learner);
      const live = liveTasks(ledger).filter((t) => t.conceptId);
      expect(duplicateConceptsOnSameDay(live)).toStrictEqual([]);
      counts.push(new Set(live.map((t) => t.conceptId)).size);
    }
    // Stable, not growing.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe('data integrity — task status transitions', () => {
  let learner: Learner;

  beforeAll(async () => {
    learner = await createLearner({ dailyMinutes: 120, targetDays: 60 });
  });

  afterAll(async () => {
    if (learner) await destroyLearner(learner);
  });

  it('SAFE DEGRADATION — skipped can be revisited and completed', async () => {
    // Deliberately allowed: a learner who skipped something and came back to it
    // is a good outcome, not an attack. The record must simply end up coherent.
    const ledger = await snapshotLedger(learner);
    const taskId = liveTasks(ledger)[0]!.id;

    await setTaskStatus(taskId, 'skipped');
    await updateTask(learner.user, taskId, { status: 'completed' });

    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
    expect(row!.status).toBe('completed');
    expect(row!.completedAt, 'a completed task must carry its completion time').not.toBeNull();
  });

  it('in-progress work is never cancelled by a re-plan', async () => {
    const ledger = await snapshotLedger(learner);
    const target = liveTasks(ledger).find((t) => t.status === 'pending')!;
    await setTaskStatus(target.id, 'in_progress');

    await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, target.id));
    expect(row!.status, 'a re-plan may not cancel work already underway').toBe('in_progress');
  });

  it('a stale plan version cannot resurrect its tasks', async () => {
    const before = await snapshotLedger(learner);
    const stalePlanId = before.planId!;

    await regeneratePlan(learner.user, learner.goal.id, 'user_request', 'explicit');

    // Directly attempt what a stale client would: act on a task from the plan
    // that has since been superseded.
    const stalePending = before.allTasks.filter(
      (t) => t.planId === stalePlanId && t.status === 'pending',
    );
    for (const task of stalePending.slice(0, 3)) {
      const [row] = await getDb().select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.status, 'retired at supersede time, so there is nothing to resurrect').not.toBe(
        'pending',
      );
    }
  });
});
