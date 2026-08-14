# FRIDAY — Pre-Implementation Design Review

> **Reviewed:** all seven blueprint documents as one system
> **Date:** Week 0, pre-kickoff
> **Verdict:** **Conditional Go** — 8 critical fixes required before Phase 0. No redesign needed.
>
> ---
>
> ### ✅ RESOLVED — all 8 critical issues fixed; blueprint frozen as Blueprint v1.0
>
> See [ARCHITECTURE_CHANGELOG.md](ARCHITECTURE_CHANGELOG.md) for what changed, why, and which documents moved.
>
> **This document is deliberately not amended.** It records the blueprint as it stood _before_ the fixes. Rewriting it would destroy the audit trail — so every problem described below reads in the present tense but refers to a state that no longer exists. Deferred items (Risks, Recommended, Nice-to-have) remain live and are tracked against gates in the changelog.

---

## 0. Method and Summary

Each document was read against every other, checking: entity and vocabulary consistency, dependency direction, event completeness, whether stated NFRs are achievable with the chosen stack, whether the DDL is valid, and whether the architecture can carry the product vision at 100k users.

**Headline:** the architecture is sound and the layering survived scrutiny — the `core` / `ai` / `db` separation, the deterministic-decision doctrine, and the event log are load-bearing and correct. The failures found are **localised**: six schema/spec defects, one boundary contract left unstated, and one compliance gap. All are cheap now and expensive later. None require rethinking the system.

| Severity                             | Count | Effort to fix                            |
| ------------------------------------ | ----- | ---------------------------------------- |
| Critical (blocks coding)             | 8     | ~1–2 days, mostly documentation + schema |
| Risk (needs an owner and a decision) | 10    | Ongoing                                  |
| Recommended                          | 10    | Spread across Phases 1–3                 |
| Nice-to-have                         | 5     | Post-M1                                  |

---

## 1. Strengths

These are worth naming because they should not be traded away under schedule pressure.

**S1 — The deterministic/AI boundary is genuinely load-bearing, not decorative.**
"LLM proposes, engine disposes" is stated in [PROJECT_VISION §6](PROJECT_VISION.md), specified in [SYSTEM_ARCHITECTURE §5.1](SYSTEM_ARCHITECTURE.md), enforced in [AI_DECISION_ENGINE DP1](AI_DECISION_ENGINE.md), and testable as invariant I-13. Most "AI-first" architectures state this and then quietly violate it in the hot path. Here, NFR-1.7 (<300ms, no LLM) makes the violation impossible to hide — a performance budget enforcing a correctness property is unusually good design.

**S2 — `packages/core` purity is the single best decision in the blueprint.**
Zero I/O, zero framework, zero LLM. It makes the hardest logic trivially testable, makes the mastery/retention/scheduler models swappable ([AI_DECISION_ENGINE §18](AI_DECISION_ENGINE.md)), and makes future service extraction mechanical. Lint-enforced rather than convention-enforced, which is what makes it survive contact with a deadline.

**S3 — The event log makes derived state recoverable.**
`learning_events` + `evidence_events` append-only means a mastery-algorithm change can be replayed rather than migrated. This is what makes S2's "swappable model" claim real instead of aspirational.

**S4 — Explainability is structural, not bolted on.**
Because priority is a transparent weighted function, `tasks.priority_factors` and the API `why` block are projections of the computation, not a second system. Most products bolt explanation on afterward and it drifts. Here drift is a test failure (I-11, T3).

**S5 — Decision traces enable counterfactual replay.**
Storing the full scored candidate set — not just the winner — means configuration changes can be evaluated against history before shipping. Few teams design this in at week zero, and it is nearly impossible to retrofit.

**S6 — Honest failure semantics.**
Feasibility returns `not_feasible` with arithmetic and options; AI outage degrades rather than breaks (NFR-2.2, E-16); missed sessions produce no backlog. The product's ethics and its architecture agree, which is rarer than it sounds.

**S7 — Scope discipline.**
The M0/M1/M2/M3 tiering, the permanent out-of-scope list, and the "cut features, never cut the loop" rule are the kind of constraints that actually hold during a Shipathon.

---

## 2. Critical Issues — must fix before writing code

