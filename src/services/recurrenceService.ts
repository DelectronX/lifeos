import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { addDaysToKey, atMinute, dateKeyToDate, diffDays, MINUTE_MS, todayKey } from '@/lib/date';
import { buildBlock } from './scheduleService';
import { buildTask } from './taskService';
import type {
  BlockKind, DateKey, ID, MinuteOfDay, RecurrenceEditScope, RecurrenceOverride,
  RecurrenceFreq, RecurringRule, ScheduleBlock, Task,
} from '@/types';

/**
 * Recurring rules and their materialisation.
 *
 * A rule is the *definition*; blocks/tasks are *materialised occurrences*.
 * Editing a series therefore has three meanings, all supported here:
 *   occurrence — write a per-date override, series definition untouched
 *   future     — end the current rule the day before, start a new rule
 *   series     — mutate the rule and re-materialise every unstarted occurrence
 *
 * Deleting one occurrence records a date exception so it is never regenerated.
 */

export interface RecurringRuleDraft {
  title: string;
  freq: RecurrenceFreq;
  interval?: number;
  byWeekday?: number[];
  byMonthDay?: number[];
  startDate?: DateKey;
  endDate?: DateKey | null;
  count?: number | null;
  target: 'task' | 'block';
  taskTemplate?: Partial<Task> | null;
  blockTemplate?: RecurringRule['blockTemplate'];
  active?: boolean;
}

export function buildRecurringRule(draft: RecurringRuleDraft, now = Date.now()): RecurringRule {
  return {
    id: newId('rec'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim() || 'Untitled',
    freq: draft.freq,
    interval: Math.max(1, Math.round(draft.interval ?? 1)),
    byWeekday: draft.byWeekday ?? [],
    byMonthDay: draft.byMonthDay ?? [],
    startDate: draft.startDate ?? todayKey(now),
    endDate: draft.endDate ?? null,
    count: draft.count ?? null,
    target: draft.target,
    taskTemplate: draft.taskTemplate ?? null,
    blockTemplate: draft.blockTemplate ?? null,
    lastGeneratedDate: null,
    active: draft.active ?? true,
    exceptions: [],
    overrides: {},
  };
}

export async function createRecurringRule(draft: RecurringRuleDraft): Promise<RecurringRule> {
  const rule = buildRecurringRule(draft);
  await db.recurringRules.add(rule);
  return rule;
}

export async function updateRecurringRule(id: ID, patch: Partial<RecurringRule>): Promise<void> {
  await db.recurringRules.update(id, { ...patch, updatedAt: Date.now() });
}

/** Deletes a rule and, optionally, the occurrences it has already produced. */
export async function deleteRecurringRule(id: ID, removeFutureBlocks = true): Promise<number> {
  let removed = 0;
  if (removeFutureBlocks) {
    const today = todayKey();
    const blocks = await db.blocks.where('recurringRuleId').equals(id).toArray();
    const future = blocks.filter((b) => b.date >= today && b.status === 'planned');
    await db.blocks.bulkDelete(future.map((b) => b.id));
    removed = future.length;
  }
  await db.recurringRules.delete(id);
  return removed;
}

/* ------------------------------------------------------------------ */
/* Occurrence maths                                                    */
/* ------------------------------------------------------------------ */

/** True when the rule nominally fires on `date` (ignores exceptions). */
export function ruleFiresOn(rule: RecurringRule, date: DateKey): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;

  const d = dateKeyToDate(date);
  switch (rule.freq) {
    case 'daily':
      return diffDays(rule.startDate, date) % rule.interval === 0;
    case 'weekly': {
      const weekdays = rule.byWeekday.length ? rule.byWeekday : [dateKeyToDate(rule.startDate).getDay()];
      if (!weekdays.includes(d.getDay())) return false;
      // Interval counts whole weeks from the start date's week.
      const weeks = Math.floor(diffDays(startOfWeekAnchor(rule.startDate), date) / 7);
      return weeks >= 0 && weeks % rule.interval === 0;
    }
    case 'monthly': {
      const days = rule.byMonthDay.length ? rule.byMonthDay : [dateKeyToDate(rule.startDate).getDate()];
      if (!days.includes(d.getDate())) return false;
      const start = dateKeyToDate(rule.startDate);
      const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
      return months >= 0 && months % rule.interval === 0;
    }
  }
}

/** Sunday-anchored week start, used so weekly interval maths is stable. */
function startOfWeekAnchor(key: DateKey): DateKey {
  const d = dateKeyToDate(key);
  return addDaysToKey(key, -d.getDay());
}

