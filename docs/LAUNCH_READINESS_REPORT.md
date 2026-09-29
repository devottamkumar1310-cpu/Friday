# Launch Readiness — Verification Report

> **Baseline:** Blueprint v1.6 · **Status: verified**
> **Static gate:** ✅ format · ✅ lint (0 warnings) · ✅ typecheck · ✅ **276 unit tests** (was 249) · ✅ production build (44 API routes, 15 pages)
> **Browser gate:** ✅ **95 tests** across desktop and an emulated phone · ✅ live Gemini streaming · ✅ graceful degradation
> **Verdict:** §8 — **ready for an initial invite-only public launch**, with three conditions that are operational rather than code.

---

## 0. What this phase was for

Phase 3 ended with an honest admission: _"the build is more complete than it is proven."_ Nothing had been seen in a browser. This phase set out to prove the product rather than extend it.

It did, and the proving found things. **Nine defects, three of which made the product unusable on its primary path** — including one that meant **no learner could create a goal at all** unless they happened to change a dropdown they had no reason to touch. Every one of them was invisible to 249 passing tests, a clean typecheck, and a successful production build, because every one of them lived in the gap between "the API is correct" and "a person can use this".

---

## 1. What was verified

| Objective                  | How                                                                                                     | Result                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Browser end-to-end testing | Playwright, production build, real PostgreSQL                                                           | ✅ 95 tests, 8 spec files           |
| Real user workflow         | Sign-up → availability → goal → plan → study → practice → progress → sign-out, driven through the DOM   | ✅ desktop **and** emulated Pixel 7 |
| Responsive design          | 320 / 390 / 768 / 1280 px × 7 pages, plus nav collapse, tap targets, the study timer                    | ✅ 32 checks                        |
| Accessibility              | axe-core (WCAG 2.1 A + AA) on 10 pages and both study states; keyboard-only operation; focus indicators | ✅ 15 checks, 0 violations          |
| Live Gemini streaming      | Real stream, wire captured and independently reassembled                                                | ✅ TTFT **1016–2294 ms**            |
| CI automation              | E2E + a11y + responsive job, dependency audit job, artefact upload                                      | ✅ commands verified locally        |
| Deployment configuration   | Health probe, boot-time env validation, CSP + HSTS, runbook                                             | ✅ [DEPLOYMENT.md](DEPLOYMENT.md)   |
| Error monitoring           | Server reporter + browser Sentry + explicit capture from both error boundaries                          | ✅                                  |
| Analytics                  | 9 server-side product events, no third-party script, no device identity                                 | ✅ CR-007                           |
| Feedback collection        | `POST /api/v1/feedback` + a form on Settings                                                            | ✅ CR-007                           |
| Performance                | Measured against every NFR-1 budget                                                                     | ✅ all met — §5                     |
| Security review            | Tenancy isolation, session handling, CSRF, headers, dependency audit                                    | ✅ 15 checks — §6                   |

---

## 2. The complete browser journey

Executed against a production build (`next start`) on PostgreSQL 18.4, as a **brand-new learner**, on **both** a desktop viewport and an emulated Pixel 7 with touch.

| #   | Step                              | Assertion that matters                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------ |
| 1   | Sign up                           | Lands in onboarding, not the dashboard                                   |
| 2   | Overlapping availability rejected | Inline explanation; **Save disabled** until fixed; recovers on removal   |
| 3   | Availability saved                | `15h 30m` computed live; continues **to the goal step**                  |
| 4   | Goal created                      | Curriculum + feasibility + 14-day plan, then a real Next Action          |
| 5   | "Why this?"                       | The deterministic factor breakdown renders                               |
| 6   | Study session                     | Timer **advances**; pause/resume; unrated finish **refused**             |
| 7   | Session completed                 | Mastery delta shown as a toast — `Mastery 0% → 10%`                      |
| 8   | Second concurrent session (E-19)  | Refused; the page shows the open session instead of offering a new start |
| 9   | Practice                          | Every question type answerable; graded feedback; **mastery moves again** |
| 10  | Progress                          | Reflects the work                                                        |
| 11  | All seven destinations            | Render, with exactly one `aria-current="page"`                           |
| 12  | Sign out                          | Protected pages unreachable; **the token is dead server-side**           |

Steps 7 and 9 are the point: the loop closes through the UI, not merely through the API beneath it.

---

## 3. Defects found and fixed

Severity is judged by consequence to a learner, not by how hard the fix was.

### Critical — the product did not work

| #   | Defect                                                                                                                                                                                                                                                                                                                          | Fix                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | **The goal form could not be submitted in its default state.** `selfReportedLevel` defaults to "Prefer not to say", which a native `<select>` reports as `""` — not a member of the enum and not `undefined` either. Client validation failed before any request was sent. Creating a goal is the _only_ path into the product. | `setValueAs` maps empty to absent. Contract was already correct. |

