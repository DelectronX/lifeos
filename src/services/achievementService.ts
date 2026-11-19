import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey, diffDays, dateKeyToDate, monthKey, startOfWeekKey, addDaysToKey } from '@/lib/date';
import { levelProgress } from '@/engines/xp';
import { mintForXP } from './currencyService';
import { getSchedulingConfig } from './settingsService';
import { logActivity } from './activityService';
import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_STAT_KEYS,
  ACHIEVEMENT_STAT_LABELS,
  ACHIEVEMENT_STAT_UNITS,
  type AchievementDefinition,
  type AchievementStatKey,
  type AchievementStats,
} from '@/config/achievements';
import {
  evaluateCondition, isLeaf, isValidCondition,
  type Condition, type DailyMetricPoint, type MetricMeta, type MetricSource,
} from '@/engines/conditionEngine';
import {
  buildContext, collectMetricKeys, isCustomMetricKey, readCustomMetric,
  type CustomMetricContext, type CustomMetricInput,
} from '@/engines/customMetrics';
import type {
  Achievement, AchievementCategory, Activity, CycleDefinition, Goal, Habit, Paper, Pillar, QuestionAttempt,
  RevisionEntry, ScheduleBlock, Task, TimerSession, Tracker, UserProfile,
} from '@/types';

/**
 * AchievementEngine + its persistence.
 *
 * Every achievement is a threshold on ONE measurable stat derived from stored
 * records — there are no participation trophies and nothing is awarded for
 * merely creating something. `computeStats` is the whole vocabulary: if a
 * number cannot be counted from the Activity log, TimerSessions, Tasks, Papers,
 * RevisionEntries, Habits, ScheduleBlocks or the profile, no achievement (and
 * no custom reward) can depend on it.
 */

export interface AchievementSourceData {
  activities: readonly Activity[];
  tasks: readonly Task[];
  sessions: readonly TimerSession[];
  papers: readonly Paper[];
  attempts: readonly QuestionAttempt[];
  blocks: readonly ScheduleBlock[];
  profile: UserProfile | undefined;
  level: number;
  /** trackerId -> root pillar. Resolved by the caller so nesting is honoured. */
  pillarByTracker: Readonly<Record<string, Pillar>>;
  /** Phase 9: needed for revision depth stats. Defaults to empty. */
  revisionEntries?: readonly RevisionEntry[];
  /** Phase 9: needed for per-habit streak stats. Defaults to empty. */
  habits?: readonly Habit[];
  /** Reference day used for "is this still overdue" questions. */
  today?: string;
}

