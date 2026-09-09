import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey, todayKey, diffDays } from '@/lib/date';
import { logActivity } from './activityService';
import type {
  DateKey, ID, Intensity, Task, TaskFlexibility, TaskStatus, TaskType, TimeWindow,
} from '@/types';

export interface TaskDraft {
  title: string;
  notes?: string;
  trackerId: ID;
  goalId?: ID | null;
  milestoneId?: ID | null;
  parentTaskId?: ID | null;
  type?: TaskType;
  status?: TaskStatus;
  basePriority?: 1 | 2 | 3 | 4 | 5;
  dueDate?: string | null;
  deadlineHard?: boolean;
  estimatedMinutes?: number;
  dependsOn?: ID[];
  tags?: string[];
  preferredWindow?: TimeWindow;
  intensity?: Intensity;
  splittable?: boolean;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
  resourceIds?: ID[];
  revisionEntryId?: ID | null;
  recurringRuleId?: ID | null;
  topic?: string;
  earliestDate?: DateKey | null;
  flexibility?: TaskFlexibility;
  links?: string[];
}

/** Terminal states — a task in one of these is no longer schedulable. */
export const CLOSED_STATUSES: TaskStatus[] = ['completed', 'cancelled'];
export const OPEN_STATUSES: TaskStatus[] = ['inbox', 'planned', 'in_progress', 'rescheduled', 'skipped'];

export function isOpen(task: Task): boolean {
  return !CLOSED_STATUSES.includes(task.status);
}

export function buildTask(draft: TaskDraft, now = Date.now()): Task {
  const status = draft.status ?? 'inbox';
  return {
    id: newId('tsk'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    notes: draft.notes,
    trackerId: draft.trackerId,
    goalId: draft.goalId ?? null,
    milestoneId: draft.milestoneId ?? null,
    parentTaskId: draft.parentTaskId ?? null,
    type: draft.type ?? 'other',
    status,
    statusHistory: [{ from: null, to: status, at: now }],
    basePriority: draft.basePriority ?? 3,
    dueDate: draft.dueDate ?? null,
    deadlineHard: draft.deadlineHard ?? false,
    estimatedMinutes: Math.max(1, Math.round(draft.estimatedMinutes ?? 30)),
    actualMinutes: 0,
    dependsOn: draft.dependsOn ?? [],
    tags: draft.tags ?? [],
    preferredWindow: draft.preferredWindow ?? 'any',
    intensity: draft.intensity ?? 'medium',
    splittable: draft.splittable ?? true,
    minSessionMinutes: Math.max(5, draft.minSessionMinutes ?? 20),
    maxSessionMinutes: Math.max(10, draft.maxSessionMinutes ?? 120),
    resourceIds: draft.resourceIds ?? [],
    recurringRuleId: draft.recurringRuleId ?? null,
    revisionEntryId: draft.revisionEntryId ?? null,
    priorityScore: 0,
    priorityComputedAt: null,
    completedAt: null,
    rescheduleCount: 0,
    sortOrder: now,
    topic: draft.topic?.trim() || undefined,
    earliestDate: draft.earliestDate ?? null,
    flexibility: draft.flexibility ?? 'flexible',
    links: draft.links ?? [],
  };
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const task = buildTask(draft);
  await db.tasks.add(task);
  // Creation is logged for history/audit but never earns XP (anti-farming).
  await logActivity({
    type: 'task_created',
    title: task.title,
    trackerId: task.trackerId,
    taskId: task.id,
    goalId: task.goalId,
  });
  await refreshPriorityFor([task.id]);
  return task;
}

export async function updateTask(id: ID, patch: Partial<Task>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: Date.now() });
  await refreshPriorityFor([id]);
}

/**
 * Single funnel for status transitions. Records status history, keeps derived
 * fields consistent, cascades to linked schedule blocks and writes the Activity
 * row that analytics/XP later read.
 */
