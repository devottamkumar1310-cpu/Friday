# FRIDAY — Architecture Changelog

> Records every change to the frozen blueprint, with rationale.
> **Current baseline: Blueprint v1.5 — FROZEN — Phase 3 (Launch Candidate) baseline.**

---

## Blueprint v1.0 — Frozen

**Scope:** the seven blueprint documents, as amended by the eight critical fixes below.
**Preceded by:** [DESIGN_REVIEW.md](DESIGN_REVIEW.md) — the pre-implementation technical design review that identified them.

**Frozen documents**

| Document                                               | Version |
| ------------------------------------------------------ | ------- |
| [PROJECT_VISION.md](PROJECT_VISION.md)                 | 1.0     |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)     | 1.1     |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)       | 1.1     |
| [AI_DECISION_ENGINE.md](AI_DECISION_ENGINE.md)         | 1.1     |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md)               | 1.1     |
| [API_SPECIFICATION.md](API_SPECIFICATION.md)           | 1.1     |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | 1.1     |

`DESIGN_REVIEW.md` is **not** amended. It is a point-in-time record of what the blueprint looked like before these fixes, and rewriting it would destroy the audit trail. Its findings read as historical by design.

---

## Changes in v1.0 — the eight critical fixes

Each entry: what was wrong, why it mattered, what changed, and which documents moved.

### C1 · Near-horizon plan materialisation

**Was:** plan versions materialised the entire remaining horizon, so every re-plan cloned the full schedule — ~72,000 task rows per learner per goal, ~7.2B rows at 100k users. Neither `tasks` nor `study_blocks` was partitioned.
**Why it mattered:** a hard scalability blocker, and it made nightly re-planning unaffordable in both compute and storage.
**Changed:** a plan version now materialises concrete blocks and tasks for a **14-day window** (`window_start`, `window_end`); everything beyond lives in `projection` as concept → target-week with aggregate minutes. Superseded versions have their materialised rows pruned after 30 days (`pruned_at`); version rows, feasibility snapshots, projections, and diffs are kept indefinitely. Steady-state rows per learner drop from ~72,000 to a few hundred, and partitioning these tables becomes unnecessary.
**No product behaviour changes** — nobody needs day 217 scheduled to the minute.
**Documents:** `DATABASE_DESIGN` §4.3, §7 · `AI_DECISION_ENGINE` §10.2 · `API_SPECIFICATION` §5.4 · `IMPLEMENTATION_ROADMAP` 1.7, day 6 · `SYSTEM_ARCHITECTURE` ADR-014

### C2 · Application-generated UUIDv7

**Was:** every table used `DEFAULT uuidv7()` while the engine was pinned to PostgreSQL 16. `uuidv7()` is a **PostgreSQL 18 builtin** — migration `0001` would fail on every table. `citext` and `vector` had no `CREATE EXTENSION` preamble anywhere.
**Why it mattered:** nothing could be built at all.
**Changed:** IDs are generated in the application layer (Drizzle `$defaultFn`), removing the engine-version constraint entirely and making ID generation unit-testable without a database. Added §1.1 Required Extensions as migration `0000`. Engine now reads "PostgreSQL 16+".
**Documents:** `DATABASE_DESIGN` header, D1, new §1.1, all DDL · `AI_DECISION_ENGINE` §13.1 · `SYSTEM_ARCHITECTURE` ADR-018

### C3 · Invalid CHECK constraint removed

**Was:** `users_auth_method CHECK (… OR id IN (SELECT user_id FROM accounts))`. PostgreSQL does not permit subqueries in check constraints.
**Why it mattered:** hard DDL error.
**Changed:** constraint dropped; "every account has at least one auth method" moved to the identity service and listed in §8 alongside the other service-enforced invariants, with its reason.
**Documents:** `DATABASE_DESIGN` §4.1, §8

### C4 · Canonical concept vocabulary

**Was:** `questions.concept_key` was described as a canonical slug, but `concepts` had no `concept_key` column — no join path existed. `question_concepts` carried `user_id`, contradicting the "shared across users" model on the same table.
**Why it mattered:** generated-content reuse is one of five controls holding AI spend to $0.60/user/month (NFR-4.5). As written it was unqueryable, and AI-generated curricula would have produced a vocabulary of one and a cache hit rate of zero.
**Changed:** added `canonical_concepts` (a small curated vocabulary) and `concepts.concept_key` referencing it. `question_concepts` replaced by `question_concept_keys` — shared, no `user_id`. The Curriculum Architect must map each generated concept to an existing key or return `null`; inventing keys is rejected by structural validation. `concept_key IS NULL` is a valid state meaning "private concept, no content sharing, higher cost."
**Documents:** `DATABASE_DESIGN` §2, §4.2, §4.5, §5, §6, §8 · `SYSTEM_ARCHITECTURE` §5.5, ADR-016 · `PRODUCT_REQUIREMENTS` NFR-7.2 · `IMPLEMENTATION_ROADMAP` 1.8, 1.9

### C5 · Two-tier priority computation

**Was:** `DATABASE_DESIGN` stored `tasks.priority_score` "at generation" while `AI_DECISION_ENGINE` described a full pipeline at decision time. Both could not be true, and the stored form was wrong regardless — decay risk changes daily.
**Why it mattered:** either the recommendation is stale within 24 hours, or the 300 ms budget (NFR-1.7) is unachievable, because urgency needs a backward DAG pass and leverage needs transitive descendant counts.
**Changed:** formalised the split. **Structural** terms (Impact, Urgency, Leverage, Readiness, Cost) computed once per plan version into `tasks.structural_factors`. **Volatile** terms (DecayRisk, effective mastery, time fit, selection modifiers) recomputed per request over the materialised window only. No blended score is ever stored. This also resolves E-26 (enormous curricula) structurally rather than by assertion.
**Documents:** `AI_DECISION_ENGINE` new §6.0, header refinements table · `DATABASE_DESIGN` §4.3 · `SYSTEM_ARCHITECTURE` §6.3, §8, ADR-015 · `API_SPECIFICATION` §5.5 · `IMPLEMENTATION_ROADMAP` 1.5

### C6 · Request-time template rationale

