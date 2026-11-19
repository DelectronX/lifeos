import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { setTaskStatus } from '@/services/taskService';
import type { Tracker } from '@/types';
import type { ClickUpClient } from '../client';
import { findLinkedTask, linkClickUpTask, syncAllLinkedTasks, syncLinkedTask } from '../linkService';
import type { CUList, CUTask } from '../shared';

function tracker(id: string): Tracker {
  return { id, createdAt: 1, updatedAt: 1, name: id, pillar: 'skills', parentId: null, color: 'indigo', system: false, defaultProtected: false, archived: false, sortOrder: 0 };
}

const LIST: CUList = {
  id: 'L1', name: 'Sprint', taskCount: 1,
  statuses: [{ name: 'to do', color: '', type: 'open', order: 0 }, { name: 'doing', color: '', type: 'custom', order: 1 }, { name: 'complete', color: '', type: 'closed', order: 2 }],
};

function cuTask(over: Partial<CUTask> = {}): CUTask {
  return {
    id: 'cu1', customId: null, name: 'Client landing page', description: 'Build the hero', status: { name: 'to do', color: '', type: 'open', order: 0 },
    priority: { level: 2, label: 'High', color: '' }, dueDate: new Date(2026, 11, 3, 12).getTime(), dueHasTime: false, startDate: null,
    url: 'https://app.clickup.com/t/cu1', list: { id: 'L1', name: 'Sprint' }, folder: null, spaceId: 'S1', assignees: [], tags: ['client'],
    timeEstimate: 90 * 60_000, timeSpent: null, parentId: null, subtasks: [], createdAt: 1, updatedAt: 2, closedAt: null, ...over,
  };
}

/** In-memory fake of the ClickUp routes the link service uses. */
function fakeApi(initial: CUTask) {
  const state = { task: initial, updates: [] as Array<{ id: string; status?: string }>, gone: false };
  const api = {
    task: async (id: string) => {
      if (state.gone) throw Object.assign(new Error('Task not found'), { code: 'CLICKUP_NOT_FOUND' });
      expect(id).toBe(state.task.id);
      return structuredClone(state.task);
    },
    list: async () => LIST,
    updateTask: async (input: { id: string; status?: string }) => {
      state.updates.push(input);
      const s = LIST.statuses.find((x) => x.name === input.status)!;
      state.task = { ...state.task, status: s };
      return state.task;
    },
  } as unknown as ClickUpClient;
  return { api, state };
}

const xpTotal = async () => (await db.profile.get('profile'))?.totalXP ?? 0;

describe('ClickUp ↔ LifeOS task links', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
    await db.trackers.put(tracker('trk_work'));
  });

  it('links a ClickUp task once, carrying title, due date, priority and estimate', async () => {
    const a = await linkClickUpTask(cuTask(), { trackerId: 'trk_work', teamId: 'T1' });
    const b = await linkClickUpTask(cuTask(), { trackerId: 'trk_work', teamId: 'T1' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task.id).toBe(a.task.id);
    expect(await db.tasks.count()).toBe(1);
    expect(a.task).toMatchObject({
      title: 'Client landing page', dueDate: '2026-12-03', basePriority: 4, estimatedMinutes: 90, status: 'planned',
      external: { provider: 'clickup', id: 'cu1', listId: 'L1', teamId: 'T1', lastSync: { lifeosCompleted: false, clickupClosed: false } },
    });
    expect(a.task.notes).toContain('https://app.clickup.com/t/cu1');
  });

  it('never credits work that was already finished in ClickUp', async () => {
    await expect(linkClickUpTask(cuTask({ status: LIST.statuses[2]! }), { trackerId: 'trk_work' })).rejects.toThrow(/already closed/);
    expect(await db.tasks.count()).toBe(0);
  });

  it('closing in ClickUp completes the LifeOS task (XP once); reopening there reopens it', async () => {
    const { api, state } = fakeApi(cuTask());
    const linked = await linkClickUpTask(state.task, { trackerId: 'trk_work' });
    await db.tasks.update(linked.task.id, { createdAt: Date.now() - 86_400_000 }); // linked yesterday (anti-farming age gate)
    const before = await xpTotal();
    state.task = { ...state.task, status: LIST.statuses[2]! };
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('complete_in_lifeos');
    const t = (await findLinkedTask('cu1'))!;
    expect(t.status).toBe('completed');
    expect(await xpTotal()).toBeGreaterThan(before);
    const afterXP = await xpTotal();
    expect(await syncLinkedTask(t as never, api)).toBe('none'); // repeat sync: nothing new, no extra XP
    expect(await xpTotal()).toBe(afterXP);
    state.task = { ...state.task, status: LIST.statuses[0]! };
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('reopen_in_lifeos');
    expect((await findLinkedTask('cu1'))!.status).toBe('planned');
  });

  it('completing in LifeOS closes the ClickUp task with its list\'s closed status', async () => {
    const { api, state } = fakeApi(cuTask());
    const { task } = await linkClickUpTask(state.task, { trackerId: 'trk_work' });
    await setTaskStatus(task.id, 'completed');
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('close_in_clickup');
    expect(state.updates).toEqual([{ id: 'cu1', status: 'complete' }]);
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('none');
    expect(state.updates).toHaveLength(1);
  });

  it('copies ClickUp-owned fields and flags conflicts instead of overwriting', async () => {
    const { api, state } = fakeApi(cuTask());
    const { task } = await linkClickUpTask(state.task, { trackerId: 'trk_work' });
    state.task = { ...state.task, name: 'Landing page v2', dueDate: null, priority: { level: 1, label: 'Urgent', color: '' } };
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('updated');
    expect(await db.tasks.get(task.id)).toMatchObject({ title: 'Landing page v2', dueDate: null, basePriority: 5 });
    // Both sides change completion in opposite directions since the last sync.
    await setTaskStatus(task.id, 'completed');
    await db.tasks.update(task.id, { external: { ...(await db.tasks.get(task.id))!.external!, lastSync: { lifeosCompleted: false, clickupClosed: true, at: 1 } } });
    expect(await syncLinkedTask((await findLinkedTask('cu1')) as never, api)).toBe('conflict');
    expect((await db.tasks.get(task.id))!.external).toMatchObject({ conflict: true });
    expect(state.updates).toHaveLength(0);
  });

  it('marks a task deleted in ClickUp as missing and keeps it', async () => {
    const { api, state } = fakeApi(cuTask());
    await linkClickUpTask(state.task, { trackerId: 'trk_work' });
    state.gone = true;
    const report = await syncAllLinkedTasks(api);
    expect(report).toMatchObject({ checked: 1, actions: { missing: 1 } });
    expect((await findLinkedTask('cu1'))!.external).toMatchObject({ missing: true });
  });
});
