import { WidgetShell } from './WidgetShell';
import { useAnalytics, resolveRange } from '@/services/analyticsService';
import { formatDuration } from '@/lib/date';
import { Stat } from '@/components/ui/Progress';
import { todayKey } from '@/lib/date';
import type { WidgetComponentProps } from './types';

/** Study minutes tracked so far this week — reuses the analytics engine's own window. */
export function WeeklyStudyTimeWidget(_props: WidgetComponentProps) {
  const { from, to } = resolveRange('week', todayKey());
  const bundle = useAnalytics(from, to);
  const minutes = bundle?.result.study.studyMinutes ?? 0;

  return (
    <WidgetShell title="Weekly Study Time">
      <Stat
        label="This week"
        value={bundle ? formatDuration(minutes) : '…'}
        sub={bundle && minutes === 0 ? 'No study time tracked this week.' : undefined}
      />
    </WidgetShell>
  );
}
