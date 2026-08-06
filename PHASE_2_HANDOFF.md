# Phase 2 → Phase 3 Handoff

> **Baseline:** Blueprint v1.4 · **FROZEN** · git tag `phase-2-baseline`
> **Full detail:** [PHASE_2_REPORT.md](PHASE_2_REPORT.md) · [ARCHITECTURE_CHANGELOG.md](ARCHITECTURE_CHANGELOG.md) (CR-004)

---

## 1. What was implemented

All of roadmap 2.1–2.12 plus the inherited 1.9.

- **AI subsystem** (`packages/ai`, first population): `ModelProvider` seam, Anthropic + fixture providers, model router with budget degradation, Learner Context Packet builder, seven read-tool declarations, versioned prompts, guardrails, eval harness.
- **Three agents**: Curriculum Architect (1.9), Coach (2.6), Content Generator (2.7).
- **Deterministic intelligence** (`core/intelligence`): weighted progress (2.1), weak-concept ranking with evidence (2.2), velocity, retention health.
- **Practice loop** (2.7/2.8): cache-first question serving → deterministic grading → evidence → mastery + FSRS, closing the loop through the same path session ratings take.
- **UI**: "why this?" factor breakdown (2.10), progress page (2.11), feasibility remediation (2.3), and a dashboard that renders real Mission Control.
- **13 new tables**, 16 new endpoints, 8 golden-set questions.

## 2. What was verified

**Static:** format, lint, typecheck, **212 tests** (up from 123), production build.

**Runtime** (PostgreSQL 18.4, live server, no API key): migration + idempotent seed; the full practice loop with mastery moving `0 → 0.2975` and FSRS scheduling the failed concept sooner than the passed one; weak-concept ranking putting the heavier, higher-leverage concept first; and — most importantly — **the core loop working unchanged while the Coach correctly returns 503**.

**Two defects found by runtime verification and fixed**, both with regression tests: `provisional` never firing on single-observation evidence, and the SSE route returning 200 instead of 503 for pre-flight failures.

## 3. Public APIs added

```
GET  /intelligence/progress        GET  /intelligence/weak-concepts
GET  /intelligence/trends          GET  /intelligence/insights
POST /assessments                  POST /attempts/{id}/responses
POST /attempts/{id}/submit         POST /questions/{id}/report
GET  /coach/threads                POST /coach/threads
GET  /coach/threads/{id}           DELETE /coach/threads/{id}
POST /coach/threads/{id}/messages  ← SSE (text/event-stream)
GET  /memory/mastery               GET  /memory/due
GET  /memory/facts                 PATCH /memory/facts/{id}   DELETE /memory/facts/{id}
```

## 4. Database changes

Migration `0004_assessment_intelligence_coach_platform.sql` — 13 tables (37 total): `questions`, `question_concept_keys`, `question_exposures`, `assessments`, `attempts`, `responses`, `learner_facts`, `progress_snapshots`, `insights`, `coach_threads`, `coach_messages`, `ai_calls`, `usage_counters`, `feature_flags`.

Matches DATABASE_DESIGN §4.5–§4.9. `questions`/`question_concept_keys` carry no `user_id` by design — shared content is the cost lever.

**Deferred** (CR-004): `directives` + 3 enums and `audit_log` → Phase 4; `memory_chunks` + pgvector → Phase 3. `ai_calls` is unpartitioned, consistent with the Phase 1 deviation.

## 5. New packages and modules

**`packages/ai`** — `types`, `router`, `provider`, `context`, `tools`, `prompts`, `guardrails`, `agents`, `evals`. 69 tests.
**`packages/core`** — `intelligence/` added. 77 tests.
**`apps/web/src/modules`** — `ai/`, `intelligence/`, `assessment/`, `coach/`, `memory/`, `shared/`.
**`packages/contracts`** — `intelligence`, `assessment`, `coach`, `memory` schemas.
**Dependencies added:** `ai@^5`, `@ai-sdk/anthropic@^2` (blueprint-specified in §2.1).

## 6. Remaining known limitations

Ordered by what matters most to Phase 3.

1. **No AI path has ever run.** No `ANTHROPIC_API_KEY` was available. The agents, streaming, tool-calling, structured-output conformance, prompt quality, and real cost figures are unverified against reality. Everything is type-checked against the real SDK and fixture-tested, which catches wiring — not behaviour.
2. **Eval corpus is nearly empty.** Harness, scorers, and gates exist; the golden sets are 8 questions and a few synthetic cases. §5.8's gates cannot meaningfully pass at that size.
3. **Trends and insights return empty.** `progress_snapshots` has no scheduled writer (the nightly job is Phase 3), and insights have no generator until the Diagnostician.
4. **`sendMessage` untested end to end** — its parts are covered, the assembly is not.
5. **κ is inflated by a single observation.** Consistency scores as perfect when variance is undefined. Worked around in Phase 2's `provisional` flag; the formula fix is proposed for Phase 3 (CR-004 §6, related to open question Q7).
6. **No integration or tenancy-isolation suite**, no property-based tests, no load testing, no CI run, no browser testing — carried forward from Phase 1, now spanning 13 more tables.
7. **`ai_calls` and the Phase 1 log tables are unpartitioned** — deferred to the "<10k DAU" gate DATABASE_DESIGN §10 names.

## 7. Exact starting point for Phase 3

Per IMPLEMENTATION_ROADMAP §3 ("Phase 3 — Adaptation"), the phase goal is _the plan survives contact with reality_:

```
Nightly re-plan cron (timezone fan-out) — core/replanning already implements
  the drift computation, materiality gate, and churn budget; Phase 3 wires
  the trigger, so this is scheduling work, not engine work
Drift detection with the materiality threshold  · plan diff and history UI
Availability change → re-plan                   · curriculum editing
Diagnostic assessment to seed initial mastery   · Diagnostician agent
Trend charts (progress_snapshots finally gets its writer)
Reflection job writing Learner Facts            · Reflector agent
Memory UI (view/edit/delete beliefs)  — the API exists; the UI does not
Coach write tools with confirmation gate        · session pause/resume
pgvector + memory_chunks (D11)                  · semantic memory search
```

**Two things to do before starting.** First, supply an `ANTHROPIC_API_KEY` and re-run PHASE_2_REPORT.md §5 — Phase 3 adds two more agents on top of three that have never executed, and compounding unverified AI work is the main risk this project now carries. Second, decide on the κ single-observation fix (CR-004 §6), since the Diagnostician's confidence behaviour depends on it.

Nothing in `packages/core` or `packages/ai` needs restructuring to begin. The Reflector and Diagnostician slot into the existing `AgentName` union and routing table; `memory_chunks` is the one genuinely new infrastructure dependency, and D11 already says which migration installs it.

Do not begin Phase 3 implementation until this handoff is acknowledged.
