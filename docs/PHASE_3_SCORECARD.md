# Phase 3 Scorecard — the adaptive loop, against real persisted data

**Status: COMPLETE, with named gaps carried into Phase 4.**

Phase 3's claim is that FRIDAY adapts to the learner. This document is the
evidence for that claim, and the record of where it does not hold.

The bar applied throughout: **a passing unit test is not proof.** Every row
below was verified against a real Postgres, with a real learner, real sessions
and real plan rows, by comparing whole task ledgers before and after — because
"the plan version increased" is equally true of a re-plan that did nothing and
one that silently doubled the learner's workload. Both of those actually
happened during this audit, and neither was visible to the unit suite.

---

## Scorecard

| Capability                    | Implemented | Persisted | E2E proven | Result                                                                          |
| ----------------------------- | ----------- | --------- | ---------- | ------------------------------------------------------------------------------- |
| Mastery                       | yes         | yes       | yes        | **PROVEN** — session → `mastery_states`, read by scheduler and feasibility      |
| Memory / FSRS                 | yes         | yes       | yes        | **PROVEN** — real future `due_at`, reps/stability move, survive re-plans        |
| Exam weighting                | yes         | yes       | partial    | **PROVEN AT ENGINE LEVEL** — see _Honest limits_                                |
| Missed-work redistribution    | yes         | yes       | yes        | **PROVEN** — 13 + 13 properties, no stacking, no backlog, no multiplication     |
| Availability adaptation       | yes         | yes       | yes        | **PROVEN** — both directions, verified 7200m → 1350m → 8100m                    |
| Goal / constraint adaptation  | yes         | yes       | yes        | **PROVEN** — `PATCH` added this phase; horizon 7200m → 1260m → 10800m           |
| Superseded-task retirement    | yes         | yes       | yes        | **PROVEN** — `rescheduled` vs `cancelled` by cause; in-progress exempt          |
| In-progress protection        | yes         | yes       | yes        | **PROVEN** — survives re-plan, availability change, goal change, 3× regenerate  |
| Churn / materiality gate      | yes         | yes       | yes        | **PROVEN** — declines no-op saves at drift 0; exemptions are self-extinguishing |
| New-day adaptation            | yes         | yes       | yes        | **PROVEN** — fires on stale window, commits, retires, no double-generate        |
| Session-completion adaptation | yes         | yes       | yes        | **PROVEN** — evidence → state → re-score, correctly declined when immaterial    |
| Closed learning loop          | yes         | yes       | yes        | **PROVEN** — 17 properties across a 3-day journey, nothing mocked               |
| Next-action consistency       | yes         | yes       | yes        | **PROVEN** — always on the active plan, never a superseded task                 |
| Data integrity                | yes         | yes       | yes        | **PROVEN** — 25 attacks; 2 genuine races found and closed                       |
| Mobile behaviour              | partial     | n/a       | **no**     | **NOT PROVEN THIS PHASE** — see _What remains missing_                          |

**98 integration properties** against a live database, **349 unit tests**,
lint / typecheck / build / format all green.

---

## What the audit found

Nine genuine defects, every one of them invisible to a green unit suite. Seven
were found by writing the proof, not by reading the code.

| CR      | Defect                                                | Learner-visible consequence                            |
| ------- | ----------------------------------------------------- | ------------------------------------------------------ |
| CR-010a | Drift compared task ids against concept ids           | Materiality gate could never fire; `drift` was fiction |
| CR-010b | Missed work retired before the gate decided           | Work could vanish with no replacement                  |
| CR-010c | A concept with work in flight was scheduled twice     | Same topic queued twice                                |
| CR-009  | Superseded plans' tasks never retired                 | One re-plan: 8 → 18 live tasks, 330 → 750 minutes      |
| CR-011  | Feasibility treated one rep as "learned"              | "On track" computed from knowledge the learner lacked  |
| CR-012  | A one-day miss scored below the materiality threshold | Overdue task stranded on yesterday's date              |
| CR-013  | In-flight prerequisite blocked all dependents         | **Completely empty plan**                              |
| CR-014  | Churn budget vetoed availability increases            | Freed-up time silently discarded                       |
| CR-016  | Two unserialised write races                          | Doubled mastery from one session; blended availability |
| CR-017  | Session-size claim not enforced                       | "15 minutes" above a 50-minute task                    |

---

## Honest limits

Three things the scorecard deliberately does **not** claim.

**Exam-weight prioritisation is proven at engine level, not end-to-end.** The
controlled proof — equal mastery, no prerequisites, differing weight — is in
`core/scheduling`'s suite and orders `high, mid, low` correctly. The end-to-end
assertion is weaker on purpose: raw "higher weight is scheduled earlier" is
_false_ in a real curriculum, and correctly so, because prerequisites outrank
impact and a 0.3-weight foundation is supposed to precede a 0.9-weight topic
that depends on it. What is asserted end-to-end is that the weight reaches the
scheduler and is recorded in the persisted factor breakdown.

**The adaptive session-size claim is currently suppressed, not delivered.**
CR-017 removed the sentence rather than pretending. `targetSessionMinutes` does
reach the planner and the ranking is genuinely fitted against it, but when no
task is short enough the selector returns the top candidate whole. Until the
planner can size tasks to the session, FRIDAY says less.

**Concurrent availability saves converge rather than agree instantly.** The
stored rules are correct and homogeneous; the plan may lag by one re-plan. This
is classified as safe degradation and documented, not as a pass.

---

## What remains missing

Carried into Phase 4, explicitly and without a green tick:

1. **Mobile and responsive behaviour is unverified this phase.** No interaction
   testing at 360 / 390 / 768 / 1024 / wide, no light-and-dark pass over the
   adaptive states. Playwright specs exist under `apps/web/e2e/` but were not
   run as part of this audit. **This is the largest untested surface.**

2. **Task sizing is not adaptive.** The single most valuable Phase 4 change, and
   the one that would let CR-017's claim be restored honestly.

3. **`learner: { reliability: 1.0, pace: 1.0 }` is hard-coded** at every
   `generatePlan` call site. The engine supports learner factors; the
   application never derives them, so the pace model is inert.

4. **The prior-window transition ("two weeks ago you were struggling") has no
   database-backed proof.** It is guarded in the engine and its absence is
   tested, but its presence is not.

5. **An intermittent integration failure** was observed once: a suite's
   `beforeAll` failed against the remote Neon instance and its specs skipped. A
   full clean re-run passed. Unresolved, and worth a retry policy before this
   suite gates CI.

6. **No cron.** New-day adaptation fires on dashboard render. A learner who does
   not open the app is not re-planned.

---

## Why this is "complete" rather than "passing"

Phase 3 is called complete because the adaptive loop now demonstrably closes on
real persisted data:

> a learner studied the task FRIDAY recommended → the session wrote evidence →
> mastery moved `0.000 → 0.098` and FSRS scheduled a real review → the planner
> re-scored that concept downward and cut required minutes → a missed day
> triggered a re-plan that retired the stale work → and the dashboard's next
> action came from the new plan, not the superseded one.

Every arrow in that sentence is an assertion in
`closed-loop.integration.test.ts`, reading back from Postgres rather than from a
return value.

It is _not_ called complete because the tests are green. They were green before
this audit started, while one re-plan was doubling the learner's workload.
