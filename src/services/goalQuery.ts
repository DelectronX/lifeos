import { db } from '@/db/db';
import { computeGoalProgress, type GoalProgressResult } from '@/engines/goalProgress';
import { buildGoalProgressInput, recomputeGoalProgress } from './goalService';
import { todayKey } from '@/lib/date';
import type { Goal, GoalType, ID, Milestone, Task } from '@/types';

/**
 * Goal presentation helpers: labels, the goal->milestone->task tree, and
 * progress computed through the (read-only) GoalProgressEngine.
 */

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  completion: 'Completion',
  milestone: 'Milestone',
  metric: 'Metric',
  time: 'Time',
  habit: 'Habit',
};

export const GOAL_TYPE_HELP: Record<GoalType, string> = {
  completion: 'Progress = completed linked tasks ÷ total linked tasks.',
  milestone: 'Progress = weighted completed milestones ÷ total milestone weight.',
  metric: 'Progress = recorded values (reps, pages, marks) ÷ target value.',
  time: 'Progress = tracked minutes ÷ target minutes.',
  habit: 'Progress = habit check-ins ÷ target count.',
};

/** Which goal types need a numeric target the user must supply. */
export function requiresTargetValue(type: GoalType): boolean {
  return type === 'metric' || type === 'time' || type === 'habit';
}

export const PACE_LABELS: Record<string, string> = {
  ahead: 'Ahead of pace',
  on_track: 'On track',
  behind: 'Behind pace',
  at_risk: 'At risk',
  no_deadline: 'No deadline',
  complete: 'Complete',
};

export function paceTone(status: string): 'positive' | 'neutral' | 'caution' | 'critical' {
  switch (status) {
    case 'ahead':
    case 'complete': return 'positive';
    case 'on_track': return 'neutral';
    case 'behind': return 'caution';
    case 'at_risk': return 'critical';
    default: return 'neutral';
  }
}

/**
 * Computes progress for a goal from already-loaded records, without hitting the
 * DB. Used by list views that already have tasks/milestones/activities in memory.
 */
export function progressFromLoaded(
  goal: Goal,
  tasks: Task[],
  milestones: Milestone[],
  activities: Parameters<typeof computeGoalProgress>[0]['activities'],
  today = todayKey(),
): GoalProgressResult {
  return computeGoalProgress({
    goal,
    tasks: tasks.filter((t) => t.goalId === goal.id),
    milestones: milestones.filter((m) => m.goalId === goal.id),
    activities: activities.filter((a) => a.goalId === goal.id),
    today,
  });
}

export async function progressForGoal(goalId: ID): Promise<GoalProgressResult | null> {
  const goal = await db.goals.get(goalId);
  if (!goal) return null;
  return computeGoalProgress(await buildGoalProgressInput(goal));
}

/* ------------------------------------------------------------------ */
/* Hierarchy                                                           */
/* ------------------------------------------------------------------ */

export interface MilestoneNode {
  milestone: Milestone;
  tasks: Task[];
  completedTasks: number;
  /** Task-completion ratio within this milestone, 0..1. */
  taskProgress: number;
}

export interface GoalTree {
  goal: Goal;
  milestones: MilestoneNode[];
  /** Tasks on the goal that are not attached to any milestone. */
  looseTasks: Task[];
}

export function buildGoalTree(goal: Goal, milestones: Milestone[], tasks: Task[]): GoalTree {
  const goalTasks = tasks.filter((t) => t.goalId === goal.id);
  const ordered = milestones
    .filter((m) => m.goalId === goal.id)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const nodes: MilestoneNode[] = ordered.map((milestone) => {
    const own = goalTasks.filter((t) => t.milestoneId === milestone.id);
    const relevant = own.filter((t) => t.status !== 'cancelled');
    const done = relevant.filter((t) => t.status === 'completed').length;
    return {
      milestone,
      tasks: own,
      completedTasks: done,
      taskProgress: relevant.length ? done / relevant.length : 0,
    };
  });

  return {
    goal,
    milestones: nodes,
    looseTasks: goalTasks.filter((t) => !t.milestoneId),
  };
}

/* ------------------------------------------------------------------ */
/* Task <-> milestone linking                                          */
/* ------------------------------------------------------------------ */

/** Attaches existing tasks to a goal, and optionally to a milestone within it. */
export async function linkTasksToGoal(
  taskIds: ID[],
  goalId: ID,
  milestoneId: ID | null = null,
): Promise<number> {
  const now = Date.now();
  for (const id of taskIds) {
    await db.tasks.update(id, { goalId, milestoneId, updatedAt: now });
  }
  await recomputeGoalProgress(goalId);
  return taskIds.length;
}

/** Detaches a task from its milestone (keeping the goal link) or from both. */
export async function unlinkTask(taskId: ID, alsoGoal = false): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const goalId = task.goalId;
  await db.tasks.update(taskId, {
    milestoneId: null,
    ...(alsoGoal ? { goalId: null } : {}),
    updatedAt: Date.now(),
  });
  if (goalId) await recomputeGoalProgress(goalId);
}

/** Moves a milestone up/down in its goal's ordering. */
export async function moveMilestone(goalId: ID, milestoneId: ID, direction: -1 | 1): Promise<void> {
  const list = await db.milestones.where('goalId').equals(goalId).sortBy('sortOrder');
  const index = list.findIndex((m) => m.id === milestoneId);
  if (index < 0) return;
  const target = index + direction;
  if (target < 0 || target >= list.length) return;
  const reordered = [...list];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const now = Date.now();
  await db.transaction('rw', db.milestones, async () => {
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== i) await db.milestones.update(reordered[i].id, { sortOrder: i, updatedAt: now });
    }
  });
}

/** Rough per-goal counts used by the goal cards. */
export interface GoalCounts {
  milestones: number;
  milestonesDone: number;
  tasks: number;
  tasksDone: number;
  openTasks: number;
}

export function countGoal(goal: Goal, milestones: Milestone[], tasks: Task[]): GoalCounts {
  const ms = milestones.filter((m) => m.goalId === goal.id);
  const ts = tasks.filter((t) => t.goalId === goal.id);
  return {
    milestones: ms.length,
    milestonesDone: ms.filter((m) => m.completedAt).length,
    tasks: ts.length,
    tasksDone: ts.filter((t) => t.status === 'completed').length,
    openTasks: ts.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length,
  };
}