### C1 · Plan versioning materialises the full horizon → unbounded row growth

**Severity: Critical (architectural).** Found in [DATABASE_DESIGN §4.3](DATABASE_DESIGN.md) vs [AI_DECISION_ENGINE §10](AI_DECISION_ENGINE.md).

Plans are immutable versions, and `study_blocks` / `tasks` are children of `plan_id`. Every re-plan therefore clones the **entire remaining schedule**.

```
300-day goal × ~4 tasks/day        ≈ 1,200 tasks per plan version
materiality gate → ~1–2 material re-plans/week over 43 weeks ≈ 60 versions
                                    ≈ 72,000 task rows per user per goal
× 100k users                        ≈ 7.2 billion rows
```

`tasks` and `study_blocks` are **not** in the partitioning plan ([DATABASE_DESIGN §7](DATABASE_DESIGN.md)), so this grows unbounded on the primary. It also makes every re-plan an expensive bulk insert, which directly threatens the nightly batch NFR.

**Fix — near-horizon materialisation:**

- A plan version materialises concrete `study_blocks` + `tasks` for a **rolling 14-day window only**.
- The remainder is stored as a coarse **projection** (concept → target week, aggregate minutes) sufficient for feasibility and forecasting.
- Re-planning regenerates the window and recomputes the projection; the projection is cheap and small.
- Add `tasks` and `study_blocks` to the monthly partitioning plan regardless.

This cuts row growth by ~95%, makes re-plans fast enough for the nightly batch, and changes nothing the learner sees — nobody needs day-217 scheduled to the minute.

---

### C2 · `uuidv7()` does not exist in PostgreSQL 16

**Severity: Critical (blocks migration 1).** [DATABASE_DESIGN §1, all DDL](DATABASE_DESIGN.md).

The engine is pinned to **PostgreSQL 16**, and every table uses `DEFAULT uuidv7()`. That function is a **PostgreSQL 18 builtin** — it does not exist in 16 or 17. The very first migration fails.

Related, in the same class: `citext` (used on `users.email`) and `vector` (pgvector) both require explicit `CREATE EXTENSION`, and no extensions preamble exists anywhere in the schema.

**Fix — choose one, then add the preamble:**

- **(a)** Pin PostgreSQL 18 and keep `uuidv7()`; or
- **(b)** Generate UUIDv7 in the application layer via Drizzle `$defaultFn` — portable across Postgres versions and keeps ID generation testable; or
- **(c)** Install a `pg_uuidv7` extension (adds a dependency Neon must support).

**(b) is recommended** — it removes the version constraint entirely and works identically in local Docker, Neon branches, and production.

---

### C3 · Invalid CHECK constraint — subquery not permitted

**Severity: Critical (blocks migration 1).** [DATABASE_DESIGN §4.1](DATABASE_DESIGN.md), `users`.

```sql
CONSTRAINT users_auth_method CHECK (password_hash IS NOT NULL OR id IN (SELECT user_id FROM accounts))
```

PostgreSQL does not allow subqueries in `CHECK` constraints. This is a hard DDL error, not a portability concern.

**Fix:** delete the constraint. Enforce "an account has at least one auth method" in the identity service, consistent with the existing pattern of service-layer invariants documented in [DATABASE_DESIGN §8](DATABASE_DESIGN.md). Note it there with its reason, as the other service-enforced rules are.

---

### C4 · The shared question cache has no join path — the primary AI cost lever is unimplementable

**Severity: Critical (architectural + economic).** [DATABASE_DESIGN §4.5](DATABASE_DESIGN.md) vs [SYSTEM_ARCHITECTURE §5.3](SYSTEM_ARCHITECTURE.md).

Two contradictions, one consequence:

1. `questions.concept_key` is described as "canonical concept slug, not a user's concept id" — but **the `concepts` table has no `concept_key` column.** There is no way to get from a learner's concept to a shared question.
2. `question_concepts` carries `user_id` and maps to per-user `concept_id`, which is a _per-user_ mapping — directly contradicting the "questions are SHARED across users (cost lever)" comment on the same table.

