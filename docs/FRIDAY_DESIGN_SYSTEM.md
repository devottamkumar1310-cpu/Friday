# FRIDAY Design System — Canonical Visual Language

> This is the canonical visual language of FRIDAY. It governs every pixel the
> student sees. Product architecture (docs/SYSTEM_ARCHITECTURE.md,
> docs/AI_DECISION_ENGINE.md, docs/PRODUCT_REQUIREMENTS.md) is authoritative
> for behavior; this document is authoritative for presentation. Where they
> conflict on what the UI may claim, the architecture docs win.
>
> Non-negotiable glossary (deviation is a bug): Goal, Curriculum,
> Subject/Unit/Topic/Concept, Mastery, Memory State, Evidence Event, Plan,
> Study Block, Task (`learn|practice|revise|assess|project`), Session,
> Next Action, Insight, Directive, Learner Fact, Mission Control.
> Feasibility verdicts only: `on_track | at_risk | not_feasible`.
> Self-ratings only: `again | hard | good | easy`.
> Confidence scores/bands are computed but NOT surfaced in UI (M0).

---

## 1. Brand

**Personality.** A personal AI learning companion and study operating system.
Intelligent, focused, youthful, premium, technical, calm, motivating,
trustworthy, highly intentional.

**Emotional tone.** "This system understands how I learn and knows what I
should do next." Never "this is a dashboard containing my study statistics."

**Visual principles.**

1. One primary action per screen. The Next Action owns the saturation;
   everything else recedes.
2. Typography creates hierarchy; cards are earned, not default.
3. The loop is visible: OBSERVE → UNDERSTAND → PLAN → STUDY → ADAPT → EXPLAIN.
   Intelligence is shown as noticed → means → changing → why, never as a
   generic "AI Insight" badge.
4. Deterministic systems decide; the model explains. Numbers (mastery, due
   dates, verdicts, diffs) are computed facts. Prose next to them explains.
5. Honesty over comfort. No guilt mechanics: missed days are absorbed
   silently, no red streaks, no shame, no artificial urgency, no flattery.
6. Respect attention. No decoration-only animation, no sparkle, no glow, no
   glassmorphism, no gradients-as-identity.

**Student experience principles.** A returning student reads the screen and
starts work in ≤8 seconds. Every major screen answers: What should I do?
Why? How long? What changed? What happens next? Empty states say what FRIDAY
needs next. Errors say what happened, what it means, what to do.

**Design philosophy.** Calm surfaces, precise data, one recognizable accent
used strategically. Light mode feels clean and academic; dark mode feels
technical and focused. Both are intentionally designed, never an inversion.

---

## 2. Color

Single source: `packages/ui/src/styles/tokens.css` (Tailwind v4 CSS-first).
Components use semantic utilities only (`bg-surface`, `text-muted-foreground`,
`border-border`, `bg-primary`…). Raw palette values in components are a bug.

### Accent — Focus Teal

A restrained, recognizable FRIDAY accent communicating
INTELLIGENCE + FOCUS + PROGRESS. Not corporate blue, not SaaS gray, not
purple-AI.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | oklch(0.53 0.10 179) | oklch(0.72 0.11 182) | active nav, primary actions, current mission, progress fill, focus ring, selected states |
| `--primary-hover` | darker / lighter pair | — | hover only |
| `--primary-foreground` | near-white | deep teal-ink | text on accent |

Saturation budget: the accent appears on the primary action, the active nav
item, mission markers, and progress fills — nowhere else by default.

### Surfaces & text

| Token | Light | Dark |
|---|---|---|
| `--background` | oklch(0.985 0.002 245) | oklch(0.14 0.01 260) |
| `--surface` | #fff | oklch(0.18 0.015 260) |
| `--surface-raised` | oklch(0.99 …) | oklch(0.22 …) |
| `--surface-elevated` | = surface (light) | oklch(0.24 …) |
| `--surface-muted` | oklch(0.95 …) | oklch(0.22 …) |
| `--foreground` | oklch(0.15 …) | oklch(0.96 …) |
| `--foreground-muted` (= `--muted-foreground`) | oklch(0.50 …) | oklch(0.70 …) |
| `--subtle-foreground` | oklch(0.65 …) | oklch(0.55 …) |
| `--border` / `--border-strong` | 0.90 / 0.82 | 0.25 / 0.35 |
| `--focus` (= `--ring`) | primary | primary-light |

### Status & domain color

| Token | Meaning | Rules |
|---|---|---|
| `--success` | mastery, progress-positive, healthy | never gamified; no confetti |
| `--warning` | review-due, attention, `at_risk` | calm amber, never alarming red |
| `--danger` (= `--destructive`) | errors, destructive confirm, `not_feasible` | errors only; never shame, never streaks |
| `--info` | neutral system notices (rare) | desaturated slate-blue; default to neutral surfaces instead |
| `--ai-accent` / `--ai-surface` | AI/system voice | reserved for FRIDAY-spoken content: noticed markers, AiBadge, plan-update surfaces. Muted violet, flat — never gradient, never glow |

