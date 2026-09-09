import type {
  Activity, ID, SchedulingConfig, Task, TaskType, TimerSession,
} from '@/types';

/**
 * DurationPredictionEngine — "you always think this takes 30 minutes; it takes 50."
 *
 * Pairs each completed task with the real time actually spent on it (from
 * TimerSessions, or the task's rolled-up actualMinutes, or Activity duration),
 * groups those pairs by tracker / task type / an explicit subject key, and
 * reports the overrun ratio with a confidence level and a suggested range.
 *
 * It NEVER overrides a user's estimate. `suggestion` is advisory data for the
 * UI to display next to the estimate field; applying it is the user's choice.
 *
 * Pure: no DB, no clock reads.
 */

export type PredictionGroupKind = 'tracker' | 'task_type' | 'subject' | 'global';

export type PredictionConfidence = 'none' | 'low' | 'medium' | 'high';

export interface DurationSample {
  taskId: ID;
  title: string;
  estimatedMinutes: number;
  actualMinutes: number;
  /** actual / estimated. 1.0 = perfect estimate. */
  ratio: number;
  trackerId: ID;
  taskType: TaskType;
  subject: string | null;
  completedAt: number | null;
}

export interface DurationPrediction {
  groupKind: PredictionGroupKind;
  /** trackerId, TaskType, subject string, or 'all'. */
  groupKey: string;
  groupLabel: string;
  sampleSize: number;
  /** Mean actual/estimated ratio across samples, clamped to config bounds. */
  averageOverrunRatio: number;
  /** Ratio at the middle sample — robust against one catastrophic outlier. */
  medianOverrunRatio: number;
  meanEstimatedMinutes: number;
  meanActualMinutes: number;
  /** Population standard deviation of the ratios. */
  ratioStdDev: number;
  confidence: PredictionConfidence;
  /** Advisory range for a NEW estimate of `referenceMinutes`. */
  suggestion: {
    referenceMinutes: number;
    lowMinutes: number;
    likelyMinutes: number;
    highMinutes: number;
  } | null;
  /** Sentence like "Maths sessions run about 35% longer than you plan." */
  pattern: string;
  /** True when the group consistently overruns beyond the noise floor. */
  systematicOverrun: boolean;
  systematicUnderrun: boolean;
}

export interface DurationPredictionInput {
  tasks: readonly Task[];
  /** Optional; used in preference to task.actualMinutes when present. */
  sessions?: readonly TimerSession[];
  /** Optional; a fallback source of real duration. */
  activities?: readonly Activity[];
  /**
   * Maps a task to a free-form subject/topic key (e.g. its tracker's name or a
   * tag). Returning null excludes the task from subject grouping.
   */
  subjectOf?: (task: Task) => string | null;
  /** Human labels for tracker ids, used only for the pattern sentence. */
  trackerNames?: Readonly<Record<ID, string>>;
}

/* ------------------------------------------------------------------ */

/** Builds estimated-vs-actual pairs from whatever real records exist. */
export function buildSamples(input: DurationPredictionInput): DurationSample[] {
  const sessionMinutes = new Map<ID, number>();
  for (const s of input.sessions ?? []) {
    if (!s.taskId) continue;
    sessionMinutes.set(s.taskId, (sessionMinutes.get(s.taskId) ?? 0) + s.workMs / 60_000);
  }

  const activityMinutes = new Map<ID, number>();
  for (const a of input.activities ?? []) {
    if (!a.taskId || a.durationMs <= 0) continue;
    activityMinutes.set(a.taskId, (activityMinutes.get(a.taskId) ?? 0) + a.durationMs / 60_000);
  }

  const out: DurationSample[] = [];
  for (const task of input.tasks) {
    if (task.status !== 'completed') continue;
    const estimated = Math.round(task.estimatedMinutes);
    if (estimated <= 0) continue;

    const actual = Math.round(
      sessionMinutes.get(task.id)
      ?? (task.actualMinutes > 0 ? task.actualMinutes : undefined)
      ?? activityMinutes.get(task.id)
      ?? 0,
    );
    if (actual <= 0) continue;

    out.push({
      taskId: task.id,
      title: task.title,
      estimatedMinutes: estimated,
      actualMinutes: actual,
      ratio: actual / estimated,
      trackerId: task.trackerId,
      taskType: task.type,
      subject: input.subjectOf?.(task) ?? null,
      completedAt: task.completedAt,
    });
  }
  return out;
}

