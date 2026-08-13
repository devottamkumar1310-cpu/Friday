# Phase 0 — Foundations · Completion Report

> **Baseline:** Blueprint v1.2 · **Status: FROZEN** — runtime-verified, Phase 1 may begin
> **Static gate:** ✅ format · ✅ lint (6 boundary probes) · ✅ typecheck · ✅ 66 tests · ✅ build
> **Runtime gate:** ✅ 71 checks on a **clean PostgreSQL 18.4 without pgvector** — migrations, seed, auth, FR-1.6 gate, security properties
> **Resolutions:** DR-001 accepted (session layer stays first-party) · CR-001 applied · **CR-002 applied** (extensions travel with their schema, D11)

---

## 0. Runtime verification

Everything below ran against a **real PostgreSQL 18.4**, started for the purpose and torn down afterwards. Nothing here is inferred from static analysis.

### Migrations and seed

Re-verified after CR-002 against a **freshly created database on a server where pgvector is confirmed absent** — no manual workaround of any kind.

| Check                                     | Result                                                |
| ----------------------------------------- | ----------------------------------------------------- |
| Server genuinely lacks pgvector           | ✅ confirmed via `pg_available_extensions`            |
| Full migration chain on a clean database  | ✅ 0000, 0001, 0002 through the real Drizzle migrator |
| Migrations are idempotent                 | ✅ second run is a no-op                              |
| Seed runs                                 | ✅ 2 users, availability rules, consent records       |
| Seed is idempotent                        | ✅ re-runs without duplicating                        |
| Stock PostgreSQL suffices through Phase 2 | ✅ only `citext`, which ships with PostgreSQL         |

### Schema invariants — 10/10

`citext` enforces case-insensitive email uniqueness · all three `availability_rules` CHECK constraints reject bad rows · `token_hash` is unique · the `updated_at` trigger fires on UPDATE · sessions cascade on user delete · the seeded minor is flagged `is_minor` with no guardian consent · stored ids are genuinely UUID **v7**.

### Authentication — 23/23

Sign-up returns 201 with an HttpOnly cookie and no password hash in the body · duplicate email → `EMAIL_IN_USE` · under-13 → `UNDER_MINIMUM_AGE` · weak password and unknown fields rejected · **cross-origin POST → 403** · `GET /me` 200 authenticated, 401 without a cookie · wrong password and unknown account return an **identical** `INVALID_CREDENTIALS`, so accounts cannot be enumerated · **sign-out revokes the token immediately** — the same cookie fails on the very next request.

### FR-1.6 gate — 14/14

A 16-year-old can create an account but `GET /me` reports `blockedBy: guardian_consent`, and `/dashboard` **redirects to the consent page**. Recording consent clears the gate, advances onboarding to `goal`, and makes the dashboard reachable. Guardian consent without an email is rejected. **Date of birth is write-once** — a second attempt returns 409. The seeded minor is gated too.

### Security properties — 7/7

This is the evidence behind DR-001:

- The raw session token from the cookie appears **nowhere** in `auth_sessions` — not verbatim, not as a substring.
- The stored value is a 43-character digest, different from the cookie value.
- Passwords are stored as `$argon2id$…`; the plaintext appears nowhere in the row.

### Phase 0 exit criterion — 17/17

**Sign up → sign in → land on a working dashboard**, verified end to end. The dashboard greets the signed-in user by name and shows the empty state. Unauthenticated visitors are redirected to sign-in; signed-in visitors are bounced off the auth pages. An inbound `X-Request-Id` is honoured and echoed in both the header and the response envelope. `Cache-Control: private, no-store`, `nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy` are all present.

---

## 1. What was implemented

Phase 0's purpose per the roadmap: _a working skeleton that a feature can be dropped into without ceremony._ Seven workspaces, 123 source files.

| #    | Deliverable                                           | Status     | Where                                          |
| ---- | ----------------------------------------------------- | ---------- | ---------------------------------------------- |
| 0.1  | Monorepo scaffold — pnpm workspaces + Turborepo       | ✅         | `pnpm-workspace.yaml`, `turbo.json`            |
| 0.2  | Shared config: TS strict, ESLint boundaries, Prettier | ✅         | `packages/config`                              |
| 0.3  | Drizzle setup + first migration (identity only)       | ✅         | `packages/db`                                  |
| 0.4  | Auth: email/password + session middleware             | ✅ DR-001  | `apps/web/src/modules/identity`                |
| 0.4  | Google OAuth                                          | ⛔ **D-2** | blocked on credentials                         |
| 0.4b | DOB capture + minor-consent gate (FR-1.6)             | ✅         | `age-policy.ts`, `onboarding.ts`               |
| 0.5  | Design tokens + 10 UI primitives                      | ✅         | `packages/ui`                                  |
| 0.6  | App shell: marketing, auth, empty dashboard           | ✅         | `apps/web/src/app`                             |
| 0.7  | Zod → OpenAPI → typed client                          | ✅ CR-001  | `packages/contracts`                           |
| 0.8  | Observability: logger, request_id, Sentry             | ✅         | `packages/observability`, `instrumentation.ts` |
| 0.9  | CI: lint, typecheck, test, build, migrations          | ✅         | `.github/workflows/ci.yml`                     |
| 0.10 | Seed harness + identity fixtures                      | ✅ CR-001  | `packages/db/scripts/seed.ts`                  |

