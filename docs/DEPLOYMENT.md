# Deploying FRIDAY

> **Baseline:** Blueprint v1.6 · Added in the Launch Readiness phase (CR-007)

This is the operational runbook. Architecture lives in [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md); this document is what someone needs to put the thing on the internet and know whether it worked.

---

## 1. What has to exist first

| Thing              | Requirement                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL 16+** | Stock. No third-party extensions are needed until pgvector arrives with `memory_chunks` (D11). Neon is the assumed host; anything Postgres-compatible works.              |
| **Node 22**        | Matches CI and the `engines` field.                                                                                                                                       |
| **TLS**            | Non-negotiable. Session cookies are `Secure`, so the app is **unusable over plaintext http** on any non-loopback host. Boot refuses to start if `APP_URL` says otherwise. |
| **A model key**    | Optional. Without one the Coach returns an honest 503 and everything else works (NFR-2.2). See §5.                                                                        |

---

## 2. Environment

Copy `.env.example`. Every variable is documented there; these are the ones that decide whether the deploy is safe.

| Variable                 | Required         | Notes                                                                                                                                                                                                |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | **yes, fatal**   | Boot refuses to start if unset or still holding the template placeholder.                                                                                                                            |
| `AUTH_SECRET`            | **yes, fatal**   | 32+ random bytes, base64. Pepper for session-token hashing. Boot refuses a short or known-placeholder value. Rotating it signs everyone out.                                                         |
| `APP_URL`                | strongly advised | The public origin. The same-origin (CSRF) check compares against it; unset, it falls back to trusting the request's own host header. Fatal in production if plaintext `http` on a non-loopback host. |
| `SENTRY_DSN`             | advised          | Server-side error reporting. Unset, exceptions reach the structured log only.                                                                                                                        |
| `NEXT_PUBLIC_SENTRY_DSN` | advised          | **Browser-side** reporting. Separate variable because it is inlined into the client bundle and is public by construction.                                                                            |
| `AI_PROVIDER`            | no               | `anthropic` \| `google` \| `fixture`. Unset infers from whichever key is present. A named provider with no key is a hard failure, never a silent fallback.                                           |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Boot-time validation is real.** `instrumentation.ts` inspects the environment on every start and throws on anything unsafe. An instance that would accept requests and fail them one learner at a time — or worse, run with a forgeable signing secret — does not start at all. This has already caught a real mistake during verification.

---

## 3. Deploy

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # idempotent; safe to run on every deploy
pnpm build
pnpm --filter @friday/web start
```

Migrations are forward-only and idempotent. Run them **before** the new code serves traffic; every migration to date is additive, so an old instance and a new schema coexist safely during a rolling deploy.

---

## 4. Health

```
GET /api/health
```

```json
{
  "data": { "status": "ok", "checks": { "database": "ok" }, "revision": null, "uptimeSeconds": 41 }
}
```

- **200** — serving. **503** — a dependency is down; take the instance out of rotation.
- Never cached (`no-store`). A cached health check reports an old moment with total confidence.
- Deliberately uninformative on failure. It is unauthenticated by necessity, so it says _whether_ a dependency answered, never its version, host, or error text.
- Set `GIT_COMMIT_SHA` (or deploy on a platform that sets `VERCEL_GIT_COMMIT_SHA`) to have `revision` identify what is actually running.

Point the load balancer and the uptime monitor here. Deployment is complete when this returns 200 **and** a sign-in page renders — a process that starts but cannot reach Postgres is not a deploy.

---

## 5. Choosing a model provider

Provider selection is configuration, never a code change (ADR-012).

```bash
AI_PROVIDER=google      GOOGLE_API_KEY=...      # Gemini
AI_PROVIDER=anthropic   ANTHROPIC_API_KEY=...   # Claude
AI_PROVIDER=fixture                             # recorded responses, no network, no cost
```

`fixture` is not "AI off with a fallback" — it is honest about itself. `isAiConfigured()` returns false for it, so the Coach returns `AI_UNAVAILABLE` rather than pretending a recorded answer is a real one. Everything deterministic keeps working.

**Free-tier Gemini is 20 requests per day per model.** That is enough to smoke-test a deploy and nothing else. Budget a paid key before inviting learners.

---

## 6. Security headers

Set automatically. `Content-Security-Policy` is built per request in `middleware.ts` because it carries a fresh nonce; the rest are static in `next.config.mjs`.

| Header                      | Value                                                      |
| --------------------------- | ---------------------------------------------------------- |
| `Content-Security-Policy`   | nonce + `strict-dynamic`; no `unsafe-inline` in script-src |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`                      |
| `X-Frame-Options`           | `DENY`                                                     |
| `X-Content-Type-Options`    | `nosniff`                                                  |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                          |
| `Permissions-Policy`        | camera, microphone, geolocation all denied                 |

`preload` is omitted from HSTS on purpose: submitting to the preload list is close to irreversible and belongs to whoever owns the domain.

**Adding an inline `<script>` will break.** That is intended. Give it the nonce from `headers().get('x-nonce')`, as the root layout's theme script does.

---

## 7. Verifying a deploy

```bash
curl -fsS https://<host>/api/health
E2E_BASE_URL=https://<host> pnpm --filter @friday/web e2e -- --project=chromium journey.spec.ts
```

The journey spec signs up a real throwaway learner and walks the whole loop. **It writes to whatever database it points at** — run it against staging, or accept the rows it leaves behind.

---

## 8. Rollback

Redeploy the previous build. Migrations are forward-only and additive: every one so far can be left in place while older code runs, so a code rollback does not require a schema rollback. If a future migration ever drops or renames a column, that stops being true — and that migration needs a deprecation window instead.

---

## 9. Backups

**Not configured by this repo, and required before real learners.** `mastery_states` and `memory_states` are the irreplaceable data: a learner's evidence history cannot be reconstructed. Point-in-time recovery on the database host, verified by an actual restore. An untested backup is a hypothesis.

---

## 10. Beta limitations

Known and deliberate. Documented here so nothing in the product implies otherwise.

### A goal is write-once

`POST /api/v1/goals` creates one; `GET /api/v1/goals/{id}` reads it. There is **no `PATCH`, `PUT`, or `DELETE`**. A learner therefore cannot change:

- the exam date
- the target exam or score
- the subjects or their priorities

Availability **can** be changed (`PUT /api/v1/me/availability`), and doing so now re-plans — see §10.1 constraint triggers.

This matters for real learners: exam boards move dates, and students switch between Mains and Advanced. The workaround for beta is to create a second goal; the first stays and is not archived, because archiving is also not implemented.

Adding goal editing is a feature, not a defect fix, and is deliberately out of scope for the beta. **Do not describe goals as editable in any onboarding copy, marketing, or support reply.**

### The only adaptive dial is session length

FRIDAY adjusts **how long a session should be**, and the Next Action is ranked and fitted against that budget. It does **not** adjust workload scaling, task difficulty, task ordering, or the amount of on-screen guidance — those dials were removed after an audit found the product announcing changes it never made.

Anything that tells a learner their plan changed must trace to `targetSessionMinutes`. `packages/core/src/adaptive/__tests__/adaptive-truth.test.ts` fails the build if a claim outside that appears in learner-facing output.
