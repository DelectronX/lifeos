import { cn } from '@/lib/cn';

export interface Segment {
  id: string;
  label: string;
  /** 0..1 fill of this segment. */
  value: number;
}

/**
 * SegmentedProgress — multi-stage work. One segment per stage (e.g. per
 * milestone), each filled by its own completion, so you can see *where*
 * the work is, not just how much.
 */
export function SegmentedProgress({ segments, color, className }: { segments: Segment[]; color: string; className?: string }) {
  if (!segments.length) return null;
  return (
    <div className={cn('flex w-full gap-[3px]', className)} role="list" aria-label="Stages">
      {segments.map((s) => {
        const v = Math.max(0, Math.min(1, s.value));
        return (
          <div key={s.id} role="listitem" title={`${s.label} — ${Math.round(v * 100)}%`} aria-label={`${s.label}, ${Math.round(v * 100)}%`}
            className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/10">
            <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-calm motion-reduce:transition-none"
              style={{ width: `${v * 100}%`, backgroundColor: color, opacity: v >= 1 ? 1 : 0.75 }} />
          </div>
        );
      })}
    </div>
  );
}

const LIFECYCLE = ['idea', 'planning', 'active', 'testing', 'shipped'] as const;

/** Five-step lifecycle stepper for a project status. Paused/archived render muted. */
export function LifecycleStepper({ status, className }: { status: string; className?: string }) {
  const at = LIFECYCLE.indexOf(status as (typeof LIFECYCLE)[number]);
  const muted = at < 0;
  return (
    <div className={cn('flex items-center gap-1', className)} aria-label={`Stage: ${status}`}>
      {LIFECYCLE.map((step, i) => (
        <span key={step} className="flex items-center gap-1">
          <span
            title={step}
            className={cn('h-1.5 w-1.5 rounded-full transition-colors',
              muted ? 'bg-ink/15' : i < at ? 'bg-ink/45' : i === at ? 'bg-accent ring-[3px] ring-accent/25' : 'bg-ink/15')}
          />
          {i < LIFECYCLE.length - 1 ? <span className={cn('h-px w-2.5', !muted && i < at ? 'bg-ink/35' : 'bg-ink/10')} /> : null}
        </span>
      ))}
    </div>
  );
}
