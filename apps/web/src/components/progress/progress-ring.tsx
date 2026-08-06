import { cn } from '@friday/ui';

/**
 * Weighted-progress ring.
 *
 * Renders exam-weight-weighted mastery, not tasks completed — the two diverge,
 * and the second one flatters (DATABASE_DESIGN §4.7). Pure SVG so it costs no
 * client JS and needs no chart library on a page that is otherwise static.
 */
export function ProgressRing({
  value,
  label,
  size = 160,
  className,
}: {
  /** In [0,1]. */
  value: number;
  label?: string;
  size?: number;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * clamped;
  const percent = Math.round(clamped * 100);

  return (
    <div
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${percent}% ${label ?? 'complete'}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="text-primary transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <span className="text-3xl font-semibold tabular-nums">{percent}%</span>
          {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
        </div>
      </div>
    </div>
  );
}
