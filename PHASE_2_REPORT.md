# Phase 2 — Intelligence Layer · Completion Report

> **Baseline:** Blueprint v1.4 · **Status: verified, awaiting approval to begin Phase 3**
> **Static gate:** ✅ format · ✅ lint (8 packages, boundary rules enforced) · ✅ typecheck · ✅ **212 tests** (was 123) · ✅ production build
> **Runtime gate:** ✅ migration `0004` + seed on **PostgreSQL 18.4** · ✅ practice loop exercised end to end over real HTTP · ✅ AI-unavailable degradation demonstrated, not asserted
> **Constraint:** no `ANTHROPIC_API_KEY` was available. Every AI path is written, type-checked against the real SDK, and unit-tested against recorded fixtures — but **never executed live**. §4 states exactly what that leaves unverified.

---

## 0. Runtime verification

Against a real PostgreSQL 18.4 and a live `next dev` server, as in Phases 0 and 1.

| Check                                                                     | Result                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Migration `0004` (13 new tables) on top of `0000`–`0003`                  | ✅ 37 tables total; re-run is a no-op                                     |
| Seed extends with 8 golden-set questions                                  | ✅ idempotent (second run inserts 0)                                      |
| `GET /intelligence/progress` on a fresh goal                              | ✅ 0% weighted, 10 concepts, verdict `on_track`                           |
| `GET /intelligence/weak-concepts` before any evidence                     | ✅ **empty** — unstarted is not weak (E-1)                                |
| `POST /assessments` for 2 concepts                                        | ✅ `servedFromCache: true` — **zero AI calls**                            |
| Answer graded correct → `isCorrect: true`, `gradingMethod: deterministic` | ✅                                                                        |
| Answer graded wrong → returns the correct answer **and** its explanation  | ✅                                                                        |
| `POST /attempts/{id}/submit` → evidence → mastery + FSRS                  | ✅ correct concept `0 → 0.2975`; wrong concept stayed `0`                 |
| Evidence weighting is visibly stronger than a self-rating                 | ✅ 0.2975 here vs 0.1225 in Phase 1 — `w_source` 0.85 vs 0.35 (§5.2)      |
| FSRS scheduled the failed concept sooner than the passed one              | ✅ due 2026-08-07 vs 2026-08-14                                           |
| Weak concepts after evidence, ranked                                      | ✅ Newton's Laws (0.84) above Kinematics (0.39) — weight × gap × leverage |
| `GET /memory/mastery`, `/memory/due`, `/memory/facts`                     | ✅ 200; facts empty until the Phase 3 Reflector                           |
| Coach without an API key                                                  | ✅ **503 `AI_UNAVAILABLE`** naming what still works                       |
| **Core loop with AI unavailable** — next-action, mission-control          | ✅ fully intact (NFR-2.2 / E-16 demonstrated)                             |

### Two defects found by runtime verification and fixed

Both were in Phase 2 code, found by exercising the system rather than by reading it.

**1. `provisional` never fired.** A single observation produced κ = 0.525 — above the 0.35 threshold — so a concept judged weak on one answer was presented as an established finding. Root cause: §5.3 derives κ partly from _consistency_ (variance across outcomes), and one data point has no variance, so it scores as **perfectly consistent**. The weak-concept drill-down now checks evidence count directly (`PROVISIONAL_EVIDENCE_COUNT = 3`). The underlying κ formula in Phase 1's `core/mastery` was deliberately **not** touched — see CR-004 §6 for the proposed Phase 3 fix.

**2. The Coach returned `200` instead of `503` when unconfigured.** `assertCoachAvailable()` sat inside an async generator, and a generator body does not run until its first `next()` — by which point the status line and headers are already sent. The learner got a 200 whose first frame was a generic `INTERNAL_ERROR`. `sseRoute`'s handler now returns its iterable from an async function, so pre-flight failures happen while a real error response is still possible; in-stream errors also now preserve their `ApiError` code instead of flattening to `INTERNAL_ERROR`. Regression tests in `modules/coach/__tests__/sse-contract.test.ts` pin both the generator-laziness behaviour and the SSE event names.

---

## 1. What was implemented

