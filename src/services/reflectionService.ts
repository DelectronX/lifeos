import { db } from '@/db/db';
import { buildActivity } from './activityService';
import { createTask } from './taskService';
import { addDaysToKey } from '@/lib/date';
import type { ID } from '@/types';
import { isRequiredBlock } from '@/engines/customMetrics';
import type { Activity, DateKey, ScheduleBlock } from '@/types';

/**
 * Daily reflection ("close the day"). Answers are stored as ONE
 * `daily_review` activity per date — re-saving replaces it — so they travel
 * with backups and feed analytics like any other real event. Saving a
 * reflection never awards XP by itself.
 */

export const REFLECTION_QUESTIONS = [
  { key: 'finished', label: 'What did I finish?' },
  { key: 'learned', label: 'What did I learn?' },
  { key: 'wrong', label: 'What went wrong / needs fixing?' },
  { key: 'priority', label: "Tomorrow's top priority" },
] as const;

export type ReflectionKey = (typeof REFLECTION_QUESTIONS)[number]['key'];

export interface DailyReflection {
  answers: Partial<Record<ReflectionKey, string>>;
  /** 1–5, optional. */
  energy?: number;
  mood?: number;
}

/** Required blocks of the day that are still open (not completed/skipped). */
export async function openRequiredBlocks(date: DateKey): Promise<ScheduleBlock[]> {
  const blocks = await db.blocks.where('date').equals(date).toArray();
  return blocks
    .filter((b) => isRequiredBlock(b) && (b.status === 'planned' || b.status === 'in_progress'))
    .sort((a, b) => a.start - b.start);
}

export async function getDailyReflection(date: DateKey): Promise<(DailyReflection & { savedAt: number }) | null> {
  const row = await findReview(date);
  if (!row) return null;
  const meta = row.meta as unknown as DailyReflection;
  return { answers: meta.answers ?? {}, energy: meta.energy, mood: meta.mood, savedAt: row.at };
}

export async function saveDailyReflection(date: DateKey, reflection: DailyReflection, at = Date.now()): Promise<void> {
  const prev = await findReview(date);
  if (prev) await db.activities.delete(prev.id);
  const row = buildActivity({
    type: 'daily_review',
    title: 'Daily reflection',
    at,
    value: reflection.energy ?? null,
    meta: { answers: reflection.answers, energy: reflection.energy ?? null, mood: reflection.mood ?? null },
  });
  // Belongs to the reviewed day even when saved after midnight.
  await db.activities.add({ ...row, date });
  await db.settings.update('settings', { lastDailyReviewDate: date, updatedAt: at });
}

async function findReview(date: DateKey): Promise<Activity | undefined> {
  return (await db.activities.where('date').equals(date).toArray()).find((a) => a.type === 'daily_review');
}

/* ------------------------------------------------------------------ */
/* Weekly review                                                       */
/* ------------------------------------------------------------------ */

export const WEEKLY_QUESTIONS = [
  { key: 'wins', label: 'What went well this week?' },
  { key: 'struggles', label: 'What did not work, and why?' },
  { key: 'change', label: 'One thing to change next week' },
] as const;

export type WeeklyKey = (typeof WEEKLY_QUESTIONS)[number]['key'];

export interface WeeklyPriority {
  title: string;
  trackerId: ID;
}

export interface WeeklyReflection {
  answers: Partial<Record<WeeklyKey, string>>;
  /** Next week's priorities — saved as real tasks due by the end of next week. */
  priorities: WeeklyPriority[];
}

async function findWeekly(weekStart: DateKey): Promise<Activity | undefined> {
  return (await db.activities.where('date').equals(weekStart).toArray())
    .find((a) => a.type === 'weekly_review');
}

export async function getWeeklyReflection(weekStart: DateKey): Promise<(WeeklyReflection & { taskIds: ID[] }) | null> {
  const row = await findWeekly(weekStart);
  if (!row) return null;
  const meta = row.meta as { answers?: WeeklyReflection['answers']; priorities?: WeeklyPriority[]; taskIds?: ID[] };
  return { answers: meta.answers ?? {}, priorities: meta.priorities ?? [], taskIds: meta.taskIds ?? [] };
}

/**
 * One weekly_review activity per week (keyed by the week's first day; saving
 * again replaces it). Priorities that were not turned into tasks before become
 * tasks due on the last day of NEXT week; already-created ones are not duplicated.
 */
export async function saveWeeklyReflection(weekStart: DateKey, review: WeeklyReflection, at = Date.now()): Promise<ID[]> {
  const prev = await getWeeklyReflection(weekStart);
  const prevRow = await findWeekly(weekStart);
  if (prevRow) await db.activities.delete(prevRow.id);

  const alreadyMade = new Set((prev?.priorities ?? []).map((p) => p.title.trim().toLowerCase()));
  const taskIds = [...(prev?.taskIds ?? [])];
  const due = addDaysToKey(weekStart, 13);
  for (const p of review.priorities) {
    const title = p.title.trim();
    if (!title || alreadyMade.has(title.toLowerCase())) continue;
    const task = await createTask({ title, trackerId: p.trackerId, dueDate: due, status: 'inbox', tags: ['weekly-priority'] });
    taskIds.push(task.id);
  }

  const row = buildActivity({
    type: 'weekly_review',
    title: 'Weekly review',
    at,
    meta: { answers: review.answers, priorities: review.priorities.filter((p) => p.title.trim()), taskIds },
  });
  await db.activities.add({ ...row, date: weekStart });
  await db.settings.update('settings', { lastWeeklyReviewDate: weekStart, updatedAt: at });
  return taskIds;
}
