# FRIDAY — System Architecture

> **Status:** Pre-Production · Source of Truth
> **Version:** 1.2 · Blueprint v1.4
> **Depends on:** [PROJECT_VISION.md](PROJECT_VISION.md), [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)

---

## 1. Architectural Principles

These constrain every decision that follows.

| #      | Principle                                 | Consequence                                                                                                                                                  |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A1** | **Deterministic core, intelligent shell** | Mastery, due dates, priority ranking, and feasibility are computed in pure TypeScript. The LLM never produces a number the system trusts.                    |
| **A2** | **Modular monolith, not microservices**   | One deployable, hard module boundaries. Distributed systems tax is not payable by a small team, and the boundaries we'd guess today would be wrong.          |
| **A3** | **Pure domain core**                      | `packages/core` has zero I/O, zero framework imports, zero LLM calls. It is a library of functions over plain data — trivially testable, trivially portable. |
| **A4** | **One schema, many projections**          | Drizzle schema → inferred types → Zod contracts → OpenAPI → generated client. Types cannot drift because there is only one source.                           |
| **A5** | **Events are the truth**                  | Every state-changing action appends to an immutable event log. Mastery and progress are derivable from it. Debugging becomes replay.                         |
| **A6** | **AI is an untrusted subsystem**          | Schema-validated in, schema-validated out, bounded retries, always a deterministic fallback. AI downtime degrades experience; it never breaks the core loop. |
| **A7** | **Async by default for anything slow**    | Plan generation, curriculum generation, reflection, and batch re-planning are durable background jobs — never blocking HTTP requests.                        |
| **A8** | **Boring where it doesn't matter**        | Novelty budget is spent on the learning engine and memory. Everything else uses the most conventional option available.                                      |

---

## 2. Technology Stack

### 2.1 The stack

