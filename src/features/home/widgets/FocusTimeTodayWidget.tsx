import { WidgetShell } from './WidgetShell';
import { useTodayActivities } from '@/state/useLiveData';
import { formatDuration } from '@/lib/date';
import { Stat } from '@/components/ui/Progress';
import type { WidgetComponentProps } from './types';

/** Minutes actually tracked today, from the Activity log — never from the plan. */
export function FocusTimeTodayWidget(_props: WidgetComponentProps) {
  const activities = useTodayActivities();
  const minutes = activities
    .filter((a) => a.durationMs > 0)
    .reduce((s, a) => s + a.durationMs / 60_000, 0);

  return (
    <WidgetShell title="Focus Time Today">
      <Stat
        label="Tracked"
        value={minutes > 0 ? formatDuration(minutes) : '0m'}
        sub={minutes === 0 ? 'No focus time logged yet today.' : undefined}
      />
    </WidgetShell>
  );
}