**Was:** rationale prose was LLM-generated asynchronously into `tasks.rationale`.
**Why it mattered:** once C5 recomputes volatile factors at request time, stored prose can name a factor that no longer dominates — violating invariant **I-11** and traceability guarantee **T3**, the two properties the entire explainability story rests on. Per DP3 that is the highest-severity bug class in this product, not a copy defect.
**Changed:** the Next Action rationale is now **always** a deterministic template selected by dominant factor and filled from the live factor table — zero cost, zero latency, faithful by construction. The `rationale` column is removed. LLM-authored prose is confined to surfaces where context is fixed at generation time (daily brief, weekly review, insights, coach, feasibility explanation). Net effect is a **simplification**: the rationale pre-generation job leaves the critical path.
**Documents:** `AI_DECISION_ENGINE` §12.2, §14.2 · `DATABASE_DESIGN` §4.3 · `API_SPECIFICATION` §5.4, §5.5 · `PRODUCT_REQUIREMENTS` NFR-1.7 · `SYSTEM_ARCHITECTURE` §8 · `IMPLEMENTATION_ROADMAP` 2.9

### C7 · AI tool executor injection

**Was:** dependency rules forbade `packages/ai` from importing `packages/db`, but §5.6 defined read tools that fundamentally need data. The resolution was never stated.
**Why it mattered:** a developer would hit this on day one of Phase 2 and take the path of least resistance — adding the import and silently breaking the boundary that keeps the context builder the single auditable entry point for everything a model sees.
**Changed:** stated the contract explicitly. `packages/ai` declares tool **schemas** only; the service layer injects **executors** at agent construction. Agents never resolve data themselves. Enforced by an ESLint boundary rule added in Phase 0.
**Documents:** `SYSTEM_ARCHITECTURE` §5.6, §9, ADR-017

### C8 · Minor consent moved to M0

**Was:** date of birth captured at M1, with under-18 users merely "flagged."
**Why it mattered:** the stated launch segment (JEE/NEET aspirants) is **predominantly 16–18**, and India's DPDP Act 2023 requires verifiable parental consent under 18. The M0 build would have onboarded minors with no consent mechanism, for a segment where minors are the majority rather than an edge case.
**Changed:** DOB captured at signup and required before Goal creation; `is_minor` derived at capture so consent state cannot flip mid-session on a birthday; under-13 blocked; under-18 gated until guardian consent is recorded. Column stays nullable with a service gate rather than `NOT NULL` — the user row exists from OAuth callback, before onboarding can ask.
**Open:** what "verifiable" requires is a legal question, not an engineering one. Flagged in the readiness gate.
**Documents:** `PRODUCT_REQUIREMENTS` FR-1.6, §4 · `DATABASE_DESIGN` §4.1, §8 · `IMPLEMENTATION_ROADMAP` 0.4b, day 2

### Also applied — R4 · M0 engine subset frozen

Not a critical defect, but on the gate: `AI_DECISION_ENGINE` deepened Phase 1 after the 14-day plan was written. Added **§1.1 What ships at M0**, freezing the subset — fixed weights, plan-position urgency, depth-1 leverage, hysteresis as the only modifier, confidence traced but not surfaced. Every deferred item slots into an existing pipeline stage without rework.
**Documents:** `AI_DECISION_ENGINE` §1.1 · `IMPLEMENTATION_ROADMAP` 1.5, §6.1 day 5, risk register

---

## Consistency pass — result

Verified mechanically across all seven documents:

| Check                                                                                                                                      | Result                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `DEFAULT uuidv7` outside the review record                                                                                                 | 0                                                                  |
| `question_concepts` (old name)                                                                                                             | 0                                                                  |
| `priority_score` / `priority_factors` (old names)                                                                                          | 0                                                                  |
| `tasks.rationale` as a live specification                                                                                                  | 0                                                                  |
| `users_auth_method`                                                                                                                        | 0                                                                  |
| New entities referenced consistently (`canonical_concepts`, `concept_key`, `window_start`, `structural_factors`, `projection`, `is_minor`) | Present and aligned in every document that describes the behaviour |

Two stragglers found and fixed during the pass: the event matrix in `AI_DECISION_ENGINE` §14.2 still listed rationale pre-generation as an async consumer, and the feasibility `explanation` note in `API_SPECIFICATION` §5.2 needed to distinguish itself from the Next Action rationale (it is a stable-context surface, so LLM prose remains correct there).

**No remaining contradictions. No remaining critical issues.**

---

## Deferred — carried forward, not lost

These were accepted in the review and are **not** part of v1.0. They are scheduled, with gates.

| Gate                         | Items                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Before Phase 3**           | R1 batch capacity validated (split NFR-1.6 into initial vs. re-plan) · R2 AI cost model derived bottom-up · R5 verdict hysteresis · R6 trace on cache-miss only, written async · I1 decision timestamp as explicit trace input · I7 advisory lock on re-plan |
| **Before Public Beta (M-H)** | R3 shared-node curriculum decision · R9 auth hardening (lockout, enumeration) · I6 trace API · I8 per-channel delivery · I9 template versioning                                                                                                              |
| **Opportunistic**            | I2 server-side `originated_from` verification · I3 shared-artifact generation invariant · I4 weight normalisation · I5 health/usage endpoints · I10 atomic accept-and-start · N1–N5                                                                          |

---

## Change Request Process

The blueprint is frozen. It is no longer edited in place.

**A change request is required for:** a new table or column, a new endpoint or a breaking change to one, a change to the priority formula or its factors, a change to a stated invariant (I-1…I-16, T1…T4), a new external dependency, or anything that alters the deterministic/AI boundary.

**Not required for:** implementation detail within a specified contract, prompt text, UI copy, bug fixes that restore documented behaviour, or config-value tuning that follows §17's versioning rules.

**Format** — one entry appended to this file:

```markdown
### CR-00N · <title>

**Status:** proposed | accepted | rejected | superseded
**Raised by / date:**
**Problem:** what is actually broken or blocked — with evidence, not a hunch
**Proposed change:**
**Documents affected:**
**Invariants affected:** (or "none")
**Alternatives considered:**
**Decision + rationale:**
```

**Rules**

1. Nothing merges against an unaccepted CR.
2. A CR that touches an invariant needs a second reviewer.
3. Rejected CRs stay in the file. Knowing what was considered and declined is as valuable as knowing what was built.
4. Accepted CRs bump the affected documents' minor version and are listed under a new baseline heading here.
5. A CR is not a design document. If it needs more than a page, the change is large enough to warrant a real review like the one that produced v1.0.

---

## Change Requests