The consequence is economic, not just structural. Generated-content reuse is listed as one of five cost controls holding AI spend to **$0.60/user/month** (NFR-4.5). As designed, the cache cannot be queried at all — and even if patched naively, AI-generated curricula produce free-text concept titles with no canonicalisation, so the hit rate across users would be near zero.

**Fix:**

- Add `concept_key text NOT NULL` to `concepts` — a canonical slug, taken from the template for preset curricula.
- For AI-generated curricula, require the **Curriculum Architect to map each concept to a controlled vocabulary** of canonical keys (with `null` → per-user-only, no sharing) rather than inventing free-text keys. This is a prompt + validation requirement, added to [SYSTEM_ARCHITECTURE §5.5](SYSTEM_ARCHITECTURE.md) and NFR-7.2's structural validator.
- Index questions on `(concept_key, difficulty, status)` — already present, and now actually reachable.
- Reduce `question_concepts` to what it really is: a per-user convenience mapping, or drop it in favour of `concept_key` joins plus `question_exposures`.

---

### C5 · Two contradictory specifications of _when_ priority is computed

**Severity: Critical (correctness + performance).** [DATABASE_DESIGN §4.3](DATABASE_DESIGN.md) vs [AI_DECISION_ENGINE §4](AI_DECISION_ENGINE.md).

- `tasks.priority_score` / `priority_factors` are documented as written **"from core.priority, at generation"** — i.e. at plan time.
- AI_DECISION_ENGINE describes a full seven-stage pipeline computing priority **at decision time**.

Both cannot be true. And the stored version is definitely wrong on its own: `DecayRisk` and `m_eff` change _every day_ as retrievability decays, so a score written at plan time is stale within 24 hours — which is precisely when the Next Action matters most.

Computing everything at request time is also not viable: `Urgency` requires a backward pass over the prerequisite DAG, and `Leverage` requires transitive descendant counts. Both are graph traversals over the full curriculum, not the candidate frontier, and neither fits a 300ms budget.

**Fix — formalise the two-tier split, and state it in both documents:**

| Tier                           | Terms                                                       | Computed                                 | Stored                   |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------- | ------------------------ |
| **Structural** (slow-changing) | Urgency/slack, Leverage, Readiness, ExamWeight, Cost        | Per plan version                         | `tasks.priority_factors` |
| **Volatile** (per request)     | DecayRisk, effective mastery, time-fit, selection modifiers | At request, over the ~14-day window only | Not stored               |

This is what makes 300ms achievable — the expensive graph work happens once per plan version, and the request-time computation runs over tens of candidates, not thousands. It also resolves E-26 (enormous curricula) properly rather than by assertion.

---

### C6 · Pre-generated rationale can contradict the live dominant factor

**Severity: Critical (violates a stated invariant).** [AI_DECISION_ENGINE §12.2 and I-11](AI_DECISION_ENGINE.md) vs [API_SPECIFICATION §5.5](API_SPECIFICATION.md).

Rationale text is pre-generated asynchronously into `tasks.rationale` (because NFR-1.7 forbids an LLM call in the hot path). But once C5 is resolved and volatile factors are recomputed at request time, **the factor that dominates at request time may not be the one the stored prose names.**

That is not a copy defect. It breaks invariant **I-11** ("the stated dominant factor is the largest contributor in the trace") and traceability guarantee **T3** (faithfulness) — the two properties the entire explainability story rests on. Per DP3, a plausible reason that does not match the arithmetic is the highest-severity class of bug in this product.

**Fix:**

- **Request-time rationale is a deterministic template**, selected by dominant factor from the vocabulary already defined in [AI_DECISION_ENGINE §12.3](AI_DECISION_ENGINE.md). Zero LLM cost, zero latency, always faithful by construction.
- **LLM-authored prose is reserved for stable, cacheable surfaces** — daily brief, weekly review, coach conversation — where the context is fixed at generation time.
- Drop `tasks.rationale` as the Next Action source, or redefine it as a cached _fallback_ for the stable case.

This is a simplification, not extra work: it removes the rationale pre-generation job (roadmap item 2.9) from the critical path entirely.

---

### C7 · `packages/ai` cannot import `db`, but Coach read tools need data — resolution unstated

