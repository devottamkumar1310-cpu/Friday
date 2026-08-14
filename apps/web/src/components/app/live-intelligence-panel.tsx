import Link from 'next/link';
import { ArrowRight, Check, Eye, Sparkles, TriangleAlert } from 'lucide-react';
import { renderDirective, type AdaptiveProfile } from '@friday/core';
import { Button } from '@friday/ui';
import { WhyThis, type WhyThisProps } from '@/components/progress/why-this';

/**
 * The Live Intelligence Panel.
 *
 * One column, three beats, in the order a decision is actually made:
 *
 *     what I noticed  →  what I did about it  →  what you should do now
 *
 * It replaces the two-card grid because that layout presented FRIDAY as a task
 * manager: a list of things to do, next to a list of things wrong. Nothing on
 * screen carried the one thing this product has that a to-do list does not —
 * that it watched, concluded, and changed something. The reasoning was there
 * all along, folded behind a "why this?" disclosure that read like a footnote.
 *
 * Structured as a stream of statements from the system rather than as cards.
 * Cards say "here is a module of information". A stream says "something is
 * thinking about you", which is the accurate description of what happens.
 *
 * Every line here is deterministic — computed in `@friday/core`, never written
 * by a model. The Coach reads this same profile, so the two cannot disagree.
 */

export interface PanelRisk {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
}

export interface PanelAction {
  taskId: string;
  title: string;
  estimatedMinutes: number;
  rationale: string;
  /**
   * The five-factor breakdown behind this specific task.
   *
   * Kept from the old layout. The panel above explains the *plan* — why the
   * workload moved — and this explains the *pick*. Dropping it while adding a
   * section called "what I noticed" would have traded one explanation for
   * another rather than deepening either.
   */
  why: WhyThisProps | null;
}

export interface LiveIntelligencePanelProps {
  firstName: string;
  goalTitle: string;
  daysRemaining: number;
  profile: AdaptiveProfile;
  risks: PanelRisk[];
  action: PanelAction | null;
  /** Tasks still scheduled today, for the one-line footnote under the action. */
  remainingToday: number;
}

/**
 * The status line under the greeting. Never a score — a state, in words.
 *
 * Trend outranks band here because it is the more recent fact and the one the
 * learner will feel tonight. A fortnight-steady learner whose last three
 * sessions fell apart should not be greeted with "Holding your plan steady";
 * that is technically true and reads as a system that has not been paying
 * attention.
 */
function statusLine(profile: AdaptiveProfile): string {
  if (profile.band === 'unknown') return 'Still learning how you study';
  if (profile.trend === 'declining') return 'Easing off — this week got harder';
  if (profile.trend === 'improving') return 'Pushing you harder — you have room';

  switch (profile.band) {
    case 'struggling':
      return 'Adjusting to keep you moving';
    case 'thriving':
      return 'Pushing you harder';
    default:
      return 'Holding your plan steady';
  }
}