/** Walks every tracker up to its root and records the owning pillar. */
export function buildPillarLookup(trackers: readonly Tracker[]): Record<string, Pillar> {
  const byId = new Map(trackers.map((t) => [t.id, t]));
  const out: Record<string, Pillar> = {};
  for (const t of trackers) {
    let cur = t;
    let guard = 0;
    while (cur.parentId && guard++ < 32) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    out[t.id] = cur.pillar;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const MIN_SESSION_MINUTES_FOR_TIME_OF_DAY = 15;
const UNINTERRUPTED_MIN_MINUTES = 25;
const DEEP_FOCUS_DAY_MINUTES = 120;
const PLAN_ADHERENCE_MIN_BLOCKS = 3;
const PLAN_ADHERENCE_RATIO = 0.8;
const ESTIMATE_TOLERANCE = 0.2;
const CLEAN_PAPER_MIN_QUESTIONS = 10;
const COMEBACK_MIN_GAP_DAYS = 2;
const COMEBACK_MIN_RUN_DAYS = 5;
const MISTAKE_TREND_SAMPLE = 5;

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function maxOf(values: Iterable<number>): number {
  let best = 0;
  for (const v of values) if (v > best) best = v;
  return best;
}

/** Accumulates a per-day, per-metric matrix used by the reward condition engine. */
class DailyAccumulator {
  private readonly days = new Map<string, Map<string, number>>();

  add(date: string, metric: AchievementStatKey, amount: number): void {
    if (!date || amount === 0) return;
    const row = this.days.get(date) ?? new Map<string, number>();
    row.set(metric, (row.get(metric) ?? 0) + amount);
    this.days.set(date, row);
  }

  set(date: string, metric: AchievementStatKey, value: number): void {
    if (!date) return;
    const row = this.days.get(date) ?? new Map<string, number>();
    row.set(metric, value);
    this.days.set(date, row);
  }

  get(date: string, metric: AchievementStatKey): number {
    return this.days.get(date)?.get(metric) ?? 0;
  }

  dates(): string[] {
    return [...this.days.keys()].sort();
  }

  toPoints(): DailyMetricPoint[] {
    return this.dates().map((date) => ({
      date,
      values: Object.fromEntries(this.days.get(date) ?? []),
    }));
  }
}

/* ------------------------------------------------------------------ */
/* Stat computation (pure)                                             */
/* ------------------------------------------------------------------ */

export interface StatComputation {
  stats: AchievementStats;
  /** Per-day samples for every day-bucketable metric. */
  daily: DailyMetricPoint[];
}

/**
 * Computes every measurable stat AND the per-day series behind it in one pass.
 * `computeStats` is the thin wrapper most callers want.
 */
export function computeStatsDetailed(data: AchievementSourceData): StatComputation {
  const { activities, tasks, sessions, papers, attempts, blocks, profile } = data;
  const revisionEntries = data.revisionEntries ?? [];
  const habits = data.habits ?? [];
  const today = data.today ?? toDateKey(Date.now());
  const pillarOf = (trackerId: string): Pillar | null => data.pillarByTracker[trackerId] ?? null;
  const daily = new DailyAccumulator();

  /* --- sessions / focus ------------------------------------------------ */
  let studyMinutes = 0;
  let fitnessMinutes = 0;
  let skillsMinutes = 0;
  let personalMinutes = 0;
  let focusMinutes = 0;
  let earlyBirdSessions = 0;
  let nightOwlSessions = 0;
  let uninterruptedSessions = 0;
  let sessionsCompleted = 0;

  for (const s of sessions) {
    const minutes = s.workMs / 60_000;
    focusMinutes += minutes;
    daily.add(s.date, 'focusMinutes', minutes);

    switch (pillarOf(s.trackerId)) {
      case 'study': studyMinutes += minutes; daily.add(s.date, 'studyMinutes', minutes); break;
      case 'fitness': fitnessMinutes += minutes; daily.add(s.date, 'fitnessMinutes', minutes); break;
      case 'skills': skillsMinutes += minutes; daily.add(s.date, 'skillsMinutes', minutes); break;
      case 'personal': personalMinutes += minutes; daily.add(s.date, 'personalMinutes', minutes); break;
      default: break;
    }

    if (s.pomodoroCount > 0) daily.add(s.date, 'pomodorosCompleted', s.pomodoroCount);
    daily.set(s.date, 'longestSessionMinutes', Math.max(daily.get(s.date, 'longestSessionMinutes'), minutes));

    if (minutes >= MIN_SESSION_MINUTES_FOR_TIME_OF_DAY) {
      const hour = new Date(s.startedAt).getHours();
      if (hour < 7) { earlyBirdSessions++; daily.add(s.date, 'earlyBirdSessions', 1); }
      if (hour >= 22) { nightOwlSessions++; daily.add(s.date, 'nightOwlSessions', 1); }
    }
    if (minutes >= UNINTERRUPTED_MIN_MINUTES && s.interruptions === 0) {
      uninterruptedSessions++;
      daily.add(s.date, 'uninterruptedSessions', 1);
    }
    if (s.completed && s.workMs > 0) {
      sessionsCompleted++;
      daily.add(s.date, 'sessionsCompleted', 1);
    }
  }

  const focusByDay = new Map<string, number>();
  for (const date of daily.dates()) {
    const mins = daily.get(date, 'focusMinutes');
    if (mins > 0) focusByDay.set(date, mins);
  }
  const longestDailyFocusMinutes = maxOf(focusByDay.values());
  let deepFocusDays = 0;
  for (const [date, mins] of focusByDay) {
    daily.set(date, 'longestDailyFocusMinutes', mins);
    if (mins >= DEEP_FOCUS_DAY_MINUTES) {
      deepFocusDays++;
      daily.set(date, 'deepFocusDays', 1);
    }
  }

  /* --- tasks ------------------------------------------------------------ */
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const tasksOnTime = completedTasks.filter(
    (t) => t.dueDate !== null && t.completedAt !== null && diffDays(toDateKey(t.completedAt), t.dueDate) >= 0,
  ).length;

  let tasksHighPriority = 0;
  let planAccurateTasks = 0;
  const tasksByDay = new Map<string, number>();

  for (const t of completedTasks) {
    const date = t.completedAt !== null ? toDateKey(t.completedAt) : null;
    if (date) {
      bump(tasksByDay, date);
      daily.add(date, 'tasksCompleted', 1);
      if (t.dueDate !== null && diffDays(date, t.dueDate) >= 0) daily.add(date, 'tasksOnTime', 1);
    }
    if (t.basePriority >= 4) {
      tasksHighPriority++;
      if (date) daily.add(date, 'tasksHighPriority', 1);
    }
    if (t.estimatedMinutes > 0 && t.actualMinutes > 0) {
      const drift = Math.abs(t.actualMinutes - t.estimatedMinutes) / t.estimatedMinutes;
      if (drift <= ESTIMATE_TOLERANCE) {
        planAccurateTasks++;
        if (date) daily.add(date, 'planAccurateTasks', 1);
      }
    }
  }
  const bestTaskDay = maxOf(tasksByDay.values());
  for (const [date, count] of tasksByDay) daily.set(date, 'bestTaskDay', count);

  const longestSessionMinutes = sessions.length
    ? Math.max(...sessions.map((s) => s.workMs / 60_000))
    : 0;
  const pomodorosCompleted = sessions.reduce((s, x) => s + x.pomodoroCount, 0);

  /* --- papers & questions ---------------------------------------------- */
  const submittedPapers = papers
    .filter((p) => p.status === 'submitted' || p.status === 'reviewed')
    .slice()
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  const answered = attempts.filter((a) => a.status === 'correct' || a.status === 'incorrect');
  const questionsCorrect = answered.filter((a) => a.status === 'correct').length;
  const distinctSubjectsExamined = new Set(answered.map((a) => a.trackerId)).size;

  const attemptsByPaper = new Map<string, QuestionAttempt[]>();
  for (const a of answered) {
    const list = attemptsByPaper.get(a.paperId) ?? [];
    list.push(a);
    attemptsByPaper.set(a.paperId, list);
  }

  let bestPaperAccuracy = 0;
  let papersImproved = 0;
  let cleanPapers = 0;
  let previousAccuracy: number | null = null;
  const paperAccuracies: number[] = [];

  for (const p of submittedPapers) {
    daily.add(p.date, 'papersSubmitted', 1);
    const list = attemptsByPaper.get(p.id) ?? [];
    if (list.length === 0) continue;
    const correct = list.filter((a) => a.status === 'correct').length;
    const acc = (correct / list.length) * 100;
    paperAccuracies.push(acc);
    if (acc > bestPaperAccuracy) bestPaperAccuracy = acc;
    daily.set(p.date, 'bestPaperAccuracy', Math.max(daily.get(p.date, 'bestPaperAccuracy'), acc));
    daily.add(p.date, 'questionsAttempted', list.length);
    daily.add(p.date, 'questionsCorrect', correct);
    if (previousAccuracy !== null && acc > previousAccuracy) {
      papersImproved++;
      daily.add(p.date, 'papersImproved', 1);
    }
    previousAccuracy = acc;
    if (list.length >= CLEAN_PAPER_MIN_QUESTIONS && correct === list.length) {
      cleanPapers++;
      daily.add(p.date, 'cleanPapers', 1);
    }
  }

  // Error-rate trend: earliest N scored papers versus the latest N. Needs two
  // disjoint samples, otherwise the comparison would be measuring itself.
  let mistakeRateImprovement = 0;
  if (paperAccuracies.length >= MISTAKE_TREND_SAMPLE * 2) {
    const early = paperAccuracies.slice(0, MISTAKE_TREND_SAMPLE);
    const late = paperAccuracies.slice(-MISTAKE_TREND_SAMPLE);
    const errEarly = 100 - early.reduce((a, b) => a + b, 0) / early.length;
    const errLate = 100 - late.reduce((a, b) => a + b, 0) / late.length;
    mistakeRateImprovement = Math.max(0, errEarly - errLate);
  }

  /* --- revision --------------------------------------------------------- */
  const revisionActivities = activities.filter((a) => a.type === 'revision_completed');
  const revisionsOnTime = revisionActivities.filter((a) => a.meta?.onTime === true).length;
  const completedRevisions = revisionEntries.filter((e) => e.status === 'completed');
  const distinctTopicsRevised = new Set(completedRevisions.map((e) => e.planId)).size;
  const revisionQualityHigh = completedRevisions.filter((e) => (e.quality ?? 0) >= 4).length;
  for (const e of completedRevisions) {
    if (e.completedAt === null) continue;
    const date = toDateKey(e.completedAt);
    if ((e.quality ?? 0) >= 4) daily.add(date, 'revisionQualityHigh', 1);
  }

  /* --- activity-log counters -------------------------------------------- */
  const activeDates = new Set(activities.map((a) => a.date));
  const milestoneActivities = activities.filter((a) => a.type === 'milestone_completed');
  const habitCheckinActivities = activities.filter((a) => a.type === 'habit_checkin');

  for (const a of activities) {
    daily.set(a.date, 'activeDays', 1);
    switch (a.type) {
      case 'revision_completed':
        daily.add(a.date, 'revisionsCompleted', 1);
        if (a.meta?.onTime === true) daily.add(a.date, 'revisionsOnTime', 1);
        break;
      case 'goal_completed': daily.add(a.date, 'goalsCompleted', 1); break;
      case 'milestone_completed': daily.add(a.date, 'milestonesCompleted', 1); break;
      case 'habit_checkin': daily.add(a.date, 'habitCheckins', 1); break;
      case 'daily_review': daily.add(a.date, 'dailyReviews', 1); break;
      case 'weekly_review': daily.add(a.date, 'weeklyReviews', 1); break;
      default: break;
    }
  }

  const milestonesByMonth = new Map<string, number>();
  for (const a of milestoneActivities) bump(milestonesByMonth, monthKey(a.date));
  const bestMilestoneMonth = maxOf(milestonesByMonth.values());

  const distinctHabits = new Set(
    habitCheckinActivities.map((a) => a.habitId).filter((id): id is string => Boolean(id)),
  ).size;
  const habitLongestStreak = maxOf(habits.map((h) => h.longestStreak));

  /* --- pillar spread ----------------------------------------------------- */
  const perDayPillars = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!a.trackerId || a.durationMs <= 0) continue;
    const pillar = pillarOf(a.trackerId);
    if (!pillar || pillar === 'system') continue;
    const set = perDayPillars.get(a.date) ?? new Set<string>();
    set.add(pillar);
    perDayPillars.set(a.date, set);
  }
  const bestPillarSpread = maxOf([...perDayPillars.values()].map((s) => s.size));
  for (const [date, set] of perDayPillars) daily.set(date, 'bestPillarSpread', set.size);

  /* --- blocks: perfect days, adherence ----------------------------------- */
  const blocksByDay = new Map<string, ScheduleBlock[]>();
  let blocksCompleted = 0;
  for (const b of blocks) {
    if (b.status === 'completed') {
      blocksCompleted++;
      daily.add(b.date, 'blocksCompleted', 1);
    }
    if (b.protected || b.optional || b.kind === 'sleep' || b.kind === 'meal' || b.kind === 'break' || b.kind === 'buffer') continue;
    const list = blocksByDay.get(b.date) ?? [];
    list.push(b);
    blocksByDay.set(b.date, list);
  }

  let perfectDays = 0;
  let planAdherenceDays = 0;
  for (const [date, list] of blocksByDay) {
    if (list.length > 0 && list.every((b) => b.status === 'completed')) {
      perfectDays++;
      daily.set(date, 'perfectDays', 1);
    }
    if (list.length >= PLAN_ADHERENCE_MIN_BLOCKS) {
      const planned = list.reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
      const done = list
        .filter((b) => b.status === 'completed')
        .reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
      if (planned > 0 && done / planned >= PLAN_ADHERENCE_RATIO) {
        planAdherenceDays++;
        daily.set(date, 'planAdherenceDays', 1);
      }
    }
  }

  /* --- overdue-free days -------------------------------------------------- */
  const zeroOverdueDays = countZeroOverdueDays(tasks, activeDates, today, daily);

  /* --- weekend & week-shape consistency ----------------------------------- */
  const sortedActive = [...activeDates].sort();
  let weekendActiveDays = 0;
  for (const date of sortedActive) {
    const day = dateKeyToDate(date).getDay();
    if (day === 0 || day === 6) {
      weekendActiveDays++;
      daily.set(date, 'weekendActiveDays', 1);
    }
  }

  const weeks = new Map<string, Set<number>>();
  for (const date of sortedActive) {
    const wk = startOfWeekKey(date, 1);
    const set = weeks.get(wk) ?? new Set<number>();
    set.add(dateKeyToDate(date).getDay());
    weeks.set(wk, set);
  }
  let fullWeeks = 0;
  let weekendConsistencyWeeks = 0;
  for (const set of weeks.values()) {
    if (set.size === 7) fullWeeks++;
    if (set.has(0) && set.has(6)) weekendConsistencyWeeks++;
  }

  const comebacks = countComebacks(sortedActive);

  return {
    daily: daily.toPoints(),
    stats: {
      tasksCompleted: completedTasks.length,
      tasksOnTime,
      focusMinutes: Math.round(focusMinutes),
      studyMinutes: Math.round(studyMinutes),
      fitnessMinutes: Math.round(fitnessMinutes),
      skillsMinutes: Math.round(skillsMinutes),
      personalMinutes: Math.round(personalMinutes),
      pomodorosCompleted,
      longestSessionMinutes: Math.round(longestSessionMinutes),
      papersSubmitted: submittedPapers.length,
      questionsAttempted: answered.length,
      bestPaperAccuracy: Math.round(bestPaperAccuracy),
      revisionsCompleted: revisionActivities.length,
      revisionsOnTime,
      goalsCompleted: activities.filter((a) => a.type === 'goal_completed').length,
      milestonesCompleted: milestoneActivities.length,
      habitCheckins: habitCheckinActivities.length,
      currentStreak: profile?.currentStreak ?? 0,
      longestStreak: profile?.longestStreak ?? 0,
      activeDays: activeDates.size,
      perfectDays,
      dailyReviews: activities.filter((a) => a.type === 'daily_review').length,
      weeklyReviews: activities.filter((a) => a.type === 'weekly_review').length,
      bestPillarSpread,
      level: data.level,

      earlyBirdSessions,
      nightOwlSessions,
      uninterruptedSessions,
      sessionsCompleted,
      longestDailyFocusMinutes: Math.round(longestDailyFocusMinutes),
      deepFocusDays,
      weekendActiveDays,
      weekendConsistencyWeeks,
      fullWeeks,
      comebacks,
      zeroOverdueDays,
      bestTaskDay,
      tasksHighPriority,
      planAccurateTasks,
      planAdherenceDays,
      blocksCompleted,
      papersImproved,
      cleanPapers,
      questionsCorrect,
      distinctSubjectsExamined,
      mistakeRateImprovement: Math.round(mistakeRateImprovement),
      distinctTopicsRevised,
      revisionQualityHigh,
      bestMilestoneMonth,
      habitLongestStreak,
      distinctHabits,
    },
  };
}

