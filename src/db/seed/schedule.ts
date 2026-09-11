import { dateKeyToDate } from '@/lib/date';
import type {
  BlockKind, BlockStatus, DateKey, RecurringRule, ScheduleBlock, ScheduleTemplate,
  ScheduleTemplateEntry, Task,
} from '@/types';
import type { DemoContext } from './world';

/**
 * Schedule generation.
 *
 * The day is built the way a real week actually is: protected time first
 * (sleep, school, meals — the scheduler may never write over these), then the
 * day's tasks packed into whatever is left. Past blocks carry a status that
 * agrees with their task's status, and past completed blocks record
 * actualStart/actualEnd, which is what makes the planned-vs-actual analytics
 * non-trivial.
 */

interface Window { start: number; end: number }

const WEEKDAY_WINDOWS: Window[] = [
  { start: 6 * 60 + 45, end: 7 * 60 + 45 },
  { start: 15 * 60 + 30, end: 17 * 60 + 0 },
  { start: 17 * 60 + 15, end: 19 * 60 + 45 },
  { start: 21 * 60 + 0, end: 22 * 60 + 45 },
];

const WEEKEND_WINDOWS: Window[] = [
  { start: 9 * 60, end: 12 * 60 + 30 },
  { start: 14 * 60 + 30, end: 18 * 60 },
  { start: 20 * 60 + 45, end: 22 * 60 + 30 },
];

function protectedEntries(weekend: boolean): {
  title: string; kind: BlockKind; trackerId: string; start: number; end: number;
}[] {
  const rows = [
    { title: 'Sleep', kind: 'sleep' as BlockKind, trackerId: 'trk_sleep', start: 0, end: 6 * 60 + 30 },
    { title: 'Sleep', kind: 'sleep' as BlockKind, trackerId: 'trk_sleep', start: 23 * 60, end: 24 * 60 },
    { title: 'Dinner', kind: 'meal' as BlockKind, trackerId: 'trk_meals', start: 19 * 60 + 50, end: 20 * 60 + 35 },
  ];
  if (weekend) {
    rows.push({ title: 'Lunch', kind: 'meal', trackerId: 'trk_meals', start: 13 * 60, end: 13 * 60 + 45 });
  } else {
    rows.push({ title: 'School', kind: 'fixed', trackerId: 'trk_school', start: 8 * 60, end: 14 * 60 + 30 });
    rows.push({ title: 'Lunch', kind: 'meal', trackerId: 'trk_meals', start: 14 * 60 + 45, end: 15 * 60 + 15 });
  }
  return rows;
}

function blockStatusForTask(task: Task, past: boolean): BlockStatus {
  if (!past) return 'planned';
  switch (task.status) {
    case 'completed': return 'completed';
    case 'skipped': return 'skipped';
    case 'cancelled': return 'cancelled';
    case 'rescheduled': return 'skipped';
    case 'in_progress': return 'partial';
    default: return 'planned';
  }
}

export function seedSchedule(ctx: DemoContext): void {
  const byDay = new Map<DateKey, Task[]>();
  for (const task of ctx.world.tasks) {
    if (!task.dueDate) continue;
    const list = byDay.get(task.dueDate) ?? [];
    list.push(task);
    byDay.set(task.dueDate, list);
  }

  for (const day of ctx.days) {
    const date = dateKeyToDate(day);
    const weekend = [0, 6].includes(date.getDay());
    const past = day < ctx.today;

    for (const entry of protectedEntries(weekend)) {
      ctx.world.blocks.push(makeBlock(ctx, {
        day,
        title: entry.title,
        kind: entry.kind,
        trackerId: entry.trackerId,
        startMinute: entry.start,
        endMinute: entry.end,
        status: past ? 'completed' : 'planned',
        isProtected: true,
        locked: entry.kind === 'sleep',
        origin: 'template',
      }));
    }

    const windows = (weekend ? WEEKEND_WINDOWS : WEEKDAY_WINDOWS).map((w) => ({ ...w }));
    let windowIndex = 0;
    let cursor = windows[0]!.start;

    const dayTasks = (byDay.get(day) ?? []).filter((t) => t.status !== 'cancelled');
    for (const task of dayTasks) {
      const duration = Math.min(task.estimatedMinutes, 120);
      // Find the next window with room; give up on the day if none is left.
      while (windowIndex < windows.length && cursor + duration > windows[windowIndex]!.end) {
        windowIndex += 1;
        if (windowIndex < windows.length) cursor = windows[windowIndex]!.start;
      }
      if (windowIndex >= windows.length) break;

      const status = blockStatusForTask(task, past);
      const startMinute = cursor;
      const endMinute = cursor + duration;
      const block = makeBlock(ctx, {
        day,
        title: task.title,
        kind: 'task',
        trackerId: task.trackerId,
        startMinute,
        endMinute,
        status,
        taskId: task.id,
        goalId: task.goalId,
        origin: ctx.rng.chance(0.25) ? 'scheduler' : 'manual',
      });

      if (status === 'completed') {
        // Real days slip: the block was started a few minutes late and ran
        // for the task's ACTUAL duration, not its estimate.
        const drift = ctx.rng.int(-5, 12);
        block.actualStart = ctx.at(day, startMinute + drift);
        block.actualEnd = block.actualStart + Math.max(5, task.actualMinutes) * 60_000;
      } else if (status === 'partial') {
        block.actualStart = ctx.at(day, startMinute);
        block.actualEnd = block.actualStart + Math.max(5, task.actualMinutes) * 60_000;
      }

      ctx.world.blocks.push(block);
      cursor = endMinute + 10;
    }

    // A short break block after a long stretch keeps the day readable.
    if (!weekend && ctx.rng.chance(0.4)) {
      ctx.world.blocks.push(makeBlock(ctx, {
        day,
        title: 'Break',
        kind: 'break',
        trackerId: 'trk_break',
        startMinute: 17 * 60,
        endMinute: 17 * 60 + 15,
        status: past ? 'completed' : 'planned',
        origin: 'manual',
      }));
    }
  }

  seedTemplates(ctx);
  seedRecurringRules(ctx);
}

