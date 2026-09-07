import { db } from '@/db/db';
import { newId } from '@/lib/id';
import type { ID, Pillar, Tracker, TrackerColor } from '@/types';

export interface TrackerInput {
  name: string;
  pillar: Pillar;
  parentId?: ID | null;
  color?: TrackerColor;
  weeklyTargetMinutes?: number;
  defaultProtected?: boolean;
}

export async function createTracker(input: TrackerInput): Promise<Tracker> {
  const now = Date.now();
  const count = await db.trackers.count();
  const tracker: Tracker = {
    id: newId('trk'),
    createdAt: now,
    updatedAt: now,
    name: input.name.trim(),
    pillar: input.pillar,
    parentId: input.parentId ?? null,
    color: input.color ?? 'slate',
    system: false,
    defaultProtected: input.defaultProtected ?? false,
    archived: false,
    sortOrder: count,
    weeklyTargetMinutes: input.weeklyTargetMinutes,
  };
  await db.trackers.add(tracker);
  return tracker;
}

export async function updateTracker(id: ID, patch: Partial<Tracker>): Promise<void> {
  await db.trackers.update(id, { ...patch, updatedAt: Date.now() });
}

/**
 * Trackers are never hard-deleted while records reference them — that would
 * orphan history. System trackers can only be archived.
 */
export async function deleteTracker(id: ID): Promise<{ deleted: boolean; reason?: string }> {
  const tracker = await db.trackers.get(id);
  if (!tracker) return { deleted: false, reason: 'Tracker not found.' };
  if (tracker.system) {
    await updateTracker(id, { archived: true });
    return { deleted: false, reason: 'System trackers are archived rather than deleted.' };
  }

  const [taskCount, blockCount, activityCount, childCount] = await Promise.all([
    db.tasks.where('trackerId').equals(id).count(),
    db.blocks.where('trackerId').equals(id).count(),
    db.activities.where('trackerId').equals(id).count(),
    db.trackers.where('parentId').equals(id).count(),
  ]);

  const referenced = taskCount + blockCount + activityCount + childCount;
  if (referenced > 0) {
    await updateTracker(id, { archived: true });
    return {
      deleted: false,
      reason: `Archived instead of deleted — ${referenced} record${referenced === 1 ? '' : 's'} still reference this tracker.`,
    };
  }

  await db.trackers.delete(id);
  return { deleted: true };
}

export async function reorderTrackers(orderedIds: ID[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.trackers, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.trackers.update(orderedIds[i], { sortOrder: i, updatedAt: now });
    }
  });
}

/** Resolves a tracker to its root pillar tracker (walks `parentId`). */
export function rootTrackerOf(trackerId: ID, byId: Record<ID, Tracker>): Tracker | undefined {
  let cur = byId[trackerId];
  const seen = new Set<ID>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId[cur.parentId];
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function pillarOf(trackerId: ID | null, byId: Record<ID, Tracker>): Pillar | null {
  if (!trackerId) return null;
  return rootTrackerOf(trackerId, byId)?.pillar ?? byId[trackerId]?.pillar ?? null;
}