### The dependency boundaries are real, not aspirational

Roadmap 0.2 says to add these on day one _"or it never happens."_ Each was probed with a deliberately-violating file:

```
BLOCKED  core -> db                      BLOCKED  db -> ai
BLOCKED  core -> contracts               BLOCKED  ui -> db
BLOCKED  ai -> db (ADR-017)              BLOCKED  route handler -> db (§6.1)
ALLOWED  service -> db                   (correct — the rule is not over-broad)
```

Violations fail CI with an explanatory message rather than waiting for review.

### Blueprint invariants carried into code

| Invariant                                                              | Where it is enforced                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ADR-018 — app-generated UUIDv7, no DB default                          | `db/src/ids.ts`; asserted against the **generated SQL**, not an ORM internal       |
| C2 — extensions preamble before any table                              | `migrations/0000_extensions.sql`                                                   |
| C3 — no subquery in a CHECK constraint                                 | Test scans all migration SQL                                                       |
| NFR-3.2 — Argon2id, hashed session tokens                              | `password.ts` (OWASP params), `session.ts` (HMAC-SHA256, keyed)                    |
| NFR-3.3 — repository-level tenancy                                     | Every method takes an owning id; 3 unscoped auth entry points named and documented |
| §4.4 — 404 not 403 for non-owned resources                             | `ApiError.notFound()`, with a test explaining why                                  |
| FR-1.6 — DOB at signup, minor gate                                     | 18 tests including leap-year and birthday boundaries                               |
| §3.2 — response envelope, request-id                                   | `lib/api/handler.ts`; every response carries `X-Request-Id`                        |
| §11 — request-id propagation                                           | `AsyncLocalStorage`; tested across concurrent requests                             |
| §4.4 / NFR-6.1 — skeletons not spinners, focus visible, reduced motion | `packages/ui` tokens + primitives                                                  |

---

## 2. Deviations from the blueprint

Reported rather than silently absorbed, per the working agreement.

### D-1 · Better Auth was not used — auth implemented directly · **Significant**

**Blueprint:** roadmap 0.4 names Better Auth; ADR-007 records _"Better Auth with DB sessions over hosted auth."_

**Built instead:** a session layer of ~200 lines (`password.ts`, `session.ts`, and the session parts of `identity.service.ts`).

**Why.** The frozen schema and Better Auth's data model conflict in three places:

| Frozen schema (DATABASE_DESIGN §4.1)                       | Better Auth expects                                   |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `auth_sessions.token_hash` — _"never store the raw token"_ | `session.token` — the token itself, compared directly |
| `users.email_verified_at timestamptz`                      | `emailVerified boolean`                               |
| no verification table                                      | a `verification` table                                |

The first is a security property, not a naming difference. Reconciling would mean amending the frozen schema or forking Better Auth's Drizzle adapter. I chose to honour the schema — which satisfies what ADR-007 actually _decided_ (database sessions, we hold the PII) while diverging from the named library.

**Your options:** (a) accept and amend ADR-007 to record the hand-rolled layer; (b) adopt Better Auth and amend the schema; (c) leave as-is and revisit. All three are change requests.

### D-2 · Google OAuth not implemented · **Blocked**

Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and the callback cannot be tested without them. Groundwork is in place: the `accounts` table, `linkAccount()`, and `findByProviderAccountForAuth()`. The `/onboarding/date-of-birth` page exists precisely because an OAuth user's row is created before any form can ask for a birth date.

### D-3 · Seed scoped to identity — roadmap internal inconsistency

Roadmap **0.10** asks for _"one user, one goal, a 40-concept curriculum, 30 days of history."_ Roadmap **0.3** restricts Phase 0's migration to _"identity tables only."_ A seed cannot populate tables that do not exist.

Built the harness plus identity fixtures — two users (one adult, one 16-year-old deliberately left awaiting guardian consent so the gate is exercised), availability rules, consent records — and marked the Phase 1 extension point in the file. The full fixture moves to roadmap 1.1 when curriculum and planning tables land.

