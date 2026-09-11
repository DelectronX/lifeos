import {
  ACHIEVEMENT_STAT_KEYS, ACHIEVEMENT_STAT_LABELS, type AchievementStatKey,
} from './achievements';
import type { Condition, LeafCondition, RepeatMode, TimeWindow } from '@/engines/conditionEngine';
import type { AchievementCategory } from '@/types';

/**
 * Catalogue + presets for user-defined rewards.
 *
 * The reward builder only offers metrics that achievementService can actually
 * measure, which is what keeps a custom reward as honest as a built-in
 * achievement: if it cannot be counted from stored records, it cannot be used
 * as a condition.
 */

export interface MetricOption {
  key: AchievementStatKey;
  label: string;
  group: AchievementCategory;
  /** False for all-time-only figures such as level or a streak length. */
  windowable: boolean;
  /** Unit shown next to the value input. */
  unit?: string;
}

const GROUPS: Record<AchievementStatKey, AchievementCategory> = {
  tasksCompleted: 'planning',
  tasksOnTime: 'planning',
  tasksHighPriority: 'planning',
  planAccurateTasks: 'planning',
  planAdherenceDays: 'planning',
  blocksCompleted: 'planning',
  zeroOverdueDays: 'planning',
  bestTaskDay: 'planning',

  focusMinutes: 'focus',
  pomodorosCompleted: 'focus',
  longestSessionMinutes: 'focus',
  earlyBirdSessions: 'focus',
  nightOwlSessions: 'focus',
  uninterruptedSessions: 'focus',
  sessionsCompleted: 'focus',
  longestDailyFocusMinutes: 'focus',
  deepFocusDays: 'focus',

  studyMinutes: 'study',
  fitnessMinutes: 'fitness',
  skillsMinutes: 'skills',
  personalMinutes: 'personal',
  bestPillarSpread: 'personal',

  papersSubmitted: 'mastery',
  questionsAttempted: 'mastery',
  questionsCorrect: 'mastery',
  bestPaperAccuracy: 'mastery',
  papersImproved: 'mastery',
  cleanPapers: 'mastery',
  distinctSubjectsExamined: 'mastery',
  mistakeRateImprovement: 'mastery',
  level: 'mastery',

  revisionsCompleted: 'revision',
  revisionsOnTime: 'revision',
  distinctTopicsRevised: 'revision',
  revisionQualityHigh: 'revision',

  goalsCompleted: 'goals',
  milestonesCompleted: 'goals',
  bestMilestoneMonth: 'goals',

  habitCheckins: 'consistency',
  habitLongestStreak: 'consistency',
  distinctHabits: 'consistency',
  currentStreak: 'consistency',
  longestStreak: 'consistency',
  activeDays: 'consistency',
  perfectDays: 'consistency',
  dailyReviews: 'consistency',
  weeklyReviews: 'consistency',
  weekendActiveDays: 'consistency',
  weekendConsistencyWeeks: 'consistency',
  fullWeeks: 'consistency',
  comebacks: 'consistency',
};

/** Metrics that only exist as an all-time figure — a window cannot narrow them. */
const NON_WINDOWABLE: ReadonlySet<AchievementStatKey> = new Set<AchievementStatKey>([
  'level', 'currentStreak', 'longestStreak', 'habitLongestStreak', 'distinctHabits',
  'distinctTopicsRevised', 'distinctSubjectsExamined', 'mistakeRateImprovement',
  'comebacks', 'fullWeeks', 'weekendConsistencyWeeks', 'bestMilestoneMonth',
]);

const UNITS: Partial<Record<AchievementStatKey, string>> = {
  focusMinutes: 'min',
  studyMinutes: 'min',
  fitnessMinutes: 'min',
  skillsMinutes: 'min',
  personalMinutes: 'min',
  longestSessionMinutes: 'min',
  longestDailyFocusMinutes: 'min',
  bestPaperAccuracy: '%',
  mistakeRateImprovement: 'pts',
  currentStreak: 'days',
  longestStreak: 'days',
  habitLongestStreak: 'days',
};

