import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { todayKey } from '@/lib/date';
import { createGoal, createMilestone, recomputeGoalProgress } from './goalService';
import { logActivity } from './activityService';
import { createTask } from './taskService';
import type { DateKey, ID, Task } from '@/types';
import type { Project, ProjectDeliverable, ProjectKind, ProjectStatus } from '@/types/workgrowth';

/**
 * Projects ride the shared backbone: each project owns a Goal; its milestones
 * are Milestone rows and its work items are Task rows of that goal (so they
 * appear in Tasks, can be auto-planned into blocks, earn XP and feed
 * achievements). A project never keeps its own task list.
 */

export interface ProjectDraft {
  title: string;
  summary?: string;
  kind?: ProjectKind;
  status?: ProjectStatus;
  trackerId?: ID;
  clientId?: ID | null;
  studyId?: ID | null;
  repoUrl?: string;
  demoUrl?: string;
  startDate?: DateKey | null;
  targetDate?: DateKey | null;
  definitionOfDone?: string;
  /** Milestone titles to create (e.g. from a template). */
  milestones?: string[];
  deliverables?: string[];
  /** Adopt an existing goal instead of creating one. */
  goalId?: ID;
}

/** Default milestone template for a software deliverable. Editable per project. */
export const SOFTWARE_TEMPLATE = ['Scope & design', 'Core MVP', 'Tests', 'README & architecture note', 'Demo & release'];

export async function createProject(draft: ProjectDraft, now = Date.now()): Promise<Project> {
  const goalId = draft.goalId ?? (await createGoal({
    title: draft.title,
    description: draft.summary,
    type: 'milestone',
    trackerId: draft.trackerId ?? 'trk_skills',
    targetDate: draft.targetDate ?? null,
  } as Parameters<typeof createGoal>[0])).id;
  for (const m of draft.milestones ?? []) await createMilestone(goalId, m);

  const project: Project = {
    id: newId('prj'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    summary: draft.summary,
    kind: draft.kind ?? 'portfolio',
    status: draft.status ?? 'planning',
    goalId,
    clientId: draft.clientId ?? null,
    studyId: draft.studyId ?? null,
    repoUrl: draft.repoUrl,
    demoUrl: draft.demoUrl,
    startDate: draft.startDate ?? todayKey(now),
    targetDate: draft.targetDate ?? null,
    deliverables: (draft.deliverables ?? []).map((title) => ({ id: newId('dlv'), title, doneAt: null })),
    definitionOfDone: draft.definitionOfDone,
    sortOrder: await db.projects.count(),
  };
  await db.projects.add(project);
  return project;
}

export async function updateProject(id: ID, patch: Partial<Project>): Promise<void> {
  const before = await db.projects.get(id);
  await db.projects.update(id, { ...patch, updatedAt: Date.now() });
  if (before && patch.status === 'shipped' && before.status !== 'shipped') {
    await logActivity({ type: 'project_shipped', title: before.title, goalId: before.goalId, meta: { projectId: id } });
    // Automation: a shipped project gets a portfolio publishing task (once).
    const title = `Publish portfolio write-up: ${patch.title ?? before.title}`;
    const exists = (await db.tasks.where('goalId').equals(before.goalId).toArray()).some((t) => t.title.startsWith('Publish portfolio write-up'));
    if (!exists) await addProjectTask({ ...before, ...patch } as Project, title, { estimatedMinutes: 60 });
  }
  if (before && (patch.title || patch.targetDate !== undefined)) {
    await db.goals.update(before.goalId, {
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
      updatedAt: Date.now(),
    });
  }
}

/** Deletes the project record only; its goal, milestones and tasks are kept (history stays honest). */
export async function deleteProject(id: ID): Promise<void> {
  await db.projects.delete(id);
}

export async function addProjectTask(project: Project, title: string, opts: { milestoneId?: ID | null; estimatedMinutes?: number; dueDate?: DateKey | null } = {}): Promise<Task> {
  const goal = await db.goals.get(project.goalId);
  return createTask({
    title,
    trackerId: goal?.trackerId ?? 'trk_skills',
    goalId: project.goalId,
    milestoneId: opts.milestoneId ?? null,
    estimatedMinutes: opts.estimatedMinutes ?? 60,
    dueDate: opts.dueDate ?? null,
    status: 'inbox',
  });
}

export async function toggleDeliverable(projectId: ID, deliverableId: ID): Promise<void> {
  const p = await db.projects.get(projectId);
  if (!p) return;
  const deliverables: ProjectDeliverable[] = p.deliverables.map((d) =>
    d.id === deliverableId ? { ...d, doneAt: d.doneAt ? null : Date.now() } : d);
  await updateProject(projectId, { deliverables });
}

export async function addDeliverable(projectId: ID, title: string): Promise<void> {
  const p = await db.projects.get(projectId);
  if (!p) return;
  await updateProject(projectId, { deliverables: [...p.deliverables, { id: newId('dlv'), title, doneAt: null }] });
}

export async function refreshProjectGoal(project: Project): Promise<void> {
  await recomputeGoalProgress(project.goalId);
}