export function LiveIntelligencePanel({
  firstName,
  goalTitle,
  daysRemaining,
  profile,
  risks,
  action,
  remainingToday,
}: LiveIntelligencePanelProps) {
  /**
   * Risks join the observation stream rather than living in their own card.
   * A learner does not experience "feasibility" and "you have been dropping
   * sessions" as two categories of thing — both are the system telling them
   * something it noticed, and splitting them across the screen made neither
   * land.
   */
  const observations = [
    ...profile.observations.map((o) => ({
      key: o.id,
      statement: o.statement,
      evidence: o.evidence,
      alarming: o.tone === 'concern',
    })),
    ...risks.map((r) => ({
      key: r.id,
      statement: r.title,
      evidence: r.detail,
      alarming: r.severity === 'high',
    })),
  ];

  // Deterministic, computed in the engine beside the numbers it cites — so the
  // instruction on screen and the one the Coach speaks are the same sentence.
  const directive = action
    ? renderDirective(profile, {
        taskTitle: action.title,
        estimatedMinutes: action.estimatedMinutes,
      })
    : null;

  /**
   * A sizing claim is only shown when the recommendation actually honours it.
   *
   * `targetSessionMinutes` is passed to the planner as the time budget, and the
   * selector walks the ranking for the first task that fits it — but when
   * *nothing* fits, `core/priority` deliberately returns the top candidate
   * whole rather than substituting a lesser one (§7.2 step 3). That is the
   * right call for the ranking and the wrong thing to narrate: the panel was
   * rendering "Held your sessions at about 15 minutes" directly above a task
   * labelled "50 min", in the same screenful.
   *
   * A learner reading a system contradict itself about the one thing it just
   * claimed to have personalised does not conclude that a heuristic hit an edge
   * case. They conclude it is making things up, and every other claim on the
   * screen goes with it.
   *
   * So the decision is dropped rather than dressed up. FRIDAY still adapted the
   * budget — the ranking really was fitted against it — it simply has nothing
   * short enough to offer today, and the honest move is to say less. Restoring
   * the claim needs the planner to size tasks to the session, not the panel to
   * word it more carefully.
   */
  const sizingIsHonoured =
    action === null || action.estimatedMinutes <= profile.targetSessionMinutes;
  const decisions = sizingIsHonoured
    ? profile.decisions
    : profile.decisions.filter((d) => !/minutes\./.test(d.change));

  return (
    // Single column at every width. `max-w-xl` rather than the layout's full
    // `max-w-5xl`: this is one conversation, and a conversation that spans a
    // desktop monitor is unreadable.
    <div className="mx-auto w-full max-w-xl space-y-6 pb-28 sm:pb-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {firstName}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {goalTitle} · {daysRemaining} days left
        </p>
      </header>

      <section
        aria-label="What FRIDAY is doing"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <span className="text-sm font-medium">{statusLine(profile)}</span>
          {profile.metrics.currentStreakDays >= 3 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {profile.metrics.currentStreakDays}-day run
            </span>
          ) : null}
        </div>

        <div className="divide-y divide-border">
          <Beat
            icon={<Eye className="size-4" aria-hidden />}
            label="What I noticed"
            items={observations.map((o) => ({
              key: o.key,
              primary: o.statement,
              secondary: o.evidence,
              alarming: o.alarming,
            }))}
            emptyText="Nothing worth flagging."
          />

          <Beat
            icon={<Check className="size-4" aria-hidden />}
            label="What I changed"
            items={decisions.map((d) => ({
              key: d.id,
              primary: d.change,
              secondary: d.because,
              alarming: false,
            }))}
            emptyText="Your plan is unchanged."
          />
        </div>
      </section>

      {action && directive ? (
        <section aria-label="Your next action" className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Next action
          </h2>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-semibold leading-snug tracking-tight">{action.title}</p>
              <span className="shrink-0 text-sm text-muted-foreground">
                {action.estimatedMinutes} min
              </span>
            </div>
            {/*
              The directive replaces the rationale here — it does not join it.
              Two explanatory paragraphs above the button is two paragraphs to
              read before acting, and the factor breakdown below already carries
              the reasoning for anyone who wants it.

              This also retires the "longer than the N minutes I aimed for"
              caveat: the commitment is to *time*, so a 50-minute task under a
              10-minute target no longer contradicts anything. The learner is
              asked for ten minutes and the task takes what it takes.
            */}
            <p className="mt-1.5 text-sm font-medium leading-relaxed">{directive.text}</p>
          </div>

          {/*
            One primary action, and on a phone it is always on screen — this is
            the single thing the page exists to cause, and it used to sit below
            two cards of context that had to be scrolled past first.

            `prefetch` is not decoration: the study route is server-rendered and
            the whole point of this surface is that deciding to study and being
            in a session are the same gesture.
          */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-4 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
            <div className="mx-auto max-w-xl">
              <Button asChild size="lg" className="h-12 w-full">
                {/* Label unchanged from the previous layout on purpose: it is
                    more specific than "Start now", and renaming a working CTA
                    would churn the browser suite for nothing. */}
                <Link href={`/study/${action.taskId}`} prefetch>
                  Start this now
                  <ArrowRight className="ml-1.5 size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>

          {/*
            The factor breakdown moved *below* the action.

            It is the evidence for a decision that has already been made, and
            above the button it competed with the button: five labelled bars of
            reading between the learner and the one thing this page exists to
            cause. Decision first, justification underneath, which is also the
            order the panel above uses.

            Still expanded, deliberately. An earlier pass moved this out from
            behind a "Why this?" disclosure, because explaining itself is the one
            thing FRIDAY does that a to-do list cannot and it was folded away
            like a footnote. Demoting it is right; re-hiding it is not.
          */}
          {action.why ? (
            <div className="rounded-2xl border border-border bg-card/50 px-4 py-3">
              <p className="mb-1.5 text-sm font-medium">Why this one</p>
              {/* The engine's own prose, moved down from above the button. */}
              <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                {action.rationale}
              </p>
              <WhyThis {...action.why} />
            </div>
          ) : null}

          <p className="text-center text-xs text-muted-foreground">
            {remainingToday > 0 ? (
              <>
                {remainingToday} more today ·{' '}
                <Link href="/plan" className="underline underline-offset-4">
                  see the plan
                </Link>
              </>
            ) : (
              <Link href="/plan" className="underline underline-offset-4">
                See the full plan
              </Link>
            )}
          </p>
        </section>
      ) : (
        <section aria-label="Your next action" className="rounded-2xl border border-border p-6">
          <p className="text-sm font-medium">Nothing fits the time you have left today.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Come back tomorrow, or rebuild the plan from{' '}
            <Link href="/plan" className="underline underline-offset-4">
              your plan
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}

interface BeatItem {
  key: string;
  primary: string;
  secondary: string;
  alarming: boolean;
}

/** One beat of the stream: a label, then the statements under it. */
function Beat({
  icon,
  label,
  items,
  emptyText,
}: {
  icon: React.ReactNode;
  label: string;
  items: BeatItem[];
  emptyText: string;
}) {
  return (
    <div className="px-4 py-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.key} className="flex gap-2.5">
              {item.alarming ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              ) : (
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  aria-hidden
                />
              )}
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">{item.primary}</p>
                {/* The number behind the claim. Without it the panel is a
                    horoscope; with it, the learner can check the system. */}
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {item.secondary}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