export function computeStats(data: AchievementSourceData): AchievementStats {
  return computeStatsDetailed(data).stats;
}

/**
 * An active day counts as overdue-free when no task whose due date had already
 * passed was still open at the end of that day. Implemented as a running
 * balance over open/close events so it stays linear in the number of tasks.
 */
function countZeroOverdueDays(
  tasks: readonly Task[],
  activeDates: ReadonlySet<string>,
  today: string,
  daily: DailyAccumulator,
): number {
  const delta = new Map<string, number>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    if (t.status === 'cancelled' || t.status === 'skipped') continue;
    // Becomes overdue the day AFTER its due date.
    const opens = addDaysToKey(t.dueDate, 1);
    if (opens > today) continue;
    bump(delta, opens, 1);
    const closed = t.completedAt !== null ? toDateKey(t.completedAt) : null;
    if (closed !== null) {
      const closesOn = closed < opens ? opens : addDaysToKey(closed, 1);
      bump(delta, closesOn, -1);
    }
  }

  const marks = [...new Set([...delta.keys(), ...activeDates])].sort();
  let open = 0;
  let count = 0;
  for (const date of marks) {
    open += delta.get(date) ?? 0;
    if (activeDates.has(date) && open <= 0) {
      count++;
      daily.set(date, 'zeroOverdueDays', 1);
    }
  }
  return count;
}

