import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TRACKER_PALETTE } from '@/config/trackers';
import type { TrackerColor } from '@/types';

/**
 * Badge — a compact status chip.
 *
 * Tones are desaturated fills at ~10% alpha with a matching hairline, so a row
 * of badges never shouts. `accent` is reserved for "this is the current thing".
 *
 * @example
 * <Badge tone="positive" dot>On track</Badge>
 * <Badge tone="critical">Overdue</Badge>
 * <Badge tone="outline" size="sm">Draft</Badge>
 */

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'outline' | 'solid';
export type BadgeSize = 'sm' | 'md';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-overlay text-ink-muted',
  accent: 'border-accent/25 bg-accent/12 text-accent-ink',
  positive: 'border-positive/25 bg-positive/12 text-positive',
  caution: 'border-caution/25 bg-caution/12 text-caution',
  critical: 'border-critical/25 bg-critical/12 text-critical',
  outline: 'border-line-strong bg-transparent text-ink-muted',
  solid: 'border-transparent bg-accent text-accent-contrast',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'h-[1.125rem] px-1.5 text-[0.625rem]',
  md: 'h-5 px-2 text-2xs',
};

export function Badge({
  tone = 'neutral', size = 'md', children, className, dot,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
  /** Prepends a small status dot in the current text colour. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium leading-none',
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}

/**
 * Count pill — a tabular-numeral counter for tabs and nav rows.
 *
 * @example <CountBadge value={12} />
 */
export function CountBadge({
  value, tone = 'neutral', className,
}: {
  value: number;
  tone?: 'neutral' | 'accent';
  className?: string;
}) {
  return (
    <span
      className={cn(
        't-num inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold leading-none',
        tone === 'accent' ? 'bg-accent/15 text-accent-ink' : 'bg-surface-overlay text-ink-faint',
        className,
      )}
    >
      {value}
    </span>
  );
}

/** A tracker-coloured chip, using the shared tracker palette. */
export function TrackerBadge({
  color, name, className,
}: {
  color: TrackerColor;
  name: string;
  className?: string;
}) {
  const p = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.slate;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4',
        p.chip,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />
      {name}
    </span>
  );
}

/** A bare tracker-colour dot, for dense lists where a chip is too heavy. */
export function Dot({ color, className }: { color: TrackerColor; className?: string }) {
  const p = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.slate;
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', p.dot, className)} />;
}