export const METRIC_OPTIONS: MetricOption[] = ACHIEVEMENT_STAT_KEYS.map((key) => ({
  key,
  label: ACHIEVEMENT_STAT_LABELS[key],
  group: GROUPS[key],
  windowable: !NON_WINDOWABLE.has(key),
  unit: UNITS[key],
})).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

export function findMetricOption(key: string): MetricOption | undefined {
  return METRIC_OPTIONS.find((m) => m.key === key);
}

export const TIME_WINDOW_OPTIONS: { value: TimeWindow['kind']; label: string }[] = [
  { value: 'all_time', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'rolling_days', label: 'Last N days' },
];

export const REPEAT_OPTIONS: { value: RepeatMode; label: string }[] = [
  { value: 'once', label: 'Once ever' },
  { value: 'daily', label: 'Once per day' },
  { value: 'weekly', label: 'Once per week' },
  { value: 'monthly', label: 'Once per month' },
];

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export interface RewardPreset {
  key: string;
  name: string;
  description: string;
  treat: string;
  xpValue: number;
  repeat: RepeatMode;
  /** Built fresh with caller-supplied ids so every copy is independent. */
  build: (makeId: () => string) => Condition;
}

function leaf(
  makeId: () => string,
  metric: AchievementStatKey,
  value: number,
  window: TimeWindow,
): LeafCondition {
  return { id: makeId(), type: 'leaf', metric, operator: '>=', value, window };
}

export const REWARD_PRESETS: RewardPreset[] = [
  {
    key: 'weekly_study',
    name: 'A solid study week',
    description: 'Five hours of study recorded this week.',
    treat: '',
    xpValue: 100,
    repeat: 'weekly',
    build: (makeId) => leaf(makeId, 'studyMinutes', 300, { kind: 'this_week' }),
  },
  {
    key: 'balanced_week',
    name: 'Balanced week',
    description: 'Study and fitness both logged this week, alongside a kept plan.',
    treat: '',
    xpValue: 150,
    repeat: 'weekly',
    build: (makeId) => ({
      id: makeId(),
      type: 'and',
      children: [
        leaf(makeId, 'studyMinutes', 240, { kind: 'this_week' }),
        leaf(makeId, 'fitnessMinutes', 90, { kind: 'this_week' }),
        leaf(makeId, 'tasksCompleted', 10, { kind: 'this_week' }),
      ],
    }),
  },
  {
    key: 'clear_day',
    name: 'A day cleared',
    description: 'Nothing overdue and at least two hours of focus today.',
    treat: '',
    xpValue: 60,
    repeat: 'daily',
    build: (makeId) => ({
      id: makeId(),
      type: 'and',
      children: [
        leaf(makeId, 'focusMinutes', 120, { kind: 'today' }),
        leaf(makeId, 'zeroOverdueDays', 1, { kind: 'today' }),
      ],
    }),
  },
  {
    key: 'exam_ready',
    name: 'Exam ready',
    description: 'Either three papers this month or a paper above 85% accuracy.',
    treat: '',
    xpValue: 250,
    repeat: 'monthly',
    build: (makeId) => ({
      id: makeId(),
      type: 'or',
      children: [
        leaf(makeId, 'papersSubmitted', 3, { kind: 'this_month' }),
        leaf(makeId, 'bestPaperAccuracy', 85, { kind: 'this_month' }),
      ],
    }),
  },
  {
    key: 'rolling_fortnight',
    name: 'Fortnight of momentum',
    description: 'Twelve active days and no missed revisions in the last fourteen.',
    treat: '',
    xpValue: 200,
    repeat: 'monthly',
    build: (makeId) => ({
      id: makeId(),
      type: 'and',
      children: [
        leaf(makeId, 'activeDays', 12, { kind: 'rolling_days', days: 14 }),
        leaf(makeId, 'revisionsCompleted', 5, { kind: 'rolling_days', days: 14 }),
      ],
    }),
  },
];

/** The condition a brand-new reward starts from: one editable AND group. */
export function defaultCondition(makeId: () => string): Condition {
  return {
    id: makeId(),
    type: 'and',
    children: [leaf(makeId, 'studyMinutes', 300, { kind: 'this_week' })],
  };
}
