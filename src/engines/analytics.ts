import type {
  Activity, DateKey, Goal, Habit, ID, MistakeType, Paper, Pillar, Question,
  QuestionAttempt, RevisionEntry, ScheduleBlock, SchedulingConfig, Task, TaskType,
  TimerSession, Tracker,
} from '@/types';
import { addDaysToKey, dateKeyRange, diffDays, isoWeekKey, minuteOfDay, toDateKey } from '@/lib/date';
import { predictDurations, type DurationPrediction } from './durationPrediction';

/**
 * AnalyticsEngine — every number the Analytics module shows is computed here.
 *
 * Strictly pure: it takes plain arrays plus an explicit `now`, touches neither
 * Dexie nor React, and never reads the wall clock. That makes each aggregation
 * unit-testable and guarantees the UI cannot invent a figure that is not
 * derivable from stored records.
 *
 * The universal Activity log is the primary source of truth for *real* time;
 * ScheduleBlocks supply *planned* time; TimerSessions add per-session detail;
 * Papers/Questions/Attempts supply study accuracy; Goals/Habits/RevisionEntries
 * supply the remaining rollups.
 */

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface AnalyticsInput {
  /** Inclusive analysis window. */
  from: DateKey;
  to: DateKey;
  now: Date;
  activities: readonly Activity[];
  tasks: readonly Task[];
  blocks: readonly ScheduleBlock[];
  sessions: readonly TimerSession[];
  papers: readonly Paper[];
  questions: readonly Question[];
  attempts: readonly QuestionAttempt[];
  goals: readonly Goal[];
  habits: readonly Habit[];
  revisionEntries: readonly RevisionEntry[];
  trackers: readonly Tracker[];
}

/** Activity types that represent time actually spent, not bookkeeping. */
const TIME_ACTIVITY_TYPES = new Set([
  'timer_session', 'block_completed', 'task_completed', 'habit_checkin', 'revision_completed',
]);

/* ------------------------------------------------------------------ */
/* Small shared shapes                                                 */
/* ------------------------------------------------------------------ */

export interface NamedMinutes {
  id: ID;
  label: string;
  minutes: number;
  /** Share of the total, 0..1. 0 when the total is 0. */
  share: number;
  color?: Tracker['color'];
}

export interface DayPoint {
  date: DateKey;
  minutes: number;
  tasksCompleted: number;
  plannedMinutes: number;
  /** True when anything at all was recorded on this day. */
  active: boolean;
}

