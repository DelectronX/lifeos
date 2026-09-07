import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey } from '@/lib/date';
import type { Activity, ActivityType, ID } from '@/types';

/**
 * The single write path into the universal Activity log.
 *
 * Nothing else in the app inserts into `activities` directly. Every feature
 * (tasks, timers, papers, revision, habits, reviews) funnels through here, which
 * is what makes analytics/XP/streaks consistent across all four pillars.
 */

export interface LogActivityInput {
  type: ActivityType;
  title: string;
  at?: number;
  trackerId?: ID | null;
  taskId?: ID | null;
  goalId?: ID | null;
  blockId?: ID | null;
  sessionId?: ID | null;
  paperId?: ID | null;
  revisionEntryId?: ID | null;
  habitId?: ID | null;
  resourceId?: ID | null;
  durationMs?: number;
  value?: number | null;
  unit?: string | null;
  meta?: Record<string, unknown>;
}

export function buildActivity(input: LogActivityInput): Activity {
  const at = input.at ?? Date.now();
  return {
    id: newId('act'),
    createdAt: at,
    updatedAt: at,
    type: input.type,
    at,
    date: toDateKey(at),
    trackerId: input.trackerId ?? null,
    taskId: input.taskId ?? null,
    goalId: input.goalId ?? null,
    blockId: input.blockId ?? null,
    sessionId: input.sessionId ?? null,
    paperId: input.paperId ?? null,
    revisionEntryId: input.revisionEntryId ?? null,
    habitId: input.habitId ?? null,
    resourceId: input.resourceId ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
    value: input.value ?? null,
    unit: input.unit ?? null,
    title: input.title,
    meta: input.meta ?? {},
  };
}

export async function logActivity(input: LogActivityInput): Promise<Activity> {
  const activity = buildActivity(input);
  await db.activities.add(activity);
  return activity;
}

/** Removes the activity rows attached to a source record (used when undoing). */
export async function deleteActivitiesBy(field: keyof Activity, value: string): Promise<number> {
  const rows = await db.activities.where(field as string).equals(value).toArray();
  if (!rows.length) return 0;
  await db.activities.bulkDelete(rows.map((r) => r.id));
  return rows.length;
}

export async function getActivitiesInRange(from: string, to: string): Promise<Activity[]> {
  return db.activities.where('date').between(from, to, true, true).toArray();
}

export async function getActivitiesForTask(taskId: ID): Promise<Activity[]> {
  return db.activities.where('taskId').equals(taskId).toArray();
}

/** Distinct dates with at least one activity — the basis for streaks. */
export async function getActiveDates(): Promise<string[]> {
  const set = new Set<string>();
  await db.activities.orderBy('date').eachKey((key) => set.add(String(key)));
  return [...set].sort();
}
