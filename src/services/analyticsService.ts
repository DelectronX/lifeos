import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { addDaysToKey, isoWeekKey, startOfWeekKey, todayKey } from '@/lib/date';
import { getSchedulingConfig } from './settingsService';
import {
  computeAnalytics,
  computeDailyReview,
  computeWeeklyReview,
  type AnalyticsInput,
  type AnalyticsResult,
  type DailyReviewMetrics,
  type WeeklyReviewMetrics,
} from '@/engines/analytics';
import type { AnalyticsSnapshot, DateKey, ID, SchedulingConfig, Tracker } from '@/types';

/**
 * Analytics data access.
 *
 * Its only job is to load the records the pure AnalyticsEngine needs and hand
 * them over. No aggregation happens here — if a number appears in the UI it was
 * computed by the engine from these arrays, which is what makes every figure
 * traceable to stored records.
 */

export type AnalyticsRange = '7d' | '30d' | '90d' | 'week' | 'month' | 'all';

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  week: 'This week',
  month: 'This month',
  all: 'All time',
};

export interface ResolvedRange {
  from: DateKey;
  to: DateKey;
  label: string;
}

export function resolveRange(
  range: AnalyticsRange,
  today: DateKey = todayKey(),
  weekStartsOn: 0 | 1 = 1,
  earliest: DateKey | null = null,
): ResolvedRange {
  switch (range) {
    case '7d': return { from: addDaysToKey(today, -6), to: today, label: RANGE_LABELS['7d'] };
    case '30d': return { from: addDaysToKey(today, -29), to: today, label: RANGE_LABELS['30d'] };
    case '90d': return { from: addDaysToKey(today, -89), to: today, label: RANGE_LABELS['90d'] };
    case 'week': return { from: startOfWeekKey(today, weekStartsOn), to: today, label: RANGE_LABELS.week };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today, label: RANGE_LABELS.month };
    case 'all': return { from: earliest ?? addDaysToKey(today, -364), to: today, label: RANGE_LABELS.all };
  }
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Loads every record the engine needs for a window. Tasks/goals/plans are read
 * whole (they are small relative to the event log and are filtered by date
 * inside the engine); activities, blocks and sessions use their date indexes.
 */
export async function loadAnalyticsInput(from: DateKey, to: DateKey, now = new Date()): Promise<AnalyticsInput> {
  // Trends compare against the preceding window of equal length, so the load
  // reaches back twice the span.
  const span = Math.max(0, daysBetween(from, to));
  const loadFrom = addDaysToKey(from, -(span + 1));

  const [activities, blocks, sessions, tasks, papers, questions, attempts, goals, habits, revisionEntries, trackers] =
    await Promise.all([
      db.activities.where('date').between(loadFrom, to, true, true).toArray(),
      db.blocks.where('date').between(loadFrom, to, true, true).toArray(),
      db.sessions.where('date').between(loadFrom, to, true, true).toArray(),
      db.tasks.toArray(),
      db.papers.where('date').between(loadFrom, to, true, true).toArray(),
      db.questions.toArray(),
      db.attempts.toArray(),
      db.goals.toArray(),
      db.habits.toArray(),
      db.revisionEntries.toArray(),
      db.trackers.toArray(),
    ]);

  return {
    from, to, now,
    activities, blocks, sessions, tasks, papers, questions, attempts,
    goals, habits, revisionEntries, trackers,
  };
}

export async function computeAnalyticsFor(
  from: DateKey,
  to: DateKey,
  now = new Date(),
): Promise<{ input: AnalyticsInput; result: AnalyticsResult; config: SchedulingConfig }> {
  const config = await getSchedulingConfig();
  const input = await loadAnalyticsInput(from, to, now);
  return { input, result: computeAnalytics(input, config), config };
}

/* ------------------------------------------------------------------ */
/* Live hooks                                                          */
/* ------------------------------------------------------------------ */

export interface AnalyticsBundle {
  input: AnalyticsInput;
  result: AnalyticsResult;
}

/** Live analytics for a date window. Re-runs whenever any source table changes. */
export function useAnalytics(from: DateKey, to: DateKey): AnalyticsBundle | undefined {
  return useLiveQuery(async () => {
    const { input, result } = await computeAnalyticsFor(from, to);
    return { input, result };
  }, [from, to]);
}