**Severity: Critical (will be violated in week one).** [SYSTEM_ARCHITECTURE §9](SYSTEM_ARCHITECTURE.md) vs [§5.6](SYSTEM_ARCHITECTURE.md).

The dependency rules state `packages/ai ──▶ core, contracts, observability (may NOT import db)`, and the rationale given is good: "AI agents receive context, they do not go fetch it." But §5.6 then defines read tools — `get_plan`, `get_mastery`, `get_weak_concepts`, `get_due_reviews`, `search_memory` — which fundamentally require data access.

The intended resolution is presumably dependency injection. It is never stated. A developer implementing the Coach in Phase 2 will hit this on day one, and the path of least resistance is to add the import and quietly break the boundary that makes the AI subsystem auditable.

**Fix — state the contract explicitly in §5.6:**

- `packages/ai` defines tool **schemas and descriptions** (Zod), and nothing else.
- The **service layer supplies executors** at construction: `createCoach({ tools: { getPlan: planningService.getPlan, ... } })`.
- The agent receives an executor map; it never resolves data itself.
- Add the ESLint boundary rule for `packages/ai → packages/db` at Phase 0 alongside the others, so the violation fails CI rather than review.

---

### C8 · The primary target segment is largely minors under Indian law

**Severity: Critical (legal/product, and cheapest to fix now).** [PRODUCT_REQUIREMENTS FR-1.6, NFR-3.8](PRODUCT_REQUIREMENTS.md) vs [PROJECT_VISION §7](PROJECT_VISION.md) and [IMPLEMENTATION_ROADMAP §10 A2](IMPLEMENTATION_ROADMAP.md).

The stated launch segment is Indian JEE/NEET aspirants — a population **predominantly aged 16–18**. India's DPDP Act 2023 requires _verifiable parental consent_ for users under 18 and restricts tracking and behavioural monitoring of children. FR-1.6 defers date-of-birth capture to **M1** and describes the requirement only as users being "flagged for guardian-consent flow."

So the M0 build, as specified, collects no age data and would onboard minors with no consent mechanism — for a segment where minors are the _majority_, not an edge case. This is not a feature gap; it determines whether the product can legally serve the users it is designed for.

**Fix before writing the auth module:**

- Capture `date_of_birth` at **M0 signup**, not M1. The column already exists in the schema; only the requirement tier and the form are wrong.
- Specify the guardian-consent flow concretely (what "verifiable" requires is a legal question, not an engineering one — get the answer before building around a guess).
- Confirm whether the demo/Shipathon build is exempt as a non-public prototype, and record that decision.

Architecturally this costs one form field and one branch. Retrofitting consent onto an existing minor user base costs a migration, a re-consent campaign, and possibly a takedown.

---

## 3. Risks — need an owner and a decision, not necessarily a code change