interface BlockSpec {
  day: DateKey;
  title: string;
  kind: BlockKind;
  trackerId: string;
  startMinute: number;
  endMinute: number;
  status: BlockStatus;
  taskId?: string | null;
  goalId?: string | null;
  isProtected?: boolean;
  locked?: boolean;
  origin?: ScheduleBlock['origin'];
  recurringRuleId?: string | null;
  templateId?: string | null;
}

function makeBlock(ctx: DemoContext, spec: BlockSpec): ScheduleBlock {
  const createdAt = ctx.at(spec.day, 0) - 86_400_000;
  return {
    id: ctx.id('blk'),
    createdAt,
    updatedAt: createdAt,
    title: spec.title,
    date: spec.day,
    start: ctx.at(spec.day, spec.startMinute),
    end: ctx.at(spec.day, spec.endMinute),
    trackerId: spec.trackerId,
    kind: spec.kind,
    taskId: spec.taskId ?? null,
    goalId: spec.goalId ?? null,
    resourceId: null,
    status: spec.status,
    locked: spec.locked ?? false,
    protected: spec.isProtected ?? false,
    origin: spec.origin ?? 'manual',
    planRunId: null,
    splitGroupId: null,
    splitIndex: 0,
    splitCount: 1,
    actualStart: null,
    actualEnd: null,
    recurringRuleId: spec.recurringRuleId ?? null,
    occurrenceDate: spec.recurringRuleId ? spec.day : null,
    templateId: spec.templateId ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Templates + recurring rules                                         */
/* ------------------------------------------------------------------ */

function seedTemplates(ctx: DemoContext): void {
  const createdAt = ctx.at(ctx.day(-70), 10 * 60);

  const schoolWeek: ScheduleTemplateEntry[] = [];
  for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
    const weekend = dayOfWeek === 0 || dayOfWeek === 6;
    schoolWeek.push(entry(ctx, dayOfWeek, 0, 6 * 60 + 30, 'Sleep', 'trk_sleep', 'sleep', true, true));
    schoolWeek.push(entry(ctx, dayOfWeek, 23 * 60, 24 * 60, 'Sleep', 'trk_sleep', 'sleep', true, true));
    schoolWeek.push(entry(ctx, dayOfWeek, 19 * 60 + 50, 20 * 60 + 35, 'Dinner', 'trk_meals', 'meal', true, false));
    if (!weekend) {
      schoolWeek.push(entry(ctx, dayOfWeek, 8 * 60, 14 * 60 + 30, 'School', 'trk_school', 'fixed', true, true));
      schoolWeek.push(entry(ctx, dayOfWeek, 14 * 60 + 45, 15 * 60 + 15, 'Lunch', 'trk_meals', 'meal', true, false));
      schoolWeek.push(entry(ctx, dayOfWeek, 15 * 60 + 30, 17 * 60, 'Afternoon study', 'trk_study', 'task', false, false));
    } else {
      schoolWeek.push(entry(ctx, dayOfWeek, 13 * 60, 13 * 60 + 45, 'Lunch', 'trk_meals', 'meal', true, false));
      schoolWeek.push(entry(ctx, dayOfWeek, 9 * 60, 12 * 60, 'Long study block', 'trk_study', 'task', false, false));
    }
  }

  const holidayWeek: ScheduleTemplateEntry[] = [];
  for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
    holidayWeek.push(entry(ctx, dayOfWeek, 0, 7 * 60 + 30, 'Sleep', 'trk_sleep', 'sleep', true, true));
    holidayWeek.push(entry(ctx, dayOfWeek, 9 * 60, 12 * 60, 'Morning deep work', 'trk_study', 'task', false, false));
    holidayWeek.push(entry(ctx, dayOfWeek, 13 * 60, 13 * 60 + 45, 'Lunch', 'trk_meals', 'meal', true, false));
    holidayWeek.push(entry(ctx, dayOfWeek, 16 * 60, 17 * 60 + 30, 'Training', 'trk_fitness', 'task', false, false));
    holidayWeek.push(entry(ctx, dayOfWeek, 19 * 60 + 50, 20 * 60 + 35, 'Dinner', 'trk_meals', 'meal', true, false));
  }

  const templates: ScheduleTemplate[] = [
    {
      id: 'tpl_demo_school',
      createdAt,
      updatedAt: createdAt,
      name: 'School week',
      description: 'Term-time skeleton: school, meals and sleep protected, study slots around them.',
      entries: schoolWeek,
      active: true,
    },
    {
      id: 'tpl_demo_holiday',
      createdAt,
      updatedAt: createdAt,
      name: 'Study holiday',
      description: 'No school. Long morning deep-work block and an afternoon training slot.',
      entries: holidayWeek,
      active: false,
    },
  ];

  ctx.world.templates.push(...templates);
}