### DR-001 · Session layer stays first-party (ADR-007 amended)

**Status:** accepted · **Raised:** Phase 0 implementation · **Type:** decision, not a design change

**Problem.** Roadmap 0.4 and ADR-007 named **Better Auth**. Implementation found three incompatibilities with the frozen schema, one of which is a security property rather than a naming difference: `auth_sessions.token_hash` (_"never store the raw token"_) versus Better Auth's `session.token`, which holds the token itself. Also `email_verified_at timestamptz` versus its boolean `emailVerified`, and a required `verification` table the schema does not define.

**Decision.** Keep the first-party session layer. **The frozen blueprint takes precedence over any third-party library.** What ADR-007 actually decided — database-backed, immediately revocable sessions with PII in our own Postgres — is unchanged and fully realised. A custom Better Auth adapter may be evaluated later if it provides clear benefit without compromising the architecture; that would be a new change request.

**Documents updated:** `SYSTEM_ARCHITECTURE` §2 stack table, §7.4 (new), ADR-007 status.

**Verified at runtime:** the raw cookie value appears nowhere in `auth_sessions`, not even as a substring; passwords are Argon2id; revocation takes effect on the next request.

---

### CR-001 · Phase 0 implementation reconciliation

**Status:** accepted · **Raised:** Phase 0 completion report · **Type:** documentation reconciliation

Four items where implementation and blueprint disagreed. None changes a table, an endpoint, or an invariant; all are recorded rather than left as undocumented deviations.

| Item                       | Was                                                                 | Now                                                                                  | Why                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-3** seed scope         | Roadmap 0.10: user + goal + 40-concept curriculum + 30 days history | Phase 0 seeds the harness and identity fixtures; the full fixture moves to 1.1       | Roadmap 0.3 limits the Phase 0 migration to identity tables. A seed cannot populate tables that do not exist — the two roadmap items contradicted each other.                                                          |
| **D-4** client generation  | `openapi.v1.json → openapi-typescript → typed client`               | One endpoint registry projects to **both** the OpenAPI document and the typed client | The published spec still serves external and mobile consumers — the reason OpenAPI beat tRPC. Typing the in-repo client from the schemas directly is what AP2 actually asks for, with no lossy JSON-Schema round trip. |
| **D-5** onboarding default | `'{"step":"dob",…}'`                                                | `'{"step":"date_of_birth",…}'`                                                       | The step enum introduced in Phase 0's contracts uses `date_of_birth`. The document was inconsistent with itself.                                                                                                       |
| **Error codes**            | §6.3 taxonomy                                                       | Added `UNDER_MINIMUM_AGE`, `DATE_OF_BIRTH_REQUIRED`, `FORBIDDEN`                     | Required by FR-1.6 and by the CSRF origin check. Additive to a response enum, which §7.2 classifies as non-breaking.                                                                                                   |
| **Boundaries**             | §9 silent on `ui` and `observability`                               | Both declared leaves; an undeclared workspace is now a hard error                    | The blueprint defined rules for five of seven workspaces. Leaving two undeclared invites the first violation to go unnoticed.                                                                                          |

**Documents updated:** `IMPLEMENTATION_ROADMAP` 0.10 · `API_SPECIFICATION` §6.3, §7.4 · `DATABASE_DESIGN` §4.1 · `SYSTEM_ARCHITECTURE` §9.

---

### CR-002 · Move `CREATE EXTENSION vector` to the migration that needs it

**Status:** 🟡 **proposed — not applied** · **Raised:** Phase 0 runtime verification · **Type:** migration sequencing

**Problem — found empirically, not theorised.** Migration `0000_extensions.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` before any table. Verifying against a real PostgreSQL 18.4 showed:

```
available: citext@1.8, pgcrypto@1.4        ← vector is absent
ERROR: extension "vector" is not available
HINT:  The extension must first be installed on the system where PostgreSQL is running.
```

`citext` ships with PostgreSQL. **`vector` does not** — pgvector is a third-party extension requiring a separate install, a specific Docker image, or a managed provider that bundles it.

So migration 0000 requires pgvector in **every** environment from day one — local, CI, preview, production — for `memory_chunks.embedding`, a table DATABASE_DESIGN §4.6 does not introduce until **Phase 3**. Any contributor without Docker or a pgvector-capable Postgres cannot run migration 0001 at all.

**Proposed change.** Keep `citext` and `set_updated_at()` in 0000. Move `CREATE EXTENSION vector` into the migration that creates `memory_chunks`. The principle generalises: **an extension is installed by the migration that first needs it**, so a Phase 0 environment never carries a Phase 3 dependency.

**Documents affected:** `DATABASE_DESIGN` §1.1 · `packages/db/migrations/0000_extensions.sql` · the CI Postgres image may then be stock `postgres:16` until Phase 3.

**Invariants affected:** none.

**Alternatives considered.** (a) Require pgvector everywhere from day one — correct today, but taxes every environment for months, and it is what blocked local verification. (b) Make the statement conditional on a probe — hides a real dependency behind a silent branch. (c) Status quo plus documentation — the failure would still be a hard stop, just a documented one.

**Decision: accepted and applied.** `CREATE EXTENSION vector` was removed from `0000_extensions.sql` and moved to the migration that creates `memory_chunks` (Phase 3). The general rule is now **D11**:

> **An extension is installed by the migration that first requires it, never by an earlier bootstrap migration.**

**Documents updated:** `DATABASE_DESIGN` header, D11 (new), §1.1 (rewritten), §4.6, §9 · `SYSTEM_ARCHITECTURE` §2 stack table, §3 infrastructure diagram, ADR-004 · `.github/workflows/ci.yml` (Postgres image `pgvector/pgvector:pg16` → `postgres:16`) · `.env.example` · `packages/db/migrations/0000_extensions.sql`.

**Enforced, not merely documented.** Three tests in `packages/db` now hold the rule:

1. The bootstrap migration must not install `vector`.
2. Any migration using a vector type or index must be preceded — in the same file or an earlier one — by `CREATE EXTENSION vector`, with the extension above the first dependent object.
3. Every migration before the first one requiring a third-party extension must need only bundled contrib. A deliberate tripwire fires when that stops being true, with a message naming the migration and listing what to change (CI image, `.env.example`, the expectation itself).

Guards were validated against three simulated Phase 3 migrations: uses-without-installing → caught; installs-below-the-table → caught; installs-above-the-table → passes.