export function useAnalyticsRange(range: AnalyticsRange): ResolvedRange {
  const today = todayKey();
  return useMemo(() => resolveRange(range, today), [range, today]);
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export interface TrackerPlanActualRow {
  trackerId: ID;
  label: string;
  color: Tracker['color'];
  plannedMinutes: number;
  actualMinutes: number;
}

/**
 * Joins the engine's per-tracker *actual* minutes with the planned minutes held
 * on ScheduleBlocks for the same window. Both sides already exist — this only
 * pairs them up by tracker id so the UI does not have to.
 */
export function selectPlanVsActualByTracker(
  input: AnalyticsInput,
  result: AnalyticsResult,
): TrackerPlanActualRow[] {
  const trackers = new Map(input.trackers.map((t) => [t.id, t]));
  const planned = new Map<string, number>();
  for (const b of input.blocks) {
    if (b.date < input.from || b.date > input.to) continue;
    if (b.status === 'cancelled') continue;
    planned.set(b.trackerId, (planned.get(b.trackerId) ?? 0) + (b.end - b.start) / 60_000);
  }

  const actual = new Map<string, number>(
    result.time.distribution.byTracker.map((r) => [r.id, r.minutes]),
  );

  const ids = new Set<string>([...planned.keys(), ...actual.keys()]);
  return [...ids]
    .map((id) => ({
      trackerId: id,
      label: trackers.get(id)?.name ?? 'Unknown tracker',
      color: trackers.get(id)?.color ?? 'slate',
      plannedMinutes: Math.round(planned.get(id) ?? 0),
      actualMinutes: Math.round(actual.get(id) ?? 0),
    }))
    .filter((r) => r.plannedMinutes > 0 || r.actualMinutes > 0)
    .sort((a, b) => b.actualMinutes + b.plannedMinutes - (a.actualMinutes + a.plannedMinutes));
}

/* ------------------------------------------------------------------ */
/* Review data                                                         */
/* ------------------------------------------------------------------ */

export async function loadDailyReview(date: DateKey): Promise<DailyReviewMetrics> {
  const input = await loadAnalyticsInput(date, date);
  const xpRows = await db.xp.where('date').equals(date).toArray();
  const xpEarned = xpRows.reduce((s, t) => s + t.amount, 0);
  return computeDailyReview(input, date, xpEarned);
}

export function useDailyReview(date: DateKey): DailyReviewMetrics | undefined {
  return useLiveQuery(() => loadDailyReview(date), [date]);
}

export async function loadWeeklyReview(from: DateKey, to: DateKey): Promise<WeeklyReviewMetrics> {
  const input = await loadAnalyticsInput(from, to);
  return computeWeeklyReview(input);
}

export function useWeeklyReview(from: DateKey, to: DateKey): WeeklyReviewMetrics | undefined {
  return useLiveQuery(() => loadWeeklyReview(from, to), [from, to]);
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/**
 * Caches a period's headline metrics so long-range views do not have to replay
 * the whole event log. Snapshots are derived data: they are always safe to
 * delete and are recomputed on demand.
 */
export async function writeSnapshot(scope: AnalyticsSnapshot['scope'], periodKey: string, from: DateKey, to: DateKey): Promise<AnalyticsSnapshot> {
  const { result } = await computeAnalyticsFor(from, to);
  const now = Date.now();

  const byTracker: Record<string, number> = {};
  for (const row of result.overview.distribution.byTracker) byTracker[row.id] = row.minutes;

  const snapshot: AnalyticsSnapshot = {
    id: `snap_${scope}_${periodKey}`,
    createdAt: now,
    updatedAt: now,
    scope,
    periodKey,
    metrics: {
      totalMinutes: result.overview.totalMinutes,
      tasksCompleted: result.overview.completion.completed,
      tasksCreated: result.overview.completion.created,
      plannedMinutes: result.overview.plannedVsActual.plannedMinutes,
      blocksCompleted: result.overview.plannedVsActual.completedBlocks,
      studyMinutes: result.overview.distribution.pillarMinutes.study,
      fitnessMinutes: result.overview.distribution.pillarMinutes.fitness,
      skillsMinutes: result.overview.distribution.pillarMinutes.skills,
      personalMinutes: result.overview.distribution.pillarMinutes.personal,
      questionsAttempted: result.study.questionsAttempted,
      accuracy: Math.round(result.study.accuracy * 1000) / 1000,
      revisionsCompleted: result.study.revisionsCompleted,
      activeDays: result.overview.streak.activeDays,
    },
    byTracker,
    computedAt: now,
  };

  await db.snapshots.put(snapshot);
  return snapshot;
}

/** Rolls up yesterday and last ISO week. Safe to run repeatedly. */
export async function rollSnapshots(today: DateKey = todayKey()): Promise<string[]> {
  const written: string[] = [];
  const yesterday = addDaysToKey(today, -1);

  if (!(await db.snapshots.get(`snap_day_${yesterday}`))) {
    await writeSnapshot('day', yesterday, yesterday, yesterday);
    written.push(`day ${yesterday}`);
  }

  const lastWeekDay = addDaysToKey(today, -7);
  const weekStart = startOfWeekKey(lastWeekDay, 1);
  const weekKey = isoWeekKey(weekStart);
  if (!(await db.snapshots.get(`snap_week_${weekKey}`))) {
    await writeSnapshot('week', weekKey, weekStart, addDaysToKey(weekStart, 6));
    written.push(`week ${weekKey}`);
  }

  return written;
}

function daysBetween(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, (bm ?? 1) - 1, bd ?? 1) - Date.UTC(ay, (am ?? 1) - 1, ad ?? 1)) / 86_400_000);
}
