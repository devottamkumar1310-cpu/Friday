/**
 * `core/replanning` — the re-plan pipeline and the missed-session debt model.
 * AI_DECISION_ENGINE §10. M0 ships **manual trigger only** (§1.1); the
 * nightly cron, drift detection wiring, and materiality gate machinery
 * specified here are the same code Phase 3 turns on automatically — nothing
 * changes shape when that happens.
 *
 * The core invariant of this module: **missed work is never shifted forward
 * day by day.** A missed task's concept returns to the candidate pool with
 * its state intact; `core/scheduling` re-derives placement from current
 * priority on the next `generatePlan` call. There is no backlog data
 * structure anywhere in this file, on purpose (§10.4).
 */

export interface PlanTaskSnapshot {
  conceptId: string;
  scheduledDate: string;
}

export interface DriftInput {
  previousTasks: PlanTaskSnapshot[];
  newTasks: PlanTaskSnapshot[];
  previousVerdict: string;
  newVerdict: string;
  previousProjectedCompletionDate: string | null;
  newProjectedCompletionDate: string | null;
  previousRequiredMinutes: number;
  newRequiredMinutes: number;
  /**
   * Capacity across the whole horizon, which is the other half of feasibility.
   *
   * Drift measured only the *required* side, so a change that moved only the
   * *available* side was invisible to it. Pulling an exam date in from 120 days
   * to 21 scored 0.0425 — immaterial — because the fourteen-day task list
   * genuinely does not change when the horizon shrinks but the work still fits.
   *
   * The task list was not the thing that went wrong. A plan row also stores the
   * verdict, the slack and the projected completion date, all derived from the
   * horizon; leaving it committed meant the learner's feasibility panel reported
   * 7,200 available minutes against the 1,260 they actually had. Measuring one
   * side of a two-sided calculation was simply an omission.
   */
  previousAvailableMinutes: number;
  newAvailableMinutes: number;
  today: string;
}

