# FRIDAY UI/UX Redesign — Phase 1 Blueprint

> AUDIT + DESIGN FOUNDATION ONLY. No backend, API, auth, billing, planner,
> adaptive/mastery/FSRS, scheduling, root-cause, or assessment logic was changed
> in this phase. No page-level redesign is implemented here. This document is the
> build manual for the page-by-page redesign that follows.

Product: FRIDAY is an AI Learning Operating System.
Core loop: OBSERVE → UNDERSTAND → PLAN → STUDY → ADAPT → EXPLAIN.
Bar: the product must feel like one coherent intelligent system, not SaaS pages.

---

## 1. Product UX Vision

FRIDAY is a mission system, not a dashboard of widgets. Every screen answers:

- What should I do?
- Why?
- What changed?
- What happens next?

Visual direction: CALM, PRECISE, TECHNICAL, INTELLIGENT, TRUSTWORTHY.

- Light theme + dark theme are both first-class. Marketing is light-first;
  the authenticated app is denser and more technical but never dark-only.
- One primary action per screen. The next action owns the saturation; everything
  else recedes.
- AI explains; deterministic systems decide. Mastery %, FSRS dates, feasibility
  verdicts, plan diffs are computed and shown as facts. AI copy explains the
  reasoning next to the fact, never instead of it.
- No generic SaaS gradients, no glassmorphism, no glow effects, no card-grid
  overload, no AI-sparkle decoration, no meaningless animation.

---

## 2. Information Architecture

Target hierarchy (do not implement until the page-by-page phase):

```
MISSION
  /dashboard      Mission Control — the one thing to do now
  /plan           Plan — 14-day schedule + projection

UNDERSTAND
  /progress       Progress — where you stand (exam-weighted, decayed)
  /root-cause     Root Cause — prerequisite chain to the earliest weak root
  /practice       Assessments — retrieval practice ranked by weak concepts
  /mock-test      Mock Test — full-length assessment (sibling of practice)
  /weekly-review  Weekly Review — observed / changed / next focus
  /coach          Coach — grounded chat (kept, grouped under Understand)
  /memory         Memory — what FRIDAY believes + FSRS due (kept, Understand)

SYSTEM
  /settings       Settings — account, availability, preferences, privacy
  /billing        Billing — Free core vs Pro divider

ENTRY
  /               Marketing
  /sign-in        Sign in
  /sign-up        Sign up
  /onboarding/*   availability → goal (+ date-of-birth / guardian-consent gates)
```

Notes from audit:

- Sidebar already uses MISSION / UNDERSTAND / SYSTEM groups with 8 items.
  The redesign keeps these groups and adds the missing siblings explicitly:
  `coach`, `memory`, `mock-test` are real product surfaces today (inside the
  `(app)` shell for coach/memory; top-level for mock-test) but are absent from
  the sidebar. Decide per surface: promote to UNDERSTAND nav, or keep as
  contextual entry points (coach from Mission Control, memory from Settings).
  Recommendation: add Assessments (`/practice` + `/mock-test` as tabs or
  sub-items), keep Coach + Memory as secondary UNDERSTAND items — they are
  part of the loop (ADAPT/EXPLAIN), not settings.
- `/study/[taskId]` is a full-screen overlay flow (idle → focus → rating →
  done), not a nav destination. Keep it out of the nav; it is entered from
  Mission Control / Plan.
- `/practice-set` directory exists but has no `page.tsx` — dead route, 404s.
  Remove the empty directory in a later phase (not done here to keep this
  phase additive).
- `/root-cause`, `/weekly-review`, `/mock-test` currently render OUTSIDE the
  `(app)` shell (no sidebar, no command palette) even though the sidebar links
  to `/root-cause` and `/weekly-review`. The redesign must move these three
  routes inside the `(app)` group so navigation chrome is consistent. This is
  the single highest-value IA fix.

---

## 3. Route Inventory

Conventions below: CTA = primary / secondary observed in code. States =
loading / empty / error handling observed. Shell = which layout wraps it.

### 3.1 `/` — Marketing (no layout file, self-contained)

- File: `apps/web/src/app/(marketing)/page.tsx`
- Purpose: positioning (AI Learning OS, not chatbot), adaptive loop,
  capabilities, Mission Control preview, pricing, final CTA.
- Job: decide whether FRIDAY is worth trying.
- Primary CTA: `Start free →` → `/sign-up` (hero, free tier, final).
- Secondary: `See how FRIDAY works` (ghost → `#how-it-works`), `Sign in`
  (ghost → `/sign-in`), `Start free, upgrade inside` (Pro card).
- Data: none (static; `useState(mobileOpen)` only).
- Loading/empty/error: none (static).
- Mobile: hamburger `md:hidden` collapsible sheet; buttons `w-full sm:w-auto`;
  grids collapse `lg:grid-cols-2`, `sm:2 lg:3`; loop row `sm:grid-cols-5`.
- Nav relation: standalone sticky header + footer; shares nothing with app.
- Problems: preview uses a raw `div bg-primary` as a fake button instead of
  `<Button>`; `rounded-2xl` previews are off the radius scale; overlay tints
  (`bg-muted/40`, `bg-background/50`) have no token.

### 3.2 `/sign-in` — Sign in (`(auth)` split-panel shell)

- File: `apps/web/src/app/(auth)/sign-in/page.tsx` (+ `SignInForm`)
- Purpose: credential + Google entry; guards `getCurrentUser()` → `/dashboard`.
- Job: get back in.
- Primary: `Sign in` submit. Secondary: `Continue with Google` (`/api/v1/auth/google`)
  shown first + `or continue with email` divider. Tertiary: `Create account`.
