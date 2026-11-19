import { db } from '@/db/db';
import { addDaysToKey, startOfWeekKey } from '@/lib/date';
import { isRequiredBlock } from '@/engines/customMetrics';
import { getUiState, setUiState } from './settingsService';
import type { DateKey, ScheduleBlock } from '@/types';

/**
 * Burnout guard. Notices a run of hard days and OFFERS a lighter one — it
 * never changes anything on its own. A light day turns today's remaining
 * non-protected required blocks into optional ones, so skipping them does
 * not count as missed (protected blocks such as school are untouched).
 * Limited to one light day per week so it stays a safety valve, not a habit.
 */

export const MISSED_THRESHOLD = 3;
export const HARD_DAYS = 2;
const LIGHT_DAY_KEY = 'burnout.lightDays';

/** Required blocks that ended without being completed (skipped or never done). */
export function missedOn(blocks: readonly ScheduleBlock[], now: number): number {
  return blocks.filter((b) => isRequiredBlock(b) && b.end <= now && (b.status === 'skipped' || b.status === 'planned')).length;
}

export interface LoadAssessment {
  struggling: boolean;
  missedByDay: Array<{ date: DateKey; missed: number }>;
  lightDayAvailable: boolean;
  lightDayToday: boolean;
}

export async function assessLoad(today: DateKey, now = Date.now(), weekStartsOn: 0 | 1 = 1): Promise<LoadAssessment> {
  const missedByDay: LoadAssessment['missedByDay'] = [];
  for (let i = 1; i <= HARD_DAYS; i++) {
    const date = addDaysToKey(today, -i);
    missedByDay.push({ date, missed: missedOn(await db.blocks.where('date').equals(date).toArray(), now) });
  }
  const used = await getUiState<DateKey[]>(LIGHT_DAY_KEY, []);
  const week = startOfWeekKey(today, weekStartsOn);
  const usedThisWeek = used.some((d) => startOfWeekKey(d, weekStartsOn) === week);
  return {
    struggling: missedByDay.every((d) => d.missed >= MISSED_THRESHOLD),
    missedByDay,
    lightDayAvailable: !usedThisWeek,
    lightDayToday: used.includes(today),
  };
}

/** Makes the rest of today light. Returns how many blocks became optional. */
export async function makeLightDay(today: DateKey, now = Date.now()): Promise<number> {
  const blocks = await db.blocks.where('date').equals(today).toArray();
  const targets = blocks.filter((b) => isRequiredBlock(b) && !b.protected && b.status === 'planned' && b.end > now);
  for (const b of targets) await db.blocks.update(b.id, { optional: true, updatedAt: now });
  const used = await getUiState<DateKey[]>(LIGHT_DAY_KEY, []);
  await setUiState(LIGHT_DAY_KEY, [...used.filter((d) => d >= addDaysToKey(today, -60)), today]);
  return targets.length;
}
