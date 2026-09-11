import { cn } from '@/lib/cn';

/**
 * Separator — a hairline divider.
 *
 * @example
 * <Separator />
 * <Separator orientation="vertical" className="h-5" />
 * <Separator label="Later today" />
 */
export function Separator({
  orientation = 'horizontal', className, label, inset,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  /** Renders centred text with a rule on each side. Horizontal only. */
  label?: string;
  /** Insets the rule by the standard panel padding. */
  inset?: boolean;
}) {
  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('w-px shrink-0 self-stretch bg-line', className)}
      />
    );
  }

  if (label) {
    return (
      <div role="separator" className={cn('flex items-center gap-3', className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="t-label shrink-0">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn('h-px w-full bg-line', inset && 'mx-4 w-auto', className)}
    />
  );
}
