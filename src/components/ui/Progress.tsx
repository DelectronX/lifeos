import { cn } from '@/lib/cn';
import { TRACKER_PALETTE } from '@/config/trackers';
import type { TrackerColor } from '@/types';

export function ProgressBar({
  value, color = 'indigo', size = 'md', className, showLabel, label,
}: {
  /** 0..1 */
  value: number;
  color?: TrackerColor;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  showLabel?: boolean;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const p = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.indigo;
  const h = size === 'xs' ? 'h-1' : size === 'sm' ? 'h-1.5' : 'h-2';
  return (
    <div className={className}>
      {(showLabel || label) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="t-meta truncate">{label}</span>
          <span className="t-num text-2xs font-medium text-ink-muted">{Math.round(pct)}%</span>
        </div>
      )}
      <div className={cn('w-full overflow-hidden rounded-full bg-line/70', h)}>
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-calm', p.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Ring({
  value, size = 64, stroke = 6, children, className, color = 'accent',
}: {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  className?: string;
  color?: 'accent' | 'positive' | 'caution';
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const strokeColor =
    color === 'positive' ? 'rgb(var(--c-positive))'
    : color === 'caution' ? 'rgb(var(--c-caution))'
    : 'rgb(var(--c-accent))';
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Stat({
  label, value, sub, className, tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  tone?: 'default' | 'positive' | 'critical';
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="t-label">{label}</div>
      <div
        className={cn(
          't-num mt-1 text-xl font-semibold tracking-[-0.02em]',
          tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink',
        )}
      >
        {value}
      </div>
      {sub ? <div className="t-meta mt-0.5 truncate">{sub}</div> : null}
    </div>
  );
}