- Data: server `getCurrentUser()`; client `signIn` call, `next` param validated
  (`startsWith('/') && !startsWith('//')`), `react-hook-form + zod`.
- Loading: `Suspense` + `SkeletonText(5)`; button `loading=isSubmitting`.
- Empty: n/a. Error: `Callout danger` for expected codes
  (`INVALID_CREDENTIALS / EMAIL_NOT_VERIFIED / RATE_LIMITED`), `ErrorState` +
  requestId for unexpected, network fallback.
- Mobile: auth shell stacks; inputs `h-11 w-full`.
- Problems: none structural; keep pattern for all auth forms.

### 3.3 `/sign-up` — Sign up (`(auth)` shell)

- File: `apps/web/src/app/(auth)/sign-up/page.tsx` (+ `SignUpForm`)
- Purpose: account creation with `displayName / email / password / dateOfBirth`
  + hidden `timezone`; same dashboard guard.
- Primary: `Create account` → `/dashboard`. Secondary: Google. Tertiary: `Sign in`.
- Data: `signUp` call; `detectTimezone()`.
- Loading/error/mobile: same as sign-in; field errors for
  `EMAIL_IN_USE / UNDER_MINIMUM_AGE / WEAK_PASSWORD`.
- Problems: none structural.

### 3.4 `/onboarding/*` (thin header shell: wordmark + SignOutButton, `max-w-2xl`)

| Route | File | Purpose / job | Primary CTA | Secondary | Data | States |
|---|---|---|---|---|---|---|
| `/onboarding` | `onboarding/page.tsx` | pure redirect | — | — | — | — → `/onboarding/availability` |
| `/onboarding/availability` | `onboarding/availability/page.tsx` | step 1/2 + schedule editor; `isOnboarding = goals.length===0` | `Save and continue` | preset whole-week cards + disclosure editor (48 half-hour `TIMES`, plus/trash rows) | server `requireUser, getMePayload, getAvailability, listGoals`; PUT availability; `canSave = rules>0 && overlaps===0 && invalid===0` | saving spinner; `Callout` + overlap validation; `Step 1 of 2` bar only when onboarding |
| `/onboarding/goal` | `onboarding/goal/page.tsx` | step 2/2; guards: `blockedBy→dashboard`, no availability→availability, goals>0→dashboard | `Create goal and build my plan` | template select, target date (+1yr default), `targetWeeklyMinutes=weeklyMinutes(rules)` | `requireUser, getMePayload, getAvailability, listGoals, listTemplates`; `createGoal` → `/dashboard` | spinner; `Callout` + `TARGET_DATE_IN_PAST` |
| `/onboarding/date-of-birth` | `onboarding/date-of-birth/page.tsx` | FR-1.6 age gate | `Continue` | — | `requireUser, getMePayload`; PATCH identity | field + callout |
| `/onboarding/guardian-consent` | `onboarding/guardian-consent/page.tsx` | minor gate | `Continue` | — | same | same |

- Mobile: `max-w-2xl px-6 py-16`; presets reduce 18 selects to 3-tap cards;
  total + button pinned for thumb; goal button `w-full sm:w-auto`.
- Problems: no stepper in the layout itself (pages implement own bars —
  standardise on one stepper component later); onboarding header wordmark links
  to `/` which is ambiguous inside an authed flow (later: link to
  `/onboarding/availability` or `/dashboard`).

### 3.5 `/dashboard` — Mission Control (`(app)` shell)

- File: `apps/web/src/app/(app)/dashboard/page.tsx` + `live-intelligence-panel.tsx`
- Purpose: observed / decided / one thing to do. `ensurePlanFreshForToday` on
  first open; `targetSessionMinutes` passed as budget unless `band==unknown`.
- Job: start today's session.
- Primary: `Start Session` (`size=lg h-14 w-full` → `/study/[taskId]`).
- Secondary: `View full schedule →` / `View Full Plan` → `/plan`.
- Empty: `Mission Accomplished` + `View Full Plan`; `No other tasks`;
  `No new insights`.
- Data (server): `listGoals, ensurePlanFreshForToday, getAdaptiveProfile,
  getMissionControl` → `firstName, goalTitle, daysRemaining, profile,
  planChange, risks, action{taskId,title,minutes,rationale,why}, todayTasks`.
- Problems: uses `<Button variant="outline">` which did not exist in the
  system (fixed in Phase 1 foundation by adding the `outline` variant);
  `Today's Plan` + `System Intelligence` stack on mobile but hierarchy between
  the two grids (`space-y-12`, `grid lg:grid-cols-2`, `p-6 sm:p-8`) is ad hoc —
  the redesign standardises on `PageHeader` + one mission card + two-column
  intelligence grid (§8).

### 3.6 `/plan` — Plan (`(app)` shell)

- File: `apps/web/src/app/(app)/plan/page.tsx`
- Purpose: 14-day detailed schedule + coarse projection; hides past dates;
  explains redistribution + session sizing.
- Primary: per-task `Start` (`PlayCircle` → `/study/[id]`, prefetch).
- Secondary: `Re-plan` (`regeneratePlan reason=user_request`, toast success vs
  `Nothing changed` materiality gate).
- Data: `getSchedule + getAdaptiveProfile` + `hydrateTasksWithConcepts`;
  `byDate` map, `diffSummary{rescheduledCount, capacityBefore/After}`,
  `projection[12]`.
