import {
  addDaysToKey, diffDays, isoWeekKey, monthKey, startOfWeekKey, toDateKey,
} from '@/lib/date';

/**
 * ConditionEngine — a pure, serialisable rule evaluator for user-defined rewards.
 *
 * Design rules (deliberate, and load-bearing):
 *  - PURE. No Dexie, no React, no ambient clock. Everything it needs arrives as
 *    plain data plus an explicit `now: Date`. That is what makes it testable and
 *    what stops reward logic leaking into components.
 *  - The condition is a small AST — AND / OR / NOT groups over leaf comparisons
 *    of a METRIC against a NUMBER, optionally scoped to a time window. It is
 *    plain JSON, so it round-trips through IndexedDB and the backup export
 *    without any custom serialiser.
 *  - Evaluation never returns a bare boolean. It returns a trace so the UI can
 *    say *why*: "study minutes in the last 7 days is 320 and needs to be 600".
 *
 * Metric values come from a `MetricSource`: all-time totals plus per-day
 * samples. A windowed leaf aggregates the day samples inside the window using
 * the metric's declared aggregation (sum / max), so "tasks completed today" and
 * "best single-day focus this month" both fall out of the same machinery.
 */

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

export type ComparisonOperator = '>=' | '>' | '<=' | '<' | '==' | '!=';

export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
  '>=', '>', '<=', '<', '==', '!=',
];

export const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  '>=': 'is at least',
  '>': 'is more than',
  '<=': 'is at most',
  '<': 'is less than',
  '==': 'is exactly',
  '!=': 'is not',
};

export type TimeWindowKind =
  | 'all_time'
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'rolling_days';

export interface TimeWindow {
  kind: TimeWindowKind;
  /** Only meaningful for `rolling_days`. Clamped to >= 1 at evaluation time. */
  days?: number;
}

export const ALL_TIME: TimeWindow = { kind: 'all_time' };

export type GroupOperator = 'and' | 'or' | 'not';

export interface LeafCondition {
  /** Stable id so the UI can key rows and match traces back to editor state. */
  id: string;
  type: 'leaf';
  metric: string;
  operator: ComparisonOperator;
  value: number;
  window: TimeWindow;
}

export interface GroupCondition {
  id: string;
  type: GroupOperator;
  children: Condition[];
}

export type Condition = LeafCondition | GroupCondition;

export function isLeaf(node: Condition): node is LeafCondition {
  return node.type === 'leaf';
}

export function isGroup(node: Condition): node is GroupCondition {
  return node.type === 'and' || node.type === 'or' || node.type === 'not';
}

/* ------------------------------------------------------------------ */
/* Metric source                                                       */
/* ------------------------------------------------------------------ */

export type MetricAggregation = 'sum' | 'max' | 'snapshot';

export interface MetricMeta {
  /** How day samples combine inside a window. `snapshot` ignores windows. */
  aggregation: MetricAggregation;
  /** False when the metric only exists as an all-time figure (e.g. level). */
  windowable: boolean;
}

/** One calendar day's contribution to every windowable metric. */
export interface DailyMetricPoint {
  /** YYYY-MM-DD, local calendar day. */
  date: string;
  values: Readonly<Record<string, number>>;
}

export interface MetricSource {
  /** All-time value of every metric. The fallback for any window. */
  totals: Readonly<Record<string, number>>;
  /** Per-day samples for windowable metrics. Order does not matter. */
  daily: readonly DailyMetricPoint[];
  /** Per-metric aggregation rules. Missing entries default to summed + windowable. */
  meta?: Readonly<Record<string, MetricMeta>>;
  /** 0 = Sunday, 1 = Monday. Defaults to Monday. */
  weekStartsOn?: 0 | 1;
}

export const EMPTY_METRIC_SOURCE: MetricSource = { totals: {}, daily: [] };

const DEFAULT_META: MetricMeta = { aggregation: 'sum', windowable: true };