export interface DriftResult {
  drift: number;
  verdictChanged: boolean;
  components: {
    taskDateChangeFraction: number;
    next7DaysConceptChangeFraction: number;
    projectedCompletionShiftDays: number;
    requiredMinutesChangeFraction: number;
    availableMinutesChangeFraction: number;
  };
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

function next7DaySet(tasks: PlanTaskSnapshot[], today: string): Set<string> {
  const start = new Date(today).getTime();
  const end = start + 7 * DAY_MS;
  return new Set(
    tasks
      .filter((t) => {
        const d = new Date(t.scheduledDate).getTime();
        return d >= start && d < end;
      })
      .map((t) => t.conceptId),
  );
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const union = new Set([...a, ...b]);
  const intersection = [...a].filter((x) => b.has(x));
  return 1 - intersection.length / union.size;
}

/**
 * §10.3 — weighted combination of the drift signals, equally weighted; this is
 * the aggregate `drift` the materiality gate reads. §10.3 names four; capacity
 * is a fifth, added because measuring only the demand half of a feasibility
 * calculation let a horizon change pass as no change. See `DriftInput`.
 */
export function computeDrift(input: DriftInput): DriftResult {
  const prevByConcept = new Map(input.previousTasks.map((t) => [t.conceptId, t.scheduledDate]));
  const newByConcept = new Map(input.newTasks.map((t) => [t.conceptId, t.scheduledDate]));
  const allConcepts = new Set([...prevByConcept.keys(), ...newByConcept.keys()]);

  let moved = 0;
  for (const conceptId of allConcepts) {
    const prevDate = prevByConcept.get(conceptId);
    const newDate = newByConcept.get(conceptId);
    if (!prevDate || !newDate || daysBetween(prevDate, newDate) > 1) moved++;
  }
  const taskDateChangeFraction = allConcepts.size > 0 ? moved / allConcepts.size : 0;

  const next7Change = jaccardDistance(
    next7DaySet(input.previousTasks, input.today),
    next7DaySet(input.newTasks, input.today),
  );

  const projectedCompletionShiftDays =
    input.previousProjectedCompletionDate && input.newProjectedCompletionDate
      ? daysBetween(input.previousProjectedCompletionDate, input.newProjectedCompletionDate)
      : input.previousProjectedCompletionDate !== input.newProjectedCompletionDate
        ? 999
        : 0;

  const requiredMinutesChangeFraction =
    input.previousRequiredMinutes > 0
      ? Math.abs(input.newRequiredMinutes - input.previousRequiredMinutes) /
        input.previousRequiredMinutes
      : 0;

  const availableMinutesChangeFraction =
    input.previousAvailableMinutes > 0
      ? Math.abs(input.newAvailableMinutes - input.previousAvailableMinutes) /
        input.previousAvailableMinutes
      : 0;

  const verdictChanged = input.previousVerdict !== input.newVerdict;

  // Normalise the completion-shift and minutes signals against the thresholds
  // named in §10.3 (>3 days, >5%) so every component lives on a comparable
  // [0,1]-ish scale before averaging.
  const normalisedShift = Math.min(1, projectedCompletionShiftDays / 3);
  const normalisedRequiredChange = Math.min(1, requiredMinutesChangeFraction / 0.05);
  const normalisedAvailableChange = Math.min(1, availableMinutesChangeFraction / 0.05);

  // Five equal signals. Capacity joined the set late — see `DriftInput` — and
  // carries the same weight as the demand side it is compared against, because
  // a feasibility verdict is only ever as good as the weaker of the two.
  const drift =
    0.2 * taskDateChangeFraction +
    0.2 * next7Change +
    0.2 * normalisedShift +
    0.2 * normalisedRequiredChange +
    0.2 * normalisedAvailableChange;

  return {
    drift,
    verdictChanged,
    components: {
      taskDateChangeFraction,
      next7DaysConceptChangeFraction: next7Change,
      projectedCompletionShiftDays,
      requiredMinutesChangeFraction,
      availableMinutesChangeFraction,
    },
  };
}

export type ReplanTriggerClass =
  'temporal' | 'evidence' | 'structural' | 'constraint' | 'risk' | 'explicit' | 'deadline';

/**
 * §10.3: `material if drift > 0.15 OR verdict changed OR trigger is explicit`.
 * Explicit user/Coach-confirmed requests always regenerate (§10.1 table).
 *
 * Plus one condition §10.3 does not name, because it is not about the candidate
 * at all: **work the learner has already missed makes a re-plan material
 * regardless of drift.**
 *
 * The gate asks "does the new plan differ enough to be worth disturbing the
 * learner?" That is the right question about a *candidate*, and the wrong
 * question when the *current* plan is stale. Missing exactly one day — the most
 * ordinary thing a learner ever does — produces a candidate that is the same
 * plan shifted a day, which scores a drift of about 0.025 against a threshold
 * of 0.15. Measured end to end, the new-day trigger fired, computed a correct
 * and tiny drift, and declined to commit; the missed task stayed `pending` on
 * yesterday's date, and the learner opened the app to overdue work that §10.4
 * promises can never exist.
 *
 * A plan carrying overdue work is not a plan worth protecting from churn. It is
 * the thing the re-plan is for.
 */
export function isMaterial(
  drift: DriftResult,
  trigger: ReplanTriggerClass,
  materialityThreshold: number,
  missedTaskCount = 0,
): boolean {
  if (trigger === 'explicit' || trigger === 'deadline') return true;
  if (missedTaskCount > 0) return true;
  return drift.drift > materialityThreshold || drift.verdictChanged;
}

export interface ChurnBudgetState {
  /** Automatic-trigger plan changes committed in the last 24h / 7d. */
  changesLast24h: number;
  changesLast7d: number;
}

/**
 * §10.3 churn budget: at most one automatic change per 24h, three per week.
 * Explicit requests are never rate-limited.
 *
 * Retiring missed work is not rate-limited either, for the same reason it is
 * always material: it repairs an invariant rather than expressing a preference.
 * Letting the budget veto it would only move the failure — the learner would
 * still be looking at yesterday's overdue task, now because they had also
 * finished a session the previous afternoon.
 *
 * This cannot become a churn hole, because it is self-extinguishing: the commit
 * it permits is the one that retires the missed work, after which there is no
 * missed work and the exemption stops applying.
 *
 * `constraint` is exempt on different grounds. The budget exists to stop the
 * plan reshuffling itself under a learner who is not asking for it; a learner
 * editing their own availability *is* asking. Measured: cutting availability
 * from two hours a day to thirty minutes committed, and raising it back to
 * three hours minutes later returned `churn_budget_exceeded` — so the plan went
 * on describing a thirty-minute week the learner had already told us was wrong,
 * and the freed-up time was silently thrown away.
 *
 * Availability is not a preference about the plan, it is a fact about the
 * learner's life, and a plan that contradicts it is not stale but incorrect.
 * The materiality gate still stops a settings form that posts on every blur:
 * saving the same numbers produces the same plan, which is immaterial and does
 * not commit.
 */
export function withinChurnBudget(
  state: ChurnBudgetState,
  trigger: ReplanTriggerClass,
  missedTaskCount = 0,
): boolean {
  if (trigger === 'explicit' || trigger === 'constraint' || missedTaskCount > 0) return true;
  return state.changesLast24h < 1 && state.changesLast7d < 3;
}

export interface MissedTask {
  taskId: string;
  conceptId: string;
  scheduledDate: string;
  status: string;
}

/**
 * §10.4 — the debt model. Identifies tasks that are in the past and were
 * never completed. It does **not** reschedule them: it only names them, so
 * the caller can mark them `rescheduled` (task_status) and let the next
 * `generatePlan` call re-derive placement from current priority. Concepts
 * whose only pending task was overdue re-enter as ordinary candidates —
 * reviews with elevated Decay Risk self-prioritise (DP8); low-priority misses
 * may legitimately never return.
 */
export function identifyMissedTasks(
  tasks: { taskId: string; conceptId: string; scheduledDate: string; status: string }[],
  today: string,
): MissedTask[] {
  const todayMs = new Date(today).getTime();
  return tasks
    .filter((t) => ['pending', 'in_progress'].includes(t.status))
    .filter((t) => new Date(t.scheduledDate).getTime() < todayMs)
    .map((t) => ({ ...t }));
}

export interface ReplanDecision {
  shouldCommit: boolean;
  reason: string;
  drift: DriftResult;
}

/**
 * The gate (§10.2): DIFF -> MATERIALITY GATE -> commit or discard. Does not
 * itself run the scheduler — the caller supplies the candidate plan's task
 * snapshots (from a `generatePlan` call made against fresh state) and this
 * function decides whether it supersedes the active version.
 */
export function decideReplan(
  input: DriftInput,
  trigger: ReplanTriggerClass,
  materialityThreshold: number,
  churn: ChurnBudgetState,
  /** Overdue, un-started tasks on the outgoing plan (§10.4). */
  missedTaskCount = 0,
): ReplanDecision {
  const drift = computeDrift(input);
  const material = isMaterial(drift, trigger, materialityThreshold, missedTaskCount);

  if (!material) {
    return { shouldCommit: false, reason: 'immaterial', drift };
  }
  if (!withinChurnBudget(churn, trigger, missedTaskCount)) {
    return { shouldCommit: false, reason: 'churn_budget_exceeded', drift };
  }
  return {
    shouldCommit: true,
    reason: missedTaskCount > 0 ? `material (missed_work)` : `material (${trigger})`,
    drift,
  };
}
