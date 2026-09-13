import { db } from '@/db/db';
import { addDaysToKey, todayKey } from '@/lib/date';
import { materialiseAllRules } from './recurrenceService';
import { getUiState, setUiState } from './uiStateStore';
import { pruneSnapshots, rollSnapshots } from './analyticsService';
import { getSettings, updateSettings } from './settingsService';
import { DEFAULT_ANALYTICS_MAINTENANCE } from '@/types';

/**
 * Startup maintenance. Runs once per app load, guarded so a second load on the
 * same day is a no-op. Individual steps are added by later phases:
 *   - materialise RecurringRule occurrences into tasks/blocks
 *   - mark overdue RevisionEntries as missed
 *   - roll yesterday's AnalyticsSnapshot
 */
const RUN_KEY = 'maintenance.lastRun';

export interface MaintenanceResult {
  ran: boolean;
  steps: string[];
}

export async function runStartupMaintenance(force = false): Promise<MaintenanceResult> {
  const today = todayKey();
  if (!force && getUiState<string | null>(RUN_KEY, null) === today) {
    return { ran: false, steps: [] };
  }

  const steps: string[] = [];
  const registry = [...MAINTENANCE_STEPS];
  for (const step of registry) {
    try {
      const message = await step.run(today);
      if (message) steps.push(message);
    } catch (e) {
      // A failing maintenance step must never block app startup.
      console.warn(`[maintenance] step "${step.name}" failed:`, e);
    }
  }

  setUiState(RUN_KEY, today);
  return { ran: true, steps };
}

export interface MaintenanceStep {
  name: string;
  run: (today: string) => Promise<string | null>;
}

/** Later phases push their steps here at module load. */
export const MAINTENANCE_STEPS: MaintenanceStep[] = [
  {
    name: 'materialise-recurring-rules',
    // Keeps the next 60 days of recurring blocks/tasks present. Idempotent:
    // occurrences that already exist are skipped, exceptions are respected.
    run: async (today) => {
      const result = await materialiseAllRules(today, addDaysToKey(today, 60));
      const created = result.blocksCreated + result.tasksCreated;
      return created ? `Generated ${created} recurring occurrence${created === 1 ? '' : 's'}.` : null;
    },
  },
  {
    name: 'prune-empty-plan-runs',
    // Undone plan runs older than 60 days carry no value and cost space.
    run: async () => {
      const cutoff = Date.now() - 60 * 86_400_000;
      const stale = await db.planRuns.where('at').below(cutoff).filter((r) => r.undone).toArray();
      if (!stale.length) return null;
      await db.planRuns.bulkDelete(stale.map((r) => r.id));
      return `Pruned ${stale.length} reverted plan runs.`;
    },
  },
  {
    name: 'roll-analytics-snapshot',
    // Caches yesterday's and last week's headline metrics so long-range
    // analytics views do not replay the whole event log. Disabled via
    // settings.analytics.rollSnapshots; prunes old snapshots afterwards so the
    // table does not grow forever.
    run: async (today) => {
      const settings = await getSettings();
      const prefs = { ...DEFAULT_ANALYTICS_MAINTENANCE, ...(settings.analytics ?? {}) };
      if (prefs.rollSnapshots === false) return null;

      const written = await rollSnapshots(today);
      const pruned = await pruneSnapshots();
      await updateSettings({ analytics: { ...prefs, lastRolledAt: Date.now() } });

      const parts: string[] = [];
      if (written.length) parts.push(`Rolled ${written.length} snapshot${written.length === 1 ? '' : 's'} (${written.join(', ')}).`);
      if (pruned) parts.push(`Pruned ${pruned} old snapshot${pruned === 1 ? '' : 's'}.`);
      return parts.length ? parts.join(' ') : null;
    },
  },
];

export function registerMaintenanceStep(step: MaintenanceStep): void {
  if (!MAINTENANCE_STEPS.some((s) => s.name === step.name)) MAINTENANCE_STEPS.push(step);
}