/** Every real occurrence date in [from, to], honouring exceptions and count. */
export function occurrencesInRange(rule: RecurringRule, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const exceptions = new Set(rule.exceptions ?? []);
  let cursor = from < rule.startDate ? rule.startDate : from;
  let emittedBeforeRange = 0;

  if (rule.count !== null) {
    // Count-limited rules need the occurrences before `from` to know the budget.
    let c = rule.startDate;
    let guard = 0;
    while (c < cursor && guard++ < 4000) {
      if (ruleFiresOn(rule, c) && !exceptions.has(c)) emittedBeforeRange++;
      c = addDaysToKey(c, 1);
    }
  }

  let guard = 0;
  while (cursor <= to && guard++ < 4000) {
    if (rule.count !== null && emittedBeforeRange + out.length >= rule.count) break;
    if (ruleFiresOn(rule, cursor) && !exceptions.has(cursor)) out.push(cursor);
    cursor = addDaysToKey(cursor, 1);
  }
  return out;
}

/** Resolved shape of one occurrence after applying any per-date override. */
export interface ResolvedOccurrence {
  date: DateKey;
  title: string;
  startMinute: MinuteOfDay;
  durationMinutes: number;
  trackerId: ID;
  kind: BlockKind;
  protected: boolean;
  notes?: string;
}

export function resolveOccurrence(rule: RecurringRule, date: DateKey): ResolvedOccurrence | null {
  const base = rule.blockTemplate;
  if (!base) return null;
  const override: RecurrenceOverride = rule.overrides?.[date] ?? {};
  return {
    date,
    title: override.title ?? base.title ?? rule.title,
    startMinute: override.startMinute ?? base.startMinute,
    durationMinutes: override.durationMinutes ?? base.durationMinutes,
    trackerId: override.trackerId ?? base.trackerId,
    kind: override.kind ?? base.kind,
    protected: override.protected ?? base.protected,
    notes: override.notes,
  };
}

/* ------------------------------------------------------------------ */
/* Materialisation                                                     */
/* ------------------------------------------------------------------ */

export interface MaterialiseResult {
  blocksCreated: number;
  tasksCreated: number;
  skipped: number;
}

/**
 * Ensures every occurrence of a rule in [from, to] exists as a real record.
 * Idempotent: an occurrence that already has a materialised row is left alone,
 * so running this on every app start never duplicates anything.
 */
export async function materialiseRule(
  rule: RecurringRule,
  from: DateKey,
  to: DateKey,
): Promise<MaterialiseResult> {
  const result: MaterialiseResult = { blocksCreated: 0, tasksCreated: 0, skipped: 0 };
  if (!rule.active) return result;

  const dates = occurrencesInRange(rule, from, to);
  if (!dates.length) return result;

  if (rule.target === 'block' && rule.blockTemplate) {
    const existing = await db.blocks.where('recurringRuleId').equals(rule.id).toArray();
    const have = new Set(existing.map((b) => b.occurrenceDate ?? b.date));

    const toAdd: ScheduleBlock[] = [];
    for (const date of dates) {
      if (have.has(date)) { result.skipped++; continue; }
      const spec = resolveOccurrence(rule, date);
      if (!spec) continue;
      const start = atMinute(date, spec.startMinute);
      toAdd.push({
        ...buildBlock({
          title: spec.title,
          start,
          end: start + spec.durationMinutes * MINUTE_MS,
          trackerId: spec.trackerId,
          kind: spec.kind,
          protected: spec.protected,
          origin: 'recurring',
          notes: spec.notes,
        }),
        recurringRuleId: rule.id,
        occurrenceDate: date,
        detachedFromSeries: false,
      });
    }
    if (toAdd.length) {
      await db.blocks.bulkAdd(toAdd);
      result.blocksCreated = toAdd.length;
    }
  } else if (rule.target === 'task' && rule.taskTemplate) {
    const existing = await db.tasks.where('recurringRuleId').equals(rule.id).toArray();
    const have = new Set(existing.map((t) => t.dueDate).filter(Boolean) as string[]);
    const toAdd: Task[] = [];
    for (const date of dates) {
      if (have.has(date)) { result.skipped++; continue; }
      const tpl = rule.taskTemplate;
      if (!tpl.trackerId) continue;
      toAdd.push(
        buildTask({
          title: tpl.title ?? rule.title,
          notes: tpl.notes,
          trackerId: tpl.trackerId,
          goalId: tpl.goalId ?? null,
          type: tpl.type,
          basePriority: tpl.basePriority,
          estimatedMinutes: tpl.estimatedMinutes,
          intensity: tpl.intensity,
          preferredWindow: tpl.preferredWindow,
          dueDate: date,
          status: 'planned',
          recurringRuleId: rule.id,
        }),
      );
    }
    if (toAdd.length) {
      await db.tasks.bulkAdd(toAdd);
      result.tasksCreated = toAdd.length;
    }
  }

  const last = dates[dates.length - 1];
  if (last && (!rule.lastGeneratedDate || last > rule.lastGeneratedDate)) {
    await updateRecurringRule(rule.id, { lastGeneratedDate: last });
  }
  return result;
}

