import { describe, expect, it } from 'vitest';
import {
  compareValues,
  computeAnalytics,
  computeCompletionMetrics,
  computeDailyReview,
  computeDailySeries,
  computeGoalMetrics,
  computePillarMetrics,
  computePlannedVsActual,
  computePlanningAccuracy,
  computeStreaks,
  computeStudyMetrics,
  computeTimeDistribution,
  computeTimeMetrics,
  computeWeeklyReview,
  percent,
  ratio,
  rootTrackerOf,
  splitHalfTrend,
  trackerIndex,
  type AnalyticsInput,
} from '../analytics';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingConfig';
import { atMinute } from '@/lib/date';
import {
  DAY, DAY2, DAY3, TRACKER_FITNESS, TRACKER_STUDY, at,
  makeBlock, makeGoal, makeRevisionEntry, makeSession, makeTask,
} from './fixtures';
import type {
  Activity, ActivityType, Habit, ID, Paper, Question, QuestionAttempt, Tracker,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Local fixtures                                                      */
/* ------------------------------------------------------------------ */

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}`;

const TRACKER_MATHS: ID = 'trk_maths';
const TRACKER_SKILLS: ID = 'trk_skills';
const TRACKER_PERSONAL: ID = 'trk_personal';

function makeTracker(overrides: Partial<Tracker> & { id: ID }): Tracker {
  return {
    createdAt: 0,
    updatedAt: 0,
    name: overrides.id,
    pillar: 'study',
    parentId: null,
    color: 'indigo',
    system: false,
    defaultProtected: false,
    archived: false,
    sortOrder: 0,
    ...overrides,
  };
}

const TRACKERS: Tracker[] = [
  makeTracker({ id: TRACKER_STUDY, name: 'Study', pillar: 'study', weeklyTargetMinutes: 900 }),
  makeTracker({ id: TRACKER_MATHS, name: 'Maths', pillar: 'study', parentId: TRACKER_STUDY }),
  makeTracker({ id: TRACKER_FITNESS, name: 'Fitness', pillar: 'fitness', color: 'teal', weeklyTargetMinutes: 240 }),
  makeTracker({ id: TRACKER_SKILLS, name: 'Skills', pillar: 'skills', color: 'violet' }),
  makeTracker({ id: TRACKER_PERSONAL, name: 'Personal', pillar: 'personal', color: 'amber' }),
];

function makeActivity(overrides: Partial<Activity> & { type: ActivityType }): Activity {
  const atTime = overrides.at ?? at(DAY, 10);
  return {
    id: overrides.id ?? nextId('act'),
    createdAt: atTime,
    updatedAt: atTime,
    at: atTime,
    date: DAY,
    trackerId: TRACKER_STUDY,
    taskId: null,
    goalId: null,
    blockId: null,
    sessionId: null,
    paperId: null,
    revisionEntryId: null,
    habitId: null,
    resourceId: null,
    durationMs: 0,
    value: null,
    unit: null,
    title: 'Activity',
    meta: {},
    ...overrides,
  };
}

/** Convenience: a tracked-time activity of `mins` minutes. */
function timeActivity(date: string, trackerId: ID, mins: number, hour = 10, extra: Partial<Activity> = {}): Activity {
  return makeActivity({
    type: 'timer_session',
    date,
    at: at(date, hour),
    trackerId,
    durationMs: mins * 60_000,
    ...extra,
  });
}

function makePaper(overrides: Partial<Paper> & { id: ID }): Paper {
  return {
    createdAt: 0,
    updatedAt: 0,
    title: 'Mock paper',
    sections: [],
    durationMinutes: 60,
    timed: true,
    status: 'submitted',
    startedAt: null,
    submittedAt: null,
    date: DAY,
    score: 0,
    maxScore: 100,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> & { id: ID; paperId: ID }): Question {
  return {
    createdAt: 0,
    updatedAt: 0,
    sectionId: 'sec_1',
    index: 1,
    trackerId: TRACKER_MATHS,
    marks: 4,
    negativeMarks: 1,
    expectedSeconds: 90,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<QuestionAttempt> & { id: ID; paperId: ID; questionId: ID }): QuestionAttempt {
  return {
    createdAt: 0,
    updatedAt: 0,
    sectionId: 'sec_1',
    trackerId: TRACKER_MATHS,
    status: 'correct',
    timeSpentMs: 60_000,
    visits: 1,
    mistakeType: null,
    confidence: null,
    attemptedAt: at(DAY, 10),
    ...overrides,
  };
}

function makeHabit(overrides: Partial<Habit> & { id: ID }): Habit {
  return {
    createdAt: 0,
    updatedAt: 0,
    title: 'Habit',
    trackerId: TRACKER_FITNESS,
    goalId: null,
    cadence: 'daily',
    targetPerPeriod: 1,
    targetValue: null,
    archived: false,
    currentStreak: 0,
    longestStreak: 0,
    lastCheckinDate: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    from: DAY,
    to: DAY3,
    now: new Date(at(DAY3, 21)),
    activities: [],
    tasks: [],
    blocks: [],
    sessions: [],
    papers: [],
    questions: [],
    attempts: [],
    goals: [],
    habits: [],
    revisionEntries: [],
    trackers: TRACKERS,
    ...overrides,
  };
}

const CONFIG = DEFAULT_SCHEDULING_CONFIG;

/* ------------------------------------------------------------------ */

describe('numeric helpers', () => {
  it('never divides by zero', () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(0, 0)).toBe(0);
    expect(percent(3, 0)).toBe(0);
  });

  it('computes percentages to one decimal place', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 2)).toBe(50);
  });

  it('reports null percent change when the previous value was zero', () => {
    const t = compareValues(10, 0);
    expect(t.percentChange).toBeNull();
    expect(t.direction).toBe('up');
    expect(t.delta).toBe(10);
  });

  it('flags a flat trend when nothing moved', () => {
    expect(compareValues(7, 7).direction).toBe('flat');
  });
});

describe('splitHalfTrend', () => {
  it('is flat with fewer than two samples', () => {
    expect(splitHalfTrend([]).direction).toBe('flat');
    expect(splitHalfTrend([80]).current).toBe(80);
    expect(splitHalfTrend([80]).percentChange).toBeNull();
  });

  it('compares the later half against the earlier half', () => {
    const t = splitHalfTrend([40, 40, 80, 80]);
    expect(t.previous).toBe(40);
    expect(t.current).toBe(80);
    expect(t.direction).toBe('up');
    expect(t.percentChange).toBe(100);
  });
});

describe('rootTrackerOf', () => {
  const index = trackerIndex(TRACKERS);

  it('walks up to the pillar root', () => {
    expect(rootTrackerOf(TRACKER_MATHS, index)?.id).toBe(TRACKER_STUDY);
  });

  it('returns the tracker itself when it is already a root', () => {
    expect(rootTrackerOf(TRACKER_FITNESS, index)?.id).toBe(TRACKER_FITNESS);
  });

  it('returns undefined for an unknown tracker', () => {
    expect(rootTrackerOf('nope', index)).toBeUndefined();
  });

  it('terminates on a parent cycle', () => {
    const cyclic = trackerIndex([
      makeTracker({ id: 'a', parentId: 'b' }),
      makeTracker({ id: 'b', parentId: 'a' }),
    ]);
    expect(rootTrackerOf('a', cyclic)).toBeDefined();
  });
});

describe('computeTimeDistribution', () => {
  it('sums tracked minutes per tracker and rolls them up to pillars', () => {
    const activities = [
      timeActivity(DAY, TRACKER_MATHS, 60),
      timeActivity(DAY, TRACKER_MATHS, 30),
      timeActivity(DAY2, TRACKER_FITNESS, 45),
    ];
    const d = computeTimeDistribution(activities, TRACKERS, DAY, DAY3);

    expect(d.totalMinutes).toBe(135);
    expect(d.pillarMinutes.study).toBe(90);
    expect(d.pillarMinutes.fitness).toBe(45);
    expect(d.byTracker[0]).toMatchObject({ id: TRACKER_MATHS, minutes: 90 });
    expect(d.byTracker[0].share).toBeCloseTo(90 / 135, 5);
  });

  it('ignores activities outside the window and zero-duration bookkeeping events', () => {
    const activities = [
      timeActivity('2026-01-01', TRACKER_MATHS, 999),
      makeActivity({ type: 'task_created', trackerId: TRACKER_MATHS, durationMs: 0 }),
      makeActivity({ type: 'level_up', trackerId: TRACKER_MATHS, durationMs: 60_000 }),
    ];
    expect(computeTimeDistribution(activities, TRACKERS, DAY, DAY3).totalMinutes).toBe(0);
  });

  it('returns zero shares for empty data instead of NaN', () => {
    const d = computeTimeDistribution([], TRACKERS, DAY, DAY3);
    expect(d.totalMinutes).toBe(0);
    expect(d.byTracker).toEqual([]);
    expect(d.byPillar).toEqual([]);
  });
});

describe('computeDailySeries', () => {
  it('emits one point per calendar day including empty ones', () => {
    const series = computeDailySeries([timeActivity(DAY2, TRACKER_MATHS, 30)], [], DAY, DAY3);
    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ date: DAY, minutes: 0, active: false });
    expect(series[1]).toMatchObject({ date: DAY2, minutes: 30, active: true });
  });

  it('counts completed tasks and planned block minutes separately', () => {
    const series = computeDailySeries(
      [makeActivity({ type: 'task_completed', date: DAY, durationMs: 20 * 60_000 })],
      [makeBlock({ date: DAY, start: at(DAY, 9), end: at(DAY, 11) })],
      DAY,
      DAY,
    );
    expect(series[0].tasksCompleted).toBe(1);
    expect(series[0].plannedMinutes).toBe(120);
    expect(series[0].minutes).toBe(20);
  });

  it('handles a single-day window', () => {
    expect(computeDailySeries([], [], DAY, DAY)).toHaveLength(1);
  });
});

describe('computeStreaks', () => {
  it('returns zeros for no activity', () => {
    expect(computeStreaks([], DAY)).toMatchObject({ currentStreak: 0, longestStreak: 0, consistency: 0 });
  });

  it('counts consecutive days and keeps the longest run', () => {
    const s = computeStreaks(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-06'], '2026-03-06');
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(1);
    expect(s.activeDays).toBe(4);
  });

  it('keeps yesterday-ending streaks alive today', () => {
    const s = computeStreaks(['2026-03-01', '2026-03-02'], '2026-03-03');
    expect(s.currentStreak).toBe(2);
  });

  it('breaks the current streak after a two-day gap', () => {
    expect(computeStreaks(['2026-03-01'], '2026-03-05').currentStreak).toBe(0);
  });

  it('de-duplicates repeated dates', () => {
    expect(computeStreaks([DAY, DAY, DAY], DAY).activeDays).toBe(1);
  });
});

describe('computePlannedVsActual', () => {
  it('compares recorded minutes with planned block minutes', () => {
    const blocks = [
      makeBlock({ date: DAY, start: at(DAY, 9), end: at(DAY, 10), status: 'completed' }),
      makeBlock({ date: DAY, start: at(DAY, 10), end: at(DAY, 11), status: 'skipped' }),
    ];
    const result = computePlannedVsActual(blocks, [timeActivity(DAY, TRACKER_MATHS, 60)], DAY, DAY);

    expect(result.plannedMinutes).toBe(120);
    expect(result.actualMinutes).toBe(60);
    expect(result.adherence).toBeCloseTo(0.5, 5);
    expect(result.completedBlocks).toBe(1);
    expect(result.skippedBlocks).toBe(1);
    expect(result.blockCompletionRate).toBeCloseTo(0.5, 5);
    expect(result.perfectDays).toBe(0);
  });

  it('counts a perfect day only when every planned block was completed', () => {
    const blocks = [
      makeBlock({ date: DAY, start: at(DAY, 9), end: at(DAY, 10), status: 'completed' }),
      makeBlock({ date: DAY, start: at(DAY, 11), end: at(DAY, 12), status: 'completed' }),
    ];
    expect(computePlannedVsActual(blocks, [], DAY, DAY).perfectDays).toBe(1);
  });

  it('excludes protected sleep/meal blocks from the plan', () => {
    const blocks = [makeBlock({ date: DAY, kind: 'sleep', protected: true, start: at(DAY, 0), end: at(DAY, 7) })];
    const r = computePlannedVsActual(blocks, [], DAY, DAY);
    expect(r.plannedMinutes).toBe(0);
    expect(r.summary).toContain('Nothing was scheduled');
  });

  it('does not divide by zero when nothing was planned', () => {
    const r = computePlannedVsActual([], [timeActivity(DAY, TRACKER_MATHS, 30)], DAY, DAY);
    expect(r.adherence).toBe(0);
    expect(Number.isFinite(r.blockCompletionRate)).toBe(true);
  });
});

describe('computeCompletionMetrics', () => {
  it('measures completion, on-time rate and median cycle time', () => {
    const tasks = [
      makeTask({ status: 'completed', completedAt: at(DAY, 12), createdAt: at(DAY, 8), dueDate: DAY }),
      makeTask({ status: 'completed', completedAt: at(DAY3, 12), createdAt: at(DAY, 8), dueDate: DAY }),
      makeTask({ status: 'cancelled', updatedAt: at(DAY2, 9) }),
      makeTask({ status: 'planned', dueDate: '2026-02-01' }),
    ];
    const m = computeCompletionMetrics(tasks, DAY, DAY3, DAY3);

    expect(m.completed).toBe(2);
    expect(m.cancelled).toBe(1);
    expect(m.completionRate).toBeCloseTo(2 / 3, 5);
    expect(m.onTimeCompleted).toBe(1);
    expect(m.onTimeRate).toBeCloseTo(0.5, 5);
    expect(m.medianCycleDays).toBe(1);
    expect(m.overdue).toBe(1);
  });

  it('returns null median cycle time with no completions', () => {
    const m = computeCompletionMetrics([], DAY, DAY3, DAY3);
    expect(m.medianCycleDays).toBeNull();
    expect(m.completionRate).toBe(0);
    expect(m.onTimeRate).toBe(0);
  });

  it('groups completed work by task type', () => {
    const tasks = [
      makeTask({ type: 'study', status: 'completed', completedAt: at(DAY, 12), actualMinutes: 45 }),
      makeTask({ type: 'study', status: 'completed', completedAt: at(DAY, 13), actualMinutes: 15 }),
      makeTask({ type: 'workout', status: 'completed', completedAt: at(DAY, 14), actualMinutes: 30 }),
    ];
    const m = computeCompletionMetrics(tasks, DAY, DAY3, DAY3);
    expect(m.byType[0]).toEqual({ type: 'study', completed: 2, minutes: 60 });
  });
});

describe('computeStudyMetrics', () => {
  const paper = makePaper({ id: 'pap_1', score: 60, maxScore: 100, date: DAY });
  const questions = [
    makeQuestion({ id: 'q1', paperId: 'pap_1', topic: 'Calculus' }),
    makeQuestion({ id: 'q2', paperId: 'pap_1', topic: 'Calculus' }),
    makeQuestion({ id: 'q3', paperId: 'pap_1', topic: 'Algebra' }),
  ];
  const attempts = [
    makeAttempt({ id: 'a1', paperId: 'pap_1', questionId: 'q1', status: 'correct', timeSpentMs: 60_000 }),
    makeAttempt({ id: 'a2', paperId: 'pap_1', questionId: 'q2', status: 'incorrect', mistakeType: 'calculation', timeSpentMs: 120_000 }),
    makeAttempt({ id: 'a3', paperId: 'pap_1', questionId: 'q3', status: 'incorrect', mistakeType: 'calculation', timeSpentMs: 60_000 }),
  ];

  const input = baseInput({
    activities: [timeActivity(DAY, TRACKER_MATHS, 120), timeActivity(DAY, TRACKER_FITNESS, 60)],
    sessions: [makeSession({ trackerId: TRACKER_MATHS, workMs: 120 * 60_000, pomodoroCount: 4, date: DAY })],
    papers: [paper],
    questions,
    attempts,
  });

  it('counts only study-pillar time', () => {
    expect(computeStudyMetrics(input).studyMinutes).toBe(120);
  });

  it('computes accuracy from real attempts', () => {
    const m = computeStudyMetrics(input);
    expect(m.questionsAttempted).toBe(3);
    expect(m.questionsCorrect).toBe(1);
    expect(m.accuracy).toBeCloseTo(1 / 3, 5);
    expect(m.meanSecondsPerQuestion).toBe(80);
  });

  it('aggregates mistake classifications with shares', () => {
    const m = computeStudyMetrics(input);
    expect(m.mistakes[0]).toMatchObject({ type: 'calculation', count: 2, share: 1 });
  });

  it('ranks topics worst-accuracy first', () => {
    const m = computeStudyMetrics(input);
    expect(m.byTopic[0].topic).toBe('Algebra');
    expect(m.byTopic[0].accuracy).toBe(0);
    expect(m.byTopic[1].topic).toBe('Calculus');
    expect(m.byTopic[1].accuracy).toBeCloseTo(0.5, 5);
  });

  it('summarises papers with score percentages', () => {
    const m = computeStudyMetrics(input);
    expect(m.papers[0]).toMatchObject({ paperId: 'pap_1', scorePercent: 60, attempted: 3, correct: 1 });
  });

  it('measures revision completion within the window', () => {
    const m = computeStudyMetrics(baseInput({
      revisionEntries: [
        makeRevisionEntry({ dueDate: DAY, status: 'completed', completedAt: at(DAY, 18) }),
        makeRevisionEntry({ dueDate: DAY2, status: 'missed' }),
        makeRevisionEntry({ dueDate: DAY3, status: 'scheduled' }),
      ],
    }));
    expect(m.revisionsDue).toBe(3);
    expect(m.revisionsCompleted).toBe(1);
    expect(m.revisionsMissed).toBe(1);
    expect(m.revisionCompletionRate).toBeCloseTo(1 / 3, 5);
  });

  it('handles a total absence of study data', () => {
    const m = computeStudyMetrics(baseInput());
    expect(m.studyMinutes).toBe(0);
    expect(m.accuracy).toBe(0);
    expect(m.longestSessionMinutes).toBe(0);
    expect(m.meanSessionMinutes).toBe(0);
    expect(m.mistakes).toEqual([]);
  });

  it('excludes draft papers from submitted counts', () => {
    const m = computeStudyMetrics(baseInput({ papers: [makePaper({ id: 'p2', status: 'draft' })] }));
    expect(m.papersSubmitted).toBe(0);
  });
});

describe('computePillarMetrics', () => {
  const input = baseInput({
    activities: [
      timeActivity(DAY, TRACKER_FITNESS, 45),
      timeActivity(DAY2, TRACKER_FITNESS, 45),
      makeActivity({ type: 'habit_checkin', date: DAY, trackerId: TRACKER_FITNESS, habitId: 'hab_1' }),
      timeActivity(DAY, TRACKER_MATHS, 500),
    ],
    habits: [makeHabit({ id: 'hab_1', title: 'Run', currentStreak: 3 })],
    goals: [makeGoal({ id: 'g_fit', trackerId: TRACKER_FITNESS, progress: 0.4 })],
    sessions: [makeSession({ trackerId: TRACKER_FITNESS, workMs: 45 * 60_000, date: DAY })],
  });

  it('scopes minutes to the pillar and ignores other pillars', () => {
    const m = computePillarMetrics(input, 'fitness');
    expect(m.totalMinutes).toBe(90);
    expect(m.activeDays).toBe(2);
  });

  it('projects a weekly average and compares it with the tracker target', () => {
    const m = computePillarMetrics(input, 'fitness');
    // 90 min over 3 days => 210 min/week against a 240 min target.
    expect(m.weeklyAverageMinutes).toBe(210);
    expect(m.weeklyTargetMinutes).toBe(240);
    expect(m.targetAttainment).toBeCloseTo(210 / 240, 3);
  });

  it('reports null attainment when no target is configured', () => {
    expect(computePillarMetrics(input, 'skills').targetAttainment).toBeNull();
  });

  it('counts habit check-ins from the activity log', () => {
    expect(computePillarMetrics(input, 'fitness').habits[0]).toMatchObject({ checkins: 1, currentStreak: 3 });
  });

  it('lists the pillar goals', () => {
    expect(computePillarMetrics(input, 'fitness').goals).toEqual([
      { goalId: 'g_fit', title: expect.any(String), progress: 0.4 },
    ]);
  });

  it('returns an empty but well-formed result for a pillar with no data', () => {
    const m = computePillarMetrics(baseInput(), 'personal');
    expect(m.totalMinutes).toBe(0);
    expect(m.meanSessionMinutes).toBe(0);
    expect(m.streak.currentStreak).toBe(0);
    expect(m.daily).toHaveLength(3);
  });
});

describe('computeTimeMetrics', () => {
  const input = baseInput({
    activities: [
      timeActivity(DAY, TRACKER_MATHS, 60, 9),
      timeActivity(DAY, TRACKER_MATHS, 30, 9),
      timeActivity(DAY2, TRACKER_FITNESS, 45, 18),
    ],
    blocks: [makeBlock({ date: DAY, start: at(DAY, 9), end: at(DAY, 11), status: 'completed' })],
  });

  it('buckets minutes by hour of day and finds the peak', () => {
    const m = computeTimeMetrics(input);
    expect(m.byHour).toHaveLength(24);
    expect(m.byHour[9].minutes).toBe(90);
    expect(m.byHour[18].minutes).toBe(45);
    expect(m.peakHour).toBe(9);
  });

  it('buckets minutes by weekday with a per-active-day mean', () => {
    const m = computeTimeMetrics(input);
    // DAY (2026-03-02) is a Monday.
    const monday = m.byWeekday[1];
    expect(monday.minutes).toBe(90);
    expect(monday.activeDays).toBe(1);
    expect(monday.meanMinutes).toBe(90);
  });

  it('identifies busiest and quietest active days', () => {
    const m = computeTimeMetrics(input);
    expect(m.busiestDay?.date).toBe(DAY);
    expect(m.quietestActiveDay?.date).toBe(DAY2);
  });

  it('rolls days into ISO weeks', () => {
    const m = computeTimeMetrics(input);
    expect(m.weekly).toHaveLength(1);
    expect(m.weekly[0].minutes).toBe(135);
  });

  it('has no peak hour and null extremes when nothing was recorded', () => {
    const m = computeTimeMetrics(baseInput());
    expect(m.peakHour).toBeNull();
    expect(m.busiestDay).toBeNull();
    expect(m.quietestActiveDay).toBeNull();
    expect(m.dailyAverageMinutes).toBe(0);
  });
});

describe('computeGoalMetrics', () => {
  const input = baseInput({
    goals: [
      makeGoal({ id: 'g1', progress: 0.8, weight: 1, status: 'active', startDate: DAY, targetDate: '2026-03-06' }),
      makeGoal({ id: 'g2', progress: 0.1, weight: 0.5, status: 'active', startDate: DAY, targetDate: DAY3 }),
      makeGoal({ id: 'g3', progress: 1, weight: 1, status: 'completed' }),
    ],
    activities: [
      timeActivity(DAY, TRACKER_MATHS, 60, 10, { goalId: 'g1' }),
      makeActivity({ type: 'task_completed', date: DAY, goalId: 'g1' }),
      makeActivity({ type: 'milestone_completed', date: DAY2, goalId: 'g1' }),
    ],
  });

  it('summarises statuses and weighted progress', () => {
    const m = computeGoalMetrics(input);
    expect(m.active).toBe(2);
    expect(m.completed).toBe(1);
    expect(m.meanProgress).toBeCloseTo(0.45, 5);
    // (0.8*1 + 0.1*0.5) / 1.5
    expect(m.weightedProgress).toBeCloseTo(0.85 / 1.5, 5);
  });

  it('attributes period minutes and completed tasks to goals', () => {
    const g1 = computeGoalMetrics(input).rows.find((r) => r.goalId === 'g1')!;
    expect(g1.minutesInPeriod).toBe(60);
    expect(g1.tasksCompletedInPeriod).toBe(1);
  });

  it('flags goals meaningfully behind their linear expectation', () => {
    const m = computeGoalMetrics(input);
    expect(m.atRisk.map((r) => r.goalId)).toEqual(['g2']);
    expect(m.milestonesCompletedInPeriod).toBe(1);
  });

  it('is safe with no goals at all', () => {
    const m = computeGoalMetrics(baseInput());
    expect(m.meanProgress).toBe(0);
    expect(m.weightedProgress).toBe(0);
    expect(m.rows).toEqual([]);
  });
});

describe('computePlanningAccuracy', () => {
  it('reports nothing to measure when no completed task has tracked time', () => {
    const p = computePlanningAccuracy(baseInput(), CONFIG);
    expect(p.sampleSize).toBe(0);
    expect(p.accuracyRate).toBe(0);
    expect(p.summary).toContain('No completed tasks');
  });

  it('classifies estimates as accurate, over or under', () => {
    const tasks = [
      makeTask({ status: 'completed', completedAt: at(DAY, 12), estimatedMinutes: 60, actualMinutes: 60 }),
      makeTask({ status: 'completed', completedAt: at(DAY, 13), estimatedMinutes: 60, actualMinutes: 120 }),
      makeTask({ status: 'completed', completedAt: at(DAY, 14), estimatedMinutes: 60, actualMinutes: 30 }),
    ];
    const p = computePlanningAccuracy(baseInput({ tasks }), CONFIG);
    expect(p.accurateEstimates).toBe(1);
    expect(p.underestimated).toBe(1);
    expect(p.overestimated).toBe(1);
    expect(p.accuracyRate).toBeCloseTo(1 / 3, 5);
    expect(p.sampleSize).toBe(3);
  });

  it('only surfaces predictions that clear the configured sample floor', () => {
    const tasks = [makeTask({ status: 'completed', completedAt: at(DAY, 12), estimatedMinutes: 60, actualMinutes: 90 })];
    const p = computePlanningAccuracy(baseInput({ tasks }), CONFIG);
    expect(p.predictions).toEqual([]);
  });
});

describe('computeWeeklyReview', () => {
  const input = baseInput({
    from: DAY,
    to: DAY3,
    activities: [
      timeActivity(DAY, TRACKER_MATHS, 300),
      timeActivity(DAY2, TRACKER_FITNESS, 20),
      makeActivity({ type: 'task_completed', date: DAY, trackerId: TRACKER_MATHS }),
    ],
    tasks: [makeTask({ status: 'completed', completedAt: at(DAY, 12) })],
    revisionEntries: [makeRevisionEntry({ dueDate: DAY, status: 'completed', completedAt: at(DAY, 18) })],
  });

  it('names the strongest area from measured minutes with the supporting figure', () => {
    const r = computeWeeklyReview(input);
    expect(r.strongest?.label).toBe('Study');
    expect(r.strongest?.minutes).toBe(300);
    expect(r.strongest?.evidence).toContain('300 min');
  });

  it('names the area furthest below its own weekly target', () => {
    const r = computeWeeklyReview(input);
    // Study: 300/900 = 33%; Fitness: 20 min over 3 days => ~47/240 weekly = far lower.
    expect(r.needsAttention?.label).toBe('Fitness');
    expect(r.needsAttention?.evidence).toContain('target');
  });

  it('carries the headline weekly numbers', () => {
    const r = computeWeeklyReview(input);
    expect(r.tasksCompleted).toBe(1);
    expect(r.studyMinutes).toBe(300);
    expect(r.fitnessMinutes).toBe(20);
    expect(r.activeDays).toBe(2);
    expect(r.revisionsCompleted).toBe(1);
    expect(r.revisionCompletionRate).toBe(1);
  });

  it('reports a flat accuracy change when no papers exist in either period', () => {
    const r = computeWeeklyReview(input);
    expect(r.accuracy).toBe(0);
    expect(r.accuracyChange.direction).toBe('flat');
  });

  it('produces no verdicts at all when nothing was recorded', () => {
    const r = computeWeeklyReview(baseInput());
    expect(r.strongest).toBeNull();
    expect(r.totalMinutes).toBe(0);
    // With no minutes anywhere, the weakest still resolves via the target list.
    expect(r.needsAttention).not.toBeNull();
  });
});

describe('computeDailyReview', () => {
  const tasks = [
    makeTask({ id: 'done', status: 'completed', completedAt: at(DAY, 12) }),
    makeTask({ id: 'open', status: 'planned', dueDate: DAY }),
    makeTask({ id: 'late', status: 'planned', dueDate: '2026-02-20' }),
    makeTask({ id: 'future', status: 'planned', dueDate: '2026-04-01' }),
  ];
  const input = baseInput({
    tasks,
    activities: [
      timeActivity(DAY, TRACKER_MATHS, 90, 10, { goalId: 'g1' }),
      makeActivity({ type: 'habit_checkin', date: DAY }),
      makeActivity({ type: 'revision_completed', date: DAY, durationMs: 25 * 60_000 }),
    ],
    blocks: [
      makeBlock({ date: DAY, start: at(DAY, 9), end: at(DAY, 10), status: 'completed' }),
      makeBlock({ date: DAY, start: at(DAY, 10), end: at(DAY, 11), status: 'skipped' }),
    ],
    goals: [makeGoal({ id: 'g1', progress: 0.25 })],
  });

  it('separates completed from still-open work for the day', () => {
    const r = computeDailyReview(input, DAY, 40);
    expect(r.completedTasks.map((t) => t.id)).toEqual(['done']);
    expect(r.incompleteTasks.map((t) => t.id).sort()).toEqual(['late', 'open']);
  });

  it('reports tracked vs planned time and block outcomes', () => {
    const r = computeDailyReview(input, DAY, 40);
    expect(r.minutesTracked).toBe(115);
    expect(r.plannedMinutes).toBe(120);
    expect(r.blocksCompleted).toBe(1);
    expect(r.blocksSkipped).toBe(1);
    expect(r.blocksPlanned).toBe(2);
  });

  it('lists goals touched and passes XP through', () => {
    const r = computeDailyReview(input, DAY, 40);
    expect(r.goalsTouched[0]).toMatchObject({ goalId: 'g1', minutes: 90, progress: 0.25 });
    expect(r.xpEarned).toBe(40);
    expect(r.habitCheckins).toBe(1);
    expect(r.revisionsCompleted).toBe(1);
  });

  it('says so plainly when the day is empty', () => {
    const r = computeDailyReview(baseInput(), DAY2, 0);
    expect(r.summary).toBe('Nothing recorded for this day yet.');
    expect(r.completedTasks).toEqual([]);
  });
});

describe('computeAnalytics', () => {
  it('assembles every section in a single pass', () => {
    const result = computeAnalytics(
      baseInput({
        activities: [timeActivity(DAY, TRACKER_MATHS, 60), timeActivity(DAY, TRACKER_FITNESS, 30)],
        tasks: [makeTask({ status: 'completed', completedAt: at(DAY, 12) })],
      }),
      CONFIG,
    );

    expect(result.overview.totalMinutes).toBe(90);
    expect(result.overview.strongestPillar?.label).toBe('Study');
    expect(result.study.studyMinutes).toBe(60);
    expect(result.fitness.totalMinutes).toBe(30);
    expect(result.skills.totalMinutes).toBe(0);
    expect(result.time.byHour).toHaveLength(24);
    expect(result.goals.rows).toEqual([]);
    expect(result.planning.sampleSize).toBe(0);
  });

  it('survives entirely empty input', () => {
    const result = computeAnalytics(baseInput(), CONFIG);
    expect(result.overview.headline).toContain('Nothing recorded');
    expect(result.overview.minutesTrend.direction).toBe('flat');
    expect(result.overview.dayCount).toBe(3);
  });

  it('compares the window with the equally long preceding window', () => {
    const activities = [
      timeActivity('2026-02-27', TRACKER_MATHS, 30),
      timeActivity(DAY, TRACKER_MATHS, 90),
    ];
    const result = computeAnalytics(baseInput({ activities }), CONFIG);
    expect(result.overview.minutesTrend.previous).toBe(30);
    expect(result.overview.minutesTrend.current).toBe(90);
    expect(result.overview.minutesTrend.direction).toBe('up');
  });

  it('keeps timestamps timezone-stable via atMinute', () => {
    // Sanity guard: fixtures build timestamps from local minute offsets, so the
    // hour bucketing above is deterministic in any timezone.
    expect(atMinute(DAY, 9 * 60)).toBe(at(DAY, 9));
  });
});
