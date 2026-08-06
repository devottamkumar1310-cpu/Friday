# Phase 1 — The Spine · Completion Report

> **Baseline:** Blueprint v1.2 · **Status: verified, awaiting approval to begin Phase 2**
> **Static gate:** ✅ format · ✅ lint (7 packages, boundary rules enforced) · ✅ typecheck · ✅ 123 tests · ✅ production build
> **Runtime gate:** ✅ migrations + seed on a clean **PostgreSQL 18.4** · ✅ Golden Path exercised end to end over real HTTP against a running dev server

---

## 0. Runtime verification

As in Phase 0, nothing below is inferred from static analysis — it ran against a real PostgreSQL 18.4 (embedded, scratch-only, never a project dependency) and a real `next dev` server on `localhost:3100`.

| Check                                                                                                                      | Result                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Migration `0003` (curriculum, planning, execution, memory, traces) applies cleanly on top of Phase 0's `0000`–`0002`       | ✅ 25 tables, all FKs, checks, and partial unique indexes present                              |
| `plans_one_active` partial unique index and `concept_edges_no_self_loop` check verified via `pg_indexes` / `pg_constraint` | ✅                                                                                             |
| Seed extends cleanly: 10 canonical concepts + 1 published curriculum template, alongside Phase 0's 2 users                 | ✅ idempotent (`onConflictDoNothing`)                                                          |
| Sign in as the seeded demo user                                                                                            | ✅ 200, valid session cookie                                                                   |
| `POST /goals` with a template slug → goal + curriculum (10 concepts, 10 edges) + **initial plan generated synchronously**  | ✅ 201                                                                                         |
| `GET /goals/{id}/mission-control` → today's mission, Next Action with full factor breakdown, progress, risks               | ✅ 200                                                                                         |
| `POST /sessions` → `POST /sessions/{id}/complete` with a rating                                                            | ✅ mastery `0 → 0.1225`, next review in 8 days                                                 |
| **Next Action recomputed after the session and named a different task, for a stated reason**                               | ✅ moved to "Work, Energy & Power", dominant factor `impact`, rationale cites the live numbers |
| `POST /goals/{id}/next-action/skip`                                                                                        | ✅ returns the next candidate ("Newton's Laws of Motion")                                      |
| `POST /goals/{id}/plans/regenerate` (explicit trigger)                                                                     | ✅ committed plan v2, drift reported                                                           |
| `GET /goals/{id}/feasibility`, `GET /goals/{id}/graph`                                                                     | ✅ 200, arithmetic and graph shape correct                                                     |

The full transcript is reproduced in §5.

---

## 1. What was implemented

Phase 1's purpose per the roadmap: _the closed loop exists, crude but real and end to end._ Scope followed the five items named in the brief — Knowledge Graph, Priority Engine, Scheduling Engine, Replanning Engine, Mission Control API — plus the prerequisites the roadmap says those five depend on (`core/retention`, `core/mastery`, `core/feasibility`), since the Priority Engine cannot be built without them (roadmap 1.5 depends on 1.2, 1.3, 1.4).

### 1.1 `packages/core` — the deterministic engine (roadmap 1.2–1.7)

