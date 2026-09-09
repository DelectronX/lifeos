import { diffDays, todayKey } from '@/lib/date';
import { CLOSED_STATUSES, isOpen, isOverdue } from './taskService';
import type { DateKey, ID, Task, TaskStatus } from '@/types';

/**
 * Pure task querying: filtering, searching, sorting and sectioning.
 *
 * Kept out of React so the list view is a thin renderer, and so the same rules
 * can later be reused by the Daily Review and the scheduling engines.
 */

export type TaskGroupBy = 'none' | 'status' | 'tracker' | 'goal' | 'priority' | 'due' | 'type';
export type TaskSortBy = 'smart' | 'due' | 'priority' | 'created' | 'title' | 'estimate';
export type DateScope = 'all' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'undated';

export interface TaskFilter {
  search: string;
  trackerIds: ID[];
  statuses: TaskStatus[];
  goalIds: ID[];
  milestoneId: ID | null;
  priorities: number[];
  dateScope: DateScope;
  tags: string[];
  /** When false, completed/cancelled tasks are hidden regardless of `statuses`. */
  includeClosed: boolean;
}

export const EMPTY_FILTER: TaskFilter = {
  search: '',
  trackerIds: [],
  statuses: [],
  goalIds: [],
  milestoneId: null,
  priorities: [],
  dateScope: 'all',
  tags: [],
  includeClosed: false,
};

export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.search.trim() !== '' ||
    f.trackerIds.length > 0 ||
    f.statuses.length > 0 ||
    f.goalIds.length > 0 ||
    f.milestoneId !== null ||
    f.priorities.length > 0 ||
    f.dateScope !== 'all' ||
    f.tags.length > 0 ||
    f.includeClosed
  );
}

export function matchesSearch(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [task.title, task.notes ?? '', task.topic ?? '', ...task.tags].join(' ').toLowerCase();
  // Every whitespace-separated term must appear somewhere (AND search).
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function matchesDateScope(task: Task, scope: DateScope, today: DateKey): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'undated':
      return !task.dueDate;
    case 'overdue':
      return isOverdue(task, today);
    case 'today':
      return !!task.dueDate && diffDays(today, task.dueDate) === 0;
    case 'tomorrow':
      return !!task.dueDate && diffDays(today, task.dueDate) === 1;
    case 'week': {
      if (!task.dueDate) return false;
      const d = diffDays(today, task.dueDate);
      return d >= 0 && d <= 6;
    }
  }
}

export function filterTasks(tasks: Task[], filter: TaskFilter, today: DateKey = todayKey()): Task[] {
  return tasks.filter((t) => {
    if (!filter.includeClosed && filter.statuses.length === 0 && CLOSED_STATUSES.includes(t.status)) return false;
    if (filter.statuses.length && !filter.statuses.includes(t.status)) return false;
    if (filter.trackerIds.length && !filter.trackerIds.includes(t.trackerId)) return false;
    if (filter.goalIds.length && (!t.goalId || !filter.goalIds.includes(t.goalId))) return false;
    if (filter.milestoneId && t.milestoneId !== filter.milestoneId) return false;
    if (filter.priorities.length && !filter.priorities.includes(t.basePriority)) return false;
    if (filter.tags.length && !filter.tags.some((tag) => t.tags.includes(tag))) return false;
    if (!matchesDateScope(t, filter.dateScope, today)) return false;
    if (!matchesSearch(t, filter.search)) return false;
    return true;
  });
}

/**
 * "Smart" order: what should be worked on next. Open before closed, overdue
 * first, then by engine priority score (falls back to a transparent local
 * ranking before Phase 3 populates priorityScore), then due date.
 */
export function compareTasks(a: Task, b: Task, sortBy: TaskSortBy, today: DateKey): number {
  switch (sortBy) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'created':
      return b.createdAt - a.createdAt;
    case 'estimate':
      return b.estimatedMinutes - a.estimatedMinutes;
    case 'priority':
      return b.basePriority - a.basePriority || compareDue(a, b);
    case 'due':
      return compareDue(a, b);
    case 'smart':
    default: {
      const openDiff = Number(isOpen(b)) - Number(isOpen(a));
      if (openDiff) return openDiff;
      const overdueDiff = Number(isOverdue(b, today)) - Number(isOverdue(a, today));
      if (overdueDiff) return overdueDiff;
      const scoreDiff = (b.priorityScore || fallbackScore(b, today)) - (a.priorityScore || fallbackScore(a, today));
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return compareDue(a, b);
    }
  }
}

/** Undated tasks sort after dated ones; earlier dates first. */
function compareDue(a: Task, b: Task): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || b.basePriority - a.basePriority;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return b.basePriority - a.basePriority || a.sortOrder - b.sortOrder;
}

/**
 * Transparent stand-in ranking used until the PriorityScoringEngine (Phase 3)
 * writes real scores. Base priority dominates; deadline proximity breaks ties.
 */
export function fallbackScore(task: Task, today: DateKey): number {
  let score = task.basePriority * 12;
  if (task.dueDate) {
    const days = diffDays(today, task.dueDate);
    if (days < 0) score += Math.min(30, 12 + Math.abs(days) * 2);
    else score += Math.max(0, 20 - days * 2);
  }
  if (task.status === 'in_progress') score += 8;
  if (task.deadlineHard) score += 4;
  return score;
}