/** Predictions for every tracker, task type and subject with enough samples. */
export function predictDurations(
  input: DurationPredictionInput,
  config: SchedulingConfig,
): DurationPrediction[] {
  const samples = buildSamples(input);
  const out: DurationPrediction[] = [];

  const groups: { kind: PredictionGroupKind; key: (s: DurationSample) => string | null }[] = [
    { kind: 'tracker', key: (s) => s.trackerId },
    { kind: 'task_type', key: (s) => s.taskType },
    { kind: 'subject', key: (s) => s.subject },
  ];

  for (const g of groups) {
    const buckets = new Map<string, DurationSample[]>();
    for (const s of samples) {
      const k = g.key(s);
      if (k === null) continue;
      const list = buckets.get(k);
      if (list) list.push(s);
      else buckets.set(k, [s]);
    }
    for (const [key, list] of [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out.push(summarise(g.kind, key, labelFor(g.kind, key, input), list, config));
    }
  }

  if (samples.length > 0) {
    out.push(summarise('global', 'all', 'All tasks', samples, config));
  }

  return out;
}

/** Prediction for one group, or a zero-sample placeholder. */
export function predictForGroup(
  kind: PredictionGroupKind,
  key: string,
  input: DurationPredictionInput,
  config: SchedulingConfig,
): DurationPrediction {
  const samples = buildSamples(input).filter((s) => groupKeyOf(kind, s) === key);
  return summarise(kind, key, labelFor(kind, key, input), samples, config);
}

/**
 * Advisory suggestion for a specific task, using the most specific group that
 * has enough samples (subject > tracker > task type > global).
 */
export function suggestDurationForTask(
  task: Task,
  input: DurationPredictionInput,
  config: SchedulingConfig,
): DurationPrediction | null {
  const all = predictDurations(input, config);
  const subject = input.subjectOf?.(task) ?? null;

  const candidates = [
    subject ? all.find((p) => p.groupKind === 'subject' && p.groupKey === subject) : undefined,
    all.find((p) => p.groupKind === 'tracker' && p.groupKey === task.trackerId),
    all.find((p) => p.groupKind === 'task_type' && p.groupKey === task.type),
    all.find((p) => p.groupKind === 'global'),
  ].filter((p): p is DurationPrediction => Boolean(p));

  const chosen = candidates.find((p) => p.sampleSize >= config.duration.minSamples) ?? null;
  if (!chosen) return null;
  return { ...chosen, suggestion: buildSuggestion(chosen, task.estimatedMinutes, config) };
}

/* ------------------------------------------------------------------ */

function summarise(
  kind: PredictionGroupKind,
  key: string,
  label: string,
  samples: readonly DurationSample[],
  config: SchedulingConfig,
): DurationPrediction {
  const n = samples.length;
  if (n === 0) {
    return {
      groupKind: kind, groupKey: key, groupLabel: label,
      sampleSize: 0,
      averageOverrunRatio: 1, medianOverrunRatio: 1,
      meanEstimatedMinutes: 0, meanActualMinutes: 0, ratioStdDev: 0,
      confidence: 'none', suggestion: null,
      pattern: `No completed ${label} tasks with tracked time yet — nothing to learn from.`,
      systematicOverrun: false, systematicUnderrun: false,
    };
  }

  const clampRatio = (r: number) =>
    Math.min(config.duration.maxRatio, Math.max(config.duration.minRatio, r));

  const ratios = samples.map((s) => clampRatio(s.ratio)).sort((a, b) => a - b);
  const mean = ratios.reduce((s, r) => s + r, 0) / n;
  const median = n % 2 === 1
    ? ratios[(n - 1) / 2]!
    : (ratios[n / 2 - 1]! + ratios[n / 2]!) / 2;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const meanEst = samples.reduce((s, x) => s + x.estimatedMinutes, 0) / n;
  const meanAct = samples.reduce((s, x) => s + x.actualMinutes, 0) / n;

  const confidence = confidenceOf(n, stdDev, config);
  // A drift is "systematic" only when it exceeds 10% and beats the noise.
  const drift = median - 1;
  const systematicOverrun = n >= config.duration.minSamples && drift > 0.1 && Math.abs(drift) > stdDev / 2;
  const systematicUnderrun = n >= config.duration.minSamples && drift < -0.1 && Math.abs(drift) > stdDev / 2;

  const prediction: DurationPrediction = {
    groupKind: kind, groupKey: key, groupLabel: label,
    sampleSize: n,
    averageOverrunRatio: round2(mean),
    medianOverrunRatio: round2(median),
    meanEstimatedMinutes: Math.round(meanEst),
    meanActualMinutes: Math.round(meanAct),
    ratioStdDev: round2(stdDev),
    confidence,
    suggestion: null,
    pattern: '',
    systematicOverrun,
    systematicUnderrun,
  };

  prediction.suggestion = buildSuggestion(prediction, Math.round(meanEst), config);
  prediction.pattern = buildPattern(prediction, label, config);
  return prediction;
}

function buildSuggestion(
  p: DurationPrediction,
  referenceMinutes: number,
  config: SchedulingConfig,
): DurationPrediction['suggestion'] {
  if (p.sampleSize < config.duration.minSamples) return null;
  const ref = Math.max(1, Math.round(referenceMinutes));
  const round = (m: number) =>
    Math.max(
      config.duration.roundToMinutes,
      Math.round(m / config.duration.roundToMinutes) * config.duration.roundToMinutes,
    );

  const spread = Math.max(0.1, p.ratioStdDev);
  return {
    referenceMinutes: ref,
    lowMinutes: round(ref * Math.max(config.duration.minRatio, p.medianOverrunRatio - spread)),
    likelyMinutes: round(ref * p.medianOverrunRatio),
    highMinutes: round(ref * Math.min(config.duration.maxRatio, p.medianOverrunRatio + spread)),
  };
}

function confidenceOf(n: number, stdDev: number, config: SchedulingConfig): PredictionConfidence {
  if (n < config.duration.minSamples) return 'none';
  if (n >= config.duration.minSamples * 4 && stdDev <= 0.25) return 'high';
  if (n >= config.duration.minSamples * 2 && stdDev <= 0.5) return 'medium';
  return 'low';
}

function buildPattern(p: DurationPrediction, label: string, config: SchedulingConfig): string {
  if (p.sampleSize < config.duration.minSamples) {
    return `Only ${p.sampleSize} completed ${label} task${p.sampleSize === 1 ? '' : 's'} with tracked time — ${config.duration.minSamples} needed before a suggestion is offered.`;
  }

  const pct = Math.round(Math.abs(p.medianOverrunRatio - 1) * 100);
  const base = `Across ${p.sampleSize} ${label} task${p.sampleSize === 1 ? '' : 's'} you estimated ${p.meanEstimatedMinutes} min on average and actually spent ${p.meanActualMinutes} min`;

  let drift: string;
  if (p.systematicOverrun) drift = ` — about ${pct}% longer than planned, consistently.`;
  else if (p.systematicUnderrun) drift = ` — about ${pct}% shorter than planned, consistently.`;
  else if (pct <= 10) drift = ' — your estimates here are accurate.';
  else drift = ` — ${pct}% ${p.medianOverrunRatio > 1 ? 'over' : 'under'}, but the spread is too wide to call it a pattern.`;

  const s = p.suggestion;
  const advice = s
    ? ` For a ${s.referenceMinutes} min plan, expect ${s.lowMinutes}-${s.highMinutes} min (likely ${s.likelyMinutes}). Confidence: ${p.confidence}.`
    : '';

  return `${base}${drift}${advice}`;
}

function groupKeyOf(kind: PredictionGroupKind, s: DurationSample): string | null {
  switch (kind) {
    case 'tracker': return s.trackerId;
    case 'task_type': return s.taskType;
    case 'subject': return s.subject;
    case 'global': return 'all';
  }
}

function labelFor(kind: PredictionGroupKind, key: string, input: DurationPredictionInput): string {
  if (kind === 'tracker') return input.trackerNames?.[key] ?? key;
  if (kind === 'task_type') return key.replace(/_/g, ' ');
  if (kind === 'global') return 'All tasks';
  return key;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