Mastery/progress fills use `--success` for achieved state and `--primary`
for current-motion state (today's mission progress, plan progress). Review and
struggling-attention use `--warning`. There is no red progress state.

---

## 3. Typography

System font stack (no webfont dependency — performance budget). Hierarchy:

| Role | Style | Use |
|---|---|---|
| Display | 36–40px, semibold, tight | mission minutes, hero numbers only |
| Page title | 24–30px (`text-2xl sm:text-3xl`), semibold, tight | one per page via `PageHeader` |
| Section title | 18–20px, semibold, tight | via `SectionHeader` |
| Eyebrow | 12px, semibold, uppercase, `tracking-wider`, muted | exactly one scale everywhere |
| Body | 14px relaxed, muted or foreground | explanations, reasoning |
| Meta | 12px, subtle | timestamps, captions, evidence labels |
| Mono data | `font-mono tabular-nums` | concept ids, reference ids, durations in study |

Numbers communicate meaning: big number + unit + question answered.
GOOD: `TODAY / 48 min / of focused work planned`. BAD: `Today's Planned
Minutes / 48`. Study content uses relaxed 15–16px. AI reasoning uses body
14px with clear noticed→means→changing→why structure, never a wall of text.

---

## 4. Spacing / radius / shadow / border / motion tokens

- Spacing: Tailwind scale; page rhythm `space-y-10/12` for major sections,
  `space-y-4/6` inside cards. Content wells: `--content-narrow 28rem`
  (auth/gates/study), `--content-form 42rem` (onboarding/settings),
  `--content-app 64rem` (authenticated shell), `--content-wide 72rem`
  (marketing).
- Radius: `--radius 0.375rem`; `sm −4px / md −2px / lg = radius / xl +4px`.
  Card roles differ by border/background/purpose — never by inventing radii.
- Borders: 1px `border-border`; emphasis `border-strong`; dashed for empty
  states; tinted (`-destructive/30`, `-warning/20`) only for error/attention
  roles.
- Shadows: `none/sm` default; `lg` dialogs/sheets; `2xl` command palette
  only. No `shadow-md` cards, no colored glows.
- Controls: 44px minimum (`min-h-11`, `size-11` icon) on all breakpoints.
- Motion: `--duration-fast 120ms` micro, `--duration-base 200ms` component,
  `--duration-slow 320ms` major; `--ease-out cubic(0.16,1,0.3,1)`.
  Enter language: `.animate-enter` (fade + 8px rise, both themes), stagger via
  inline `--enter-delay`. Adaptation pulse: `.animate-adapt` (soft ring,
  once). Global `prefers-reduced-motion` kill switch stays.
- z-index: content < sticky nav (30) < study overlay (50) < sheet/dialog
  (Radix) < palette (100) < toaster < dev overlay.

---

## 5. Card roles

One generic Card look is forbidden. Each role below has a fixed job; see
docs/FRIDAY_COMPONENT_GUIDE.md for props/states per component.

| Role | Job | Treatment |
|---|---|---|
| MissionCard | WHAT / WHY / HOW LONG / WHY NOW + Start | `surface-raised`, strong border-left or top mission marker in primary, display minutes, Start Session dominant |
| NextAction | "What should I do right now?" | mission variant, compact |
| ProgressCard | "How am I progressing?" | ring + exam-weighted standing, neutral surface |
| MasteryCard | "What do I actually know?" | success-tinted mastery, tabular numbers |
| WeakConcept | "What should I fix?" | row → root-cause link, mastery bar, provisional badge |
| RootCauseCard | "Why am I struggling?" | chain step; root step gets danger tint + badge |
| AdaptationCard | "What did FRIDAY change?" | `ai-surface`, before → now, reason, View changes |
| IntelligenceBlock | "What did FRIDAY notice?" | NOTICED / MEANS / CHANGING / WHY structure, ai-accent eyebrow |
| EvidenceBlock | "What supports this?" | collapsed `<details>`, mono, muted |
| WeeklyReviewCard | "What changed this week?" | storytelling header, observed/changed/next |
| AssessmentCard | "What assessment should I take?" | config → runner → review; timer/progress honest |
| MomentumCard | "How is my learning momentum?" | velocity sentence + real sparkline (snapshots only) |

Hover: border-strong shift only. Focus: global ring. Loading: role-shaped
skeleton, never spinner. Empty: dashed + WHAT/WHY/NEXT + action. Error:
WHAT + MEANING + recovery action. Mobile: single column, full-width primary,
44px targets. Motion: enter only; adaptation pulse once.

---

## 6. Intelligence language (binding)

Visual order for every system message:

1. `FRIDAY NOTICED` — observation, ai-accent eyebrow.
2. `WHAT THIS MEANS` — interpretation in plain language.
3. `WHAT I'M CHANGING` — the concrete decision (deterministic).
4. `WHY` — evidence pointer (factors/dominant factor, never invented).
5. Optional: `[Why did FRIDAY make this decision?]` → factor breakdown (L2).

Never render a bare "AI Insight" card. Never imply the LLM computed a
number. Low confidence changes the category (shorter diagnostic, retrieval
over passive), never suppresses the decision; surface hedging posture in
words, never numeric confidence.

---

## 7. Voice & microcopy

Glossary terms as literal headings (Mission Control, Next Action, Mastery).
Prefer: "Start today's mission", "See why FRIDAY changed your plan", "Fix
this weakness", "See what FRIDAY noticed", "Review what changed", "Continue
learning", "See why this matters", "Follow the root cause". Forbid: "View
Analytics", "Manage Tasks", "AI Insights", "Performance Metrics", "Data
Overview". Errors: WHAT HAPPENED + WHAT IT MEANS + WHAT TO DO; previous safe
state is named ("Your previous plan is still safe. [Try Again]").

---

## 8. Responsive & accessibility contract

Breakpoints designed, not stacked: 320/375/390/430 phones (one focus,
sticky primary where appropriate, no overflow), 768 tablet (adaptive
columns), 1024/1280/1440+ desktop (hierarchy + purposeful spacing). Shell
switches at `lg`. Keyboard: skip-link, `aria-current="page"`, `aria-pressed`
toggles, `aria-busy` loading, `role=alert` errors, `role=status` loading
regions, `role=progressbar` with values. Touch ≥44px. Contrast AA pairs only.
`prefers-reduced-motion` honored. Semantic landmarks: exactly one `<main>`
per page.
