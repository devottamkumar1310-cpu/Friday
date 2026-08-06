# Phase 3 — The Application · Completion Report

> **Baseline:** Blueprint v1.5 · **Status: verified, awaiting review**
> **Static gate:** ✅ format · ✅ lint · ✅ typecheck · ✅ **249 tests** (was 228) · ✅ production build (43 API routes, 15 pages)
> **Runtime gate:** ✅ complete student journey exercised end to end on PostgreSQL 18.4 against a running server
> **Launch Candidate assessment:** §7 — **not yet.** Three specific gaps, none architectural.

---

## 0. The gap this phase closed

After Phase 2 the backend exposed 33 endpoints and the frontend had **two** pages. The most consequential fact: **a learner could not create a goal at all** — no UI existed for it, and the availability data the scheduler requires (E-6) could only be seeded. The product was an API with a login screen.

Phase 3 connected the whole thing.

---

## 1. Runtime verification — the complete student journey

Every step below ran over real HTTP against a live server and PostgreSQL 18.4, as a **brand-new learner** signing up from scratch.

| #     | Step                                                              | Result                                                                     |
| ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1     | Sign up                                                           | ✅ 201, session cookie                                                     |
| 2     | Dashboard with no goal → redirects into onboarding                | ✅ RSC `replace;/onboarding/availability`, zero dashboard content rendered |
| 3     | Goal page with no availability → redirects to availability        | ✅ 307                                                                     |
| 4     | Set availability (6 slots)                                        | ✅ 930 weekly minutes computed                                             |
| 5     | Overlapping slots rejected                                        | ✅ `"Overlapping availability on day 1: 18:00–20:00 and 19:00–21:00"`      |
| 6     | Goal page now reachable                                           | ✅ 200                                                                     |
| 7     | Create goal → curriculum + plan generated                         | ✅ 10 concepts, plan v1                                                    |
| 8     | All seven app pages render                                        | ✅ dashboard, plan, coach, progress, memory, settings, practice            |
| 9     | Dashboard shows a real Next Action with a "Start this now" action | ✅                                                                         |
| 10    | `GET /tasks` returns the plan                                     | ✅ 10 tasks                                                                |
| 11    | `GET /tasks/{id}/study` — one request for the study screen        | ✅ task + concepts + active-session                                        |
| 12    | Study page renders                                                | ✅ 200                                                                     |
| 13    | Start session                                                     | ✅                                                                         |
| 13b   | **E-19** second concurrent start refused                          | ✅ `SESSION_ALREADY_ACTIVE`                                                |
| 14    | Complete session → mastery + FSRS                                 | ✅ mastery `0 → 0.0980`, next review in 3 days                             |
| 15    | Session history                                                   | ✅ shows the completed session with its rating                             |
| 16    | Practice page offers the studied concept                          | ✅                                                                         |
| 17    | Build practice set                                                | ✅ `servedFromCache: true` — no AI call                                    |
| 18    | Answer graded, explanation returned immediately                   | ✅                                                                         |
| 19    | Submit attempt → evidence → mastery                               | ✅ mastery `0.0980 → 0.2456`                                               |
| 20    | Progress reflects the work                                        | ✅ 2.03% weighted, 1 concept in progress, `on_track`                       |
| 21–23 | Progress / settings / memory pages render real data               | ✅                                                                         |
| 24    | Coach with exhausted Gemini quota                                 | ✅ **`AI_UNAVAILABLE` via the stream — everything else kept working**      |

Step 19 is the one that matters most: **practice moved mastery through exactly the same evidence path a session does**, and step 24 confirms the AI layer can be entirely unavailable without touching the loop (NFR-2.2).

---

## 2. What was built

### 2.1 Pages (2 → 15)

