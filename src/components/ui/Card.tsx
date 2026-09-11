import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Re-exported so existing `import { Card, EmptyState } from '@/components/ui/Card'`
// call sites keep working. New code should import from './EmptyState'.
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

/**
 * Panel / Card — the fundamental container.
 *
 * A panel is a luminance step above its parent, bounded by a 1px hairline and
 * lifted by a very soft ambient shadow. Do NOT nest a Card inside a Card; use
 * `<Separator />` or `tone="flush"` for internal division.
 *
 * @example
 * <Panel><PanelHeader title="Today" action={<Button size="sm">Plan</Button>} />…</Panel>
 * <Card interactive onClick={open}>…</Card>
 */

export type PanelTone = 'raised' | 'flush' | 'sunken' | 'outline';

const TONES: Record<PanelTone, string> = {
  /** Default: steps up from the page, hairline + ambient shadow. */
  raised: 'border border-line bg-surface-raised shadow-panel',
  /** No shadow — for panels sitting directly on chrome. */
  flush: 'border border-line bg-surface-raised',
  /** A well: steps DOWN, for inset regions inside a panel. */
  sunken: 'border border-line-faint bg-surface-sunken',
  /** Hairline only, transparent fill. */
  outline: 'border border-line bg-transparent',
};

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Applies the standard 1rem inset. Set false to control padding yourself. */
  padded?: boolean;
  tone?: PanelTone;
  /** Adds a 1px hover lift and a pointer cursor. */
  interactive?: boolean;
}

export function Panel({
  padded = true, tone = 'raised', interactive, className, children, ...rest
}: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-panel',
        TONES[tone],
        padded && 'p-4',
        interactive && 'lift cursor-pointer hover:border-line-strong',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Card is Panel with a slightly tighter radius — the list/grid workhorse. */
export function Card({ className, ...rest }: PanelProps) {
  return <Panel className={cn('rounded-card', className)} {...rest} />;
}

export interface PanelHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A panel's internal header row: title + optional subtitle and trailing slot. */
export function PanelHeader({ title, subtitle, action, className }: PanelHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="t-section">{title}</div>
        {subtitle ? <div className="t-meta mt-0.5">{subtitle}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Alias kept for existing call sites. Identical to PanelHeader. */
export const CardHeader = PanelHeader;
export type CardProps = PanelProps;
export type CardHeaderProps = PanelHeaderProps;

/**
 * SectionHeading — a heading ABOVE a group of panels (not inside one).
 *
 * @example
 * <SectionHeading title="Focus" subtitle="Sessions this week" action={<Button…/>} />
 */
export function SectionHeading({ title, subtitle, action, className }: PanelHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="t-title">{title}</h2>
        {subtitle ? <p className="t-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * PanelSection — a hairline-divided region inside a panel. Use instead of
 * nesting cards.
 *
 * @example
 * <Panel padded={false}>
 *   <PanelSection>Header content</PanelSection>
 *   <PanelSection>Body content</PanelSection>
 * </Panel>
 */
export function PanelSection({
  children, className, ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-b border-line px-4 py-3 last:border-b-0', className)} {...rest}>
      {children}
    </div>
  );
}
