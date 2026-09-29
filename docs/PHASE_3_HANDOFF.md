# Phase 3 → Phase 4 Handoff

> **Baseline:** Blueprint v1.5 · **FROZEN** · git tag `phase-3-baseline`
> **Full detail:** [PHASE_3_REPORT.md](PHASE_3_REPORT.md) · [ARCHITECTURE_CHANGELOG.md](ARCHITECTURE_CHANGELOG.md) (CR-006)
> **Launch Candidate:** not yet — three named blockers, all verification rather than construction. See §7 below.

---

## 1. What was implemented

The user-facing application. The frontend went from **2 pages to 15**, and every backend capability now has a UI.

- **Onboarding**: availability editor (with overlap validation) → goal creation. Previously **a learner could not create a goal at all**.
- **Mission Control**: Next Action with the "why this?" factor breakdown, today's tasks, risks, and a start-session action.
- **Study session**: wall-clock timer, pause, per-concept rating, notes, abandon.
- **Practice**: weak-concept picker → question runner → immediate graded feedback → mastery delta.
- **Coach**: SSE streaming chat with tool-call visibility.
- **Progress**, **Memory**, **Settings**, plus error/loading/not-found/global-error boundaries.

## 2. What was verified

**Static:** format, lint, typecheck, **249 tests** (was 228), production build (43 API routes, 15 pages).

**Runtime:** the complete student journey as a brand-new learner on PostgreSQL 18.4 — sign up → availability → goal → plan → study session (mastery `0 → 0.098`) → practice (`0.098 → 0.2456`) → progress → settings, with E-19 concurrency refused and the Coach degrading honestly on exhausted quota.

**Five defects found and fixed**, including one that **broke the production build** (client error boundaries importing a Node-only package) and one where the Coach reported the wrong model vendor in its stream.

## 3. Public APIs added

Ten endpoints — nine specified in Phase 0 and never built, one new:

```
GET/PUT   /me/availability          GET/PATCH /me/preferences
GET       /sessions                 GET       /sessions/{sessionId}
POST      /sessions/{sessionId}/abandon
GET       /tasks                    PATCH     /tasks/{taskId}
GET       /tasks/{taskId}/study     ← new; composes existing reads into one request
```

## 4. Database changes

**None.** No migration, no schema change. Phase 3 read and wrote through the existing tables only.

## 5. New packages and modules

No new packages. New modules: `identity/settings.service.ts`; UI primitives `Select`, `Textarea`, `Spinner`, `Callout`; component directories `study/`, `practice/`, `coach/`, `memory/`, `settings/`, `app/main-nav`. Contract schemas `me-settings.ts`, `sessions.ts`.

## 6. Remaining known limitations

1. **No component tests.** §7.2 sets a ≥60% bar. The UI is verified through the API beneath it, which is not the same thing.
2. **No browser testing at all** — responsive behaviour, focus order, and screen-reader output are coded for but never observed.
3. **Coach SSE client never met a live stream** (Gemini quota exhausted); only its error path ran.
4. **Coach is single-thread** in the UI; the API supports more.
5. **Curriculum editing has no UI** (endpoint exists) — Phase 4 scope.
6. **Insights and trends render empty** — no generator, no scheduled snapshot writer until Phase 4.
7. Carried forward: no integration/tenancy suite, no property-based tests, no load testing, no CI, unpartitioned high-volume tables, κ inflated by a single observation (CR-004 §6).

## 7. Exact starting point for Phase 4

**Phase 4 should be verification first, then Adaptation.** The build is more complete than it is proven, and the three Launch Candidate blockers are all provable in days:

```
B1  Playwright E2E over the §1 journey + axe-core in CI     ← largest gap
B2  Live Coach verification with a working AI key           ← least-verified code
B3  git remote + CI running the existing gates              ← nothing survives a second contributor without it
```

Then roadmap §3's **Adaptation** scope, which CR-006 deferred here:

```
Nightly re-plan cron (timezone fan-out) — core/replanning already has the
  drift computation, materiality gate, and churn budget; this is wiring
Drift detection · plan diff and history UI · availability change → re-plan
Curriculum editing (rename, exclude, mark known)  — endpoint exists, UI does not
Diagnostic assessment to seed initial mastery     · Diagnostician agent
Reflection job writing Learner Facts              · Reflector agent
progress_snapshots finally gets its scheduled writer (unblocks trends)
Coach write tools with confirmation gate          · session pause/resume persistence
pgvector + memory_chunks (D11)                    · semantic memory search
```

**Two decisions to make before starting.** First, whether to spend a paid AI key — B2 and the Diagnostician/Reflector all need one, and Phase 4 would otherwise add two more unverified agents on top of three. Second, the κ single-observation fix (CR-004 §6), since the Diagnostician's confidence behaviour depends on it.

Nothing in `packages/core`, `packages/db`, or `packages/ai` needs restructuring. `memory_chunks` + pgvector is the one genuinely new infrastructure dependency, and D11 already specifies which migration installs it.

Do not begin Phase 4 implementation until this handoff is reviewed and approved.
