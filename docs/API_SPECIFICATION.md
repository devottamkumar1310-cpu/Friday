# FRIDAY — API Specification

> **Status:** Pre-Production · Source of Truth
> **Version:** 1.1 · Blueprint v1.6 · **API version:** `v1`
> **Base URL:** `https://api.friday.app/api/v1` (production) · `/api/v1` (same-origin from the web app)
> **Depends on:** [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md)

---

## 1. Design Principles

| #       | Principle                                                    | Consequence                                                                                                                                                                 |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AP1** | **Resource-oriented REST, verbs only where a resource lies** | `POST /sessions/{id}/complete` exists because "completion" is a state transition with side effects across five tables, not a field write. Everything else is CRUD on nouns. |
| **AP2** | **The contract is the schema**                               | Zod schemas in `packages/contracts` generate the OpenAPI 3.1 document _and_ the typed client. Handlers import the same schemas. Drift is structurally impossible.           |
| **AP3** | **Never return a bare array**                                | Every collection is `{ data: [...], pagination: {...} }` so pagination and metadata can be added without a breaking change.                                                 |
| **AP4** | **Slow work returns 202, not a long-held connection**        | Curriculum and plan generation are jobs. The API returns a job handle immediately.                                                                                          |
| **AP5** | **AI streams over SSE, not WebSockets**                      | One-directional token streaming does not need a bidirectional protocol. SSE survives proxies, reconnects natively, and works with plain `fetch`.                            |
| **AP6** | **Every mutating request is idempotent-capable**             | `Idempotency-Key` header supported on all `POST`. Mobile networks retry; the API must not double-charge state.                                                              |
| **AP7** | **Errors are machine-readable first**                        | A stable `code`, then a human message. Clients branch on `code`, never on message text.                                                                                     |
| **AP8** | **The API never exposes an internal id it does not own**     | UUIDv7 everywhere; no sequential ids, no enumerable resources.                                                                                                              |

---

## 2. API Modules

Modules map 1:1 to the service-layer domain modules in [SYSTEM_ARCHITECTURE.md §6.2](SYSTEM_ARCHITECTURE.md).

| Module           | Prefix                                    | Owns                                                            |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------- |
| **Auth**         | `/auth`                                   | Sign-up, sign-in, sessions, OAuth, verification, password reset |
| **Me**           | `/me`                                     | Profile, preferences, availability, consents, export, deletion  |
| **Goals**        | `/goals`                                  | Goal lifecycle, status, feasibility summary                     |
| **Curriculum**   | `/goals/{goalId}/curriculum`, `/concepts` | Tree, concepts, prerequisite graph, templates                   |
| **Planning**     | `/goals/{goalId}/plans`, `/tasks`         | Plan versions, blocks, tasks, re-planning                       |
| **Next Action**  | `/goals/{goalId}/next-action`             | The single recommendation — the hot path                        |
| **Execution**    | `/sessions`                               | Session lifecycle, ratings, evidence                            |
| **Assessment**   | `/assessments`, `/questions`              | Practice, attempts, responses, grading                          |
| **Memory**       | `/memory`                                 | Mastery, memory states, learner facts, search                   |
| **Intelligence** | `/intelligence`                           | Progress, trends, weak areas, insights, forecast                |
| **Coach**        | `/coach`                                  | Threads, messages, streaming, tool confirmation                 |
| **Directives**   | `/directives`                             | Proactive inbox, acknowledgement                                |
| **Jobs**         | `/jobs`                                   | Async job status                                                |
| **Admin**        | `/admin`                                  | Support tooling, flags, cost — `admin` role only                |

---

## 3. Conventions

### 3.1 Request

```http
POST /api/v1/sessions HTTP/1.1
Content-Type: application/json
Cookie: friday_session=<opaque>
Idempotency-Key: 018f3a2b-7c4d-7e1f-9a2b-3c4d5e6f7a8b   # optional, POST only
X-Request-Id: <uuid>                                     # optional, echoed back
```

- **Content type:** `application/json` in, `application/json` out (`text/event-stream` for streams).
- **Casing:** `camelCase` in JSON bodies. The database is `snake_case`; mapping happens in the repository layer.
- **Dates:** ISO 8601 UTC (`2026-07-24T09:30:00Z`). Calendar dates are `YYYY-MM-DD`.
- **Durations:** always integer **minutes** for planning, integer **milliseconds** for measured latency. Never mixed units.
- **Unknown fields** in a request body are rejected (`strict` Zod), not ignored — silent typo acceptance is a debugging tax.

### 3.2 Response envelope

Single resource:

```json
{
  "data": { "id": "018f3a2b-...", "title": "JEE Advanced 2027" },
  "meta": { "requestId": "018f3a2b-...", "timestamp": "2026-07-24T09:30:00Z" }
}
```

Collection:

