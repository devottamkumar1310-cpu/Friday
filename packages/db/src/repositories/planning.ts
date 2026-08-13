import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  plans,
  studyBlocks,
  taskConcepts,
  tasks,
  type NewPlanRow,
  type NewStudyBlockRow,
  type NewTaskRow,
  type PlanRow,
  type StudyBlockRow,
  type TaskRow,
} from '../schema/planning';
import type { Executor } from './executor';

/**
 * Plans, blocks, and tasks — DATABASE_DESIGN §4.3 near-horizon materialisation
 * (ADR-014). `plans_one_active` is the storage-level backstop for "exactly
 * one active plan per goal"; superseding is a two-step update inside the
 * caller's transaction (mark old superseded, insert new as active).
 */
export function planningRepository(db: Executor) {
  return {
    async create(input: NewPlanRow): Promise<PlanRow> {
      const [row] = await db.insert(plans).values(input).returning();
      if (!row) throw new Error('Insert into plans returned no row.');
      return row;
    },

    async findActive(userId: string, goalId: string): Promise<PlanRow | undefined> {
      const [row] = await db
        .select()
        .from(plans)
        .where(and(eq(plans.goalId, goalId), eq(plans.userId, userId), eq(plans.status, 'active')))
        .limit(1);
      return row;
    },

    async supersede(userId: string, planId: string): Promise<void> {
      await db
        .update(plans)
        .set({ status: 'superseded' })
        .where(and(eq(plans.id, planId), eq(plans.userId, userId)));
    },

    /**
     * Retires the work a superseded plan was still asking for.
     *
     * `supersede` only moved the plan row's status, which left every one of its
     * `pending` tasks visible to `listPendingTasks` — a query that filters on
     * status and never on plan. The learner then saw the union of every plan
     * version ever generated: collapsing availability from a full week to one
     * hour grew the visible workload from 465 to 555 minutes, because the new
     * 90-minute plan was *added to* the old 465-minute one rather than
     * replacing it. That is the backlog this product exists to prevent, and it
     * compounded on every re-plan.
     *
     * `in_progress` is deliberately excluded. A re-plan can fire while the
     * learner is mid-session — completing a session is itself a trigger — and
     * cancelling the task under a running session would destroy work the
     * learner is doing right now. It stays, and its evidence lands normally.
     *
     * `completed`, `skipped` and `rescheduled` are history and are never
     * touched: they are the evidence the engine learns from.
     */
    async cancelPendingTasksForPlan(userId: string, planId: string): Promise<number> {
      const rows = await db
        .update(tasks)
        .set({ status: 'cancelled' })
        .where(
          and(eq(tasks.planId, planId), eq(tasks.userId, userId), eq(tasks.status, 'pending')),
        )
        .returning({ id: tasks.id });
      return rows.length;
    },

    async listVersions(userId: string, goalId: string): Promise<PlanRow[]> {
      return db
        .select()
        .from(plans)
        .where(and(eq(plans.goalId, goalId), eq(plans.userId, userId)))
        .orderBy(desc(plans.version));
    },

    async insertBlocks(rows: NewStudyBlockRow[]): Promise<StudyBlockRow[]> {
      if (rows.length === 0) return [];
      return db.insert(studyBlocks).values(rows).returning();
    },

    async insertTasks(rows: NewTaskRow[]): Promise<TaskRow[]> {
      if (rows.length === 0) return [];
      return db.insert(tasks).values(rows).returning();
    },

    async insertTaskConcepts(rows: (typeof taskConcepts.$inferInsert)[]): Promise<void> {
      if (rows.length === 0) return;
      await db.insert(taskConcepts).values(rows);
    },

    async listTaskConceptsForTasks(
      userId: string,
      taskIds: string[],
    ): Promise<(typeof taskConcepts.$inferSelect)[]> {
      if (taskIds.length === 0) return [];
      return db
        .select()
        .from(taskConcepts)
        .where(and(inArray(taskConcepts.taskId, taskIds), eq(taskConcepts.userId, userId)));
    },

    async listTasksForPlan(userId: string, planId: string): Promise<TaskRow[]> {
      return db
        .select()
        .from(tasks)
        .where(and(eq(tasks.planId, planId), eq(tasks.userId, userId)));
    },

    async listTasksInWindow(
      userId: string,
      goalId: string,
      from: string,
      to: string,
    ): Promise<TaskRow[]> {
      return db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            eq(tasks.goalId, goalId),
            gte(tasks.scheduledDate, from),
            lte(tasks.scheduledDate, to),
          ),
        );
    },

    async listPendingTasks(userId: string, goalId: string): Promise<TaskRow[]> {
      return db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.userId, userId), eq(tasks.goalId, goalId), eq(tasks.status, 'pending')),
        );
    },

    async findTask(userId: string, taskId: string): Promise<TaskRow | undefined> {
      const [row] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .limit(1);
      return row;
    },

    async updateTaskStatus(
      userId: string,
      taskId: string,
      patch: Partial<Pick<TaskRow, 'status' | 'completedAt' | 'skippedReason'>>,
    ): Promise<TaskRow | undefined> {
      const [row] = await db
        .update(tasks)
        .set(patch)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();
      return row;
    },

    async markMissedRescheduled(userId: string, taskIds: string[]): Promise<void> {
      // §10.4: never shifted forward — marked `rescheduled` so the row's
      // status is honest, while its concept simply re-enters the next
      // `generatePlan` candidate pool with no special-cased backlog state.
      for (const taskId of taskIds) {
        await db
          .update(tasks)
          .set({ status: 'rescheduled' })
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
      }
    },
  };
}

export type PlanningRepository = ReturnType<typeof planningRepository>;
