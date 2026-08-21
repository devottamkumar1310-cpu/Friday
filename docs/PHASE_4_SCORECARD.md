# Phase 4 Scorecard — the adaptive experience

**Status: the adaptive loop is real and perceptible. Beta-ready with named gaps.**

Phase 3 proved FRIDAY's decisions were genuine. Phase 4's question is narrower
and harder: **can the learner tell?** A planner that adapts correctly and
silently is, from the seat of the person using it, indistinguishable from one
that does not adapt at all.

The bar throughout: for every adaptive sentence on screen, the chain

> engine observation → adaptive decision → planner consumer → persisted row → UI

must exist end to end, or the sentence is removed. Nothing here is a caption.

---

## What actually became adaptive

| Capability              | Before Phase 4                                        | Now                                                                  |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| **Task sizing**         | tasks sized from the concept's estimate; dial ignored | planner sizes every block to the learner's observed session          |
| **Session claim**       | suppressed (CR-017) because it could not be honoured  | made, and true — panel, persisted row and Coach all quote one number |
| **Missed work**         | correct but invisible                                 | one line, gated clause by clause on the transaction that ran         |
| **Struggling learners** | could receive an **empty plan**                       | receive 10-minute blocks matching a 10-minute dial                   |
| **Coach**               | free to invent a minute figure                        | bound to the task's minutes or the enforced budget                   |
| **Today's capacity**    | sum of today's tasks — a tautology                    | the learner's own availability                                       |

The single most important change is task sizing. It is what converts "FRIDAY
occasionally changes some numbers" into "FRIDAY gave me something I can finish
tonight", and it is the one the rest depend on: with it, the session claim
became sayable again, the Coach had a real number to be bound to, and the
struggling-learner path became testable at all.

---

## What the learner now experiences differently

A learner who has been abandoning sessions opens FRIDAY and sees:

> **Adjusting to keep you moving**
> Sized your sessions at 10 minutes.
> _You have been leaving most sessions early. A session you finish is worth
> more than one you walk away from._
>
> **Next:** Learn: Newton's Laws of Motion — **10 min**

Every number in that is the same number. The dial is 10 because nine real
sessions say so; the task row in Postgres says `estimated_minutes = 10` because
the planner built it to that budget; and the Coach, asked the same question, is
handed the same figure and forbidden from choosing another.

A learner who missed yesterday sees one added line:

> 1 missed task went back into the queue.
> _Nothing was added to today — still 40 min of 60._

The count comes from the transaction that retired those rows. The reassurance is
re-derived at read time against real availability and simply omitted if it does
not hold. There is no fallback wording, because a learner told nothing was added
who then finds a doubled Tuesday stops believing the next claim too.

---

## Components reused rather than rebuilt

Deliberately almost everything:

- **`plans.diff_summary`** — a column that has existed since Phase 1 and was
  written as literal `null` on every plan ever created. It is exactly the right
  home for "what did this re-plan do", so it now holds that.
- **The Live Intelligence Panel's "What I changed" beat** — redistribution joins
  the existing list. No new card. A learner does not experience "session sizing"
  and "your missed work" as two categories of announcement.
- **`core/priority`'s selector** — untouched. It was already correct; the fault
  was upstream, in how tasks had been sized.
- **The shared `Button`/`Input`/`Select` primitives** — every tap-target fix
  landed on the token, not on call sites.
- **The existing e2e harness** — `audit-matrix.spec.ts` reuses `support/learner`.

One new abstraction was genuinely required: a **remaining-work ledger** in the
scheduler (`remainingByConceptId`), replacing a boolean "scheduled or not". Task
chunking cannot be expressed without it, and its absence was also silently
losing work — a 50-minute concept meeting a 20-minute gap became a 20-minute
task and the other 30 minutes ceased to exist.

---

## Defects found and fixed

| CR     | Defect                                                            | Severity |
| ------ | ----------------------------------------------------------------- | -------- |
| CR-020 | A struggling learner could be given an **empty plan**             | critical |
| CR-021 | Unhandled idle-pool errors collapsed the integration suite        | high     |
| CR-022 | The Coach could contradict the planner's enforced dial            | high     |
| CR-023 | Every icon button, nav link and form control below the tap floor  | high     |
| CR-024 | `capacityToday` was a tautology; today counted retired rows       | high     |
| CR-025 | Redistribution was correct and invisible                          | medium   |
| CR-026 | Real N+1s, behind a performance budget that could not fail for us | medium   |
| —      | `adaptive.spec.ts` asserted something that could never pass       | low      |

Three were found only because a test was **strengthened first**: the empty plan
hid behind `Math.max([]) === -Infinity`; the tautological capacity hid behind an
assertion that compared a number with itself; and the struggling persona was too
mild to reach the branch it was named after.

Two defects were **mine**, caught by my own audit and worth recording: a contrast
detector that parsed `oklch()` as RGB and produced 28 phantom findings, and a
`sm:min-h-8` rule that put small buttons back under the tap floor on tablets.

---

## Measurements

**Responsive / theme matrix** — 7 surfaces × 6 viewports (320/360/390/768/1024/1440)
× 2 themes, real interaction:

| Check       | Result                                     |
| ----------- | ------------------------------------------ |
| overflow    | **0** at every width, both themes          |
| contrast    | **0** below 3:1                            |
| tap targets | **0** below 44px (was 336 findings)        |
| focus       | every dashboard control has a visible ring |

**Performance** — measured against its own round-trip floor, because a single
trip to the managed database costs ~138ms and a 200ms budget is unreachable
regardless of code:

| endpoint        | p50 before | p50 after | round trips |
| --------------- | ---------- | --------- | ----------- |
| mission-control | 3560ms     | 1951ms    | ~24 → ~12   |
| next-action     | 1139ms     | 991ms     | ~9 → ~6     |
| /tasks          | 1237ms     | 772ms     | ~8 → ~6     |

`/dashboard → actionable`: data 1742ms + render 343ms. The front end is not the
bottleneck; distance to the database is, and that is documented rather than
absorbed into a raised budget.

---

## What remains

1. **The plan page is still a list.** Priorities 3 and 6 of the Phase 4 brief —
   making `/plan` and `/progress` narrate the adaptive loop the way the dashboard
   now does — are not done. The dashboard carries the whole experience today.
2. **`learner: { reliability, pace }` is still hard-coded to 1.0** at every
   `generatePlan` call site. The engine supports learner factors; the application
   never derives them, so the pace model remains inert.
3. **No cron.** New-day adaptation fires on dashboard render. A learner who does
   not open the app is not re-planned.
4. **Wall-clock budgets are unverified.** They are asserted only against a
   co-located database, which no environment here provides. NFR-1.3 and NFR-1.7
   remain unproven in absolute terms.
5. **The prior-window transition** ("two weeks ago you were struggling") still
   has no database-backed proof of its _presence_ — only of its absence.

---

## Is it ready for beta?

**Yes, with the caveat that the dashboard is the product.**

A real student tomorrow would experience a genuine adaptive loop: FRIDAY watches
how long they actually study, sizes tomorrow's work to that, tells them what it
changed in a sentence backed by a database row, and never claims a change it did
not make. When it does not know them yet, it says so and changes nothing — which
is the behaviour that makes the rest believable.

What they would _not_ get is that same intelligence on `/plan` or `/progress`,
which remain competent but ordinary. That is a gap in reach, not in truth: no
screen in the product now says something the engine did not do.
