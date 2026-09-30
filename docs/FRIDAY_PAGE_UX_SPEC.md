# FRIDAY Page UX Spec

> One spec per route: purpose, student question, actions, hierarchy,
> components, states, responsive, animation, transitions, accessibility.
> Data contracts unchanged — presentation only.

## `/` — Landing
Purpose: communicate the product in one screen. Question: "What is FRIDAY?"
Primary: Start free → `/sign-up`. Secondary: See how FRIDAY works.
Hierarchy: hero (`FRIDAY learns how you learn.` + honest subcopy + CTAs +
no-hype checklist) → adaptive loop (OBSERVE→IMPROVE, evidence-first copy) →
capabilities → Mission Control previews (`aria-hidden`, real UI shapes, real
Button, no glow) → pricing → final CTA. States: static. Responsive: stacked
hero, full-width CTAs on phones. No fake testimonials/metrics/logos/users.

## `/sign-in` / `/sign-up` — Auth (split-panel shell)
Purpose: return / join. Primary: Google (first, prominent). Secondary: email
form. Tertiary: switch link. Headers answer why: "Welcome back — your next
move is waiting." / "Create your account — takes about a minute…".
States: SkeletonText suspense, button loading, Callout (expected codes),
ErrorState+requestId (unexpected). Guards + `next` validation frozen.

## `/onboarding/*` — availability → goal (+ age/guardian gates)
Purpose: start a learning relationship, not a form. Each screen: stepper,
H1 question, honest subcopy, "Why this matters" box, single submit.
Guards and single-source-of-truth rules frozen. Relationship copy kept
("Give FRIDAY the hours you realistically have…").

## `/dashboard` — Mission Control
Questions: What should I do? Why? How long? What changed? Hierarchy: header
(greeting + "Your next move is ready." + goal/countdown) → MissionCard /
MissionComplete → grid(Today's plan | What FRIDAY noticed: AdaptationCard +
IntelligenceBlocks). Transitions: Start Session → study feels like entering
focus (overlay covers shell). A11y: one main, labelled sections.

## `/plan` — Your study schedule
Question: "What is my learning schedule?" Hierarchy: PageHeader (goal,
window, Re-plan action) → AdaptationCard/ sizing note (only when material) →
14-day timeline (past hidden, per-task Start, 44px targets) → coarse
projection table → honest "Why only two weeks?" note. No invented priority
badges. Errors → EmptyState naming the fix (add hours / regenerate).

## `/progress` — Your learning progress
Questions: learned? good at? forgetting? on track? fix next? Hierarchy:
PageHeader + "Practise weak concepts" primary → Where you stand (ring +
exam-weighted copy + verdict-aware line + 6 metrics) → Momentum (velocity
sentence + real sparkline) → remediation (only when `!== 'on_track'`, three
levers together) → What to fix next (WeakConceptList → root cause).
Numbers: tabular, units attached, no red states.

## `/practice` — Practice · `/mock-test` — Mock test
Question: "What should I prove I know?" Practice: weakest-first toggles
(`aria-pressed`, mastery, provisional) → one primary (count-aware label) →
runner (chrome drops on start) → contextual mock-test link. Mock: honest
config box (15Q · all concepts · L4) → Start → shared runner. Loading:
button spinners; errors: Callout with recovery. Empty: what to do next
(study first / Mission Control).

## `/root-cause` — Root cause investigation
Question: "Why am I struggling here?" Hierarchy: back link → PageHeader →
dependency chain (numbered, mastery bars, root in warning + badge) →
FRIDAY's conclusion (names the real root id, explains prerequisite-first
logic) → Next move (Practise the root cause → `/practice`, secondary
Mission Control) → collapsed evidence (honest label). Params validated,
`notFound()` on garbage. No red shame states.

## `/weekly-review` — Your week with FRIDAY
Question: "What changed?" Storytelling: briefing header → Where you stand →
What FRIDAY noticed (insight cards, severity badges) → What struggled most
(ranked weak concepts → Follow the root cause) → Acknowledge and continue →
Mission Control. No-goal/invalid states render in-shell with recovery
actions. Never "analytics".

## `/coach` — Coach · `/memory` — Memory
Coach: header (grounded, nothing to re-explain) → rolling thread, streaming
deltas, tool badges. Memory: beliefs (correctable, deletion
immediate/permanent) → FSRS due (real dates + recall %) → mastery (evidence
counts, honest empty). No new threads UI (deferred by design).

## `/study/[taskId]` — Focus room
Question: "What am I doing right now?" Overlay covers chrome (z-50):
idle (concept list + honest clock note + Start/Not now) → focus (mono clock,
overrun in warning, Done/Pause/Discard-with-confirm) → rating (honest
recall question per concept, optional notes) → done ("X minutes done" +
mastery before→after + real review dates + praise for sitting + See what's
next → Mission Control). Server clock, drafts, unload guard frozen.

## `/billing` — Billing
Free core vs Pro divider (not cards) → Pro status card → Pro plans (real
RevenueCat packages, real prices) → secure checkout action. Loading:
LoadingState. Errors: Callout naming "Your current plan is unchanged" +
retry. No aggressive SaaS patterns. RevenueCat logic untouched.

## `/settings` — Settings
Profile (timezone drives scheduling) → availability summary (forecasts
measured against it) → preferences (quiet hours honored) → feedback →
privacy (beliefs visible/correctable) → danger zone (confirmed delete).
SectionHeaders with `aria-labelledby`, 44px controls, honest hints.