```json
{
  "data": [/* … */],
  "pagination": { "cursor": "eyJpZCI6...", "hasMore": true, "limit": 50 },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

### 3.3 Pagination

**Cursor-based everywhere.** Offset pagination breaks when rows are inserted mid-scroll — which is exactly what happens with sessions and events.

```
GET /api/v1/sessions?limit=50&cursor=eyJpZCI6IjAxOGYzYTJi...
```

`limit` default 20, max 100. The cursor is an opaque base64 of `(sortKey, id)`. Clients must treat it as opaque.

### 3.4 Filtering, sorting, sparse fields

```
GET /api/v1/tasks?status=pending&from=2026-07-24&to=2026-07-31&sort=-scheduledDate
GET /api/v1/goals/{id}?include=curriculum,activePlan
GET /api/v1/concepts?fields=id,title,mastery
```

`include` is an allowlist per endpoint — no arbitrary graph expansion, so query cost stays bounded.

### 3.5 Standard headers on every response

| Header                                        | Purpose                                                               |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `X-Request-Id`                                | Correlates to logs, traces, and `learning_events.request_id`          |
| `X-RateLimit-Limit` / `-Remaining` / `-Reset` | Client-side backoff                                                   |
| `Cache-Control`                               | `private, no-store` by default; `private, max-age=60` on stable reads |
| `ETag`                                        | On curriculum and plan reads — these are large and change rarely      |

---

## 4. Authentication

### 4.1 Model

Opaque session tokens in httpOnly cookies, backed by `auth_sessions` rows. See [SYSTEM_ARCHITECTURE.md §7](SYSTEM_ARCHITECTURE.md) for why database sessions rather than stateless JWTs.

```
Cookie: friday_session=<opaque-token>
        HttpOnly · Secure · SameSite=Lax · Path=/ · Max-Age=2592000
```

- Sliding expiry, rotated on renewal; absolute maximum 30 days.
- Sign-out deletes the row → **revocation is immediate and global**, not "on next token expiry".
- CSRF: `SameSite=Lax` plus an `Origin` check on all mutating requests.

### 4.2 Bearer tokens (`v1.1`, for mobile and third parties)

```
Authorization: Bearer <token>
```

Same `auth_sessions` backing store, different transport. Designed for now, shipped with mobile.

### 4.3 Endpoints

| Method   | Path                              | Purpose                | Auth |
| -------- | --------------------------------- | ---------------------- | ---- |
| `POST`   | `/auth/sign-up`                   | Create account         | —    |
| `POST`   | `/auth/sign-in`                   | Password sign-in       | —    |
| `POST`   | `/auth/sign-out`                  | Revoke current session | ✓    |
| `POST`   | `/auth/verify-email`              | Confirm token          | —    |
| `POST`   | `/auth/resend-verification`       | Re-send                | ✓    |
| `POST`   | `/auth/forgot-password`           | Start reset            | —    |
| `POST`   | `/auth/reset-password`            | Complete reset         | —    |
| `GET`    | `/auth/oauth/{provider}`          | Begin OAuth (PKCE)     | —    |
| `GET`    | `/auth/oauth/{provider}/callback` | Complete OAuth         | —    |
| `GET`    | `/auth/sessions`                  | List active devices    | ✓    |
| `DELETE` | `/auth/sessions/{id}`             | Revoke one device      | ✓    |

```jsonc
// POST /auth/sign-up
{
  "email": "s@example.com",
  "password": "…",
  "displayName": "Aarav",
  "timezone": "Asia/Kolkata",
  "dateOfBirth": "2007-05-14",
}
// 201 → { "data": { "user": {…}, "requiresVerification": true } }
```

### 4.4 Authorization

Two enforcement layers, per NFR-3.3:

1. **Repository scoping** — every repository method requires `userId` and injects it into the `WHERE` clause. There is no code path that can read another user's row.
2. **Service policy** — ownership and role checks before mutations spanning aggregates.

A resource owned by another user returns **`404 NOT_FOUND`**, never `403`. Distinguishing them leaks existence.

---

## 5. Endpoint Reference

### 5.1 Me

| Method        | Path               | Notes                                                            |
| ------------- | ------------------ | ---------------------------------------------------------------- |
| `GET`         | `/me`              | Profile + onboarding state + active goal summary                 |
| `PATCH`       | `/me`              | Display name, timezone, locale, avatar                           |
| `GET` `PATCH` | `/me/preferences`  | Quiet hours, channels, directive caps, planner config            |
| `GET` `PUT`   | `/me/availability` | Weekly rules + temporary overrides (`PUT` replaces the full set) |
| `POST`        | `/me/consents`     | Record consent grant                                             |
| `POST`        | `/me/export`       | `202` → job; produces a signed download URL (FR-12.1)            |
| `DELETE`      | `/me`              | Schedules deletion, 30-day grace (FR-12.2)                       |

```jsonc
// PUT /me/availability
{
  "rules": [
    { "dayOfWeek": 1, "startTime": "18:00", "endTime": "21:30", "kind": "available" },
    { "dayOfWeek": 6, "startTime": "09:00", "endTime": "13:00", "kind": "available" },
    {
      "dayOfWeek": 0,
      "startTime": "00:00",
      "endTime": "23:59",
      "kind": "blocked",
      "effectiveFrom": "2026-08-01",
      "effectiveUntil": "2026-08-14",
    },
  ],
}
// 200 — side effect: emits availability.changed → triggers re-plan job
```

### 5.2 Goals

| Method   | Path                          | Notes                                              |
| -------- | ----------------------------- | -------------------------------------------------- |
| `POST`   | `/goals`                      | Create; `202` if curriculum generation is required |
| `GET`    | `/goals`                      | List (`?status=active`)                            |
| `GET`    | `/goals/{goalId}`             | Detail; `?include=curriculum,activePlan,progress`  |
| `PATCH`  | `/goals/{goalId}`             | Title, target date, weekly minutes, status         |
| `DELETE` | `/goals/{goalId}`             | Soft delete                                        |
| `GET`    | `/goals/{goalId}/feasibility` | Current verdict + arithmetic                       |

```jsonc
// POST /goals
{
  "title": "JEE Advanced 2027",
  "type": "exam",
  "targetDate": "2027-05-23",
  "targetWeeklyMinutes": 1800,
  "selfReportedLevel": "intermediate",
  "curriculum": { "source": "template", "templateSlug": "jee-advanced-2027" },
}
// 201 (template — instant)
// { "data": { "goal": {…}, "curriculum": { "id": "…", "totalConcepts": 412 },
//             "planJobId": "018f…" } }

