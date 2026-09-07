import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TRACKER_PALETTE } from '@/config/trackers';
import type { TrackerColor } from '@/types';

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border-line',
  accent: 'bg-accent-soft text-accent-ink border-accent/20',
  positive: 'bg-positive/10 text-positive border-positive/20',
  caution: 'bg-caution/10 text-caution border-caution/25',
  critical: 'bg-critical/10 text-critical border-critical/25',
  outline: 'bg-transparent text-ink-muted border-line-strong',
};

export function Badge({
  tone = 'neutral', children, className, dot,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

export function TrackerBadge({
  color, name, className,
}: {
  color: TrackerColor;
  name: string;
  className?: string;
}) {
  const p = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.slate;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4', p.chip, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} />
      {name}
    </span>
  );
}

export function Dot({ color, className }: { color: TrackerColor; className?: string }) {
  const p = TRACKER_PALETTE[color] ?? TRACKER_PALETTE.slate;
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', p.dot, className)} />;
}