| #       | Risk                                                                                                                                                                                                                                                                           | Impact                                                  | Suggested response                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | **Nightly re-plan capacity.** NFR-1.6 sets plan generation at p95 <45s and NFR-1.8 requires 10k users re-planned in <30 min. At 45s each, that needs ~250 concurrent workers — beyond typical Vercel/Inngest concurrency and function-duration limits.                         | Batch overruns; stale plans                             | The 45s figure covers _initial, AI-assisted_ generation. A **deterministic re-plan should be ~1s**. Split NFR-1.6 into two numbers and validate concurrency limits against real Inngest/Vercel ceilings in Phase 3. C1 makes this far easier.                   |
| **R2**  | **AI cost model is asserted, not derived.** $0.60/user/month (NFR-4.5) has no bottom-up calculation. One Opus curriculum generation over a 400-concept syllabus is a large, lumpy, front-loaded cost that could consume a month's budget for a single user on day one.         | Margin erosion; surprise bills                          | Build a bottom-up cost model in Phase 1 before committing to the number publicly. Mitigations already planned (templates first, prompt caching) are correct — quantify them. Consider Sonnet rather than Opus for curriculum generation with a validation pass. |
| **R3**  | **Per-user curriculum cloning.** 412 concepts × 100k users ≈ 41M `concepts` rows, plus matching `mastery_states`, `memory_states`, and duplicated `concept_edges`.                                                                                                             | Storage cost; no template update path; root cause of C4 | Workable at MVP. Before 10k users, evaluate **shared canonical nodes + per-user overlay** (status, customisation, mastery). Also gives template versioning a propagation path, which today does not exist at all.                                               |
| **R4**  | **Shipathon scope inflation.** AI_DECISION_ENGINE materially deepened Phase 1 — slack backward pass, selection modifiers, confidence scoring, decision traces — after the 14-day plan was written. Day 5 ("priority + feasibility") is now considerably larger than estimated. | Missed M0                                               | Define an explicit **M0 engine subset**: fixed weights, urgency from plan position rather than a DAG backward pass, hysteresis as the only modifier, confidence deferred, traces written but not surfaced. Everything else is M1.                               |
| **R5**  | **Feasibility verdict oscillation.** `ρ` updates daily and the verdict thresholds are hard boundaries, so a learner near 15% slack will flip `on_track ↔ at_risk` repeatedly. Verdict change is a materiality trigger, so each flip forces a re-plan and possibly a Directive. | Plan churn; alarm fatigue                               | Add hysteresis to the **verdict itself** (asymmetric thresholds: enter `at_risk` at 15%, exit at 20%), not only to the plan diff.                                                                                                                               |
| **R6**  | **Trace write volume on the hot path.** A trace per next-action call, with a JSONB candidate blob, at ~20 calls/user/day and 10k DAU ≈ 200k rows/day and tens of GB per quarter — plus write latency inside a 300ms budget.                                                    | Latency; storage                                        | Trace only on **cache miss** (a cache hit is not a new decision), write **asynchronously** post-response, and cap `candidates` to top-N.                                                                                                                        |
| **R7**  | **Two sources of truth for capacity.** `goals.target_weekly_minutes` and `availability_rules` both describe available time; [AI_DECISION_ENGINE §9](AI_DECISION_ENGINE.md) uses only the latter.                                                                               | Confusing drift between the intent and the schedule     | Make `target_weekly_minutes` explicitly an _intent//target_ used for onboarding and comparison, never for capacity math — or drop it. Document which one the scheduler reads.                                                                                   |
| **R8**  | **No learning-resource model.** FRIDAY says "Learn: Simple Harmonic Motion — 90 min" but has no model of _what to learn from_. Content is deliberately out of scope, but a `learn` task with no material is a UX dead end at the exact moment the learner acts.                | Golden Path feels incomplete                            | Either state BYO-material explicitly in the PRD as a product position, or add a minimal `concept_resources` table (user-attachable links, optionally AI-suggested). Do not build a content library — just close the gap.                                        |
| **R9**  | **Auth hardening unspecified beyond rate limits.** No MFA, no account-lockout policy, no credential-stuffing defence across IPs, no stated email-enumeration protection on sign-up and password reset.                                                                         | Account takeover                                        | Acceptable for M0. Specify lockout + enumeration-safe responses before public beta (M-H).                                                                                                                                                                       |
| **R10** | **Partition key mismatch.** `study_sessions` is partitioned on `created_at` but indexed and queried on `started_at`.                                                                                                                                                           | No partition pruning on the main query path             | Partition on `started_at`, or require both columns in query predicates. Same check should be applied to every partitioned table's dominant query.                                                                                                               |

---

## 4. Recommended Improvements

Material, low-cost, and best done during the phase indicated.

