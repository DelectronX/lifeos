import type {
  Goal, ID, RevisionEntry, RevisionPlan, ScheduleBlock, Task, TimerSession,
  TrackerColor, WorkingHours,
} from '@/types';
import type { SchedulingPreferences } from '@/types/scheduling';
import { atMinute } from '@/lib/date';

/**
 * Deterministic fixtures for the scheduling engine tests.
 *
 * Every timestamp is derived from an explicit date key + minute-of-day, so the
 * suite behaves identically in any timezone and never reads the wall clock.
 */

export const DAY = '2026-03-02'; // a Monday
export const DAY2 = '2026-03-03';
export const DAY3 = '2026-03-04';

/** Local timestamp for `HH:MM` on a given date key. */
export function at(date: string, hour: number, minute = 0): number {
  return atMinute(date, hour * 60 + minute);
}

/** A reference "now" — 8:00 AM on DAY. */
export function nowAt(date = DAY, hour = 8, minute = 0): Date {
  return new Date(at(date, hour, minute));
}

/** 9:00-18:00 every day of the week. */
export const ALL_DAY_HOURS: WorkingHours = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ startMinute: 9 * 60, endMinute: 18 * 60 }]]),
);

export const PREFS: SchedulingPreferences = {
  workingHours: ALL_DAY_HOURS,
  focusHours: [{ startMinute: 9 * 60, endMinute: 12 * 60 }],
};

export function prefs(overrides: Partial<SchedulingPreferences> = {}): SchedulingPreferences {
  return { ...PREFS, ...overrides };
}

let seq = 0;
export function resetIds(): void { seq = 0; }
function nextId(prefix: string): ID { return `${prefix}_${++seq}`; }

export const TRACKER_STUDY: ID = 'trk_study';
export const TRACKER_FITNESS: ID = 'trk_fitness';

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? nextId('task');
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    title: `Task ${id}`,
    trackerId: TRACKER_STUDY,
    goalId: null,
    milestoneId: null,
    parentTaskId: null,
    type: 'study',
    status: 'planned',
    statusHistory: [],
    basePriority: 3,
    dueDate: null,
    deadlineHard: false,
    estimatedMinutes: 60,
    actualMinutes: 0,
    dependsOn: [],
    tags: [],
    preferredWindow: 'any',
    intensity: 'medium',
    splittable: false,
    minSessionMinutes: 20,
    maxSessionMinutes: 120,
    resourceIds: [],
    recurringRuleId: null,
    revisionEntryId: null,
    priorityScore: 0,
    priorityComputedAt: null,
    completedAt: null,
    rescheduleCount: 0,
    sortOrder: 0,
    ...overrides,
  };
}

export function makeBlock(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  const id = overrides.id ?? nextId('blk');
  const start = overrides.start ?? at(DAY, 9);
  const end = overrides.end ?? start + 60 * 60_000;
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    title: `Block ${id}`,
    date: DAY,
    start,
    end,
    trackerId: TRACKER_STUDY,
    kind: 'task',
    taskId: null,
    goalId: null,
    resourceId: null,
    status: 'planned',
    locked: false,
    protected: false,
    origin: 'manual',
    planRunId: null,
    splitGroupId: null,
    splitIndex: 0,
    splitCount: 1,
    actualStart: null,
    actualEnd: null,
    ...overrides,
  };
}

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const id = overrides.id ?? nextId('goal');
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    title: `Goal ${id}`,
    type: 'completion',
    trackerId: TRACKER_STUDY,
    status: 'active',
    startDate: DAY,
    targetDate: null,
    targetValue: null,
    weight: 0.5,
    progress: 0,
    progressComputedAt: null,
    completedAt: null,
    color: 'indigo' as TrackerColor,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<TimerSession> = {}): TimerSession {
  const id = overrides.id ?? nextId('ses');
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    mode: 'focus',
    taskId: null,
    blockId: null,
    goalId: null,
    trackerId: TRACKER_STUDY,
    paperId: null,
    startedAt: at(DAY, 9),
    endedAt: at(DAY, 10),
    workMs: 60 * 60_000,
    breakMs: 0,
    plannedMs: null,
    segments: [],
    pomodoroCount: 0,
    interruptions: 0,
    completed: true,
    date: DAY,
    ...overrides,
  };
}

export function makeRevisionPlan(overrides: Partial<RevisionPlan> = {}): RevisionPlan {
  const id = overrides.id ?? nextId('rplan');
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    title: `Plan ${id}`,
    trackerId: TRACKER_STUDY,
    sourceType: 'topic',
    sourceId: null,
    intervals: [1, 3, 7, 14, 30],
    currentIndex: 0,
    ease: 2.5,
    status: 'active',
    startDate: DAY,
    lastRevisedAt: null,
    defaultDurationMinutes: 25,
    ...overrides,
  };
}

export function makeRevisionEntry(overrides: Partial<RevisionEntry> = {}): RevisionEntry {
  const id = overrides.id ?? nextId('rent');
  return {
    id,
    createdAt: at(DAY, 0),
    updatedAt: at(DAY, 0),
    planId: 'rplan_1',
    trackerId: TRACKER_STUDY,
    dueDate: DAY,
    repetition: 0,
    intervalDays: 1,
    status: 'scheduled',
    completedAt: null,
    quality: null,
    taskId: null,
    durationMinutes: 25,
    ...overrides,
  };
}

/** Minutes between two timestamps. */
export function minutes(a: number, b: number): number {
  return Math.round((b - a) / 60_000);
}
