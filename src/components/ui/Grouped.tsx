import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Apple "inset grouped" list primitives (HIG › Lists and tables): a footnote
 * section header, rounded cell group with hairline separators inset to the
 * text column, 44pt+ rows, secondary values right-aligned and a chevron for
 * rows that navigate. Used by the Work & Growth modules.
 */

export function InsetGroup({
  header, footer, action, children, className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      {header || action ? (
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          {header ? <h2 className="t-section">{header}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className="surface-card overflow-hidden rounded-[var(--r-lg)] [&>*+*]:border-t [&>*+*]:border-line-faint">
        {children}
      </div>
      {footer ? <p className="mt-2 px-1 text-[0.8125rem] leading-snug text-ink-faint">{footer}</p> : null}
    </section>
  );
}

export function Row({
  leading, title, subtitle, trailing, onClick, chevron, className, selected, as = 'div',
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
  selected?: boolean;
  as?: 'div' | 'li';
}) {
  const Tag = as;
  const titleId = useId();
  const body = (
    <>
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="min-w-0 flex-1 py-2.5">
        <div id={titleId} className="truncate text-[0.9375rem] leading-snug text-ink">{title}</div>
        {subtitle ? <div className="mt-0.5 truncate text-[0.8125rem] leading-snug text-ink-muted">{subtitle}</div> : null}
      </div>
      {/* Trailing controls sit above the row's hit area, so they stay independently clickable. */}
      {trailing ? <div className="relative z-[1] flex shrink-0 items-center gap-2 text-[0.9375rem] text-ink-muted">{trailing}</div> : null}
      {chevron ? <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden /> : null}
    </>
  );
  const base = cn('relative flex min-h-[2.75rem] w-full items-center gap-3 px-4 text-left', selected && 'bg-accent/10', className);
  if (onClick) {
    // Stretched-button pattern: one full-row button (labelled by the title)
    // instead of wrapping the row in a <button> — avoids nested buttons when
    // the row also carries actions.
    return (
      <Tag className={cn(base, 'group transition-colors hover:bg-ink/[0.04] has-[>button:active]:bg-ink/[0.06]')}>
        <button type="button" onClick={onClick} aria-labelledby={titleId}
          className="absolute inset-0 z-0 rounded-[inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60" />
        {body}
      </Tag>
    );
  }
  return <Tag className={base}>{body}</Tag>;
}

/** A metric tile: Title-2 value with a footnote caption (dashboard headers). */
export function MetricTile({
  label, value, caption, tone = 'default', className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: 'default' | 'positive' | 'caution' | 'critical' | 'accent';
  className?: string;
}) {
  const color = {
    default: 'text-ink', positive: 'text-positive', caution: 'text-caution', critical: 'text-critical', accent: 'text-accent-ink',
  }[tone];
  return (
    <div className={cn('surface-card min-w-0 rounded-[var(--r-lg)] px-4 py-3.5', className)}>
      <div className="text-[0.8125rem] font-medium text-ink-muted">{label}</div>
      <div className={cn('t-rounded mt-1.5 truncate text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] tabular', color)}>{value}</div>
      {caption ? <div className="mt-0.5 truncate text-[0.75rem] text-ink-faint">{caption}</div> : null}
    </div>
  );
}

const HEALTH = {
  on_track: { label: 'On track', cls: 'bg-positive/15 text-positive' },
  at_risk: { label: 'At risk', cls: 'bg-caution/15 text-caution' },
  off_track: { label: 'Off track', cls: 'bg-critical/15 text-critical' },
  done: { label: 'Done', cls: 'bg-accent-soft text-accent-ink' },
  idle: { label: 'Not started', cls: 'bg-surface-sunken text-ink-muted' },
} as const;

export function HealthChip({ health }: { health: keyof typeof HEALTH }) {
  const h = HEALTH[health];
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[0.75rem] font-medium', h.cls)}>{h.label}</span>;
}

/** Round check control (Reminders-style). 44pt hit area around a 22pt circle. */
export function CheckCircle({
  checked, onToggle, label, tint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  tint?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="-m-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-full"
    >
      <span
        className={cn(
          'grid h-[1.375rem] w-[1.375rem] place-items-center rounded-full border-[1.5px] transition-colors',
          checked ? 'border-transparent bg-accent text-accent-contrast' : 'border-line-strong',
        )}
        style={checked && tint ? { backgroundColor: tint } : undefined}
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
            <path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

/** Thin progress line used inside rows. */
export function Meter({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'positive' | 'caution' }) {
  const bg = { accent: 'bg-accent', positive: 'bg-positive', caution: 'bg-caution' }[tone];
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-surface-sunken', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', bg)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function money(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}
