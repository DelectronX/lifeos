import { db } from '@/db/db';
import { toDateKey } from '@/lib/date';
import { createTask, setTaskStatus, updateTask } from '@/services/taskService';
import type { ExternalTaskLink, ID, Task } from '@/types';
import { clickup, type ClickUpClient } from './client';
import {
  closingStatus, decideCompletionSync, isClosedStatus, lifeosPriorityFromClickUp, openingStatus, type CUTask, type SyncAction,
} from './shared';

/**
 * Links ClickUp tasks to LifeOS tasks and keeps their completion in step.
 *
 * Ownership (per the hybrid design):
 *  - ClickUp owns a linked task's title, due date and priority → copied into LifeOS on sync.
 *  - Completion is two-way: whichever side changed since the last sync wins;
 *    opposite changes on both sides are flagged as a conflict and left alone.
 *  - LifeOS owns everything personal: the calendar blocks you schedule for the
 *    task, XP, goals, streaks. Completing a linked task (or its block) in
 *    LifeOS earns XP exactly like any other task — through setTaskStatus.
 *  - A task deleted in ClickUp is marked `missing`, never deleted here.
 */

export const isClickUpLinked = (t: Task): t is Task & { external: ExternalTaskLink } => t.external?.provider === 'clickup';

export async function findLinkedTask(clickupId: string): Promise<Task | undefined> {
  return db.tasks.filter((t) => t.external?.provider === 'clickup' && t.external.id === clickupId).first();
}

function dueKey(task: CUTask): string | null {
  return task.dueDate ? toDateKey(task.dueDate) : null;
}

function notesFor(task: CUTask): string {
  const parts = [task.description.trim(), `ClickUp: ${task.url}`];
  return parts.filter(Boolean).join('\n\n');
}

/** Creates (or returns the existing) LifeOS task mirroring a ClickUp task. Idempotent by ClickUp id. */
export async function linkClickUpTask(task: CUTask, opts: { trackerId: ID; teamId?: string; goalId?: ID | null }): Promise<{ task: Task; created: boolean }> {
  const existing = await findLinkedTask(task.id);
  if (existing) return { task: existing, created: false };
  // Past work is not re-credited: only open tasks can be brought into LifeOS.
  if (isClosedStatus(task.status)) throw new Error('This task is already closed in ClickUp, so there is nothing left to plan in LifeOS.');
  const created = await createTask({
    title: task.name,
    notes: notesFor(task),
    trackerId: opts.trackerId,
    goalId: opts.goalId ?? null,
    dueDate: dueKey(task),
    basePriority: lifeosPriorityFromClickUp(task.priority),
    estimatedMinutes: task.timeEstimate ? Math.max(5, Math.round(task.timeEstimate / 60_000)) : 30,
    status: 'planned',
    tags: ['clickup', ...task.tags.slice(0, 10)],
    links: [task.url],
  });
  const clickupClosed = false;
  const external: ExternalTaskLink = {
    provider: 'clickup', id: task.id, url: task.url, listId: task.list.id, listName: task.list.name,
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
    lastSync: { lifeosCompleted: false, clickupClosed, at: Date.now() },
  };
  await updateTask(created.id, { external });
  return { task: (await db.tasks.get(created.id))!, created: true };
}

export async function unlinkTask(taskId: ID): Promise<void> {
  await updateTask(taskId, { external: undefined });
}

export interface SyncReport { checked: number; actions: Partial<Record<SyncAction | 'updated' | 'missing' | 'error', number>>; errors: string[] }

