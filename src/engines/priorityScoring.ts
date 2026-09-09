import type { DateKey, Goal, ID, SchedulingConfig, Task } from '@/types';
import { diffDays } from '@/lib/date';

/**
 * PriorityScoringEngine — a transparent, explainable 0..100 task score.
 *
 * The score is a weighted sum of eight normalised (0..1) components. Every
 * weight lives in `schedulingConfig.priority.weights`, and every component
 * returns its own raw value, weight, contribution and a sentence explaining
 * itself — so the UI can show *why* a task is at the top of the list rather
 * than asking the user to trust a magic number.
 *
 *   base        user-declared importance (1..5)
 *   deadline    proximity to the due date, decaying with a configurable half-life
 *   goal        weight of the goal this task serves
 *   overdue     how far past its due date the task already is
 *   dependency  how many other tasks are waiting on this one
 *   revision    boost for spaced-repetition tasks (they decay if delayed)
 *   age         how long the task has sat unscheduled
 *   effort      small-effort bonus, so quick wins are not starved
 *
 * Pure: no DB, no React, no clock reads — pass `now`.
 */

export type PriorityTermKey =
  | 'base' | 'deadline' | 'goal' | 'overdue'
  | 'dependency' | 'revision' | 'age' | 'effort';

export interface PriorityTerm {
  key: PriorityTermKey;
  label: string;
  /** Normalised 0..1 component value before weighting. */
  raw: number;
  weight: number;
  /** Points this term added to the final 0..100 score. */
  contribution: number;
  /** Plain-English justification for this term's value. */
  explanation: string;
}

export interface PriorityScore {
  taskId: ID;
  title: string;
  /** 0..100, higher = schedule sooner. */
  score: number;
  terms: PriorityTerm[];
  /** The one or two terms that dominated the score. */
  summary: string;
  /** True when an incomplete dependency blocks scheduling entirely. */
  blocked: boolean;
  blockedBy: ID[];
  /** Days until due (negative = overdue); null when there is no due date. */
  daysUntilDue: number | null;
}

export interface PriorityScoringContext {
  /** Reference clock — `now.getTime()` is used for age, never Date.now(). */
  now: Date;
  today: DateKey;
  /** Goals by id, used for the goal-weight term. */
  goalsById?: Readonly<Record<ID, Goal>>;
  /**
   * Number of not-yet-complete tasks that list this task in `dependsOn`.
   * Computed automatically by `scoreTasks`.
   */
  dependentsByTaskId?: Readonly<Record<ID, number>>;
  /** Ids of unfinished tasks this task waits on. Computed by `scoreTasks`. */
  blockedByTaskId?: Readonly<Record<ID, ID[]>>;
}

const DAY_MS = 86_400_000;

const TERM_LABELS: Record<PriorityTermKey, string> = {
  base: 'Importance',
  deadline: 'Deadline urgency',
  goal: 'Goal weight',
  overdue: 'Overdue penalty',
  dependency: 'Blocking other work',
  revision: 'Revision due',
  age: 'Sitting unscheduled',
  effort: 'Quick win',
};

/** Scores a single task. Prefer `scoreTasks` so the dependency graph is real. */
export function scoreTask(
  task: Task,
  ctx: PriorityScoringContext,
  config: SchedulingConfig,
): PriorityScore {
  const p = config.priority;
  const w = p.weights;
  const terms: PriorityTerm[] = [];

  const softFactor = task.deadlineHard ? 1 : p.softDeadlineFactor;
  const daysUntilDue = task.dueDate ? diffDays(ctx.today, task.dueDate) : null;

  // --- base importance -------------------------------------------------
  const baseRaw = clamp01((task.basePriority - 1) / 4);
  terms.push(term('base', baseRaw, w.base, `Priority ${task.basePriority} of 5.`));

  // --- deadline urgency ------------------------------------------------
  let deadlineRaw = 0;
  let deadlineWhy = 'No due date set.';
  if (daysUntilDue !== null) {
    // True half-life decay: urgency halves every `deadlineHalfLifeDays`.
    const forward = Math.max(0, daysUntilDue);
    deadlineRaw = clamp01(Math.pow(2, -forward / Math.max(0.5, p.deadlineHalfLifeDays)) * softFactor);
    deadlineWhy =
      daysUntilDue < 0
        ? `Due date passed ${Math.abs(daysUntilDue)} day${plural(Math.abs(daysUntilDue))} ago.`
        : daysUntilDue === 0
          ? 'Due today.'
          : `Due in ${daysUntilDue} day${plural(daysUntilDue)}${task.deadlineHard ? '' : ' (soft deadline)'}.`;
  }
  terms.push(term('deadline', deadlineRaw, w.deadline, deadlineWhy));

  // --- goal weight -----------------------------------------------------
  const goal = task.goalId ? ctx.goalsById?.[task.goalId] : undefined;
  const goalActive = goal ? goal.status === 'active' : false;
  const goalRaw = goalActive ? clamp01(goal!.weight) : 0;
  terms.push(
    term(
      'goal',
      goalRaw,
      w.goal,
      goal
        ? goalActive
          ? `Serves goal "${goal.title}" (weight ${round2(goal.weight)}).`
          : `Goal "${goal.title}" is ${goal.status} — no boost.`
        : 'Not linked to a goal.',
    ),
  );

  // --- overdue penalty -------------------------------------------------
  const daysOverdue = daysUntilDue !== null && daysUntilDue < 0 ? -daysUntilDue : 0;
  const overdueRaw = clamp01((daysOverdue / Math.max(1, p.overdueSaturationDays)) * softFactor);
  terms.push(
    term(
      'overdue',
      overdueRaw,
      w.overdue,
      daysOverdue > 0
        ? `${daysOverdue} day${plural(daysOverdue)} overdue.`
        : 'Not overdue.',
    ),
  );

  // --- dependency weight -----------------------------------------------
  const dependents = ctx.dependentsByTaskId?.[task.id] ?? 0;
  const dependencyRaw = clamp01(dependents / Math.max(1, p.dependencySaturation));
  terms.push(
    term(
      'dependency',
      dependencyRaw,
      w.dependency,
      dependents > 0
        ? `${dependents} other task${plural(dependents)} waiting on this.`
        : 'Nothing is waiting on this task.',
    ),
  );

  // --- revision boost --------------------------------------------------
  const isRevision = task.revisionEntryId !== null || task.type === 'revision';
  const revisionRaw = isRevision ? clamp01(p.revisionBoost) : 0;
  terms.push(
    term(
      'revision',
      revisionRaw,
      w.revision,
      isRevision ? 'Spaced-repetition revision — value decays if delayed.' : 'Not a revision task.',
    ),
  );

  // --- age -------------------------------------------------------------
  const ageDays = Math.max(0, (ctx.now.getTime() - task.createdAt) / DAY_MS);
  const ageRaw = clamp01(ageDays / Math.max(1, p.ageSaturationDays));
  terms.push(
    term('age', ageRaw, w.age, `Created ${Math.floor(ageDays)} day${plural(Math.floor(ageDays))} ago.`),
  );

  // --- effort (quick-win bonus) ----------------------------------------
  const est = Math.max(0, task.estimatedMinutes);
  const effortRaw = clamp01(1 - est / Math.max(1, p.effortSaturationMinutes));
  terms.push(
    term('effort', effortRaw, w.effort, `Estimated ${Math.round(est)} min — shorter tasks break ties upward.`),
  );

  const weightSum = terms.reduce((s, t) => s + t.weight, 0);
  const raw = terms.reduce((s, t) => s + t.raw * t.weight, 0);
  const score = weightSum > 0 ? round2(clamp01(raw / weightSum) * 100) : 0;

  for (const t of terms) {
    t.contribution = weightSum > 0 ? round2((t.raw * t.weight / weightSum) * 100) : 0;
  }

  const blockedBy = ctx.blockedByTaskId?.[task.id] ?? [];

  return {
    taskId: task.id,
    title: task.title,
    score,
    terms,
    summary: buildSummary(score, terms, blockedBy.length > 0),
    blocked: blockedBy.length > 0,
    blockedBy,
    daysUntilDue,
  };
}