/** Materialises every active rule across a horizon. Safe to run repeatedly. */
export async function materialiseAllRules(from: DateKey, to: DateKey): Promise<MaterialiseResult> {
  const rules = (await db.recurringRules.toArray()).filter((r) => r.active);
  const total: MaterialiseResult = { blocksCreated: 0, tasksCreated: 0, skipped: 0 };
  for (const rule of rules) {
    const r = await materialiseRule(rule, from, to);
    total.blocksCreated += r.blocksCreated;
    total.tasksCreated += r.tasksCreated;
    total.skipped += r.skipped;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Series editing semantics                                            */
/* ------------------------------------------------------------------ */

export interface SeriesEdit {
  title?: string;
  startMinute?: MinuteOfDay;
  durationMinutes?: number;
  trackerId?: ID;
  kind?: BlockKind;
  protected?: boolean;
  notes?: string;
}

/**
 * Applies an edit to a recurring block with the chosen scope.
 * Returns a plain-language description of what changed.
 */
export async function editSeries(
  ruleId: ID,
  occurrenceDate: DateKey,
  scope: RecurrenceEditScope,
  edit: SeriesEdit,
): Promise<string> {
  const rule = await db.recurringRules.get(ruleId);
  if (!rule || !rule.blockTemplate) return 'Series not found.';

  if (scope === 'occurrence') {
    const overrides = { ...(rule.overrides ?? {}) };
    overrides[occurrenceDate] = { ...(overrides[occurrenceDate] ?? {}), ...stripUndefined(edit) };
    await updateRecurringRule(ruleId, { overrides });
    await rematerialiseRange(ruleId, occurrenceDate, occurrenceDate);
    return `Updated the ${occurrenceDate} occurrence only.`;
  }

  if (scope === 'future') {
    // Close the old rule the day before, and start a fresh rule from here.
    const dayBefore = addDaysToKey(occurrenceDate, -1);
    await updateRecurringRule(ruleId, { endDate: dayBefore });
    await deleteMaterialisedFrom(ruleId, occurrenceDate);

    const next = await createRecurringRule({
      title: edit.title ?? rule.title,
      freq: rule.freq,
      interval: rule.interval,
      byWeekday: rule.byWeekday,
      byMonthDay: rule.byMonthDay,
      startDate: occurrenceDate,
      endDate: rule.endDate && rule.endDate > dayBefore ? rule.endDate : null,
      count: null,
      target: rule.target,
      blockTemplate: {
        ...rule.blockTemplate,
        ...stripUndefined({
          title: edit.title,
          startMinute: edit.startMinute,
          durationMinutes: edit.durationMinutes,
          trackerId: edit.trackerId,
          kind: edit.kind,
          protected: edit.protected,
        }),
      },
      taskTemplate: rule.taskTemplate,
    });
    await materialiseRule(next, occurrenceDate, addDaysToKey(occurrenceDate, 90));
    return `Split the series: this and all later occurrences now follow a new rule from ${occurrenceDate}.`;
  }

  // scope === 'series'
  await updateRecurringRule(ruleId, {
    title: edit.title ?? rule.title,
    blockTemplate: { ...rule.blockTemplate, ...stripUndefined(edit) } as RecurringRule['blockTemplate'],
  });
  const today = todayKey();
  const fromDate = today < rule.startDate ? rule.startDate : today;
  await deleteMaterialisedFrom(ruleId, fromDate);
  const updated = await db.recurringRules.get(ruleId);
  if (updated) await materialiseRule(updated, fromDate, addDaysToKey(fromDate, 90));
  return 'Updated the entire series from today forward. Past occurrences were left as they happened.';
}

/**
 * Deletes occurrences with the chosen scope. "occurrence" records a date
 * exception so the rule never regenerates it.
 */
export async function deleteFromSeries(
  ruleId: ID,
  occurrenceDate: DateKey,
  scope: RecurrenceEditScope,
): Promise<string> {
  const rule = await db.recurringRules.get(ruleId);
  if (!rule) return 'Series not found.';

  if (scope === 'occurrence') {
    const exceptions = [...new Set([...(rule.exceptions ?? []), occurrenceDate])];
    await updateRecurringRule(ruleId, { exceptions });
    await deleteMaterialisedRange(ruleId, occurrenceDate, occurrenceDate);
    return `Removed the ${occurrenceDate} occurrence. The rest of the series is unchanged.`;
  }

  if (scope === 'future') {
    await updateRecurringRule(ruleId, { endDate: addDaysToKey(occurrenceDate, -1) });
    const removed = await deleteMaterialisedFrom(ruleId, occurrenceDate);
    return `Ended the series before ${occurrenceDate}. Removed ${removed} future occurrence${removed === 1 ? '' : 's'}.`;
  }

  const removed = await deleteRecurringRule(ruleId, true);
  return `Deleted the whole series and ${removed} upcoming occurrence${removed === 1 ? '' : 's'}. Completed history was kept.`;
}

async function deleteMaterialisedFrom(ruleId: ID, from: DateKey): Promise<number> {
  const blocks = await db.blocks.where('recurringRuleId').equals(ruleId).toArray();
  const doomed = blocks.filter(
    (b) => (b.occurrenceDate ?? b.date) >= from && b.status === 'planned' && !b.detachedFromSeries,
  );
  await db.blocks.bulkDelete(doomed.map((b) => b.id));
  return doomed.length;
}

async function deleteMaterialisedRange(ruleId: ID, from: DateKey, to: DateKey): Promise<number> {
  const blocks = await db.blocks.where('recurringRuleId').equals(ruleId).toArray();
  const doomed = blocks.filter((b) => {
    const d = b.occurrenceDate ?? b.date;
    return d >= from && d <= to && b.status === 'planned' && !b.detachedFromSeries;
  });
  await db.blocks.bulkDelete(doomed.map((b) => b.id));
  return doomed.length;
}

async function rematerialiseRange(ruleId: ID, from: DateKey, to: DateKey): Promise<void> {
  await deleteMaterialisedRange(ruleId, from, to);
  const rule = await db.recurringRules.get(ruleId);
  if (rule) await materialiseRule(rule, from, to);
}

/**
 * Detaches a materialised block from its series so the user can move it freely
 * without the next regeneration pulling it back into place.
 */
export async function detachOccurrence(blockId: ID): Promise<void> {
  const block = await db.blocks.get(blockId);
  if (!block?.recurringRuleId) return;
  const rule = await db.recurringRules.get(block.recurringRuleId);
  if (rule) {
    const date = block.occurrenceDate ?? block.date;
    await updateRecurringRule(rule.id, { exceptions: [...new Set([...(rule.exceptions ?? []), date])] });
  }
  await db.blocks.update(blockId, { detachedFromSeries: true, updatedAt: Date.now() });
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/** Human summary of a rule, e.g. "Every 2 weeks on Mon, Wed". */
export function describeRule(rule: RecurringRule): string {
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const every = rule.interval === 1 ? 'Every' : `Every ${rule.interval}`;
  let base: string;
  if (rule.freq === 'daily') base = `${every} ${rule.interval === 1 ? 'day' : 'days'}`;
  else if (rule.freq === 'weekly') {
    const days = (rule.byWeekday.length ? rule.byWeekday : [dateKeyToDate(rule.startDate).getDay()])
      .slice().sort((a, b) => a - b).map((d) => WD[d]).join(', ');
    base = `${every} ${rule.interval === 1 ? 'week' : 'weeks'} on ${days}`;
  } else {
    const days = (rule.byMonthDay.length ? rule.byMonthDay : [dateKeyToDate(rule.startDate).getDate()]).join(', ');
    base = `${every} ${rule.interval === 1 ? 'month' : 'months'} on day ${days}`;
  }
  const limit = rule.endDate ? ` until ${rule.endDate}` : rule.count ? ` (${rule.count} times)` : '';
  const ex = rule.exceptions?.length ? ` · ${rule.exceptions.length} exception${rule.exceptions.length === 1 ? '' : 's'}` : '';
  return `${base}${limit}${ex}`;
}