| #       | Improvement                                                                                                                                                   | Why                                                                                                                                                                                                                                                                                             | Phase |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **I1**  | **Make the decision timestamp an explicit input** in the trace snapshot and hash.                                                                             | Invariant I-9 ("identical state + config ⇒ identical decision") is false unless time is part of state — retrievability and slack both depend on `now()`. Determinism tests will be flaky otherwise.                                                                                             | 1     |
| **I2**  | **Verify `originated_from` server-side** by matching the started task against the learner's most recent `next_action` trace.                                  | It powers the North Star metric (Weekly Directed Study Minutes) but is currently a client-asserted string. Decision traces make verification free.                                                                                                                                              | 2     |
| **I3**  | **State an invariant: shared-artifact generation never receives learner context.**                                                                            | The Content Generator produces questions cached across users. If learner context ever enters that prompt, one learner's data can surface in another's questions. §5.5 already scopes its inputs correctly — make it a rule with a test, not an accident.                                        | 2     |
| **I4**  | **Normalise curriculum weights to sum to 1 within each parent.**                                                                                              | `ExamWeight = concept × topic × unit × subject` multiplies four independent numbers (defaults 0.5 and 1.0), producing values that are hard to reason about and easy to mis-tune. Normalised sibling weights make the calibration in [AI_DECISION_ENGINE §6.7](AI_DECISION_ENGINE.md) tractable. | 1     |
| **I5**  | **Add `/health` and `/ready` endpoints**, plus `GET /me/usage` for AI budget transparency (FR-12.3 promises honest degradation but exposes no way to see it). | Ops basics; FR-12.3 is otherwise unfulfillable in the UI.                                                                                                                                                                                                                                       | 0 / 2 |
| **I6**  | **Add a support endpoint for decision traces** (`GET /admin/traces?userId=&type=`).                                                                           | L3 explainability and the support use case in §13.3 are specified with no way to reach the data.                                                                                                                                                                                                | 4     |
| **I7**  | **Advisory lock + idempotency on re-plan.**                                                                                                                   | `plans_one_active` is a partial unique index; two concurrent re-plan jobs (nightly + user-triggered) will collide. `REPLAN_IN_PROGRESS` exists as an error code with no mechanism behind it.                                                                                                    | 3     |
| **I8**  | **Per-channel delivery records for directives.**                                                                                                              | `directives.channels` is an array with single `delivered_at`/`seen_at` timestamps. If email succeeds and push fails, that is unrepresentable — and delivery debugging becomes guesswork.                                                                                                        | 4     |
| **I9**  | **Template versioning and propagation path.**                                                                                                                 | Learners clone a template at goal creation. When a syllabus is corrected, there is no mechanism to propagate the fix. Needed before curating many templates.                                                                                                                                    | 3     |
| **I10** | **Make "accept recommendation → start session" atomic**, or return the session start token with the Next Action.                                              | Today it is `GET /next-action` then `POST /sessions`; the recommendation can change in between, and the resulting session is attributed to a task the learner never saw.                                                                                                                        | 2     |

---

## 5. Nice-to-Have Improvements

| #      | Improvement                                                                          | Note                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **N1** | FSRS state per _card type_ (recall vs. apply) rather than per concept                | Currently one memory state per `(user, concept)`. Real mastery has modalities. Deferrable — the interface in §18.3 accommodates it.                                      |
| **N2** | Materialise a transitive-closure table for descendants/leverage                      | Already anticipated in [DATABASE_DESIGN §10](DATABASE_DESIGN.md). C5's structural precompute may make it unnecessary; revisit with profiling data.                       |
| **N3** | Replace `concept_ids uuid[]` with junction tables where actually queried             | `insights`, `assessments`, `learner_facts` all use arrays. Fine for display, poor for filtering, and unenforceable referentially. Convert only where a query demands it. |
| **N4** | Composite FK enforcing `concepts.curriculum_id` matches its topic→unit→subject chain | The denormalisation is deliberate and correct; it is simply unenforced today.                                                                                            |
| **N5** | Write an ADR for the two-tier priority split (C5)                                    | It will be the most-questioned decision in the engine. Capture the reasoning while it is fresh.                                                                          |

---

## 6. Assessment by Review Dimension

