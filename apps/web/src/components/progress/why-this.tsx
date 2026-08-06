import { Badge, cn } from '@friday/ui';

/**
 * "Why this?" factor breakdown — roadmap 2.10, AI_DECISION_ENGINE §12.1 layer L2.
 *
 * This is a **direct projection of the numbers that produced the decision**, not
 * a separate explanation (DP3). The dominant factor is highlighted because
 * invariant I-11 says it is the largest contributor — if this UI ever disagreed
 * with the arithmetic, the bug would be in the engine, not here.
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

const FACTOR_LABELS: Record<string, string> = {
  impact: 'Impact',
  urgency: 'Urgency',
  decayRisk: 'Decay risk',
  readiness: 'Readiness',
  cost: 'Cost',
};

const FACTOR_MEANING: Record<string, string> = {
  impact: 'How much learning this is worth',
  urgency: 'How soon it has to happen',
  decayRisk: 'How likely you are to lose it',
  readiness: 'Whether your prerequisites are in place',
  cost: 'What it takes',
};

export function WhyThis({ priorityScore, factors, dominantFactor, confidence }: WhyThisProps) {
  const entries = (Object.keys(FACTOR_LABELS) as (keyof WhyThisProps['factors'])[]).map((key) => ({
    key,
    label: FACTOR_LABELS[key]!,
    meaning: FACTOR_MEANING[key]!,
    factor: factors[key],
    isDominant: key === dominantFactor,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Priority score</span>
        <span className="font-mono text-sm tabular-nums">{priorityScore.toFixed(3)}</span>
        {confidence ? (
          <Badge variant={confidence.band === 'high' ? 'success' : 'neutral'}>
            {confidence.band} confidence
          </Badge>
        ) : null}
      </div>

      <ul className="space-y-3">
        {entries.map(({ key, label, meaning, factor, isDominant }) => (
          <li
            key={key}
            className={cn(
              'rounded-md border px-3 py-2',
              isDominant ? 'border-primary/40 bg-primary/5' : 'border-border',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                {isDominant ? (
                  <Badge variant="primary" className="text-[10px]">
                    dominant
                  </Badge>
                ) : null}
              </div>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {key === 'cost' ? `${Math.round(factor.value)} min` : factor.value.toFixed(2)}
              </span>
            </div>

            {/* Contribution is the share of the additive value bracket. Readiness
                is a multiplicative gate and cost a divisor, so neither has one —
                showing a bar for them would misrepresent the formula. */}
            {factor.contribution !== null && factor.contribution > 0 ? (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    isDominant ? 'bg-primary' : 'bg-foreground/30',
                  )}
                  style={{ width: `${Math.round(factor.contribution * 100)}%` }}
                />
              </div>
            ) : null}

            <p className="mt-1.5 text-xs text-muted-foreground">{factor.detail}</p>
            <p className="text-[11px] text-subtle-foreground">{meaning}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