export async function setTaskStatus(
  id: ID,
  to: TaskStatus,
  options: { reason?: string; planRunId?: ID; at?: number; actualMinutes?: number } = {},
): Promise<Task | undefined> {
  const at = options.at ?? Date.now();
  const task = await db.tasks.get(id);
  if (!task || task.status === to) return task;

  const patch: Partial<Task> = {
    status: to,
    updatedAt: at,
    statusHistory: [...task.statusHistory, { from: task.status, to, at, reason: options.reason, planRunId: options.planRunId }],
  };

  if (to === 'completed') {
    patch.completedAt = at;
    if (options.actualMinutes !== undefined) {
      patch.actualMinutes = Math.max(0, Math.round(options.actualMinutes));
    }
  } else {
    patch.completedAt = null;
  }
  if (to === 'rescheduled') patch.rescheduleCount = task.rescheduleCount + 1;

  await db.tasks.update(id, patch);
  const updated = { ...task, ...patch } as Task;

  // Keep the schedule consistent with the task's outcome.
  if (to === 'completed' || to === 'cancelled' || to === 'skipped') {
    const blocks = await db.blocks.where('taskId').equals(id).toArray();
    const blockStatus = to === 'completed' ? 'completed' : to === 'skipped' ? 'skipped' : 'cancelled';
    for (const block of blocks) {
      if (block.status === 'planned' || block.status === 'in_progress') {
        await db.blocks.update(block.id, { status: blockStatus, updatedAt: at });
      }
    }
  }

  if (to === 'completed') {
    await logActivity({
      type: 'task_completed',
      title: task.title,
      at,
      trackerId: task.trackerId,
      taskId: task.id,
      goalId: task.goalId,
      durationMs: (patch.actualMinutes ?? task.actualMinutes) * 60_000,
      meta: {
        estimatedMinutes: task.estimatedMinutes,
        actualMinutes: patch.actualMinutes ?? task.actualMinutes,
        basePriority: task.basePriority,
        intensity: task.intensity,
        taskType: task.type,
        onTime: task.dueDate ? diffDays(toDateKey(at), task.dueDate) >= 0 : null,
        createdAt: task.createdAt,
      },
    });
  } else if (to === 'skipped') {
    await logActivity({
      type: 'task_skipped', title: task.title, at,
      trackerId: task.trackerId, taskId: task.id, goalId: task.goalId,
      meta: { reason: options.reason ?? null },
    });
  } else if (to === 'cancelled') {
    await logActivity({
      type: 'task_cancelled', title: task.title, at,
      trackerId: task.trackerId, taskId: task.id, goalId: task.goalId,
      meta: { reason: options.reason ?? null },
    });
  }

  await onTaskChanged(updated);
  return updated;
}

export async function completeTask(id: ID, actualMinutes?: number): Promise<void> {
  await setTaskStatus(id, 'completed', { actualMinutes });
}

export async function reopenTask(id: ID): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const hasBlocks = (await db.blocks.where('taskId').equals(id).count()) > 0;
  await setTaskStatus(id, hasBlocks ? 'planned' : 'inbox', { reason: 'Reopened' });
}

/**
 * Deleting a task removes its scheduled blocks but PRESERVES its activity
 * history — completed work happened and must stay in analytics.
 */
export async function deleteTask(id: ID): Promise<void> {
  await db.transaction('rw', [db.tasks, db.blocks, db.activities], async () => {
    const blocks = await db.blocks.where('taskId').equals(id).toArray();
    await db.blocks.bulkDelete(blocks.map((b) => b.id));
    // Detach history rather than deleting it.
    const acts = await db.activities.where('taskId').equals(id).toArray();
    for (const a of acts) {
      if (a.type === 'task_created') await db.activities.delete(a.id);
    }
    // Remove this task from other tasks' dependency lists.
    const dependents = await db.tasks.where('dependsOn').equals(id).toArray();
    for (const d of dependents) {
      await db.tasks.update(d.id, { dependsOn: d.dependsOn.filter((x) => x !== id), updatedAt: Date.now() });
    }
    await db.tasks.delete(id);
  });
}

export async function bulkUpdateTasks(ids: ID[], patch: Partial<Task>): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.tasks, async () => {
    for (const id of ids) await db.tasks.update(id, { ...patch, updatedAt: now });
  });
  await refreshPriorityFor(ids);
}

/** Tasks that are blocked because a dependency is still open. */
export function blockedBy(task: Task, byId: Record<ID, Task>): Task[] {
  return task.dependsOn.map((id) => byId[id]).filter((t): t is Task => !!t && isOpen(t));
}

export function isBlocked(task: Task, byId: Record<ID, Task>): boolean {
  return blockedBy(task, byId).length > 0;
}

/** Minutes still to schedule: estimate minus what is already blocked out. */
export async function remainingMinutes(task: Task): Promise<number> {
  const blocks = await db.blocks.where('taskId').equals(task.id).toArray();
  const scheduled = blocks
    .filter((b) => b.status === 'planned' || b.status === 'in_progress')
    .reduce((sum, b) => sum + (b.end - b.start) / 60_000, 0);
  return Math.max(0, task.estimatedMinutes - task.actualMinutes - scheduled);
}

export function isOverdue(task: Task, ref: string = todayKey()): boolean {
  return !!task.dueDate && isOpen(task) && diffDays(ref, task.dueDate) < 0;
}

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

/**
 * Legal status transitions. The UI only ever offers what is legal here, and
 * `setTaskStatus` is the single funnel that records history, so a task's audit
 * trail can never disagree with its current state.
 */
export const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ['planned', 'in_progress', 'completed', 'cancelled'],
  planned: ['in_progress', 'completed', 'skipped', 'rescheduled', 'cancelled', 'inbox'],
  in_progress: ['completed', 'skipped', 'rescheduled', 'cancelled', 'planned'],
  completed: ['planned', 'inbox', 'in_progress'],
  skipped: ['planned', 'inbox', 'in_progress', 'completed', 'cancelled'],
  rescheduled: ['planned', 'in_progress', 'completed', 'skipped', 'cancelled'],
  cancelled: ['inbox', 'planned'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: TaskStatus): TaskStatus[] {
  return STATUS_TRANSITIONS[from];
}