// { "curriculum": { "source": "ai_generated", "scope": "Machine learning fundamentals…" } }
// 202 (AI path)
// { "data": { "goal": {…}, "jobs": { "curriculum": "018f…" } } }
```

```jsonc
// GET /goals/{goalId}/feasibility  → 200
{
  "data": {
    "verdict": "at_risk",
    "requiredMinutes": 74400,
    "availableMinutes": 78000,
    "slackMinutes": 3600,
    "slackPercent": 4.8,
    "projectedCompletionDate": "2027-05-11",
    "reliabilityFactor": 0.82,
    "explanation": "You have 4.8% buffer. At your observed completion rate (82% of planned minutes), you finish 12 days before the exam — with little room for illness or slippage.",
    "remediationOptions": [
      {
        "type": "increase_hours",
        "detail": "+90 min/week moves you to on_track",
        "impact": { "verdict": "on_track", "slackPercent": 16.2 },
      },
      {
        "type": "reduce_scope",
        "detail": "Drop 14 lowest-impact concepts",
        "conceptIds": ["…"],
        "impact": { "verdict": "on_track", "slackPercent": 18.9 },
      },
      {
        "type": "extend_deadline",
        "detail": "Two more weeks",
        "impact": { "verdict": "on_track" },
      },
    ],
  },
}
```

> The `explanation` string is generated **once, at plan generation, alongside the verdict it describes** — a stable-context surface, so the prose cannot drift from the numbers it explains ([AI_DECISION_ENGINE §12.2](AI_DECISION_ENGINE.md#122-the-generation-rule)). The numbers themselves come from `packages/core/feasibility` (architecture principle A1). This differs from the Next Action rationale, whose factors move continuously and which is therefore always rendered from a deterministic template at request time.

### 5.3 Curriculum

| Method   | Path                                    | Notes                                                            |
| -------- | --------------------------------------- | ---------------------------------------------------------------- |
| `GET`    | `/curriculum/templates`                 | Published presets (`?examBoard=&region=`)                        |
| `GET`    | `/goals/{goalId}/curriculum`            | Full tree; `ETag`-cached                                         |
| `POST`   | `/goals/{goalId}/curriculum/regenerate` | `202` → job                                                      |
| `GET`    | `/concepts/{conceptId}`                 | Detail + mastery + memory state + prerequisites                  |
| `PATCH`  | `/concepts/{conceptId}`                 | Title, estimate, weight, `status` (`already_known` / `excluded`) |
| `POST`   | `/concepts`                             | Add a concept to a topic                                         |
| `GET`    | `/goals/{goalId}/graph`                 | Knowledge graph (nodes + edges + mastery heat)                   |
| `POST`   | `/concept-edges`                        | Add an edge — **409 on cycle**                                   |
| `DELETE` | `/concept-edges/{id}`                   | Remove an edge                                                   |

```jsonc
// PATCH /concepts/{conceptId}
{ "status": "already_known" }
// 200 — side effects: excluded from planning, feasibility recomputed,
//        replan job enqueued if the change is material
```

### 5.4 Planning

| Method  | Path                                                   | Notes                                                                                           |
| ------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET`   | `/goals/{goalId}/plans`                                | Version history with reasons                                                                    |
| `GET`   | `/goals/{goalId}/plans/current`                        | Active plan                                                                                     |
| `GET`   | `/goals/{goalId}/plans/{version}`                      | A specific version                                                                              |
| `POST`  | `/goals/{goalId}/plans/regenerate`                     | `202` → job; `{ reason, options? }`                                                             |
| `GET`   | `/goals/{goalId}/plans/current/diff?against={version}` | What changed and why                                                                            |
| `GET`   | `/goals/{goalId}/schedule`                             | Blocks + tasks within the plan's materialised window; **week-granularity projection beyond it** |
| `GET`   | `/tasks`                                               | `?date=` `?status=` `?goalId=`                                                                  |
| `GET`   | `/tasks/{taskId}`                                      | Detail + concepts + live factor breakdown + rendered rationale                                  |
| `PATCH` | `/tasks/{taskId}`                                      | `status`, `scheduledDate`, `skippedReason`                                                      |
| `POST`  | `/study-blocks/{blockId}/lock`                         | Fix a block; re-planner routes around it                                                        |