**Verified at runtime.** On a PostgreSQL 18.4 with pgvector confirmed **absent**, a freshly created database ran the complete migration chain with no workaround, twice (idempotent), then seeded twice, then passed all 71 Phase 0 runtime checks.

---

### CR-003 · Phase 1 implementation reconciliation

**Status:** accepted · **Raised:** Phase 1 (The Spine) completion report · **Type:** schema addition + documentation reconciliation

Mirrors CR-001's role for Phase 0: records where the Phase 1 implementation and the blueprint disagreed, so nothing is left as a silent deviation. One item required a schema change; the rest are deferred, not contradicted.

**Schema change — `mastery_states` gains two columns.**

| Was                                                                                                                                                            | Now                                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mastery_states` per DATABASE_DESIGN §4.6: `mastery, confidence, evidence_count, total_minutes, accuracy_rate, first_studied_at, last_evidence_at, updated_at` | Adds `distinct_sources int NOT NULL DEFAULT 0` and `outcome_variance numeric(4,3) NOT NULL DEFAULT 0` | AI_DECISION_ENGINE §5.3 specifies belief confidence κ as a function of four inputs — volume, **diversity** (distinct sources/item types), **consistency** (outcome variance), and recency. The frozen table carried no column for the diversity or consistency signal, so `core/mastery`'s `updateBeliefConfidence` — required by the same spec section — had nothing to read on a cold load. Additive only: both columns default to `0`, no existing column changed shape, no invariant affected. |

**Documents updated:** `DATABASE_DESIGN` §4.6 (table DDL), header (Version 1.2 → 1.3).

**Invariants affected:** none. **Breaking:** no.

**Deferred, not contradicted** — accepted as out of Phase 1's scope, each with a named gate:

| Item                                                                                           | What                                                                                                                                                                                                 | Gate                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Partitioning of `study_sessions`, `evidence_events`, `learning_events`, `decision_traces` (D7) | Shipped as ordinary tables in Phase 1; DATABASE_DESIGN §10 itself stages partitioning at the "<10k DAU" scale, not as a Phase 1 requirement                                                          | Before production traffic approaches that scale                                                                       |
| Redis / Next Action caching (API_SPECIFICATION §5.5)                                           | Next Action computed fresh every request; `cacheHit` always `false`, honestly reported rather than faked                                                                                             | When Redis is added to the dependency set (no engine change required — same function signature)                       |
| Async plan generation via Inngest (roadmap 1.11)                                               | `POST /goals` and `POST /goals/{id}/plans/regenerate` generate synchronously; the template path's `201` is blueprint-compliant, but the documented `planJobId` field is not returned                 | When curriculum/plan generation cost grows enough to need it — a route-handler change, not a `core/scheduling` change |
| Curriculum Architect AI agent (roadmap 1.9)                                                    | Goal creation accepts a curated `templateSlug` only; `curricula.source` is always `'template'`. `'ai_generated'` remains valid and `concept_key` resolution is already enforced on the template path | Phase 2, as originally scheduled — Phase 1's brief explicitly scoped to the deterministic engine only                 |

Full detail, including the runtime-verified Golden Path transcript this CR is drawn from: [PHASE_1_REPORT.md](PHASE_1_REPORT.md).

---

### CR-004 · Phase 2 implementation reconciliation

**Status:** accepted · **Raised:** Phase 2 (Intelligence Layer) completion · **Type:** schema addition + dependency + documentation reconciliation

**1. `ModelProvider` seam between agents and the vendor SDK · additive, no document changed**

SYSTEM_ARCHITECTURE §5 specifies the AI SDK as the orchestration layer but does not say how agents reach it. Phase 2 introduces a `ModelProvider` interface in `packages/ai`; the Anthropic/AI-SDK implementation and a recorded-fixture implementation both satisfy it.

This is not a deviation — it is what three existing requirements jointly demand. **A6** requires a deterministic fallback for every AI call. **§7.2** forbids live model calls in CI and mandates recorded fixtures. **ADR-012** anticipates provider failover. None is achievable if agents import a vendor SDK directly. The seam is the mechanism, and it is why every Phase 2 agent is testable with no API key.

**2. Vercel AI SDK pinned to v5, not the current v7**

§2.1 names "Vercel AI SDK v5". pnpm resolves `ai@latest` to v7. Pinned to `ai@^5` / `@ai-sdk/anthropic@^2` to honour the frozen text; v7's advantages are real but the blueprint outranks the newer library, consistent with **DR-001**. Because the SDK sits behind `ModelProvider`, upgrading later is a one-file change and does not need to touch an agent.

**3. `mastery_states` reads gained `distinct_sources` / `outcome_variance` consumers**

No schema change — CR-003 added the columns. Phase 2 is the first code to _read_ them, via `updateBeliefConfidence`. Recorded here so the CR-003 rationale is traceable to a consumer.

**4. Deferred tables, following the established phase-scoping precedent**

| Table                                                                     | Deferred to | Why                                                                                                     |
| ------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `directives` + `directive_type` / `directive_status` / `delivery_channel` | Phase 4     | Proactivity is Phase 4; the detectors and nudge policy that write these do not exist                    |
| `audit_log`                                                               | Phase 4     | Serves the admin console, which ships with it                                                           |
| `memory_chunks` + `vector` extension                                      | Phase 3     | The only pgvector-dependent object in the schema (D11); semantic retrieval is not a Phase 2 deliverable |

`packages/ai/src/context` accordingly returns `retrieved: []` unconditionally, and the field is documented as Phase 3.

**5. Three of six agents implemented**

Phase 2 ships **Curriculum Architect** (inherited 1.9), **Coach** (2.6), and **Content Generator** (2.7). The **Planner Advisor**, **Diagnostician**, and **Reflector** are Phase 3 per the roadmap; their names are already fixed in the `AgentName` union and their routing tiers in §5.3's table, so adding them changes no interface.

**6. Defect found and fixed during Phase 2 runtime verification — belief confidence with a single observation**

Not a blueprint change, but a correctness note worth recording. AI_DECISION_ENGINE §5.3 derives κ partly from _consistency_ — "variance across recent outcomes". With exactly one observation there is no variance, so the term scores as **perfectly consistent** and inflates κ (observed: 0.525 after one answer, above the 0.35 provisional threshold).

Phase 2's weak-concept drill-down therefore checks evidence _count_ directly rather than trusting κ alone (`PROVISIONAL_EVIDENCE_COUNT = 3`). The underlying κ behaviour in `core/mastery` is **unchanged** — altering a frozen Phase 1 formula mid-phase would be exactly the kind of unilateral change the CR process exists to prevent. **Proposed for Phase 3:** damp the consistency input when `evidenceCount < 2`, since undefined variance is not zero variance. Filed against open question **Q7** ("minimum evidence before ρ and π depart from 1.0"), which is the same class of problem.

**Documents updated:** none required. **Invariants affected:** none. **Breaking:** no.

Full detail: [PHASE_2_REPORT.md](PHASE_2_REPORT.md).

---

### CR-005 · Google Gemini as a first-class provider

**Status:** accepted · **Raised:** post-Phase-2, on receipt of a Gemini API key · **Type:** new external dependency

**Problem.** Phase 2 shipped three agents that had never executed against a live model, because no Anthropic key was available. That is the largest risk the project carries (PHASE_2_HANDOFF §6.1). A Gemini key became available.

**Why this is not a redesign.** SYSTEM_ARCHITECTURE §2.1 already names the outcome: _"OpenAI / Gemini kept behind the provider interface as failover"_, and ADR-012 anticipates provider failover. Phase 2's `ModelProvider` seam (CR-004 §1) exists precisely for this. Adding Gemini is the seam being used as designed, not bent.

**Change.**

| Item           | Detail                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New dependency | `@ai-sdk/google@^2.0` — the Vercel AI SDK's Google provider, matching the `ai@^5` major already pinned for Anthropic                                             |
| New file       | `packages/ai/src/provider/google.ts` — mirrors `anthropic.ts` structure so the two diff cleanly                                                                  |
| New file       | `packages/ai/src/provider/select.ts` — resolves the provider from configuration                                                                                  |
| Config         | `AI_PROVIDER` (`anthropic` \| `google` \| `fixture`), `GOOGLE_API_KEY`, optional `GEMINI_MODEL`                                                                  |
| Changed        | `apps/web/src/modules/ai/provider.ts` now delegates to `resolveProvider`; `assertCoachAvailable` asks the composition root instead of reading a vendor's env var |

**Zero application-level change.** No agent, service, route, contract, or UI file was modified to support a second vendor. That was the requirement, and it is the property the seam bought.

**Selection semantics.** An explicit `AI_PROVIDER` always wins, and a named provider without its key is a **hard error** rather than a silent fallback — a deployment that asks for Gemini and quietly gets Anthropic is a worse outcome than a startup failure, because nobody finds out. With no explicit choice, resolution infers from whichever key is present, preferring Anthropic as §2.1's primary. With no key at all, fixtures.

**Model mapping.** The router speaks in tiers and Claude ids (§5.3's table is written in Claude names). Teaching it about vendors would put model selection in two places and break "routing is a policy, in one place", so the **provider translates at its own edge**: `deep → gemini-pro-latest`, `balanced → gemini-flash-latest`, `cheap → gemini-flash-lite-latest`.

The `-latest` aliases are deliberate. Google retires dated model ids for new keys — `gemini-2.5-flash` returned _"no longer available to new users"_ during validation, so a pinned id that works at write time fails months later. `GEMINI_MODEL` pins one explicitly where reproducibility matters more than currency.

**On "the official Google Generative AI SDK".** The request named that package; `@ai-sdk/google` was used instead. It calls the same Google API, but goes through the AI SDK abstraction the architecture already standardises on (§2.1), which means structured output, streaming, and tool-calling come from the same `generateObject`/`streamText` primitives as Anthropic. Using `@google/genai` directly would have meant hand-writing schema coercion, stream adaptation, and tool-schema conversion — more code, more divergence between providers, and no benefit. Flagged here rather than silently substituted; say the word if the direct SDK is required.

**Invariants affected:** none. DP1 still holds — Gemini decides nothing; it decomposes, generates, and converses, and every number remains `packages/core`'s.

**Documents updated:** `.env.example`. §2.1's stack table already anticipated this and needs no edit.

**Validated live.** See [AI_VALIDATION_REPORT.md](AI_VALIDATION_REPORT.md).

### CR-006 · Phase 3 resequenced to frontend completion

**Status:** accepted · **Raised:** Phase 3 kickoff · **Type:** roadmap resequencing

**Problem.** IMPLEMENTATION_ROADMAP §3 defines Phase 3 as **Adaptation** — nightly re-plan, drift detection, curriculum editing, the Diagnostician and Reflector agents, pgvector. The product owner instead directed Phase 3 at **completing the user-facing application** to reach a Launch Candidate.

**Why this is defensible rather than drift.** After Phase 2 the backend exposed 33 endpoints and the frontend had **two** pages. A learner could not create a goal at all — there was no UI for it — so no amount of Adaptation work would have produced something a person could use. The roadmap's own R4 says _"ship the loop, then the intelligence"_, and §6.2 says _"cut features, never cut the loop."_ The loop existed in the API and not in the product. Closing that gap first is the roadmap's own priority order, even though it is not the roadmap's own phase order.

**Change.** Phase 3 delivers the frontend, the endpoints the frontend needed that were specified but never built, and production UX (responsive, accessible, four states on every async surface). Roadmap §3's Adaptation scope moves to Phase 4.

**Endpoints added — specified since Phase 0, never implemented:**

| Endpoint                              | Spec | Why it was blocking                                                                                                                                                                         |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /me/availability`            | §5.1 | The scheduler cannot plan without capacity (E-6). It could only be seeded.                                                                                                                  |
| `GET/PATCH /me/preferences`           | §5.1 | Settings had nothing to read or write                                                                                                                                                       |
| `GET /sessions`, `GET /sessions/{id}` | §5.6 | The write side shipped in Phase 1; there was no read side                                                                                                                                   |
| `POST /sessions/{id}/abandon`         | §5.6 | Service existed, no route                                                                                                                                                                   |
| `GET /tasks`, `PATCH /tasks/{id}`     | §5.4 | The plan view had no data source                                                                                                                                                            |
| `GET /tasks/{id}/study`               | —    | **New.** Composes task + concepts + mastery + active-session into one request, so the most latency-sensitive screen does not make four round trips. Additive; composes existing reads only. |

