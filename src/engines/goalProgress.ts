import type { Activity, DateKey, Goal, Milestone, Task } from '@/types';

/**
 * GoalProgressEngine — derives goal completion from real stored records only.
 *
 * Progress definition per goal type:
 *   completion — completed linked tasks / total linked tasks (cancelled excluded)
 *   milestone  — weighted completed milestones / total milestone weight
 *   metric     — summed Activity.value against targetValue
 *   time       — summed Activity.durationMs (minutes) against targetValue
 *   habit      — count of habit_checkin activities against targetValue
 *
 * Also produces pace: where the goal *should* be today given a linear burn from
 * startDate to targetDate, so the UI can say "behind/ahead" without inventing
 * numbers. Pure — no DB access, no clock reads.
 */

export interface GoalProgressInput {
  goal: Goal;
  tasks: Task[];
  milestones: Milestone[];
  activities: Activity[];
  today: DateKey;
}

export type PaceStatus = 'ahead' | 'on_track' | 'behind' | 'at_risk' | 'no_deadline' | 'complete';

export interface GoalProgressResult {
  /** 0..1 */
  progress: number;
  /** Raw achieved amount in the goal's own unit (tasks, marks, minutes...). */
  current: number;
  target: number;
  unitLabel: string;
  /** Expected progress today for a linear plan; null without a target date. */
  expected: number | null;
  paceStatus: PaceStatus;
  /** Human-readable, derived strictly from the numbers above. */
  summary: string;
  daysRemaining: number | null;
  /** Amount still required per remaining day to finish on time. */
  requiredPerDay: number | null;
  breakdown: { label: string; value: number }[];
}

export function computeGoalProgress(input: GoalProgressInput): GoalProgressResult {
  const { goal, tasks, milestones, activities, today } = input;

  let current = 0;
  let target = 0;
  let unitLabel = goal.unit ?? '';
  const breakdown: { label: string; value: number }[] = [];

  switch (goal.type) {
    case 'completion': {
      const relevant = tasks.filter((t) => t.status !== 'cancelled');
      const done = relevant.filter((t) => t.status === 'completed');
      current = done.length;
      target = relevant.length;
      unitLabel = 'tasks';
      breakdown.push({ label: 'Completed tasks', value: done.length });
      breakdown.push({ label: 'Remaining tasks', value: Math.max(0, relevant.length - done.length) });
      break;
    }
    case 'milestone': {
      const totalWeight = milestones.reduce((s, m) => s + (m.weight || 1), 0);
      const doneWeight = milestones.filter((m) => m.completedAt).reduce((s, m) => s + (m.weight || 1), 0);
      current = doneWeight;
      target = totalWeight;
      unitLabel = 'milestones';
      breakdown.push({ label: 'Milestones complete', value: milestones.filter((m) => m.completedAt).length });
      breakdown.push({ label: 'Milestones total', value: milestones.length });
      break;
    }
    case 'metric': {
      current = activities.reduce((s, a) => s + (a.value ?? 0), 0);
      target = goal.targetValue ?? 0;
      unitLabel = goal.unit ?? 'units';
      breakdown.push({ label: 'Recorded', value: round(current) });
      break;
    }
    case 'time': {
      const minutes = activities.reduce((s, a) => s + a.durationMs, 0) / 60_000;
      current = minutes;
      target = goal.targetValue ?? 0;
      unitLabel = 'minutes';
      breakdown.push({ label: 'Minutes tracked', value: Math.round(minutes) });
      break;
    }
    case 'habit': {
      current = activities.filter((a) => a.type === 'habit_checkin').length;
      target = goal.targetValue ?? 0;
      unitLabel = 'check-ins';
      breakdown.push({ label: 'Check-ins', value: current });
      break;
    }
  }

  const progress = target > 0 ? clamp01(current / target) : 0;

  // --- pace -------------------------------------------------------------
  const totalDays = goal.targetDate ? daysBetween(goal.startDate, goal.targetDate) : null;
  const elapsedDays = goal.targetDate ? daysBetween(goal.startDate, today) : null;
  const daysRemaining = goal.targetDate ? daysBetween(today, goal.targetDate) : null;

  let expected: number | null = null;
  if (totalDays !== null && totalDays > 0 && elapsedDays !== null) {
    expected = clamp01(elapsedDays / totalDays);
  }

  let paceStatus: PaceStatus;
  if (progress >= 1) paceStatus = 'complete';
  else if (expected === null) paceStatus = 'no_deadline';
  else if (daysRemaining !== null && daysRemaining < 0) paceStatus = 'at_risk';
  else if (progress >= expected + 0.05) paceStatus = 'ahead';
  else if (progress >= expected - 0.05) paceStatus = 'on_track';
  else if (progress >= expected - 0.2) paceStatus = 'behind';
  else paceStatus = 'at_risk';

  const remainingAmount = Math.max(0, target - current);
  const requiredPerDay =
    daysRemaining !== null && daysRemaining > 0 ? remainingAmount / daysRemaining : null;

  return {
    progress,
    current: round(current),
    target: round(target),
    unitLabel,
    expected,
    paceStatus,
    daysRemaining,
    requiredPerDay: requiredPerDay === null ? null : round(requiredPerDay),
    summary: buildSummary({ progress, expected, paceStatus, current, target, unitLabel, daysRemaining, requiredPerDay }),
    breakdown,
  };
}