```jsonc
// GET /goals/{goalId}/schedule?from=2026-07-24&to=2026-07-30  → 200
{
  "data": {
    "planVersion": 7,
    "window": { "start": "2026-07-24", "end": "2026-08-07" }, // materialised range
    // days[] is returned only for dates inside the window.
    // Requests extending past window.end also return `projection`:
    //   [{ "week": "2026-W41", "conceptIds": ["…"], "plannedMinutes": 640 }]
    "days": [
      {
        "date": "2026-07-24",
        "capacityMinutes": 210,
        "plannedMinutes": 195,
        "blocks": [
          {
            "id": "018f…",
            "startTime": "18:00",
            "endTime": "21:30",
            "plannedMinutes": 195,
            "isLocked": false,
            "tasks": [
              {
                "id": "018f…",
                "type": "revise",
                "title": "Review: Rotational Dynamics",
                "estimatedMinutes": 25,
                "status": "pending",
                "concepts": [{ "id": "018f…", "title": "Angular Momentum" }],
              },
              {
                "id": "018f…",
                "type": "learn",
                "title": "Learn: Simple Harmonic Motion",
                "estimatedMinutes": 90,
                "status": "pending",
              },
            ],
          },
        ],
      },
    ],
  },
}
```

### 5.5 Next Action — the hot path

> **NFR-1.7: p95 < 300 ms. No LLM call is permitted in this path.** Ranking comes from `packages/core/priority`: structural factors are read from `tasks.structural_factors` (computed once per plan version), volatile factors are recomputed over the plan's materialised window ([AI_DECISION_ENGINE §6.0](AI_DECISION_ENGINE.md#60-when-each-term-is-computed)). The `rationale` string is rendered from a **deterministic template** over the live factor table — never stored prose, never generated inline.

| Method | Path                               | Notes                                              |
| ------ | ---------------------------------- | -------------------------------------------------- |
| `GET`  | `/goals/{goalId}/next-action`      | The single recommendation                          |
| `POST` | `/goals/{goalId}/next-action/skip` | Record a skip + reason; returns the next candidate |

```
GET /api/v1/goals/{goalId}/next-action?availableMinutes=25&energy=low
```

```jsonc
// 200
{
  "data": {
    "action": {
      "taskId": "018f…",
      "type": "revise",
      "title": "Review: Torque & Angular Momentum",
      "estimatedMinutes": 25,
      "concepts": [{ "id": "018f…", "title": "Angular Momentum", "mastery": 0.47 }],
      "rationale": "You rated this 'hard' two days ago and its retention is dropping fastest of anything due this week. Twenty-five minutes here protects three downstream topics.",
    },
    "why": {
      "priorityScore": 8.42,
      "factors": {
        "impact": {
          "value": 0.71,
          "contribution": 0.34,
          "detail": "High exam weight, mastery 0.47",
        },
        "urgency": {
          "value": 0.44,
          "contribution": 0.18,
          "detail": "302 days to exam; not yet urgent",
        },
        "decayRisk": {
          "value": 0.83,
          "contribution": 0.41,
          "detail": "Retrievability 17% — due now",
        },
        "readiness": { "value": 1.0, "contribution": null, "detail": "All prerequisites met" },
        "cost": { "value": 25, "contribution": 0.07, "detail": "Fits your 25 minutes" },
      },
      "dominantFactor": "decayRisk",
    },
    "alternates": [
      {
        "taskId": "018f…",
        "title": "Practice: Kinematics problems",
        "estimatedMinutes": 20,
        "priorityScore": 7.11,
      },
      {
        "taskId": "018f…",
        "title": "Learn: SHM introduction",
        "estimatedMinutes": 25,
        "priorityScore": 6.02,
      },
    ],
    "computedAt": "2026-07-24T09:30:00Z",
    "cacheHit": true,
  },
}
```

**Caching:** Redis, key `next-action:{userId}:{goalId}:{minutesBucket}`, TTL 5 min. Invalidated on session completion, plan regeneration, task status change, and assessment grading. `cacheHit` is exposed for debugging and observability.