/* ------------------------------------------------------------------ */
/* Window resolution                                                   */
/* ------------------------------------------------------------------ */

export interface ResolvedWindow {
  /** Inclusive first day, or null for all-time. */
  from: string | null;
  /** Inclusive last day, or null for all-time. */
  to: string | null;
  label: string;
}

export function resolveWindow(window: TimeWindow, now: Date, weekStartsOn: 0 | 1 = 1): ResolvedWindow {
  const today = toDateKey(now);
  switch (window.kind) {
    case 'today':
      return { from: today, to: today, label: 'today' };
    case 'this_week': {
      const from = startOfWeekKey(today, weekStartsOn);
      return { from, to: today, label: 'this week' };
    }
    case 'this_month': {
      const from = `${monthKey(today)}-01`;
      return { from, to: today, label: 'this month' };
    }
    case 'rolling_days': {
      const days = Math.max(1, Math.floor(window.days ?? 7));
      // A rolling window of N days INCLUDES today, so N=1 means "today".
      return { from: addDaysToKey(today, -(days - 1)), to: today, label: `in the last ${days} days` };
    }
    case 'all_time':
    default:
      return { from: null, to: null, label: 'all time' };
  }
}

export function describeWindow(window: TimeWindow): string {
  switch (window.kind) {
    case 'today': return 'today';
    case 'this_week': return 'this week';
    case 'this_month': return 'this month';
    case 'rolling_days': return `in the last ${Math.max(1, Math.floor(window.days ?? 7))} days`;
    case 'all_time':
    default: return 'all time';
  }
}