- Empty: caught error → `EmptyState No plan yet`; `days===0` → `Nothing
  scheduled… add hours`. Loading: shell skeleton.
- Mobile: header `flex-col sm:flex-row`; timeline `before:ml-4 md:mx-auto`,
  cards `pl-12 md:pl-0 md:w-5/12`.
- Problems: raw `shadow-[0_0_0_4px_var(--color-primary-hover)]` arbitrary value
  (tokenise later); `Button sm className h-8` shrinks below the 44px floor the
  system mandates (fix in redesign); table needs `overflow` wrapper discipline.

### 3.7 `/progress` — Progress (`(app)` shell)

- File: `apps/web/src/app/(app)/progress/page.tsx`
- Purpose: where you stand — exam-weighted + decayed, not task count.
  `ProgressRing` + stats + `FeasibilityRemediation` + `WeakConceptList`.
- Primary (implicit): weak-concept rows → `/root-cause?goalId&weakConceptId` +
  remediation option buttons. No single hero CTA (redesign: add one — the
  highest-leverage next action).
- Data: `getProgress + getWeakConcepts10 + getTrends30 + getFeasibility`.
- Empty: no goal → `EmptyState`; `weak===0` → `needs more evidence` box.
  Error: boundary. `verdict!==safe` gates remediation.
- Mobile: hero `flex-col lg:flex-row`; stats `grid-cols-2 md:grid-cols-3`.
- Problems: biggest "no primary action" violation; also the H1 is `text-3xl`
  here vs `text-2xl` on sibling pages — standardise on `PageHeader`.

### 3.8 `/practice` — Assessments (`(app)` shell)

- Files: `apps/web/src/app/(app)/practice/page.tsx` + `practice-starter.tsx`
- Purpose: retrieval practice ranked by weak concepts (retrieval > self-rating).
- Primary: `Practise N topics` / `Pick a topic to start` (`size=lg w-full`,
  disabled when none/busy). Secondary: concept toggles (`aria-pressed`,
  `mastery%` + `provisional` badge).
- Data: server `getWeakConcepts(8)`; client `createPracticeSet{goalId,
  conceptIds, questionCount:5, difficulty:3}` → `PracticeRunner`.
- Loading: `Spinner Building your set…`. Empty: page-level + starter-level
  `EmptyState`. Error: `Callout`.
- Problems: raw `<a class="bg-primary…">` CTA in one state instead of
  `<Button>` (different hover/focus treatment); option rows rely on conditional
  classes instead of `disabled`.

### 3.9 `/coach` — Coach (`(app)` shell, missing from sidebar)

- Files: `(app)/coach/page.tsx` + `coach-chat.tsx`
- Purpose: one rolling thread, grounded in plan/mastery.
- Primary: `Send` (textarea + icon). Secondary: tool `Badge` + activity.
- Data: `listThreads() ?? createThread(goalId)`, `getThread`; SSE POST
  `…/coach/threads/[id]/messages` with manual parser.
- Loading: streaming delta + spinner. Error: JSON pre-flight `coach
  unavailable`, `Streaming not supported`. Empty: filtered initial messages.
- Problems: nav-orphan (no sidebar entry, no palette grouping decision);
  bubbles (`rounded-lg bg-primary` vs `bg-surface`) are one-off — tokenise in
  redesign as `AssessmentShell`-adjacent chat pattern.

### 3.10 `/memory` — Memory (`(app)` shell, missing from sidebar)

- File: `(app)/memory/page.tsx`
- Purpose: what FRIDAY believes + FSRS due + mastery; beliefs correctable,
  deletion immediate/permanent.
- Primary: `FactList` inline correct/delete. Secondary: none.
- Data: `listFacts + listMastery100 + listDueReviews`.
- Empty: `Nothing is due yet`, `EmptyState Nothing measured yet`. Error:
  boundary.
- Problems: same nav-orphan issue; row pattern (`truncate` + `shrink-0
  font-mono`) is fine — promote to `EvidenceBlock`-adjacent pattern later.

### 3.11 `/billing` — Billing (`(app)` shell)

- Files: `(app)/billing/page.tsx` + `billing-client.tsx`
- Purpose: Free core vs Pro divider (not cards); RevenueCat offerings.
- Primary: `purchasePackage(pkg)` / `presentPaywall()` per package
  (Monthly/Yearly/Lifetime). Secondary: reload.
- Data: server `requireUser` only; client `isFridayProActive / getOfferings`.
- Loading: `Loader2 h-64`. Error: message string. Empty: `offering==null`.
- Mobile: tiers `flex divide-x` → stack.
- Problems: loading is a bare spinner (violates skeleton rule — use
  `LoadingState`); error is a raw string (use `ErrorState`).

### 3.12 `/settings` — Settings (`(app)` shell)

- File: `(app)/settings/page.tsx`
- Purpose: account (timezone drives scheduling), availability summary,
  preferences (quiet hours), feedback, privacy, danger zone.
- Primary: per-form `Save`. Secondary: `Edit schedule` →
  `/onboarding/availability`, `Review beliefs` → `/memory`,
  `DeleteAccountButton`.
- Data: `getAvailability + getPreferences`; `ProfileForm` (PATCH `/me`),
  `PreferencesForm`, `FeedbackForm` (POST `/feedback`), `DeleteAccountButton`
  (DELETE `/me`).
- Problems: `DeleteAccountButton` used raw `red-500` classes instead of
  destructive tokens (fixed in Phase 1 foundation); per-form `Callout` errors
  are good — keep; sections (`border-t pt-8 pb-10`, `max-w-2xl`) become the
  `WeeklyReviewSection`-adjacent section pattern.

