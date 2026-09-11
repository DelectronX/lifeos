import { cn } from '@/lib/cn';

/**
 * Skeleton — a quiet loading placeholder.
 *
 * A slow luminance shimmer, not a pulsing grey block. Match the skeleton's
 * shape to the content it replaces so nothing jumps on load.
 *
 * @example
 * <Skeleton className="h-4 w-32" />
 * <SkeletonText lines={3} />
 * <SkeletonPanel />
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-[var(--r-sm)] bg-surface-raised',
        'bg-[linear-gradient(90deg,transparent,rgb(var(--c-line-strong)/0.55),transparent)]',
        'bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

/** A stack of text-height bars; the last line is short, like real prose. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/5' : 'w-full')} />
      ))}
    </div>
  );
}

/** A panel-shaped placeholder: title bar plus body lines. */
export function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-panel border border-line bg-surface-raised p-4', className)} role="status" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <div className="mt-4 space-y-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/** N skeleton rows, sized for a list. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-card" />
      ))}
    </div>
  );
}