export function sortTasks(tasks: Task[], sortBy: TaskSortBy, today: DateKey = todayKey()): Task[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, sortBy, today));
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

export interface TaskGroup {
  key: string;
  label: string;
  tasks: Task[];
  /** Sorts groups in the UI; lower comes first. */
  order: number;
}

export interface GroupLabelSources {
  trackerName: (id: ID) => string;
  goalTitle: (id: ID) => string;
}

const STATUS_ORDER: TaskStatus[] = [
  'in_progress', 'planned', 'inbox', 'rescheduled', 'skipped', 'completed', 'cancelled',
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<number, string> = {
  5: 'Critical', 4: 'High', 3: 'Normal', 2: 'Low', 1: 'Someday',
};

export function groupTasks(
  tasks: Task[],
  groupBy: TaskGroupBy,
  sources: GroupLabelSources,
  today: DateKey = todayKey(),
): TaskGroup[] {
  if (groupBy === 'none') return [{ key: 'all', label: 'All tasks', tasks, order: 0 }];

  const map = new Map<string, TaskGroup>();
  const put = (key: string, label: string, order: number, task: Task) => {
    const existing = map.get(key);
    if (existing) existing.tasks.push(task);
    else map.set(key, { key, label, order, tasks: [task] });
  };

  for (const task of tasks) {
    switch (groupBy) {
      case 'status':
        put(task.status, STATUS_LABELS[task.status], STATUS_ORDER.indexOf(task.status), task);
        break;
      case 'tracker':
        put(task.trackerId, sources.trackerName(task.trackerId), 0, task);
        break;
      case 'goal':
        if (task.goalId) put(task.goalId, sources.goalTitle(task.goalId), 0, task);
        else put('__none', 'No goal', 1, task);
        break;
      case 'priority':
        put(`p${task.basePriority}`, `${PRIORITY_LABELS[task.basePriority]} (P${task.basePriority})`, 5 - task.basePriority, task);
        break;
      case 'type':
        put(task.type, task.type.charAt(0).toUpperCase() + task.type.slice(1), 0, task);
        break;
      case 'due': {
        const b = dueBucket(task, today);
        put(b.key, b.label, b.order, task);
        break;
      }
    }
  }

  return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function dueBucket(task: Task, today: DateKey): { key: string; label: string; order: number } {
  if (!task.dueDate) return { key: 'undated', label: 'No date', order: 9 };
  const d = diffDays(today, task.dueDate);
  if (d < 0) return { key: 'overdue', label: 'Overdue', order: 0 };
  if (d === 0) return { key: 'today', label: 'Today', order: 1 };
  if (d === 1) return { key: 'tomorrow', label: 'Tomorrow', order: 2 };
  if (d <= 6) return { key: 'week', label: 'This week', order: 3 };
  if (d <= 30) return { key: 'month', label: 'This month', order: 4 };
  return { key: 'later', label: 'Later', order: 5 };
}

/* ------------------------------------------------------------------ */
/* Standard sections used by Tasks page + Home                         */
/* ------------------------------------------------------------------ */

export interface TaskSections {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  undated: Task[];
  closed: Task[];
}

/** Overdue / Today / Upcoming / No date / Done — the spec's default view. */
export function sectionTasks(tasks: Task[], today: DateKey = todayKey()): TaskSections {
  const out: TaskSections = { overdue: [], today: [], upcoming: [], undated: [], closed: [] };
  for (const t of tasks) {
    if (CLOSED_STATUSES.includes(t.status)) { out.closed.push(t); continue; }
    if (!t.dueDate) { out.undated.push(t); continue; }
    const d = diffDays(today, t.dueDate);
    if (d < 0) out.overdue.push(t);
    else if (d === 0) out.today.push(t);
    else out.upcoming.push(t);
  }
  const by = (list: Task[]) => list.sort((a, b) => compareTasks(a, b, 'smart', today));
  by(out.overdue); by(out.today); by(out.upcoming); by(out.undated);
  out.closed.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  return out;
}

/** Every distinct tag across a task set, alphabetised — powers the tag filter. */
export function collectTags(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) for (const tag of t.tags) set.add(tag);
  return [...set].sort();
}

/** Aggregate numbers for a task list, used by section headers and Home. */
export interface TaskStats {
  total: number;
  open: number;
  completed: number;
  overdue: number;
  estimatedMinutes: number;
  remainingMinutes: number;
}

export function summarise(tasks: Task[], today: DateKey = todayKey()): TaskStats {
  const stats: TaskStats = { total: tasks.length, open: 0, completed: 0, overdue: 0, estimatedMinutes: 0, remainingMinutes: 0 };
  for (const t of tasks) {
    if (t.status === 'completed') stats.completed++;
    if (isOpen(t)) {
      stats.open++;
      stats.remainingMinutes += Math.max(0, t.estimatedMinutes - t.actualMinutes);
    }
    if (isOverdue(t, today)) stats.overdue++;
    stats.estimatedMinutes += t.estimatedMinutes;
  }
  return stats;
}