| Dimension                       | Verdict                             | Notes                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Internal consistency**        | ⚠️ Good with defects                | 5 real contradictions found (C4, C5, C6, C7, R7). All localised; none structural.                                                                                                                                     |
| **Vision → architecture fit**   | ✅ Strong                           | The architecture can deliver proactive, adaptive, explainable planning. The decision engine is genuinely the differentiator it claims to be.                                                                          |
| **Circular dependencies**       | ✅ None                             | Dependency rules are acyclic and lint-enforced. `core → nothing` holds throughout. The `ai → db` question (C7) is an unstated contract, not a cycle.                                                                  |
| **Missing domain models**       | ⚠️ One material gap                 | Learning resources (R8). Everything else the workflows reference exists.                                                                                                                                              |
| **Missing event flows**         | ⚠️ Two minor                        | No handling for an active session when its plan is superseded; no `plan.superseded` consumer. Both cheap to add in Phase 3.                                                                                           |
| **AI architecture consistency** | ⚠️ Good with one gap                | Six-agent split, context packet, guardrails, and evals are coherent. C7 is the gap; C4 undermines the cost model.                                                                                                     |
| **Database normalisation**      | ✅ Appropriate                      | Denormalisation (`user_id` everywhere, `concepts.curriculum_id`) is deliberate and justified. JSONB is confined to genuinely variable payloads. Main issues are validity (C2, C3) and growth (C1), not normalisation. |
| **API completeness**            | ⚠️ Minor gaps                       | Health/readiness, usage, trace access (I5, I6). Core surface is complete and well-conventioned.                                                                                                                       |
| **Security**                    | ⚠️ Strong model, one compliance gap | Repository-scoped tenancy, 404-not-403, confirmation-gated write tools, and injection defence are all correct. C8 is the real issue; R9 is deferrable.                                                                |
| **Scalability**                 | ⚠️ One blocker                      | C1 is a genuine 100k-user blocker. R3 and R6 are cost, not correctness. Partitioning, snapshots, and stateless tiers are otherwise well-planned.                                                                      |
| **Maintainability**             | ✅ Strong                           | Single schema source, pure core, versioned prompts, ADRs, boundary linting. Above the bar for a team this size.                                                                                                       |
| **Extensibility**               | ✅ Strong                           | §18's seams are real interfaces, not aspirations. Counterfactual replay is a standout.                                                                                                                                |
| **Likely implementation pain**  | ⚠️ Identified                       | C1, C5, C7 are exactly where a team would have stalled mid-Phase-2 and been forced into rework.                                                                                                                       |

---

## 7. Final Readiness Assessment

### Verdict: **Conditional Go**

The blueprint is materially better than typical pre-implementation documentation. The core architectural bets — deterministic decision engine, pure domain core, event sourcing, structural explainability — are correct, mutually reinforcing, and will hold up. Nothing found in this review requires reconsidering them.

Of the eight critical issues, **six are defects rather than design errors** (C2, C3, C4, C5, C6, C7): the intent is right and the specification is wrong or absent. One (C1) is a genuine architectural miss with a clean, well-understood fix. One (C8) is a legal constraint that was under-scoped relative to the stated target market.

**Estimated remediation: 1–2 days**, almost entirely documentation and schema edits before any application code exists — which is precisely when they should be made.

### Gate to Phase 0

| Must be done                                                                                    | Owner         |
| ----------------------------------------------------------------------------------------------- | ------------- |
| C2, C3 fixed in `DATABASE_DESIGN.md` (extensions preamble, UUID strategy, drop invalid CHECK)   | Eng           |
| C1 near-horizon materialisation specified in `DATABASE_DESIGN.md` + `AI_DECISION_ENGINE.md §10` | Arch          |
| C4 `concept_key` added to `concepts`; canonicalisation made a Curriculum Architect requirement  | Arch          |
| C5 two-tier priority split written into both documents                                          | Arch          |
| C6 request-time template rationale replaces pre-generated prose on the hot path                 | Arch          |
| C7 tool-executor injection contract stated in `SYSTEM_ARCHITECTURE §5.6` + lint rule added      | Eng           |
| C8 DOB moved to M0; consent flow specified; legal question raised                               | Product       |
| R4 M0 engine subset defined and frozen                                                          | Product + Eng |

### Gate to Phase 3

R1 (batch capacity validated), R2 (cost model derived), R5 (verdict hysteresis), R6 (trace write policy), I1, I7.

### Gate to Public Beta (M-H)

R3 (curriculum storage model decision), R9 (auth hardening), I6, I8, I9.

### One closing observation

The most valuable finding in this review is **C1**, and it is worth noting _why_ it was missable: it emerges only when [DATABASE_DESIGN §4.3](DATABASE_DESIGN.md) (immutable plan versions) is read against [AI_DECISION_ENGINE §10](AI_DECISION_ENGINE.md) (nightly re-planning). Each is individually correct and defensible. The defect exists only in their interaction.

That is the argument for reviewing the documents as one system rather than sequentially — and the argument for doing it now, before any of it is load-bearing in code.
