import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { atMinute, dateKeyToDate, MINUTE_MS } from '@/lib/date';
import { buildBlock } from './scheduleService';
import type {
  BlockKind, DateKey, ID, MinuteOfDay, ScheduleBlock, ScheduleTemplate, ScheduleTemplateEntry,
} from '@/types';

/**
 * Schedule templates: reusable weekly shapes (school hours, gym slots, sleep)
 * that can be stamped onto any set of days.
 *
 * Applying a template is deliberately NOT a lock — it creates ordinary blocks
 * the user can drag, resize or delete afterwards. Re-applying the same template
 * to a day replaces only the blocks that template previously produced there.
 */

export interface TemplateEntryDraft {
  dayOfWeek: number;
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
  title: string;
  trackerId: ID;
  kind?: BlockKind;
  protected?: boolean;
  locked?: boolean;
}

export function buildTemplateEntry(draft: TemplateEntryDraft): ScheduleTemplateEntry {
  const start = clampMinute(draft.startMinute);
  const end = Math.max(start + 5, clampMinute(draft.endMinute));
  return {
    id: newId('tpe'),
    dayOfWeek: ((draft.dayOfWeek % 7) + 7) % 7,
    startMinute: start,
    endMinute: end,
    title: draft.title.trim() || 'Untitled',
    trackerId: draft.trackerId,
    kind: draft.kind ?? 'fixed',
    protected: draft.protected ?? false,
    locked: draft.locked ?? false,
  };
}

export async function createTemplate(
  name: string,
  entries: TemplateEntryDraft[] = [],
  description?: string,
): Promise<ScheduleTemplate> {
  const now = Date.now();
  const template: ScheduleTemplate = {
    id: newId('tpl'),
    createdAt: now,
    updatedAt: now,
    name: name.trim() || 'Untitled template',
    description,
    entries: entries.map(buildTemplateEntry),
    active: false,
  };
  await db.templates.add(template);
  return template;
}

export async function updateTemplate(id: ID, patch: Partial<ScheduleTemplate>): Promise<void> {
  await db.templates.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteTemplate(id: ID): Promise<void> {
  await db.templates.delete(id);
}

export async function duplicateTemplate(id: ID): Promise<ScheduleTemplate | null> {
  const source = await db.templates.get(id);
  if (!source) return null;
  const now = Date.now();
  const copy: ScheduleTemplate = {
    ...source,
    id: newId('tpl'),
    createdAt: now,
    updatedAt: now,
    name: `${source.name} (copy)`,
    active: false,
    // Fresh entry ids so editing the copy never mutates the original.
    entries: source.entries.map((e) => ({ ...e, id: newId('tpe') })),
  };
  await db.templates.add(copy);
  return copy;
}

export async function addTemplateEntry(templateId: ID, draft: TemplateEntryDraft): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) return;
  await updateTemplate(templateId, { entries: [...template.entries, buildTemplateEntry(draft)] });
}

export async function updateTemplateEntry(
  templateId: ID,
  entryId: ID,
  patch: Partial<ScheduleTemplateEntry>,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) return;
  const entries = template.entries.map((e) => (e.id === entryId ? normaliseEntry({ ...e, ...patch }) : e));
  await updateTemplate(templateId, { entries });
}

export async function removeTemplateEntry(templateId: ID, entryId: ID): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) return;
  await updateTemplate(templateId, { entries: template.entries.filter((e) => e.id !== entryId) });
}

function normaliseEntry(entry: ScheduleTemplateEntry): ScheduleTemplateEntry {
  const startMinute = clampMinute(entry.startMinute);
  return { ...entry, startMinute, endMinute: Math.max(startMinute + 5, clampMinute(entry.endMinute)) };
}