| Layer                | Choice                                                                               | Why                                                                                                                                                      | Alternative considered                                                 |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Language**         | TypeScript 5.x (strict)                                                              | One language across web, API, jobs, and domain core. A small team cannot afford a context switch tax.                                                    | Python backend — see §2.2                                              |
| **Frontend**         | Next.js 15 (App Router) + React 19                                                   | RSC for fast data-dense dashboards; native streaming for AI; one deploy for marketing + app                                                              | Remix, Vite SPA                                                        |
| **Styling / UI**     | Tailwind CSS + shadcn/ui + Radix                                                     | Owned components (no library lock-in), accessible primitives, fast iteration                                                                             | MUI, Mantine                                                           |
| **Server state**     | TanStack Query                                                                       | Caching, invalidation, optimistic updates — the hard parts, solved                                                                                       | SWR, RTK Query                                                         |
| **Client state**     | Zustand                                                                              | Tiny, unopinionated, for ephemeral UI state only                                                                                                         | Redux Toolkit (overkill), Jotai                                        |
| **Forms**            | React Hook Form + Zod resolver                                                       | Same Zod schemas as the API contract — validate once, use everywhere                                                                                     | Formik                                                                 |
| **Charts**           | Recharts                                                                             | Sufficient, React-native, low ceremony                                                                                                                   | visx (more power, more work)                                           |
| **API layer**        | Next.js Route Handlers, REST + OpenAPI 3.1                                           | A stable public contract that mobile and third parties can consume                                                                                       | tRPC — see §2.2                                                        |
| **Validation**       | Zod                                                                                  | Runtime + compile-time from one definition; drives OpenAPI and LLM structured output                                                                     | Valibot, io-ts                                                         |
| **ORM**              | Drizzle                                                                              | SQL-transparent, no query engine binary, excellent types, trivial migrations. We write real SQL for the analytical queries the engine needs.             | Prisma — see §2.2                                                      |
| **Database**         | PostgreSQL 16+ (Neon)                                                                | Relational integrity for a graph-shaped domain, JSONB where flexible, `pgvector` for embeddings from Phase 3, branching DBs per PR                       | Supabase, PlanetScale (no FKs — disqualifying)                         |
| **Vector search**    | pgvector, same Postgres — **added in Phase 3**                                       | One datastore. At our scale a dedicated vector DB is pure operational overhead. Installed by the migration that first needs it, not up front (D11).      | Pinecone, Qdrant                                                       |
| **Cache / limits**   | Redis (Upstash)                                                                      | Rate limiting, session cache, hot Next-Action cache, idempotency keys                                                                                    | In-memory (won't survive multi-instance)                               |
| **Background jobs**  | Inngest                                                                              | Durable, retryable, cron + event-driven, works on serverless, excellent local dev. Removes the need to run and babysit a queue.                          | BullMQ + Redis (self-host fallback), Trigger.dev                       |
| **Auth**             | First-party session layer (Argon2id + hashed DB sessions)                            | Sessions live in _our_ Postgres. Student data is sensitive and often a minor's — we own it. Implemented directly rather than via a library; see ADR-007. | Better Auth, Clerk (hosted PII + cost), Auth.js (weaker session model) |
| **AI orchestration** | Vercel AI SDK v5                                                                     | Provider-agnostic, first-class streaming and tool calling, native structured output with Zod                                                             | LangChain.js (heavy), raw SDK (rebuild streaming)                      |
| **AI models**        | Anthropic Claude — `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` | Strong structured output and long-context reasoning; tiering is the primary cost lever (§5.3)                                                            | OpenAI / Gemini kept behind the provider interface as failover         |
| **Embeddings**       | Voyage / OpenAI `text-embedding-3-small`                                             | Cheap, good enough for episodic retrieval                                                                                                                | Self-hosted (not worth it)                                             |
| **File storage**     | Cloudflare R2                                                                        | S3-compatible, zero egress fees                                                                                                                          | S3                                                                     |
| **Email**            | Resend + React Email                                                                 | Templates as components                                                                                                                                  | Postmark, SES                                                          |
| **Observability**    | Sentry (errors) · OpenTelemetry → Axiom (traces/logs) · PostHog (product analytics)  | Full picture without building it                                                                                                                         | Datadog (cost)                                                         |
| **Feature flags**    | PostHog flags                                                                        | Already present; avoids another vendor                                                                                                                   | LaunchDarkly                                                           |
| **Testing**          | Vitest · Playwright · MSW                                                            | Fast unit tests, real E2E on the Golden Path                                                                                                             | Jest, Cypress                                                          |
| **Monorepo**         | pnpm workspaces + Turborepo                                                          | Fast, cached, standard                                                                                                                                   | Nx                                                                     |
| **CI/CD**            | GitHub Actions + Vercel                                                              | Preview per PR with a branched database                                                                                                                  | —                                                                      |
| **Hosting**          | Vercel (web + API)                                                                   | Zero-ops for Next.js, edge CDN, preview envs                                                                                                             | Fly.io/Railway (if we outgrow it)                                      |

### 2.2 The three decisions worth defending

**Why TypeScript-only, not a Python AI service.**
The instinct is that AI work belongs in Python. It doesn't, yet. FSRS has a production-grade TypeScript implementation (`ts-fsrs`); our mastery model is arithmetic, not machine learning; and LLM orchestration is _better_ in TypeScript today because of the AI SDK's streaming and structured-output ergonomics. A second language means a second runtime, a second dependency tree, a second deploy target, duplicated domain types, and a network hop in the middle of our hottest path — bought for capability we do not yet need.

**The escape hatch is designed in, not bolted on.** `packages/core` is pure functions over plain data, and every consumer calls it through an interface. When we need real ML — IRT item calibration, learned time estimates, sequence models over event history — we stand up a Python service for _training_, export parameters, and keep _inference_ in TypeScript. Trigger conditions, stated in advance so this is a decision and not a drift: (a) we need IRT/BKT parameter fitting over >1M responses, (b) we need model training pipelines, or (c) an analytics workload starts competing with request-serving. Any one of those, and we add `services/ml` in Python — and only that.

**Why REST + OpenAPI, not tRPC.**
tRPC has better DX inside a TypeScript monorepo, and if the web app were the only client forever it would win. It isn't: a React Native app is on the roadmap, and an institutional API is in the long-term vision. OpenAPI gives us a versioned, documented, language-agnostic contract with generated clients, and it forces us to design an API rather than exporting our internals. We recover most of tRPC's ergonomics from the endpoint registry that produces the spec: it also projects a typed client, so the in-repo client is typed from the Zod schemas themselves rather than from generated JSON Schema (see API_SPECIFICATION §7.4).

**Why Drizzle, not Prisma.**
Our hot queries are not CRUD. Next Action ranking, mastery aggregation, and feasibility math are analytical queries with joins across the knowledge graph, window functions, and recursive CTEs for prerequisite traversal. Prisma makes those awkward and pushes you to raw SQL anyway — at which point you have two mental models. Drizzle _is_ SQL with types, generates plain migrations we can review, and adds no engine binary to the deployment.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                    │
│   Web (Next.js PWA, responsive)          React Native  [M3]             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS · REST /api/v1 · SSE for AI streams
┌───────────────────────────────▼─────────────────────────────────────────┐
│                          EDGE / VERCEL                                  │
│   CDN · TLS · Middleware: session, rate limit, request-id, CSP          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                       APPLICATION TIER  (stateless)                     │
│                                                                         │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐   │
│  │ Next.js RSC  │  │            API ROUTE HANDLERS                  │   │
│  │  UI + BFF    │  │  validate → authorize → service → serialize    │   │
│  └──────────────┘  └────────────────────┬───────────────────────────┘   │
│                                         │                               │
│  ┌──────────────────────────────────────▼───────────────────────────┐   │
│  │                      SERVICE LAYER (use cases)                   │   │
│  │  Identity · Goal · Curriculum · Planning · Execution ·           │   │
│  │  Assessment · Memory · Intelligence · Coach · Proactivity        │   │
│  │  — owns transactions, orchestration, authorization, events —     │   │
│  └───────┬────────────────────────┬──────────────────────┬──────────┘   │
│          │                        │                      │              │
│  ┌───────▼─────────┐   ┌──────────▼────────┐   ┌─────────▼──────────┐   │
│  │  DOMAIN CORE    │   │    AI ENGINE      │   │   REPOSITORIES     │   │
│  │  (pure TS)      │   │                   │   │                    │   │
│  │ · scheduler     │   │ · context builder │   │ · Drizzle          │   │
│  │ · FSRS          │   │ · model router    │   │ · user-scoped      │   │
│  │ · mastery       │   │ · agents          │   │ · tx-aware         │   │
│  │ · priority      │   │ · tools           │   │                    │   │
│  │ · feasibility   │   │ · guardrails      │   │                    │   │
│  │ NO I/O          │   │ · eval hooks      │   │                    │   │
│  └─────────────────┘   └────────┬──────────┘   └─────────┬──────────┘   │
└─────────────────────────────────┼────────────────────────┼──────────────┘
                                  │                        │
┌─────────────────────────────────┼────────────────────────┼──────────────┐
│                    ASYNC TIER (Inngest — durable)        │              │
│  cron: nightly re-plan · due sweep · daily brief · consolidation        │
│  events: session.completed · assessment.graded · goal.created           │
│  jobs: curriculum.generate · plan.generate · reflect · embed · notify   │
└─────────────────────────────────┬────────────────────────┬──────────────┘
                                  │                        │
┌─────────────────────────────────▼────────────────────────▼──────────────┐
│                             DATA TIER                                   │
│  PostgreSQL 16+ (+pgvector from Phase 3)  ·  Redis  ·  R2 (blobs)       │
│  primary + read replica          cache/limits/idempotency               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────────┐
│  EXTERNAL: Anthropic · Embeddings · Resend · Sentry · PostHog · Axiom  │
└────────────────────────────────────────────────────────────────────────┘
```

### Request classes

| Class                                | Path                                                                   | Budget                              |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------- |
| **Read** (dashboard, plan, progress) | Route handler → service → repository → Postgres                        | <200ms p95                          |
| **Hot decision** (Next Action)       | Route handler → service → **domain core** → Redis cache                | <300ms p95 — _never touches an LLM_ |
| **Write** (session events)           | Route handler → service → tx{repo + event append} → emit Inngest event | <400ms p95                          |
| **AI stream** (coach)                | Route handler → context builder → model → SSE                          | <1.5s to first token                |
| **Long AI** (curriculum, plan)       | Route handler → enqueue → 202 + job id → client polls/subscribes       | <45s p95                            |

---

## 4. Frontend Architecture

### 4.1 Rendering strategy

| Surface         | Strategy                           | Rationale                                                                                         |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Marketing       | Static (SSG)                       | Cacheable, fast, SEO                                                                              |
| Auth            | Server Components + Server Actions | No client JS needed for forms                                                                     |
| Mission Control | **RSC shell + client islands**     | Server-render the data-heavy frame; hydrate only interactive pieces. Directly serves NFR-1.1/1.2. |
| Plan / calendar | RSC + client interaction layer     | Large payload, little interactivity                                                               |
| Coach           | Client Component + SSE             | Streaming is inherently client-side                                                               |
| Analytics       | RSC + client charts                | Aggregate on the server, render on the client                                                     |

### 4.2 State ownership

Three kinds of state, three tools, no overlap. Ambiguity here is what makes frontends rot.

```
SERVER STATE      → TanStack Query      goals, plans, sessions, mastery, threads
                     · query keys are hierarchical: ['plan', goalId, 'current']
                     · mutations invalidate precisely, never blanket-refetch
                     · optimistic updates on session start/complete only

UI STATE          → Zustand (slices)    modals, drawers, timer, command palette
                     · never persisted except: timer, sidebar collapse
                     · never mirrors server data

URL STATE         → nuqs / searchParams  filters, tabs, date range, selected concept
                     · anything a user could reasonably want to share or bookmark
```

**Rule:** if it came from the server, TanStack Query owns it. Copying server data into Zustand is a bug and will be rejected in review.

### 4.3 Data flow

```
Component
  → useQuery(['nextAction', goalId, minutes])
     → typed client (generated from OpenAPI)
       → GET /api/v1/goals/:id/next-action
         → route handler → service → domain core
  ← render

Mutation
  → useMutation(startSession)
     → optimistic cache write (instant UI)
       → POST /api/v1/sessions
         → on success: invalidate ['nextAction'], ['plan', goalId, 'today']
         → on error:   rollback + toast
```

### 4.4 Design system

- **Tokens first** — colour, spacing, radius, typography, motion as CSS variables; light/dark from one source.
- **shadcn/ui components are copied into `packages/ui`, then owned.** No upstream version pressure.
- **Composition over configuration** — small primitives, no 20-prop mega-components.
- **Every async surface ships four states:** loading (skeleton, never spinner), empty (with the action that fills it), error (with recovery), success.
- **AI content is visually distinct** — a consistent treatment marks anything generated (NFR-6.3).
- **Motion is meaningful and optional** — respects `prefers-reduced-motion`.

---

## 5. AI Architecture

> This is the section that differentiates FRIDAY. Read §5.1 before anything else.

### 5.1 The contract between AI and the system

```
        ┌────────────────────────────────────────────────────┐
        │   LLM MAY                    LLM MAY NOT           │
        ├────────────────────────────────────────────────────┤
        │ decompose a syllabus         set a mastery score    │
        │ estimate effort (a priori)   compute a due date     │
        │ generate questions           decide the Next Action │
        │ grade against a rubric       declare on-track       │
        │ explain a decision           write DB rows directly │
        │ converse and coach           override a constraint  │
        │ propose a plan change        commit a plan change   │
        └────────────────────────────────────────────────────┘
                     Everything on the right is
                     computed by packages/core.
```

The LLM's structured output is always an **input to** or an **explanation of** a deterministic computation. It is never the computation. This single rule is what makes FRIDAY's numbers trustworthy and its behaviour debuggable.

### 5.2 AI subsystem layout

```
packages/ai/
  ├── router/          model selection, fallback chain, cost accounting
  ├── context/         LearnerContextPacket assembly (deterministic, budgeted)
  ├── agents/          the six cognitive units
  ├── tools/           typed tool definitions (read tools, write tools)
  ├── prompts/         versioned prompt modules
  ├── guardrails/      input sanitisation, output validation, injection defence
  └── evals/           golden datasets + scoring harness
```

### 5.3 Model routing

Model choice is a **policy**, not a per-call decision. Routing lives in one place and is instrumented.

| Task                                                          | Model                       | Why                                                           |
| ------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| Curriculum decomposition, root-cause analysis, plan reasoning | `claude-opus-4-8`           | Deep multi-step reasoning; low volume, high stakes, run async |
| Coach conversation, question generation, insight writing      | `claude-sonnet-5`           | Best latency/quality balance for interactive work             |
| Classification, tagging, short grading, nudge copy, titles    | `claude-haiku-4-5-20251001` | High volume, low complexity — the cost lever                  |

**Cost controls (NFR-4.5, budget $0.60/user/month):**

1. **Prompt caching** on the stable prefix of the Learner Context Packet — the largest single saving, since the same learner context is reused across every call in a session.
2. **Generated content is a shared asset** — questions and explanations are cached by `(concept, difficulty, style)` and reused across learners with per-learner exposure tracking.
3. **Deterministic-first** — never call a model for something `packages/core` can compute.
4. **Budget enforcement** — per-user monthly ceiling; on breach, route down a tier and surface an honest notice rather than failing silently.
5. **Async batching** — reflection, embedding, and nudge copy are batched off the request path.

### 5.4 The Learner Context Packet

Every AI call receives context assembled by a **deterministic builder**, not by the model deciding what to fetch. This makes AI behaviour reproducible and cost predictable.

```ts
type LearnerContextPacket = {
  identity: { displayName; timezone; locale };
  goal: { title; type; targetDate; daysRemaining; intensity };
  status: { progressPct; onTrack; projectedCompletion; weeklyAdherence };
  plan: { todayBlocks; thisWeekSummary; currentPlanVersion };
  mastery: { strongest: Concept[5]; weakest: Concept[10]; dueForReview: n };
  recent: { last5Sessions; last3Assessments };
  facts: LearnerFact[]; // reflective memory, confidence-ranked
  retrieved: Chunk[]; // semantic hits, only when the query warrants it
  meta: { packetVersion; tokenCount; assembledAt };
};
```

**Assembly rules:**

- **Token budget is hard-capped** per agent (e.g. Coach 8k, Planner 16k) and enforced by tiered truncation — drop `retrieved`, then `recent`, then low-confidence `facts`. Never drop `goal` or `status`.
- **Stable prefix ordering** so prompt caching actually hits: identity → goal → status → plan → mastery → facts → retrieved → query.
- **Semantic retrieval is conditional.** A router classifies the query; only conceptual/historical queries trigger a vector search. Most Coach turns need none.
- The packet is **logged with every AI call** — reproducing a bad response means replaying the packet.

### 5.5 The six cognitive units

Not one omniscient agent. Six narrow ones, each with a schema, a model tier, and an owned failure mode.

| Agent                    | Trigger                         | Input                                        | Output (schema-validated)                                                                                                                                                      | Fallback on failure                           |
| ------------------------ | ------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Curriculum Architect** | Goal created                    | goal, level, scope, **canonical vocabulary** | Subject→Unit→Topic→Concept tree + prerequisite edges + minute/difficulty estimates + **a `concept_key` per concept, mapped to an existing `canonical_concepts` row or `null`** | Offer preset template or manual outline       |
| **Planner Advisor**      | Plan generation / re-plan       | packet + candidate schedule from core        | Rationale, risk flags, proposed scope cuts (ranked)                                                                                                                            | Ship the deterministic plan without narrative |
| **Coach**                | User message                    | packet + tools                               | Streamed conversation, optional tool calls                                                                                                                                     | Honest error; core loop unaffected            |
| **Diagnostician**        | Assessment graded, weekly sweep | performance history + graph                  | Insights with cited evidence, root-cause chains                                                                                                                                | Show raw stats without interpretation         |
| **Content Generator**    | Practice needed, cache miss     | concept, difficulty, style, exclusions       | Questions + options + answers + explanations + rubrics                                                                                                                         | Serve cached/adjacent-difficulty questions    |
| **Reflector**            | Session/thread ends (async)     | transcript + events                          | LearnerFacts with confidence + source citation                                                                                                                                 | Skip silently — never user-visible            |

**Orchestration:** a router plus a tool-calling loop, in-process. No graph framework at M0/M1. LangGraph.js gets adopted only if a flow genuinely needs multi-step state machines with checkpointing — and that decision must be written down here, not made in a PR.

### 5.6 Tools

```
READ TOOLS   (no confirmation)     WRITE TOOLS  (explicit user confirmation, M1)
─────────────────────────────      ──────────────────────────────────────────────
get_goal_status                    reschedule_block
get_plan(range)                    mark_concept_known
get_mastery(conceptIds?)           add_concept
get_weak_concepts(n)               create_task
get_due_reviews                    trigger_replan
get_session_history(n)             update_availability
search_memory(query)               start_session
```

Every tool: Zod-typed args, user-scoped execution, per-turn call ceiling, full tracing. **Write tools return a _proposal_; the service executes only after in-UI confirmation.** No model output mutates learner state unconfirmed.

#### Tools are declared in `ai`, executed by services

`packages/ai` may not import `packages/db` (§9) — but read tools obviously need data. The resolution is **dependency injection, and it is not optional**:

```
packages/ai  declares  →  tool SCHEMA only:  { name, description, Zod args, Zod result }
service layer supplies →  tool EXECUTOR:     (userId, args) => Promise<result>
agent construction     →  createCoach({ executors: { getPlan, getMastery, … } })
```

The agent receives an executor map at construction and calls it. It never resolves data itself, never holds a database handle, and never learns the shape of a repository.

**Why this is enforced rather than encouraged:** it keeps the context builder (§5.4) the single auditable entry point for everything a model sees. If agents could fetch, "what was in the prompt?" would become unanswerable, and both cost predictability and prompt-injection containment would be lost. The `packages/ai → packages/db` boundary is an ESLint rule added in Phase 0, so a violation fails CI rather than review.

### 5.7 Guardrails

| Risk                                                       | Control                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt injection** via notes, uploads, or pasted content | Untrusted content is wrapped in explicit delimiters and labelled as data; the system prompt states that instructions inside it are never obeyed; write tools are additionally gated by user confirmation, so injection cannot silently mutate state |
| **Hallucinated learner state**                             | State claims must come from tool results; the Coach prompt forbids asserting unavailable state                                                                                                                                                      |
| **Malformed structured output**                            | Zod validation → one repair attempt with the error → deterministic fallback                                                                                                                                                                         |
| **Invalid curriculum**                                     | Structural validator: no cycles (topological check), no orphans, minute bounds, coverage check — rejected before it reaches the DB                                                                                                                  |
| **Bad generated questions**                                | Self-check pass + user reporting → quarantine → regenerate                                                                                                                                                                                          |
| **Runaway cost**                                           | Per-call token ceiling, per-user daily/monthly budget, circuit breaker on provider error rate                                                                                                                                                       |
| **PII in prompts/logs**                                    | Redaction on the logging path; bounded retention                                                                                                                                                                                                    |
| **Quality regression**                                     | Eval suite gates every prompt change in CI (NFR-7.3)                                                                                                                                                                                                |

### 5.8 Evaluation

Prompts are code and get the same rigour. `packages/ai/evals` holds golden datasets and scorers:

| Suite      | Measures                                                 | Gate                                    |
| ---------- | -------------------------------------------------------- | --------------------------------------- |
| Curriculum | Coverage, ordering validity, estimate sanity             | Structural pass 100%; human rubric ≥4/5 |
| Questions  | Correctness, difficulty calibration, explanation quality | ≥95% factually correct                  |
| Grading    | Agreement with human labels                              | ≥90%                                    |
| Coach      | Context grounding, no fabricated state                   | 0 fabrications on the adversarial set   |
| Rationale  | Faithfulness to the actual priority factors              | ≥95% faithful                           |

CI runs a fast subset on every PR touching `packages/ai`; the full suite runs nightly.

---

## 6. Backend Architecture

### 6.1 Layers

```
Route Handler   HTTP only: parse, validate (Zod), authenticate, serialize, map errors
      ↓         No business logic. Ever.
Service         Use cases. Owns transactions, authorization, orchestration,
      ↓         event emission, cache invalidation. The only layer that may
                call repositories, domain core, AI, and the job queue together.
Domain Core     Pure functions. No I/O. Given state, returns decisions.
      ↓
Repository      Data access. User-scoped by construction. Transaction-aware.
                Returns domain types, not DB rows.
```

**Enforced by lint rules** (`packages/config/eslint`): route handlers may not import repositories; `core` may not import `db`, `ai`, or any framework.

### 6.2 Domain modules

| Module         | Owns                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `identity`     | Users, sessions, preferences, consent, onboarding state              |
| `curriculum`   | Goals, subjects/units/topics/concepts, prerequisite graph, templates |
| `planning`     | Plan versions, study blocks, tasks, scheduling, feasibility          |
| `execution`    | Sessions, task completion, evidence events                           |
| `assessment`   | Question bank, attempts, responses, grading                          |
| `memory`       | Mastery, FSRS memory states, episodic log, learner facts, embeddings |
| `intelligence` | Progress, trends, weak areas, insights, forecasting                  |
| `coach`        | Threads, messages, tool execution                                    |
| `proactivity`  | Detectors, directives, nudge policy, delivery                        |
| `platform`     | Jobs, feature flags, cost metering, admin, audit                     |

### 6.3 The domain core (`packages/core`)

The most important package in the repository. Pure, tested, portable.

> **Full specification: [AI_DECISION_ENGINE.md](AI_DECISION_ENGINE.md).** The sketches below are the shape of the algorithms; that document is their complete definition, including every factor, the selection stage, confidence scoring, traceability, and edge cases. It refines three things stated simply here: effective mastery uses a retention floor; a selection stage sits between scoring and output; and **scoring is two-tier — structural terms (Impact, Urgency, Leverage, Readiness, Cost) computed once per plan version, volatile terms (DecayRisk, effective mastery, time fit) recomputed per request over the materialised window.** That split is what makes NFR-1.7 achievable without storing a score that goes stale within a day. Where the two documents differ, AI_DECISION_ENGINE wins.

```
core/
  ├── scheduling/     plan generation, block allocation, constraint satisfaction
  ├── retention/      FSRS-5 wrapper: state transitions, due dates, retrievability
  ├── mastery/        evidence → mastery update, decay, confidence
  ├── priority/       the Next Action ranking function
  ├── feasibility/    required vs. available minutes, forecast, verdict
  ├── graph/          prerequisite traversal, readiness, topological order
  └── types/          plain domain types
```

#### Mastery model

Start explainable, upgrade later. Per Concept, mastery `m ∈ [0,1]` with confidence `c`:

```
On each EvidenceEvent e:
  expected      = m
  observed      = outcome(e)                    // 0..1 (correctness, or rating mapped)
  weight        = w_source(e) · w_difficulty(e) · w_recency(e)
  m'            = clamp01( m + K · weight · (observed − expected) )
  c'            = min(1, c + δ(e))              // grows with evidence volume/diversity

Decay (applied lazily at read time, never as a batch write):
  m_effective   = m · retrievability(memoryState, now)
```

`K` is an adaptive learning rate — high when confidence is low, low once mastery is well-established. This is an ELO-flavoured update: transparent, cheap, defensible to a user, and directly replaceable by IRT/BKT later behind the same interface.

#### Retention model

FSRS-5 via `ts-fsrs`, one memory state per `(user, concept)`. Ratings map from the four-way self-rating and from assessment outcomes. Due dates from this model are the **only** source of revision scheduling.

#### Priority function — the crown jewel

This is what produces the Next Action. It is deterministic, tunable, and fully explainable.

```
For each candidate Concept c:

  Gap(c)        = 1 − mastery_effective(c)
  Impact(c)     = exam_weight(c) × Gap(c) × Leverage(c)
      Leverage(c) = 1 + λ · normalized(count of concepts unlocked by c)

  Urgency(c)    = f(days_until_needed(c), coverage_debt)     // rises near deadline
  DecayRisk(c)  = 1 − retrievability(c)                      // from FSRS
  Readiness(c)  = Π over prerequisites p of  min(1, mastery(p) / θ)   // soft gate

  Cost(c)       = estimated_remaining_minutes(c)

  Priority(c)   = Readiness(c) × [ α·Impact + β·Urgency + γ·DecayRisk ] / Cost(c)^δ
```

- `Readiness` as a multiplier is the soft gate that stops FRIDAY recommending calculus before algebra, _without_ hard-blocking a learner who wants to push ahead.
- Dividing by `Cost^δ` (δ ≈ 0.5) biases toward high-value-per-minute work while still surfacing large, important topics.
- `α, β, γ, δ, λ, θ` are **configuration, not constants** — versioned per user cohort so they can be tuned and A/B tested.
- The factor contributions are returned alongside the ranking, which is exactly what renders "why this?" (FR-4.4). Explainability is free because the algorithm is transparent.

Candidate filtering by available time happens _after_ ranking, by selecting the highest-priority Task whose duration fits the stated window.

#### Feasibility

```
RequiredMinutes  = Σ_c remaining_learn(c) + remaining_practice(c) + projected_reviews(c)
AvailableMinutes = Σ_days capacity(d) × reliabilityFactor(user)   // learned adherence
Slack            = Available − Required

verdict = Slack ≥ 0.15·Required  → on_track
        | Slack ≥ 0              → at_risk
        | Slack <  0             → not_feasible

projectedCompletion = earliest date where cumulative capacity ≥ RequiredMinutes
```

`reliabilityFactor` — the ratio of planned to actually-completed minutes — is why FRIDAY's forecasts should beat a naive planner's. It plans against the user the system has observed, not the user they described at signup.

#### Scheduler

Constraint-aware greedy with local repair; not an ILP solver, and deliberately so — it must be fast, incremental, and explainable.

```
1. Topologically order concepts by prerequisites
2. Compute priority for all unstarted/incomplete concepts
3. Walk the day grid to the deadline:
     a. place due reviews first        (retention debt compounds — it is never deferred)
     b. fill remaining capacity by descending priority, respecting readiness
     c. interleave learn / practice within a day (spacing + variety)
     d. honour locked blocks and blocked times
4. Insert assessment checkpoints at cadence
5. Reserve buffer days near the deadline (default 10% of remaining span)
6. Local repair pass: fix over-long single-topic runs, balance subject variety
7. Compute feasibility → emit verdict + remediation options if needed
```

### 6.4 Events

Every state change appends to `learning_events` inside the same transaction as the write.

```
Service.completeSession()
  └─ tx:
       update session
       insert evidence_events[]
       update mastery[]           (via core)
       update memory_states[]     (via core, FSRS)
       update task status
       insert learning_events[]   ← immutable audit + replay source
     commit
  └─ after commit:
       invalidate next-action cache
       emit inngest: "session.completed"  → reflection, drift check, insight sweep
```

Events are emitted **after commit**, never inside the transaction — otherwise a rollback ships a lie.

### 6.5 Background jobs

| Job                       | Type  | Cadence / trigger                                          |
| ------------------------- | ----- | ---------------------------------------------------------- |
| `curriculum.generate`     | event | goal created                                               |
| `plan.generate`           | event | curriculum ready, availability changed, manual             |
| `plan.nightly-replan`     | cron  | 02:00 in each user's local timezone (fan-out by tz bucket) |
| `reviews.due-sweep`       | cron  | hourly                                                     |
| `memory.reflect`          | event | session/thread completed                                   |
| `memory.embed`            | event | note/message created                                       |
| `memory.consolidate`      | cron  | weekly                                                     |
| `intelligence.insights`   | cron  | weekly + after assessments                                 |
| `proactivity.detect`      | cron  | hourly                                                     |
| `proactivity.daily-brief` | cron  | per-user local morning                                     |
| `notifications.deliver`   | event | directive created                                          |
| `platform.cost-rollup`    | cron  | daily                                                      |

All jobs: idempotency keys, exponential backoff, dead-letter queue, and a user-scoped concurrency limit so one heavy user cannot starve the queue.

---

## 7. Authentication & Authorization Flow

### 7.1 Session flow

```
Sign-up ──▶ POST /api/v1/auth/sign-up
              └─ Argon2id hash → create user → send verification email
Sign-in ──▶ POST /api/v1/auth/sign-in
              └─ verify → create session row → set httpOnly Secure SameSite=Lax cookie
                 (session token in cookie; session record in Postgres — revocable)
Request ──▶ middleware: read cookie → validate session (Redis cache, Postgres fallback)
              └─ attach { userId, sessionId, roles } to request context
Refresh ──▶ sliding expiry, rotated on each renewal; absolute max 30 days
Sign-out ─▶ delete session row + clear cookie (immediate revocation everywhere)
OAuth ────▶ Google: PKCE authorization code → link or create → same session model
```

**Why database sessions rather than stateless JWTs:** instant revocation, real device management, and no token-leak window. The read cost is one Redis hit.

### 7.2 Authorization

Two layers, defence in depth:

1. **Repository-level scoping (primary).** Every repository method takes `userId` as a required first argument and injects it into the `WHERE` clause. There is no repository method that can return another user's data — enforced by construction, not by discipline. This directly implements NFR-3.3.
2. **Service-level policy checks (secondary).** Resource ownership and role checks before any mutation, for cases spanning multiple aggregates.

Postgres RLS is deliberately **not** the primary mechanism — it fights connection pooling and ORM ergonomics. It stays available as a later hardening layer for a multi-tenant/institutional deployment.

### 7.3 Roles

`learner` (default) · `admin` (support/ops tooling) · `system` (job execution context). Institutional roles (`tutor`, `org_admin`) are anticipated in the schema but not implemented.

### 7.4 ADR-007, amended — why the session layer is first-party

The original ADR named **Better Auth**. Phase 0 found it incompatible with the frozen schema in a way that could not be bridged by configuration:

| Frozen schema (DATABASE_DESIGN §4.1)                       | Better Auth's model                                   |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `auth_sessions.token_hash` — _"never store the raw token"_ | `session.token` — the token itself, compared directly |
| `users.email_verified_at timestamptz`                      | `emailVerified boolean`                               |
| no verification table                                      | requires a `verification` table                       |

The first row is a security property, not a naming difference. Adopting the library would have meant either amending the frozen schema or forking its Drizzle adapter.

**Decision (approved, Phase 0): keep the first-party layer.** The blueprint takes precedence over any third-party library. What ADR-007 actually decided — database-backed sessions, revocable immediately, with PII in our own Postgres — is unchanged and fully realised. The implementation is roughly 200 lines: Argon2id hashing at OWASP parameters, opaque 32-byte tokens, and an HMAC-SHA256 digest stored in place of the token so that a database leak alone yields nothing usable.

Verified at runtime in Phase 0: the raw cookie value appears nowhere in `auth_sessions`, not even as a substring, and revoking a session invalidates it on the next request.

A custom Better Auth adapter may be revisited later if it offers a clear benefit without compromising the schema. That would be a change request, not a refactor.

---

## 8. Data Flow — worked example

**"Student completes a 45-minute session on Rotational Dynamics."**

```
1  CLIENT   POST /api/v1/sessions/{id}/complete
            { ratings:[{conceptId, rating:'hard'}], notes, actualMinutes:45 }

2  ROUTE    Zod validate → session cookie → userId

3  SERVICE  execution.completeSession(userId, sessionId, payload)
            BEGIN TX
              ├ verify ownership + session is active
              ├ core.mastery.update(evidence)      → m: 0.42 → 0.47
              ├ core.retention.review(state,'hard')→ due: +2d, stability ↓
              ├ mark task complete
              ├ append evidence_events + learning_events
            COMMIT

4  CACHE    invalidate next-action:{userId}:{goalId}

5  EMIT     inngest "session.completed"
              ├ memory.reflect       → Reflector → LearnerFact:
              │                         "Struggles with angular momentum conservation
              │                          when the axis is non-fixed" (conf 0.7)
              ├ planning.drift-check → drift 8% < 15% threshold → no re-plan
              └ intelligence.sweep   → mastery trend updated

6  CLIENT   invalidate ['nextAction'], ['plan',goalId,'today'], ['progress',goalId]

7  READ     GET /api/v1/goals/{id}/next-action?available_minutes=60
              → core.priority.rank(...)  [deterministic, <300ms]
              → structural factors read from tasks; volatile factors recomputed (§6.3)
              → NEW top action: "Practice: Torque & Angular Momentum — 30 min"
                because DecayRisk rose and mastery is now the binding gap
              → rationale rendered from a deterministic template over the live
                factor table — no LLM, no stored prose

8  UI       Mission Control renders the new action + "why this changed"
```

Note what did **not** happen: no LLM call in the hot path, and no AI-authored number anywhere in the state update.

---

## 9. Repository & Folder Structure

```
friday/
├── apps/
│   ├── web/                              # Next.js 15 — UI + API
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (marketing)/          # public, static
│   │   │   │   ├── (auth)/               # sign-in, sign-up, verify
│   │   │   │   ├── (app)/                # authenticated shell
│   │   │   │   │   ├── dashboard/        # Mission Control
│   │   │   │   │   ├── plan/
│   │   │   │   │   ├── study/[taskId]/
│   │   │   │   │   ├── practice/
│   │   │   │   │   ├── coach/
│   │   │   │   │   ├── progress/
│   │   │   │   │   ├── memory/
│   │   │   │   │   └── settings/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── admin/
│   │   │   │   └── api/
│   │   │   │       ├── v1/
│   │   │   │       │   ├── auth/
│   │   │   │       │   ├── goals/
│   │   │   │       │   ├── curriculum/
│   │   │   │       │   ├── plans/
│   │   │   │       │   ├── tasks/
│   │   │   │       │   ├── sessions/
│   │   │   │       │   ├── assessments/
│   │   │   │       │   ├── memory/
│   │   │   │       │   ├── intelligence/
│   │   │   │       │   ├── coach/
│   │   │   │       │   ├── directives/
│   │   │   │       │   └── me/
│   │   │   │       ├── inngest/          # job endpoint
│   │   │   │       └── webhooks/
│   │   │   ├── components/
│   │   │   │   ├── mission-control/
│   │   │   │   ├── plan/
│   │   │   │   ├── coach/
│   │   │   │   ├── progress/
│   │   │   │   └── shared/
│   │   │   ├── modules/                  # SERVICE LAYER (use cases)
│   │   │   │   ├── identity/
│   │   │   │   ├── curriculum/
│   │   │   │   ├── planning/
│   │   │   │   ├── execution/
│   │   │   │   ├── assessment/
│   │   │   │   ├── memory/
│   │   │   │   ├── intelligence/
│   │   │   │   ├── coach/
│   │   │   │   └── proactivity/
│   │   │   ├── jobs/                     # Inngest function definitions
│   │   │   ├── hooks/
│   │   │   ├── lib/                      # api client, query keys, utils
│   │   │   ├── stores/                   # Zustand slices
│   │   │   └── middleware.ts
│   │   └── e2e/                          # Playwright
│   │
│   └── mobile/                           # [M3] Expo — reuses packages/*
│
├── packages/
│   ├── core/                             # PURE DOMAIN — no I/O, no framework
│   │   └── src/{scheduling,retention,mastery,priority,feasibility,graph,types}/
│   ├── ai/
│   │   └── src/{router,context,agents,tools,prompts,guardrails,evals}/
│   ├── db/
│   │   └── src/{schema,migrations,repositories,seed}/
│   ├── contracts/                        # Zod schemas → OpenAPI → generated client
│   │   └── src/{schemas,openapi,client,errors}/
│   ├── ui/                               # design system
│   │   └── src/{primitives,patterns,charts,tokens}/
│   ├── observability/                    # logger, tracing, metrics
│   └── config/                           # eslint, tsconfig, tailwind presets
│
├── docs/
│   ├── adr/                              # architecture decision records
│   ├── prompts/                          # prompt changelog + eval results
│   └── runbooks/
│
├── PROJECT_VISION.md
├── PRODUCT_REQUIREMENTS.md
├── SYSTEM_ARCHITECTURE.md
├── DATABASE_DESIGN.md
├── API_SPECIFICATION.md
├── IMPLEMENTATION_ROADMAP.md
├── CLAUDE.md                             # working agreements for AI-assisted dev
├── turbo.json · pnpm-workspace.yaml · .env.example
```

### Dependency rules (lint-enforced)

```
apps/web ──▶ contracts, ui, core, ai, db, observability
packages/ai ──▶ core, contracts, observability          (may NOT import db — §5.6 injection)
packages/db ──▶ core, contracts
packages/core ──▶ (nothing)                             ← the invariant that matters
packages/contracts ──▶ (nothing but zod)
packages/ui ──▶ (nothing)                               ← presentational; data arrives as props
packages/observability ──▶ (nothing)                    ← leaf; domain depends on it, never the reverse
```

`packages/ai` not importing `db` is deliberate: AI agents receive context, they do not go fetch it. That is what makes the context builder the single, auditable entry point for what a model sees.

A workspace with no declared boundary is a hard error at lint-config load, so a new package cannot be added without consciously deciding what it may import. One further rule applies inside `apps/web`: route handlers may not import `packages/db` — they call a service (§6.1). Every rule is proven by a probe that imports a forbidden package and asserts the lint failure.

---

## 10. System Interactions

### Synchronous

| From            | To        | Protocol        | Failure behaviour                                                  |
| --------------- | --------- | --------------- | ------------------------------------------------------------------ |
| Web → API       | REST/JSON | typed client    | Retry with backoff on 5xx; error boundary                          |
| API → Postgres  | SQL/TCP   | Drizzle, pooled | Retry once on transient; 503                                       |
| API → Redis     | RESP      | Upstash         | **Fail open** — degrade to Postgres, never block                   |
| API → Anthropic | HTTPS/SSE | AI SDK          | Retry → tier fallback → provider fallback → deterministic fallback |

### Asynchronous

| Producer    | Event               | Consumers                                     |
| ----------- | ------------------- | --------------------------------------------- |
| execution   | `session.completed` | reflect · drift-check · intelligence sweep    |
| assessment  | `assessment.graded` | mastery update · insights · remediation check |
| curriculum  | `goal.created`      | curriculum generation → plan generation       |
| planning    | `plan.created`      | notify · analytics                            |
| proactivity | `directive.created` | delivery                                      |
| identity    | `user.registered`   | welcome email · analytics                     |

### Failure modes and blast radius

| Failure               | Impact                   | Mitigation                                                                                                |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Anthropic down        | No Coach, no generation  | Core loop fully intact: Next Action, plan, sessions, progress all deterministic (NFR-2.2). Honest banner. |
| Redis down            | Slower reads             | Fail open to Postgres                                                                                     |
| Inngest down          | No background processing | Events durably queued; writes and reads unaffected; jobs drain on recovery                                |
| Postgres primary down | Full outage              | Neon HA failover; reads may serve from replica                                                            |
| Cost ceiling hit      | Degraded AI              | Tier-down routing + honest user notice                                                                    |

---

## 11. Deployment Architecture

### Environments

| Env        | Host          | Database                        | AI                      | Purpose          |
| ---------- | ------------- | ------------------------------- | ----------------------- | ---------------- |
| Local      | `pnpm dev`    | Docker Postgres or Neon branch  | Real keys, cheap tier   | Development      |
| Preview    | Vercel per PR | **Neon branch per PR** (seeded) | Sandbox key, low budget | Review + E2E     |
| Staging    | Vercel        | Neon staging                    | Real, capped            | Pre-release soak |
| Production | Vercel        | Neon prod + replica             | Real, budgeted          | Live             |

Neon's database branching is the single biggest DX win here: every PR gets a real, isolated, seeded database, so migrations and analytical queries are tested for real before merge.

### Pipeline

```
push → GitHub Actions
   ├─ lint · typecheck · unit (Vitest)
   ├─ build all packages (Turborepo cached)
   ├─ migration dry-run against a Neon branch
   ├─ AI eval subset  (if packages/ai changed)
   └─ ✅ → Vercel preview + Neon branch
             └─ Playwright E2E: the Golden Path
                  └─ manual approval → merge to main
                       ├─ migrations applied (expand → deploy → contract)
                       ├─ production deploy
                       └─ smoke tests → auto-rollback on failure
```

**Migration discipline:** expand-and-contract only. Deploy schema changes that are backward compatible, ship the code, then remove the old shape in a later release. No destructive migration ships in the same deploy as the code that depends on it.

### Operations

- **Monitoring:** Sentry (errors + performance) · Axiom (structured logs + OTel traces) · PostHog (funnels, flags) · Inngest dashboard (jobs) · Neon (DB metrics).
- **Every request carries a `request_id`**, propagated through services, jobs, AI calls, and logs. One id reconstructs an entire causal chain.
- **Alerts (page):** error rate >2% for 5 min · p95 API >1s for 10 min · job failure rate >5% · DB connections >80% · AI spend >150% of daily budget.
- **Runbooks** for: AI provider outage, cost spike, migration failure, mass re-plan failure, restore-from-backup.
- **Feature flags** on every risky surface (auto re-plan, notifications, new agents) so rollback is a toggle, not a deploy.

---

## 12. Architecture Decision Log

Full ADRs live in `docs/adr/`. Summary of decisions made at design time:

| ADR | Decision                                                                   | Status                                         |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| 001 | Modular monolith over microservices                                        | Accepted                                       |
| 002 | TypeScript everywhere; Python only for future ML training                  | Accepted                                       |
| 003 | Deterministic core owns all learning-state computation                     | Accepted — **load-bearing**                    |
| 004 | Postgres as the single datastore; pgvector added in Phase 3 (CR-002, D11)  | Accepted                                       |
| 005 | REST + OpenAPI over tRPC                                                   | Accepted                                       |
| 006 | Drizzle over Prisma                                                        | Accepted                                       |
| 007 | Database-backed sessions over hosted auth, implemented first-party         | **Amended in Phase 0** — see §7.4              |
| 008 | FSRS-5 for retention scheduling                                            | Accepted                                       |
| 009 | ELO-style mastery now, IRT later behind the same interface                 | Accepted                                       |
| 010 | Inngest for durable background work                                        | Accepted                                       |
| 011 | Repository-level tenancy scoping over Postgres RLS                         | Accepted                                       |
| 012 | Six narrow agents over one general agent                                   | Accepted                                       |
| 013 | Deterministic context assembly over model-driven retrieval                 | Accepted                                       |
| 014 | Near-horizon plan materialisation (14-day window + projection)             | Accepted — **replaces full-horizon expansion** |
| 015 | Two-tier priority: structural per plan version, volatile per request       | Accepted — **load-bearing for NFR-1.7**        |
| 016 | Canonical concept vocabulary (`concept_key`) as the content-sharing bridge | Accepted                                       |
| 017 | AI tools declared in `ai`, executors injected by services                  | Accepted                                       |
| 018 | Application-generated UUIDv7 rather than a database default                | Accepted                                       |
