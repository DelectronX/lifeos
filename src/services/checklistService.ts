import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { todayKey } from '@/lib/date';
import { bankBonus, revokeXPFor } from './xpService';
import { logActivity } from './activityService';
import { checklistProgress, periodKeyFor } from '@/engines/workgrowth';
import type { DateKey, ID } from '@/types';
import type { Checklist, ChecklistCadence, ChecklistItem, ChecklistRun } from '@/types/workgrowth';

/**
 * Daily / weekly / monthly checklists. A checklist is a reusable template;
 * each period (day, ISO week, month) gets its own run of ticks, so the same
 * list recurs automatically with no generation step. Completing EVERY item
 * banks the list's completionXP once per period (deduped) and logs one
 * activity; un-ticking any item revokes both.
 */

export interface ChecklistDraft {
  title: string;
  cadence: ChecklistCadence;
  description?: string;
  items?: Array<Omit<ChecklistItem, 'id'> & { id?: ID }>;
  dueWeekday?: number;
  dueMonthDay?: number | 'last';
  completionXP?: number;
  trackerId?: ID | null;
}

export async function createChecklist(draft: ChecklistDraft, now = Date.now()): Promise<Checklist> {
  const list: Checklist = {
    id: newId('chk'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    cadence: draft.cadence,
    description: draft.description,
    items: (draft.items ?? []).map((i) => ({ ...i, id: i.id ?? newId('cki') })),
    active: true,
    sortOrder: await db.checklists.count(),
    dueWeekday: draft.dueWeekday,
    dueMonthDay: draft.dueMonthDay,
    completionXP: draft.completionXP,
    trackerId: draft.trackerId ?? null,
  };
  await db.checklists.add(list);
  return list;
}

export async function updateChecklist(id: ID, patch: Partial<Checklist>): Promise<void> {
  await db.checklists.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteChecklist(id: ID): Promise<void> {
  await db.transaction('rw', [db.checklists, db.checklistRuns], async () => {
    await db.checklistRuns.where('checklistId').equals(id).delete();
    await db.checklists.delete(id);
  });
}

export async function addChecklistItem(id: ID, item: Omit<ChecklistItem, 'id'>): Promise<void> {
  const list = await db.checklists.get(id);
  if (!list) return;
  await updateChecklist(id, { items: [...list.items, { ...item, id: newId('cki') }] });
}

export async function removeChecklistItem(id: ID, itemId: ID): Promise<void> {
  const list = await db.checklists.get(id);
  if (!list) return;
  await updateChecklist(id, { items: list.items.filter((i) => i.id !== itemId) });
}

export async function getRun(checklistId: ID, periodKey: string): Promise<ChecklistRun | undefined> {
  return db.checklistRuns.where('[checklistId+periodKey]').equals([checklistId, periodKey]).first();
}

/**
 * Ticks / unticks one item for the period containing `date`. Returns the
 * updated run and whether this toggle completed the whole list.
 */
export async function toggleChecklistItem(
  checklistId: ID, itemId: ID, date: DateKey = todayKey(), at = Date.now(),
): Promise<{ run: ChecklistRun; justCompleted: boolean }> {
  const list = await db.checklists.get(checklistId);
  if (!list) throw new Error('Checklist not found.');
  const periodKey = periodKeyFor(list.cadence, date);
  const existing = await getRun(checklistId, periodKey);
  const run: ChecklistRun = existing ?? {
    id: newId('ckr'), createdAt: at, updatedAt: at, checklistId, periodKey, checked: {}, completedAt: null,
  };
  const checked = { ...run.checked };
  if (checked[itemId] !== undefined) delete checked[itemId];
  else checked[itemId] = at;

  const progress = checklistProgress(list, { ...run, checked }, date);
  const wasComplete = run.completedAt !== null;
  const next: ChecklistRun = { ...run, checked, updatedAt: at, completedAt: progress.complete ? (run.completedAt ?? at) : null };
  await db.checklistRuns.put(next);

  const xpKey = `checklist:${checklistId}:${periodKey}`;
  if (progress.complete && !wasComplete) {
    await logActivity({
      type: 'checklist_completed', title: list.title, at, trackerId: list.trackerId ?? null,
      meta: { checklistId, periodKey, cadence: list.cadence },
    });
    if ((list.completionXP ?? 0) > 0) await bankBonus(xpKey, list.completionXP!, 'checklist_completed', `Checklist: ${list.title}`, at);
  } else if (!progress.complete && wasComplete) {
    const acts = (await db.activities.where('type').equals('checklist_completed').toArray())
      .filter((a) => a.meta?.checklistId === checklistId && a.meta?.periodKey === periodKey);
    await db.activities.bulkDelete(acts.map((a) => a.id));
    await revokeXPFor('bonus', xpKey);
  }
  return { run: next, justCompleted: progress.complete && !wasComplete };
}