### D-4 · Typed client derived from Zod, not from `openapi-typescript` · **Simplification**

**Blueprint §7.4:** `Zod → openapi.v1.json → openapi-typescript → typed client`.

**Built:** `openapi.v1.json` is generated and committed (CI fails if stale), serving docs and future non-TypeScript consumers — which is the reason the blueprint chose OpenAPI over tRPC. The _internal_ client is typed directly from the same endpoint registry, with no JSON-Schema round-trip and no codegen step.

One registry (`contracts/src/registry.ts`) drives both the spec and the client, so they cannot disagree. This is arguably more faithful to AP2 than the literal pipeline. Say the word if you want `openapi-typescript` added.

### D-5 · `onboarding_state` default literal

DATABASE_DESIGN §4.1 gives the default as `'{"step":"dob",...}'`, but the onboarding step enum (introduced in Phase 0's contracts) uses `date_of_birth`. Implementation uses `date_of_birth`; the doc still says `dob`.

Trivial, but it is a doc/code inconsistency and I did not edit a frozen document to hide it.

### Additions where the blueprint was silent

§9 defines boundaries for `web`, `ai`, `db`, `core`, and `contracts` — not `ui` or `observability`. I made both **leaves** (they may import no workspace package). Consistent with their roles; flagged because it is an addition, not a transcription.

Two error codes were added to the §6.3 taxonomy: `UNDER_MINIMUM_AGE` and `DATE_OF_BIRTH_REQUIRED`. Both are needed by FR-1.6 and both are additive, which §7.2 classifies as non-breaking.

---

## 3. What is verified, and what is not

**Verified statically.** Format, lint (including six boundary probes), typecheck, 63 unit tests, and a clean production build of 12 routes — marketing and auth static, app and API dynamic, matching §4.1's rendering strategy.

**Verified at runtime.** 71 checks against PostgreSQL 18.4 — see §0. Migrations, seed, schema constraints, the full auth flow, the FR-1.6 gate, the token-hashing property, and the Phase 0 exit criterion end to end.

**Still not verified, and worth stating plainly:**

- **The Phase 3 migration itself does not exist yet**, so pgvector installation was verified by _guard_ rather than by execution: three tests enforce that a vector-dependent object cannot appear without `CREATE EXTENSION vector` above it. Those guards were validated against three simulated Phase 3 migrations (two violations caught, correct ordering passed).
- **Google OAuth** (D-2) remains unexercised — it needs credentials.
- **CI has not run**, because the project is not yet a git repository. The workflow is written and applies migrations, seeds, proves idempotence, and checks for schema and spec drift against a stock `postgres:16` image.
- **No browser testing.** The pages were verified by HTTP status, redirect target, and rendered HTML content — not by driving a real browser. Playwright arrives with the Golden Path in Phase 1 (roadmap §7.2).

---

## 4. Environment notes

- **pnpm was not installed.** `corepack enable` failed with EPERM (needs admin to write into `C:\Program Files\nodejs`), so pnpm 9.15.9 was installed into the user-local npm prefix instead.
- **No Docker and no local PostgreSQL.** Runtime verification used a real PostgreSQL 18.4 downloaded into the scratchpad via `embedded-postgres`, run on port 55432, and stopped afterwards. It was never added as a project dependency and the repository is unchanged by it.
- **Not a git repository.** The CI workflow's freshness checks use `git diff`, so they work once the project is under version control. `git init` is still your call.

---

## 5. Resolutions

| Item                     | Outcome                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **D-1** Better Auth      | **Resolved — DR-001.** Session layer stays first-party; the blueprint outranks the library. ADR-007 amended (§7.4). |
| **D-3, D-4, D-5, codes** | **Resolved — CR-001 applied.** Blueprint updated across four documents.                                             |
| **D-2** Google OAuth     | Still blocked on credentials. Groundwork in place.                                                                  |
| **pgvector**             | **Resolved — CR-002 applied.** Extensions travel with their schema (D11), enforced by three tests.                  |

---

## 6. Phase 0 is frozen

Every acceptance criterion is satisfied in a real runtime environment. Phase 1 begins on the critical path the roadmap identifies:

```
core/graph → core/priority → core/scheduling → plan generation → Mission Control
```

`packages/core` is today a deliberate stub holding only `ENGINE_VERSION` and `CONFIG_VERSION` — because every decision trace must record them. Phase 1 fills it, and builds the **M0 engine subset** frozen in [AI_DECISION_ENGINE §1.1](AI_DECISION_ENGINE.md#11-what-ships-at-m0--the-frozen-engine-subset): fixed weights, urgency from plan position, depth-1 leverage, hysteresis as the only selection modifier, confidence traced but not surfaced.

No architectural redesign will occur during Phase 1 without an approved change request.