Every prior phase missed this because every prior phase tested with `curl`, which sends a valid body. The form was never submitted by a person.

### High — a learner could get stuck or be misled

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                     | Fix                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2   | **Onboarding dead-ended into Settings.** The next step came from a `?next=goal` query parameter that every internal link happened to set — and that a refresh, bookmark, or back-navigation dropped. The learner was never offered the goal step, and was shown "Step 1 of 2" while editing from Settings.                                                                 | Derived from whether the learner has a goal. A fact about the account, not about the URL.  |
| 3   | **Practice dead-ended on numeric questions.** The runner rendered only multiple-choice options. A `numeric` question arrived with none, drew no controls, and left "Check answer" permanently disabled — no way to answer, skip, or finish. The grader had supported `numeric` and `short_answer` since Phase 2.                                                           | A typed-answer input, plus an `unanswerable` fallback that always offers a skip.           |
| 4   | **A stale session cookie locked a learner out.** Middleware redirected anyone _holding_ a cookie away from `/sign-in`; `/dashboard` validated it for real, failed, and redirected back. `ERR_TOO_MANY_REDIRECTS`, permanently, for exactly the people who needed to sign in.                                                                                               | The check moved to the auth pages, which run on Node and can tell a cookie from a session. |
| 5   | **Coach authorization answered 200.** Posting into another learner's thread returned success carrying an error event, because the ownership check sat inside an async generator whose body runs _after_ the headers are sent. Nothing leaked and nothing was written — but rate limiters, WAFs, and alerting are keyed on 4xx, and all of them saw those attempts succeed. | `assertThreadOwned` hoisted beside `assertCoachAvailable` (CR-008).                        |
| 6   | **17 high/critical dependency advisories**, including **drizzle-orm SQL injection via improperly escaped identifiers** (CWE-89) — a direct dependency in the data layer.                                                                                                                                                                                                   | All closed. §6.4.                                                                          |

Defect 5 is the same shape as a Phase 2 defect. That one hoisted the _availability_ check out of the generator and left the _authorization_ check behind. It was only findable with a live provider configured: with the Coach unavailable, the 503 masks it entirely.

### Medium — wrong, but survivable

| #   | Defect                                                                                                                                                                                                                                                                                                  | Fix                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 7   | **A closed tab raised a server incident.** Cancelling a Coach stream left `enqueue` and `close` throwing `Invalid state: Controller is already closed` — reported as an exception. Closing a tab is the most ordinary thing a reader does; noise like that is what makes an incident stream unreadable. | Controller lifecycle tracked; cancellation is a no-op, and the model stops being polled. |
| 8   | **WCAG 1.4.1 failure on both auth pages.** The "Sign in" / "Create one" links were distinguished only by colour at **1.11:1** against surrounding text (3:1 required), underlined on hover only.                                                                                                        | Always underlined.                                                                       |
| 9   | **Horizontal scroll at 320px on six pages.** The app-shell loading skeleton used a fixed `w-80`, wider than the content column. Only visible while loading — and invisible to any test that waits for content before measuring.                                                                         | `max-w-full`; plus a test that deliberately holds the loading state open.                |

---

## 4. Accessibility

axe-core, WCAG 2.1 A and AA, **zero violations** across `/`, `/sign-in`, `/sign-up`, `/dashboard`, `/plan`, `/practice`, `/coach`, `/progress`, `/memory`, `/settings`, and the study screen in **both** its idle and running states — the running state swaps in the timer, the rating fieldsets, and the notes field, so it is a different tree and gets its own scan.

Beyond what axe can check:

- **The skip link is the first tab stop** and actually moves focus to `#main`.
- **Every one of the first twelve tab stops paints a focus indicator** — asserted from computed style, not from the presence of a class.
- **The schedule editor is fully operable by keyboard.**
- **The mobile disclosure announces its state** (`aria-expanded` flips) and exposes all seven destinations when open.

What this does **not** establish: axe catches roughly a third to a half of WCAG issues. Nothing here has been used with an actual screen reader, and no disabled person has tried it. That is named in §7.

---

## 5. Performance

Measured against [PRODUCT_REQUIREMENTS](PRODUCT_REQUIREMENTS.md) §NFR-1, 20 samples per endpoint, production build.

| NFR     | Budget    | Measured (p95)                        | Result |
| ------- | --------- | ------------------------------------- | ------ |
| **1.3** | < 200 ms  | 8–23 ms across six read endpoints     | ✅     |
| **1.4** | < 400 ms  | 9–11 ms                               | ✅     |
| **1.7** | < 300 ms  | **12–36 ms** — Next Action            | ✅     |
| **1.2** | < 2000 ms | 459–472 ms to an actionable dashboard | ✅     |
| **1.6** | < 45 s    | **0.8 s** sign-up → planned dashboard | ✅     |
| **1.5** | < 1500 ms | **1016 ms** TTFT, live Gemini         | ✅     |

