import type { ReactNode } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, EmptyState } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Progress';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { formatDuration } from '@/lib/date';
import { RANGE_PRESETS, type RangeController, type RangePreset } from '../range';

/**
 * Shared building blocks for the analytics sections.
 *
 * They format and lay out numbers the engine already produced; none of them
 * computes anything beyond turning minutes into a label.
 */

export function RangeSelector({ range, className }: { range: RangeController; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Tabs<RangePreset>
        variant="pill"
        size="sm"
        items={RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        value={range.preset}
        onChange={range.setPreset}
      />
      {range.preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-ink-faint" />
          <Input
            type="date"
            aria-label="Range start"
            className="h-8 w-[9.5rem] text-xs"
            value={range.customFrom}
            onChange={(e) => e.target.value && range.setCustom(e.target.value, range.customTo)}
          />
          <span className="t-meta">to</span>
          <Input
            type="date"
            aria-label="Range end"
            className="h-8 w-[9.5rem] text-xs"
            value={range.customTo}
            onChange={(e) => e.target.value && range.setCustom(range.customFrom, e.target.value)}
          />
        </div>
      ) : (
        <span className="t-meta t-num">
          {range.from} → {range.to} · {range.days} day{range.days === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

/** A row of headline numbers. Always 2 columns on mobile, never squeezed. */
export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
      {children}
    </div>
  );
}

export function StatCard({
  label, value, sub, tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'positive' | 'critical';
}) {
  return (
    <Card padded={false} className="px-4 py-3">
      <Stat label={label} value={value} sub={sub} tone={tone} />
    </Card>
  );
}

/**
 * The empty state used everywhere in analytics: it says plainly that there is
 * no data and names the action that would produce some. It never substitutes a
 * zeroed chart for missing records.
 */
export function NoData({
  title, action, icon, className,
}: {
  title: string;
  /** What the user must actually do for this metric to exist. */
  action: string;
  icon?: ReactNode;
  className?: string;
}) {
  return <EmptyState icon={icon} title={title} description={action} className={className} />;
}

/** A section wrapper that answers one question and nothing else. */
export function AnalyticsSection({
  title, question, action, children, className,
}: {
  title: ReactNode;
  question?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-title">{title}</h2>
          {question ? <p className="t-muted mt-0.5">{question}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A plain sentence the engine produced, presented as an observation. */
export function InsightNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted', className)}>
      {children}
    </p>
  );
}

export function mins(minutes: number): string {
  return formatDuration(minutes);
}

export function pct(fraction: number): string {
  return `${Math.round((Number.isFinite(fraction) ? fraction : 0) * 100)}%`;
}
