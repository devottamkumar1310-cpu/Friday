import { and, desc, eq } from 'drizzle-orm';
import { decisionTraces, type DecisionTraceRow, type NewDecisionTraceRow } from '../schema/traces';
import type { Executor } from './executor';

/**
 * `decision_traces` — AI_DECISION_ENGINE §13. DP10 / I-10: no learner-visible
 * decision is emitted without one. `record` is called from the service layer
 * on every Next Action, plan generation, feasibility check, and re-plan.
 */
export function tracesRepository(db: Executor) {
  return {
    async record(row: NewDecisionTraceRow): Promise<DecisionTraceRow> {
      const [result] = await db.insert(decisionTraces).values(row).returning();
      if (!result) throw new Error('Insert into decision_traces returned no row.');
      return result;
    },

    async listRecent(
      userId: string,
      type: DecisionTraceRow['type'],
      limit = 10,
    ): Promise<DecisionTraceRow[]> {
      return db
        .select()
        .from(decisionTraces)
        .where(and(eq(decisionTraces.userId, userId), eq(decisionTraces.type, type)))
        .orderBy(desc(decisionTraces.computedAt))
        .limit(limit);
    },
  };
}

export type TracesRepository = ReturnType<typeof tracesRepository>;