/**
 * A comeback is a run of at least five consecutive active days that begins
 * after a gap of at least two idle days. The very first run does not count —
 * there was nothing to come back from.
 */
function countComebacks(sortedActive: readonly string[]): number {
  if (sortedActive.length === 0) return 0;
  let comebacks = 0;
  let runLength = 1;
  let runFollowsGap = false;
  let counted = false;

  for (let i = 1; i < sortedActive.length; i++) {
    const gap = diffDays(sortedActive[i - 1], sortedActive[i]);
    if (gap === 1) {
      runLength++;
    } else {
      runLength = 1;
      runFollowsGap = gap - 1 >= COMEBACK_MIN_GAP_DAYS;
      counted = false;
    }
    if (runFollowsGap && !counted && runLength >= COMEBACK_MIN_RUN_DAYS) {
      comebacks++;
      counted = true;
    }
  }
  return comebacks;
}

/* ------------------------------------------------------------------ */
/* Metric source for the reward condition engine                       */
/* ------------------------------------------------------------------ */

/** Metrics whose day samples take the largest value rather than a sum. */
const MAX_METRICS: ReadonlySet<AchievementStatKey> = new Set<AchievementStatKey>([
  'longestSessionMinutes', 'longestDailyFocusMinutes', 'bestTaskDay',
  'bestPillarSpread', 'bestPaperAccuracy',
]);

