import { toDateKey } from '@/lib/date';
import type { PomodoroPhase, TimerSegment, TimerSession } from '@/types';
import type { DemoContext } from './world';

/**
 * TimerSessions — the real recorded time behind every "actual minutes" number.
 *
 * One session is written for each completed task block, using that block's
 * actual start/end so the session, the block and the task all agree. On top of
 * that, standalone stopwatch and pomodoro sessions are scattered across the
 * history so the Time analytics heatmap (hour of day x day of week) has
 * something to show instead of a single vertical stripe.
 */
export function seedSessions(ctx: DemoContext): void {
  const taskById = new Map(ctx.world.tasks.map((t) => [t.id, t]));

  for (const block of ctx.world.blocks) {
    if (block.kind !== 'task') continue;
    if (block.actualStart === null || block.actualEnd === null) continue;
    const task = block.taskId ? taskById.get(block.taskId) : undefined;

    const workMs = Math.max(60_000, block.actualEnd - block.actualStart);
    const mode = ctx.rng.weighted<TimerSession['mode']>([
      ['focus', 6], ['pomodoro', 3], ['stopwatch', 1],
    ]);

    const segments: TimerSegment[] = [];
    let breakMs = 0;
    let pomodoroCount = 0;

    if (mode === 'pomodoro') {
      // 25/5 cycles until the recorded work time is consumed.
      let cursor = block.actualStart;
      let remaining = workMs;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 25 * 60_000);
        segments.push({ start: cursor, end: cursor + chunk, phase: 'work' as PomodoroPhase });
        cursor += chunk;
        remaining -= chunk;
        pomodoroCount += chunk >= 24 * 60_000 ? 1 : 0;
        if (remaining > 0) {
          const rest = 5 * 60_000;
          segments.push({ start: cursor, end: cursor + rest, phase: 'short_break' });
          cursor += rest;
          breakMs += rest;
        }
      }
    } else {
      segments.push({ start: block.actualStart, end: block.actualEnd, phase: 'work' });
    }

    const endedAt = segments[segments.length - 1]!.end;
    const session: TimerSession = {
      id: ctx.id('ses'),
      createdAt: block.actualStart,
      updatedAt: endedAt,
      mode,
      taskId: block.taskId,
      blockId: block.id,
      goalId: block.goalId,
      trackerId: block.trackerId,
      paperId: null,
      resourceId: null,
      startedAt: block.actualStart,
      endedAt,
      workMs,
      breakMs,
      plannedMs: task ? task.estimatedMinutes * 60_000 : null,
      segments,
      pomodoroCount,
      interruptions: ctx.rng.weighted<number>([[0, 6], [1, 3], [2, 1]]),
      completed: block.status === 'completed',
      date: toDateKey(block.actualStart),
    };
    ctx.world.sessions.push(session);

    ctx.world.activities.push({
      id: ctx.id('act'),
      createdAt: endedAt,
      updatedAt: endedAt,
      type: 'timer_session',
      at: endedAt,
      date: session.date,
      trackerId: session.trackerId,
      taskId: session.taskId,
      goalId: session.goalId,
      blockId: session.blockId,
      sessionId: session.id,
      paperId: null,
      revisionEntryId: null,
      habitId: null,
      resourceId: null,
      durationMs: workMs,
      value: null,
      unit: null,
      title: block.title,
      meta: { mode, pomodoroCount, interruptions: session.interruptions },
    });
  }

  seedStandaloneSessions(ctx);
}

/**
 * Untethered sessions — reading before bed, an early-morning revision block,
 * a late-night coding push. These are what put activity in the unusual hours
 * of the Time heatmap, and they feed the early-bird / night-owl achievements.
 */
function seedStandaloneSessions(ctx: DemoContext): void {
  const flavours: { trackerId: string; title: string; hour: [number, number]; minutes: [number, number] }[] = [
    { trackerId: 'trk_demo_reading', title: 'Reading before bed', hour: [21, 22], minutes: [20, 45] },
    { trackerId: 'trk_demo_maths', title: 'Early revision', hour: [5, 6], minutes: [25, 55] },
    { trackerId: 'trk_demo_coding', title: 'Late coding push', hour: [22, 23], minutes: [30, 70] },
    { trackerId: 'trk_demo_guitar', title: 'Guitar noodling', hour: [16, 18], minutes: [15, 35] },
    { trackerId: 'trk_demo_journal', title: 'Journalling', hour: [22, 22], minutes: [10, 20] },
    { trackerId: 'trk_demo_physics', title: 'Formula sheet drill', hour: [6, 7], minutes: [20, 40] },
    { trackerId: 'trk_demo_mobility', title: 'Stretching', hour: [7, 8], minutes: [10, 20] },
  ];

  for (const day of ctx.pastDays) {
    const count = ctx.rng.weighted<number>([[0, 3], [1, 5], [2, 2]]);
    for (let i = 0; i < count; i++) {
      const flavour = ctx.rng.pick(flavours);
      const minutes = ctx.rng.int(flavour.minutes[0], flavour.minutes[1]);
      const startMinute = ctx.rng.int(flavour.hour[0], flavour.hour[1]) * 60 + ctx.rng.int(0, 55);
      const startedAt = ctx.at(day, startMinute);
      const workMs = minutes * 60_000;
      const endedAt = startedAt + workMs;

      const session: TimerSession = {
        id: ctx.id('ses'),
        createdAt: startedAt,
        updatedAt: endedAt,
        mode: ctx.rng.weighted<TimerSession['mode']>([['stopwatch', 4], ['focus', 4], ['pomodoro', 1]]),
        taskId: null,
        blockId: null,
        goalId: null,
        trackerId: flavour.trackerId,
        paperId: null,
        resourceId: null,
        startedAt,
        endedAt,
        workMs,
        breakMs: 0,
        plannedMs: null,
        segments: [{ start: startedAt, end: endedAt, phase: 'work' }],
        pomodoroCount: 0,
        interruptions: ctx.rng.weighted<number>([[0, 8], [1, 2]]),
        completed: true,
        date: day,
      };
      ctx.world.sessions.push(session);

      ctx.world.activities.push({
        id: ctx.id('act'),
        createdAt: endedAt,
        updatedAt: endedAt,
        type: 'timer_session',
        at: endedAt,
        date: day,
        trackerId: session.trackerId,
        taskId: null,
        goalId: null,
        blockId: null,
        sessionId: session.id,
        paperId: null,
        revisionEntryId: null,
        habitId: null,
        resourceId: null,
        durationMs: workMs,
        value: null,
        unit: null,
        title: flavour.title,
        meta: { mode: session.mode, standalone: true },
      });
    }
  }
}
