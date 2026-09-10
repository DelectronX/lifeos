import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Progress';
import { formatDuration, formatDateKeyShort } from '@/lib/date';
import type { DayPoint, NamedMinutes, TrendComparison } from '@/engines/analytics';

/**
 * Presentation primitives shared by the Daily and Weekly review screens.
 *
 * Every component here is deliberately dumb: it renders numbers that were
 * computed by the AnalyticsEngine and hands the caller a slot for the
 * supporting evidence sentence. Nothing in this file derives a conclusion.
 */

/** A headline number with the measurement it came from printed underneath. */
export function MetricTile({
  label, value, evidence, tone, className,
}: {
  label: string;
  value: ReactNode;
  /** The stored measurement behind `value`, so the user can verify it. */
  evidence?: ReactNode;
  tone?: 'default' | 'positive' | 'critical';
  className?: string;
}) {
  return (
    <Card padded={false} className={cn('px-4 py-3', className)}>
      <div className="t-label">{label}</div>
      <div
        className={cn(
          't-num mt-1 text-xl font-semibold tracking-[-0.02em]',
          tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink',
        )}
      >
        {value}
      </div>
      {evidence ? <div className="t-meta mt-1 leading-snug">{evidence}</div> : null}
    </Card>
  );
}

/**
 * Renders a TrendComparison exactly as the engine produced it — current,
 * previous and the delta between them. `higherIsBetter` only chooses a colour;
 * it never changes a number.
 */
export function TrendPill({
  trend, unit = '', previousUnit, higherIsBetter = true, decimals = 0,
}: {
  trend: TrendComparison;
  /** Unit for the delta, e.g. 'pp' for a percentage-point change. */
  unit?: string;
  /** Unit for the previous absolute value; defaults to `unit`. */
  previousUnit?: string;
  higherIsBetter?: boolean;
  decimals?: number;
}) {
  const good = trend.direction === 'flat'
    ? null
    : (trend.direction === 'up') === higherIsBetter;
  const Icon = trend.direction === 'up' ? ArrowUpRight : trend.direction === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        't-num inline-flex items-center gap-1 text-2xs',
        good === null ? 'text-ink-muted' : good ? 'text-positive' : 'text-critical',
      )}
    >
      <Icon className="h-3 w-3" />
      {trend.delta >= 0 ? '+' : '−'}{Math.abs(trend.delta).toFixed(decimals)}{unit}
      <span className="text-ink-faint">
        vs {trend.previous.toFixed(decimals)}{previousUnit ?? unit} before
      </span>
    </span>
  );
}

/** Plain "there is nothing here" panel. Never renders zeros as findings. */
export function NoDataNotice({
  title, description, action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="text-center">
      <div className="t-section">{title}</div>
      <p className="t-muted mx-auto mt-1 max-w-md">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </Card>
  );
}

/** Previous / next stepper used for day and week navigation. */
export function PeriodNav({
  label, sub, onPrev, onNext, onToday, nextDisabled, todayLabel = 'Today',
}: {
  label: string;
  sub?: string;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
  nextDisabled?: boolean;
  todayLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IconButton label="Previous" onClick={onPrev}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <div className="min-w-0 text-center">
        <div className="t-num text-sm font-medium text-ink">{label}</div>
        {sub ? <div className="t-meta">{sub}</div> : null}
      </div>
      <IconButton label="Next" onClick={onNext} disabled={nextDisabled}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      {onToday ? (
        <button
          type="button"
          onClick={onToday}
          className="t-meta rounded-md border border-line px-2 py-1 hover:text-ink"
        >
          {todayLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Horizontal bars for time-by-tracker, straight off `TimeDistribution`. */
export function MinutesBars({ rows, emptyLabel }: { rows: readonly NamedMinutes[]; emptyLabel: string }) {
  const withTime = rows.filter((r) => r.minutes > 0);
  if (withTime.length === 0) return <p className="t-muted">{emptyLabel}</p>;
  const max = Math.max(...withTime.map((r) => r.minutes), 1);
  return (
    <div className="space-y-3">
      {withTime.map((row) => (
        <div key={row.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-ink">{row.label}</span>
            <span className="t-num text-2xs text-ink-muted">
              {formatDuration(row.minutes)} · {Math.round(row.share * 100)}%
            </span>
          </div>
          <ProgressBar value={row.minutes / max} color={row.color ?? 'indigo'} size="sm" />
        </div>
      ))}
    </div>
  );
}

/** Per-day tracked minutes for a week. Inactive days are shown as inactive. */
export function DaySeries({ days }: { days: readonly DayPoint[] }) {
  const max = Math.max(...days.map((d) => d.minutes), 1);
  return (
    <div className="flex items-end gap-1.5 sm:gap-2">
      {days.map((d) => (
        <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="t-num text-2xs text-ink-faint">{d.active ? Math.round(d.minutes) : '—'}</span>
          <div className="flex h-20 w-full items-end rounded-sm bg-surface-sunken">
            <div
              className={cn('w-full rounded-sm', d.active ? 'bg-accent' : 'bg-line')}
              style={{ height: `${d.active ? Math.max(4, (d.minutes / max) * 100) : 2}%` }}
            />
          </div>
          <span className="t-meta truncate text-2xs">{formatDateKeyShort(d.date).split(',')[0]}</span>
        </div>
      ))}
    </div>
  );
}

/** A conclusion plus the numbers it was derived from, always side by side. */
export function VerdictCard({
  heading, label, evidence, tone,
}: {
  heading: string;
  label: string;
  evidence: string;
  tone: 'positive' | 'caution';
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-label">{heading}</span>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="t-meta mt-2 leading-relaxed">{evidence}</p>
    </Card>
  );
}
