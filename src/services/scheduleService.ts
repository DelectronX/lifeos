import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { dateKeyToTimestamp, MINUTE_MS, snapToGrid, toDateKey } from '@/lib/date';
import { logActivity } from './activityService';
import { setTaskStatus } from './taskService';
import type {
  BlockKind, BlockOrigin, BlockStatus, DateKey, ID, ScheduleBlock, Task, Timestamp,
} from '@/types';

export interface BlockDraft {
  title: string;
  start: Timestamp;
  end: Timestamp;
  trackerId: ID;
  kind?: BlockKind;
  taskId?: ID | null;
  goalId?: ID | null;
  resourceId?: ID | null;
  locked?: boolean;
  protected?: boolean;
  origin?: BlockOrigin;
  planRunId?: ID | null;
  splitGroupId?: ID | null;
  splitIndex?: number;
  splitCount?: number;
  status?: BlockStatus;
  notes?: string;
}

export function buildBlock(draft: BlockDraft, now = Date.now()): ScheduleBlock {
  const start = Math.round(draft.start);
  const end = Math.max(start + MINUTE_MS, Math.round(draft.end));
  return {
    id: newId('blk'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    date: toDateKey(start),
    start,
    end,
    trackerId: draft.trackerId,
    kind: draft.kind ?? (draft.taskId ? 'task' : 'event'),
    taskId: draft.taskId ?? null,
    goalId: draft.goalId ?? null,
    resourceId: draft.resourceId ?? null,
    status: draft.status ?? 'planned',
    locked: draft.locked ?? false,
    protected: draft.protected ?? false,
    origin: draft.origin ?? 'manual',
    planRunId: draft.planRunId ?? null,
    splitGroupId: draft.splitGroupId ?? null,
    splitIndex: draft.splitIndex ?? 0,
    splitCount: draft.splitCount ?? 1,
    actualStart: null,
    actualEnd: null,
    notes: draft.notes,
  };
}

export async function createBlock(draft: BlockDraft): Promise<ScheduleBlock> {
  const block = buildBlock(draft);
  await db.blocks.add(block);
  // Scheduling a task moves it out of the inbox — one status funnel, no duplicates.
  if (block.taskId) {
    const task = await db.tasks.get(block.taskId);
    if (task && (task.status === 'inbox' || task.status === 'rescheduled' || task.status === 'skipped')) {
      await setTaskStatus(task.id, 'planned', { reason: 'Scheduled' });
    }
  }
  return block;
}

export async function updateBlock(id: ID, patch: Partial<ScheduleBlock>): Promise<void> {
  const next: Partial<ScheduleBlock> = { ...patch, updatedAt: Date.now() };
  if (patch.start !== undefined) next.date = toDateKey(patch.start);
  await db.blocks.update(id, next);
}

/** Moves a block by a delta, preserving duration. Locked blocks are refused. */
export async function moveBlock(id: ID, deltaMs: number, granularityMinutes = 5): Promise<boolean> {
  const block = await db.blocks.get(id);
  if (!block || block.locked) return false;
  const duration = block.end - block.start;
  const start = snapToGrid(block.start + deltaMs, granularityMinutes);
  await updateBlock(id, { start, end: start + duration });
  return true;
}

export async function resizeBlock(
  id: ID,
  edge: 'start' | 'end',
  newTime: Timestamp,
  granularityMinutes = 5,
  minMinutes = 5,
): Promise<boolean> {
  const block = await db.blocks.get(id);
  if (!block || block.locked) return false;
  const snapped = snapToGrid(newTime, granularityMinutes);
  if (edge === 'start') {
    const start = Math.min(snapped, block.end - minMinutes * MINUTE_MS);
    await updateBlock(id, { start });
  } else {
    const end = Math.max(snapped, block.start + minMinutes * MINUTE_MS);
    await updateBlock(id, { end });
  }
  return true;
}

export async function duplicateBlock(id: ID): Promise<ScheduleBlock | null> {
  const block = await db.blocks.get(id);
  if (!block) return null;
  const duration = block.end - block.start;
  return createBlock({
    title: block.title,
    start: block.end,
    end: block.end + duration,
    trackerId: block.trackerId,
    kind: block.kind,
    taskId: block.taskId,
    goalId: block.goalId,
    resourceId: block.resourceId,
    protected: block.protected,
    notes: block.notes,
    origin: 'manual',
  });
}

/** Splits a block into two at `atTime`, keeping both halves linked to the task. */
export async function splitBlock(id: ID, atTime: Timestamp): Promise<ScheduleBlock[] | null> {
  const block = await db.blocks.get(id);
  if (!block) return null;
  if (atTime <= block.start + MINUTE_MS || atTime >= block.end - MINUTE_MS) return null;

  const groupId = block.splitGroupId ?? newId('spl');
  await updateBlock(id, { end: atTime, splitGroupId: groupId, splitIndex: 0, splitCount: 2 });
  const second = await createBlock({
    title: block.title,
    start: atTime,
    end: block.end,
    trackerId: block.trackerId,
    kind: block.kind,
    taskId: block.taskId,
    goalId: block.goalId,
    resourceId: block.resourceId,
    protected: block.protected,
    origin: block.origin,
    splitGroupId: groupId,
    splitIndex: 1,
    splitCount: 2,
    notes: block.notes,
  });
  const first = await db.blocks.get(id);
  return first ? [first, second] : [second];
}

export async function deleteBlock(id: ID): Promise<void> {
  await db.blocks.delete(id);
}

export async function deleteBlocksForTask(taskId: ID): Promise<number> {
  const blocks = await db.blocks.where('taskId').equals(taskId).toArray();
  await db.blocks.bulkDelete(blocks.map((b) => b.id));
  return blocks.length;
}

/**
 * Completing a block records the real elapsed time as an Activity. When the
 * block is the last open one for its task, the task is completed too.
 */
export async function completeBlock(id: ID, options: { at?: number; alsoCompleteTask?: boolean } = {}): Promise<void> {
  const at = options.at ?? Date.now();
  const block = await db.blocks.get(id);
  if (!block) return;

  const actualStart = block.actualStart ?? block.start;
  // Completing early records the real elapsed time; completing after the block
  // has already ended records the planned duration rather than the wall gap.
  const actualEnd = block.actualEnd ?? Math.min(Math.max(at, actualStart), block.end);
  const durationMs = Math.max(0, actualEnd - actualStart);

  await db.blocks.update(id, { status: 'completed', actualStart, actualEnd, updatedAt: at });

  await logActivity({
    type: 'block_completed',
    title: block.title,
    at,
    trackerId: block.trackerId,
    taskId: block.taskId,
    goalId: block.goalId,
    blockId: block.id,
    durationMs,
    meta: { plannedMs: block.end - block.start, kind: block.kind, createdAt: block.createdAt },
  });

  if (block.taskId) {
    const task = await db.tasks.get(block.taskId);
    if (task) {
      const minutes = Math.round(durationMs / MINUTE_MS);
      await db.tasks.update(task.id, { actualMinutes: task.actualMinutes + minutes, updatedAt: at });
      const siblings = await db.blocks.where('taskId').equals(task.id).toArray();
      const stillOpen = siblings.some((b) => b.id !== id && (b.status === 'planned' || b.status === 'in_progress'));
      if (options.alsoCompleteTask ?? !stillOpen) {
        await setTaskStatus(task.id, 'completed', { at, actualMinutes: task.actualMinutes + minutes });
      }
    }
  }
}

export async function skipBlock(id: ID, reason?: string): Promise<void> {
  const at = Date.now();
  const block = await db.blocks.get(id);
  if (!block) return;
  await db.blocks.update(id, { status: 'skipped', updatedAt: at });
  await logActivity({
    type: 'block_skipped', title: block.title, at,
    trackerId: block.trackerId, taskId: block.taskId, goalId: block.goalId, blockId: block.id,
    meta: { reason: reason ?? null },
  });
}

export async function startBlock(id: ID): Promise<void> {
  const at = Date.now();
  await db.blocks.update(id, { status: 'in_progress', actualStart: at, updatedAt: at });
  const block = await db.blocks.get(id);
  if (block?.taskId) await setTaskStatus(block.taskId, 'in_progress', { at, reason: 'Block started' });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function getBlocksInRange(from: DateKey, to: DateKey): Promise<ScheduleBlock[]> {
  return db.blocks.where('[date+start]').between([from, -Infinity], [to, Infinity]).sortBy('start');
}

export async function getBlocksForDay(date: DateKey): Promise<ScheduleBlock[]> {
  return getBlocksInRange(date, date);
}

/** The next planned block starting at or after `from`, across all days. */
export async function getNextBlock(from: Timestamp = Date.now()): Promise<ScheduleBlock | undefined> {
  const candidates = await db.blocks
    .where('start').aboveOrEqual(from)
    .filter((b) => b.status === 'planned' || b.status === 'in_progress')
    .sortBy('start');
  return candidates[0];
}

/** Currently running block, if any. */
export async function getCurrentBlock(at: Timestamp = Date.now()): Promise<ScheduleBlock | undefined> {
  const day = toDateKey(at);
  const blocks = await getBlocksForDay(day);
  return blocks.find((b) => b.start <= at && b.end > at && b.status !== 'cancelled' && b.status !== 'skipped');
}

/** Converts a schedule block into a standalone task (spec: convert block<->task). */
export async function convertBlockToTask(id: ID): Promise<ID | null> {
  const block = await db.blocks.get(id);
  if (!block || block.taskId) return block?.taskId ?? null;
  const { createTask } = await import('./taskService');
  const task = await createTask({
    title: block.title,
    trackerId: block.trackerId,
    goalId: block.goalId,
    status: 'planned',
    estimatedMinutes: Math.round((block.end - block.start) / MINUTE_MS),
    dueDate: block.date,
  });
  await updateBlock(id, { taskId: task.id, kind: 'task' });
  return task.id;
}

/** Places an existing task on the calendar at a given time. */
export async function convertTaskToBlock(task: Task, start: Timestamp, minutes?: number): Promise<ScheduleBlock> {
  const duration = (minutes ?? task.estimatedMinutes) * MINUTE_MS;
  return createBlock({
    title: task.title,
    start,
    end: start + duration,
    trackerId: task.trackerId,
    taskId: task.id,
    goalId: task.goalId,
    kind: 'task',
    origin: 'manual',
  });
}

/** Schedules a task by id — the form-friendly wrapper around convertTaskToBlock. */
export async function scheduleTaskAt(
  taskId: ID,
  start: Timestamp,
  minutes?: number,
): Promise<ScheduleBlock | null> {
  const task = await db.tasks.get(taskId);
  if (!task) return null;
  return convertTaskToBlock(task, start, minutes);
}

/** True when two intervals overlap by at least one millisecond. */
export function overlaps(aStart: Timestamp, aEnd: Timestamp, bStart: Timestamp, bEnd: Timestamp): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Blocks that conflict with a proposed interval (ignoring cancelled/skipped). */
export function findConflicts(
  blocks: ScheduleBlock[],
  start: Timestamp,
  end: Timestamp,
  ignoreId?: ID,
): ScheduleBlock[] {
  return blocks.filter(
    (b) =>
      b.id !== ignoreId &&
      b.status !== 'cancelled' &&
      b.status !== 'skipped' &&
      overlaps(start, end, b.start, b.end),
  );
}

/* ------------------------------------------------------------------ */
/* Additional block operations (Phase 2 UI)                            */
/* ------------------------------------------------------------------ */

/** Moves a block to an absolute start time, preserving its duration. */
export async function moveBlockTo(
  id: ID,
  start: Timestamp,
  granularityMinutes = 5,
): Promise<boolean> {
  const block = await db.blocks.get(id);
  if (!block || block.locked) return false;
  const duration = block.end - block.start;
  const snapped = snapToGrid(start, granularityMinutes);
  await updateBlock(id, { start: snapped, end: snapped + duration });
  return true;
}

/** Sets an explicit start/end pair (used by the inspector's time fields). */
export async function setBlockTimes(
  id: ID,
  start: Timestamp,
  end: Timestamp,
  minMinutes = 5,
): Promise<void> {
  const safeEnd = Math.max(end, start + minMinutes * MINUTE_MS);
  await updateBlock(id, { start, end: safeEnd });
}

/** Changes duration while keeping the start fixed. */
export async function setBlockDuration(id: ID, minutes: number): Promise<void> {
  const block = await db.blocks.get(id);
  if (!block) return;
  const safe = Math.max(5, Math.round(minutes));
  await updateBlock(id, { end: block.start + safe * MINUTE_MS });
}

/** Copies a block onto another day at the same time of day. */
export async function copyBlockToDate(id: ID, date: DateKey): Promise<ScheduleBlock | null> {
  const block = await db.blocks.get(id);
  if (!block) return null;
  const offset = block.start - dateKeyToTimestamp(block.date);
  const duration = block.end - block.start;
  const start = dateKeyToTimestamp(date) + offset;
  return createBlock({
    title: block.title,
    start,
    end: start + duration,
    trackerId: block.trackerId,
    kind: block.kind,
    taskId: block.taskId,
    goalId: block.goalId,
    resourceId: block.resourceId,
    protected: block.protected,
    locked: block.locked,
    notes: block.notes,
    origin: 'manual',
  });
}

/** Attaches (or detaches, with null) a task to an existing block. */
export async function attachTaskToBlock(blockId: ID, taskId: ID | null): Promise<void> {
  const patch: Partial<ScheduleBlock> = { taskId, kind: taskId ? 'task' : 'event' };
  if (taskId) {
    const task = await db.tasks.get(taskId);
    if (task) {
      patch.goalId = task.goalId;
      patch.trackerId = task.trackerId;
      if (task.status === 'inbox' || task.status === 'rescheduled' || task.status === 'skipped') {
        await setTaskStatus(taskId, 'planned', { reason: 'Attached to a schedule block' });
      }
    }
  }
  await updateBlock(blockId, patch);
}

export async function attachGoalToBlock(blockId: ID, goalId: ID | null): Promise<void> {
  await updateBlock(blockId, { goalId });
}

export async function attachResourceToBlock(blockId: ID, resourceId: ID | null): Promise<void> {
  await updateBlock(blockId, { resourceId });
}

/** Reverts a completed/skipped block back to planned and undoes its effects. */
export async function reopenBlock(id: ID): Promise<void> {
  const block = await db.blocks.get(id);
  if (!block) return;
  const at = Date.now();
  if (block.status === 'completed' && block.taskId) {
    // Roll back the minutes this block contributed so totals stay honest.
    const contributed = Math.round(
      Math.max(0, (block.actualEnd ?? block.end) - (block.actualStart ?? block.start)) / MINUTE_MS,
    );
    const task = await db.tasks.get(block.taskId);
    if (task) {
      await db.tasks.update(task.id, {
        actualMinutes: Math.max(0, task.actualMinutes - contributed),
        updatedAt: at,
      });
    }
  }
  // Remove the completion/skip event; the work is no longer claimed to have happened.
  const rows = await db.activities.where('blockId').equals(id).toArray();
  const doomed = rows.filter((a) => a.type === 'block_completed' || a.type === 'block_skipped');
  await db.activities.bulkDelete(doomed.map((a) => a.id));

  await db.blocks.update(id, { status: 'planned', actualStart: null, actualEnd: null, updatedAt: at });
}

export async function setBlockLocked(id: ID, locked: boolean): Promise<void> {
  await updateBlock(id, { locked });
}

export async function setBlockProtected(id: ID, isProtected: boolean): Promise<void> {
  await updateBlock(id, { protected: isProtected });
}

/** Total planned/in-progress minutes on a day, per tracker. */
export function minutesByTracker(blocks: ScheduleBlock[]): Record<ID, number> {
  const out: Record<ID, number> = {};
  for (const b of blocks) {
    if (b.status === 'cancelled' || b.status === 'skipped') continue;
    out[b.trackerId] = (out[b.trackerId] ?? 0) + (b.end - b.start) / MINUTE_MS;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Timeline layout                                                     */
/* ------------------------------------------------------------------ */

export interface LaidOutBlock {
  block: ScheduleBlock;
  /** Fraction of the column width, 0..1. */
  left: number;
  width: number;
  /** Minute-of-day bounds clamped to the rendered day. */
  startMinute: number;
  endMinute: number;
}

/**
 * Side-by-side layout for overlapping blocks, the way a calendar does it:
 * blocks are swept in start order into "columns"; a cluster of mutually
 * overlapping blocks shares the width evenly. Pure — safe to unit test.
 */
export function layoutDayBlocks(blocks: ScheduleBlock[], dayStart: Timestamp): LaidOutBlock[] {
  const dayEnd = dayStart + 1440 * MINUTE_MS;
  const visible = blocks
    .filter((b) => b.end > dayStart && b.start < dayEnd)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out: LaidOutBlock[] = [];
  let cluster: ScheduleBlock[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy column packing within the cluster.
    const columns: ScheduleBlock[][] = [];
    for (const b of cluster) {
      let placed = false;
      for (const col of columns) {
        if (col[col.length - 1].end <= b.start) { col.push(b); placed = true; break; }
      }
      if (!placed) columns.push([b]);
    }
    const n = columns.length;
    columns.forEach((col, ci) => {
      for (const b of col) {
        out.push({
          block: b,
          left: ci / n,
          width: 1 / n,
          startMinute: Math.max(0, (b.start - dayStart) / MINUTE_MS),
          endMinute: Math.min(1440, (b.end - dayStart) / MINUTE_MS),
        });
      }
    });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const b of visible) {
    if (cluster.length && b.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();

  return out.sort((a, b) => a.block.start - b.block.start);
}

/** Earliest/latest minute worth rendering, so empty nights collapse. */
export function visibleMinuteRange(
  blocks: ScheduleBlock[],
  dayStart: Timestamp,
  fallback: [number, number] = [6 * 60, 23 * 60],
): [number, number] {
  if (!blocks.length) return fallback;
  let min = Infinity;
  let max = -Infinity;
  for (const b of blocks) {
    min = Math.min(min, (b.start - dayStart) / MINUTE_MS);
    max = Math.max(max, (b.end - dayStart) / MINUTE_MS);
  }
  return [
    Math.max(0, Math.min(fallback[0], Math.floor(min / 60) * 60)),
    Math.min(1440, Math.max(fallback[1], Math.ceil(max / 60) * 60)),
  ];
}

/** Free gaps between blocks within a minute window — used by "add here". */
export function findGaps(
  blocks: ScheduleBlock[],
  dayStart: Timestamp,
  fromMinute: number,
  toMinute: number,
  minMinutes = 15,
): { startMinute: number; endMinute: number }[] {
  const busy = blocks
    .filter((b) => b.status !== 'cancelled' && b.status !== 'skipped')
    .map((b) => ({
      s: Math.max(fromMinute, (b.start - dayStart) / MINUTE_MS),
      e: Math.min(toMinute, (b.end - dayStart) / MINUTE_MS),
    }))
    .filter((r) => r.e > r.s)
    .sort((a, b) => a.s - b.s);

  const gaps: { startMinute: number; endMinute: number }[] = [];
  let cursor = fromMinute;
  for (const r of busy) {
    if (r.s - cursor >= minMinutes) gaps.push({ startMinute: cursor, endMinute: r.s });
    cursor = Math.max(cursor, r.e);
  }
  if (toMinute - cursor >= minMinutes) gaps.push({ startMinute: cursor, endMinute: toMinute });
  return gaps;
}