**204 No Content** when the goal is complete or nothing is schedulable — with a `Link` header pointing at the reason.

### 5.6 Execution

| Method | Path                      | Notes                                      |
| ------ | ------------------------- | ------------------------------------------ |
| `POST` | `/sessions`               | Start. Supports `Idempotency-Key`          |
| `GET`  | `/sessions`               | History, cursor-paginated                  |
| `GET`  | `/sessions/{id}`          | Detail                                     |
| `POST` | `/sessions/{id}/pause`    | Server-authoritative timing                |
| `POST` | `/sessions/{id}/resume`   |                                            |
| `POST` | `/sessions/{id}/complete` | **The most important write in the system** |
| `POST` | `/sessions/{id}/abandon`  | No evidence recorded                       |

```jsonc
// POST /sessions
{ "goalId": "018f…", "taskId": "018f…", "originatedFrom": "recommendation" }
// 201 → { "data": { "id": "018f…", "startedAt": "…", "status": "active" } }
```

```jsonc
// POST /sessions/{id}/complete
{ "activeMinutes": 27,
  "ratings": [{ "conceptId": "018f…", "rating": "hard", "confidence": 0.4 }],
  "notes": "Still shaky when the axis of rotation moves." }
// 200
{ "data": {
  "session": { "id": "018f…", "activeMinutes": 27, "status": "completed" },
  "changes": {
    "mastery":   [{ "conceptId": "018f…", "before": 0.42, "after": 0.47, "delta": 0.05 }],
    "retention": [{ "conceptId": "018f…", "previousDue": "2026-07-24", "nextDue": "2026-07-26",
                    "intervalDays": 2, "stabilityChange": -0.3 }],
    "goalProgress": { "before": 0.231, "after": 0.238 }
  },
  "nextActionInvalidated": true
} }
```

> Returning `changes` is a deliberate product decision, not an API convenience: it is what lets the UI show the learner that their work moved something real. Invisible progress is why study tools get abandoned (pain point P10).

### 5.7 Assessment

| Method | Path                         | Notes                                             |
| ------ | ---------------------------- | ------------------------------------------------- |
| `POST` | `/assessments`               | Create a practice set or quiz                     |
| `GET`  | `/assessments/{id}`          | Detail                                            |
| `POST` | `/assessments/{id}/attempts` | Start an attempt                                  |
| `GET`  | `/attempts/{id}`             | State + questions (answers withheld until submit) |
| `POST` | `/attempts/{id}/responses`   | Submit one answer; graded inline                  |
| `POST` | `/attempts/{id}/submit`      | Finalise → scored report                          |
| `POST` | `/questions/{id}/report`     | Flag a bad question → quarantine                  |

```jsonc
// POST /assessments
{
  "goalId": "018f…",
  "type": "practice_set",
  "conceptIds": ["018f…"],
  "questionCount": 10,
  "difficulty": "adaptive",
}
// 201 if the cache can serve it · 202 + jobId if generation is required
```

```jsonc
// POST /attempts/{id}/responses
{ "questionId": "018f…", "answer": { "selected": "b" }, "responseMs": 42000 }
// 200
{ "data": { "isCorrect": false, "score": 0,
            "correctAnswer": { "selected": "c" },
            "explanation": "Angular momentum is conserved only when net external torque is zero…",
            "gradingMethod": "deterministic",
            "masteryDelta": { "conceptId": "018f…", "before": 0.47, "after": 0.44 } } }
```

### 5.8 Memory

| Method   | Path                 | Notes                                                |
| -------- | -------------------- | ---------------------------------------------------- |
| `GET`    | `/memory/mastery`    | Per-concept mastery (`?goalId=&sort=mastery&limit=`) |
| `GET`    | `/memory/due`        | Concepts due for review, by `dueAt`                  |
| `GET`    | `/memory/facts`      | **What FRIDAY believes about you** (FR-7.6)          |
| `PATCH`  | `/memory/facts/{id}` | Correct a fact                                       |
| `DELETE` | `/memory/facts/{id}` | Delete it — honoured immediately                     |
| `POST`   | `/memory/search`     | Semantic search across notes, messages, facts        |
| `GET`    | `/memory/timeline`   | Episodic history, cursor-paginated                   |

```jsonc
// GET /memory/facts?category=misconception  → 200
{
  "data": [
    {
      "id": "018f…",
      "category": "misconception",
      "statement": "Applies conservation of angular momentum without checking whether external torque is zero.",
      "confidence": 0.78,
      "reinforcementCount": 3,
      "evidenceRefs": [
        { "type": "session", "id": "018f…", "date": "2026-07-22" },
        { "type": "response", "id": "018f…", "date": "2026-07-24" },
      ],
      "conceptIds": ["018f…"],
      "isUserEdited": false,
    },
  ],
}
```

> Every fact carries `evidenceRefs`. A belief FRIDAY cannot source is a belief it should not hold — this is enforced at the schema level, not by prompt instruction.

