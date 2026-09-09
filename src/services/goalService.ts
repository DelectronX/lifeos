import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { todayKey } from '@/lib/date';
import { logActivity } from './activityService';
import { computeGoalProgress, type GoalProgressInput } from '@/engines/goalProgress';
import type { Goal, GoalType, ID, Milestone, TrackerColor } from '@/types';

export interface GoalDraft {
  title: string;
  description?: string;
  type: GoalType;
  trackerId: ID;
  startDate?: string;
  targetDate?: string | null;
  targetValue?: number | null;
  unit?: string;
  weight?: number;
  color?: TrackerColor;
}

export async function createGoal(draft: GoalDraft): Promise<Goal> {
  const now = Date.now();
  const goal: Goal = {
    id: newId('gol'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    description: draft.description,
    type: draft.type,
    trackerId: draft.trackerId,
    status: 'active',
    startDate: draft.startDate ?? todayKey(now),
    targetDate: draft.targetDate ?? null,
    targetValue: draft.targetValue ?? null,
    unit: draft.unit,
    weight: clamp01(draft.weight ?? 0.5),
    progress: 0,
    progressComputedAt: null,
    completedAt: null,
    color: draft.color,
  };
  await db.goals.add(goal);
  return goal;
}

export async function updateGoal(id: ID, patch: Partial<Goal>): Promise<void> {
  if (patch.weight !== undefined) patch.weight = clamp01(patch.weight);
  await db.goals.update(id, { ...patch, updatedAt: Date.now() });
  await recomputeGoalProgress(id);
}

/** Goals are deletable; their tasks are detached rather than destroyed. */
export async function deleteGoal(id: ID): Promise<void> {
  await db.transaction('rw', [db.goals, db.milestones, db.tasks], async () => {
    const milestones = await db.milestones.where('goalId').equals(id).toArray();
    await db.milestones.bulkDelete(milestones.map((m) => m.id));
    const tasks = await db.tasks.where('goalId').equals(id).toArray();
    for (const t of tasks) {
      await db.tasks.update(t.id, { goalId: null, milestoneId: null, updatedAt: Date.now() });
    }
    await db.goals.delete(id);
  });
}

export async function createMilestone(goalId: ID, title: string, targetDate?: string | null, weight = 1): Promise<Milestone> {
  const now = Date.now();
  const count = await db.milestones.where('goalId').equals(goalId).count();
  const milestone: Milestone = {
    id: newId('mil'),
    createdAt: now,
    updatedAt: now,
    goalId,
    title: title.trim(),
    targetDate: targetDate ?? null,
    sortOrder: count,
    weight: Math.max(0, weight),
    completedAt: null,
  };
  await db.milestones.add(milestone);
  await recomputeGoalProgress(goalId);
  return milestone;
}

export async function updateMilestone(id: ID, patch: Partial<Milestone>): Promise<void> {
  await db.milestones.update(id, { ...patch, updatedAt: Date.now() });
  const milestone = await db.milestones.get(id);
  if (milestone) await recomputeGoalProgress(milestone.goalId);
}

export async function toggleMilestone(id: ID): Promise<void> {
  const milestone = await db.milestones.get(id);
  if (!milestone) return;
  const at = Date.now();
  const completed = !milestone.completedAt;
  await db.milestones.update(id, { completedAt: completed ? at : null, updatedAt: at });

  if (completed) {
    const goal = await db.goals.get(milestone.goalId);
    await logActivity({
      type: 'milestone_completed',
      title: milestone.title,
      at,
      goalId: milestone.goalId,
      trackerId: goal?.trackerId ?? null,
      meta: { milestoneId: id, createdAt: milestone.createdAt },
    });
  } else {
    // Reverting a milestone removes its completion event so counters stay honest.
    const rows = await db.activities
      .where('goalId').equals(milestone.goalId)
      .filter((a) => a.type === 'milestone_completed' && a.meta?.milestoneId === id)
      .toArray();
    await db.activities.bulkDelete(rows.map((r) => r.id));
  }

  await recomputeGoalProgress(milestone.goalId);
}

export async function deleteMilestone(id: ID): Promise<void> {
  const milestone = await db.milestones.get(id);
  if (!milestone) return;
  await db.transaction('rw', [db.milestones, db.tasks], async () => {
    const tasks = await db.tasks.where('milestoneId').equals(id).toArray();
    for (const t of tasks) await db.tasks.update(t.id, { milestoneId: null, updatedAt: Date.now() });
    await db.milestones.delete(id);
  });
  await recomputeGoalProgress(milestone.goalId);
}

export async function reorderMilestones(goalId: ID, orderedIds: ID[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.milestones, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.milestones.update(orderedIds[i], { sortOrder: i, updatedAt: now });
    }
  });
  void goalId;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/** Gathers the real records a goal's progress depends on and runs the engine. */
export async function buildGoalProgressInput(goal: Goal): Promise<GoalProgressInput> {
  const [tasks, milestones, activities] = await Promise.all([
    db.tasks.where('goalId').equals(goal.id).toArray(),
    db.milestones.where('goalId').equals(goal.id).sortBy('sortOrder'),
    db.activities.where('goalId').equals(goal.id).toArray(),
  ]);
  return { goal, tasks, milestones, activities, today: todayKey() };
}

export async function recomputeGoalProgress(goalId: ID): Promise<number> {
  const goal = await db.goals.get(goalId);
  if (!goal) return 0;
  const input = await buildGoalProgressInput(goal);
  const result = computeGoalProgress(input);
  const at = Date.now();

  const patch: Partial<Goal> = { progress: result.progress, progressComputedAt: at, updatedAt: at };

  // Auto-complete when a goal reaches 100%, and log it exactly once.
  if (result.progress >= 1 && goal.status === 'active') {
    patch.status = 'completed';
    patch.completedAt = at;
    await logActivity({
      type: 'goal_completed',
      title: goal.title,
      at,
      goalId: goal.id,
      trackerId: goal.trackerId,
      meta: { goalType: goal.type, createdAt: goal.createdAt },
    });
  } else if (result.progress < 1 && goal.status === 'completed') {
    patch.status = 'active';
    patch.completedAt = null;
  }

  await db.goals.update(goalId, patch);
  return result.progress;
}

export async function recomputeAllGoalProgress(): Promise<void> {
  const goals = await db.goals.toArray();
  for (const goal of goals) await recomputeGoalProgress(goal.id);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