/** Resolved numeric value of a metric inside a window, or null when unknown. */
export function readMetric(
  metric: string,
  window: TimeWindow,
  source: MetricSource,
  now: Date,
): number | null {
  const meta = source.meta?.[metric] ?? DEFAULT_META;
  const totalsHas = Object.prototype.hasOwnProperty.call(source.totals, metric);
  const dailyHas = source.daily.some((p) => Object.prototype.hasOwnProperty.call(p.values, metric));

  // An entirely unknown key is a real error the UI should surface, not a zero.
  if (!totalsHas && !dailyHas && !source.meta?.[metric]) return null;

  if (window.kind === 'all_time' || meta.aggregation === 'snapshot' || !meta.windowable) {
    return totalsHas ? numberOrZero(source.totals[metric]) : 0;
  }

  const range = resolveWindow(window, now, source.weekStartsOn ?? 1);
  if (range.from === null || range.to === null) {
    return totalsHas ? numberOrZero(source.totals[metric]) : 0;
  }

  let acc = meta.aggregation === 'max' ? Number.NEGATIVE_INFINITY : 0;
  let seen = 0;
  for (const point of source.daily) {
    if (point.date < range.from || point.date > range.to) continue;
    if (!Object.prototype.hasOwnProperty.call(point.values, metric)) continue;
    const v = numberOrZero(point.values[metric]);
    seen++;
    if (meta.aggregation === 'max') acc = Math.max(acc, v);
    else acc += v;
  }
  if (seen === 0) return 0;
  return meta.aggregation === 'max' && acc === Number.NEGATIVE_INFINITY ? 0 : acc;
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export function compare(actual: number, operator: ComparisonOperator, target: number): boolean {
  switch (operator) {
    case '>=': return actual >= target;
    case '>': return actual > target;
    case '<=': return actual <= target;
    case '<': return actual < target;
    case '==': return actual === target;
    case '!=': return actual !== target;
    default: return false;
  }
}

/**
 * 0..1 progress toward satisfying a single comparison.
 *
 * Ascending operators measure actual/target; descending ones measure how far
 * the value still has to fall. Equality is binary — there is no honest partial
 * credit for "nearly exactly 5". Division by zero can never happen: every
 * branch that would divide checks its denominator first.
 */
export function leafProgress(actual: number, operator: ComparisonOperator, target: number): number {
  if (compare(actual, operator, target)) return 1;
  switch (operator) {
    case '>=':
    case '>': {
      if (target <= 0) return 0;
      return clamp01(actual / target);
    }
    case '<=':
    case '<': {
      // Unmet means actual > target. Progress = how close we have come down.
      if (actual <= 0) return 0;
      return clamp01(Math.max(0, target) / actual);
    }
    case '==':
    case '!=':
    default:
      return 0;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* ------------------------------------------------------------------ */
/* Evaluation + trace                                                  */
/* ------------------------------------------------------------------ */

export interface LeafTrace {
  id: string;
  kind: 'leaf';
  metric: string;
  /** Human label supplied by the caller's catalogue; falls back to the key. */
  metricLabel: string;
  window: TimeWindow;
  windowLabel: string;
  operator: ComparisonOperator;
  target: number;
  /** Measured value, or null when the metric key is not recognised. */
  actual: number | null;
  met: boolean;
  /** True when the metric key could not be resolved at all. */
  unknownMetric: boolean;
  /** 0..1 toward this single comparison. */
  progress: number;
  /** e.g. "Study minutes in the last 7 days is 320 and needs to be at least 600." */
  explanation: string;
}

export interface GroupTrace {
  id: string;
  kind: GroupOperator;
  met: boolean;
  children: ConditionTrace[];
  /** 0..1 rolled up from children. */
  progress: number;
  explanation: string;
}

export type ConditionTrace = LeafTrace | GroupTrace;

export function isLeafTrace(t: ConditionTrace): t is LeafTrace {
  return t.kind === 'leaf';
}

export interface ConditionEvaluation {
  met: boolean;
  /** 0..1 overall progress; 1 whenever `met`. */
  progress: number;
  trace: ConditionTrace;
  /** Flattened leaves in document order — handy for compact UI lists. */
  leaves: LeafTrace[];
  /** The unmet leaf that is closest to being satisfied, if any. */
  nearestUnmet: LeafTrace | null;
  /** Short sentence naming the single thing standing in the way. */
  summary: string;
}

export interface EvaluateOptions {
  /** metric key -> display label, so traces read like English. */
  labels?: Readonly<Record<string, string>>;
  /** metric key -> unit suffix, e.g. 'min', '%'. */
  units?: Readonly<Record<string, string>>;
}

/**
 * Evaluates a condition against measured metrics at a point in time.
 *
 * Empty groups evaluate to FALSE, not vacuously true: a reward whose condition
 * has not been filled in must never pay out.
 */
export function evaluateCondition(
  condition: Condition,
  metrics: MetricSource,
  now: Date,
  options: EvaluateOptions = {},
): ConditionEvaluation {
  const trace = evalNode(condition, metrics, now, options, 0);
  const leaves = collectLeaves(trace);
  const unmet = leaves.filter((l) => !l.met);
  const nearestUnmet = unmet.length
    ? unmet.reduce((best, l) => (l.progress > best.progress ? l : best))
    : null;

  return {
    met: trace.met,
    progress: trace.met ? 1 : trace.progress,
    trace,
    leaves,
    nearestUnmet,
    summary: buildSummary(trace, nearestUnmet, leaves.length),
  };
}

/** Convenience wrapper: just the 0..1 progress for a condition. */
export function computeProgress(
  condition: Condition,
  metrics: MetricSource,
  now: Date,
  options: EvaluateOptions = {},
): number {
  return evaluateCondition(condition, metrics, now, options).progress;
}

const MAX_DEPTH = 12;

function evalNode(
  node: Condition,
  metrics: MetricSource,
  now: Date,
  options: EvaluateOptions,
  depth: number,
): ConditionTrace {
  if (depth > MAX_DEPTH) {
    return {
      id: node.id, kind: 'and', met: false, children: [], progress: 0,
      explanation: 'Condition nested too deeply to evaluate.',
    };
  }

  if (isLeaf(node)) return evalLeaf(node, metrics, now, options);

  const children = node.children.map((c) => evalNode(c, metrics, now, options, depth + 1));

  if (children.length === 0) {
    return {
      id: node.id, kind: node.type, met: false, children, progress: 0,
      explanation: 'This group has no conditions yet, so it can never be met.',
    };
  }

  if (node.type === 'and') {
    const met = children.every((c) => c.met);
    const progress = met ? 1 : average(children.map((c) => c.progress));
    return {
      id: node.id, kind: 'and', met, children, progress,
      explanation: met
        ? `All ${children.length} conditions are met.`
        : `${children.filter((c) => c.met).length} of ${children.length} conditions are met.`,
    };
  }

  if (node.type === 'or') {
    const met = children.some((c) => c.met);
    const progress = met ? 1 : Math.max(...children.map((c) => c.progress));
    return {
      id: node.id, kind: 'or', met, children, progress,
      explanation: met
        ? 'At least one condition is met.'
        : `None of the ${children.length} alternatives are met yet.`,
    };
  }

  // NOT negates the AND of its children — with the usual single child that is
  // plain negation, and with several it reads as "not all of these".
  const innerMet = children.every((c) => c.met);
  const met = !innerMet;
  return {
    id: node.id, kind: 'not', met, children, progress: met ? 1 : 0,
    explanation: met
      ? 'The negated condition does not hold, so this passes.'
      : 'The negated condition currently holds, so this fails.',
  };
}

function evalLeaf(
  node: LeafCondition,
  metrics: MetricSource,
  now: Date,
  options: EvaluateOptions,
): LeafTrace {
  const label = options.labels?.[node.metric] ?? node.metric;
  const unit = options.units?.[node.metric] ?? '';
  const windowLabel = describeWindow(node.window);
  const actual = readMetric(node.metric, node.window, metrics, now);

  if (actual === null) {
    return {
      id: node.id, kind: 'leaf', metric: node.metric, metricLabel: label,
      window: node.window, windowLabel, operator: node.operator, target: node.value,
      actual: null, met: false, unknownMetric: true, progress: 0,
      explanation: `"${node.metric}" is not a metric this version can measure, so the condition cannot be met.`,
    };
  }

  const met = compare(actual, node.operator, node.value);
  const progress = leafProgress(actual, node.operator, node.value);
  const scope = node.window.kind === 'all_time' ? '' : ` ${windowLabel}`;
  const fmt = (n: number) => `${round(n)}${unit ? ` ${unit}` : ''}`;

  return {
    id: node.id, kind: 'leaf', metric: node.metric, metricLabel: label,
    window: node.window, windowLabel, operator: node.operator, target: node.value,
    actual, met, unknownMetric: false, progress,
    explanation: met
      ? `${label}${scope} is ${fmt(actual)}, which ${OPERATOR_LABELS[node.operator]} ${fmt(node.value)}.`
      : `${label}${scope} is ${fmt(actual)} and needs to be ${OPERATOR_LABELS[node.operator]} ${fmt(node.value)}.`,
  };
}

function collectLeaves(trace: ConditionTrace): LeafTrace[] {
  if (isLeafTrace(trace)) return [trace];
  return trace.children.flatMap(collectLeaves);
}

function buildSummary(trace: ConditionTrace, nearest: LeafTrace | null, leafCount: number): string {
  if (leafCount === 0) return 'No conditions defined yet.';
  if (trace.met) return 'You meet this right now.';
  if (nearest) return nearest.explanation;
  return trace.explanation;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return clamp01(values.reduce((a, b) => a + b, 0) / values.length);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Repeat periods                                                      */
/* ------------------------------------------------------------------ */

export type RepeatMode = 'once' | 'daily' | 'weekly' | 'monthly';

export const REPEAT_MODE_LABELS: Record<RepeatMode, string> = {
  once: 'Once ever',
  daily: 'Once per day',
  weekly: 'Once per week',
  monthly: 'Once per month',
};

/**
 * The bucket a reward earned at `now` belongs to. One-shot rewards share the
 * single bucket "once", so the uniqueness index alone prevents re-earning.
 */
export function periodKeyFor(mode: RepeatMode, now: Date, weekStartsOn: 0 | 1 = 1): string {
  const today = toDateKey(now);
  switch (mode) {
    case 'daily': return today;
    case 'weekly': return weekStartsOn === 1 ? isoWeekKey(today) : `w:${startOfWeekKey(today, 0)}`;
    case 'monthly': return monthKey(today);
    case 'once':
    default: return 'once';
  }
}

/** True when a reward with these past period keys may be earned again now. */
export function isEarnableNow(
  mode: RepeatMode,
  earnedPeriodKeys: readonly string[],
  now: Date,
  weekStartsOn: 0 | 1 = 1,
): boolean {
  const key = periodKeyFor(mode, now, weekStartsOn);
  return !earnedPeriodKeys.includes(key);
}

/** Human sentence for when a repeatable reward becomes available again. */
export function describeNextAvailability(mode: RepeatMode, now: Date): string {
  switch (mode) {
    case 'daily': return `Available again ${relativeLabel(toDateKey(now), 1)}.`;
    case 'weekly': return 'Available again next week.';
    case 'monthly': return 'Available again next month.';
    case 'once':
    default: return 'This reward is earned once and is now complete.';
  }
}

function relativeLabel(fromKey: string, days: number): string {
  const target = addDaysToKey(fromKey, days);
  return diffDays(fromKey, target) === 1 ? 'tomorrow' : `on ${target}`;
}

/* ------------------------------------------------------------------ */
/* AST helpers used by the builder UI                                  */
/* ------------------------------------------------------------------ */

export function countLeaves(node: Condition): number {
  return isLeaf(node) ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0);
}

/** Replaces the node with matching id, returning a new tree (never mutates). */
export function replaceNode(root: Condition, id: string, next: Condition): Condition {
  if (root.id === id) return next;
  if (isLeaf(root)) return root;
  return { ...root, children: root.children.map((c) => replaceNode(c, id, next)) };
}

/** Removes the node with matching id. Returns null if the root itself matched. */
export function removeNode(root: Condition, id: string): Condition | null {
  if (root.id === id) return null;
  if (isLeaf(root)) return root;
  return {
    ...root,
    children: root.children
      .map((c) => removeNode(c, id))
      .filter((c): c is Condition => c !== null),
  };
}

/** Appends a child to the group with matching id. */
export function addChild(root: Condition, groupId: string, child: Condition): Condition {
  if (isLeaf(root)) return root;
  if (root.id === groupId) return { ...root, children: [...root.children, child] };
  return { ...root, children: root.children.map((c) => addChild(c, groupId, child)) };
}

/** Deep clone with fresh ids, for duplicating a reward. */
export function cloneCondition(node: Condition, makeId: () => string): Condition {
  if (isLeaf(node)) return { ...node, id: makeId(), window: { ...node.window } };
  return { ...node, id: makeId(), children: node.children.map((c) => cloneCondition(c, makeId)) };
}

/** Structural validation for anything loaded from storage or an import file. */
export function isValidCondition(value: unknown): value is Condition {
  if (!value || typeof value !== 'object') return false;
  const node = value as Partial<GroupCondition> & Partial<LeafCondition>;
  if (typeof node.id !== 'string') return false;
  if (node.type === 'leaf') {
    return (
      typeof node.metric === 'string' &&
      typeof node.value === 'number' &&
      Number.isFinite(node.value) &&
      typeof node.operator === 'string' &&
      COMPARISON_OPERATORS.includes(node.operator as ComparisonOperator) &&
      !!node.window && typeof node.window === 'object' &&
      typeof (node.window as TimeWindow).kind === 'string'
    );
  }
  if (node.type === 'and' || node.type === 'or' || node.type === 'not') {
    return Array.isArray(node.children) && node.children.every(isValidCondition);
  }
  return false;
}
