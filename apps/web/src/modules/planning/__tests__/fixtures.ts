import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  availabilityRules,
  concepts,
  getDb,
  goals,
  plans,
  studySessions,
  tasks,
  users,
  type GoalRow,
  type TaskRow,
  type UserRow,
} from '@friday/db';
import { createGoal } from '../../curriculum/curriculum.service';

/**
 * Fixtures for the database-backed adaptive-loop specs.
 *
 * Every scenario builds a **throwaway learner** rather than reusing the seeded
 * demo accounts. The specs assert on plan-version sequences, churn-budget
 * windows and whole-ledger diffs, none of which survive sharing a goal with
 * another run. A fresh user per test is a few hundred milliseconds and removes
 * an entire class of flake.
 */

const JEE_TEMPLATE_SLUG = 'jee-physics-foundations';

export interface Learner {
  user: UserRow;
  goal: GoalRow;
}

function isoDaysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A learner with availability every day and a goal far enough out that the
 * initial verdict is `on_track`. Scenarios that need scarcity make it scarce
 * themselves — starting from a feasible plan means a later `at_risk` is a
 * result rather than the starting condition.
 */
export async function createLearner(
  options: { dailyMinutes?: number; targetDays?: number } = {},
): Promise<Learner> {
  const db = getDb();
  const dailyMinutes = options.dailyMinutes ?? 120;

  const [user] = await db
    .insert(users)
    .values({
      email: `itest-${randomUUID()}@friday.test`,
      displayName: 'Integration Test Learner',
      timezone: 'UTC',
      dateOfBirth: '1995-01-01',
      isMinor: false,
      onboardingState: { step: 'complete', completed: true },
    })
    .returning();
  if (!user) throw new Error('fixture: user insert returned no row');

  const endHour = Math.floor(dailyMinutes / 60);
  const endMinute = dailyMinutes % 60;
  await db.insert(availabilityRules).values(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      userId: user.id,
      dayOfWeek,
      startTime: '09:00:00',
      endTime: `${String(9 + endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
      kind: 'available',
    })),
  );

  const goal = await createGoal(user, {
    title: 'Integration Test Goal',
    type: 'exam',
    templateSlug: JEE_TEMPLATE_SLUG,
    targetDate: isoDaysFromToday(options.targetDays ?? 60),
    targetWeeklyMinutes: dailyMinutes * 7,
  });

  return { user, goal: goal.goal };
}

/** Cascades through goals, plans, tasks, sessions and mastery/memory rows. */
export async function destroyLearner(learner: Learner): Promise<void> {
  await getDb().delete(users).where(eq(users.id, learner.user.id));
}

// ---------------------------------------------------------------------------
// Ledger snapshots
// ---------------------------------------------------------------------------

export interface LedgerTask {
  id: string;
  planId: string;
  planVersion: number;
  planStatus: string;
  conceptId: string | null;
  conceptTitle: string | null;
  type: string;
  status: string;
  scheduledDate: string;
  estimatedMinutes: number;
  examWeight: number | null;
  /** The scheduler's own recorded reason for placing this task (§13.1). */
  impact: number | null;
  structuralScore: number | null;
}

export interface Ledger {
  planId: string | null;
  planVersion: number | null;
  planReason: string | null;
  verdict: string | null;
  requiredMinutes: number | null;
  availableMinutes: number | null;
  windowStart: string | null;
  tasks: LedgerTask[];
  /** Every task row for the goal, including ones on superseded plans. */
  allTasks: LedgerTask[];
}

/**
 * The whole truth about a goal's planning state, in one object.
 *
 * Deliberately reads **every** task row for the goal rather than only the
 * active plan's, because the interesting failures live in the gap between
 * those two sets: work that a re-plan orphaned on a superseded version, and
 * work that got duplicated because the old version's rows were never retired.
 * A snapshot that only looked at the active plan would show both as healthy.
 */
export async function snapshotLedger(learner: Learner): Promise<Ledger> {
  const db = getDb();

  const rows = await db.execute<{
    task_id: string;
    plan_id: string;
    plan_version: number;
    plan_status: string;
    concept_id: string | null;
    concept_title: string | null;
    task_type: string;
    task_status: string;
    scheduled_date: string;
    estimated_minutes: number;
    exam_weight: string | null;
    impact: number | null;
    structural_score: string | null;
  }>(sql`
    select t.id            as task_id,
           p.id            as plan_id,
           p.version       as plan_version,
           p.status::text  as plan_status,
           c.id            as concept_id,
           c.title         as concept_title,
           t.type::text    as task_type,
           t.status::text  as task_status,
           t.scheduled_date::text as scheduled_date,
           t.estimated_minutes,
           c.exam_weight,
           (t.structural_factors ->> 'impact')::float8 as impact,
           t.structural_score
      from tasks t
      join plans p on p.id = t.plan_id
      left join task_concepts tc on tc.task_id = t.id and tc.is_primary
      left join concepts c on c.id = tc.concept_id
     where t.goal_id = ${learner.goal.id}
     order by p.version, t.scheduled_date, c.title
  `);

  const allTasks: LedgerTask[] = rows.rows.map((r) => ({
    id: r.task_id,
    planId: r.plan_id,
    planVersion: r.plan_version,
    planStatus: r.plan_status,
    conceptId: r.concept_id,
    conceptTitle: r.concept_title,
    type: r.task_type,
    status: r.task_status,
    scheduledDate: r.scheduled_date,
    estimatedMinutes: r.estimated_minutes,
    examWeight: r.exam_weight === null ? null : Number(r.exam_weight),
    impact: r.impact,
    structuralScore: r.structural_score === null ? null : Number(r.structural_score),
  }));

  const [activePlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.goalId, learner.goal.id), eq(plans.status, 'active')))
    .limit(1);

  return {
    planId: activePlan?.id ?? null,
    planVersion: activePlan?.version ?? null,
    planReason: activePlan?.reason ?? null,
    verdict: activePlan?.verdict ?? null,
    requiredMinutes: activePlan?.requiredMinutes ?? null,
    availableMinutes: activePlan?.availableMinutes ?? null,
    windowStart: activePlan?.windowStart ?? null,
    tasks: allTasks.filter((t) => t.planId === activePlan?.id),
    allTasks,
  };
}

/**
 * Work the learner can still be asked to do, wherever it lives.
 *
 * This is the number the product actually shows: the dashboard, the plan view
 * and the AI context all query tasks by *goal*, not by plan, so a task left
 * `pending` on a superseded version is as real to the learner as one on the
 * active plan. Conservation and no-compounding assertions have to use this
 * definition or they measure something the learner never sees.
 */
export function liveTasks(ledger: Ledger): LedgerTask[] {
  return ledger.allTasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
}

export function liveMinutes(ledger: Ledger): number {
  return liveTasks(ledger).reduce((sum, t) => sum + t.estimatedMinutes, 0);
}

// ---------------------------------------------------------------------------
// Time travel
// ---------------------------------------------------------------------------

/**
 * Moves a plan and its tasks into the past so "today" looks like a later day.
 *
 * The alternative — faking the system clock — does not work here, because the
 * assertions are about rows that Postgres stamps with `now()` and about date
 * arithmetic that happens in SQL. Backdating the data is the honest version of
 * the same experiment: it produces exactly the state a learner would be in on
 * the morning after, with no clock-mocking to disbelieve.
 */
export async function backdateGoalBy(learner: Learner, days: number): Promise<void> {
  const db = getDb();
  const shift = sql.raw(`interval '${Math.trunc(days)} days'`);

  await db.execute(sql`
    update plans set window_start = window_start - ${shift},
                     window_end   = window_end   - ${shift},
                     created_at   = created_at   - ${shift}
     where goal_id = ${learner.goal.id}
  `);
  await db.execute(sql`
    update tasks set scheduled_date = scheduled_date - ${shift}
     where goal_id = ${learner.goal.id}
  `);
  await db.execute(sql`
    update study_blocks sb set scheduled_date = sb.scheduled_date - ${shift}
      from plans p where p.id = sb.plan_id and p.goal_id = ${learner.goal.id}
  `);
}

/** Pushes a single task's date back, to make exactly that task overdue. */
export async function backdateTasks(taskIds: string[], days: number): Promise<void> {
  if (taskIds.length === 0) return;
  await getDb().execute(sql`
    update tasks set scheduled_date = scheduled_date - ${sql.raw(`interval '${Math.trunc(days)} days'`)}
     where id in (${sql.join(
       taskIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
  `);
}

export async function setTaskStatus(taskId: string, status: TaskRow['status']): Promise<void> {
  await getDb()
    .update(tasks)
    .set({ status, ...(status === 'completed' ? { completedAt: new Date() } : {}) })
    .where(eq(tasks.id, taskId));
}

export async function findConceptByTitle(learner: Learner, title: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(concepts)
    .where(and(eq(concepts.userId, learner.user.id), eq(concepts.title, title)))
    .limit(1);
  return row;
}

export async function countSessions(learner: Learner): Promise<number> {
  const rows = await getDb()
    .select()
    .from(studySessions)
    .where(eq(studySessions.goalId, learner.goal.id));
  return rows.length;
}

export async function listPlanVersions(learner: Learner) {
  return getDb()
    .select()
    .from(plans)
    .where(eq(plans.goalId, learner.goal.id))
    .orderBy(plans.version);
}

export async function goalRow(learner: Learner): Promise<GoalRow> {
  const [row] = await getDb().select().from(goals).where(eq(goals.id, learner.goal.id)).limit(1);
  if (!row) throw new Error('fixture: goal disappeared');
  return row;
}

// ---------------------------------------------------------------------------
// Learning-state snapshots
// ---------------------------------------------------------------------------

export interface ConceptLearningState {
  conceptId: string;
  title: string;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  totalMinutes: number;
  /** FSRS. Null when the concept has never been reviewed. */
  stability: number | null;
  difficulty: number | null;
  reps: number | null;
  state: string | null;
  dueAt: string | null;
}

/**
 * Everything the planner reads about what the learner knows.
 *
 * The closed-loop proof turns on being able to say "this specific number moved,
 * and the plan moved because of it". That needs mastery and FSRS captured
 * together, keyed by concept, at a point in time — reading them separately
 * afterwards cannot distinguish a state change from a re-read.
 */
export async function snapshotLearningState(
  learner: Learner,
): Promise<Map<string, ConceptLearningState>> {
  const rows = await getDb().execute<{
    concept_id: string;
    title: string;
    mastery: string | null;
    confidence: string | null;
    evidence_count: number | null;
    total_minutes: number | null;
    stability: string | null;
    difficulty: string | null;
    reps: number | null;
    state: string | null;
    due_at: string | null;
  }>(sql`
    select c.id                 as concept_id,
           c.title,
           ms.mastery,
           ms.confidence,
           ms.evidence_count,
           ms.total_minutes,
           mem.stability,
           mem.difficulty,
           mem.reps,
           mem.state::text      as state,
           mem.due_at::text     as due_at
      from concepts c
      join curricula cur on cur.id = c.curriculum_id
      left join mastery_states ms on ms.concept_id = c.id and ms.user_id = c.user_id
      left join memory_states mem on mem.concept_id = c.id and mem.user_id = c.user_id
     where cur.goal_id = ${learner.goal.id}
  `);

  return new Map(
    rows.rows.map((r) => [
      r.concept_id,
      {
        conceptId: r.concept_id,
        title: r.title,
        mastery: r.mastery === null ? 0 : Number(r.mastery),
        confidence: r.confidence === null ? 0 : Number(r.confidence),
        evidenceCount: r.evidence_count ?? 0,
        totalMinutes: r.total_minutes ?? 0,
        stability: r.stability === null ? null : Number(r.stability),
        difficulty: r.difficulty === null ? null : Number(r.difficulty),
        reps: r.reps,
        state: r.state,
        dueAt: r.due_at,
      },
    ]),
  );
}

/**
 * Rewrites availability wholesale, the way the settings form does.
 *
 * Returns nothing: callers that need the planner to react must invoke the
 * availability-change trigger themselves, because proving *that the trigger
 * fires* is half of what the availability scenarios are for.
 */
export async function setDailyAvailability(
  learner: Learner,
  dailyMinutes: number,
  options: { days?: number[] } = {},
): Promise<void> {
  const db = getDb();
  await db.delete(availabilityRules).where(eq(availabilityRules.userId, learner.user.id));
  if (dailyMinutes <= 0) return;

  const days = options.days ?? [0, 1, 2, 3, 4, 5, 6];
  const endHour = 9 + Math.floor(dailyMinutes / 60);
  const endMinute = dailyMinutes % 60;
  await db.insert(availabilityRules).values(
    days.map((dayOfWeek) => ({
      userId: learner.user.id,
      dayOfWeek,
      startTime: '09:00:00',
      endTime: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
      kind: 'available',
    })),
  );
}

/** Per-day scheduled minutes across live tasks — the learner's actual load. */
export function minutesByDay(tasks: LedgerTask[]): Map<string, number> {
  const perDay = new Map<string, number>();
  for (const t of tasks) {
    perDay.set(t.scheduledDate, (perDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
  }
  return perDay;
}

export async function tasksByIds(ids: string[]): Promise<TaskRow[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(tasks).where(inArray(tasks.id, ids));
}

/**
 * Genuine duplication, distinguished from adaptive splitting.
 *
 * Until Phase 4 a concept meant exactly one task, so `distinct === total` was a
 * sound duplication check. Adaptive sizing breaks that premise on purpose: a
 * 50-minute concept under a 15-minute session budget becomes four blocks across
 * four days, and the total is conserved (15+15+15+5), not multiplied.
 *
 * What still must never happen is the failure those checks were written for —
 * the same work offered twice over. That is now precisely expressible: a
 * concept may span days, but may never appear twice on one day.
 */
export function duplicateConceptsOnSameDay(tasks: LedgerTask[]): string[] {
  const seen = new Map<string, Set<string>>();
  const offenders: string[] = [];
  for (const task of tasks) {
    if (!task.conceptId) continue;
    const onDay = seen.get(task.scheduledDate) ?? new Set<string>();
    if (onDay.has(task.conceptId)) {
      offenders.push(`${task.conceptTitle} twice on ${task.scheduledDate}`);
    }
    onDay.add(task.conceptId);
    seen.set(task.scheduledDate, onDay);
  }
  return offenders;
}