All thirteen deliverables: roadmap 2.1–2.12 plus the inherited 1.9.

### 1.1 `packages/ai` — the AI subsystem, populated for the first time

| Module        | What it does                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | The `ModelProvider` seam — one interface, two implementations. The reason CI never makes a live call                                              |
| `provider/`   | `anthropic.ts` (AI SDK v5, real streaming and structured output) and `fixture.ts` (recorded responses + a failing provider for degradation tests) |
| `router/`     | Model routing **as policy** (§5.3), tier degradation on budget breach, cost accounting                                                            |
| `context/`    | **2.4** — Learner Context Packet, tiered truncation, stable cache prefix, log redaction                                                           |
| `tools/`      | **2.5** — seven read-tool declarations; executors injected by services (ADR-017)                                                                  |
| `prompts/`    | Versioned modules written to `ai_calls.prompt_version`                                                                                            |
| `guardrails/` | Injection delimiting, output validation with one repair, tool-call budget                                                                         |
| `agents/`     | **1.9** Curriculum Architect · **2.6** Coach · **2.7** Content Generator                                                                          |
| `evals/`      | **2.12** — suite runner and scorers, gated per §5.8                                                                                               |

69 tests.

### 1.2 `packages/core` — `intelligence/` added

**2.1** weighted progress (exam-weight-weighted mastery, explicitly _not_ task completion), **2.2** weak-concept ranking with evidence drill-down, plus velocity and retention health. 18 tests; core now at 77.

### 1.3 Database — migration `0004`, 13 new tables

`questions`, `question_concept_keys`, `question_exposures`, `assessments`, `attempts`, `responses`, `learner_facts`, `progress_snapshots`, `insights`, `coach_threads`, `coach_messages`, `ai_calls`, `usage_counters`, `feature_flags`.

`questions` and `question_concept_keys` carry **no `user_id`** — they are shared content keyed by canonical concept, which is what makes generated questions reusable across learners (NFR-4.5).

### 1.4 Services (`apps/web/src/modules/`)

`ai/` (provider composition root, context builder, tool executors) · `intelligence/` · `assessment/` · `coach/` · `memory/` · `shared/mappers.ts` (row→domain conversions extracted from three Phase 1 services that had duplicated them).

### 1.5 API — 16 new endpoints

```
GET  /intelligence/progress          GET  /intelligence/weak-concepts
GET  /intelligence/trends            GET  /intelligence/insights
POST /assessments                    POST /attempts/{id}/responses
POST /attempts/{id}/submit           POST /questions/{id}/report
GET  /coach/threads                  POST /coach/threads
GET  /coach/threads/{id}             DELETE /coach/threads/{id}
POST /coach/threads/{id}/messages    ← SSE
GET  /memory/mastery                 GET  /memory/due
GET  /memory/facts                   PATCH/DELETE /memory/facts/{id}
```

`sseRoute` was added to the handler so the Coach stream keeps the same auth, CSRF, and request-id guarantees as every JSON route.

### 1.6 UI

**2.10** `WhyThis` — the factor breakdown, a direct projection of the numbers that produced the decision, hosted on the Next Action card. **2.11** progress page — ring, weak list with evidence, pace, sparkline. **2.3** `FeasibilityRemediation` — three levers always shown together, never chosen between (§9.3). The dashboard now renders real Mission Control rather than the Phase 0 shell.

### 1.7 Content

8 hand-written golden-set questions (**2.12**), seeded as shared content. Hand-written deliberately: a golden set generated by the model it grades proves nothing. They double as the cache that makes the practice loop demonstrable with no API key.

---

## 2. Blueprint invariants upheld