| Page                                               | Deliverable                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/onboarding/availability`                         | Weekly schedule editor with live overlap and inversion validation                          |
| `/onboarding/goal`                                 | Template picker, target date, weekly hours, self-reported level                            |
| `/dashboard`                                       | Mission Control — Next Action, "why this?", today's tasks, risks, **start-session action** |
| `/plan`                                            | 14-day schedule by day, week-level projection, manual re-plan                              |
| `/study/[taskId]`                                  | The study session — timer, pause, per-concept rating, notes, abandon                       |
| `/practice`                                        | Weak-concept picker → question runner → graded feedback → mastery delta                    |
| `/coach`                                           | SSE streaming chat with tool-call visibility                                               |
| `/progress`                                        | Ring, feasibility remediation, weak concepts with evidence, pace, sparkline                |
| `/memory`                                          | Beliefs (viewable, deletable), due reviews, mastery                                        |
| `/settings`                                        | Profile, availability summary, preferences                                                 |
| `error` / `loading` / `not-found` / `global-error` | §4.4's four states, at route and root level                                                |

### 2.2 Endpoints added (33 → 43)

Ten endpoints, **nine of which were specified in Phase 0's API contract and never implemented** — see CR-006 for the table. The tenth, `GET /tasks/{taskId}/study`, is new and additive: it composes existing reads so the most latency-sensitive screen makes one request instead of four.

### 2.3 UI primitives added

`Select` (native, for real keyboard and mobile behaviour), `Textarea`, `Spinner`, `Callout`.

### 2.4 Production UX

- **Responsive** — nav collapses to a disclosure menu below `sm`; grids reflow; the study timer stays visible (deliberately not a bottom bar, which would cover it).
- **Accessibility** — `aria-current` on nav, `aria-pressed` on rating and option buttons, `role="log"` + `aria-live` on the Coach transcript, `role="timer"`, `role="progressbar"` with values, `fieldset`/`legend` on rating groups, labelled icon-only buttons, `sr-only` text on the spinner, visible focus rings throughout, `motion-reduce` on every animation.
- **Four states everywhere** — skeleton loading (never a spinner for page loads), empty states that name the action that fills them, error states with a retry and a reference id.
- **Honest copy** — the plan page explains _why_ only 14 days are scheduled; re-plan reports "nothing changed" when the materiality gate discards a candidate, rather than pretending it did something.

---

## 3. Defects found and fixed during this phase

| #   | Defect                                                                                                                                      | Fix                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `global-error.tsx` and `(app)/error.tsx` imported `@friday/observability`, which uses `AsyncLocalStorage` — **the production build failed** | Client boundaries no longer import server-only packages |
| 2   | `removeEventListener('beforeunload', () => {})` removed nothing — the unload warning fired on our own navigation after finishing a session  | Ref-based `leavingRef` guard                            |
| 3   | Coach `start` event reported `model: claude-sonnet-5` while **Gemini** was serving the turn — every trace quoting it would be wrong         | Reports `provider:tier` for non-Anthropic providers     |
| 4   | Dashboard had an unreachable `if (!goal)` branch after the redirect                                                                         | Dead code removed                                       |
| 5   | Mobile nav used the same icon for open and closed                                                                                           | `X` when open                                           |

Defect 1 is the notable one: it was invisible to `typecheck` and `lint`, and only the production build caught it. Worth remembering that the build is a real gate, not a formality.

---

## 4. Constraints respected

- **No backend redesign.** The deterministic engine and AI services are used exactly as implemented. No file in `packages/core` changed. `packages/ai` changed only for defect 3.
- **Package boundaries intact.** Lint-enforced throughout; route handlers still never import `@friday/db`.
- **Blueprint maintained**, with the one resequencing recorded as **CR-006** rather than absorbed silently.
- **Test coverage maintained** — 228 → 249.

---

## 5. What is not verified

- **No browser testing.** All verification is HTTP-level. Responsive breakpoints, focus order, screen-reader output, and the SSE client's rendering are **reasoned about and coded for, not observed**. This is the largest gap in the phase, and it is exactly the kind of thing that looks fine in code and is wrong on a device.
- **No axe-core / automated a11y run** — NFR requires it in CI; the accessibility work here is hand-applied, not machine-verified.
- **No Playwright E2E.** The journey in §1 was driven by `curl` against the API, which exercises the services and routes but **not the React components**. The forms, the timer, the practice runner, and the SSE parser are untested as UI.
- **Coach chat never rendered against a live stream** — Gemini's 20/day free-tier quota was exhausted, so the client parser was exercised only against the error path.
- Carried forward: no integration/tenancy suite, no property-based tests, no load testing, no CI run.

---

## 6. Known limitations

1. **Component tests do not exist.** §7.2 sets a ≥60% bar for frontend component tests with MSW. Phase 3 added service and contract tests but no component tests — the UI is verified through the API beneath it, which is not the same thing.
2. **Coach is single-thread.** The API supports multiple threads, archive, and rename; the UI uses one rolling thread. Additive whenever it earns its place.
3. **No task rescheduling from the UI.** `PATCH /tasks/{id}` accepts `scheduledDate`, but no screen sets it — the design position is that re-planning, not manual dragging, is how the schedule changes (§10.4).
4. **Curriculum editing absent** — rename, exclude, mark-known. The endpoint exists (`PATCH /concepts/{id}`); the UI does not. This is roadmap Phase 3 (Adaptation) scope, now Phase 4.
5. **Insights and trends render empty** — no generator and no scheduled snapshot writer until Phase 4.

---

## 7. Launch Candidate assessment

**Not yet — but close, and the gaps are named.**

**What supports a Launch Candidate claim:** the complete student journey works end to end on real infrastructure; every backend capability has a UI; the deterministic core is unaffected by AI failure; the four-states rule is applied throughout; 249 tests pass and the production build is clean.

**What blocks it:**

| #      | Blocker                        | Why it blocks                                                                                                                                                                                                                           |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | **No browser or E2E testing**  | Nothing here has been seen in a browser. Shipping a UI whose responsive and accessible behaviour has only been reasoned about is not a launch-ready position. A Playwright pass over the §1 journey plus axe-core in CI is the minimum. |
| **B2** | **No live Coach verification** | The chat client's SSE parsing has never met a real stream. It is the single most complex piece of client code in the phase and the least verified. Needs a paid Gemini key or an Anthropic key.                                         |
| **B3** | **No CI**                      | The project still is not connected to a remote. Every gate is being run by hand, which does not survive a second contributor.                                                                                                           |

**Also required before real users**, though not strictly launch blockers: rotate the exposed API key (already flagged), partition the high-volume tables, and add the tenancy-isolation suite that §7.3 has been asking for since Phase 1.

My assessment: **Launch Candidate is roughly one focused phase away**, and that phase is verification rather than construction. The build is more complete than it is proven.

---

## 8. Phase 3 is complete

The application exists. A learner can sign up, declare when they study, set a goal, receive a plan, be told what to do next and why, do it, have that change what they are told next, practise, see honest progress, correct what FRIDAY believes about them, and adjust their settings — with every AI surface degrading honestly when the model is unavailable.

**Phase 4 does not begin without your review and approval.**