**Invariants affected:** none. No engine, agent, or AI-architecture change. **Breaking:** no.

**Documents updated:** `.env.example` unchanged; `IMPLEMENTATION_ROADMAP` §3's phase ordering is superseded by this entry rather than edited, preserving the audit trail.

Full detail: [PHASE_3_REPORT.md](PHASE_3_REPORT.md).

---

---

## CR-007 — Launch-readiness surfaces: health, product telemetry, feedback

**Status:** accepted · **Raised:** Launch Readiness phase · **Type:** additive

**Problem.** The Launch Readiness objectives include error monitoring, analytics, and feedback collection. None had anywhere to go:

- No health endpoint, so a load balancer could not tell a running process from a working one.
- No client-side error reporting. Every browser exception — a hydration mismatch, a failed fetch, a component throwing into an error boundary — was invisible.
- No product-event storage, so the four questions a launch has to answer (do learners finish onboarding, does the loop close, do they return, is the Coach used) were unanswerable.
- No feedback channel, though the roadmap's private-beta plan (§ release plan) calls for one with daily triage.

**Change.** Migration `0005` adds two append-only tables, `product_events` and `feedback`. Nothing existing is altered; neither table is read on any request path, so neither can affect the learning loop. Plus: `GET /api/health`, `POST|GET /api/v1/feedback`, boot-time environment validation, a nonce-based Content-Security-Policy, HSTS, and browser-side Sentry.

