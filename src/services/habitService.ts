import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { diffDays, todayKey } from '@/lib/date';
import { logActivity } from './activityService';
import { awardXP } from './xpService';
import { recomputeGoalProgress } from './goalService';
import { nextStreak } from '@/engines/xp';
import type { DateKey, Habit, HabitCadence, ID, TrackerColor } from '@/types';

/**
 * Habits are check-in counters attached to a tracker (and optionally a goal).
 * Each check-in writes an Activity, so habit data flows into analytics, XP,
 * achievements and habit-type goal progress through the same universal path as
 * everything else — no parallel habit-only tables.
 */

export interface HabitDraft {
  title: string;
  trackerId: ID;
  goalId?: ID | null;
  cadence?: HabitCadence;
  targetPerPeriod?: number;
  targetValue?: number | null;
  unit?: string;
  color?: TrackerColor;
}

export async function createHabit(draft: HabitDraft): Promise<Habit> {
  const now = Date.now();
  const habit: Habit = {
    id: newId('hab'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    trackerId: draft.trackerId,
    goalId: draft.goalId ?? null,
    cadence: draft.cadence ?? 'daily',
    targetPerPeriod: Math.max(1, Math.round(draft.targetPerPeriod ?? 1)),
    targetValue: draft.targetValue ?? null,
    unit: draft.unit,
    archived: false,
    currentStreak: 0,
    longestStreak: 0,
    lastCheckinDate: null,
    color: draft.color,
  };
  await db.habits.add(habit);
  return habit;
}

export async function updateHabit(id: ID, patch: Partial<Habit>): Promise<void> {
  await db.habits.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteHabit(id: ID): Promise<void> {
  // Check-in history is real and stays in the activity log.
  await db.habits.delete(id);
}

export interface CheckinResult {
  habit: Habit;
  streak: number;
  xpAwarded: number;
  alreadyCheckedIn: boolean;
}

/**
 * Records a check-in. Repeated check-ins on the same day are allowed (some
 * habits have a target above one) but the streak only advances once per day.
 */
export async function checkIn(
  id: ID,
  options: { value?: number; minutes?: number; at?: number; notes?: string } = {},
): Promise<CheckinResult | null> {
  const habit = await db.habits.get(id);
  if (!habit) return null;

  const at = options.at ?? Date.now();
  const date = todayKey(at);
  const already = habit.lastCheckinDate === date;

  const streak = nextStreak(habit.currentStreak, habit.longestStreak, habit.lastCheckinDate, date, diffDays);
  await db.habits.update(id, {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    lastCheckinDate: date,
    updatedAt: at,
  });

  const activity = await logActivity({
    type: 'habit_checkin',
    at,
    title: habit.title,
    trackerId: habit.trackerId,
    goalId: habit.goalId,
    habitId: habit.id,
    durationMs: (options.minutes ?? 0) * 60_000,
    value: options.value ?? habit.targetValue ?? 1,
    unit: habit.unit ?? null,
    meta: { cadence: habit.cadence, notes: options.notes ?? null },
  });

  // One XP payout per habit per day — the dedupe key encodes the date, so a
  // second check-in today records the activity but earns nothing extra.
  const award = await awardXP(
    {
      reason: 'habit_checkin',
      sourceType: 'habit_day',
      sourceId: `${habit.id}:${date}`,
      minutes: options.minutes ?? 0,
      description: `Habit: ${habit.title}`,
    },
    { activityId: activity.id, at },
  );

  if (habit.goalId) await recomputeGoalProgress(habit.goalId);

  const updated = await db.habits.get(id);
  return {
    habit: updated ?? habit,
    streak: streak.currentStreak,
    xpAwarded: award.amount,
    alreadyCheckedIn: already,
  };
}

/** Removes today's check-in for a habit (mistaken tap). */
export async function undoCheckin(id: ID, date: DateKey = todayKey()): Promise<void> {
  const rows = await db.activities.where('habitId').equals(id).toArray();
  const todays = rows.filter((a) => a.type === 'habit_checkin' && a.date === date);
  if (todays.length === 0) return;

  // Drop the most recent one only — earlier check-ins that day still happened.
  const newest = todays.sort((a, b) => b.at - a.at)[0];
  await db.activities.delete(newest.id);

  const remaining = todays.length - 1;
  if (remaining === 0) {
    const habit = await db.habits.get(id);
    if (habit) {
      const previous = rows
        .filter((a) => a.type === 'habit_checkin' && a.date < date)
        .map((a) => a.date)
        .sort();
      const last = previous[previous.length - 1] ?? null;
      await db.habits.update(id, {
        lastCheckinDate: last,
        currentStreak: Math.max(0, habit.currentStreak - 1),
        updatedAt: Date.now(),
      });
    }
  }
}

export interface HabitStatus {
  habit: Habit;
  /** Check-ins inside the current period (day or ISO week). */
  periodCount: number;
  target: number;
  met: boolean;
  /** 0..1 within the current period. */
  progress: number;
  checkedInToday: boolean;
}

/** Current-period status for a set of habits, from the activity log. */
export async function getHabitStatuses(date: DateKey = todayKey()): Promise<HabitStatus[]> {
  const habits = (await db.habits.toArray()).filter((h) => !h.archived);
  const from = habits.some((h) => h.cadence === 'weekly') ? shiftDays(date, -6) : date;
  const activities = await db.activities.where('date').between(from, date, true, true).toArray();
  const checkins = activities.filter((a) => a.type === 'habit_checkin' && a.habitId);

  return habits.map((habit) => {
    const relevant = checkins.filter(
      (a) => a.habitId === habit.id && (habit.cadence === 'weekly' || a.date === date),
    );
    const target = Math.max(1, habit.targetPerPeriod);
    return {
      habit,
      periodCount: relevant.length,
      target,
      met: relevant.length >= target,
      progress: Math.min(1, relevant.length / target),
      checkedInToday: relevant.some((a) => a.date === date),
    };
  });
}

function shiftDays(date: DateKey, days: number): DateKey {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
