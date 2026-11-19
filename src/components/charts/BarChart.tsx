import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

export interface BarSeries {
  key: string;
  label: string;
  /** CSS colour (e.g. 'rgb(var(--c-accent))'). */
  color: string;
}

export interface BarDatum {
  label: string;
  /** Value per series key. */
  values: Record<string, number>;
}

/**
 * BarChart — grouped vertical bars with a quiet value axis.
 * - nice round ticks, hairline grid, tabular axis labels
 * - bars grow in on mount (transform only), respect Reduce Motion via CSS
 * - hover / keyboard focus shows one inline readout (no floating tooltip)
 * Pure SVG + DOM, no chart library.
 */
export function BarChart({
  data, series, format = (n) => n.toLocaleString(), height = 200, className, ariaLabel,
}: {
  data: BarDatum[];
  series: BarSeries[];
  format?: (n: number) => string;
  height?: number;
  className?: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(t); }, []);

  const { max, ticks } = useMemo(() => {
    const raw = Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
    const step = niceStep(raw / 3);
    const top = Math.ceil(raw / step) * step;
    return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
  }, [data, series]);

  const focus = active ?? data.length - 1;
  const current = data[focus];

  return (
    <figure className={cn('w-full', className)} aria-label={ariaLabel}>
      {/* Readout */}
      <figcaption className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 px-1">
        <span className="text-[0.75rem] font-medium text-ink-faint">{current?.label}</span>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-baseline gap-1.5">
            <span className="h-2 w-2 translate-y-[-1px] rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="text-[0.75rem] text-ink-muted">{s.label}</span>
            <span className="t-num text-[0.9375rem] font-semibold text-ink">{format(current?.values[s.key] ?? 0)}</span>
          </span>
        ))}
      </figcaption>

      <div className="relative flex" style={{ height }}>
        {/* Axis */}
        <div className="relative w-12 shrink-0">
          {ticks.map((t) => (
            <span key={t} className="t-num absolute right-2 -translate-y-1/2 text-[0.625rem] text-ink-faint" style={{ bottom: `${(t / max) * 100}%`, transform: 'translateY(50%)' }}>
              {compact(t)}
            </span>
          ))}
        </div>
        {/* Plot */}
        <div className="relative min-w-0 flex-1">
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-line' : 'border-line-faint')} style={{ bottom: `${(t / max) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2%]" role="list">
            {data.map((d, i) => (
              <button
                key={d.label + i}
                type="button"
                role="listitem"
                aria-label={`${d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(', ')}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cn('group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[3px] rounded-[6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  focus === i && 'bg-ink/[0.04]')}
              >
                {series.map((s, si) => (
                  <span
                    key={s.key}
                    className="block w-full max-w-[14px] origin-bottom rounded-t-[4px] transition-transform duration-700 ease-calm motion-reduce:transition-none"
                    style={{
                      height: `${((d.values[s.key] ?? 0) / max) * 100}%`,
                      backgroundColor: s.color,
                      opacity: active === null || active === i ? 1 : 0.45,
                      transform: grown ? 'scaleY(1)' : 'scaleY(0)',
                      transitionDelay: `${i * 25 + si * 40}ms`,
                    }}
                  />
                ))}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-12 mt-1.5 flex gap-[2%]" aria-hidden>
        {data.map((d, i) => (
          <span key={d.label + i} className={cn('min-w-0 flex-1 truncate text-center text-[0.625rem]', focus === i ? 'font-semibold text-ink' : 'text-ink-faint')}>{d.label}</span>
        ))}
      </div>
    </figure>
  );
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, x))));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k`;
  return String(n);
}