### 3.13 `/study/[taskId]` — Study session (`(app)` shell, overlay)

- Files: `(app)/study/[taskId]/page.tsx` + `study-session.tsx`
- Purpose: mode `idle → focus → rating → done`; server-authoritative clock from
  `started_at`; survives reload/device; `notFound()` masks 403.
- Primary: `Start studying` → `I'm done studying` → `Save and finish`
  (`completeSession{activeMinutes, ratings, notes}` → mastery before→after +
  FSRS `Back tomorrow / in N days` + `See updated plan`). Secondary:
  `Pause/Resume`, `Discard` (confirm `Dialog` + `abandonSession`), `Not now /
  Back to studying / Keep studying`, `Take me to it` on error.
- Data: server `getStudyTask`; client start/complete/abandon; `setInterval
  1000` clock; `localStorage friday:session:[id]` draft; `beforeunload` guard.
- Mobile: `fixed inset-0 z-50` overlay covers chrome; `max-w-md`;
  clock `font-mono text-6xl`; rating `grid-cols-2 min-h-16` targets.
- Problems: none structural — this is the best-built flow in the product.
  Redesign keeps the state machine; only visual tokens change.

### 3.14 `/mock-test` — Mock test (OUTSIDE `(app)` shell — fix in redesign)

- Files: `app/mock-test/page.tsx` + `mock-test-starter.tsx`
- Purpose: full-length mock (15Q, all concepts, L4 advanced); reuses
  `PracticeRunner`.
- Primary: `Start Mock Test` (`size=lg w-full`, disabled when busy/empty).
- Data: server `requireUser, listGoals→notFound, getGraph→conceptIds`; client
  POST `/api/v1/assessments/mock-test{goalId, questionCount:15, difficulty:4}`.
- Loading: `Spinner Generating…`. Error: `Callout`. Empty: disabled start.
- Problems: no sidebar/palette chrome; `Button lg disabled` has no loading
  state; config box `bg-muted/20` is a one-off tint.

### 3.15 `/root-cause` — Root cause (OUTSIDE `(app)` shell — fix in redesign)

- File: `app/root-cause/page.tsx`
- Purpose: traces prerequisite chain upward to earliest low-mastery root;
  `mastery / readiness / strength` bars + raw `evidence` JSON.
- Primary: `Go to Dashboard` → `/dashboard`. Secondary: `Back to Progress`
  ghost, `Supporting Evidence Show/Hide <details>`.
- Data: server `requireUser`, `z.uuid` both params → `notFound()` if
  missing/invalid, `getRootCauseAttribution`.
- Empty: `chain===0` → foundational copy. Error: `notFound`. Loading: shell.
- Problems: no `(app)` chrome despite sidebar linking here; one-off tint
  `bg-destructive/15 ring-destructive/30`; raw evidence JSON needs the
  `EvidenceBlock` treatment (collapsible, designed — not a dump).

### 3.16 `/weekly-review` — Weekly review (OUTSIDE `(app)` shell — fix)

- Files: `app/weekly-review/page.tsx` + `weekly-review-client.tsx`
- Purpose: weekly briefing — observed / changed / next focus; server maps to
  `progress / weakConcepts / trends / insights`.
- Primary: `Acknowledge and continue` (`size=lg w-full`, `Check Review
  acknowledged`, push `/dashboard` after 500ms). Secondary: per-concept `Root
  cause → /root-cause?…`, `Go to Progress` fallbacks.
- Data: server `requireUser`, `z.uuid goalId`,
  `getProgress + getWeakConcepts5 + getTrends30 + listInsights`; client
  `useRouter + acknowledged` only.
- Empty: `!goalId → No goal selected`; undefined cards hidden. Error: invalid
  uuid message. Loading: none beyond shell.
- Problems: no `(app)` chrome; raw `<a class="bg-primary…">` CTA instead of
  `<Button>`; `space-y-10`, `grid-cols-2 sm:3`, `p-3` spacing is ad hoc.

### 3.17 Additional routes discovered

- `/practice-set` — empty directory, no `page.tsx`. Dead route (404 via
  `not-found.tsx`). Functionality lives at `/practice`. Remove directory later.
- `/api/*` — ~50 `route.ts` files (health, auth, me, goals, tasks, sessions,
  assessments, attempts, intelligence, memory, coach incl. SSE, concepts,
  questions, feedback, curriculum templates, cron, public goals). Out of scope
  for UX redesign; contracts frozen.
- System routes: `global-error.tsx` (last-resort boundary, raw button — needs
  token focus style later), `not-found.tsx` (static, `Back to Mission Control`
  — good), `(app)/loading.tsx` (correct skeleton pattern),
  `(app)/error.tsx` (scoped boundary + `ErrorState` — good).

---

## 4. Design Tokens

Source of truth: `packages/ui/src/styles/tokens.css` (Tailwind v4 CSS-first;
no tailwind config; `apps/web/src/app/globals.css` imports `@friday/ui/styles.css`).

Phase 1 foundation added (backwards-compatible aliases; nothing renamed):