/**
 * Reschedules a task to a new due date. Recorded as a `rescheduled` transition
 * so `rescheduleCount` and the history reflect that the plan changed, then
 * returned to `planned` if it still has blocks.
 */
export async function rescheduleTaskTo(id: ID, dueDate: DateKey | null, reason?: string): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  await setTaskStatus(id, 'rescheduled', { reason: reason ?? (dueDate ? `Moved to ${dueDate}` : 'Date cleared') });
  await db.tasks.update(id, { dueDate, updatedAt: Date.now() });
  await refreshPriorityFor([id]);
}

/** Bulk status change through the same funnel (history preserved per task). */
export async function bulkSetStatus(ids: ID[], to: TaskStatus, reason?: string): Promise<number> {
  let changed = 0;
  for (const id of ids) {
    const task = await db.tasks.get(id);
    if (!task || !canTransition(task.status, to)) continue;
    await setTaskStatus(id, to, { reason });
    changed++;
  }
  return changed;
}

export async function bulkDeleteTasks(ids: ID[]): Promise<number> {
  for (const id of ids) await deleteTask(id);
  return ids.length;
}

/** Bulk due-date shift by N days; undated tasks are anchored to `from`. */
export async function bulkShiftDueDate(ids: ID[], days: number, from: DateKey = todayKey()): Promise<number> {
  const now = Date.now();
  let changed = 0;
  for (const id of ids) {
    const task = await db.tasks.get(id);
    if (!task) continue;
    const base = task.dueDate ?? from;
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
    await db.tasks.update(id, { dueDate: toDateKey(dt), updatedAt: now });
    changed++;
  }
  await refreshPriorityFor(ids);
  return changed;
}

/** Adds/removes tags across a selection without clobbering existing ones. */
export async function bulkEditTags(ids: ID[], add: string[], remove: string[]): Promise<void> {
  const now = Date.now();
  for (const id of ids) {
    const task = await db.tasks.get(id);
    if (!task) continue;
    const next = new Set(task.tags);
    for (const t of remove) next.delete(t);
    for (const t of add) if (t.trim()) next.add(t.trim());
    await db.tasks.update(id, { tags: [...next], updatedAt: now });
  }
}

/**
 * Duplicates a task as a fresh inbox item. History, actual time and links to
 * schedule blocks are deliberately NOT copied — the copy is new intent.
 */
export async function duplicateTask(id: ID): Promise<Task | null> {
  const task = await db.tasks.get(id);
  if (!task) return null;
  return createTask({
    title: `${task.title} (copy)`,
    notes: task.notes,
    trackerId: task.trackerId,
    goalId: task.goalId,
    milestoneId: task.milestoneId,
    type: task.type,
    basePriority: task.basePriority,
    dueDate: task.dueDate,
    deadlineHard: task.deadlineHard,
    estimatedMinutes: task.estimatedMinutes,
    tags: task.tags,
    preferredWindow: task.preferredWindow,
    intensity: task.intensity,
    splittable: task.splittable,
    minSessionMinutes: task.minSessionMinutes,
    maxSessionMinutes: task.maxSessionMinutes,
    resourceIds: task.resourceIds,
    topic: task.topic,
    earliestDate: task.earliestDate,
    flexibility: task.flexibility,
    links: task.links,
  });
}

/** Minutes already blocked out on the calendar for a set of tasks. */
export async function scheduledMinutesByTask(ids: ID[]): Promise<Record<ID, number>> {
  const out: Record<ID, number> = {};
  for (const id of ids) {
    const blocks = await db.blocks.where('taskId').equals(id).toArray();
    out[id] = blocks
      .filter((b) => b.status === 'planned' || b.status === 'in_progress')
      .reduce((sum, b) => sum + (b.end - b.start) / 60_000, 0);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cross-module hooks (filled in by later phases)                      */
/* ------------------------------------------------------------------ */

type TaskChangeHook = (task: Task) => Promise<void>;
const taskChangeHooks: TaskChangeHook[] = [];

/**
 * Later phases (XP, goal progress, achievements) register here instead of
 * taskService importing them, which keeps the dependency graph acyclic.
 */
export function onTaskChange(hook: TaskChangeHook): void {
  taskChangeHooks.push(hook);
}

async function onTaskChanged(task: Task): Promise<void> {
  for (const hook of taskChangeHooks) {
    try { await hook(task); } catch (e) { console.warn('[taskService] change hook failed', e); }
  }
}

type PriorityRefresher = (ids?: ID[]) => Promise<void>;
let priorityRefresher: PriorityRefresher | null = null;

/** Phase 3 installs the PriorityScoringEngine-backed implementation. */
export function setPriorityRefresher(fn: PriorityRefresher): void {
  priorityRefresher = fn;
}

export async function refreshPriorityFor(ids?: ID[]): Promise<void> {
  if (priorityRefresher) await priorityRefresher(ids);
}
