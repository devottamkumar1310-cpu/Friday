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
 * §10.3 — weighted combination of four signals. Weights are equal by default
 * (0.25 each); this is the aggregate `drift` used by the materiality gate.
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

  const verdictChanged = input.previousVerdict !== input.newVerdict;

  // Normalise the completion-shift and required-minutes signals against the
  // thresholds named in §10.3 (>3 days, >5%) so all four components live on
  // comparable [0,1]-ish scales before averaging.
  const normalisedShift = Math.min(1, projectedCompletionShiftDays / 3);
  const normalisedMinutesChange = Math.min(1, requiredMinutesChangeFraction / 0.05);

  const drift =
    0.25 * taskDateChangeFraction +
    0.25 * next7Change +
    0.25 * normalisedShift +
    0.25 * normalisedMinutesChange;

  return {
    drift,
    verdictChanged,
    components: {
      taskDateChangeFraction,
      next7DaysConceptChangeFraction: next7Change,
      projectedCompletionShiftDays,
      requiredMinutesChangeFraction,
    },
  };
}

export type ReplanTriggerClass =
  'temporal' | 'evidence' | 'structural' | 'constraint' | 'risk' | 'explicit' | 'deadline';

/**
 * §10.3: `material if drift > 0.15 OR verdict changed OR trigger is explicit`.
 * Explicit user/Coach-confirmed requests always regenerate (§10.1 table).
 */
export function isMaterial(
  drift: DriftResult,
  trigger: ReplanTriggerClass,
  materialityThreshold: number,
): boolean {
  if (trigger === 'explicit' || trigger === 'deadline') return true;
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
 */
export function withinChurnBudget(state: ChurnBudgetState, trigger: ReplanTriggerClass): boolean {
  if (trigger === 'explicit') return true;
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
): ReplanDecision {
  const drift = computeDrift(input);
  const material = isMaterial(drift, trigger, materialityThreshold);

  if (!material) {
    return { shouldCommit: false, reason: 'immaterial', drift };
  }
  if (!withinChurnBudget(churn, trigger)) {
    return { shouldCommit: false, reason: 'churn_budget_exceeded', drift };
  }
  return { shouldCommit: true, reason: `material (${trigger})`, drift };
}