| Spec name | Token | Light | Dark | Utility |
|---|---|---|---|---|
| background | `--background` | oklch 0.985 | oklch 0.14 | `bg-background` |
| surface | `--surface` | #fff | oklch 0.18 | `bg-surface` |
| surface-elevated | `--surface-elevated` (new alias; light = `--surface`, dark = 0.24) | — | — | `bg-surface-elevated` |
| surface-muted | `--surface-muted` (new; light = muted 0.95, dark = 0.22) | — | — | `bg-surface-muted` |
| surface-raised | `--surface-raised` (kept) | 0.99 | 0.22 | `bg-surface-raised` |
| border | `--border` | 0.90 | 0.25 | `border-border` |
| border-strong | `--border-strong` | 0.82 | 0.35 | `border-border-strong` |
| foreground | `--foreground` | 0.15 | 0.96 | `text-foreground` |
| foreground-muted | `--foreground-muted` (new alias of `--muted-foreground`) | 0.50 | 0.70 | `text-foreground-muted` |
| primary | `--primary` | 0.48/260 | 0.68/258 | `bg-primary` |
| primary-hover | `--primary-hover` | 0.42 | 0.74 | `hover:bg-primary-hover` |
| success | `--success` | 0.53/155 | 0.65 | `bg-success` etc. |
| warning | `--warning` | 0.72/75 | 0.78 | `bg-warning` |
| danger | `--danger` (new alias of `--destructive`) | 0.55/25 | 0.65 | `bg-danger` |
| focus | `--focus` (new alias of `--ring`) | primary | primary-light | `outline-focus` |

Also: `--overlay`, `--input`, `--muted`, `--ai-accent`, `--ai-surface`
(unchanged); `--radius: 0.375rem` with `sm −4px / md −2px / lg = radius /
xl +4px` → 2/4/6/10px.

New foundation scales (tokens only, no page migration):

- Content widths: `--content-narrow: 28rem` (auth/gates/study),
  `--content-form: 42rem` (onboarding/settings),
  `--content-app: 64rem` (authenticated well = current `max-w-5xl`),
  `--content-wide: 72rem` (marketing).
- Control heights: `--control-sm/md/icon: 2.75rem` (44px floor),
  `--control-lg: 3rem`.
- Shadow hierarchy: `--shadow-sm/md/lg` + rule (most surfaces none/sm;
  dialogs/sheets lg; command palette 2xl only). No shadow token existed;
  same-elevation cards used `sm/md/lg/2xl` interchangeably — the redesign
  normalises to this scale.
- Motion: `--duration-fast 120 / base 200 / slow 320ms`,
  `--ease-out cubic(0.16,1,0.3,1)`; `prefers-reduced-motion` kill switch kept.
- Focus: `:focus-visible { outline: 2px solid var(--ring); offset 2px }`
  everywhere (WCAG 2.2 AA, NFR-6.1).

---

## 5. Typography

Scale (system now, redesign enforces):

- H1 (page): `text-2xl sm:text-3xl font-semibold tracking-tight` via new
  `PageHeader`. Audit found `text-3xl` (plan/billing/dashboard) vs `text-2xl`
  (coach/memory/mock/not-found) for the same level — one variant wins.
- H2 (section): `text-lg font-semibold tracking-tight` via `SectionHeader`.
- Eyebrow: `text-xs font-semibold uppercase tracking-wider
  text-muted-foreground` — single variant. Audit found ≥4 eyebrow scales
  (`tracking-widest` bold, `tracking-wider` semibold, `text-sm primary`,
  arbitrary `text-[10px]/[11px]`) — all collapse to this one.
- Body: `text-sm text-muted-foreground`, captions `text-xs
  text-subtle-foreground`, mono data `font-mono tabular-nums`.
- Marketing hero may use `text-base sm:lg` lede + `text-2xl` quote — the only
  sanctioned exception.
- Base: `rlig + calt`, antialiased; `min-h-11/12` control floors preserved on
  all breakpoints (no desktop shrink — 768/1024px are thumb widths).

---

## 6. Component Architecture

Status key: REUSE (exists, keep) · EXTEND (exists, small fix — done or queued)
· BUILD (does not exist, build in page-by-page phase).

### Shell / navigation

| Component | Status | Notes |
|---|---|---|
| AppShell | EXTEND | `(app)/layout.tsx` + sidebar + mobile nav + palette + `max-w-5xl` well. Move root-cause/weekly-review/mock-test inside. |
| Sidebar | REUSE | `app-sidebar.tsx` — MISSION/UNDERSTAND/SYSTEM groups. Phase 1 fixed missing `Search` import (runtime crash). Decide coach/memory/mock-test placement. |
| MobileNav | REUSE | `mobile-nav.tsx` — same GROUPS via Sheet. |
| MainNav | REMOVE | `main-nav.tsx` is dead/unused with divergent active style + order. Delete in a later phase. |
| CommandPalette | REUSE | `command-palette.tsx` — 8 commands; reconcile icons/labels with sidebar (dashboard Target vs Home; billing labels). |
| ThemeToggle | REUSE | `theme-toggle.tsx` — `friday-theme` localStorage + `.dark` class. |
| RevenueCatProvider | REUSE | Only context provider in `(app)`. No new global providers without cause. |
| PageHeader | BUILD (foundation shipped) | `packages/ui` `page-header.tsx` — H1 + description + eyebrow + actions. Migrate pages one by one later. |
| SectionHeader | BUILD (foundation shipped) | Same file — eyebrow + H2 + description. |
| Breadcrumbs | BUILD | Needed only for deep flows (study, root-cause with params). Not global. |

### Mission / plan

| Component | Status | Notes |
|---|---|---|
| MissionCard | BUILD | Today's mission: action + rationale + Start. Replaces ad-hoc hero card. |
| MissionReasoning | BUILD | Why-this-action block (rationale, why, budget). |
| PlanTimeline | BUILD | 14-day schedule; normalises current `before:ml-4` timeline + `h-8`-button violations. |
| PrimaryAction | BUILD | The one CTA per screen (wraps `Button lg`). |
| RegeneratePlanButton | REUSE | Keep behaviour incl. materiality-gate toast. |

