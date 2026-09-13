import { WidgetShell } from './WidgetShell';
import { useAnalytics, resolveRange } from '@/services/analyticsService';
import { useTrackers } from '@/state/useLiveData';
import { todayKey, formatDuration } from '@/lib/date';
import { Select } from '@/components/ui/Input';
import { ProgressBar } from '@/components/ui/Progress';
import { setDashboardLayout } from '@/services/settingsService';
import { useDashboardLayout } from '@/state/useLiveData';
import { updateWidgetSettings } from './layout';
import type { WidgetComponentProps } from './types';

/** Time tracked for one subject (study-pillar tracker) this week, or all of them. */
export function SubjectProgressWidget({ config }: WidgetComponentProps) {
  const { from, to } = resolveRange('week', todayKey());
  const bundle = useAnalytics(from, to);
  const trackers = useTrackers().filter((t) => !t.system);
  const layout = useDashboardLayout();

  const selected = (config.settings?.trackerId as string | undefined) ?? 'all';
  const rows = bundle?.result.overview.distribution.byTracker ?? [];
  const row = selected === 'all' ? null : rows.find((r) => r.id === selected);
  const totalMinutes = selected === 'all'
    ? rows.reduce((s, r) => s + r.minutes, 0)
    : row?.minutes ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.minutes));

  async function onChangeSubject(trackerId: string) {
    const next = updateWidgetSettings(layout, config.id, { trackerId });
    await setDashboardLayout(next);
  }

  return (
    <WidgetShell
      title="Subject Progress"
      trailing={
        <Select
          sizeVariant="sm"
          className="h-7 w-32 text-xs"
          value={selected}
          onChange={(e) => onChangeSubject(e.target.value)}
        >
          <option value="all">All subjects</option>
          {trackers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      }
    >
      {!bundle ? (
        <p className="t-meta py-2">Loading…</p>
      ) : totalMinutes === 0 ? (
        <p className="t-meta py-2">No time tracked yet.</p>
      ) : (
        <div>
          <div className="t-num text-lg font-semibold text-ink">{formatDuration(totalMinutes)}</div>
          <ProgressBar className="mt-2" value={totalMinutes / max} size="sm" />
        </div>
      )}
    </WidgetShell>
  );
}