NFR-1.7 is the architecturally load-bearing one: the Next Action must be computed deterministically with no model in the hot path. At 36 ms p95 against a 300 ms budget, that claim is not merely asserted.

**These numbers are a floor, not a forecast.** Local app, local database, no network hop, no cold start, one user. A local run that already misses a budget will certainly miss it in production; a local run that meets one has earned the right to be measured again on real infrastructure — see §7, condition C2.

The dashboard ships **772 KB of uncompressed JavaScript** on its critical path (Next reports 142 kB compressed first-load). That is the parse-and-compile cost on a mid-range phone, which is what most of FRIDAY's learners have. Acceptable, worth watching, now regression-guarded.

---

## 6. Security review

### 6.1 Tenancy isolation — the item outstanding since Phase 1

Two real learners provisioned; each one's identifiers fired at the other's session. **A resource belonging to someone else must be indistinguishable from one that does not exist.**

| Attempt                                                                                       | Result                         |
| --------------------------------------------------------------------------------------------- | ------------------------------ |
| Read another learner's goal, mission control, next action, graph, feasibility, plan, schedule | **404** ×7                     |
| Read or mutate another learner's task                                                         | **404**                        |
| Start a session against another learner's task                                                | **404**                        |
| Read another learner's coach thread                                                           | **404**                        |
| Post into another learner's coach thread (coach live)                                         | **404** — after the CR-008 fix |
| List endpoints returning another learner's rows                                               | never                          |

### 6.2 Authentication and session handling

- Unauthenticated requests to `/me`, `/goals`, `/tasks`, `/memory/*`, `/intelligence/*` → **401**.
- Session cookie is **HttpOnly**, **Secure**, **SameSite=Lax**, and unreadable from `document.cookie`.
- **Sign-out invalidates server-side.** Replaying the exact cookie a stolen-token attacker would hold returns 401 — the row is gone, not just the browser's copy.
- **CSRF proven distinctly**: a foreign `Origin` gets **403** while the same call from the correct origin gets **401**. The difference is what proves the rejection came from the origin check rather than incidentally from missing auth.

### 6.3 Headers

`Content-Security-Policy` (per-request nonce + `strict-dynamic`, **no `unsafe-inline` in script-src**), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. The nonce is asserted to be **fresh on every request**, and all ten pages are loaded with the console watched — **zero CSP violations**.

### 6.4 Dependencies

`pnpm audit` at the start: **16 high, 1 critical**. Now: **0 high, 0 critical** (3 moderate, 1 low remain). The CI gate fails on high or above.

| Advisory                                                           | Disposition                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **drizzle-orm — SQL injection via unescaped identifiers** (CWE-89) | Upgraded 0.38.4 → 0.45.2. Migrations verified byte-identical afterwards. |
| undici ×3 (WebSocket DoS)                                          | Overridden to ≥ 6.27.0. Live AI re-verified after the bump.              |
| vitest (critical, arbitrary file read via UI server)               | Upgraded 2 → 3. All 276 tests pass.                                      |
| postcss, sharp, rollup, fast-uri, js-yaml, brace-expansion         | Pinned via `pnpm.overrides`.                                             |

One override was wrong and was caught by verifying rather than assuming: an unbounded `brace-expansion: ">=1.1.18"` resolved to 5.x, whose export shape minimatch 3 cannot call, **breaking ESLint outright**. Now pinned per major line.

### 6.5 Boot-time configuration validation

The app **refuses to start** on a missing or placeholder `DATABASE_URL`, a missing, short, or known-placeholder `AUTH_SECRET`, or plaintext `http` in production on a non-loopback host. It warns without failing on an absent `APP_URL` or `SENTRY_DSN`. Configuration problems are reported by **name only** — no value is ever echoed into a log.

This check caught a real mistake within minutes of being written: its first version refused to start on loopback, which is how CI and every local production run work. Browsers treat `localhost` as a secure context, so the exemption is correct rather than a workaround.

---

## 7. What is still not proven

Named plainly, because the point of this phase was to stop claiming more than has been shown.