### Understand

| Component | Status | Notes |
|---|---|---|
| ProgressMetric | BUILD | Single stat (value + delta + caption). Replaces ad-hoc stat cells. |
| WeakConcept | BUILD | Row → root-cause link + mastery + provisional. Normalises 3 current variants. |
| RootCauseGraph | BUILD | Vertical chain + bars; replaces one-off tints + raw JSON dump. |
| EvidenceBlock | BUILD | Collapsible evidence (`<details>` done right). |
| InsightItem | BUILD | One intelligence insight (observed/changed/next). |
| AssessmentShell | BUILD | Shared runner chrome for practice + mock-test (config → runner → review). |
| WeeklyReviewSection | BUILD | One briefing section (overview / weak / trends / insights). |

### System primitives (all REUSE unless noted)

Button (+ new `outline` variant — EXTEND done), Input/Field, Textarea, Select
(native, deliberate), Card, Dialog, Sheet, Tabs, Badge (+ `AiBadge`), Progress
(+ `ProgressRing`), Skeleton (+ `SkeletonText`), Spinner (buttons/streams
only), Callout (info/success/warning/danger), EmptyState (EXTEND: `href`
support added), ErrorState, LoadingState (BUILD — foundation shipped),
Toaster (sonner, global), `cn()`.

### Reuse verdict

Reuse everything in `packages/ui`. Do not duplicate components. Page-specific
components under `apps/web/src/components/{app,auth,billing,coach,memory,
onboarding,planning,platform,practice,progress,settings,study}` stay
page-specific until the page-by-page phase promotes the patterns above.

---

## 7. Navigation Model

- Sidebar stays visually subordinate: `bg-surface-raised`, `text-sm`,
  active = `bg-primary/10 text-primary`, inactive = `text-subtle-foreground`.
  One active item max (`aria-current="page"`).
- Groups: MISSION (Mission Control, Plan) · UNDERSTAND (Progress, Root Cause,
  Assessments incl. practice + mock-test, Weekly Review, + Coach/Memory
  decision) · SYSTEM (Settings, Billing).
- Mobile: `MobileNav` (h-14 bar + right Sheet) below `lg`; sidebar `hidden
  lg:flex`. Marketing keeps its own `md:` nav — reconcile to `lg` later so the
  same device never gets two nav patterns.
- Command palette (⌘K/Ctrl-K) mirrors the sidebar 1:1 — same order, same
  labels, same icons. Current divergences to fix: dashboard icon, billing
  label, group capitalisation, missing coach/memory/mock-test decision.
- Search hint button in the sidebar dispatches the palette; keep.
- Study overlay covers chrome (`fixed inset-0 z-50`) — correct, keep.
- What is global: theme script, skip-link, Toaster, RevenueCatProvider,
  sidebar/mobile nav, palette, `(app)` loading + error boundaries, `max-w-5xl`
  content well. What is page-specific: everything else, including the four
  wordmark/header variants (sidebar, auth split-panel, onboarding thin bar,
  marketing sticky nav) — unify wordmark treatment in the redesign, but each
  shell keeps its own header.

---

## 8. Mission Control Hierarchy

```
/dashboard
  PageHeader (eyebrow: goal title + days remaining; title: greeting/focus)
  MissionCard
    action title + minutes budget + rationale (MissionReasoning)
    PrimaryAction: Start Session → /study/[taskId]
    secondary link: View full schedule → /plan
  grid lg:cols-2
    Today's Plan (Today's tasks, completed filtered, action highlighted)
    System Intelligence (plan-change, risks, insights; empty → "No new insights")
  empty: Mission Accomplished + View Full Plan
```

Rules: one primary action; budget shown unless `band==unknown`; completed
tasks filtered; `ensurePlanFreshForToday` stays server-side, first open.

## 9. Plan Hierarchy

```
/plan
  PageHeader (title + date range + Re-plan secondary)
  PlanTimeline (14-day, past hidden; per-date tasks; per-task Start)
  diffSummary strip (rescheduled count, capacity before/after) — only when material
  projection (12-step coarse) — collapsed/progressive disclosure by default
  empty: No plan yet / Nothing scheduled… add hours
```

Rules: per-task Start prefetches; timeline normalises current `h-8` buttons to
44px floor; arbitrary shadow tokenised.

## 10. Progress Hierarchy

```
/progress
  PageHeader + PrimaryAction (highest-leverage next step — NEW; currently missing)
  hero: ProgressRing + exam-weighted standing (not task count)
  ProgressMetric row (stats grid-cols-2 md:3)
  FeasibilityRemediation (only when verdict !== safe)
  WeakConcept list → /root-cause links
  empty: No goal yet / needs more evidence
```

## 11. Root Cause Hierarchy

```
/root-cause (MOVE inside (app) shell)
  PageHeader (Back to Progress secondary)
  RootCauseGraph (chain upward to earliest weak root; mastery/readiness/strength bars)
  EvidenceBlock (collapsible; replaces raw JSON dump)
  PrimaryAction: Go to Dashboard (keep) + practice CTA per root
  empty: chain===0 foundational copy
```

Params `goalId + weakConceptId` validated (`z.uuid`, `notFound()` on
missing/invalid) — keep.

## 12. Assessment Hierarchy

