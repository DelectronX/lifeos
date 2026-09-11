import { dateKeyToDate } from '@/lib/date';
import type { Activity, ActivityType } from '@/types';
import type { DemoContext } from './world';

/**
 * Activity rows for everything that is not already logged by its own module.
 *
 * Task lifecycle, block outcomes and the guided reviews all land here. Timer,
 * paper, revision, habit, milestone and goal activities are written by their
 * own seed modules at the moment they create the underlying record, which is
 * the same ordering the live app produces.
 */
export function seedActivities(ctx: DemoContext): void {
  const activities: Activity[] = [];

  /* --- tasks ----------------------------------------------------------- */
  for (const task of ctx.world.tasks) {
    activities.push(make(ctx, 'task_created', task.createdAt, {
      trackerId: task.trackerId,
      taskId: task.id,
      goalId: task.goalId,
      title: task.title,
    }));

    const terminal = task.statusHistory[task.statusHistory.length - 1];
    if (!terminal) continue;

    const typeByStatus: Partial<Record<string, ActivityType>> = {
      completed: 'task_completed',
      skipped: 'task_skipped',
      cancelled: 'task_cancelled',
      rescheduled: 'task_rescheduled',
    };
    const type = typeByStatus[terminal.to];
    if (!type) continue;

    activities.push(make(ctx, type, terminal.at, {
      trackerId: task.trackerId,
      taskId: task.id,
      goalId: task.goalId,
      title: task.title,
      durationMs: type === 'task_completed' ? task.actualMinutes * 60_000 : 0,
      meta: {
        estimatedMinutes: task.estimatedMinutes,
        actualMinutes: task.actualMinutes,
        basePriority: task.basePriority,
        intensity: task.intensity,
        onTime: task.dueDate !== null && task.completedAt !== null
          ? ctx.day(0) >= task.dueDate || task.dueDate >= dayKeyOf(ctx, task.completedAt)
          : false,
      },
    }));
  }

  /* --- blocks ---------------------------------------------------------- */
  for (const block of ctx.world.blocks) {
    if (block.kind !== 'task') continue;
    if (block.status === 'completed') {
      const at = block.actualEnd ?? block.end;
      activities.push(make(ctx, 'block_completed', at, {
        trackerId: block.trackerId,
        taskId: block.taskId,
        goalId: block.goalId,
        blockId: block.id,
        title: block.title,
        durationMs: Math.max(0, (block.actualEnd ?? block.end) - (block.actualStart ?? block.start)),
        meta: {
          plannedMs: block.end - block.start,
          startedLateMs: (block.actualStart ?? block.start) - block.start,
        },
      }));
    } else if (block.status === 'skipped' && block.date < ctx.today) {
      activities.push(make(ctx, 'block_skipped', block.end, {
        trackerId: block.trackerId,
        taskId: block.taskId,
        blockId: block.id,
        title: block.title,
      }));
    }
  }

  /* --- daily + weekly reviews ------------------------------------------ */
  for (const day of ctx.pastDays) {
    if (ctx.rng.chance(0.66)) {
      activities.push(make(ctx, 'daily_review', ctx.at(day, 21 * 60 + ctx.rng.int(0, 45)), {
        title: 'Daily review',
        meta: { day },
      }));
    }
    if (dateKeyToDate(day).getDay() === 0 && ctx.rng.chance(0.8)) {
      activities.push(make(ctx, 'weekly_review', ctx.at(day, 19 * 60 + ctx.rng.int(0, 40)), {
        title: 'Weekly review',
        meta: { weekEnding: day },
      }));
    }
  }

  ctx.world.activities.push(...activities);
  ctx.world.activities.sort((a, b) => a.at - b.at);
}

function dayKeyOf(ctx: DemoContext, at: number): string {
  return ctx.day(Math.round((at - ctx.todayStart) / 86_400_000));
}

function make(
  ctx: DemoContext,
  type: ActivityType,
  at: number,
  fields: Partial<Omit<Activity, 'id' | 'type' | 'at' | 'date'>> & { title: string },
): Activity {
  return {
    id: ctx.id('act'),
    createdAt: at,
    updatedAt: at,
    type,
    at,
    date: dayKeyOf(ctx, at),
    trackerId: fields.trackerId ?? null,
    taskId: fields.taskId ?? null,
    goalId: fields.goalId ?? null,
    blockId: fields.blockId ?? null,
    sessionId: fields.sessionId ?? null,
    paperId: fields.paperId ?? null,
    revisionEntryId: fields.revisionEntryId ?? null,
    habitId: fields.habitId ?? null,
    resourceId: fields.resourceId ?? null,
    durationMs: Math.max(0, Math.round(fields.durationMs ?? 0)),
    value: fields.value ?? null,
    unit: fields.unit ?? null,
    title: fields.title,
    meta: fields.meta ?? {},
  };
}