function entry(
  ctx: DemoContext, dayOfWeek: number, startMinute: number, endMinute: number,
  title: string, trackerId: string, kind: BlockKind, isProtected: boolean, locked: boolean,
): ScheduleTemplateEntry {
  return {
    id: ctx.id('tge'),
    dayOfWeek,
    startMinute,
    endMinute,
    title,
    trackerId,
    kind,
    protected: isProtected,
    locked,
  };
}

function seedRecurringRules(ctx: DemoContext): void {
  const createdAt = ctx.at(ctx.day(-60), 10 * 60);

  const gym: RecurringRule = {
    id: 'rrl_demo_gym',
    createdAt,
    updatedAt: createdAt,
    title: 'Gym session',
    freq: 'weekly',
    interval: 1,
    byWeekday: [1, 3, 5],
    byMonthDay: [],
    startDate: ctx.day(-60),
    endDate: null,
    count: null,
    target: 'block',
    taskTemplate: null,
    blockTemplate: {
      startMinute: 17 * 60 + 30,
      durationMinutes: 60,
      trackerId: 'trk_demo_strength',
      title: 'Gym session',
      kind: 'task',
      protected: false,
    },
    lastGeneratedDate: ctx.day(-1),
    active: true,
    // One occurrence deliberately removed — a real series always has a hole.
    exceptions: [nextWeekday(ctx, 3)],
    overrides: {
      [nextWeekday(ctx, 5)]: {
        title: 'Gym session (short)',
        durationMinutes: 35,
        notes: 'Cut short — physics paper the next morning.',
      },
    },
  };

  const weeklyReview: RecurringRule = {
    id: 'rrl_demo_review',
    createdAt,
    updatedAt: createdAt,
    title: 'Weekly review',
    freq: 'weekly',
    interval: 1,
    byWeekday: [0],
    byMonthDay: [],
    startDate: ctx.day(-60),
    endDate: null,
    count: null,
    target: 'task',
    taskTemplate: {
      title: 'Weekly review',
      trackerId: 'trk_personal',
      type: 'admin',
      estimatedMinutes: 30,
      basePriority: 4,
      intensity: 'low',
      preferredWindow: 'evening',
    },
    blockTemplate: null,
    lastGeneratedDate: ctx.day(-1),
    active: true,
    exceptions: [],
  };

  ctx.world.recurringRules.push(gym, weeklyReview);
}

/** The next date (strictly in the future) falling on `weekday`. */
function nextWeekday(ctx: DemoContext, weekday: number): DateKey {
  for (let offset = 1; offset <= 14; offset++) {
    const key = ctx.day(offset);
    if (dateKeyToDate(key).getDay() === weekday) return key;
  }
  return ctx.day(7);
}