/** Metrics that only exist as an all-time figure; a window cannot narrow them. */
const SNAPSHOT_METRICS: ReadonlySet<AchievementStatKey> = new Set<AchievementStatKey>([
  'level', 'currentStreak', 'longestStreak', 'habitLongestStreak', 'distinctHabits',
  'distinctTopicsRevised', 'distinctSubjectsExamined', 'mistakeRateImprovement',
  'comebacks', 'fullWeeks', 'weekendConsistencyWeeks', 'bestMilestoneMonth',
]);

export const METRIC_META: Readonly<Record<string, MetricMeta>> = Object.fromEntries(
  ACHIEVEMENT_STAT_KEYS.map((key) => [
    key,
    SNAPSHOT_METRICS.has(key)
      ? ({ aggregation: 'snapshot', windowable: false } satisfies MetricMeta)
      : ({ aggregation: MAX_METRICS.has(key) ? 'max' : 'sum', windowable: true } satisfies MetricMeta),
  ]),
);

export const METRIC_LABELS: Readonly<Record<string, string>> = ACHIEVEMENT_STAT_LABELS;
export const METRIC_UNITS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ACHIEVEMENT_STAT_UNITS).filter(([, v]) => Boolean(v)) as [string, string][],
);

export function buildMetricSource(computation: StatComputation): MetricSource {
  return {
    totals: computation.stats as unknown as Record<string, number>,
    daily: computation.daily,
    meta: METRIC_META,
    weekStartsOn: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Progress + unlocking                                                */
/* ------------------------------------------------------------------ */

export interface AchievementView {
  definition: AchievementDefinition;
  record: Achievement;
  /** Raw measured value for the achievement's stat. */
  current: number;
  target: number;
  /** 0..1 */
  progress: number;
  unlocked: boolean;
  unlockedAt: number | null;
  /** e.g. "3 000 of 12 000 minutes" — always the real numbers. */
  progressLabel: string;
}

export function buildViews(
  stats: AchievementStats,
  records: readonly Achievement[],
  custom?: CustomEvaluationInput,
): AchievementView[] {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const builtinKeys = new Set(ACHIEVEMENT_DEFINITIONS.map((d) => d.key));
  const builtin = ACHIEVEMENT_DEFINITIONS.map((def) => {
    const record = byKey.get(def.key);
    const current = def.stat ? stats[def.stat] : 0;
    const target = def.target;
    const progress = target > 0 ? Math.min(1, current / target) : 0;
    const unlocked = Boolean(record?.unlockedAt) || current >= target;
    return {
      definition: def,
      record: record ?? draftRecord(def),
      current,
      target,
      progress,
      unlocked,
      unlockedAt: record?.unlockedAt ?? null,
      progressLabel: formatProgress(def, current, target),
    };
  });

  // Data-defined achievements: rows with a condition, evaluated generically.
  const customViews: AchievementView[] = [];
  if (custom) {
    for (const record of records) {
      if (record.source !== 'custom' || record.archived || builtinKeys.has(record.key) || !record.condition) continue;
      const def = definitionFromRecord(record);
      const { current, met } = measureCustom(def, stats, custom);
      const target = def.target;
      customViews.push({
        definition: def,
        record,
        current,
        target,
        progress: met ? 1 : target > 0 ? Math.min(1, current / target) : 0,
        unlocked: Boolean(record.unlockedAt) || met,
        unlockedAt: record.unlockedAt ?? null,
        progressLabel: formatProgress(def, current, target),
      });
    }
  }
  return [...builtin, ...customViews];
}

/** A stored custom achievement row IS its definition. */
export function definitionFromRecord(record: Achievement): AchievementDefinition {
  return {
    key: record.key,
    title: record.title,
    description: record.description,
    category: record.category,
    tier: record.tier,
    target: record.target,
    xpReward: record.xpReward,
    condition: record.condition,
    unit: record.unit,
    source: 'custom',
  };
}

export interface CustomEvaluationInput {
  context: CustomMetricContext;
  now: Date;
}

/**
 * Evaluates a data-defined condition. Leaves may reference any built-in stat
 * or any customMetrics key. `current` is the measured value for single-leaf
 * conditions, and the fraction of `target` reached for compound ones.
 */
export function measureCustom(
  def: AchievementDefinition,
  stats: AchievementStats,
  custom: CustomEvaluationInput,
): { current: number; met: boolean } {
  const condition = def.condition as Condition | undefined;
  if (!condition || typeof condition !== 'object') return { current: 0, met: false };
  const totals: Record<string, number> = { ...(stats as unknown as Record<string, number>) };
  for (const key of collectMetricKeys(condition)) {
    if (isCustomMetricKey(key)) totals[key] = readCustomMetric(key, custom.context) ?? 0;
  }
  const source: MetricSource = {
    totals,
    daily: [],
    meta: Object.fromEntries(Object.keys(totals).map((k) => [k, { aggregation: 'snapshot', windowable: false } as MetricMeta])),
  };
  const evaluation = evaluateCondition(condition, source, custom.now);
  if (isLeaf(condition)) {
    return { current: totals[condition.metric] ?? 0, met: evaluation.met };
  }
  return {
    current: evaluation.met ? def.target : Math.floor(evaluation.progress * def.target * 100) / 100,
    met: evaluation.met,
  };
}

function formatProgress(def: AchievementDefinition, current: number, target: number): string {
  if (!def.stat) {
    if (def.unit === 'minutes') return `${Math.floor(current / 60)}h of ${Math.round(target / 60)}h`;
    return `${Math.min(Math.floor(current), target)} of ${target}${def.unit ? ` ${def.unit}` : ''}`;
  }
  const isMinutes = def.stat.endsWith('Minutes');
  if (isMinutes) {
    return `${Math.round(current / 60)}h of ${Math.round(target / 60)}h`;
  }
  if (def.stat === 'bestPaperAccuracy') return `${Math.round(current)}% best (need ${target}%)`;
  if (def.stat === 'mistakeRateImprovement') return `${Math.round(current)} of ${target} points`;
  return `${Math.min(current, target)} of ${target}`;
}

function draftRecord(def: AchievementDefinition): Achievement {
  const now = Date.now();
  return {
    id: newId('ach'),
    createdAt: now,
    updatedAt: now,
    key: def.key,
    title: def.title,
    description: def.description,
    category: def.category,
    tier: def.tier,
    target: def.target,
    progress: 0,
    unlockedAt: null,
    xpReward: def.xpReward,
  };
}

/* ------------------------------------------------------------------ */
/* DB-backed evaluation                                                */
/* ------------------------------------------------------------------ */

export interface EvaluationResult {
  stats: AchievementStats;
  views: AchievementView[];
  /** Achievements that crossed their threshold on this run. */
  newlyUnlocked: AchievementView[];
  /** Metric source for the reward condition engine, from the same pass. */
  metrics: MetricSource;
}

/** Reads every record the stat engine needs, in one round of queries. */
export async function loadAchievementSource(): Promise<AchievementSourceData> {
  const [
    activities, tasks, sessions, papers, attempts, blocks, profile, trackers,
    revisionEntries, habits,
  ] = await Promise.all([
    db.activities.toArray(),
    db.tasks.toArray(),
    db.sessions.toArray(),
    db.papers.toArray(),
    db.attempts.toArray(),
    db.blocks.toArray(),
    db.profile.get('profile'),
    db.trackers.toArray(),
    db.revisionEntries.toArray(),
    db.habits.toArray(),
  ]);

  const config = (await getSchedulingConfig()).xp;
  const level = levelProgress(profile?.totalXP ?? 0, config).level;

  return {
    activities, tasks, sessions, papers, attempts, blocks, profile,
    level,
    pillarByTracker: buildPillarLookup(trackers),
    revisionEntries,
    habits,
    today: toDateKey(Date.now()),
  };
}

/** Fields whose change is worth a write — never `updatedAt` alone. */
function sameAchievement(a: Achievement | undefined, b: Achievement): boolean {
  return !!a && a.title === b.title && a.description === b.description && a.category === b.category
    && a.tier === b.tier && a.target === b.target && a.xpReward === b.xpReward
    && a.progress === b.progress && (a.unlockedAt ?? null) === (b.unlockedAt ?? null);
}

/**
 * READ-ONLY view of every achievement with live progress. Safe inside
 * `useLiveQuery`: it never writes, so it can't feed back into its own
 * subscription. A threshold crossed since the last sync is shown as reached
 * (`unlocked: true`) — the sync persists it moments later.
 */
export async function readAchievements(): Promise<EvaluationResult> {
  const source = await loadAchievementSource();
  const records = await db.achievements.toArray();
  const computation = computeStatsDetailed(source);
  const custom = records.some((r) => r.source === 'custom')
    ? { context: buildContext(await loadCustomMetricInput(source)), now: new Date() }
    : undefined;
  const views = buildViews(computation.stats, records, custom).map((v) => {
    const reached = v.definition.source === 'custom' ? v.unlocked : v.current >= v.target;
    return reached && !v.unlocked ? { ...v, unlocked: true } : v;
  });
  return { stats: computation.stats, views, newlyUnlocked: [], metrics: buildMetricSource(computation) };
}

// Serialises writers so two evaluations (e.g. a timer + a manual sync, or
// two quick completions) can never race the same unlock.
let evaluationChain: Promise<unknown> = Promise.resolve();

/**
 * Recomputes every stat from stored records, persists progress, and unlocks
 * anything that has crossed its threshold. Idempotent: an already-unlocked
 * achievement is never unlocked (or paid) twice, and rows are only written
 * when something meaningful changed. Calls are serialised.
 *
 * WRITES — never call this from inside a live query; use `readAchievements`.
 */
export function evaluateAchievements(): Promise<EvaluationResult> {
  const run = evaluationChain.then(evaluateAchievementsNow, evaluateAchievementsNow);
  evaluationChain = run.catch(() => undefined);
  return run;
}

async function evaluateAchievementsNow(): Promise<EvaluationResult> {
  const source = await loadAchievementSource();
  const records = await db.achievements.toArray();

  const computation = computeStatsDetailed(source);
  const stats = computation.stats;
  const custom = records.some((r) => r.source === 'custom')
    ? { context: buildContext(await loadCustomMetricInput(source)), now: new Date() }
    : undefined;
  const views = buildViews(stats, records, custom);

  const now = Date.now();
  const newlyUnlocked: AchievementView[] = [];
  const changed: Achievement[] = [];
  const unlocks: Array<{ view: AchievementView; record: Achievement }> = [];

  for (const view of views) {
    const existing = records.find((r) => r.key === view.definition.key);
    const reached = view.definition.source === 'custom' ? view.unlocked : view.current >= view.target;
    const justUnlocked = reached && !existing?.unlockedAt;
    const base = view.definition.source === 'custom' ? view.record : (existing ?? view.record);
    const next: Achievement = view.definition.source === 'custom'
      ? { ...base, progress: Math.min(view.current, view.target), unlockedAt: base.unlockedAt ?? (justUnlocked ? now : null) }
      : {
          ...base,
          // Definitions are the source of truth for copy + thresholds.
          title: view.definition.title,
          description: view.definition.description,
          category: view.definition.category,
          tier: view.definition.tier,
          target: view.definition.target,
          xpReward: view.definition.xpReward,
          progress: Math.min(view.current, view.target),
          unlockedAt: existing?.unlockedAt ?? (justUnlocked ? now : null),
        };
    if (!sameAchievement(existing, next)) changed.push({ ...next, updatedAt: now });
    if (justUnlocked) unlocks.push({ view, record: next });
  }

  if (changed.length) await db.achievements.bulkPut(changed);

  for (const { view, record } of unlocks) {
    // Claim the unlock atomically: if another tab/writer already logged it,
    // the activity row exists and we skip (no duplicate event, no double pay).
    const claimed = await db.transaction('rw', db.activities, async () => {
      const already = await db.activities.where('type').equals('achievement_unlocked')
        .filter((a) => (a.meta as { key?: string } | undefined)?.key === view.definition.key).first();
      if (already) return false;
      await logActivity({
        type: 'achievement_unlocked',
        at: now,
        title: view.definition.title,
        value: view.definition.xpReward,
        meta: {
          key: view.definition.key,
          category: view.definition.category,
          tier: view.definition.tier,
          measured: view.current,
          target: view.target,
        },
      });
      return true;
    });
    if (!claimed) continue;
    newlyUnlocked.push({ ...view, unlocked: true, unlockedAt: now, record });
    if (view.definition.xpReward > 0) await bankAchievementReward(view.definition, now);
  }

  return { stats, views: views.map((v) => (unlocks.some((u) => u.view === v) ? { ...v, unlocked: true, unlockedAt: now } : v)), newlyUnlocked, metrics: buildMetricSource(computation) };
}

/** Extra records the generic custom-metric families need. */
export async function loadCustomMetricInput(source: AchievementSourceData): Promise<CustomMetricInput> {
  const [goals, trackers, settings] = await Promise.all([
    db.goals.toArray(),
    db.trackers.toArray(),
    db.settings.get('settings'),
  ]);
  return {
    activities: source.activities,
    tasks: source.tasks,
    sessions: source.sessions,
    papers: source.papers,
    blocks: source.blocks,
    goals: goals as Goal[],
    trackerParents: Object.fromEntries((trackers as Tracker[]).map((t) => [t.id, t.parentId])),
    cycles: (settings?.cycles ?? []) as CycleDefinition[],
    totalXP: source.profile?.totalXP ?? 0,
    today: source.today ?? toDateKey(Date.now()),
  };
}

/** Measures the current metric source without writing anything. */
export async function measureMetrics(): Promise<MetricSource> {
  return buildMetricSource(computeStatsDetailed(await loadAchievementSource()));
}

/**
 * Achievement rewards vary per definition, so they cannot come from the flat
 * XP award table. They are banked as their own transaction, deduped by the
 * achievement key so re-evaluation can never pay twice.
 */
async function bankAchievementReward(def: AchievementDefinition, at: number): Promise<void> {
  const dedupeKey = `achievement_reward:achievement:${def.key}`;
  const config = (await getSchedulingConfig()).xp;
  // Ledger row + cached balance move together; the unique dedupeKey makes a
  // lost race a no-op instead of an uncaught ConstraintError.
  const tx = await db.transaction('rw', db.xp, db.profile, async () => {
    if (await db.xp.where('dedupeKey').equals(dedupeKey).first()) return null;
    const profile = await db.profile.get('profile');
    const balanceAfter = (profile?.totalXP ?? 0) + def.xpReward;
    const row = {
      id: newId('xp'), createdAt: at, updatedAt: at, at, date: toDateKey(at),
      amount: def.xpReward, reason: 'achievement_reward' as const, description: `Achievement: ${def.title}`,
      sourceType: 'achievement', sourceId: def.key, activityId: null, dedupeKey, balanceAfter,
    };
    await db.xp.add(row);
    if (profile) {
      await db.profile.update('profile', { totalXP: balanceAfter, level: levelProgress(balanceAfter, config).level, updatedAt: at });
    }
    return row;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.name === 'ConstraintError') return null;
    throw e;
  });
  // Achievement XP is real XP, so it mints reward currency like any other.
  if (tx) await mintForXP(tx, config.rewardCurrencyPerXP ?? 0);
}

/** Read-only view of every achievement with live progress. */
export async function listAchievements(): Promise<EvaluationResult> {
  return readAchievements();
}

export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = [
  'study', 'focus', 'mastery', 'revision', 'planning', 'goals',
  'consistency', 'fitness', 'skills', 'personal',
  'academic', 'projects', 'research', 'earning', 'discipline', 'meta',
];

export function groupByCategory(views: readonly AchievementView[]): {
  category: AchievementCategory;
  views: AchievementView[];
  unlocked: number;
}[] {
  return ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const list = views
      .filter((v) => v.definition.category === category)
      .sort((a, b) => a.definition.tier - b.definition.tier || b.progress - a.progress);
    return { category, views: list, unlocked: list.filter((v) => v.unlocked).length };
  }).filter((g) => g.views.length > 0);
}

