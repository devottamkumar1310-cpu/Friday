import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQLWrapper } from 'drizzle-orm';
import { planningRepository } from '../repositories/planning';
import type { Executor } from '../repositories/executor';

/**
 * Retiring a superseded plan's work.
 *
 * `supersede` moved the plan row to `superseded` and nothing else, which left
 * that plan's tasks sitting at `pending`. Every reader of pending work filters
 * on status and never on plan, so the learner saw the union of every plan
 * version ever generated: collapsing availability from a full week to a single
 * hour grew the visible workload from 465 minutes to 555, because a correctly
 * sized 90-minute plan was added to the 465-minute one it was meant to replace.
 *
 * The end-to-end consequence is covered by `availability-replan.spec.ts`. What
 * a browser test cannot easily stage is the in-progress case — a re-plan firing
 * while a session is open — so the filter itself is pinned here, by running the
 * real repository method against a recording executor.
 */

interface Recorded {
  values: Record<string, unknown>;
  /** The compiled predicate, as SQL text plus its bound parameters. */
  sql: string;
  params: unknown[];
}

/**
 * Compiles a drizzle predicate the way the driver would.
 *
 * Only the *bound parameters* are of interest. Walking the predicate object
 * instead would drag in the table metadata, and `task_status` lists every
 * status it can hold — so `completed` and `in_progress` would appear in the
 * output whether or not the query filters on them, and the assertions below
 * would pass for the wrong reason.
 */
const dialect = new PgDialect();
function compile(predicate: SQLWrapper): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(predicate.getSQL());
  return { sql: query.sql, params: query.params };
}

/** Captures what `cancelPendingTasksForPlan` builds, without a database. */
function recordingExecutor(): { db: Executor; recorded: () => Recorded } {
  let captured: Recorded | undefined;

  const db = {
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(predicate: SQLWrapper) {
              captured = { values, ...compile(predicate) };
              return {
                returning() {
                  // Shape the caller expects: an array of surviving row ids.
                  return Promise.resolve([{ id: 'row-1' }, { id: 'row-2' }]);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Executor;

  return { db, recorded: () => captured! };
}

describe('cancelPendingTasksForPlan', () => {
  const { db, recorded } = recordingExecutor();
  const promise = planningRepository(db).cancelPendingTasksForPlan('user-1', 'plan-9');

  it('reports how many tasks it retired', async () => {
    await expect(promise).resolves.toBe(2);
  });

  it('retires them as cancelled rather than deleting them', () => {
    expect(recorded().values).toMatchObject({ status: 'cancelled' });
  });

  it('only ever selects work that is still pending', () => {
    expect(recorded().params).toContain('pending');
  });

  it('never touches in-progress work, so a live session survives a re-plan', () => {
    expect(recorded().params).not.toContain('in_progress');
  });

  it('never touches completed, skipped or rescheduled work — that is the evidence', () => {
    for (const historical of ['completed', 'skipped', 'rescheduled']) {
      expect(recorded().params).not.toContain(historical);
    }
  });

  it('is scoped to one plan and one user, so it cannot reach another tenant', () => {
    expect(recorded().params).toContain('plan-9');
    expect(recorded().params).toContain('user-1');
  });
});