export interface TrendComparison {
  current: number;
  previous: number;
  /** current - previous. */
  delta: number;
  /** Percentage change; null when the previous period was zero. */
  percentChange: number | null;
  direction: 'up' | 'down' | 'flat';
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function minutesOf(activity: Activity): number {
  return activity.durationMs / 60_000;
}

function inRange(date: DateKey, from: DateKey, to: DateKey): boolean {
  return date >= from && date <= to;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Safe division that never yields NaN/Infinity. */
export function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

export function percent(numerator: number, denominator: number): number {
  return Math.round(ratio(numerator, denominator) * 1000) / 10;
}

function buildShares<T extends { minutes: number }>(rows: T[]): (T & { share: number })[] {
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return rows.map((r) => ({ ...r, share: ratio(r.minutes, total) }));
}

/** Root tracker (pillar owner) for any tracker id. Handles nesting + cycles. */
export function rootTrackerOf(trackerId: ID, byId: Map<ID, Tracker>): Tracker | undefined {
  let current = byId.get(trackerId);
  let guard = 0;
  while (current?.parentId && guard++ < 32) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function trackerIndex(trackers: readonly Tracker[]): Map<ID, Tracker> {
  return new Map(trackers.map((t) => [t.id, t]));
}

/* ------------------------------------------------------------------ */
/* Time distribution                                                   */
/* ------------------------------------------------------------------ */

export interface TimeDistribution {
  totalMinutes: number;
  byTracker: NamedMinutes[];
  byPillar: NamedMinutes[];
  /** Minutes recorded per top-level tracker id, for quick lookups. */
  pillarMinutes: Record<Pillar, number>;
}

export function computeTimeDistribution(
  activities: readonly Activity[],
  trackers: readonly Tracker[],
  from: DateKey,
  to: DateKey,
): TimeDistribution {
  const byId = trackerIndex(trackers);
  const perTracker = new Map<ID, number>();
  const perPillar: Record<Pillar, number> = { study: 0, fitness: 0, skills: 0, personal: 0, system: 0 };

  for (const a of activities) {
    if (!inRange(a.date, from, to)) continue;
    if (a.durationMs <= 0) continue;
    if (!TIME_ACTIVITY_TYPES.has(a.type)) continue;
    if (!a.trackerId) continue;
    const minutes = minutesOf(a);
    perTracker.set(a.trackerId, (perTracker.get(a.trackerId) ?? 0) + minutes);
    const root = rootTrackerOf(a.trackerId, byId);
    if (root) perPillar[root.pillar] += minutes;
  }

  const trackerRows = buildShares(
    [...perTracker.entries()]
      .map(([id, minutes]) => {
        const tracker = byId.get(id);
        return {
          id,
          label: tracker?.name ?? 'Unknown tracker',
          minutes: Math.round(minutes),
          color: tracker?.color,
        };
      })
      .sort((a, b) => b.minutes - a.minutes || (a.label < b.label ? -1 : 1)),
  );

  const pillarRows = buildShares(
    (Object.keys(perPillar) as Pillar[])
      .filter((p) => perPillar[p] > 0)
      .map((p) => ({ id: p, label: capitalise(p), minutes: Math.round(perPillar[p]) }))
      .sort((a, b) => b.minutes - a.minutes),
  );

  return {
    totalMinutes: Math.round([...perTracker.values()].reduce((s, m) => s + m, 0)),
    byTracker: trackerRows,
    byPillar: pillarRows,
    pillarMinutes: {
      study: Math.round(perPillar.study),
      fitness: Math.round(perPillar.fitness),
      skills: Math.round(perPillar.skills),
      personal: Math.round(perPillar.personal),
      system: Math.round(perPillar.system),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Daily series, streaks, active days                                  */
/* ------------------------------------------------------------------ */

export function computeDailySeries(
  activities: readonly Activity[],
  blocks: readonly ScheduleBlock[],
  from: DateKey,
  to: DateKey,
): DayPoint[] {
  const days = dateKeyRange(from, to);
  const minutes = new Map<DateKey, number>();
  const completed = new Map<DateKey, number>();
  const touched = new Set<DateKey>();
  const planned = new Map<DateKey, number>();

  for (const a of activities) {
    if (!inRange(a.date, from, to)) continue;
    touched.add(a.date);
    if (a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type)) {
      minutes.set(a.date, (minutes.get(a.date) ?? 0) + minutesOf(a));
    }
    if (a.type === 'task_completed') {
      completed.set(a.date, (completed.get(a.date) ?? 0) + 1);
    }
  }

  for (const b of blocks) {
    if (!inRange(b.date, from, to)) continue;
    if (b.status === 'cancelled' || b.protected) continue;
    planned.set(b.date, (planned.get(b.date) ?? 0) + (b.end - b.start) / 60_000);
  }

  return days.map((date) => ({
    date,
    minutes: Math.round(minutes.get(date) ?? 0),
    tasksCompleted: completed.get(date) ?? 0,
    plannedMinutes: Math.round(planned.get(date) ?? 0),
    active: touched.has(date),
  }));
}

export interface StreakSummary {
  /** Consecutive active days ending today (or yesterday if today is empty). */
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  totalDays: number;
  /** activeDays / totalDays, 0..1. */
  consistency: number;
  lastActiveDate: DateKey | null;
}

/**
 * Streak rule: consecutive calendar days with at least one activity. A streak
 * that ended yesterday still counts as current until today is over, otherwise
 * the number would drop to zero every midnight before the user has done
 * anything — which reads as punishment rather than information.
 */
export function computeStreaks(activeDates: readonly DateKey[], today: DateKey): StreakSummary {
  const unique = [...new Set(activeDates)].sort();
  if (unique.length === 0) {
    return { currentStreak: 0, longestStreak: 0, activeDays: 0, totalDays: 0, consistency: 0, lastActiveDate: null };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    run = diffDays(unique[i - 1], unique[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const last = unique[unique.length - 1];
  const gapFromToday = diffDays(last, today);
  let current = 0;
  if (gapFromToday <= 1) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i--) {
      if (diffDays(unique[i - 1], unique[i]) === 1) current++;
      else break;
    }
  }

  const span = diffDays(unique[0], today) + 1;
  return {
    currentStreak: current,
    longestStreak: longest,
    activeDays: unique.length,
    totalDays: Math.max(span, unique.length),
    consistency: ratio(unique.length, Math.max(span, unique.length)),
    lastActiveDate: last,
  };
}

/* ------------------------------------------------------------------ */
/* Planned vs actual                                                   */
/* ------------------------------------------------------------------ */

export interface PlannedVsActual {
  plannedMinutes: number;
  actualMinutes: number;
  /** actual / planned, 0 when nothing was planned. */
  adherence: number;
  plannedBlocks: number;
  completedBlocks: number;
  skippedBlocks: number;
  partialBlocks: number;
  blockCompletionRate: number;
  /** Days where every planned block ended completed. */
  perfectDays: number;
  summary: string;
}

export function computePlannedVsActual(
  blocks: readonly ScheduleBlock[],
  activities: readonly Activity[],
  from: DateKey,
  to: DateKey,
): PlannedVsActual {
  const scoped = blocks.filter(
    (b) => inRange(b.date, from, to) && !b.protected && b.kind !== 'sleep' && b.kind !== 'meal',
  );
  const plannedMinutes = scoped.reduce((s, b) => s + (b.end - b.start) / 60_000, 0);
  const actualMinutes = activities
    .filter((a) => inRange(a.date, from, to) && a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type))
    .reduce((s, a) => s + minutesOf(a), 0);

  const completed = scoped.filter((b) => b.status === 'completed').length;
  const skipped = scoped.filter((b) => b.status === 'skipped').length;
  const partial = scoped.filter((b) => b.status === 'partial').length;
  const decided = scoped.filter((b) => b.status !== 'planned' && b.status !== 'in_progress').length;

  // A perfect day needs at least one planned block and no unfinished ones.
  const byDay = new Map<DateKey, ScheduleBlock[]>();
  for (const b of scoped) {
    const list = byDay.get(b.date);
    if (list) list.push(b);
    else byDay.set(b.date, [b]);
  }
  let perfectDays = 0;
  for (const [, list] of byDay) {
    if (list.length > 0 && list.every((b) => b.status === 'completed')) perfectDays++;
  }

  const adherence = ratio(actualMinutes, plannedMinutes);
  return {
    plannedMinutes: Math.round(plannedMinutes),
    actualMinutes: Math.round(actualMinutes),
    adherence,
    plannedBlocks: scoped.length,
    completedBlocks: completed,
    skippedBlocks: skipped,
    partialBlocks: partial,
    blockCompletionRate: ratio(completed, decided),
    perfectDays,
    summary: scoped.length === 0
      ? 'Nothing was scheduled in this period, so there is no plan to compare against.'
      : `${Math.round(actualMinutes)} min recorded against ${Math.round(plannedMinutes)} min planned (${percent(actualMinutes, plannedMinutes)}%). ${completed} of ${scoped.length} blocks completed.`,
  };
}

/* ------------------------------------------------------------------ */
/* Task completion                                                     */
/* ------------------------------------------------------------------ */

export interface CompletionMetrics {
  created: number;
  completed: number;
  cancelled: number;
  skipped: number;
  open: number;
  overdue: number;
  completionRate: number;
  onTimeCompleted: number;
  onTimeRate: number;
  /** Median days between task creation and completion. */
  medianCycleDays: number | null;
  byType: { type: TaskType; completed: number; minutes: number }[];
}

export function computeCompletionMetrics(
  tasks: readonly Task[],
  from: DateKey,
  to: DateKey,
  today: DateKey,
): CompletionMetrics {
  const createdInRange = tasks.filter((t) => inRange(toDateKey(t.createdAt), from, to));
  const completedInRange = tasks.filter(
    (t) => t.status === 'completed' && t.completedAt !== null && inRange(toDateKey(t.completedAt), from, to),
  );
  const cancelled = tasks.filter(
    (t) => t.status === 'cancelled' && inRange(toDateKey(t.updatedAt), from, to),
  ).length;
  const skipped = tasks.filter(
    (t) => t.status === 'skipped' && inRange(toDateKey(t.updatedAt), from, to),
  ).length;

  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
  const overdue = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate !== null && diffDays(today, t.dueDate) < 0,
  ).length;

  const withDue = completedInRange.filter((t) => t.dueDate !== null);
  const onTime = withDue.filter((t) => diffDays(toDateKey(t.completedAt!), t.dueDate!) >= 0).length;

  const cycles = completedInRange
    .map((t) => diffDays(toDateKey(t.createdAt), toDateKey(t.completedAt!)))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const medianCycleDays = cycles.length === 0
    ? null
    : cycles.length % 2 === 1
      ? cycles[(cycles.length - 1) / 2]
      : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2;

  const typeMap = new Map<TaskType, { completed: number; minutes: number }>();
  for (const t of completedInRange) {
    const entry = typeMap.get(t.type) ?? { completed: 0, minutes: 0 };
    entry.completed++;
    entry.minutes += t.actualMinutes;
    typeMap.set(t.type, entry);
  }

  // Denominator: work that reached a decision in the window, so a big backlog
  // of untouched tasks does not silently drag the rate down.
  const decided = completedInRange.length + cancelled + skipped;

  return {
    created: createdInRange.length,
    completed: completedInRange.length,
    cancelled,
    skipped,
    open,
    overdue,
    completionRate: ratio(completedInRange.length, decided),
    onTimeCompleted: onTime,
    onTimeRate: ratio(onTime, withDue.length),
    medianCycleDays,
    byType: [...typeMap.entries()]
      .map(([type, v]) => ({ type, completed: v.completed, minutes: Math.round(v.minutes) }))
      .sort((a, b) => b.completed - a.completed),
  };
}

/* ------------------------------------------------------------------ */
/* Study metrics                                                       */
/* ------------------------------------------------------------------ */

export interface SubjectPerformance {
  trackerId: ID;
  label: string;
  minutes: number;
  questionsAttempted: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  /** Mean seconds spent per attempted question. */
  meanSecondsPerQuestion: number;
}

export interface TopicPerformance {
  topic: string;
  attempted: number;
  correct: number;
  accuracy: number;
}

export interface MistakeBreakdown {
  type: MistakeType;
  label: string;
  count: number;
  share: number;
}

export interface PaperSummary {
  paperId: ID;
  title: string;
  date: DateKey;
  score: number;
  maxScore: number;
  scorePercent: number;
  attempted: number;
  correct: number;
  accuracy: number;
}

export interface StudyMetrics {
  studyMinutes: number;
  sessionCount: number;
  meanSessionMinutes: number;
  longestSessionMinutes: number;
  pomodoros: number;
  papersSubmitted: number;
  questionsAttempted: number;
  questionsCorrect: number;
  accuracy: number;
  /** Accuracy of the most recent half of papers minus the earlier half. */
  accuracyTrend: TrendComparison;
  meanSecondsPerQuestion: number;
  mistakes: MistakeBreakdown[];
  bySubject: SubjectPerformance[];
  byTopic: TopicPerformance[];
  papers: PaperSummary[];
  revisionsCompleted: number;
  revisionsDue: number;
  revisionsMissed: number;
  revisionCompletionRate: number;
}

export const MISTAKE_LABELS: Record<MistakeType, string> = {
  unknown_concept: "Didn't know the concept",
  conceptual: 'Conceptual error',
  calculation: 'Calculation error',
  silly: 'Silly mistake',
  misread: 'Misread the question',
  time_pressure: 'Time pressure',
  guess: 'Guessed',
  other: 'Other',
};

export function computeStudyMetrics(input: AnalyticsInput): StudyMetrics {
  const { from, to } = input;
  const byId = trackerIndex(input.trackers);

  const studyTrackerIds = new Set(
    input.trackers.filter((t) => rootTrackerOf(t.id, byId)?.pillar === 'study').map((t) => t.id),
  );

  const studyActivities = input.activities.filter(
    (a) => inRange(a.date, from, to) && a.trackerId !== null && studyTrackerIds.has(a.trackerId),
  );
  const studyMinutes = studyActivities
    .filter((a) => a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type))
    .reduce((s, a) => s + minutesOf(a), 0);

  const sessions = input.sessions.filter(
    (s) => inRange(s.date, from, to) && studyTrackerIds.has(s.trackerId),
  );
  const sessionMinutes = sessions.map((s) => s.workMs / 60_000);
  const longestSession = sessionMinutes.length ? Math.max(...sessionMinutes) : 0;
  const pomodoros = sessions.reduce((s, x) => s + x.pomodoroCount, 0);

  const papers = input.papers.filter(
    (p) => inRange(p.date, from, to) && (p.status === 'submitted' || p.status === 'reviewed'),
  );
  const paperIds = new Set(papers.map((p) => p.id));
  const attempts = input.attempts.filter((a) => paperIds.has(a.paperId));
  const attempted = attempts.filter((a) => a.status === 'correct' || a.status === 'incorrect');
  const correct = attempts.filter((a) => a.status === 'correct');

  // --- mistake classification -------------------------------------------
  const mistakeCounts = new Map<MistakeType, number>();
  for (const a of attempts) {
    if (a.status !== 'incorrect') continue;
    const type = a.mistakeType ?? 'other';
    mistakeCounts.set(type, (mistakeCounts.get(type) ?? 0) + 1);
  }
  const mistakeTotal = [...mistakeCounts.values()].reduce((s, n) => s + n, 0);
  const mistakes: MistakeBreakdown[] = [...mistakeCounts.entries()]
    .map(([type, count]) => ({ type, label: MISTAKE_LABELS[type], count, share: ratio(count, mistakeTotal) }))
    .sort((a, b) => b.count - a.count);

  // --- per-subject ------------------------------------------------------
  const subjectMap = new Map<ID, { minutes: number; attempted: number; correct: number; incorrect: number; ms: number }>();
  const ensureSubject = (id: ID) => {
    let row = subjectMap.get(id);
    if (!row) { row = { minutes: 0, attempted: 0, correct: 0, incorrect: 0, ms: 0 }; subjectMap.set(id, row); }
    return row;
  };
  for (const a of studyActivities) {
    if (a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type) && a.trackerId) {
      ensureSubject(a.trackerId).minutes += minutesOf(a);
    }
  }
  for (const a of attempts) {
    const row = ensureSubject(a.trackerId);
    if (a.status === 'correct') { row.correct++; row.attempted++; row.ms += a.timeSpentMs; }
    else if (a.status === 'incorrect') { row.incorrect++; row.attempted++; row.ms += a.timeSpentMs; }
  }

  const bySubject: SubjectPerformance[] = [...subjectMap.entries()]
    .map(([trackerId, v]) => ({
      trackerId,
      label: byId.get(trackerId)?.name ?? 'Unknown subject',
      minutes: Math.round(v.minutes),
      questionsAttempted: v.attempted,
      correct: v.correct,
      incorrect: v.incorrect,
      accuracy: ratio(v.correct, v.attempted),
      meanSecondsPerQuestion: v.attempted > 0 ? Math.round(v.ms / v.attempted / 1000) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.questionsAttempted - a.questionsAttempted);

  // --- per-topic (from the Question definitions) ------------------------
  const questionById = new Map<ID, Question>(input.questions.map((q) => [q.id, q]));
  const topicMap = new Map<string, { attempted: number; correct: number }>();
  for (const a of attempts) {
    if (a.status !== 'correct' && a.status !== 'incorrect') continue;
    const topic = questionById.get(a.questionId)?.topic?.trim();
    if (!topic) continue;
    const row = topicMap.get(topic) ?? { attempted: 0, correct: 0 };
    row.attempted++;
    if (a.status === 'correct') row.correct++;
    topicMap.set(topic, row);
  }
  const byTopic: TopicPerformance[] = [...topicMap.entries()]
    .map(([topic, v]) => ({ topic, attempted: v.attempted, correct: v.correct, accuracy: ratio(v.correct, v.attempted) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted);

  // --- per-paper summaries + accuracy trend -----------------------------
  const attemptsByPaper = new Map<ID, QuestionAttempt[]>();
  for (const a of attempts) {
    const list = attemptsByPaper.get(a.paperId);
    if (list) list.push(a);
    else attemptsByPaper.set(a.paperId, [a]);
  }
  const paperSummaries: PaperSummary[] = papers
    .map((p) => {
      const list = attemptsByPaper.get(p.id) ?? [];
      const att = list.filter((a) => a.status === 'correct' || a.status === 'incorrect').length;
      const cor = list.filter((a) => a.status === 'correct').length;
      return {
        paperId: p.id,
        title: p.title,
        date: p.date,
        score: p.score,
        maxScore: p.maxScore,
        scorePercent: percent(p.score, p.maxScore),
        attempted: att,
        correct: cor,
        accuracy: ratio(cor, att),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const accuracyTrend = splitHalfTrend(paperSummaries.map((p) => p.accuracy * 100));

  const totalMs = attempted.reduce((s, a) => s + a.timeSpentMs, 0);

  // --- revisions ---------------------------------------------------------
  const revisionsInRange = input.revisionEntries.filter((e) => inRange(e.dueDate, from, to));
  const revisionsCompleted = input.revisionEntries.filter(
    (e) => e.status === 'completed' && e.completedAt !== null && inRange(toDateKey(e.completedAt), from, to),
  ).length;
  const revisionsMissed = revisionsInRange.filter((e) => e.status === 'missed').length;

  return {
    studyMinutes: Math.round(studyMinutes),
    sessionCount: sessions.length,
    meanSessionMinutes: sessions.length ? Math.round(sessionMinutes.reduce((s, m) => s + m, 0) / sessions.length) : 0,
    longestSessionMinutes: Math.round(longestSession),
    pomodoros,
    papersSubmitted: papers.length,
    questionsAttempted: attempted.length,
    questionsCorrect: correct.length,
    accuracy: ratio(correct.length, attempted.length),
    accuracyTrend,
    meanSecondsPerQuestion: attempted.length ? Math.round(totalMs / attempted.length / 1000) : 0,
    mistakes,
    bySubject,
    byTopic,
    papers: paperSummaries,
    revisionsCompleted,
    revisionsDue: revisionsInRange.length,
    revisionsMissed,
    revisionCompletionRate: ratio(revisionsCompleted, revisionsInRange.length),
  };
}

/**
 * Compares the mean of the second half of an ordered series against the first
 * half. With fewer than two points there is nothing to compare, so it reports
 * a flat trend rather than inventing movement.
 */
export function splitHalfTrend(series: readonly number[]): TrendComparison {
  if (series.length < 2) {
    const only = series.length === 1 ? series[0] : 0;
    return { current: round1(only), previous: 0, delta: 0, percentChange: null, direction: 'flat' };
  }
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid);
  const second = series.slice(mid);
  const previous = first.reduce((s, n) => s + n, 0) / first.length;
  const current = second.reduce((s, n) => s + n, 0) / second.length;
  return compareValues(current, previous);
}

export function compareValues(current: number, previous: number): TrendComparison {
  const delta = current - previous;
  return {
    current: round1(current),
    previous: round1(previous),
    delta: round1(delta),
    percentChange: previous === 0 ? null : Math.round((delta / previous) * 1000) / 10,
    direction: Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down',
  };
}

/* ------------------------------------------------------------------ */
/* Pillar metrics (Fitness / Skills / Personal — and Study's time part) */
/* ------------------------------------------------------------------ */

export interface PillarMetrics {
  pillar: Pillar;
  label: string;
  totalMinutes: number;
  sessionCount: number;
  meanSessionMinutes: number;
  activeDays: number;
  tasksCompleted: number;
  /** Minutes per child tracker (e.g. per discipline or per subject). */
  byTracker: NamedMinutes[];
  /** Weekly target from the root tracker, when one is configured. */
  weeklyTargetMinutes: number | null;
  weeklyAverageMinutes: number;
  targetAttainment: number | null;
  habits: { habitId: ID; title: string; checkins: number; currentStreak: number }[];
  goals: { goalId: ID; title: string; progress: number }[];
  daily: DayPoint[];
  streak: StreakSummary;
}

export function computePillarMetrics(input: AnalyticsInput, pillar: Pillar): PillarMetrics {
  const { from, to } = input;
  const byId = trackerIndex(input.trackers);
  const memberIds = new Set(
    input.trackers.filter((t) => rootTrackerOf(t.id, byId)?.pillar === pillar).map((t) => t.id),
  );
  const root = input.trackers.find((t) => t.pillar === pillar && t.parentId === null);

  const scoped = input.activities.filter(
    (a) => inRange(a.date, from, to) && a.trackerId !== null && memberIds.has(a.trackerId),
  );
  const timeActivities = scoped.filter((a) => a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type));
  const totalMinutes = timeActivities.reduce((s, a) => s + minutesOf(a), 0);

  const sessions = input.sessions.filter((s) => inRange(s.date, from, to) && memberIds.has(s.trackerId));
  const activeDates = [...new Set(scoped.map((a) => a.date))];

  const distribution = computeTimeDistribution(scoped, input.trackers, from, to);
  const daily = computeDailySeries(
    scoped,
    input.blocks.filter((b) => memberIds.has(b.trackerId)),
    from,
    to,
  );

  const dayCount = Math.max(1, dateKeyRange(from, to).length);
  const weeklyAverage = (totalMinutes / dayCount) * 7;
  const target = root?.weeklyTargetMinutes ?? null;

  const habitIds = new Set(input.habits.filter((h) => memberIds.has(h.trackerId)).map((h) => h.id));
  const checkinCounts = new Map<ID, number>();
  for (const a of scoped) {
    if (a.type === 'habit_checkin' && a.habitId && habitIds.has(a.habitId)) {
      checkinCounts.set(a.habitId, (checkinCounts.get(a.habitId) ?? 0) + 1);
    }
  }

  return {
    pillar,
    label: capitalise(pillar),
    totalMinutes: Math.round(totalMinutes),
    sessionCount: sessions.length,
    meanSessionMinutes: sessions.length
      ? Math.round(sessions.reduce((s, x) => s + x.workMs / 60_000, 0) / sessions.length)
      : 0,
    activeDays: activeDates.length,
    tasksCompleted: scoped.filter((a) => a.type === 'task_completed').length,
    byTracker: distribution.byTracker.filter((r) => r.id !== root?.id || distribution.byTracker.length === 1),
    weeklyTargetMinutes: target,
    weeklyAverageMinutes: Math.round(weeklyAverage),
    targetAttainment: target && target > 0 ? ratio(weeklyAverage, target) : null,
    habits: input.habits
      .filter((h) => memberIds.has(h.trackerId))
      .map((h) => ({
        habitId: h.id,
        title: h.title,
        checkins: checkinCounts.get(h.id) ?? 0,
        currentStreak: h.currentStreak,
      }))
      .sort((a, b) => b.checkins - a.checkins),
    goals: input.goals
      .filter((g) => memberIds.has(g.trackerId) && g.status !== 'abandoned')
      .map((g) => ({ goalId: g.id, title: g.title, progress: g.progress }))
      .sort((a, b) => b.progress - a.progress),
    daily,
    streak: computeStreaks(activeDates, toDateKey(input.now)),
  };
}

/* ------------------------------------------------------------------ */
/* Time analytics — when the work actually happens                     */
/* ------------------------------------------------------------------ */

export interface HourBucket {
  /** 0..23 */
  hour: number;
  minutes: number;
  share: number;
}

export interface WeekdayBucket {
  /** 0 = Sunday */
  dayOfWeek: number;
  label: string;
  minutes: number;
  activeDays: number;
  meanMinutes: number;
}

export interface TimeMetrics {
  totalMinutes: number;
  dailyAverageMinutes: number;
  busiestDay: DayPoint | null;
  quietestActiveDay: DayPoint | null;
  byHour: HourBucket[];
  byWeekday: WeekdayBucket[];
  peakHour: number | null;
  distribution: TimeDistribution;
  plannedVsActual: PlannedVsActual;
  daily: DayPoint[];
  weekly: { weekKey: string; minutes: number; tasksCompleted: number }[];
  streak: StreakSummary;
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function computeTimeMetrics(input: AnalyticsInput): TimeMetrics {
  const { from, to } = input;
  const timeActivities = input.activities.filter(
    (a) => inRange(a.date, from, to) && a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type),
  );

  const hourMinutes = new Array<number>(24).fill(0);
  for (const a of timeActivities) {
    const minutes = minutesOf(a);
    // Attribute the whole event to the hour it started in — the log records a
    // single timestamp, so anything finer would be fabricated.
    const hour = Math.floor(minuteOfDay(a.at) / 60);
    hourMinutes[hour] += minutes;
  }
  const hourTotal = hourMinutes.reduce((s, m) => s + m, 0);
  const byHour: HourBucket[] = hourMinutes.map((minutes, hour) => ({
    hour,
    minutes: Math.round(minutes),
    share: ratio(minutes, hourTotal),
  }));

  const daily = computeDailySeries(input.activities, input.blocks, from, to);

  const weekdayTotals = new Array<number>(7).fill(0);
  const weekdayActive = new Array<number>(7).fill(0);
  for (const point of daily) {
    const dow = new Date(`${point.date}T00:00:00`).getDay();
    weekdayTotals[dow] += point.minutes;
    if (point.minutes > 0) weekdayActive[dow]++;
  }
  const byWeekday: WeekdayBucket[] = weekdayTotals.map((minutes, dayOfWeek) => ({
    dayOfWeek,
    label: WEEKDAY_LABELS[dayOfWeek],
    minutes: Math.round(minutes),
    activeDays: weekdayActive[dayOfWeek],
    meanMinutes: weekdayActive[dayOfWeek] ? Math.round(minutes / weekdayActive[dayOfWeek]) : 0,
  }));

  const weekMap = new Map<string, { minutes: number; tasksCompleted: number }>();
  for (const point of daily) {
    const key = isoWeekKey(point.date);
    const row = weekMap.get(key) ?? { minutes: 0, tasksCompleted: 0 };
    row.minutes += point.minutes;
    row.tasksCompleted += point.tasksCompleted;
    weekMap.set(key, row);
  }

  const activeDays = daily.filter((d) => d.minutes > 0);
  const totalMinutes = daily.reduce((s, d) => s + d.minutes, 0);
  const peakIndex = hourMinutes.reduce((best, m, i) => (m > hourMinutes[best] ? i : best), 0);

  return {
    totalMinutes: Math.round(totalMinutes),
    dailyAverageMinutes: daily.length ? Math.round(totalMinutes / daily.length) : 0,
    busiestDay: activeDays.length ? activeDays.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : null,
    quietestActiveDay: activeDays.length ? activeDays.reduce((a, b) => (b.minutes < a.minutes ? b : a)) : null,
    byHour,
    byWeekday,
    peakHour: hourTotal > 0 ? peakIndex : null,
    distribution: computeTimeDistribution(input.activities, input.trackers, from, to),
    plannedVsActual: computePlannedVsActual(input.blocks, input.activities, from, to),
    daily,
    weekly: [...weekMap.entries()]
      .map(([weekKey, v]) => ({ weekKey, minutes: Math.round(v.minutes), tasksCompleted: v.tasksCompleted }))
      .sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1)),
    streak: computeStreaks(
      [...new Set(input.activities.filter((a) => inRange(a.date, from, to)).map((a) => a.date))],
      toDateKey(input.now),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Goal rollups                                                        */
/* ------------------------------------------------------------------ */

export interface GoalRollupRow {
  goalId: ID;
  title: string;
  trackerId: ID;
  trackerLabel: string;
  status: Goal['status'];
  progress: number;
  weight: number;
  targetDate: DateKey | null;
  daysRemaining: number | null;
  /** Minutes logged against this goal inside the window. */
  minutesInPeriod: number;
  tasksCompletedInPeriod: number;
  /** Linear expectation for today; null without a target date. */
  expectedProgress: number | null;
  behindBy: number | null;
}

export interface GoalMetrics {
  active: number;
  completed: number;
  paused: number;
  abandoned: number;
  completedInPeriod: number;
  milestonesCompletedInPeriod: number;
  meanProgress: number;
  weightedProgress: number;
  rows: GoalRollupRow[];
  atRisk: GoalRollupRow[];
}

export function computeGoalMetrics(input: AnalyticsInput): GoalMetrics {
  const { from, to } = input;
  const today = toDateKey(input.now);
  const byId = trackerIndex(input.trackers);

  const minutesByGoal = new Map<ID, number>();
  const tasksByGoal = new Map<ID, number>();
  for (const a of input.activities) {
    if (!inRange(a.date, from, to) || !a.goalId) continue;
    if (a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type)) {
      minutesByGoal.set(a.goalId, (minutesByGoal.get(a.goalId) ?? 0) + minutesOf(a));
    }
    if (a.type === 'task_completed') {
      tasksByGoal.set(a.goalId, (tasksByGoal.get(a.goalId) ?? 0) + 1);
    }
  }

  const rows: GoalRollupRow[] = input.goals.map((g) => {
    const daysRemaining = g.targetDate ? diffDays(today, g.targetDate) : null;
    let expected: number | null = null;
    if (g.targetDate) {
      const total = diffDays(g.startDate, g.targetDate);
      const elapsed = diffDays(g.startDate, today);
      expected = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : null;
    }
    return {
      goalId: g.id,
      title: g.title,
      trackerId: g.trackerId,
      trackerLabel: byId.get(g.trackerId)?.name ?? 'Unknown tracker',
      status: g.status,
      progress: g.progress,
      weight: g.weight,
      targetDate: g.targetDate,
      daysRemaining,
      minutesInPeriod: Math.round(minutesByGoal.get(g.id) ?? 0),
      tasksCompletedInPeriod: tasksByGoal.get(g.id) ?? 0,
      expectedProgress: expected,
      behindBy: expected === null ? null : Math.round((expected - g.progress) * 1000) / 1000,
    };
  });

  const active = rows.filter((r) => r.status === 'active');
  const totalWeight = active.reduce((s, r) => s + r.weight, 0);

  const completedInPeriod = input.activities.filter(
    (a) => a.type === 'goal_completed' && inRange(a.date, from, to),
  ).length;
  const milestonesCompletedInPeriod = input.activities.filter(
    (a) => a.type === 'milestone_completed' && inRange(a.date, from, to),
  ).length;

  return {
    active: active.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    paused: rows.filter((r) => r.status === 'paused').length,
    abandoned: rows.filter((r) => r.status === 'abandoned').length,
    completedInPeriod,
    milestonesCompletedInPeriod,
    meanProgress: active.length ? active.reduce((s, r) => s + r.progress, 0) / active.length : 0,
    weightedProgress: totalWeight > 0
      ? active.reduce((s, r) => s + r.progress * r.weight, 0) / totalWeight
      : 0,
    rows: rows.sort((a, b) => b.progress - a.progress),
    atRisk: active
      .filter((r) => r.behindBy !== null && r.behindBy > 0.15)
      .sort((a, b) => (b.behindBy ?? 0) - (a.behindBy ?? 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Planning accuracy                                                   */
/* ------------------------------------------------------------------ */

export interface PlanningAccuracy {
  sampleSize: number;
  /** Median actual/estimated across all completed tasks with real time. */
  medianRatio: number;
  meanEstimatedMinutes: number;
  meanActualMinutes: number;
  /** Tasks whose actual was within 15% of the estimate. */
  accurateEstimates: number;
  accuracyRate: number;
  underestimated: number;
  overestimated: number;
  /** Per-group predictions from the DurationPredictionEngine. */
  predictions: DurationPrediction[];
  summary: string;
}

export function computePlanningAccuracy(
  input: AnalyticsInput,
  config: SchedulingConfig,
): PlanningAccuracy {
  const byId = trackerIndex(input.trackers);
  const scopedTasks = input.tasks.filter(
    (t) => t.status === 'completed' && t.completedAt !== null
      && inRange(toDateKey(t.completedAt), input.from, input.to),
  );

  const predictions = predictDurations(
    {
      tasks: scopedTasks,
      sessions: input.sessions,
      activities: input.activities,
      subjectOf: (t) => byId.get(t.trackerId)?.name ?? null,
      trackerNames: Object.fromEntries(input.trackers.map((t) => [t.id, t.name])),
    },
    config,
  );

  const global = predictions.find((p) => p.groupKind === 'global');

  const pairs = scopedTasks
    .map((t) => ({ estimated: t.estimatedMinutes, actual: t.actualMinutes }))
    .filter((p) => p.estimated > 0 && p.actual > 0);

  const accurate = pairs.filter((p) => Math.abs(p.actual / p.estimated - 1) <= 0.15).length;
  const under = pairs.filter((p) => p.actual / p.estimated > 1.15).length;
  const over = pairs.filter((p) => p.actual / p.estimated < 0.85).length;

  return {
    sampleSize: global?.sampleSize ?? pairs.length,
    medianRatio: global?.medianOverrunRatio ?? 1,
    meanEstimatedMinutes: global?.meanEstimatedMinutes ?? 0,
    meanActualMinutes: global?.meanActualMinutes ?? 0,
    accurateEstimates: accurate,
    accuracyRate: ratio(accurate, pairs.length),
    underestimated: under,
    overestimated: over,
    predictions: predictions.filter((p) => p.sampleSize >= config.duration.minSamples),
    summary: pairs.length === 0
      ? 'No completed tasks with both an estimate and recorded time yet — nothing to measure planning accuracy against.'
      : `${accurate} of ${pairs.length} estimates landed within 15% of reality. ${under} ran long, ${over} finished early.`,
  };
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export interface OverviewMetrics {
  from: DateKey;
  to: DateKey;
  dayCount: number;
  totalMinutes: number;
  dailyAverageMinutes: number;
  distribution: TimeDistribution;
  completion: CompletionMetrics;
  plannedVsActual: PlannedVsActual;
  streak: StreakSummary;
  daily: DayPoint[];
  /** This window compared with the immediately preceding window of equal length. */
  minutesTrend: TrendComparison;
  tasksTrend: TrendComparison;
  /** Pillar with the most recorded minutes in the window. */
  strongestPillar: NamedMinutes | null;
  /** Pillar with a weekly target that is furthest below it. */
  weakestPillar: { pillar: Pillar; label: string; minutes: number; targetMinutes: number; attainment: number } | null;
  headline: string;
}

export function computeOverview(input: AnalyticsInput): OverviewMetrics {
  const { from, to } = input;
  const today = toDateKey(input.now);
  const days = dateKeyRange(from, to);
  const distribution = computeTimeDistribution(input.activities, input.trackers, from, to);
  const daily = computeDailySeries(input.activities, input.blocks, from, to);
  const completion = computeCompletionMetrics(input.tasks, from, to, today);
  const plan = computePlannedVsActual(input.blocks, input.activities, from, to);

  // Previous window of identical length, immediately before `from`.
  const prevTo = addDaysToKey(from, -1);
  const prevFrom = addDaysToKey(prevTo, -(days.length - 1));
  const prevDistribution = computeTimeDistribution(input.activities, input.trackers, prevFrom, prevTo);
  const prevCompletion = computeCompletionMetrics(input.tasks, prevFrom, prevTo, today);

  const totalMinutes = distribution.totalMinutes;
  const activeDates = [...new Set(input.activities.filter((a) => inRange(a.date, from, to)).map((a) => a.date))];

  const weeks = Math.max(1, days.length / 7);
  const roots = input.trackers.filter((t) => t.parentId === null && t.pillar !== 'system');
  let weakest: OverviewMetrics['weakestPillar'] = null;
  for (const root of roots) {
    const target = root.weeklyTargetMinutes;
    if (!target || target <= 0) continue;
    const minutes = distribution.pillarMinutes[root.pillar];
    const attainment = ratio(minutes / weeks, target);
    if (!weakest || attainment < weakest.attainment) {
      weakest = { pillar: root.pillar, label: root.name, minutes, targetMinutes: target, attainment };
    }
  }

  const strongest = distribution.byPillar[0] ?? null;

  return {
    from,
    to,
    dayCount: days.length,
    totalMinutes,
    dailyAverageMinutes: days.length ? Math.round(totalMinutes / days.length) : 0,
    distribution,
    completion,
    plannedVsActual: plan,
    streak: computeStreaks(activeDates, today),
    daily,
    minutesTrend: compareValues(totalMinutes, prevDistribution.totalMinutes),
    tasksTrend: compareValues(completion.completed, prevCompletion.completed),
    strongestPillar: strongest,
    weakestPillar: weakest,
    headline: totalMinutes === 0 && completion.completed === 0
      ? `Nothing recorded between ${from} and ${to}.`
      : `${Math.round(totalMinutes)} min tracked across ${activeDates.length} active day${activeDates.length === 1 ? '' : 's'}, ${completion.completed} task${completion.completed === 1 ? '' : 's'} completed.`,
  };
}

/* ------------------------------------------------------------------ */
/* Full result                                                         */
/* ------------------------------------------------------------------ */

export interface AnalyticsResult {
  overview: OverviewMetrics;
  study: StudyMetrics;
  fitness: PillarMetrics;
  skills: PillarMetrics;
  personal: PillarMetrics;
  studyPillar: PillarMetrics;
  time: TimeMetrics;
  goals: GoalMetrics;
  planning: PlanningAccuracy;
}

/** One pass over the data producing every section the Analytics module needs. */
export function computeAnalytics(input: AnalyticsInput, config: SchedulingConfig): AnalyticsResult {
  return {
    overview: computeOverview(input),
    study: computeStudyMetrics(input),
    studyPillar: computePillarMetrics(input, 'study'),
    fitness: computePillarMetrics(input, 'fitness'),
    skills: computePillarMetrics(input, 'skills'),
    personal: computePillarMetrics(input, 'personal'),
    time: computeTimeMetrics(input),
    goals: computeGoalMetrics(input),
    planning: computePlanningAccuracy(input, config),
  };
}

/* ------------------------------------------------------------------ */
/* Review support (Phase 6 daily/weekly reviews read these)            */
/* ------------------------------------------------------------------ */

export interface AreaVerdict {
  /** Tracker/pillar label. */
  label: string;
  minutes: number;
  /** Supporting sentence built only from the numbers above. */
  evidence: string;
}

export interface WeeklyReviewMetrics {
  from: DateKey;
  to: DateKey;
  tasksCompleted: number;
  tasksCompletedPrevious: number;
  tasksTrend: TrendComparison;
  studyMinutes: number;
  fitnessMinutes: number;
  skillsMinutes: number;
  personalMinutes: number;
  totalMinutes: number;
  activeDays: number;
  questionsCompleted: number;
  accuracy: number;
  accuracyPrevious: number;
  accuracyChange: TrendComparison;
  revisionsCompleted: number;
  revisionsDue: number;
  revisionCompletionRate: number;
  goalsProgressed: { goalId: ID; title: string; minutes: number; tasksCompleted: number }[];
  strongest: AreaVerdict | null;
  needsAttention: AreaVerdict | null;
  distribution: TimeDistribution;
  daily: DayPoint[];
  plannedVsActual: PlannedVsActual;
}

/**
 * Weekly review numbers. "Strongest area" is simply the pillar with the most
 * recorded minutes; "needs attention" is the pillar furthest below its own
 * configured weekly target (or, absent targets, the one with the fewest
 * minutes). Both carry the numbers they were derived from — no invented
 * insight, ever.
 */
export function computeWeeklyReview(input: AnalyticsInput): WeeklyReviewMetrics {
  const { from, to } = input;
  const days = dateKeyRange(from, to).length;
  const prevTo = addDaysToKey(from, -1);
  const prevFrom = addDaysToKey(prevTo, -(days - 1));

  const distribution = computeTimeDistribution(input.activities, input.trackers, from, to);
  const completion = computeCompletionMetrics(input.tasks, from, to, toDateKey(input.now));
  const prevCompletion = computeCompletionMetrics(input.tasks, prevFrom, prevTo, toDateKey(input.now));

  const study = computeStudyMetrics(input);
  const prevStudy = computeStudyMetrics({ ...input, from: prevFrom, to: prevTo });

  const activeDates = [...new Set(input.activities.filter((a) => inRange(a.date, from, to)).map((a) => a.date))];

  const goalRows = computeGoalMetrics(input).rows
    .filter((r) => r.minutesInPeriod > 0 || r.tasksCompletedInPeriod > 0)
    .map((r) => ({ goalId: r.goalId, title: r.title, minutes: r.minutesInPeriod, tasksCompleted: r.tasksCompletedInPeriod }))
    .sort((a, b) => b.minutes - a.minutes);

  // --- strongest / weakest, strictly from measured minutes --------------
  const roots = input.trackers.filter((t) => t.parentId === null && t.pillar !== 'system');
  const pillarRows = roots.map((root) => ({
    root,
    minutes: distribution.pillarMinutes[root.pillar],
    target: root.weeklyTargetMinutes ?? null,
  }));

  const withTime = pillarRows.filter((r) => r.minutes > 0);
  const strongestRow = withTime.length
    ? withTime.reduce((a, b) => (b.minutes > a.minutes ? b : a))
    : null;

  const weeks = Math.max(1, days / 7);
  const targeted = pillarRows.filter((r) => r.target && r.target > 0);
  const weakestRow = targeted.length
    ? targeted.reduce((a, b) =>
        ratio(b.minutes / weeks, b.target!) < ratio(a.minutes / weeks, a.target!) ? b : a)
    : pillarRows.length
      ? pillarRows.reduce((a, b) => (b.minutes < a.minutes ? b : a))
      : null;

  const strongest: AreaVerdict | null = strongestRow
    ? {
        label: strongestRow.root.name,
        minutes: strongestRow.minutes,
        evidence: `${strongestRow.minutes} min recorded — ${percent(strongestRow.minutes, distribution.totalMinutes)}% of all tracked time this period.`,
      }
    : null;

  const needsAttention: AreaVerdict | null = weakestRow
    ? {
        label: weakestRow.root.name,
        minutes: weakestRow.minutes,
        evidence: weakestRow.target && weakestRow.target > 0
          ? `${weakestRow.minutes} min against a ${Math.round(weakestRow.target * weeks)} min target for this period (${percent(weakestRow.minutes, weakestRow.target * weeks)}%).`
          : `${weakestRow.minutes} min recorded — the least of any pillar this period. No weekly target is set for it.`,
      }
    : null;

  return {
    from,
    to,
    tasksCompleted: completion.completed,
    tasksCompletedPrevious: prevCompletion.completed,
    tasksTrend: compareValues(completion.completed, prevCompletion.completed),
    studyMinutes: distribution.pillarMinutes.study,
    fitnessMinutes: distribution.pillarMinutes.fitness,
    skillsMinutes: distribution.pillarMinutes.skills,
    personalMinutes: distribution.pillarMinutes.personal,
    totalMinutes: distribution.totalMinutes,
    activeDays: activeDates.length,
    questionsCompleted: study.questionsAttempted,
    accuracy: study.accuracy,
    accuracyPrevious: prevStudy.accuracy,
    accuracyChange: compareValues(study.accuracy * 100, prevStudy.accuracy * 100),
    revisionsCompleted: study.revisionsCompleted,
    revisionsDue: study.revisionsDue,
    revisionCompletionRate: study.revisionCompletionRate,
    goalsProgressed: goalRows,
    strongest,
    needsAttention,
    distribution,
    daily: computeDailySeries(input.activities, input.blocks, from, to),
    plannedVsActual: computePlannedVsActual(input.blocks, input.activities, from, to),
  };
}

export interface DailyReviewMetrics {
  date: DateKey;
  completedTasks: Task[];
  incompleteTasks: Task[];
  minutesTracked: number;
  distribution: TimeDistribution;
  plannedMinutes: number;
  blocksCompleted: number;
  blocksPlanned: number;
  blocksSkipped: number;
  goalsTouched: { goalId: ID; title: string; minutes: number; progress: number }[];
  habitCheckins: number;
  revisionsCompleted: number;
  xpEarned: number;
  summary: string;
}

/**
 * Everything the Daily Review screen states as fact. `incompleteTasks` are the
 * tasks that were on today's plan (scheduled or due) and have not reached a
 * terminal state — exactly the set the rescheduling engine is offered for.
 */
export function computeDailyReview(input: AnalyticsInput, date: DateKey, xpEarned: number): DailyReviewMetrics {
  const dayActivities = input.activities.filter((a) => a.date === date);
  const dayBlocks = input.blocks.filter((b) => b.date === date);

  const completedTasks = input.tasks.filter(
    (t) => t.status === 'completed' && t.completedAt !== null && toDateKey(t.completedAt) === date,
  );

  const plannedTaskIds = new Set(dayBlocks.map((b) => b.taskId).filter((id): id is ID => id !== null));
  const incompleteTasks = input.tasks.filter(
    (t) =>
      t.status !== 'completed' && t.status !== 'cancelled'
      && (plannedTaskIds.has(t.id) || t.dueDate === date || (t.dueDate !== null && t.dueDate < date)),
  );

  const distribution = computeTimeDistribution(input.activities, input.trackers, date, date);
  const goalMinutes = new Map<ID, number>();
  for (const a of dayActivities) {
    if (a.goalId && a.durationMs > 0 && TIME_ACTIVITY_TYPES.has(a.type)) {
      goalMinutes.set(a.goalId, (goalMinutes.get(a.goalId) ?? 0) + minutesOf(a));
    }
  }

  const goalById = new Map(input.goals.map((g) => [g.id, g]));
  const goalsTouched = [...goalMinutes.entries()]
    .map(([goalId, minutes]) => ({
      goalId,
      title: goalById.get(goalId)?.title ?? 'Unknown goal',
      minutes: Math.round(minutes),
      progress: goalById.get(goalId)?.progress ?? 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const workBlocks = dayBlocks.filter((b) => !b.protected && b.kind !== 'sleep' && b.kind !== 'meal');

  return {
    date,
    completedTasks,
    incompleteTasks,
    minutesTracked: distribution.totalMinutes,
    distribution,
    plannedMinutes: Math.round(workBlocks.reduce((s, b) => s + (b.end - b.start) / 60_000, 0)),
    blocksCompleted: workBlocks.filter((b) => b.status === 'completed').length,
    blocksPlanned: workBlocks.length,
    blocksSkipped: workBlocks.filter((b) => b.status === 'skipped').length,
    goalsTouched,
    habitCheckins: dayActivities.filter((a) => a.type === 'habit_checkin').length,
    revisionsCompleted: dayActivities.filter((a) => a.type === 'revision_completed').length,
    xpEarned,
    summary: completedTasks.length === 0 && distribution.totalMinutes === 0
      ? 'Nothing recorded for this day yet.'
      : `${completedTasks.length} task${completedTasks.length === 1 ? '' : 's'} completed, ${distribution.totalMinutes} min tracked, ${incompleteTasks.length} task${incompleteTasks.length === 1 ? '' : 's'} still open.`,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
