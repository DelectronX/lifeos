import type { DeepPartial, SchedulingConfig } from '@/types';

/**
 * Central, single source of truth for every tunable number used by the engines.
 *
 * Nothing in src/engines/ hardcodes a threshold: engines take a SchedulingConfig
 * argument so tests can vary behaviour and Settings can override it at runtime.
 */
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  priority: {
    weights: {
      base: 0.24,
      deadline: 0.26,
      goal: 0.16,
      overdue: 0.14,
      dependency: 0.08,
      revision: 0.06,
      age: 0.04,
      effort: 0.02,
    },
    deadlineHalfLifeDays: 4,
    overdueSaturationDays: 7,
    dependencySaturation: 4,
    ageSaturationDays: 21,
    revisionBoost: 1,
    softDeadlineFactor: 0.6,
    effortSaturationMinutes: 240,
  },
  slots: {
    granularityMinutes: 5,
    defaultSessionMinutes: 45,
    minSessionMinutes: 20,
    maxSessionMinutes: 120,
    bufferMinutes: 0,
    minUsableSlotMinutes: 15,
    leadTimeMinutes: 10,
    horizonDays: 14,
    maxDailyLoadMinutes: 480,
  },
  breaks: {
    intensiveThresholdMinutes: 60,
    breakMinutes: 10,
    longBreakMinutes: 25,
    sessionsBeforeLongBreak: 3,
    enforceBetweenIntensive: true,
  },
  windows: {
    morning: [5 * 60, 12 * 60],
    afternoon: [12 * 60, 17 * 60],
    evening: [17 * 60, 22 * 60],
    night: [22 * 60, 24 * 60 + 5 * 60],
    matchBonus: 1,
    mismatchPenalty: 0.5,
  },
  scoring: {
    earliness: 1,
    fragmentation: 0.6,
    windowFit: 0.9,
    contiguity: 0.5,
    loadBalance: 0.7,
    focusHourBonus: 0.4,
  },
  rescheduling: {
    autoReschedule: false,
    strategyOrder: ['next_slot', 'tomorrow', 'split', 'shrink', 'displace'],
    displacementPriorityMargin: 12,
    maxAutoMoves: 3,
    overrunToleranceMinutes: 5,
    minShrinkFactor: 0.5,
  },
  duration: {
    minSamples: 3,
    minRatio: 0.5,
    maxRatio: 3,
    roundToMinutes: 5,
  },
  revision: {
    intervals: [1, 3, 7, 14, 30, 60, 120],
    initialEase: 2.5,
    minEase: 1.3,
    maxEase: 3,
    lapseQualityThreshold: 3,
    lapsePenalty: 0.5,
    defaultDurationMinutes: 25,
    missedAfterDays: 1,
  },
  xp: {
    awards: {
      task_completed: 20,
      block_completed: 8,
      timer_session: 5,
      pomodoro_completed: 6,
      paper_submitted: 60,
      revision_completed: 18,
      habit_checkin: 10,
      milestone_completed: 60,
      goal_completed: 200,
      daily_review: 15,
      weekly_review: 40,
      achievement_unlocked: 0,
    },
    perFocusMinute: 0.6,
    intensityMultiplier: { low: 0.85, medium: 1, high: 1.25 },
    priorityMultiplier: { 1: 0.7, 2: 0.85, 3: 1, 4: 1.2, 5: 1.4 },
    streakBonusPerDay: 0.02,
    streakBonusCap: 0.4,
    dailyCaps: {
      task_completed: 400,
      block_completed: 160,
      timer_session: 500,
      habit_checkin: 100,
      revision_completed: 250,
      daily_review: 15,
      weekly_review: 40,
    },
    dailyTotalCap: 1200,
    levelCurve: { base: 220, exponent: 1.45 },
    minQualifyingMinutes: 2,
    minTaskAgeSeconds: 45,
  },
};

/** Recursively merges user overrides over the defaults. Arrays replace wholesale. */
export function mergeSchedulingConfig(
  overrides: DeepPartial<SchedulingConfig> | undefined | null,
): SchedulingConfig {
  if (!overrides) return DEFAULT_SCHEDULING_CONFIG;
  return deepMerge(DEFAULT_SCHEDULING_CONFIG, overrides) as SchedulingConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(base[key]) && isPlainObject(value)
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}
