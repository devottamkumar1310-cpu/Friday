# FRIDAY — Implementation Roadmap

> **Status:** Pre-Production · Source of Truth
> **Version:** 1.1 · Blueprint v1.6
> **Depends on:** all five preceding documents
>
> **Stated assumptions** (confirm before Phase 0 — see [§10](#10-assumptions-to-confirm)):
> **(1)** Shipathon window is **14 days**, small team (1–3 engineers). A 72-hour compression is given in [§6.5](#65-if-the-window-is-72-hours-not-14-days).
> **(2)** Launch segment is **Indian competitive-exam aspirants (JEE/NEET)** — drives which curriculum templates get curated first.
> Both change _sequencing_, not _architecture_. If either is wrong, the phase structure holds and only the M0 cut moves.

---

## 1. Sequencing Philosophy

**Build the spine before the limbs.** FRIDAY's value comes from a closed loop, not from any single feature. A half-built loop is worth nothing; a complete loop with crude parts is worth demoing. So every phase must leave the Golden Path working end to end.

Four rules govern ordering:

| #      | Rule                                         | Why                                                                                                                                                                                            |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **Vertical slices, never horizontal layers** | "All the schema, then all the API, then all the UI" produces nothing demoable for weeks and hides integration risk until the end.                                                              |
| **R2** | **Deterministic engine before AI**           | The scheduler, mastery model, and priority function are the hard, load-bearing parts. AI is comparatively easy to add once the state model is right — and impossible to bolt onto a wrong one. |
| **R3** | **Riskiest assumption earliest**             | Curriculum generation quality (Bet B4) and Next Action credibility (Bet B1) are what the product lives or dies on. Test both in week one.                                                      |
| **R4** | **Ship the loop, then the intelligence**     | Proactivity, insights, and root-cause analysis are multipliers on a working loop. They are worth zero without one.                                                                             |

---

## 2. Phase Overview

| Phase | Name               | Duration   | Exit criterion                                                                | Tier   |
| ----- | ------------------ | ---------- | ----------------------------------------------------------------------------- | ------ |
| **0** | Foundations        | 3–5 days   | `pnpm dev` runs; auth works; CI green; one seeded user                        | —      |
| **1** | The Spine          | 5–7 days   | Goal → curriculum → plan → Next Action → session → mastery update, end to end | **M0** |
| **2** | Intelligence Layer | 7–10 days  | Progress, weak concepts, feasibility, context-aware Coach                     | **M0** |
| **3** | Adaptation         | 7–10 days  | Nightly re-plan, drift detection, curriculum editing, diagnostics             | M1     |
| **4** | Proactivity        | 7–10 days  | Directives, daily brief, nudge policy, delivery channels                      | M1     |
| **5** | Depth              | 10–14 days | Insights, root-cause, mock tests, memory UI, weekly review                    | M2     |
| **6** | Scale & Reach      | ongoing    | Mobile, integrations, billing, institutional                                  | M3     |

**Phases 0–2 are the Shipathon MVP.** Everything after is post-demo.

---

## 3. Phase Detail

### Phase 0 — Foundations

> _Goal: a working skeleton that a feature can be dropped into without ceremony._

| #    | Deliverable                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Monorepo scaffold — pnpm workspaces + Turborepo, all packages stubbed                                                                   | Per [SYSTEM_ARCHITECTURE.md §9](SYSTEM_ARCHITECTURE.md)                                                                                                                                                                                                                                                        |
| 0.2  | Shared config: TS strict, ESLint with **dependency-boundary rules**, Prettier                                                           | The boundary lint is what keeps `core` pure — add it on day one or it never happens                                                                                                                                                                                                                            |
| 0.3  | Neon project + Drizzle setup + first migration (identity tables only)                                                                   |                                                                                                                                                                                                                                                                                                                |
| 0.4  | Auth: email/password + Google OAuth + session middleware (first-party session layer — see DR-001)                                       | Argon2id passwords; opaque tokens with only an HMAC digest stored                                                                                                                                                                                                                                              |
| 0.4b | **DOB capture + minor-consent gate** (FR-1.6). Under-13 blocked; under-18 blocked from Goal creation until guardian consent is recorded | 0.3, 0.4                                                                                                                                                                                                                                                                                                       |
| 0.5  | Design tokens + 10 base UI primitives in `packages/ui`                                                                                  | Button, Input, Card, Dialog, Skeleton, Toast, Tabs, Badge, Progress, Sheet                                                                                                                                                                                                                                     |
| 0.6  | App shell: marketing page, auth pages, empty authenticated layout                                                                       |                                                                                                                                                                                                                                                                                                                |
| 0.7  | `packages/contracts` wired: Zod → OpenAPI → typed client generation                                                                     | Prove the pipeline with one trivial endpoint (`GET /me`)                                                                                                                                                                                                                                                       |
| 0.8  | Observability: Sentry, structured logger, `request_id` propagation                                                                      | Cheap now, invaluable at 2am later                                                                                                                                                                                                                                                                             |
| 0.9  | CI: lint, typecheck, unit, build, Neon branch per PR, Vercel preview                                                                    |                                                                                                                                                                                                                                                                                                                |
| 0.10 | Seed harness + identity fixtures (adult, minor awaiting guardian consent, availability, consents)                                       | **Every subsequent phase depends on this.** Realistic seed data is the single highest-leverage dev-experience investment. Scoped to identity because 0.3 limits the Phase 0 migration to identity tables — the goal, 40-concept curriculum, and 30 days of history are seeded in 1.1, when those tables exist. |

**Exit:** sign up → sign in → land on an empty dashboard → CI green on a PR with a preview URL.

---

### Phase 1 — The Spine _(M0 core)_

> _Goal: the closed loop exists. Crude, but real and end to end._

| #    | Deliverable                                                                                                                                                                                                                                                                                                   | Depends on    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1.1  | Schema: goals, curriculum tree, concepts, edges, plans, blocks, tasks, sessions, mastery, memory states                                                                                                                                                                                                       | 0.3           |
| 1.2  | **`packages/core/graph`** — topological order, prerequisite traversal, readiness, cycle detection                                                                                                                                                                                                             | 1.1 types     |
| 1.3  | **`packages/core/retention`** — FSRS-5 wrapper, state transitions, retrievability                                                                                                                                                                                                                             | —             |
| 1.4  | **`packages/core/mastery`** — evidence → mastery update, decay, confidence                                                                                                                                                                                                                                    | 1.3           |
| 1.5  | **`packages/core/priority`** — the ranking function with factor breakdown, **two-tier** (structural vs. volatile, [AI_DECISION_ENGINE §6.0](AI_DECISION_ENGINE.md#60-when-each-term-is-computed)). Build the **M0 subset only** ([§1.1](AI_DECISION_ENGINE.md#11-what-ships-at-m0--the-frozen-engine-subset)) | 1.2, 1.3, 1.4 |
| 1.6  | **`packages/core/feasibility`** — required vs. available, verdict, projection                                                                                                                                                                                                                                 | 1.1           |
| 1.7  | **`packages/core/scheduling`** — greedy constraint scheduler, **materialising a 14-day window + projection** ([DATABASE_DESIGN §4.3](DATABASE_DESIGN.md))                                                                                                                                                     | 1.2, 1.5, 1.6 |
| 1.8  | `canonical_concepts` vocabulary seed + 2 curated presets (JEE Main Physics + full JEE Main), keyed                                                                                                                                                                                                            | 1.1           |
| 1.9  | AI: **Curriculum Architect** agent + structural validator (incl. `concept_key` resolution) + repair loop                                                                                                                                                                                                      | 0.7, 1.1, 1.8 |
| 1.10 | Onboarding flow: goal → date → availability → curriculum choice                                                                                                                                                                                                                                               | 1.8, 1.9      |
| 1.11 | Plan generation job (Inngest) with SSE progress                                                                                                                                                                                                                                                               | 1.7, 1.9      |
| 1.12 | Next Action endpoint (cached, deterministic)                                                                                                                                                                                                                                                                  | 1.5           |
| 1.13 | Session lifecycle + rating capture + evidence write transaction                                                                                                                                                                                                                                               | 1.3, 1.4      |
| 1.14 | Mission Control v1: Next Action card, today's plan, countdown, progress ring                                                                                                                                                                                                                                  | 1.12          |

**Critical path:** `1.2 → 1.5 → 1.7 → 1.11 → 1.14`. The domain core gates everything. Build it first, test it hard, and it never blocks again.

**Exit — the Golden Path runs:** create a goal → get a plan → see one recommendation → complete a session → **see the recommendation change for a stated reason.**

> **Phase 1 is where the product either exists or doesn't.** If `packages/core` is right, the rest is assembly. If it's wrong, no amount of UI polish or prompt engineering will save it. Budget accordingly: this phase deserves the best engineer and the most test coverage.

---

### Phase 2 — Intelligence Layer _(M0 completion)_

> _Goal: FRIDAY can explain itself, and the Coach knows who it's talking to._

| #    | Deliverable                                                                      | Depends on |
| ---- | -------------------------------------------------------------------------------- | ---------- |
| 2.1  | Progress + weighted completion + on-track verdict endpoints                      | 1.6        |
| 2.2  | Weak-concept ranking with evidence drill-down                                    | 1.4        |
| 2.3  | Feasibility remediation UI (extend / add hours / cut scope, with impact preview) | 1.6, 2.1   |
| 2.4  | **`packages/ai/context`** — the Learner Context Packet builder + token budgeting | 1.x state  |
| 2.5  | AI read tools (`get_plan`, `get_mastery`, `get_weak_concepts`, …)                | 2.4        |
| 2.6  | **Coach** agent: SSE streaming, tool-calling loop, thread persistence            | 2.4, 2.5   |
| 2.7  | **Content Generator** agent + question cache + exposure tracking                 | 1.1        |
| 2.8  | Practice flow: serve → answer → grade → evidence → mastery update                | 2.7, 1.4   |
| 2.9  | Deterministic rationale template renderer (`core/priority` → text, no LLM)       | 1.5, 1.12  |
| 2.10 | "Why this?" factor breakdown UI                                                  | 1.5, 2.9   |
| 2.11 | Progress page: ring, weak list, trend placeholder                                | 2.1, 2.2   |
| 2.12 | AI eval harness + golden sets for curriculum, questions, grading                 | 1.9, 2.7   |

**Exit:** ask the Coach _"what should I do this week and why?"_ and get an answer citing real plan state, real mastery numbers, and real weak concepts — with zero context re-explanation.

---

### Phase 3 — Adaptation _(M1)_

> _Goal: the plan survives contact with reality._

Nightly re-plan cron (timezone fan-out) · drift detection with a materiality threshold to prevent plan thrash · plan diff and history UI · availability change → re-plan · curriculum editing (rename, exclude, mark known, reorder) · diagnostic assessment to seed initial mastery · **Diagnostician** agent · trend charts · reflection job writing Learner Facts · memory UI (view/edit/delete beliefs) · Coach write tools with confirmation gate · session pause/resume and history.

**Exit:** miss three days → return → the plan has silently absorbed it, the feasibility verdict is honestly updated, and no guilt copy appears anywhere.

---

### Phase 4 — Proactivity _(M1)_

> _Goal: FRIDAY speaks first — and earns the right to keep doing so._

Detector framework (deadline pressure, drift, retention cliff, inactivity, milestone) · **nudge policy engine** (quiet hours, daily caps, per-type cooldowns, relevance threshold) · directive inbox · daily brief generation · email delivery (Resend + React Email) · web push · outcome tracking feeding the relevance threshold · full user controls · admin console · cost metering with tier-down degradation.

**Exit:** a directive fires only when it is genuinely useful, and the suppression log proves how many were correctly withheld. Notification opt-out stays under 15% (Bet B2).

---

### Phase 5 — Depth _(M2)_

> _Goal: the analysis gets deep enough to be irreplaceable._

Insights engine with mandatory evidence citation · **root-cause attribution through the prerequisite graph** · weekly review digest · mock test engine with sectional timing · syllabus upload and parsing · semantic memory search · memory consolidation and decay · knowledge graph visualisation · offline-tolerant sessions · command palette · billing.

---

### Phase 6 — Scale & Reach _(M3)_

Mobile app (Expo, reusing `packages/*`) · Google Calendar two-way sync · multi-goal arbitration · read replica + analytics extraction · institutional/B2B2C surface · public API and webhooks · localisation.

---

## 4. Dependency Graph

```
Phase 0 ──────────────────────────────────────────────────┐
   │                                                      │
   ├─▶ packages/core (graph → retention → mastery →       │
   │        priority → feasibility → scheduling)          │
   │              │                                       │
   │              ├─▶ Next Action ──▶ Mission Control ────┤ MVP
   │              ├─▶ Plan generation ────────────────────┤ DEMO
   │              └─▶ Session/evidence write ─────────────┤
   │                                                      │
   ├─▶ Curriculum Architect ──▶ curriculum ──▶ plan ──────┘
   │                                │
   ├─▶ Context Packet ──▶ Coach ────┤
   │                     Content Gen┘
   │
   └─▶ (Phase 3+) reflection ──▶ Learner Facts ──▶ richer context
                    │
                    └─▶ detectors ──▶ nudge policy ──▶ directives
                                                  │
                                                  └─▶ insights ──▶ root-cause
```

### Hard dependencies (cannot be parallelised)

1. `core/graph` → `core/priority` → Next Action → Mission Control
2. Curriculum → Plan → Tasks → Sessions → Evidence → Mastery → Next Action _(the loop closes here)_
3. Context Packet → every AI agent that needs learner state
4. Evidence log → reflection → Learner Facts → richer context
5. Directives require both detectors **and** the policy engine — shipping detectors alone produces spam

### Safely parallel

- UI design system ∥ domain core
- Curriculum templates (content work) ∥ engine work
- Auth ∥ everything
- Eval harness ∥ agent development
- Observability ∥ everything

---

## 5. Milestones

| ID      | Milestone         | Phase | Definition of done                                                                                                         |
| ------- | ----------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| **M-A** | Skeleton alive    | 0     | Sign up → dashboard; CI green; preview deploys                                                                             |
| **M-B** | Engine correct    | 1     | `packages/core` at ≥90% coverage; scheduler produces a valid plan from seed data; **hand-verified** feasibility arithmetic |
| **M-C** | Loop closed       | 1     | Golden Path end to end; Next Action provably changes after a session                                                       |
| **M-D** | **Shipathon MVP** | 2     | All M0 DoD criteria met; deployed; demo recorded                                                                           |
| **M-E** | Self-explaining   | 2     | Every recommendation has a faithful "why"; Coach cites real state                                                          |
| **M-F** | Self-healing      | 3     | Nightly re-plan runs for all users; drift absorbed without user action                                                     |
| **M-G** | Proactive         | 4     | Directives delivered within policy; nudge→session ≥25%                                                                     |
| **M-H** | Public Beta       | 4     | 100 external users; D7 ≥40%; p95 targets met                                                                               |
| **M-I** | v1.0              | 5     | Insights + root-cause + mocks; billing live                                                                                |

---

## 6. Shipathon MVP Roadmap

**Target:** M-D. **One demo sentence:** _"Tell FRIDAY your goal and your deadline, and it tells you exactly what to study right now — and keeps being right as things change."_

### 6.1 Day-by-day (14 days)

| Day    | Focus                      | Ships                                                                                                                                                        |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**  | Scaffold                   | Monorepo, config, boundary lint, Neon, Drizzle, CI                                                                                                           |
| **2**  | Auth + shell               | Session layer, Google OAuth, **DOB + minor gate**, layout, 10 UI primitives, seed script                                                                     |
| **3**  | Schema + graph             | Full M0 schema (extensions preamble, app-generated UUIDv7, `canonical_concepts`); `core/graph` with cycle detection + topo sort **(tested)**                 |
| **4**  | **Learning engine**        | `core/retention` (FSRS), `core/mastery` — unit-tested against hand-computed fixtures                                                                         |
| **5**  | **Priority + feasibility** | `core/priority` **M0 subset** (fixed weights, plan-position urgency, depth-1 leverage, hysteresis only), `core/feasibility` — **hand-verify the arithmetic** |
| **6**  | Scheduler                  | `core/scheduling` with 14-day window + projection; generate a valid plan from seed data; **M-B**                                                             |
| **7**  | Curriculum                 | 2 curated templates + Curriculum Architect agent + structural validator                                                                                      |
| **8**  | Onboarding                 | Goal → date → availability → curriculum → plan job with streamed progress                                                                                    |
| **9**  | Next Action + sessions     | Endpoint + cache; session start/complete transaction; evidence → mastery                                                                                     |
| **10** | **Mission Control**        | Next Action card, today's plan, countdown, progress ring — **M-C, loop closed**                                                                              |
| **11** | Coach                      | Context Packet builder, read tools, SSE streaming, thread UI                                                                                                 |
| **12** | Practice + progress        | Content Generator, question cache, grading, progress + weak-concepts page                                                                                    |
| **13** | **Polish**                 | Empty/loading/error states, "why this?" UI, feasibility remediation, mobile responsive                                                                       |
| **14** | **Harden + demo**          | E2E Golden Path ×20, seed a demo account, record 90s demo, deploy                                                                                            |

### 6.2 Daily discipline

- **Every day ends with `main` deployable.** No exceptions — a broken `main` on day 9 costs day 10.
- **Golden Path E2E runs on every merge from day 10.**
- **Cut features, never cut the loop.** If day 12 is behind, drop practice questions before dropping the Coach; drop the Coach before dropping Next Action.

### 6.3 Explicit demo cuts

Hardcode where it doesn't show: 2 curriculum templates (not 20) · self-reported initial mastery (no diagnostic) · manual re-plan button (no nightly cron) · MCQ-only questions (no LLM grading) · a single progress ring (no trend charts) · in-app only (no email) · desktop-first responsive (no PWA install).

### 6.4 Risk register

| Risk                                         | Likelihood | Impact       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain core takes longer than days 3–6       | **High**   | **Critical** | Timebox hard. The **M0 engine subset is frozen** ([AI_DECISION_ENGINE §1.1](AI_DECISION_ENGINE.md#11-what-ships-at-m0--the-frozen-engine-subset)) — no full slack pass, no transitive leverage, no modifiers beyond hysteresis. Further fallback: fixed-interval revision instead of FSRS, linear mastery instead of adaptive-K. Both are one-line swaps behind the same interface, and both still demo. |
| Curriculum generation is slow or low quality | Medium     | High         | Curated templates are the demo default; AI generation is the "and it can also do this" moment. Never demo the risky path first.                                                                                                                                                                                                                                                                          |
| Scheduler produces obviously silly plans     | Medium     | High         | Day 6 checkpoint: eyeball 5 generated plans against intuition. Add the local-repair pass if they look wrong.                                                                                                                                                                                                                                                                                             |
| AI cost spike during development             | Low        | Medium       | Haiku tier in dev; hard budget cap from day 1                                                                                                                                                                                                                                                                                                                                                            |
| Deploy problems on day 14                    | Medium     | **Critical** | Deploy on **day 2** and every day after. Day-14 first-deploy is how demos die.                                                                                                                                                                                                                                                                                                                           |
| Scope creep from a good idea on day 9        | **High**   | High         | Write it in `docs/later.md`. The M0 list is frozen after day 1.                                                                                                                                                                                                                                                                                                                                          |

### 6.5 If the window is 72 hours, not 14 days

Compress to the loop's irreducible core. Cut in this order:

**Keep:** auth (email only, no OAuth) · **one** hardcoded curriculum template · `core/priority` + `core/feasibility` (skip full FSRS — use a 1/3/7/14/30-day fixed ladder) · greedy scheduler · Next Action · session complete → mastery update · Mission Control.
**Drop:** AI curriculum generation · Coach · practice questions · progress page · re-plan · everything else.

That is still a complete, honest demonstration of the thesis: _a system that decides what you study next, and updates when you study._ Three days is enough for the loop. It is not enough for the loop **plus** the AI surface — attempting both produces neither.

---

## 7. Testing Strategy

### 7.1 Distribution

```
        ╱╲          E2E (Playwright) — ~15 tests
       ╱  ╲         Golden Path, auth, session loop, replan
      ╱────╲
     ╱      ╲       Integration (Vitest + real Neon branch) — ~80
    ╱        ╲      API contracts, transactions, job handlers, repo scoping
   ╱──────────╲
  ╱            ╱    Unit (Vitest) — ~400
 ╱────────────╱     packages/core is the overwhelming majority
```

### 7.2 By layer

| Layer               | Approach                                                                                                                                                                                                                                                                      | Coverage bar                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **`packages/core`** | Pure unit tests. Fixtures hand-computed from the formulas in [SYSTEM_ARCHITECTURE.md §6.3](SYSTEM_ARCHITECTURE.md). Property-based tests for invariants: mastery ∈ [0,1], due dates monotonic under repeated success, scheduler never violates prerequisites or blocked time. | **≥90%**                          |
| **Repositories**    | Integration against a real Neon branch. **A dedicated suite asserts that no method returns another user's rows** — the NFR-3.3 guarantee must be tested, not assumed.                                                                                                         | ≥80%                              |
| **Services**        | Integration with real DB, mocked AI. Transaction rollback tests, idempotency tests, event-emission-after-commit tests.                                                                                                                                                        | ≥75%                              |
| **API**             | Contract tests generated from the Zod schemas — every endpoint validated against its own OpenAPI definition. Auth matrix: anonymous / wrong user / correct user / admin.                                                                                                      | 100% of endpoints                 |
| **AI**              | Golden-set evals with scorers ([SYSTEM_ARCHITECTURE.md §5.8](SYSTEM_ARCHITECTURE.md)). Deterministic tests use recorded fixtures — never live calls in CI.                                                                                                                    | Gates on eval score, not coverage |
| **Frontend**        | Component tests for state logic; MSW for API mocking. No snapshot tests — they assert nothing and break constantly.                                                                                                                                                           | ≥60%                              |
| **E2E**             | Golden Path is sacred and runs on every merge. Others nightly.                                                                                                                                                                                                                | Golden Path 100%                  |

### 7.3 The tests that matter most

These are the ones that catch the failures that would actually hurt:

1. **Scheduler invariants** — never schedules a concept before its prerequisites; never exceeds daily capacity; never places work in blocked time; always terminates.
2. **Feasibility arithmetic** — verified against hand-computed cases. If this is wrong, FRIDAY lies to students about whether they will finish. That is the worst possible bug in this product.
3. **Mastery monotonicity** — correct answers never decrease mastery; wrong answers never increase it.
4. **FSRS correctness** — validated against the reference implementation's published test vectors.
5. **Tenancy isolation** — user A can never read or write user B's data, on any path.
6. **Transaction atomicity** — a failed session completion leaves zero partial state.
7. **Next Action changes** — after evidence, the recommendation demonstrably changes, and the stated reason matches the factor that actually moved.
8. **Rationale faithfulness (I-11)** — the factor named in the rendered rationale is the largest contributor in the trace, for every decision in a generated corpus. This is a correctness test, not a copy test.
9. **Two-tier consistency** — a decision computed from stored structural factors plus live volatile factors equals one computed wholly from scratch. Divergence means the tiers have drifted.
10. **Plan window bounds** — no plan version ever materialises a block or task outside `[window_start, window_end]`; the projection covers everything to the target date with no gaps.
11. **`concept_key` resolution** — a generated curriculum containing an unknown key is rejected before write, not silently accepted.

### 7.4 Non-functional testing

- **Load:** k6 against staging — 1,000 concurrent Next Action requests must hold p95 < 300ms.
- **Job scale:** simulate a 10k-user nightly re-plan; must complete in <30 min.
- **AI failure injection:** provider 500s, timeouts, and malformed output — assert the core loop keeps working (NFR-2.2).
- **Accessibility:** axe-core in CI; manual keyboard and screen-reader pass per release.
- **Security:** dependency scanning, secret scanning, and a **prompt-injection suite** — adversarial content in notes and uploads attempting to trigger write tools must fail closed.

### 7.5 CI gates

```
PR:     lint · typecheck · unit · build · migration dry-run · AI eval subset (if ai/ changed)
Merge:  + integration (Neon branch) · Golden Path E2E · a11y
Nightly:+ full E2E · full AI evals · load smoke · dependency audit
Release:+ manual QA checklist · staging soak (24h) · rollback rehearsed
```

---

## 8. Release Plan

| Stage              | Audience                     | Gate                                              |
| ------------------ | ---------------------------- | ------------------------------------------------- |
| **Internal alpha** | Team                         | Golden Path stable; seeded data                   |
| **Shipathon demo** | Judges                       | M-D complete; demo account; recorded backup video |
| **Private beta**   | 20–50 invited exam aspirants | M-F; feedback channel; daily triage               |
| **Public beta**    | Waitlist, ~500               | M-G; SLOs met; support runbooks written           |
| **v1.0**           | Open                         | M-I; billing; 99.5% uptime for 30 days            |

### Release mechanics

- **Trunk-based development.** Short-lived branches, merge to `main` daily, feature flags for anything unfinished.
- **Every risky subsystem ships behind a flag** — auto re-plan, directives, new agents. Rollback is a toggle, not a deploy.
- **Progressive rollout** on behaviour changes: 5% → 25% → 100%, watching the counter-metrics from [PRODUCT_REQUIREMENTS.md §8](PRODUCT_REQUIREMENTS.md).
- **Migrations are expand → deploy → contract.** No destructive change ships alongside the code that depends on it.
- **Rollback rehearsed before each stage gate**, not discovered during an incident.

### Post-release loop

Weekly: metric review against the [Bet Register](PROJECT_VISION.md#10-bet-register) · AI cost per user · top 3 support themes · one counter-metric deep-dive.
Monthly: re-tune planner weights (α, β, γ, δ) against observed adherence · prune the question bank · review Learner Fact quality.

---

## 9. What Success Looks Like at Each Gate

| Gate    | The question it answers                                                                 |
| ------- | --------------------------------------------------------------------------------------- |
| **M-B** | Does the engine produce plans a human expert would call reasonable?                     |
| **M-C** | Does the loop close — does studying change what FRIDAY tells you next?                  |
| **M-D** | Can a stranger use it unaided and understand why it's different from a planner?         |
| **M-F** | Does the plan survive a bad week without the user having to fix it?                     |
| **M-G** | Do people welcome being interrupted by FRIDAY? _(Bet B2)_                               |
| **M-H** | Do they come back in week 6? _(Bet B5 — the retention curve should flatten, not decay)_ |

---

## 10. Assumptions to Confirm

| #   | Assumption made                                                 | Impact if wrong                                                               |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A1  | Shipathon window = 14 days                                      | Use the 72-hour cut in §6.5; phases unchanged                                 |
| A2  | Launch segment = JEE/NEET aspirants                             | Different curriculum templates curated in Phase 1; nothing structural changes |
| A3  | Team = 1–3 engineers                                            | With 4+, parallelise Phase 1 UI against the domain core                       |
| A4  | Curated templates for the demo, AI generation as the second act | If AI generation must be the headline, move 1.9 to day 5 and cut the Coach    |
| A5  | Web-only at MVP                                                 | Mobile-first would change the Phase 1 UI work, not the architecture           |

---

## 11. Document Map

| Document                                           | Answers                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| [PROJECT_VISION.md](PROJECT_VISION.md)             | Why FRIDAY exists, who it's for, what we believe                       |
| [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) | What it does, scoped by release                                        |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)   | How it's built and why those technologies                              |
| [AI_DECISION_ENGINE.md](AI_DECISION_ENGINE.md)     | How it thinks — the reference for all planning and recommendation work |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md)           | How state is modelled and stored                                       |
| [API_SPECIFICATION.md](API_SPECIFICATION.md)       | How clients talk to it                                                 |
| **IMPLEMENTATION_ROADMAP.md**                      | In what order it gets built                                            |