**Why not PostHog.** SYSTEM_ARCHITECTURE §2 names PostHog for product analytics and it remains the intended destination. It is not what ships at launch. PostHog is a third-party browser script that sets identifiers, and FRIDAY's learners are mostly 16–18, where India's DPDP Act requires verifiable guardian consent (FR-1.6). Shipping client-side tracking before the consent surface that would govern it exists is the wrong order. Events are therefore recorded **server-side** from actions the learner has already taken, carry no device or browser identity, and can be exported later — the seam is `recordEvent`, not the storage.

**Endpoints added:**

| Endpoint                | Auth | Purpose                                                                                                                                                                                  |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`       | no   | Liveness plus a real database round trip. 503 when a dependency is down. Outside `/api/v1` deliberately: that prefix is the versioned learner contract, this is an operational endpoint. |
| `POST /api/v1/feedback` | yes  | The private beta's feedback channel                                                                                                                                                      |
| `GET /api/v1/feedback`  | yes  | A learner's own submissions                                                                                                                                                              |

**Invariants affected:** none. No engine, agent, or AI-architecture change. **Breaking:** no.

**Documents updated:** `.env.example` gains `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_ENVIRONMENT`, `GIT_COMMIT_SHA`. `DEPLOYMENT.md` added.

Full detail: [LAUNCH_READINESS_REPORT.md](LAUNCH_READINESS_REPORT.md).

---

## CR-008 — Authorization hoisted out of the SSE generator

**Status:** accepted · **Raised:** Launch Readiness verification · **Type:** defect fix

**Problem.** `POST /coach/threads/{id}/messages` answered **200** when one learner posted into another learner's thread. The ownership check lives in `sendMessage`, which is an async generator; a generator body does not run until its first `next()`, which is after the status line and headers have been sent. The authorization failure was therefore delivered as an error _event_ inside a successful response.

Nothing leaked and nothing was written — `findThread` is scoped by user id, so the write never happened. But a status code is not cosmetic: rate limiters, WAFs, and alerting are keyed on 4xx, and every one of them saw those attempts succeed.

**This is the same defect shape as Phase 2's.** That one moved `assertCoachAvailable()` out of the generator so an unconfigured provider produced an honest 503. The availability check was hoisted; the authorization check was left behind. Found only because a live provider was configured — with the coach unavailable, the 503 masks it entirely.

**Change.** `assertThreadOwned(user, threadId)` runs in the handler's async body alongside `assertCoachAvailable()`, before the stream opens. Returns 404, not 403: "you may not read this" still confirms it exists.

**Invariants affected:** none. **Breaking:** no — the response for a legitimate caller is unchanged.

---

## CR-009 — A superseded plan's work is retired with it

**Status:** accepted · **Raised:** Phase 4 adaptive verification · **Type:** defect fix

**Problem.** Re-planning added work instead of replacing it. `supersede` moved the plan row's status to `superseded` and stopped there, leaving that plan's tasks at `pending`. Every reader of outstanding work — `listPendingTasks` — filters on `status` and never on plan, so a learner saw the union of every plan version ever generated.

Collapsing availability from a full week to a single hour made this visible in the worst possible direction: the workload **grew**, from 465 minutes to 555.

| Plan | Status     | Pending tasks | Minutes |
| ---- | ---------- | ------------- | ------- |
| v1   | superseded | 10            | 465     |
| v2   | active     | 2             | 90      |

The scheduler was never at fault. It read the new availability correctly and produced a properly sized 90-minute plan; that plan was then stacked on top of the 465-minute one it was meant to replace. The defect compounded — every re-plan left another version's work behind — which is precisely the backlog this product exists to prevent.

The blast radius was wider than the plan surfaces. `next-action.service` also reads `listPendingTasks`, so FRIDAY could direct a learner into a task belonging to a plan it had already abandoned.

**Change.** `cancelPendingTasksForPlan(userId, planId)` retires the superseded plan's outstanding tasks to `cancelled`, inside the same transaction that supersedes the plan and creates its replacement — so no reader can observe both plans' tasks as pending at once.

Only `pending` is retired. `in_progress` is deliberately excluded: completing a session is itself a re-plan trigger, so a re-plan can fire while a learner is mid-session, and cancelling that task underneath them would destroy work in progress. `completed`, `skipped` and `rescheduled` are history and are never touched — they are the evidence the engine learns from.

**Invariants affected:** none — `cancelled` already existed in `task_status`, so no migration. **Breaking:** no.

**Verified by:** `availability-replan.spec.ts` end to end (the file went from one failure and three tests unreachable to four passing), and `planning-repository.test.ts` for the filter itself, including the in-progress case a browser test cannot easily stage.

---

## CR-010 — The materiality gate could not fire, and missed work was written before it decided

**Status:** accepted · **Raised:** Phase 4 adaptive verification · **Type:** defect fix

Three defects found by building a database-backed proof of missed-work redistribution (`missed-work.integration.test.ts`). The suite failed **7 of 13 properties** on its first run against real rows.

### CR-010a · Drift was computed across two different id spaces

`regeneratePlan` built the outgoing plan's task snapshots as `{ conceptId: t.id }` — the **task row's** uuid — while the candidate side used real **concept** ids. The two sets were disjoint by construction, so `computeDrift`'s first two components (task-date change, next-7-day concept churn) both returned a flat `1.0` regardless of what the scheduler produced.

Drift could therefore never fall below **0.5** against a materiality threshold of **0.15**. Two byte-identical plans scored 0.5. §10.3's "discard a candidate that barely differs" never ran once, and the only thing actually limiting automatic re-plans was the churn budget.

The number was also logged and returned to callers as though it meant something, which is the worse half: a fictional dial reported as a real one.

**Change.** `loadPlanTaskSnapshots` joins `task_concepts` so both sides are keyed by concept. Observed drift on the same scenario moved from a pinned `0.5` to `0.325`.

### CR-010b · Missed work was retired before the gate decided

The §10.4 marking ran at the top of `regeneratePlan`, before the materiality gate. When the gate then declined to commit — immaterial diff, or churn budget spent — the outgoing tasks had already been marked and **no new plan replaced them**, so the work vanished from the learner's queue entirely.

CR-010a is what made this reachable: while drift was pinned above threshold, the gate never declined, so the bug was latent. Fixing the gate would have exposed it.

**Change.** `regeneratePlan` now only _identifies_ missed work; the write happens inside `persistPlan`'s transaction, alongside the supersede.

### CR-010c · A concept with work in flight was scheduled twice

CR-009 correctly preserves an `in_progress` task across a re-plan. The scheduler had no way to know that, so it queued a **second** task for the same concept — a learner mid-session on Projectile Motion came back to find it listed twice, once in progress and once fresh.

**Change.** `generatePlan` accepts `inFlightConceptIds` and excludes them from the eligible queue. They stay _in the graph_, so their dependents' readiness still gates correctly — filtering them out at the caller would have silently unblocked everything downstream.

### Retirement semantics refined

`retireSupersededTasks` splits CR-009's single `cancelled` outcome by cause, because the difference belongs to the learner rather than to bookkeeping:

| Outcome       | Meaning                                        |
| ------------- | ---------------------------------------------- |
| `rescheduled` | was due, not done — the history records a miss |
| `cancelled`   | was not due yet — nothing was missed           |

`in_progress`, `completed` and `skipped` remain untouched, per CR-009.

**Invariants affected:** none. **Breaking:** no.

**Verified by:** `missed-work.integration.test.ts` — 13 properties against real persisted rows, comparing whole task ledgers before and after, including no-compounding across four consecutive regenerations and the dashboard recommendation belonging to the active plan. Controlled proofs for exam-weight ordering and in-flight exclusion added to `core/scheduling`'s suite; exam-weight prioritisation previously had **no test at all**.

**Measured before/after** (one new-day re-plan, same scenario):

|              | live tasks | live minutes | live plan versions                   |
| ------------ | ---------- | ------------ | ------------------------------------ |
| before fixes | 18         | 750          | v1 + v2                              |
| after fixes  | 10         | 420          | v2 (+ one preserved in-progress row) |

---

## CR-011 — Feasibility believed one session finished a concept

**Found by:** the closed-loop proof, on its first run against real persisted data.

`toFeasibilityConcepts` keyed remaining work off `reps > 0`, so a single session of any quality flipped a concept's remaining learn time from its full estimate straight to zero. Measured: a learner studied Newton's Laws for 45 minutes, came out with mastery `0.098` — started it, understood almost none of it — and required minutes fell 470 → 430.

The scheduler, which reads mastery properly, disagreed in the same breath and kept the full 50-minute `learn` task on the plan. The two halves of the engine described different worlds, and the half shown to the learner — verdict, slack, projected completion date — was the optimistic one.

**Change.** Both terms scale by mastery, so the total is monotonically decreasing:

| mastery | learn | review | total |
| ------- | ----- | ------ | ----- |
| 0.0     | 50    | 0      | 50    |
| 0.1     | 45    | 1      | 46    |
| 1.0     | 0     | 10     | 10    |

**Invariants affected:** none. **Breaking:** no.

---

## CR-012 — A single missed day could strand a task forever

**Found by:** the 60-minutes-a-day missed-day scenario.

Missing exactly one day produces a candidate that is the same plan shifted a day: drift `0.025` against a `0.15` threshold. The new-day trigger fired, computed a correct and tiny drift, and declined to commit. Nothing committed, so nothing was retired, and the learner opened the app to a `pending` task dated yesterday — the overdue backlog §10.4 promises cannot exist.

The gate asks "is the candidate different enough to be worth disturbing the learner?" That is the right question about a candidate and the wrong one when the _current_ plan is the problem.

**Change.** `missedTaskCount > 0` makes a re-plan material regardless of drift, and exempts it from the churn budget. The exemption is self-extinguishing: the commit it permits retires the missed work, after which it stops applying. Without the budget exemption the failure would only move — the learner would still see yesterday's task, now because they had also finished a session the previous afternoon.

**Invariants affected:** none. **Breaking:** no.

---

## CR-013 — An in-flight prerequisite emptied the entire plan

**Found by:** the availability-change scenario.

CR-010c excluded in-flight concepts from the eligible queue. That stopped the duplicate task and also erased them from the graph's notion of what was covered, so every dependent failed its prerequisite check. The seeded curriculum hangs almost entirely off one root, so a learner who started their first task and then edited their availability got back a plan with **no tasks in it at all**.

**Change.** In-flight concepts are seeded into `scheduledConceptIds` instead. Every candidate filter already skips that set, so there is still no second task; `isPlaceable`/`prerequisiteInputs` treat membership as handled, so dependents follow work the learner is actively doing. They also stop being reported as unscheduled, because they are not dropped — they are in progress.

The core spec asserting that dependents stay blocked encoded the bug and now asserts the opposite.

**Invariants affected:** none. **Breaking:** no.

---

## CR-014 — The churn budget silently discarded availability increases

**Found by:** the availability-change scenario.

Cutting availability from two hours a day to thirty minutes committed. Raising it back to three hours minutes later returned `churn_budget_exceeded`. The plan went on describing a thirty-minute week the learner had already corrected, and the freed-up time was thrown away.

**Change.** `constraint` is exempt from the churn budget, on different grounds from CR-012's exemption. Availability is not a preference about the plan, it is a fact about the learner's life, and a plan that contradicts it is not stale but incorrect. The materiality gate still stops a settings form that posts on every blur: re-saving identical rules scores drift `0` and does not commit.

**Invariants affected:** none. **Breaking:** no.

---

## CR-015 — Goals were write-once, and drift could not see a horizon change

**Found by:** the goal-change audit.

Goals had `POST` and `GET`, no `PATCH`, and no `update` on the repository. The exam date sets the horizon every projection, verdict and priority is computed against, and it was the one input the learner could not correct.

**Change.** `PATCH /v1/goals/:goalId` accepts `targetDate`, `targetWeeklyMinutes`, `title`, `description` — pure planner inputs that cannot orphan evidence, because mastery, memory and sessions are keyed to concepts and the concepts do not move. The **curriculum stays immutable**: swapping it would orphan every row earned against concepts that no longer belong to the goal, and a learner changing _what_ they study is starting something new, which `POST /v1/goals` already expresses without destroying the old goal's history.

The integration proof then found the edit changed nothing. Pulling the exam in from 120 days to 21 scored drift `0.0425` and was discarded — correctly, as far as it could see: the fourteen-day task list does not change when the far horizon shrinks but the work still fits. But a plan row also stores the verdict, the slack and the projected completion date, so the committed plan reported 7,200 available minutes against the 1,260 the learner actually had.

`computeDrift` was measuring the demand side of a feasibility calculation and not the supply side. Capacity is now a fifth equally-weighted signal.

|            | version | target     | required | available |
| ---------- | ------- | ---------- | -------- | --------- |
| before     | v1      | 2026-12-12 | 470m     | 7200m     |
| pulled in  | v2      | 2026-09-04 | 466m     | 1260m     |
| pushed out | v3      | 2027-02-10 | 466m     | 10800m    |
| renamed    | v3      | unchanged  | —        | —         |

**Invariants affected:** none. **Breaking:** no — `DriftInput` gains two required fields, internal to the planner.

---

## CR-016 — Two concurrency races at the write boundary

**Found by:** the adversarial data-integrity pass (25 attacks).

**Concurrent session completion.** `findSession` is an ordinary `SELECT`, so two concurrent completions both read `status = 'active'`, both passed the guard, and both wrote: two evidence events and two mastery updates from a single sitting. A double-tapped Finish button was enough to inflate the learner's own mastery. `findSessionForUpdate` takes a row lock, so the loser blocks until the winner commits, re-reads `completed`, and is rejected by the guard that was already there. `abandonSession` had the same shape and is now a single locked transaction.

**Concurrent availability saves.** `replaceAll` is a delete and an insert with nothing serialising them, so two saves could interleave and leave a _blended_ rule set — some days at the old capacity and some at the new. It now locks the owning `users` row, and the caller supplies the transaction.

The plan briefly lagging the winning availability is left as **safe degradation** and documented as such: each save writes then re-plans, so with two in flight the last plan to commit may have read the earlier capacity. The rules are the source of truth, nothing is lost, and the next re-plan reconciles.

**Invariants affected:** none. **Breaking:** no.

---

## CR-017 — The panel claimed a session size the planner did not deliver

**Found by:** the adaptive claim audit.

The Live Intelligence Panel renders "Held your sessions at about 15 minutes" from `profile.targetSessionMinutes`, and directly beneath it renders the recommended task's duration. Measured: the dial read 15 and the recommendation was 50 minutes — and passing 120 instead of 15 produced the identical recommendation.

The wire was never missing. The gap is what happens when _nothing_ fits: `core/priority` deliberately returns the top candidate whole rather than substituting a lesser one (§7.2 step 3). That is the right call for the ranking — every concept in the seeded curriculum is 40–60 minutes, and offering a worse topic because it is shorter would be worse advice — and the wrong thing to narrate as "I sized your session".

**Change.** The claim is dropped rather than reworded, per the standing rule that an unenforced claim is removed rather than dressed up. FRIDAY did adapt the budget and the ranking really was fitted against it; it simply has nothing short enough to offer today. Restoring the claim requires the planner to **size tasks to the session**, which is Phase 4 work.

**Invariants affected:** none. **Breaking:** no.

---

## CR-018 — `format:check` was reporting environmental noise as a formatting backlog

`pnpm format:check` reported 43 files. Classifying each against its own Prettier output showed 42 were byte-identical apart from carriage returns, and exactly one — README.md — had a genuine difference. The cause is `core.autocrlf=true` with no `.gitattributes`.

Reformatting the 42 would have produced an enormous diff and fixed nothing durably, since the next Windows checkout reintroduces every CRLF. A check that reports noise and real problems in one undifferentiated list is a check nobody reads — and the one file that needed attention had been sitting inside it.

**Change.** `.gitattributes` declares `* text=auto eol=lf`, with binaries excluded. `git add --renormalize .` confirmed the whole-repository staged diff was README.md's two lines and nothing else.

**Invariants affected:** none. **Breaking:** no.

---

---

## Baseline History

| Version | Date   | Summary                                                                                                                                                                                                                               |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0** | Week 0 | Initial blueprint (7 documents) + design review + 8 critical fixes. **Frozen.**                                                                                                                                                       |
| **1.1** | Week 1 | Phase 0 complete and runtime-verified. DR-001 (ADR-007 amended) and CR-001 applied. CR-002 open. **Superseded.**                                                                                                                      |
| **1.2** | Week 1 | CR-002 applied: extensions travel with the schema that needs them (D11). Verified on a clean PostgreSQL without pgvector. **Superseded.**                                                                                             |
| **1.3** | Week 2 | Phase 1 (The Spine) — the deterministic domain engine — complete and runtime-verified. CR-003 applied (`mastery_states` diversity/consistency columns). **Superseded.**                                                               |
| **1.4** | Week 3 | Phase 2 (Intelligence Layer) — AI subsystem, Coach, practice loop, progress and weak-concept surfaces — complete and runtime-verified. CR-004 applied. Gemini added as a second provider and live-validated (CR-005). **Superseded.** |
| **1.5** | Week 4 | Phase 3 — the user-facing application. Frontend completed, every backend capability connected to UI, production UX. CR-006 applied. **Superseded.**                                                                                   |
| **1.6** | Week 5 | Launch Readiness — browser E2E, accessibility, responsive, live streaming, CI, deployment config, monitoring, analytics, feedback, performance, security. CR-007 and CR-008 applied. **Frozen — Launch Candidate baseline.**          |
