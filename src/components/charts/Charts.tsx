import { useId } from 'react';
import { cn } from '@/lib/cn';
import { TRACKER_PALETTE } from '@/config/trackers';
import type { TrackerColor } from '@/types';

/**
 * Small, restrained SVG charts.
 *
 * Deliberately hand-rolled rather than a charting library: these are meant to
 * read as quiet diagrams inside cards, not dashboards. No animation loops, no
 * tooltips-on-everything, no gradients — just the shape of the data with the
 * numbers written next to it.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** Optional second value drawn as a faint "planned"/reference bar behind. */
  reference?: number;
  color?: TrackerColor;
  /** Pre-formatted value shown on hover / in the legend. */
  formatted?: string;
}

export function BarChart({
  data, height = 120, formatValue, className, emptyLabel = 'No data in this period.', labelEvery = 1,
}: {
  data: BarDatum[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
  emptyLabel?: string;
  /** Draw only every Nth axis label — keeps dense series (24 hours, 30 days) readable. */
  labelEvery?: number;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.reference ?? 0)));
  if (data.length === 0) return <ChartEmpty label={emptyLabel} height={height} />;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const refPct = d.reference !== undefined ? (d.reference / max) * 100 : null;
          const palette = TRACKER_PALETTE[d.color ?? 'indigo'] ?? TRACKER_PALETTE.indigo;
          return (
            <div key={`${d.label}-${i}`} className="group relative flex min-w-0 flex-1 flex-col justify-end">
              {refPct !== null ? (
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-sm border border-dashed border-line-strong"
                  style={{ height: `${Math.max(refPct, 1)}%` }}
                  aria-hidden
                />
              ) : null}
              <div
                className={cn('relative rounded-t-sm transition-[height] duration-500 ease-calm', palette.bar)}
                style={{ height: `${Math.max(pct, d.value > 0 ? 2 : 0)}%` }}
              />
              <span className="pointer-events-none absolute -top-6 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface-raised px-1.5 py-0.5 text-2xs text-ink shadow-card group-hover:block">
                {d.formatted ?? formatValue?.(d.value) ?? String(d.value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {data.map((d, i) => (
          <div key={`${d.label}-label-${i}`} className="t-meta min-w-0 flex-1 truncate text-center">
            {i % labelEvery === 0 ? d.label : '\u00a0'}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  data, height = 120, className, color = 'accent', formatValue, emptyLabel = 'No data in this period.',
}: {
  data: LinePoint[];
  height?: number;
  className?: string;
  color?: 'accent' | 'positive' | 'caution';
  formatValue?: (v: number) => string;
  emptyLabel?: string;
}) {
  const gradientId = useId();
  if (data.length < 2) return <ChartEmpty label={data.length ? 'Not enough days to plot a trend yet.' : emptyLabel} height={height} />;

  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100;
  const h = 100;
  const step = w / (data.length - 1);
  const points = data.map((d, i) => ({ x: i * step, y: h - (d.value / max) * h }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  const stroke =
    color === 'positive' ? 'rgb(var(--c-positive))'
    : color === 'caution' ? 'rgb(var(--c-caution))'
    : 'rgb(var(--c-accent))';

  return (
    <div className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }} className="w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="mt-1.5 flex justify-between">
        <span className="t-meta">{data[0].label}</span>
        <span className="t-meta">
          peak {formatValue ? formatValue(max) : max}
        </span>
        <span className="t-meta">{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color?: TrackerColor;
}

export function DonutChart({
  data, size = 132, thickness = 14, centerLabel, centerValue, className, emptyLabel = 'No time recorded.',
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
  emptyLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <ChartEmpty label={emptyLabel} height={size} />;

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-5', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth={thickness} />
          {data.map((d, i) => {
            const fraction = d.value / total;
            const dash = fraction * circumference;
            const el = (
              <circle
                key={`${d.label}-${i}`}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={(TRACKER_PALETTE[d.color ?? 'indigo'] ?? TRACKER_PALETTE.indigo).hex}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue ? <div className="t-num text-lg font-semibold text-ink">{centerValue}</div> : null}
            {centerLabel ? <div className="t-label">{centerLabel}</div> : null}
          </div>
        )}
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={`${d.label}-legend-${i}`} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: (TRACKER_PALETTE[d.color ?? 'indigo'] ?? TRACKER_PALETTE.indigo).hex }}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.label}</span>
            <span className="t-num shrink-0 text-xs text-ink-muted">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A single horizontal comparison row — used far more than any real chart. */
export function MeterRow({
  label, value, max, valueLabel, color = 'indigo', sub,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  color?: TrackerColor;
  sub?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const palette = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.indigo;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-ink">{label}</span>
        <span className="t-num shrink-0 text-xs font-medium text-ink-muted">{valueLabel}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-calm', palette.bar)} style={{ width: `${pct}%` }} />
      </div>
      {sub ? <div className="t-meta mt-1">{sub}</div> : null}
    </div>
  );
}

/** Day-of-year activity grid, GitHub-style but muted. */
export function HeatStrip({
  data, className, formatValue,
}: {
  data: { date: string; value: number }[];
  className?: string;
  formatValue?: (v: number, date: string) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {data.map((d) => {
        const intensity = d.value <= 0 ? 0 : Math.max(0.18, d.value / max);
        return (
          <div
            key={d.date}
            title={formatValue ? formatValue(d.value, d.date) : `${d.date}: ${d.value}`}
            className="h-3 w-3 rounded-sm border border-line/60"
            style={{
              background: d.value > 0 ? `rgb(var(--c-accent) / ${intensity.toFixed(2)})` : 'rgb(var(--c-line) / 0.5)',
            }}
          />
        );
      })}
    </div>
  );
}

function ChartEmpty({ label, height }: { label: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-line px-3 text-center"
      style={{ height }}
    >
      <span className="t-meta">{label}</span>
    </div>
  );
}
