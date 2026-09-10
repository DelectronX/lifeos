import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TRACKER_PALETTE } from '@/config/trackers';
import type { TrackerColor } from '@/types';
import type { TrendComparison } from '@/engines/analytics';

/**
 * Comparison primitives: a single stacked share bar, a planned-vs-actual row,
 * and the small trend pill. Everything here is presentational — every number
 * arrives pre-computed from the analytics engine.
 */

export interface ShareSegment {
  id: string;
  label: string;
  value: number;
  color?: TrackerColor;
}

export function StackedShareBar({
  segments, className, formatValue,
}: {
  segments: ShareSegment[];
  className?: string;
  formatValue?: (v: number) => string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-line px-3 py-4 text-center', className)}>
        <span className="t-meta">No time recorded in this period.</span>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line/70">
        {segments.map((s) => (
          <div
            key={s.id}
            title={`${s.label}: ${formatValue ? formatValue(s.value) : s.value}`}
            className={cn('h-full', (TRACKER_PALETTE[s.color ?? 'indigo'] ?? TRACKER_PALETTE.indigo).bar)}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={`${s.id}-legend`} className="flex items-baseline gap-2">
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', (TRACKER_PALETTE[s.color ?? 'indigo'] ?? TRACKER_PALETTE.indigo).dot)} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.label}</span>
            <span className="t-num shrink-0 text-xs text-ink-muted">
              {formatValue ? formatValue(s.value) : s.value}
            </span>
            <span className="t-num w-10 shrink-0 text-right text-2xs text-ink-faint">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One tracker's planned time against the time actually recorded. Both bars are
 * scaled to the same maximum so the comparison is honest across rows.
 */
export function PlanActualRow({
  label, planned, actual, max, color = 'indigo', formatValue,
}: {
  label: string;
  planned: number;
  actual: number;
  max: number;
  color?: TrackerColor;
  formatValue: (v: number) => string;
}) {
  const palette = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.indigo;
  const scale = (v: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0);
  const delta = actual - planned;

  return (
    <div className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-ink">{label}</span>
        <span className="t-num shrink-0 text-xs text-ink-muted">
          {formatValue(actual)} <span className="text-ink-faint">/ {formatValue(planned)}</span>
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-2">
          <span className="t-label w-12 shrink-0">planned</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
            <div className="h-full rounded-full border border-dashed border-line-strong bg-transparent" style={{ width: `${scale(planned)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="t-label w-12 shrink-0">actual</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
            <div className={cn('h-full rounded-full', palette.bar)} style={{ width: `${scale(actual)}%` }} />
          </div>
        </div>
      </div>
      {planned > 0 ? (
        <div className="t-meta mt-1">
          {delta === 0
            ? 'Exactly on plan.'
            : delta > 0
              ? `${formatValue(delta)} more than planned.`
              : `${formatValue(-delta)} less than planned.`}
        </div>
      ) : (
        <div className="t-meta mt-1">Nothing was scheduled for this tracker.</div>
      )}
    </div>
  );
}

export function TrendPill({
  trend, unit = '', invert = false, className,
}: {
  trend: TrendComparison;
  unit?: string;
  /** When true, "down" is the good direction (e.g. mistakes). */
  invert?: boolean;
  className?: string;
}) {
  const good = trend.direction === 'flat' ? null : invert ? trend.direction === 'down' : trend.direction === 'up';
  const Icon = trend.direction === 'up' ? ArrowUpRight : trend.direction === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
        good === null ? 'border-line bg-surface-sunken text-ink-muted'
          : good ? 'border-positive/20 bg-positive/10 text-positive'
            : 'border-caution/25 bg-caution/10 text-caution',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="t-num">
        {trend.delta > 0 ? '+' : ''}{trend.delta}{unit}
      </span>
      {trend.percentChange !== null ? (
        <span className="t-num opacity-70">({trend.percentChange > 0 ? '+' : ''}{trend.percentChange}%)</span>
      ) : null}
    </span>
  );
}