export interface ScoreTasksResult {
  scores: PriorityScore[];
  byTaskId: Record<ID, PriorityScore>;
}

/**
 * Scores a whole batch, deriving the real dependency graph first so the
 * `dependency` term and `blocked` flag reflect the actual task set.
 */
export function scoreTasks(
  tasks: readonly Task[],
  ctx: PriorityScoringContext,
  config: SchedulingConfig,
): ScoreTasksResult {
  const byId = new Map<ID, Task>(tasks.map((t) => [t.id, t]));
  const dependents: Record<ID, number> = {};
  const blockedBy: Record<ID, ID[]> = {};

  for (const task of tasks) {
    if (isFinished(task)) continue;
    const pending: ID[] = [];
    for (const depId of task.dependsOn ?? []) {
      const dep = byId.get(depId);
      // An unknown dependency is treated as satisfied: it is not in scope here
      // and refusing to ever schedule would be worse than scheduling early.
      if (!dep) continue;
      if (!isFinished(dep)) {
        pending.push(depId);
        dependents[depId] = (dependents[depId] ?? 0) + 1;
      }
    }
    if (pending.length > 0) blockedBy[task.id] = pending;
  }

  const fullCtx: PriorityScoringContext = {
    ...ctx,
    dependentsByTaskId: ctx.dependentsByTaskId ?? dependents,
    blockedByTaskId: ctx.blockedByTaskId ?? blockedBy,
  };

  const scores = tasks.map((t) => scoreTask(t, fullCtx, config));
  const map: Record<ID, PriorityScore> = {};
  for (const s of scores) map[s.taskId] = s;
  return { scores, byTaskId: map };
}

/**
 * Deterministic ordering for the scheduler: score desc, then hard deadlines
 * first, then earlier due date, then base priority, then id for stability.
 */
export function comparePriority(a: PriorityScore, b: PriorityScore): number {
  if (b.score !== a.score) return b.score - a.score;
  const ad = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
  const bd = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

/** Returns the tasks ordered by score, highest first. */
export function prioritizeTasks(
  tasks: readonly Task[],
  ctx: PriorityScoringContext,
  config: SchedulingConfig,
): { task: Task; score: PriorityScore }[] {
  const { byTaskId } = scoreTasks(tasks, ctx, config);
  return tasks
    .map((task) => ({ task, score: byTaskId[task.id]! }))
    .sort((x, y) => comparePriority(x.score, y.score));
}

export function isFinished(task: Task): boolean {
  return task.status === 'completed' || task.status === 'cancelled';
}

/* ------------------------------------------------------------------ */

function term(key: PriorityTermKey, raw: number, weight: number, explanation: string): PriorityTerm {
  return { key, label: TERM_LABELS[key], raw: round2(raw), weight, contribution: 0, explanation };
}

function buildSummary(score: number, terms: PriorityTerm[], blocked: boolean): string {
  const top = [...terms]
    .filter((t) => t.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);
  const blockedNote = blocked ? ' Blocked by an unfinished dependency.' : '';
  if (top.length === 0) return `Score ${score}/100 — nothing pushing this up yet.${blockedNote}`;
  const drivers = top.map((t) => `${t.label.toLowerCase()} (+${t.contribution})`).join(' and ');
  return `Score ${score}/100, driven mostly by ${drivers}.${blockedNote}`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}