### 5.9 Intelligence

| Method | Path                                   | Notes                                                                    |
| ------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `GET`  | `/intelligence/progress`               | Weighted progress + verdict + forecast                                   |
| `GET`  | `/intelligence/trends`                 | Time series (`?metric=mastery\|accuracy\|minutes\|adherence&period=30d`) |
| `GET`  | `/intelligence/weak-concepts`          | Ranked, with evidence                                                    |
| `GET`  | `/intelligence/insights`               | Generated findings                                                       |
| `POST` | `/intelligence/insights/{id}/dismiss`  |                                                                          |
| `GET`  | `/intelligence/root-cause/{conceptId}` | Prerequisite-chain analysis (M2)                                         |
| `GET`  | `/intelligence/weekly-review`          | Digest                                                                   |

```jsonc
// GET /intelligence/progress?goalId=018f…  → 200
{
  "data": {
    "weightedProgress": 0.238,
    "conceptsMastered": 61,
    "conceptsTotal": 412,
    "verdict": "at_risk",
    "projectedCompletionDate": "2027-05-11",
    "daysRemaining": 302,
    "velocity": { "conceptsPerWeek": 4.2, "requiredPerWeek": 5.6, "trend": "declining" },
    "retentionHealth": { "dueNow": 12, "overdue": 3, "atRisk": 27 },
    "adherence": { "last7d": 0.71, "last30d": 0.82 },
  },
}
```

### 5.10 Coach

| Method   | Path                             | Notes                           |
| -------- | -------------------------------- | ------------------------------- |
| `GET`    | `/coach/threads`                 | List                            |
| `POST`   | `/coach/threads`                 | Create                          |
| `GET`    | `/coach/threads/{id}`            | Messages                        |
| `POST`   | `/coach/threads/{id}/messages`   | **SSE stream**                  |
| `POST`   | `/coach/tool-calls/{id}/confirm` | Approve a proposed write action |
| `POST`   | `/coach/tool-calls/{id}/reject`  | Decline it                      |
| `DELETE` | `/coach/threads/{id}`            | Archive                         |

```http
POST /api/v1/coach/threads/{id}/messages
Accept: text/event-stream

{ "content": "I keep getting rotational motion problems wrong. What do I do?" }
```

```
event: start
data: {"messageId":"018f…","model":"claude-sonnet-5"}

event: tool_call
data: {"name":"get_weak_concepts","args":{"limit":5}}

event: tool_result
data: {"name":"get_weak_concepts","summary":"5 concepts returned"}

event: delta
data: {"text":"Looking at your last three sessions, the pattern isn't rotational motion "}

event: delta
data: {"text":"broadly — it's specifically when the axis of rotation moves. "}

event: proposal
data: {"toolCallId":"018f…","name":"create_task","args":{"type":"learn","conceptId":"018f…","title":"Learn: Moment of inertia about a moving axis"},"requiresConfirmation":true}

event: done
data: {"messageId":"018f…","tokensIn":6210,"tokensOut":412,"costUsd":0.0182}
```

**Write tools never execute inline.** The model emits a `proposal`; the UI renders a confirmation; `POST /coach/tool-calls/{id}/confirm` executes it server-side. This is what makes prompt injection unable to silently mutate learner state (NFR-3.6).

### 5.11 Directives

| Method | Path                       | Notes                                              |
| ------ | -------------------------- | -------------------------------------------------- |
| `GET`  | `/directives`              | Inbox (`?status=pending,delivered`)                |
| `POST` | `/directives/{id}/seen`    |                                                    |
| `POST` | `/directives/{id}/act`     | Records conversion — feeds the relevance threshold |
| `POST` | `/directives/{id}/dismiss` |                                                    |
| `GET`  | `/directives/daily-brief`  | Today's brief                                      |

### 5.12 Jobs

| Method | Path                   | Notes                               |
| ------ | ---------------------- | ----------------------------------- |
| `GET`  | `/jobs/{jobId}`        | Status; poll or use the SSE variant |
| `GET`  | `/jobs/{jobId}/stream` | SSE progress for long generations   |

```jsonc
// GET /jobs/{jobId}  → 200
{
  "data": {
    "id": "018f…",
    "type": "curriculum.generate",
    "status": "running",
    "progress": {
      "percent": 62,
      "stage": "generating_prerequisites",
      "message": "Mapping prerequisites across 340 concepts",
    },
    "startedAt": "…",
    "estimatedCompletionAt": "…",
    "result": null,
    "error": null,
  },
}
```

Statuses: `queued` · `running` · `completed` · `failed` · `cancelled`.
Progress is streamed rather than spun on, per FR-1.4 — a blank spinner during a 45-second generation is an abandonment risk.

### 5.13 Admin (`admin` role)

`GET /admin/users` · `GET /admin/users/{id}` · `GET /admin/jobs` · `POST /admin/jobs/{id}/retry` · `GET /admin/ai-costs` · `GET` `PATCH` `/admin/feature-flags`.