| Invariant                                             | Where                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **DP1** — the model never produces a trusted number   | `get_next_action` reports the engine's decision; grading is exact comparison; no agent computes mastery |
| **I-13** — no decision path calls an LLM for a number | Verified by inspection; `packages/core` still imports nothing but `ts-fsrs`                             |
| **ADR-017** — `ai` may not import `db`                | Lint-enforced; all seven tools take injected executors                                                  |
| **NFR-2.2 / E-16** — AI down, core loop intact        | **Demonstrated at runtime** with no API key configured                                                  |
| **§5.4** — deterministic, budgeted context            | Tiered truncation tested; `goal`/`status` never dropped; token ceiling never exceeded                   |
| **§5.7** — injection containment                      | Delimiter-smuggling test; args schema-validated before any executor runs                                |
| **NFR-7.2** — no invented `concept_key`, no cycles    | Structural validator shares `breakCycles` with the scheduler — one guarantee, not two                   |
| **NFR-4.5** — content shared across learners          | `servedFromCache: true` observed; exposures recorded per learner                                        |
| **I-11 / T3** — rationale faithfulness                | `scoreRationaleFaithfulness` fails a plausible rationale naming the wrong factor                        |
| **FR-7.6** — fact deletion honoured immediately       | Hard delete, not an archive flag                                                                        |

---

## 3. Deviations

All recorded as **CR-004**. Summary: the `ModelProvider` seam (additive, demanded by A6 + §7.2 + ADR-012); AI SDK pinned to the blueprint's v5 rather than the current v7; `directives`/`audit_log` deferred to Phase 4 and `memory_chunks` to Phase 3, following the established phase-scoping precedent; three of six agents implemented, the other three being Phase 3 per the roadmap.

---

## 4. What is **not** verified

Stated plainly, because the gap is real.

- **No AI path has ever executed.** The Anthropic provider, all three agents, streaming, tool-calling against a live model, structured-output conformance, prompt quality, and real token/cost figures are **untested against reality**. They are type-checked against the real SDK and unit-tested against fixtures — which catches wiring and logic errors, and catches nothing about whether the model does what the prompt asks.
- **The eval suites have a harness but nearly no corpus.** Scorers and gates are implemented and tested; the golden sets are 8 questions and a handful of synthetic cases. §5.8's gates cannot meaningfully pass or fail at that size.
- **No integration or tenancy-isolation suite** for the Phase 2 repositories — still the Phase 1 gap, now larger by 13 tables.
- **`sendMessage` is untested end to end.** Its parts are covered; the assembled service is not, because exercising it needs either a live model or a substantially larger fixture harness.
- **Trends and insights return empty in practice.** `progress_snapshots` is only written by `recordProgressSnapshot`, which nothing calls on a schedule — the nightly job is Phase 3. Insights have no generator until the Phase 3 Diagnostician.
- **No property-based tests, load testing, CI run, or browser testing** — unchanged from Phase 1.

---

## 5. Demonstration

Against the seeded demo account, real PostgreSQL, real HTTP, no API key:

1. Sign in → create goal from template → curriculum (10 concepts) + plan generated.
2. `GET /intelligence/progress` → 0%, 10 concepts not started, `on_track`.
3. `GET /intelligence/weak-concepts` → **empty**, correctly: nothing has evidence.
4. `POST /assessments` for Kinematics + Newton's Laws → 2 questions, **`servedFromCache: true`**.
5. Answer one correctly, one wrong → graded deterministically, each returning its explanation.
6. `POST /attempts/{id}/submit` → Kinematics `0 → 0.2975`, Newton's Laws stays `0`; FSRS schedules the failure for tomorrow and the success for a week out.
7. `GET /intelligence/weak-concepts` → both now ranked, **Newton's Laws first** (0.84 vs 0.39) despite equal evidence, because exam weight and leverage differ. Both flagged `provisional` on one observation.
8. `POST /coach/threads/{id}/messages` → **503 `AI_UNAVAILABLE`**: _"The coach is not configured in this environment. Your plan, next action, and sessions are unaffected."_
9. `GET /goals/{id}/next-action` → still returns a full recommendation with its factor breakdown. **The core loop does not depend on the AI layer, and this is the proof.**

---

## 6. Phase 2 is complete

All thirteen deliverables implemented, 212 tests passing, verified against a real database and server. Two defects were found by runtime verification and fixed; both now have regression tests.

The honest headline: **the deterministic half of Phase 2 is verified, the AI half is written but unproven.** Providing an `ANTHROPIC_API_KEY` and re-running §5 would close that gap in an afternoon, and it is the first thing worth doing.

**Phase 3 does not begin without your approval.**