function buildSummary(args: {
  progress: number;
  expected: number | null;
  paceStatus: PaceStatus;
  current: number;
  target: number;
  unitLabel: string;
  daysRemaining: number | null;
  requiredPerDay: number | null;
}): string {
  const pct = Math.round(args.progress * 100);
  const amount = `${round(args.current)} of ${round(args.target)} ${args.unitLabel}`.trim();

  if (args.target <= 0) return 'No target set yet — add tasks, milestones or a target value.';
  if (args.paceStatus === 'complete') return `Complete — ${amount}.`;
  if (args.paceStatus === 'no_deadline') return `${pct}% done (${amount}). No target date set.`;

  const expectedPct = Math.round((args.expected ?? 0) * 100);
  const daysPart =
    args.daysRemaining === null ? ''
    : args.daysRemaining < 0 ? ` Target date passed ${Math.abs(args.daysRemaining)} day${Math.abs(args.daysRemaining) === 1 ? '' : 's'} ago.`
    : ` ${args.daysRemaining} day${args.daysRemaining === 1 ? '' : 's'} left.`;

  const ratePart =
    args.requiredPerDay && args.requiredPerDay > 0
      ? ` Needs ${round(args.requiredPerDay)} ${args.unitLabel}/day to finish on time.`
      : '';

  switch (args.paceStatus) {
    case 'ahead': return `${pct}% done vs ${expectedPct}% expected — ahead of pace.${daysPart}`;
    case 'on_track': return `${pct}% done vs ${expectedPct}% expected — on track.${daysPart}${ratePart}`;
    case 'behind': return `${pct}% done vs ${expectedPct}% expected — behind pace.${daysPart}${ratePart}`;
    default: return `${pct}% done vs ${expectedPct}% expected — at risk.${daysPart}${ratePart}`;
  }
}

/** Aggregate progress across several goals, weighted by each goal's weight. */
export function aggregateGoalProgress(results: { progress: number; weight: number }[]): number {
  const totalWeight = results.reduce((s, r) => s + (r.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  return clamp01(results.reduce((s, r) => s + r.progress * (r.weight || 0), 0) / totalWeight);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Calendar days between two YYYY-MM-DD keys (b - a). Local, DST-safe. */
export function daysBetween(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const at = Date.UTC(ay, (am ?? 1) - 1, ad ?? 1);
  const bt = Date.UTC(by, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bt - at) / 86_400_000);
}