Every admin read and write is written to `audit_log`.

---

## 6. Error Handling

### 6.1 Shape

```json
{
  "error": {
    "code": "PLAN_NOT_FEASIBLE",
    "message": "This goal cannot be completed by the target date with your current availability.",
    "details": [
      {
        "field": "targetDate",
        "issue": "requires_extension",
        "requiredMinutes": 74400,
        "availableMinutes": 61200
      }
    ],
    "requestId": "018f3a2b-…",
    "docsUrl": "https://docs.friday.app/errors/PLAN_NOT_FEASIBLE",
    "retryable": false
  }
}
```

Clients branch on `code`. `message` is user-presentable English and may be reworded at any time without a version bump. `details` is structured and endpoint-specific.

### 6.2 Status codes

| Code  | Used for                                                                            |
| ----- | ----------------------------------------------------------------------------------- |
| `200` | Success                                                                             |
| `201` | Resource created                                                                    |
| `202` | Accepted — async job started, `jobId` returned                                      |
| `204` | Success, no body (e.g. no action available)                                         |
| `400` | Malformed request                                                                   |
| `401` | Missing or invalid session                                                          |
| `403` | Authenticated but not permitted (role)                                              |
| `404` | Not found **or not owned** — deliberately indistinguishable                         |
| `409` | State conflict (session already active, prerequisite cycle, duplicate plan version) |
| `410` | Gone (deprecated API version, expired job result)                                   |
| `422` | Valid JSON, failed domain validation                                                |
| `429` | Rate limited — `Retry-After` present                                                |
| `500` | Unexpected — always logged with `requestId`                                         |
| `503` | Dependency unavailable — `Retry-After` present                                      |

### 6.3 Error codes

| Domain     | Codes                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth       | `INVALID_CREDENTIALS` · `EMAIL_NOT_VERIFIED` · `SESSION_EXPIRED` · `EMAIL_IN_USE` · `WEAK_PASSWORD` · `OAUTH_FAILED` · `MINOR_CONSENT_REQUIRED` · `UNDER_MINIMUM_AGE` · `DATE_OF_BIRTH_REQUIRED` |
| Validation | `VALIDATION_FAILED` · `UNKNOWN_FIELD` · `INVALID_DATE_RANGE`                                                                                                                                     |
| Resource   | `NOT_FOUND` · `ALREADY_EXISTS` · `CONFLICT` · `FORBIDDEN`                                                                                                                                        |
| Goal       | `GOAL_LIMIT_REACHED` · `TARGET_DATE_IN_PAST` · `GOAL_NOT_ACTIVE`                                                                                                                                 |
| Curriculum | `CURRICULUM_GENERATION_FAILED` · `PREREQUISITE_CYCLE` · `TEMPLATE_NOT_FOUND` · `CURRICULUM_VALIDATION_FAILED`                                                                                    |
| Planning   | `PLAN_NOT_FEASIBLE` · `NO_AVAILABILITY_DEFINED` · `PLAN_GENERATION_FAILED` · `REPLAN_IN_PROGRESS`                                                                                                |
| Execution  | `SESSION_ALREADY_ACTIVE` · `SESSION_NOT_ACTIVE` · `TASK_ALREADY_COMPLETED`                                                                                                                       |
| Assessment | `NO_QUESTIONS_AVAILABLE` · `ATTEMPT_ALREADY_SUBMITTED` · `GRADING_FAILED`                                                                                                                        |
| AI         | `AI_UNAVAILABLE` · `AI_BUDGET_EXCEEDED` · `AI_VALIDATION_FAILED` · `AI_TIMEOUT` · `CONTEXT_TOO_LARGE`                                                                                            |
| Rate       | `RATE_LIMITED` · `IDEMPOTENCY_CONFLICT`                                                                                                                                                          |

### 6.4 AI-specific behaviour

| Situation                              | Response                                | Client behaviour                                                                                               |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Provider down                          | `503 AI_UNAVAILABLE`, `Retry-After: 30` | Show honest banner. **Core loop keeps working** — Next Action, plan, sessions are all deterministic (NFR-2.2). |
| Structured output invalid after repair | `422 AI_VALIDATION_FAILED`              | Offer the deterministic fallback (template curriculum, cached questions)                                       |
| Monthly budget exceeded                | `200` with `meta.degraded: true`        | Model tiered down; user notified honestly, not silently                                                        |
| Stream fails mid-response              | `event: error` in the SSE stream        | Partial content is preserved; retry offered                                                                    |

### 6.5 Rate limits

| Scope                 | Limit         |
| --------------------- | ------------- |
| Global per user       | 300 req / min |
| Auth endpoints per IP | 10 / min      |
| AI chat messages      | 30 / hour     |
| Question generation   | 100 / day     |
| Plan regeneration     | 10 / hour     |
| Export                | 3 / day       |