/* ------------------------------------------------------------------ */
/* User-defined achievements                                           */
/* ------------------------------------------------------------------ */

export interface CustomAchievementInput {
  key: string;
  title: string;
  description: string;
  category: Achievement['category'];
  target: number;
  xpReward: number;
  tier?: 1 | 2 | 3;
  unit?: string;
  condition: unknown;
}

/** Problems with a custom achievement definition; empty when it is valid. */
export function customAchievementIssues(input: CustomAchievementInput): string[] {
  const issues: string[] = [];
  if (ACHIEVEMENT_DEFINITIONS.some((d) => d.key === input.key)) issues.push(`Key "${input.key}" is a built-in achievement.`);
  if (!isValidCondition(input.condition)) return [...issues, 'condition is not a valid condition tree.'];
  const known = new Set<string>(ACHIEVEMENT_STAT_KEYS);
  for (const metric of collectMetricKeys(input.condition as Condition)) {
    if (!known.has(metric) && !isCustomMetricKey(metric)) issues.push(`Unknown metric "${metric}".`);
  }
  return issues;
}

/**
 * Creates or redefines a custom achievement by key. Progress and unlock state
 * are earned, so an existing row keeps them; only the definition changes.
 * Unlocking still happens only through the normal evaluation of real activity.
 */
export async function upsertCustomAchievement(input: CustomAchievementInput): Promise<{ achievement: Achievement; created: boolean }> {
  const issues = customAchievementIssues(input);
  if (issues.length) throw new Error(issues.join(' '));
  const now = Date.now();
  const prev = await db.achievements.where('key').equals(input.key).first();
  const row: Achievement = {
    id: prev?.id ?? `ach_${input.key}`,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    key: input.key,
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category,
    tier: input.tier ?? 1,
    target: input.target,
    progress: prev?.progress ?? 0,
    unlockedAt: prev?.unlockedAt ?? null,
    xpReward: input.xpReward,
    source: 'custom',
    condition: input.condition as Condition,
    unit: input.unit,
    archived: false,
  };
  await db.achievements.put(row);
  return { achievement: row, created: !prev };
}