| #      | Gap                                                                                                                                                                                                                             | Severity |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **C1** | **CI has never actually run.** The project still has no git remote. Both jobs' commands were executed locally — including the exact `pnpm e2e` invocation with Playwright starting its own server — but no workflow run exists. | High     |
| **C2** | **Nothing has been deployed.** Every measurement here is local: no TLS termination, no network hop to the database, no cold start, no concurrency. The runbook is written and unexercised.                                      | High     |
| **C3** | **The exposed Gemini key is still the configured one.** Flagged since Phase 2; rotation remains the one action outside this repository.                                                                                         | High     |
| L1     | **No screen-reader testing.** axe-core covers the mechanical third to half of WCAG. Nobody has driven FRIDAY with NVDA, JAWS, or VoiceOver, and no disabled person has used it.                                                 | Medium   |
| L2     | **No load testing.** Concurrency is untested at every layer. `ai_calls`, `decision_traces`, and now `product_events` are unpartitioned, as deferred since Phase 1.                                                              | Medium   |
| L3     | **Only Chromium.** No Firefox, no WebKit, no real iOS Safari. The Coach's hand-written SSE reader is the code most likely to differ between engines.                                                                            | Medium   |
| L4     | **Free-tier Gemini is 20 requests/day/model.** Enough to smoke-test a deploy, not to serve learners. A paid key is a prerequisite for anyone using the Coach.                                                                   | Medium   |
| L5     | **No component tests.** §7.2 sets a ≥60% bar with MSW. The UI is now covered end-to-end, which is better evidence but slower and coarser feedback.                                                                              | Low      |
| L6     | **No database backups configured.** `mastery_states` and `memory_states` cannot be reconstructed. Required before real learners; belongs to the deployment host.                                                                | High     |
| L7     | Carried forward: κ inflated by a single observation (CR-004 §6); insights and trends render empty; Coach is single-thread in the UI; no curriculum-editing UI.                                                                  | Low      |
| L8     | Client-side navigation spans are not linked (`onRouterTransitionStart` is a Sentry v9 export; this project is on v8). Errors report correctly; only trace grouping is coarser.                                                  | Low      |

---

## 8. Is FRIDAY ready for an initial public launch?

**Yes — for an invited, small, closely-watched first cohort. Not for an open, unattended launch.**

That distinction is the whole answer, so here is the reasoning rather than the verdict alone.

**What now supports the claim.** The complete student journey works in a real browser, on a phone as well as a desktop, against a production build. The learning loop closes through the UI — a session and a practice set both move mastery, visibly. Accessibility is machine-verified with zero violations and keyboard operation is proven. Tenancy isolation — outstanding since Phase 1 — is now demonstrated across every learner-facing surface. Every performance budget is met with an order of magnitude to spare. The dependency tree has no high or critical advisories. The Coach's SSE parser, the least-verified code in the product, has met a real stream and been proven to reassemble it exactly. And when the model is unavailable, the deterministic product keeps working — verified in a browser, not merely argued.

**Why not an open launch.** Three conditions in §7 are unmet and none of them are code:

- **C1 — CI has never run.** Every gate here was executed by hand. That does not survive a second contributor or a Friday afternoon.
- **C2 — nothing has been deployed.** The performance numbers are a floor measured without a network, and the runbook has never been followed. A deployment that has not happened is a plan, not a capability.
- **L6 — no verified backups.** A learner's evidence history is irreplaceable. An untested backup is a hypothesis.

Plus **C3**: the exposed key must be rotated before anyone but the author uses this.

**What changed the verdict since Phase 3.** Not that the gaps are gone — B1, B2 and B3's _code_ is now written and green. What changed is that the product has been shown to work rather than reasoned to. Phase 3's blockers were "we have never looked." That is no longer true. What remains is "we have never run it anywhere real," which is a smaller and different kind of risk — and one that an invited cohort of twenty, watched daily, is precisely the right instrument for.

That is also exactly what the roadmap's own release plan prescribes: _private beta, 20–50 invited exam aspirants, daily triage._ The feedback channel that plan assumes now exists (CR-007).

**Recommendation.** Freeze this as the Launch Candidate baseline. Then, before the first invite: rotate the key, connect a remote and watch CI go green once, deploy to staging and re-measure §5 there, and turn on point-in-time recovery and restore from it once. None of those require a code change. All four are a day's work, and none can be honestly claimed until they have been done.

---

## 9. Constraints respected

- **No architecture redesign.** No file in `packages/core` changed. The deterministic engine and AI services are used exactly as implemented.
- **No new functionality beyond the objectives.** Everything added is verification, operations, or the analytics and feedback the objectives named. The one product-visible addition is a feedback form on Settings.
- **Only issues found through verification were fixed.** All nine defects in §3 were discovered by the tests written in this phase.
- **Package boundaries intact.** Lint-enforced. The two new services reach the database through repositories in `@friday/db`, as every other service does — no app-level import of `drizzle-orm`.
- **Deviations recorded.** CR-007 (launch surfaces, one additive migration) and CR-008 (the authorization hoist).
- **Coverage grew** — 249 → 276 unit tests, plus 95 browser tests where there were none.
