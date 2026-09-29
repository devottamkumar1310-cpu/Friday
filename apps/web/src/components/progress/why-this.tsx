import { Badge, cn } from '@friday/ui';

/**
 * "Why this?" — roadmap 2.10, AI_DECISION_ENGINE §12.1 layer L2.
 *
 * This is a **direct projection of the numbers that produced the decision**, not
 * a separate explanation (DP3). The dominant factor is highlighted because
 * invariant I-11 says it is the largest contributor — if this UI ever disagreed
 * with the arithmetic, the bug would be in the engine, not here.
 *
 * What changed is who it is written for. It used to open with
 * `Priority score 0.077` and, on a brand-new learner's very first
 * recommendation, a badge reading **"low confidence"** — the engine's own band
 * string presented as a verdict on its own advice. Both were true and both were
 * damaging: 0.077 sounds like a failing grade to anyone who does not know the
 * scale, and being told the first thing you are ever shown is low-confidence is
 * a reason to close the tab.
 *
 * The arithmetic is unchanged and nothing is hidden — the same five factors, in
 * the same order, with the same dominant one marked. Only the vocabulary is the
 * learner's instead of the engine's, and uncertainty is stated as a sentence
 * about what happens next rather than a label on the present.
 */

export interface FactorView {
  value: number;
  contribution: number | null;
  detail: string;
}

export interface WhyThisProps {
  priorityScore: number;
  factors: {
    impact: FactorView;
    urgency: FactorView;
    decayRisk: FactorView;
    readiness: FactorView;
    cost: FactorView;
  };
  dominantFactor: string;
  confidence?: { score: number; band: string };
}

/**
 * Plain speech, but *dimensions* rather than claims.
 *
 * The first pass at this used declarative labels — "You are starting to forget
 * it" — which read beautifully when the value was high and became false when it
 * was not: a brand-new concept rendered "You are starting to forget it" directly
 * above its own detail line, "Not yet studied — no decay risk." A label that
 * contradicts the sentence beneath it is worse than the engine's jargon was.
 *
 * These name the question instead. The `detail` line, which comes from the
 * engine and is already specific, gives the answer.
 */
const FACTOR_LABELS: Record<string, string> = {
  impact: 'How much it matters',
  urgency: 'How soon you need it',
  decayRisk: 'How fast it fades',
  readiness: 'Whether you can start',
  cost: 'Time it takes',
};

export function WhyThis({ factors, dominantFactor, confidence }: WhyThisProps) {
  const entries = (Object.keys(FACTOR_LABELS) as (keyof WhyThisProps['factors'])[]).map((key) => ({
    key,
    label: FACTOR_LABELS[key]!,
    factor: factors[key],
    isDominant: key === dominantFactor,
  }));

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {entries.map(({ key, label, factor, isDominant }) => (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  'text-sm',
                  isDominant ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {isDominant ? (
                // The `Badge` primitive rather than a hand-rolled pill: a
                // tinted `bg-primary/10` behind `text-primary` at 11px measures
                // 4.19:1, just under the 4.5:1 floor for small text.
                <Badge variant="primary" className="shrink-0 text-[11px]">
                  main reason
                </Badge>
              ) : key === 'cost' ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.round(factor.value)} min
                </span>
              ) : null}
            </div>

            {/* Contribution is the share of the additive value bracket. Readiness
                is a multiplicative gate and cost a divisor, so neither has one —
                showing a bar for them would misrepresent the formula. */}
            {factor.contribution !== null && factor.contribution > 0 ? (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
                    isDominant ? 'bg-primary' : 'bg-foreground/25',
                  )}
                  style={{ width: `${Math.round(factor.contribution * 100)}%` }}
                />
              </div>
            ) : null}

            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{factor.detail}</p>
          </li>
        ))}
      </ul>

      {/*
        Uncertainty, said forwards. "low confidence" describes the engine's
        state; this describes the learner's — and tells them the thing that is
        actually true and actually reassuring, which is that it improves.
      */}
      {confidence && confidence.band !== 'high' ? (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          FRIDAY is still learning how you work. The more you study, the sharper this gets.
        </p>
      ) : null}
    </div>
  );
}
