import { dateKeyToDate, diffDays } from '@/lib/date';
import { nextStreak } from '@/engines/xp';
import type { Habit, HabitCadence, TrackerColor } from '@/types';
import type { DemoContext } from './world';

/**
 * Habits with real check-in history.
 *
 * Each habit's stored `currentStreak` / `longestStreak` / `lastCheckinDate` are
 * REPLAYED through the same `nextStreak` function the live check-in path uses,
 * over the generated check-in dates. They are therefore exactly what the app
 * would have computed, not decorative numbers.
 */

interface HabitSeed {
  id: string;
  title: string;
  trackerId: string;
  goalId: string | null;
  cadence: HabitCadence;
  targetPerPeriod: number;
  targetValue: number | null;
  unit?: string;
  color: TrackerColor;
  /** Probability of checking in on an eligible day. */
  adherence: number;
  /** Restrict to these weekdays (0 = Sunday). Empty = any day. */
  weekdays: number[];
  minutes: [number, number];
}

const HABITS: HabitSeed[] = [
  {
    id: 'hab_demo_gym', title: 'Train at the gym', trackerId: 'trk_demo_strength',
    goalId: 'gol_demo_strength', cadence: 'weekly', targetPerPeriod: 3, targetValue: 1,
    unit: 'session', color: 'rose', adherence: 0.82, weekdays: [1, 3, 5], minutes: [45, 70],
  },
  {
    id: 'hab_demo_read', title: 'Read before bed', trackerId: 'trk_demo_reading',
    goalId: 'gol_demo_reading', cadence: 'daily', targetPerPeriod: 1, targetValue: 20,
    unit: 'pages', color: 'amber', adherence: 0.74, weekdays: [], minutes: [20, 40],
  },
  {
    id: 'hab_demo_journal', title: 'Journal for five minutes', trackerId: 'trk_demo_journal',
    goalId: null, cadence: 'daily', targetPerPeriod: 1, targetValue: 1,
    unit: 'entry', color: 'stone', adherence: 0.62, weekdays: [], minutes: [5, 12],
  },
  {
    id: 'hab_demo_mobility', title: 'Morning stretch', trackerId: 'trk_demo_mobility',
    goalId: null, cadence: 'daily', targetPerPeriod: 1, targetValue: 10,
    unit: 'minutes', color: 'lime', adherence: 0.55, weekdays: [], minutes: [8, 15],
  },
  {
    id: 'hab_demo_guitar', title: 'Practise guitar', trackerId: 'trk_demo_guitar',
    goalId: 'gol_demo_guitar', cadence: 'weekly', targetPerPeriod: 4, targetValue: 1,
    unit: 'session', color: 'violet', adherence: 0.48, weekdays: [], minutes: [15, 40],
  },
  {
    id: 'hab_demo_water', title: 'Two litres of water', trackerId: 'trk_personal',
    goalId: null, cadence: 'daily', targetPerPeriod: 1, targetValue: 2,
    unit: 'litres', color: 'sky', adherence: 0.68, weekdays: [], minutes: [0, 0],
  },
];

export function seedHabits(ctx: DemoContext): void {
  for (const seed of HABITS) {
    const createdAt = ctx.at(ctx.day(-60), 8 * 60);
    let currentStreak = 0;
    let longestStreak = 0;
    let lastCheckinDate: string | null = null;

    for (const day of [...ctx.pastDays, ctx.today]) {
      const weekday = dateKeyToDate(day).getDay();
      if (seed.weekdays.length > 0 && !seed.weekdays.includes(weekday)) continue;
      // The first three weeks were rockier than the last five — that shape is
      // what makes the streak history contain a real break and recovery.
      const age = diffDays(day, ctx.today);
      const adherence = age > 40 ? seed.adherence - 0.18 : seed.adherence;
      if (!ctx.rng.chance(adherence)) continue;

      const minutes = seed.minutes[1] > 0 ? ctx.rng.int(seed.minutes[0], seed.minutes[1]) : 0;
      const at = ctx.at(day, ctx.rng.int(6, 22) * 60 + ctx.rng.int(0, 59));

      const step = nextStreak(currentStreak, longestStreak, lastCheckinDate, day, diffDays);
      currentStreak = step.currentStreak;
      longestStreak = step.longestStreak;
      lastCheckinDate = day;

      ctx.world.activities.push({
        id: ctx.id('act'),
        createdAt: at,
        updatedAt: at,
        type: 'habit_checkin',
        at,
        date: day,
        trackerId: seed.trackerId,
        taskId: null,
        goalId: seed.goalId,
        blockId: null,
        sessionId: null,
        paperId: null,
        revisionEntryId: null,
        habitId: seed.id,
        resourceId: null,
        durationMs: minutes * 60_000,
        value: seed.targetValue ?? 1,
        unit: seed.unit ?? null,
        title: seed.title,
        meta: { cadence: seed.cadence },
      });
    }

    const habit: Habit = {
      id: seed.id,
      createdAt,
      updatedAt: ctx.now,
      title: seed.title,
      trackerId: seed.trackerId,
      goalId: seed.goalId,
      cadence: seed.cadence,
      targetPerPeriod: seed.targetPerPeriod,
      targetValue: seed.targetValue,
      unit: seed.unit,
      archived: false,
      currentStreak,
      longestStreak,
      lastCheckinDate,
      color: seed.color,
    };
    ctx.world.habits.push(habit);
  }
}