/** Reconciles one linked task. */
export async function syncLinkedTask(local: Task & { external: ExternalTaskLink }, api: ClickUpClient = clickup): Promise<SyncAction | 'missing' | 'updated'> {
  let remote: CUTask;
  try {
    remote = await api.task(local.external.id);
  } catch (e) {
    if ((e as { code?: string }).code === 'CLICKUP_NOT_FOUND') {
      if (!local.external.missing) await updateTask(local.id, { external: { ...local.external, missing: true } });
      return 'missing';
    }
    throw e;
  }

  const lifeosCompleted = local.status === 'completed';
  const clickupClosed = isClosedStatus(remote.status);
  const action = decideCompletionSync({ lifeosCompleted, clickupClosed, last: local.external.lastSync ?? null });

  let after = { lifeosCompleted, clickupClosed };
  switch (action) {
    case 'complete_in_lifeos':
      await setTaskStatus(local.id, 'completed', { reason: 'Completed in ClickUp' });
      after = { lifeosCompleted: true, clickupClosed };
      break;
    case 'reopen_in_lifeos':
      await setTaskStatus(local.id, 'planned', { reason: 'Reopened in ClickUp' });
      after = { lifeosCompleted: false, clickupClosed };
      break;
    case 'close_in_clickup':
    case 'reopen_in_clickup': {
      const list = await api.list(remote.list.id);
      const target = action === 'close_in_clickup' ? closingStatus(list.statuses) : openingStatus(list.statuses);
      if (target) {
        await api.updateTask({ id: remote.id, status: target.name });
        after = { lifeosCompleted, clickupClosed: action === 'close_in_clickup' };
      }
      break;
    }
    default:
      break;
  }

  // ClickUp owns title / due date / priority of linked tasks.
  const fresh = (await db.tasks.get(local.id))!;
  const patch: Partial<Task> = {};
  if (remote.name !== fresh.title) patch.title = remote.name;
  const due = dueKey(remote);
  if (due !== fresh.dueDate) patch.dueDate = due;
  const prio = lifeosPriorityFromClickUp(remote.priority);
  if (prio !== fresh.basePriority) patch.basePriority = prio;
  patch.external = {
    ...local.external, url: remote.url, listId: remote.list.id, listName: remote.list.name, missing: false,
    conflict: action === 'conflict',
    lastSync: action === 'conflict' ? local.external.lastSync ?? null : { ...after, at: Date.now() },
  };
  await updateTask(local.id, patch);
  if (action !== 'none') return action;
  return Object.keys(patch).length > 1 ? 'updated' : 'none';
}

let running: Promise<SyncReport> | null = null;

/** Reconciles every linked task (serially, to respect ClickUp rate limits). */
export function syncAllLinkedTasks(api: ClickUpClient = clickup): Promise<SyncReport> {
  if (running) return running;
  running = (async () => {
    const linked = (await db.tasks.filter((t) => t.external?.provider === 'clickup').toArray()) as Array<Task & { external: ExternalTaskLink }>;
    const report: SyncReport = { checked: 0, actions: {}, errors: [] };
    for (const t of linked) {
      if (t.status === 'cancelled') continue;
      try {
        const a = await syncLinkedTask(t, api);
        report.actions[a] = (report.actions[a] ?? 0) + 1;
      } catch (e) {
        report.actions.error = (report.actions.error ?? 0) + 1;
        report.errors.push(`${t.title}: ${e instanceof Error ? e.message : String(e)}`);
        const code = (e as { code?: string }).code;
        if (code === 'SERVER_UNREACHABLE' || code === 'CLICKUP_NOT_CONNECTED' || code === 'CLICKUP_AUTH' || code === 'AGENT_NOT_SET_UP') break;
      }
      report.checked++;
    }
    return report;
  })().finally(() => { running = null; });
  return running;
}

/* ------------------------------------------------------------------ */
/* Background loop                                                     */
/* ------------------------------------------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;
const SYNC_EVERY_MS = 3 * 60_000;

/** Starts periodic reconciliation while the app is open (no-op when nothing is linked). */
export function startClickUpSync(): void {
  if (timer || typeof window === 'undefined') return;
  const tick = async () => {
    if (document.visibilityState === 'hidden') return;
    const count = await db.tasks.filter((t) => t.external?.provider === 'clickup').count();
    if (count === 0) return;
    try { await syncAllLinkedTasks(); } catch { /* reported in the ClickUp page */ }
  };
  timer = setInterval(() => void tick(), SYNC_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void tick(); });
  setTimeout(() => void tick(), 10_000);
}
