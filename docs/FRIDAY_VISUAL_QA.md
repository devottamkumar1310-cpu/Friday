# FRIDAY Visual QA

> Gate checklist per route. A route ships when every box is honestly checked
> against the REAL rendered app (dev or preview build + browser), on desktop,
> tablet, and mobile, in light AND dark themes.

## Per-route gates

- [ ] Hierarchy: the student knows what to do within 8 seconds.
- [ ] Student clarity: header answers WHAT IS THIS + WHY SHOULD I CARE.
- [ ] Primary action: exactly one, visually dominant, reachable by keyboard.
- [ ] Responsive: 320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440+ — designed,
      not stacked; no horizontal overflow (`scrollWidth ≤ clientWidth + 1`).
- [ ] Dark mode: intentional (technical, focused), not inverted.
- [ ] Light mode: clean, academic, calm.
- [ ] Loading: contextual skeleton preserving layout (never bare "Loading…").
- [ ] Empty: WHAT + WHY + WHAT NEXT with a filling action.
- [ ] Error: WHAT HAPPENED + WHAT IT MEANS + WHAT TO DO; safe state named.
- [ ] Accessibility: skip-link, landmarks (exactly one `<main>`), focus
      visible, `aria-current/pressed/busy` where apt, `role=alert/status/
      progressbar/timer` where apt, 44px targets, AA contrast, screen-reader
      labels meaningful out of context.
- [ ] Motion: enter-only, stagger ≤3 steps, adaptation pulses once,
      reduced-motion verified (no animation with the OS setting on).
- [ ] No visual regression: sidebar/palette labels-order-icons match;
      eyebrow scale single; no raw colors; no arbitrary radii/shadows;
      no red shame states; no fake data anywhere.

## Routes and their critical assertions

| Route | Critical assertion |
|---|---|
| `/` | Hero says what FRIDAY is; no fake claims; CTAs full-width on phones |
| `/sign-in`, `/sign-up` | Google first; errors mapped; guards redirect |
| `/onboarding/*` | Stepper truthful; "why this matters" present; guards hold |
| `/dashboard` | Mission answers WHAT/WHY/HOW LONG; Start works; noticed+adapted real |
| `/plan` | Timeline accurate; adaptation before→now honest; Re-plan gates |
| `/progress` | Ring + verdict line true; sparkline from snapshots only; remediation iff `!== 'on_track'` |
| `/practice`, `/mock-test` | Config honest (5Q/L3, 15Q/L4); runner chrome drops; errors recoverable |
| `/root-cause` | Chain ends at the real root; conclusion names it; evidence collapsed |
| `/weekly-review` | Story order; acknowledge returns to Mission Control |
| `/coach` | Grounded replies cite specifics; streams announce; no context re-asked |
| `/memory` | Beliefs correctable; FSRS dates real; deletion immediate/permanent |
| `/study/[taskId]` | Focus covers chrome; clock server-true; done shows mastery delta + dates |
| `/billing` | Real packages/prices; failure names unchanged plan + retry |
| `/settings` | Sections labelled; timezone hint true; delete confirmed |

## Automated coverage (Playwright, dev server)

Shell suite asserts per route: sidebar visible, single `<main>`, `#main`
present, correct `aria-current`, no overflow, palette mirrors nav (all ten
labels + mock discoverability), mobile sheet navigates, unauthenticated
bounces carry `next`, zero page errors, zero non-dev console errors.
