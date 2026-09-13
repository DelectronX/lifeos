import { Link } from 'react-router-dom';
import { WidgetShell, WidgetEmpty } from './WidgetShell';
import { useBlocksForDay, useTrackerMap } from '@/state/useLiveData';
import { todayKey, formatTimeRange } from '@/lib/date';
import { Badge, Dot } from '@/components/ui/Badge';
import type { WidgetComponentProps } from './types';

/** Today's schedule blocks, in time order; cancelled blocks are hidden. */
export function TodayScheduleWidget(_props: WidgetComponentProps) {
  const today = todayKey();
  const blocks = useBlocksForDay(today).filter((b) => b.status !== 'cancelled');
  const trackerMap = useTrackerMap();
  const sorted = blocks.slice().sort((a, b) => a.start - b.start);

  return (
    <WidgetShell title="Today's Schedule">
      {sorted.length === 0 ? (
        <WidgetEmpty text="Nothing scheduled today." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {sorted.slice(0, 6).map((b) => {
            const tracker = trackerMap[b.trackerId];
            return (
              <li key={b.id}>
                <Link
                  to="/schedule"
                  className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-surface-sunken"
                >
                  <span className="t-num w-20 shrink-0 text-xs text-ink-muted">
                    {formatTimeRange(b.start, b.end)}
                  </span>
                  {tracker ? <Dot color={tracker.color} /> : null}
                  <span className="min-w-0 flex-1 truncate">{b.title}</span>
                  {b.status === 'completed' ? <Badge tone="positive">Done</Badge> : null}
                  {b.status === 'skipped' ? <Badge tone="caution">Skipped</Badge> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}
