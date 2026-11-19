import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * EmptyState — the calm "nothing here yet" surface.
 *
 * Dashed hairline, generous vertical space, one optional action. Never use a
 * full panel treatment for an empty state; it should read as absence.
 *
 * @example
 * <EmptyState
 *   icon={<Inbox className="h-6 w-6" />}
 *   title="No tasks yet"
 *   description="Capture something and it will land in your inbox."
 *   action={<Button variant="primary" size="sm">Add task</Button>}
 * />
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** `sm` for inline empties inside a panel; `md` (default) for page-level. */
  size?: 'sm' | 'md';
}

export function EmptyState({
  icon, title, description, action, className, size = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-panel bg-surface-raised/50 text-center',
        size === 'sm' ? 'px-4 py-7' : 'px-6 py-16',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-muted [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      ) : null}
      <div className="t-title">{title}</div>
      {description ? <p className="t-muted mt-1.5 max-w-sm text-balance">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
