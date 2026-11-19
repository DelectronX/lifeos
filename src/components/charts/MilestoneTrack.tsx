import { cn } from '@/lib/cn';

export interface TrackMarker {
  id: string;
  label: string;
  done: boolean;
}

/**
 * MilestoneTrack — long-term progress at a glance. A hairline track, a
 * filled run for real progress, and one marker per milestone spaced evenly
 * along it (done = solid, next = ringed, later = hollow). Tooltips via
 * title; full list for screen readers.
 */
export function MilestoneTrack({
  progress, markers, color, label, className,
}: {
  /** 0..1 */
  progress: number;
  markers: TrackMarker[];
  color: string;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const nextIndex = markers.findIndex((m) => !m.done);
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-num text-[1.375rem] font-semibold leading-none tracking-[-0.02em] text-ink">
          {Math.round(pct)}<span className="text-[0.8125rem] font-medium text-ink-faint">%</span>
        </span>
        {label ? <span className="t-num truncate text-[0.75rem] text-ink-muted">{label}</span> : null}
      </div>
      <div
        className="relative mt-3 h-[14px]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${Math.round(pct)}%${markers.length ? `, ${markers.filter((m) => m.done).length} of ${markers.length} milestones` : ''}`}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-ink/10" />
        <div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-700 ease-calm motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 12px ${color}55` }}
        />
        {markers.map((m, i) => {
          const at = ((i + 1) / (markers.length + 1)) * 100;
          const next = i === nextIndex;
          return (
            <span
              key={m.id}
              title={`${m.label}${m.done ? ' — done' : next ? ' — next' : ''}`}
              className={cn(
                'absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] transition-colors',
                m.done ? '' : next ? 'bg-surface-raised ring-2' : 'bg-surface-raised ring-1 ring-ink/25',
              )}
              style={{ left: `${at}%`, ...(m.done ? { backgroundColor: color } : next ? { ['--tw-ring-color' as string]: color } : {}) }}
            />
          );
        })}
      </div>
      {markers.length ? (
        <ul className="sr-only">
          {markers.map((m) => <li key={m.id}>{m.label}: {m.done ? 'done' : 'open'}</li>)}
        </ul>
      ) : null}
      {nextIndex >= 0 ? (
        <div className="mt-2 truncate text-[0.75rem] text-ink-muted">
          <span className="text-ink-faint">Next · </span>{markers[nextIndex].label}
        </div>
      ) : markers.length ? (
        <div className="mt-2 text-[0.75rem] font-medium" style={{ color }}>All milestones reached</div>
      ) : null}
    </div>
  );
}