Sliding window in Redis. Exceeding returns `429` with `Retry-After` and `X-RateLimit-Reset`. **Redis unavailability fails open** — a limiter outage must never take down sign-in.

---

## 7. Versioning

### 7.1 Strategy

**URL path versioning** — `/api/v1/…`. Header-based negotiation is more elegant and worse in practice: it is invisible in logs, in browser dev tools, and in a curl command a support engineer pastes into a ticket.

### 7.2 What is and is not breaking

| Non-breaking (no version bump)         | Breaking (requires `v2`)                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| Adding an endpoint                     | Removing or renaming an endpoint                             |
| Adding an optional request field       | Adding a required request field                              |
| Adding a response field                | Removing or renaming a response field                        |
| Adding an enum value **to a response** | Adding an enum value to a **request** the server must accept |
| Relaxing validation                    | Tightening validation                                        |
| Changing `error.message` text          | Changing an `error.code`                                     |
| Performance and ordering changes       | Changing a field's type or semantics                         |

> Clients must ignore unknown response fields and must not exhaustively switch on response enums without a default branch. This is stated in the client SDK docs and is the contract that makes additive evolution safe.

### 7.3 Lifecycle

```
Active → Deprecated (6 months min) → Sunset (announced 3 months ahead) → Gone (410)
```

Deprecated versions respond with:

```http
Deprecation: true
Sunset: Wed, 01 Jul 2027 00:00:00 GMT
Link: <https://docs.friday.app/migrations/v1-to-v2>; rel="deprecation"
```

At most two versions are supported concurrently. Internally, versions share the service layer; only the contract mapping differs — `packages/contracts/src/v1` and `v2` are transformation layers, not forked business logic.

### 7.4 Contract generation pipeline

```
Zod schemas (packages/contracts/src/schemas)
   └─▶ endpoint registry (packages/contracts/src/registry.ts)
         ├─▶ zod-to-openapi ──▶ openapi.v1.json ──▶ docs site · external + mobile codegen
         ├─▶ typed client (packages/contracts/src/client.ts)
         └─▶ imported directly by route handlers for runtime validation
```

**One registry declares every endpoint**, and the OpenAPI document, the typed client, and handler validation are all projections of it. The published spec still exists and is still the contract for consumers outside this repo — which is why OpenAPI was chosen over tRPC — but the in-repo client is typed from the schemas directly rather than round-tripping through generated JSON Schema. That removes a codegen step from the critical path and makes the client's types the schemas themselves, which is what AP2 asks for.

CI fails if `openapi.v1.json` is out of date relative to the schemas, or if a change is classified as breaking without a version bump. The spec cannot drift from the implementation, because it is derived from it.

---

## 8. Idempotency

`POST` accepts `Idempotency-Key` (UUIDv7 recommended):

- The key plus a hash of the request body is stored in Redis for 24 hours alongside the response.
- Replay with the same key and same body → the cached response, plus `Idempotency-Replayed: true`.
- Same key, **different** body → `409 IDEMPOTENCY_CONFLICT`.

Required by the client on: session start, session complete, response submission, goal creation. These are the writes a flaky mobile connection will retry.

---

## 9. Webhooks (`v1.1`)

Outbound webhooks for future integrations (institutional dashboards, parent reporting):

```
POST <subscriber-url>
X-Friday-Signature: t=1753350000,v1=<hmac-sha256>
X-Friday-Event: goal.milestone_reached
```

Events: `goal.created` · `goal.milestone_reached` · `goal.at_risk` · `plan.regenerated` · `assessment.completed` · `streak.broken`.
At-least-once delivery, exponential backoff over 24 hours, signature verification with a 5-minute timestamp tolerance.

---

## 10. Endpoint Summary by Release

| Module       | M0 (Shipathon)                            | M1                              | M2+            |
| ------------ | ----------------------------------------- | ------------------------------- | -------------- |
| Auth         | sign-up, sign-in, sign-out, OAuth, verify | reset, session list             | bearer tokens  |
| Me           | `GET`/`PATCH /me`, availability           | preferences, export, delete     | —              |
| Goals        | create, get, feasibility                  | patch, list                     | multi-goal     |
| Curriculum   | templates, get tree, patch concept        | regenerate, edges, graph        | upload         |
| Planning     | current plan, schedule, tasks, regenerate | diff, history, lock             | calendar sync  |
| Next Action  | **get**                                   | skip                            | energy-aware   |
| Execution    | start, complete                           | pause/resume, history           | offline replay |
| Assessment   | create, attempt, respond, submit          | report, diagnostic              | mock tests     |
| Memory       | mastery, due                              | facts, search, timeline         | consolidation  |
| Intelligence | progress, weak-concepts                   | trends, insights, weekly review | root-cause     |
| Coach        | threads, stream (read tools)              | tool confirmation, search       | —              |
| Directives   | —                                         | inbox, brief, ack               | push           |
| Jobs         | status, stream                            | —                               | —              |
| Admin        | —                                         | users, jobs, costs, flags       | —              |
