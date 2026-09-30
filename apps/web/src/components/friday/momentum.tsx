/**
 * Momentum — continuity made visible without gamification.
 *
 * Big numbers answer a question (TODAY / 48 min). The sparkline renders
 * ONLY recorded progress snapshots; with fewer than two points it says so
 * honestly instead of drawing a line from nothing.
 */

export function MomentumMetric({
  eyebrow,
  value,
  unit,
  caption,
}: {
  eyebrow: string;
  value: string;
  unit?: string;
  caption?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {eyebrow}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium text-muted-foreground">{unit}</span>
        )}
      </p>
      {caption && <p className="mt-1 text-xs text-subtle-foreground">{caption}</p>}
    </div>
  );
}

export interface MomentumPoint {
  date: string;
  weightedProgress: number;
}

export function MomentumSparkline({ points }: { points: MomentumPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-xs leading-relaxed text-subtle-foreground">
        Your momentum line appears after a few days of study.
      </p>
    );
  }
  const W = 220;
  const H = 56;
  const PAD = 4;
  const values = points.map((p) => p.weightedProgress);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p.weightedProgress - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = Math.round((last.weightedProgress - first.weightedProgress) * 100);
  return (
    <figure>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Mastery moved ${delta >= 0 ? 'up' : 'down'} by ${Math.abs(delta)} points over the last ${points.length} recorded days`}
        className="overflow-visible"
      >
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="var(--color-success)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={coords[coords.length - 1]!.split(',')[0]}
          cy={coords[coords.length - 1]!.split(',')[1]}
          r="3.5"
          fill="var(--color-success)"
        />
      </svg>
      <figcaption className="mt-1 text-xs text-subtle-foreground">
        Mastery over the last {points.length} recorded days
      </figcaption>
    </figure>
  );
}