function clampMinute(m: number): MinuteOfDay {
  return Math.min(1440, Math.max(0, Math.round(m)));
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

export interface ApplyTemplateOptions {
  /** Remove blocks previously created by this template on the same day first. */
  replaceExisting?: boolean;
  /** Skip an entry when it would overlap an existing block on that day. */
  skipConflicts?: boolean;
}

export interface ApplyTemplateResult {
  created: number;
  replaced: number;
  skipped: number;
  days: DateKey[];
}

/**
 * Stamps a template onto one or more days. Blocks carry `templateId` so a later
 * re-apply can cleanly replace exactly its own output and nothing else.
 */
export async function applyTemplateToDays(
  templateId: ID,
  dates: DateKey[],
  options: ApplyTemplateOptions = {},
): Promise<ApplyTemplateResult> {
  const template = await db.templates.get(templateId);
  const result: ApplyTemplateResult = { created: 0, replaced: 0, skipped: 0, days: [...dates] };
  if (!template) return result;

  const replaceExisting = options.replaceExisting ?? true;
  const skipConflicts = options.skipConflicts ?? false;

  for (const date of dates) {
    const dayOfWeek = dateKeyToDate(date).getDay();
    const entries = template.entries.filter((e) => e.dayOfWeek === dayOfWeek);
    if (!entries.length) continue;

    const existing = await db.blocks.where('date').equals(date).toArray();

    if (replaceExisting) {
      const mine = existing.filter((b) => b.templateId === templateId && b.status === 'planned');
      if (mine.length) {
        await db.blocks.bulkDelete(mine.map((b) => b.id));
        result.replaced += mine.length;
      }
    }

    const surviving = replaceExisting
      ? existing.filter((b) => !(b.templateId === templateId && b.status === 'planned'))
      : existing;

    const toAdd: ScheduleBlock[] = [];
    for (const entry of entries) {
      const start = atMinute(date, entry.startMinute);
      const end = atMinute(date, entry.endMinute);
      if (skipConflicts) {
        const clash = [...surviving, ...toAdd].some(
          (b) => b.status !== 'cancelled' && b.status !== 'skipped' && start < b.end && b.start < end,
        );
        if (clash) { result.skipped++; continue; }
      }
      toAdd.push({
        ...buildBlock({
          title: entry.title,
          start,
          end,
          trackerId: entry.trackerId,
          kind: entry.kind,
          protected: entry.protected,
          locked: entry.locked,
          origin: 'template',
        }),
        templateId,
      });
    }

    if (toAdd.length) {
      await db.blocks.bulkAdd(toAdd);
      result.created += toAdd.length;
    }
  }

  return result;
}

/** Removes every block a template produced within a date range. */
export async function clearTemplateBlocks(templateId: ID, from: DateKey, to: DateKey): Promise<number> {
  const rows = await db.blocks
    .where('[templateId+date]')
    .between([templateId, from], [templateId, to], true, true)
    .toArray();
  const removable = rows.filter((b) => b.status === 'planned');
  await db.blocks.bulkDelete(removable.map((b) => b.id));
  return removable.length;
}

/**
 * Builds a template from a day that is already laid out the way the user wants.
 * Only planned, non-task blocks are captured — a template is a shape of time,
 * not a copy of specific work.
 */
export async function createTemplateFromDay(name: string, date: DateKey): Promise<ScheduleTemplate> {
  const blocks = await db.blocks.where('date').equals(date).toArray();
  const dayOfWeek = dateKeyToDate(date).getDay();
  const dayStart = atMinute(date, 0);
  const entries: TemplateEntryDraft[] = blocks
    .filter((b) => b.status !== 'cancelled')
    .map((b) => ({
      dayOfWeek,
      startMinute: Math.round((b.start - dayStart) / MINUTE_MS),
      endMinute: Math.round((b.end - dayStart) / MINUTE_MS),
      title: b.title,
      trackerId: b.trackerId,
      kind: b.kind,
      protected: b.protected,
      locked: b.locked,
    }));
  return createTemplate(name, entries, `Captured from ${date}`);
}

/** Copies every entry of one weekday onto other weekdays within a template. */
export async function copyTemplateDay(templateId: ID, fromDay: number, toDays: number[]): Promise<number> {
  const template = await db.templates.get(templateId);
  if (!template) return 0;
  const source = template.entries.filter((e) => e.dayOfWeek === fromDay);
  if (!source.length) return 0;
  const kept = template.entries.filter((e) => !toDays.includes(e.dayOfWeek));
  const copies = toDays.flatMap((day) => source.map((e) => ({ ...e, id: newId('tpe'), dayOfWeek: day })));
  await updateTemplate(templateId, { entries: [...kept, ...copies] });
  return copies.length;
}
