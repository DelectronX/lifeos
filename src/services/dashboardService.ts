import { db } from '@/db/db';
import { checklistProgress, periodKeyFor } from '@/engines/workgrowth';
import { isRequiredBlock } from '@/engines/customMetrics';
import { sectionTasks } from './taskQuery';
import { todayKey } from '@/lib/date';
import type { DateKey } from '@/types';

export interface DayProgress {
  date: DateKey;
  blocks: { done: number; total: number };
  tasks: { done: number; total: number };
  checklists: { done: number; total: number };
  /** Share of all of the day's commitments completed (0..1), or null when there are none. */
  overall: number | null;
}

/**
 * A day's real completion across the three kinds of commitment: REQUIRED
 * schedule blocks, tasks due that day (incl. overdue + those completed that
 * day) and daily checklist items. The single implementation behind the Home
 * rings, the Daily Productivity widget and the agent `dashboard_get` /
 * `progress_get` operations, so they can never disagree.
 */
export async function getDayProgress(date: DateKey = todayKey()): Promise<DayProgress> {
  const [blocks, tasks, lists, runs] = await Promise.all([
    db.blocks.where('date').equals(date).toArray(),
    db.tasks.toArray(),
    db.checklists.filter((l) => l.active && l.cadence === 'daily').toArray(),
    db.checklistRuns.where('periodKey').equals(periodKeyFor('daily', date)).toArray(),
  ]);
  const required = blocks.filter(isRequiredBlock);
  const b = { done: required.filter((x) => x.status === 'completed').length, total: required.length };

  const sections = sectionTasks(tasks, date);
  const tasksDone = tasks.filter((t) => t.status === 'completed' && t.completedAt && todayKey(t.completedAt) === date).length;
  const openDue = [...sections.overdue, ...sections.today].filter((t) => t.status !== 'completed').length;
  const t = { done: tasksDone, total: tasksDone + openDue };

  let cDone = 0; let cTotal = 0;
  for (const l of lists) {
    const p = checklistProgress(l, runs.find((r) => r.checklistId === l.id), date);
    cDone += p.done; cTotal += p.total;
  }
  const c = { done: cDone, total: cTotal };
  const all = b.total + t.total + c.total;
  return { date, blocks: b, tasks: t, checklists: c, overall: all ? (b.done + t.done + c.done) / all : null };
}