```
/practice + /mock-test (mock-test MOVES inside (app) shell)
  AssessmentShell
    config: concept toggles (practice, ranked) / full-syllabus note (mock 15Q L4)
    PrimaryAction: Practise N topics / Start Mock Test (with loading state — missing today)
    runner: PracticeRunner (shared; sectional timing deferred as today)
    review: mastery deltas + next steps
  empty: Nothing to practise yet → Mission Control
```

Config facts frozen: practice 5Q L3, mock 15Q L4 advanced, all-concepts.

## 13. Weekly Review Hierarchy

```
/weekly-review (MOVE inside (app) shell)
  PageHeader (week range + goal)
  WeeklyReviewSection × 4: observed / changed / next focus (+ trends)
  WeakConcept rows → /root-cause links
  PrimaryAction: Acknowledge and continue → /dashboard (keep 500ms behaviour)
  empty: No goal selected / hidden cards; invalid uuid → Invalid goal identifier
```

Replace raw `<a class="bg-primary…">` with `<Button>`; normalise `space-y`
to the spacing scale.

## 14. Billing Hierarchy

```
/billing
  PageHeader (Free core vs Pro divider — keep the divider, not cards)
  tiers + packages (Monthly/Yearly/Lifetime via purchasePackage/presentPaywall)
  states: LoadingState (replaces bare h-64 spinner) / ErrorState (replaces raw string) /
          offering==null empty
```

No billing logic changes. RevenueCat stays.

## 15. Onboarding Hierarchy

```
/onboarding/availability (Step 1/2) → /onboarding/goal (Step 2/2)
  shared stepper component (NEW — replaces per-page bars)
  availability: preset cards → disclosure editor → Save and continue
  goal: template select + target date (+1yr) + weekly minutes (single source of truth)
        → Create goal and build my plan → /dashboard
/onboarding/date-of-birth + /guardian-consent (gates; keep guards + redirects)
```

Guards frozen: `blockedBy`, availability-required-before-goal (E-6),
`goals>0 → dashboard`. `isOnboarding = goals.length===0` (survives refresh) kept.

## 16. Auth Hierarchy

```
/sign-in + /sign-up (split-panel shell: brand/quote/loop-badges left, max-w-sm form right)
  Google first + divider + email form + tertiary switch link
  guards: getCurrentUser() → /dashboard; next-param open-redirect validation kept
  states: SkeletonText(5) + button loading + Callout (expected) / ErrorState (unexpected)
```

Light-first; no structural change in redesign beyond tokens.

---

## 17. Loading / Empty / Error Strategy

- Loading preserves layout: skeleton (`Skeleton`, `SkeletonText`,
  `(app)/loading.tsx` pattern, new `LoadingState`) — never a bare spinner on
  a page. Spinners live only inside buttons (`Button loading`) and streams
  (coach/SSE). Billing's `h-64` spinner and mock-test's disabled-without-state
  button are the two violations to fix.
- Empty explains what FRIDAY needs next: every `EmptyState` names the filling
  action (`action.label` + `onClick`/`href`). Existing good copy
  (`Mission Accomplished`, `No concepts ready…`, `Nothing is due yet`) is kept
  and standardised on the primitive.
- Error explains recovery: `ErrorState` (title + description + Try again +
  `Reference: digest/requestId`) at route boundaries (`(app)/error.tsx`,
  `global-error.tsx`); `Callout danger role=alert` for inline form/API errors
  with expected-code mapping; Sentry `captureException` with boundary tags
  kept. `global-error.tsx` raw button gets token focus style in redesign.
- Masking rules frozen: study 403 → `notFound()`; root-cause/weekly-review
  invalid params → `notFound()` / invalid-identifier message.

---

## 18. Mobile Strategy

Designed, not stacked:

- Breakpoints: app `lg` (sidebar↔mobile nav), marketing `md` — reconcile to
  one switch (`lg`) so behaviour is predictable. Dialog/Sheet `sm` stays.
- Touch: 44px floors everywhere (`min-h-11`, `size-11` icon) on all
  breakpoints; fix the two violations (plan `h-8` buttons, unpadded icon
  triggers). Rating grids (`grid-cols-2 min-h-16`), full-width primaries
  (`w-full sm:w-auto`), pinned totals in onboarding editors.
- Containers: `px-4 md:8 lg:12` app well; `max-w-sm` auth; `max-w-2xl`
  onboarding/settings/standalone; `max-w-md` gates/study; marketing `px-5
  sm:6`. Map to `--content-*` tokens during migration (§4).
- Study overlay owns the viewport (`fixed inset-0`, safe-area padding,
  `text-6xl` mono clock, overrun `text-warning`) — keep and use as the model
  for future full-screen flows.
- Command palette, sheets, dialogs keep distinct widths
  (`max-w-xl / sm:max-w-sm / max-w-lg`) — document, don't unify blindly.

---

## 19. Accessibility Strategy

- Skip-link (`#main`) per shell; `aria-current="page"` on active nav;
  `aria-pressed` on concept toggles; `aria-busy` on loading buttons/regions;
  `role=alert` on errors; `role=status` on `LoadingState`; `role=progressbar`
  on root-cause bars; `sr-only` announcements for skeletons/streaming.
- Focus: `:focus-visible 2px ring offset 2px` everywhere; fix the three
  outliers (raw CTA links with `ring-2`, `global-error` raw button with none,
  `SheetTrigger` with none).
