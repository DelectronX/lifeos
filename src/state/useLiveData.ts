import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '@/db/db';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { addDaysToKey, todayKey } from '@/lib/date';
import type { DateKey, SchedulingConfig, Settings, Tracker, UserProfile } from '@/types';

/**
 * Thin live-query hooks. Every read in the UI goes through one of these, so
 * Dexie's observability keeps components in sync without any manual cache.
 */

export function useLiveProfile(): UserProfile | undefined {
  return useLiveQuery(() => db.profile.get('profile'), []);
}

export function useLiveSettings(): Settings | undefined {
  return useLiveQuery(() => db.settings.get('settings'), []);
}

export function useSchedulingConfig(): SchedulingConfig {
  const settings = useLiveSettings();
  return useMemo(() => mergeSchedulingConfig(settings?.scheduling), [settings?.scheduling]);
}

export function useTrackers(includeArchived = false): Tracker[] {
  return (
    useLiveQuery(async () => {
      const all = await db.trackers.orderBy('sortOrder').toArray();
      return includeArchived ? all : all.filter((t) => !t.archived);
    }, [includeArchived]) ?? []
  );
}

/** id -> Tracker map, the single lookup used everywhere for colour + name. */
export function useTrackerMap(): Record<string, Tracker> {
  const trackers = useTrackers(true);
  return useMemo(() => Object.fromEntries(trackers.map((t) => [t.id, t])), [trackers]);
}

export function useBlocksForRange(from: DateKey, to: DateKey) {
  return (
    useLiveQuery(
      () => db.blocks.where('[date+start]').between([from, -Infinity], [to, Infinity]).sortBy('start'),
      [from, to],
    ) ?? []
  );
}

export function useBlocksForDay(date: DateKey) {
  return useBlocksForRange(date, date);
}

export function useTasks() {
  return useLiveQuery(() => db.tasks.toArray(), []) ?? [];
}

export function useOpenTasks() {
  return (
    useLiveQuery(
      () => db.tasks.where('status').anyOf('inbox', 'planned', 'in_progress', 'rescheduled').toArray(),
      [],
    ) ?? []
  );
}

export function useTask(id: string | null | undefined) {
  return useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id]);
}

export function useGoals(activeOnly = false) {
  return (
    useLiveQuery(async () => {
      const all = await db.goals.toArray();
      return activeOnly ? all.filter((g) => g.status === 'active') : all;
    }, [activeOnly]) ?? []
  );
}

export function useMilestones(goalId?: string) {
  return (
    useLiveQuery(
      () => (goalId ? db.milestones.where('goalId').equals(goalId).sortBy('sortOrder') : db.milestones.toArray()),
      [goalId],
    ) ?? []
  );
}

export function useActivitiesForRange(from: DateKey, to: DateKey) {
  return (
    useLiveQuery(() => db.activities.where('date').between(from, to, true, true).toArray(), [from, to]) ?? []
  );
}

export function useTodayActivities() {
  const today = todayKey();
  return useActivitiesForRange(today, today);
}

export function useSessionsForRange(from: DateKey, to: DateKey) {
  return (
    useLiveQuery(() => db.sessions.where('date').between(from, to, true, true).toArray(), [from, to]) ?? []
  );
}

export function useRecentDays(days: number): { from: DateKey; to: DateKey } {
  return useMemo(() => {
    const to = todayKey();
    return { from: addDaysToKey(to, -(days - 1)), to };
  }, [days]);
}

export function useHabits(includeArchived = false) {
  return (
    useLiveQuery(async () => {
      const all = await db.habits.toArray();
      return includeArchived ? all : all.filter((h) => !h.archived);
    }, [includeArchived]) ?? []
  );
}

export function useResources(includeArchived = false) {
  return (
    useLiveQuery(async () => {
      const all = await db.resources.toArray();
      return includeArchived ? all : all.filter((r) => !r.archived);
    }, [includeArchived]) ?? []
  );
}

export function useAchievements() {
  return useLiveQuery(() => db.achievements.toArray(), []) ?? [];
}

export function useRevisionEntries() {
  return useLiveQuery(() => db.revisionEntries.toArray(), []) ?? [];
}

export function useRevisionPlans() {
  return useLiveQuery(() => db.revisionPlans.toArray(), []) ?? [];
}

export function usePapers() {
  return useLiveQuery(() => db.papers.orderBy('date').reverse().toArray(), []) ?? [];
}

export function useRecentPlanRuns(limit = 10) {
  return useLiveQuery(() => db.planRuns.orderBy('at').reverse().limit(limit).toArray(), [limit]) ?? [];
}
