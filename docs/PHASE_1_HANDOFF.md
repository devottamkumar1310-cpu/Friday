# Phase 1 → Phase 2 Handoff

> **Baseline:** Blueprint v1.3 · **FROZEN** · git tag `phase-1-baseline` (commit `ade8d69`)
> **Full detail:** [PHASE_1_REPORT.md](PHASE_1_REPORT.md) (implementation + verification) · [ARCHITECTURE_CHANGELOG.md](ARCHITECTURE_CHANGELOG.md) (CR-003 + deferred-items ledger)
> This document is the concise pointer. Read it first; go to the two above only for detail.

---

## 1. What was implemented

The deterministic domain engine (`packages/core`) and everything needed to expose it: schema, repositories, services, and API.

- **Knowledge Graph** — `core/graph`: topological order, cycle detection, readiness, leverage. Backed by `goals → curricula → subjects → units → topics → concepts → concept_edges`.
- **Priority Engine** — `core/priority`: the full M0-subset five-factor scoring function (Impact, Urgency, Decay Risk, Readiness, Cost), hysteresis-based selection, confidence scoring, deterministic rationale templates. Zero LLM involvement anywhere in the decision path.
- **Scheduling Engine** — `core/scheduling`: greedy constraint scheduler, 14-day materialised window + week-granularity projection beyond it.
- **Replanning Engine** — `core/replanning`: drift computation, materiality gate, churn budget, and the missed-session debt model (no backlog data structure exists — by construction, not by convention).
- **Mission Control API** — `GET /goals/{goalId}/mission-control`: Today's Mission, Next Action, Progress, Risks, and rationale, composed from the above.
- Supporting: `core/retention` (FSRS-5), `core/mastery` (evidence → mastery, belief confidence), `core/feasibility` (required/available minutes, verdict, scope triage) — all prerequisites the Priority Engine depends on per the roadmap.
- One curated content template (JEE Physics: Mechanics + Waves, 10 concepts, real prerequisite depth) and the canonical concept vocabulary.

## 2. What was verified

- **Static:** format, lint (dependency-boundary rules enforced — one violation caught and fixed live during the phase), typecheck, 123 unit tests, production build. All clean on the frozen commit.
- **Runtime:** migrations + seed against a real PostgreSQL 18.4. Full Golden Path exercised over real HTTP against a running server: sign-in → goal creation (template clone + cycle-check) → synchronous plan generation → Mission Control → session completion (mastery `0 → 0.1225`, retention scheduled) → **Next Action changed to a different task for a stated, arithmetically faithful reason** → skip → manual replan (committed plan v2) → feasibility → graph.
- **Not verified** (see PHASE_1_REPORT.md §4 for the full list): tenancy-isolation test suite for the new repositories, property-based tests, load/concurrency testing, browser/E2E testing, CI execution.

## 3. Public APIs added

15 endpoints under `/api/v1`, all Zod-contracted (`packages/contracts`) and reflected in `openapi.v1.json`:

```
GET    /curriculum/templates
POST   /goals                              GET    /goals
GET    /goals/{goalId}                     GET    /goals/{goalId}/feasibility
GET    /goals/{goalId}/graph               PATCH  /concepts/{conceptId}
GET    /goals/{goalId}/plans               GET    /goals/{goalId}/plans/current
POST   /goals/{goalId}/plans/regenerate    GET    /goals/{goalId}/schedule
GET    /goals/{goalId}/next-action         POST   /goals/{goalId}/next-action/skip
GET    /goals/{goalId}/mission-control
POST   /sessions                           POST   /sessions/{sessionId}/complete
```

`apps/web/src/lib/api/handler.ts` gained dynamic-segment support (`params`, `requireParam`) — Phase 0's only endpoint (`/me`) never needed it.

## 4. Database changes