| Module             | File                       | What it does                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/config`      | `src/config/index.ts`      | Versioned weights (`α,β,γ,δ,λ,θ,φ,K_base,K_floor,reps_min,horizon`), validated at load — I-8 (`α+β+γ=1.0`) throws `InvalidConfigError` otherwise                                                                                                                                                                             |
| `core/graph`       | `src/graph/index.ts`       | Topological order (Kahn's algorithm, deterministic tie-break), cycle detection + break-at-weakest-edge (E-5), readiness (§6.5 soft multiplicative gate), direct-unlock count (M0 leverage depth)                                                                                                                             |
| `core/retention`   | `src/retention/index.ts`   | FSRS-5 via `ts-fsrs` (short-term steps disabled for day-granularity due dates), retrievability computed at read time (never stored), review-load projection for feasibility                                                                                                                                                  |
| `core/mastery`     | `src/mastery/index.ts`     | Evidence → mastery update (adaptive-K ELO, §5.2), belief confidence κ (§5.3), effective mastery with retention floor φ (§5.2, supersedes the naïve `m·R` in SYSTEM_ARCHITECTURE §6.3)                                                                                                                                        |
| `core/priority`    | `src/priority/index.ts`    | **The crown jewel.** Full five-factor scoring (`scoreCandidate`), the two-tier request-time combinator (`scoreFromStructural`), stage-3 eligibility filtering with reason codes (I-15), stage-5 hysteresis selection + time-budget fitting (§7), stage-6 confidence (§11), stage-7 deterministic rationale templates (§12.3) |
| `core/feasibility` | `src/feasibility/index.ts` | Required/available minutes, verdict boundaries, projected completion date, confidence interval, D8 scope triage ranked by ascending `Impact×Leverage`                                                                                                                                                                        |
| `core/scheduling`  | `src/scheduling/index.ts`  | Greedy constraint scheduler: due-reviews-first, readiness-respecting placement, 14-day window materialisation + week-granularity projection beyond it, plan-position-derived urgency (M0 §1.1)                                                                                                                               |
| `core/replanning`  | `src/replanning/index.ts`  | §10.3 drift computation, materiality gate, churn budget, and the missed-session **debt model** (§10.4) — no backlog data structure exists anywhere in this module, by construction                                                                                                                                           |

**M0 subset fidelity**, per AI_DECISION_ENGINE §1.1 — verified, not assumed:

- Urgency is derived from plan position, not a full DAG backward pass (`scheduling/index.ts`'s post-placement assignment).
- Leverage is direct out-degree (depth 1), with `transitiveDescendantCount` present in `graph` but unused by M0 scoring — the extension point exists without needing a rewrite (§18.1).
- Selection modifiers: hysteresis only (§7.1's stability rule, with all five override conditions implemented). Continuity/variety/override-memory/energy/freshness are absent, matching the frozen subset.
- Confidence is computed and traced (`assessConfidence`) but the API contract does not surface bands as a first-class UI directive — only the `why.confidence` object.
- Re-planning is manual trigger only (`decideReplan` always receives trigger class `'explicit'` from the route).

### 1.2 Database schema (roadmap 1.1)

New Drizzle schema files, one migration (`0003_curriculum_planning_execution_memory_traces.sql`), 25 tables total (15 new):

`packages/db/src/schema/{curriculum,planning,execution,memory,traces}.ts` — goals, curricula, curriculum_templates, subjects, units, topics, canonical_concepts, concepts, concept_edges, plans, study_blocks, tasks, task_concepts, study_sessions, evidence_events, learning_events, mastery_states, memory_states, decision_traces. DDL matches DATABASE_DESIGN §4.2–§4.6 column-for-column, including all named CHECK constraints, the `plans_one_active` and `goals_one_primary_active`-style partial unique indexes, and the near-horizon materialisation shape (§4.3).

Repositories: `packages/db/src/repositories/{curriculum,planning,execution,memory,traces,availability}.ts` — every method takes `userId` as a scoping argument (NFR-3.3), consistent with the Phase 0 pattern.

### 1.3 Service layer (`apps/web/src/modules/`)

| Module                                       | Owns                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `curriculum/curriculum.service.ts`           | Goal creation from a curated template, canonical-key resolution, cycle-breaking at write time, concept status updates     |
| `planning/planning.service.ts`               | Initial plan generation, the manual re-plan pipeline, feasibility + scope triage, schedule assembly                       |
| `next-action/next-action.service.ts`         | The hot path: candidate assembly, two-tier scoring, hysteresis, confidence, rationale, decision trace                     |
| `execution/execution.service.ts`             | Session lifecycle; `completeSession` is the transactional evidence → mastery + retention write (SYSTEM_ARCHITECTURE §6.4) |
| `mission-control/mission-control.service.ts` | Composes the above into Today's Mission, Next Action, Progress, and deterministic Risk derivations                        |

### 1.4 API (`apps/web/src/app/api/v1/`) — 15 new endpoints

```
GET    /curriculum/templates
POST   /goals                              GET /goals
GET    /goals/{goalId}                     GET /goals/{goalId}/feasibility
GET    /goals/{goalId}/graph               PATCH /concepts/{conceptId}
GET    /goals/{goalId}/plans               GET /goals/{goalId}/plans/current
POST   /goals/{goalId}/plans/regenerate    GET /goals/{goalId}/schedule
GET    /goals/{goalId}/next-action         POST /goals/{goalId}/next-action/skip
GET    /goals/{goalId}/mission-control
POST   /sessions                           POST /sessions/{sessionId}/complete
```

All Zod-defined in `packages/contracts/src/schemas/{goals,planning,next-action,execution,mission-control}.ts`, registered in `registry.ts`, and reflected in the regenerated `openapi.v1.json`. `apps/web/src/lib/api/handler.ts` gained dynamic-segment support (`params`, `requireParam`) — Phase 0 never needed it, since `/me` has no path parameters.

### 1.5 Content

`packages/db/src/seed-data/jee-physics-foundations.ts` — one curated template (JEE Main Physics: Mechanics + Waves foundations), 10 concepts, 10 prerequisite edges with real depth (`kinematics-1d → kinematics-2d → rotational-kinematics → torque-angular-momentum → angular-momentum-conservation` is a 5-deep chain), enough to exercise readiness, leverage, urgency, and decay risk meaningfully. `scripts/seed.ts` extended to seed the canonical vocabulary and publish the template.

---

## 2. Blueprint invariants carried into code

| Invariant                                                | Where it is enforced                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1 mastery ∈ [0,1], monotonic under signed evidence     | `mastery/index.ts` `clamp01`; tested with a 50-iteration saturation property                                                                                                                                                                    |
| I-2 `φ·m ≤ m_eff ≤ m`                                    | `effectiveMastery`; tested at `R ∈ {0, 0.25, 0.5, 0.75, 1.0}`                                                                                                                                                                                   |
| I-3 FSRS interval monotonicity under repeated success    | `retention.test.ts`, 5-review chain                                                                                                                                                                                                             |
| I-4 never schedules before a hard prerequisite           | `scheduling/index.ts` `isPlaceable`, topological-order-gated placement; tested                                                                                                                                                                  |
| I-5 never exceeds daily capacity                         | `scheduling/index.ts` capacity accounting; tested at a deliberately tight 60-min/day cap with 20 candidates                                                                                                                                     |
| I-6 the scheduler always terminates, including on cycles | `breakCycles` runs before `topologicalOrder`; tested with a 3-node cycle                                                                                                                                                                        |
| I-7 feasibility arithmetic is hand-verifiable            | `feasibility.test.ts` — every fixture's expected value is computed by hand in the test comment                                                                                                                                                  |
| I-8 `α+β+γ=1.0` enforced at config load                  | `config/index.ts` `validatePriorityConfig`                                                                                                                                                                                                      |
| I-9 two-tier consistency                                 | `scoreFromStructural` shares `assembleScore` with `scoreCandidate` — one formula, two entry points                                                                                                                                              |
| I-11 dominant factor is the largest contributor          | `pickDominantFactor`; tested directly                                                                                                                                                                                                           |
| I-12 confidence always emitted                           | `assessConfidence` has no suppression path                                                                                                                                                                                                      |
| I-13 no decision path calls an LLM for a number          | Verified by inspection: `packages/core` has zero imports outside itself and `ts-fsrs`                                                                                                                                                           |
| I-15 every excluded candidate carries a reason code      | `filterEligible`                                                                                                                                                                                                                                |
| DP8 retention debt outranks coverage debt                | `γ=0.35` default weight + due-reviews-placed-first in the scheduler; demonstrated live (§0 transcript: the recommendation after a completed session moved to the highest-impact _unstudied_ concept, not a review, because nothing was yet due) |
| §10.4 no artificial backlog                              | `identifyMissedTasks` returns task identity only — no "days late" or forwarded-date field exists in its type, so the debt model cannot silently reintroduce one later                                                                           |

---

## 3. Deviations from the blueprint

Reported per the Phase 0 working agreement — nothing below was silently absorbed.

### D-6 · `study_sessions`, `evidence_events`, `learning_events`, `decision_traces` are not partitioned · Significant, reversible

**Blueprint:** DATABASE_DESIGN D7 and §7 specify monthly `PARTITION BY RANGE` on these four tables.

**Built:** ordinary tables, identical columns, indexes, and constraints otherwise.

**Why:** partitioning is an operational scaling concern — DATABASE_DESIGN §10 itself places it at the "<10k DAU, single primary is sufficient" stage, not as a Phase 1 correctness requirement. Retrofitting is a standard additive migration (attach the existing table as the first partition), not a redesign. Time was spent on the load-bearing engine correctness instead. **Flagged for a follow-up migration before production traffic**, not before Phase 2.

### D-7 · No Redis / Next Action caching layer · Minor

**Blueprint:** API_SPECIFICATION §5.5 specifies a 5-minute Redis cache keyed by `(userId, goalId, minutesBucket)`.

**Built:** Next Action is computed fresh on every request. `cacheHit` is always `false`.

**Why:** Redis is not part of the Phase 0/1 dependency set, and NFR-1.7's 300ms budget is trivially met without a cache at the current candidate-set size (tens of tasks per plan window, never the full curriculum — §6.0's whole point). Adding the cache later changes nothing about the engine; it is a pure infrastructure addition behind the same function signature.

### D-8 · Plan generation and re-planning run synchronously, not via Inngest · Significant, matches the 72-hour compression path

**Blueprint:** roadmap 1.11 specifies an async job with SSE progress (`202` + job id).

**Built:** `POST /goals` generates the initial plan in-process before returning `201`; `POST /goals/{id}/plans/regenerate` does the same synchronously.

**Why:** at the M0 scale (a 14-day window, tens of tasks), generation completes in well under a second — verified in the transcript (§0). IMPLEMENTATION_ROADMAP §6.5 explicitly sanctions this compression for a compressed timeline ("greedy scheduler... Next Action... Mission Control" as the irreducible core). Moving to async is a route-handler change (enqueue + poll), not a `core/scheduling` change — the engine itself has no knowledge of sync vs. async callers.

### D-9 · Curriculum Architect (AI agent) not built · By design, per the user's stated scope

Goal creation accepts only `templateSlug`; `curricula.source` is always `'template'`. `'ai_generated'` remains a valid enum value and `concept_key` resolution (NFR-7.2) is already enforced against the template path, so the AI path is additive when it ships (roadmap 1.9, explicitly out of this phase's five-item scope).

### D-10 · `mastery_states` carries two columns beyond the frozen schema · Minor, additive

**Blueprint:** DATABASE_DESIGN §4.6 lists `mastery, confidence, evidence_count, total_minutes, accuracy_rate, first_studied_at, last_evidence_at, updated_at`.

**Built:** adds `distinct_sources` and `outcome_variance`.

**Why:** AI_DECISION_ENGINE §5.3 specifies belief confidence κ as a function of four inputs — volume, **diversity** (distinct sources/item types), **consistency** (outcome variance), and recency. The frozen table has no column carrying the diversity or consistency signal, so `core/mastery`'s `updateBeliefConfidence` (which the spec requires to exist) would have nothing to read on a cold load. Two columns were added to close that gap, following the Phase 0 precedent (D-1's "additions where the blueprint was silent" section) rather than silently hard-coding both inputs to a constant.

### D-11 · Session-to-mastery evidence source is fixed at `self_rating` · Minor

`completeSession` maps the FSRS rating directly to an evidence outcome (§5.4's "self-reported level" mapping) rather than the `question_response`/`assessment` sources. Correct for M0's scope (there is no assessment or practice-question system yet — that is Phase 2, roadmap 2.7–2.8) but worth naming so the `w_source = 0.35` weighting is understood as intentional, not a bug.

---

## 4. What is verified, and what is not

**Verified statically.** Format, lint (including the pre-existing dependency-boundary probes — a route handler importing `@friday/db` directly was caught and fixed during this phase, proving the Phase 0 boundary lint still does its job), typecheck across all 8 workspaces, 123 unit tests (59 of them in `packages/core`, covering every named invariant in §16 that applies to the M0 subset), and a clean production build of all 26 routes.

**Verified at runtime.** Migrations and seed on PostgreSQL 18.4; the full Golden Path over real HTTP — sign-in, goal creation (with real template cloning and cycle-checking), Mission Control, session completion, and a **provable Next Action change with a stated, arithmetically faithful reason** (§0, §5).

**Still not verified, stated plainly:**

- **No integration tests against a real Neon branch, and no tenancy-isolation test suite** for the new repositories — IMPLEMENTATION_ROADMAP §7.2 calls for a dedicated suite asserting no method returns another user's rows. The new repositories follow the same `userId`-scoped pattern Phase 0 established and verified, but the new methods themselves are untested for that property directly. Recommended as the first item of Phase 2 hardening.
- **No property-based tests.** IMPLEMENTATION_ROADMAP §7.2 asks for property tests on mastery bounds, due-date monotonicity, and scheduler invariants. What exists are targeted example-based tests covering the same invariants (see §2's table) — real coverage, but not the `fast-check`-style generative form the roadmap describes.
- **E-13 (everything overdue at once, triage) and E-21 (scheduler time budget)** are not explicitly tested, though the scheduler's greedy per-day walk with a bounded task count makes runaway iteration unlikely by construction.
- **No CI run** — the project is still not a git repository (unchanged from Phase 0; `git init` remains the user's call).
- **No browser testing.** All verification is HTTP-level, matching the Phase 0 precedent — Playwright arrives with UI work.
- **Load and scale testing (NFR-1.7's p95 <300ms under concurrency)** was not exercised; the single-request transcript in §0 completed in well under 300ms but that is not a load test.

---

## 5. Demonstration — one learner, onboarding to Mission Control

Reproduced from the real HTTP transcript against the seeded demo account (`demo@friday.app`), PostgreSQL 18.4, `next dev` on port 3100.

1. **Sign in.** `POST /auth/sign-in` → 200, session cookie issued.
2. **List templates.** `GET /curriculum/templates` → one published template, `jee-physics-foundations`.
3. **Create a goal.** `POST /goals` with `{title, type:"exam", targetDate:"2027-05-23", templateSlug:"jee-physics-foundations"}` → **201**, goal + a 10-concept curriculum cloned from the template (subjects → units → topics → concepts → prerequisite edges), **and an initial plan generated synchronously** in the same request.
4. **Mission Control.** `GET /goals/{id}/mission-control?availableMinutes=45` → today's mission (one task: _Learn: Kinematics in One Dimension_, 40 min — the graph's only zero-in-degree node, correctly placed first), a Next Action with the full factor breakdown (`urgency` dominant at 1.0 — this is the earliest position in a freshly generated 14-day window), progress at 0% (nothing studied yet), zero risks (verdict `on_track`).
5. **Start and complete a session.** `POST /sessions` → active session. `POST /sessions/{id}/complete` with `rating:"easy"` → mastery on Kinematics moves **0 → 0.1225**, next review scheduled **8 days out**, in one transaction.
6. **Next Action changes.** `GET /goals/{id}/next-action` → the recommendation is now _Learn: Work, Energy & Power_ — Kinematics is gone from the candidate pool (task completed), and the new top pick is named with a **stated, faithful reason**: `"Exam weight 65%, currently at 0% mastery... the biggest gap that matters right now"`, dominant factor `impact`. This is the roadmap's Golden Path exit criterion, demonstrated live: _the recommendation changed for a stated reason after evidence._
7. **Skip.** `POST /goals/{id}/next-action/skip` on that task → returns the next candidate (_Newton's Laws of Motion_), the skipped task marked `skipped` with its reason, never resurfaced.
8. **Replan (manual trigger).** `POST /goals/{id}/plans/regenerate` → plan version 2 committed, drift reported (`0.5`, from the window rolling forward one day plus the completed/skipped tasks leaving the pool) — the replanning engine's full §10.2 pipeline (snapshot → recompute → diff → materiality gate → commit) exercised end to end.
9. **Feasibility and graph.** `GET /goals/{id}/feasibility` → `on_track`, hand-checkable arithmetic. `GET /goals/{id}/graph` → 10 nodes, 10 edges, matching the seeded template exactly.

---

## 6. Phase 1 is complete and awaiting approval

Every item in the brief is implemented, tested, and runtime-verified against a real database and a real server:

- **Knowledge Graph** — curriculum model, concepts, prerequisites, dependency graph (`core/graph`, curriculum schema + service).
- **Priority Engine** — the full M0-subset deterministic framework from AI_DECISION_ENGINE, zero LLM involvement, every recommendation traced (`decision_traces`) and explained from its own factor table.
- **Scheduling Engine** — greedy constraint scheduler, 14-day materialised window + projection, respects capacity and readiness.
- **Replanning Engine** — missed-session debt model with no backlog construct, drift/materiality gate, manual trigger per the frozen M0 subset.
- **Mission Control API** — Today's Mission, Next Action, Progress, Risks, and rationale, composed from deterministic engine output in one response.

No architectural redesign occurred. Deviations are named in §3, each with its reasoning, and each reversible or additive rather than structural.

**Phase 2 does not begin without your approval.** Per your instruction, this stops here.
