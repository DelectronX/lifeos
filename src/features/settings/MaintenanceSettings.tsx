import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { db } from '@/db/db';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { SettingsSection } from './SettingsSection';
import { pruneSnapshots, rollSnapshots } from '@/services/analyticsService';
import { updateSettings } from '@/services/settingsService';
import { todayKey } from '@/lib/date';
import { DEFAULT_ANALYTICS_MAINTENANCE, type Settings } from '@/types';

/**
 * Visibility + manual control for the analytics snapshot rollup lifecycle.
 * The real rollup runs automatically once per day from
 * {@link module:services/maintenanceService}'s startup registry; this panel
 * lets a user see what has been rolled, disable it, and trigger it on demand.
 */
export function MaintenanceSettings({ settings }: { settings: Settings }) {
  const [busy, setBusy] = useState(false);
  const snapshots = useLiveQuery(
    () => db.snapshots.orderBy('periodKey').reverse().limit(20).toArray(),
    [],
  );

  const prefs = { ...DEFAULT_ANALYTICS_MAINTENANCE, ...(settings.analytics ?? {}) };

  const rollNow = async () => {
    setBusy(true);
    try {
      const written = await rollSnapshots(todayKey());
      const pruned = await pruneSnapshots();
      await updateSettings({ analytics: { ...prefs, lastRolledAt: Date.now() } });
      toast.success(
        'Snapshot roll complete',
        written.length
          ? `Rolled ${written.join(', ')}.${pruned ? ` Pruned ${pruned} old snapshot${pruned === 1 ? '' : 's'}.` : ''}`
          : 'Nothing new to roll — already up to date.',
      );
    } catch (e) {
      toast.error('Roll failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Analytics snapshots"
      description="Cached day/week rollups of your headline metrics, so long-range analytics views do not replay the whole event log. Rolled automatically once per day at startup; old snapshots are pruned to keep the table small."
      action={<Badge tone={prefs.rollSnapshots ? 'accent' : 'neutral'}>{prefs.rollSnapshots ? 'Enabled' : 'Disabled'}</Badge>}
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[rgb(var(--c-accent))]"
          checked={prefs.rollSnapshots}
          onChange={(e) => void updateSettings({ analytics: { ...prefs, rollSnapshots: e.target.checked } })}
        />
        Roll snapshots automatically on startup
      </label>

      <p className="t-meta">
        Last rolled: {prefs.lastRolledAt ? new Date(prefs.lastRolledAt).toLocaleString() : 'never'}
      </p>

      <div>
        <Button
          iconLeft={<RefreshCw className="h-4 w-4" />}
          loading={busy}
          disabled={busy}
          onClick={() => void rollNow()}
        >
          Roll snapshot now
        </Button>
      </div>

      {snapshots && snapshots.length ? (
        <div>
          <div className="t-label mb-1">Recent snapshots</div>
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-ink-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-normal">Scope</th>
                  <th className="px-3 py-1.5 text-left font-normal">Period</th>
                  <th className="px-3 py-1.5 text-right font-normal">Minutes</th>
                  <th className="px-3 py-1.5 text-right font-normal">Tasks done</th>
                  <th className="px-3 py-1.5 text-right font-normal">Computed</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-line-faint">
                    <td className="px-3 py-1.5 capitalize">{s.scope}</td>
                    <td className="px-3 py-1.5 t-num">{s.periodKey}</td>
                    <td className="px-3 py-1.5 text-right t-num">{s.metrics.totalMinutes ?? 0}</td>
                    <td className="px-3 py-1.5 text-right t-num">{s.metrics.tasksCompleted ?? 0}</td>
                    <td className="px-3 py-1.5 text-right t-meta">{new Date(s.computedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="t-meta">No snapshots yet — one is rolled automatically after your first day of use.</p>
      )}
    </SettingsSection>
  );
}