- Contrast: semantic pairs (`primary/primary-foreground`,
  `success/success-foreground`, `warning/warning-foreground`,
  `destructive/destructive-foreground`) hold in both themes; the
  `delete-account` red-500 violation is fixed — audit for the remaining
  one-offs (`bg-destructive/15`, `bg-muted/20`, `bg-background/50`).
- Touch + motion: 44px minimum (WCAG 2.5.8 iOS guideline);
  `prefers-reduced-motion` kill switch kept; no essential animation.
- Pipeline: keep `beforeunload` guards, `localStorage` drafts, and the
  existing axe-core Playwright setup; run a11y checks per migrated page.

---

## 20. Motion Strategy

Meaningful and optional (NFR-6.1):

- Durations: fast 120 (hovers, toggles), base 200 (dialogs, sheets, tabs),
  slow 320 (progress indicators) with `cubic(0.16,1,0.3,1)`.
- Skeleton `animate-pulse`; button/stream `Loader2 spin`; progress indicator
  `duration-(--duration-slow)`; command-palette/overlay fades only.
- No scroll-triggered reveals, no parallax, no sparkle, no glow pulses.
  Marketing keeps static previews (`aria-hidden`).

---

## 21. Performance Strategy

- Server-first: pages stay RSC with parallel `Promise.all` fetches;
  client islands only where state demands (forms, runners, chat, overlays).
- Skeletons prevent layout shift; `prefetch` on plan Start links; SSE parsed
  incrementally for coach; `localStorage` drafts avoid lost work.
- Tailwind v4 CSS-first with `@source` scanning `packages/ui/src` — keep, or
  production tree-shakes package utilities. No new runtime theming libraries;
  theme stays a pre-paint class toggle + `localStorage`.
- Budgets (later phases): keep `(app)` shell under current JS weight; no new
  global providers; lazy-load `PracticeRunner`, coach chat, and paywall
  behind their routes.

---

## 22. Implementation Order

Strictly page-by-page AFTER this phase. Each step migrates one surface to the
tokens + primitives above, with typecheck + tests + build green before the next.

1. Shell IA: move `/root-cause`, `/weekly-review`, `/mock-test` inside `(app)`;
   delete dead `main-nav.tsx` + empty `practice-set/`; reconcile palette labels.
2. Mission Control (`/dashboard`): `PageHeader` + `MissionCard` +
   `MissionReasoning` + `PrimaryAction`; fix `outline` usage (already safe).
3. Plan (`/plan`): `PlanTimeline`; 44px floors; tokenise arbitrary shadow.
4. Progress (`/progress`): add missing primary action; `ProgressMetric` +
   `WeakConcept`.
5. Root Cause (`/root-cause`): `RootCauseGraph` + `EvidenceBlock`.
6. Assessments (`/practice`, `/mock-test`): `AssessmentShell`; loading states;
   `<Button>` for raw CTAs.
7. Weekly Review (`/weekly-review`): `WeeklyReviewSection`s; `ErrorState` /
   `LoadingState` normalisation.
8. Coach + Memory: nav placement; bubble/row tokenisation.
9. Study (`/study/[taskId]`): tokens-only pass (state machine frozen).
10. Billing (`/billing`): `LoadingState`/`ErrorState`; keep RevenueCat as-is.
11. Settings (`/settings`): section pattern; availability/preferences forms.
12. Onboarding (`/onboarding/*`): shared stepper; header link fix.
13. Auth (`/sign-in`, `/sign-up`) + marketing (`/`): tokens-only pass; fake
    button → `<Button>`; `rounded-2xl` → scale.
14. Global sweep: focus styles, eyebrow scale, shadow scale, overlay tints,
    `text-[10px]` arbitraries, `lg`/`md` breakpoint reconciliation, a11y pass.

STOP AFTER PHASE 1. Do not begin the above until instructed.

---

## Appendix A — Files changed in Phase 1 (foundation only)

1. `packages/ui/src/styles/tokens.css` — removed duplicate
   `@import 'tailwindcss'`; added backwards-compatible aliases
   `--surface-elevated / --surface-muted / --foreground-muted / --danger(+fg) /
   --focus` + `@theme inline` utilities; added `--content-*`, `--control-*`,
   `--shadow-*` foundation scales. No existing token value changed.
2. `packages/ui/src/primitives/button.tsx` — added missing `outline` variant
   (`bg-surface border hover:bg-muted`); fixes unstyled
   `<Button variant="outline">` on Mission Control. No existing variant changed.
3. `packages/ui/src/primitives/states.tsx` — `EmptyState.action` now accepts
   optional `href` (backwards-compatible); added `LoadingState`
   (layout-preserving skeleton region). No existing behaviour changed.
4. `packages/ui/src/primitives/page-header.tsx` — NEW additive `PageHeader` +
   `SectionHeader` (typography/spacing contract). Nothing imports them yet.
5. `packages/ui/src/index.ts` — exports `page-header`.
6. `apps/web/src/components/app/app-sidebar.tsx` — added missing `Search`
   import (runtime `ReferenceError` fix; no behaviour change).
7. `apps/web/src/components/settings/delete-account-button.tsx` — replaced
   raw `red-500` classes with `destructive` + `muted-foreground` tokens.
8. `docs/FRIDAY_UI_UX_REDESIGN.md` — this blueprint (NEW).

## Appendix B — Validation (Phase 1)

- `pnpm typecheck` — see Final Report.
- `pnpm test` — see Final Report.
- `pnpm --filter=@friday/web run build` — see Final Report.
- No backend / DB / API / auth / billing / planner / adaptive / mastery /
  FSRS / scheduling / root-cause / assessment code modified.