Migration `0003_curriculum_planning_execution_memory_traces.sql` — 15 new tables (25 total with Phase 0's identity tables): `goals, curricula, curriculum_templates, subjects, units, topics, canonical_concepts, concepts, concept_edges, plans, study_blocks, tasks, task_concepts, study_sessions, evidence_events, learning_events, mastery_states, memory_states, decision_traces`.

DDL matches DATABASE_DESIGN §4.2–§4.6 column-for-column, **except**:

- `mastery_states` carries two additive columns beyond the originally frozen spec — `distinct_sources`, `outcome_variance` — needed by belief-confidence κ's diversity/consistency inputs (AI_DECISION_ENGINE §5.3). Reconciled via **CR-003**; DATABASE_DESIGN §4.6 has been amended to match. Non-breaking, no invariant affected.
- `study_sessions`, `evidence_events`, `learning_events`, `decision_traces` are **not** partitioned (DATABASE_DESIGN D7 specifies monthly `RANGE` partitioning). Deferred to the "<10k DAU" scaling gate DATABASE_DESIGN §10 itself names — logged in the changelog's deferred-items ledger, not silently dropped.

## 5. New packages and modules

**`packages/core`** — fully populated for the first time (Phase 0 shipped only version stamps): `config`, `types`, `graph`, `retention`, `mastery`, `priority`, `feasibility`, `scheduling`, `replanning`. 59 unit tests.

**`packages/db`** — new schema files (`curriculum.ts`, `planning.ts`, `execution.ts`, `memory.ts`, `traces.ts`), new repositories (`curriculum.ts`, `planning.ts`, `execution.ts`, `memory.ts`, `traces.ts`, `availability.ts`), one seed template (`seed-data/jee-physics-foundations.ts`).

**`apps/web/src/modules`** — five new service modules: `curriculum`, `planning`, `next-action`, `execution`, `mission-control`. (`identity` is Phase 0's, unchanged.)

**`packages/contracts`** — five new schema files: `goals.ts`, `planning.ts`, `next-action.ts`, `execution.ts`, `mission-control.ts`.

**Untouched, still Phase 0 stubs, correctly left alone:** `packages/ai` (declares only the tool-injection contract; Phase 2 populates `router/context/agents/tools/prompts/guardrails/evals`), `packages/ui`.

## 6. Remaining known limitations

In priority order for anyone picking up Phase 2:

1. **No AI subsystem exists yet.** `packages/ai` is exactly the Phase 0 stub. Goal creation accepts only a curated `templateSlug` — the Curriculum Architect agent (roadmap 1.9) was explicitly out of Phase 1's scope.
2. **No caching layer.** Next Action computes fresh every request (`cacheHit` always `false`). Fine at current scale; revisit when Redis enters the dependency set.
3. **Plan generation is synchronous**, not an Inngest job. Works because the M0 window is small (~14 days, tens of tasks); will need to move async before curriculum size or concurrent load grows.
4. **High-volume tables are unpartitioned.** Deferred per DATABASE_DESIGN §10's own staging, not a defect at current scale.
5. **No tenancy-isolation test suite** for the new repositories (IMPLEMENTATION_ROADMAP §7.3 calls for one explicitly). The `userId`-scoping pattern is followed but not independently tested for the new tables.
6. **No property-based tests**, no load testing, no CI execution (project has no remote yet), no browser/E2E testing. All flagged, none silently skipped.
7. **Evidence source is hard-coded to `self_rating`** in `completeSession` — correct until Phase 2's assessment/practice system (roadmap 2.7–2.8) introduces `question_response` and `assessment` sources.

## 7. Exact starting point for Phase 2

Per IMPLEMENTATION_ROADMAP §3 ("Phase 2 — Intelligence Layer"), the critical path is:

```
2.4  packages/ai/context  — the Learner Context Packet builder + token budgeting
2.5  AI read tools (get_plan, get_mastery, get_weak_concepts, …)
2.6  Coach agent — SSE streaming, tool-calling loop, thread persistence
2.9  Deterministic rationale template renderer → "why this?" UI (core/priority → text, already built — 2.10 is UI only)
2.1  Progress + weighted completion + on-track verdict endpoints (mission-control.service.ts already computes weightedProgress — this is largely an extraction/UI task, not new engine work)
2.2  Weak-concept ranking with evidence drill-down
2.7  Content Generator agent + question cache + exposure tracking
2.8  Practice flow: serve → answer → grade → evidence → mastery update
```

**Nothing in `packages/core` needs to change to start Phase 2.** The AI subsystem is additive: it declares tool schemas, the service layer injects executors (ADR-017, already enforced by the `packages/ai → packages/db` ESLint boundary), and every AI-authored artifact is either an _input to_ or an _explanation of_ a `packages/core` computation — never the computation itself (DP1). Start at `packages/ai/context`; everything downstream depends on it.

Do not begin Phase 2 implementation until this handoff is acknowledged.
