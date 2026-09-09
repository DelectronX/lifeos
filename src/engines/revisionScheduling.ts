import type {
  DateKey, ID, RevisionEntry, RevisionEntryStatus, RevisionPlan,
  SchedulingConfig, Timestamp,
} from '@/types';
import { addDaysToKey, diffDays, toDateKey } from '@/lib/date';

/**
 * RevisionSchedulingEngine — spaced repetition date generation.
 *
 * Three ways to get a ladder of revision dates:
 *   - the configured default interval template (1, 3, 7, 14, 30, 60, 120 days)
 *   - a custom interval array stored on the plan
 *   - explicit manual dates chosen by the user
 *
 * After each review the next interval is derived SM-2 style: recall quality
 * adjusts the plan's ease factor, and a lapse (quality below the configured
 * threshold) both shrinks the interval and rewinds the ladder.
 *
 * Missed revisions are recomputed rather than silently dropped: the ladder is
 * re-anchored on the day the user actually returns, so the schedule stays
 * truthful instead of showing a wall of overdue items.
 *
 * Pure: no DB, no clock reads — pass `now` / `today`.
 */

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

export interface GeneratedRevision {
  /** 0-based repetition number within the plan. */
  repetition: number;
  dueDate: DateKey;
  /** Days since the previous repetition (or since the anchor for #0). */
  intervalDays: number;
  /** Cumulative days from the anchor date. */
  offsetDays: number;
  durationMinutes: number;
  reason: string;
}

export interface GenerateScheduleInput {
  /** Day the ladder is anchored on — usually the day the material was learnt. */
  startDate: DateKey;
  /** Overrides the config ladder when provided. */
  customIntervals?: readonly number[];
  /** Explicit dates; when given they win outright and intervals are derived. */
  manualDates?: readonly DateKey[];
  /** Cap on how many repetitions to emit. */
  maxRepetitions?: number;
  durationMinutes?: number;
  /** Multiplies every interval; defaults to 1 (no ease adjustment). */
  easeFactor?: number;
}

export function generateRevisionSchedule(
  input: GenerateScheduleInput,
  config: SchedulingConfig,
): GeneratedRevision[] {
  const duration = input.durationMinutes ?? config.revision.defaultDurationMinutes;

  // --- manual dates win outright ---------------------------------------
  if (input.manualDates && input.manualDates.length > 0) {
    const sorted = [...new Set(input.manualDates)].sort();
    let previous = input.startDate;
    return sorted.map((date, i) => {
      const interval = Math.max(0, diffDays(previous, date));
      previous = date;
      return {
        repetition: i,
        dueDate: date,
        intervalDays: interval,
        offsetDays: diffDays(input.startDate, date),
        durationMinutes: duration,
        reason: `Manually chosen date — repetition ${i + 1}, ${interval} day${interval === 1 ? '' : 's'} after the previous review.`,
      };
    });
  }

  // --- interval ladder --------------------------------------------------
  const source = input.customIntervals?.length ? input.customIntervals : config.revision.intervals;
  const intervals = normaliseIntervals(source);
  const limit = Math.min(input.maxRepetitions ?? intervals.length, intervals.length);
  const ease = clamp(input.easeFactor ?? 1, 0.25, 4);
  const custom = Boolean(input.customIntervals?.length);

  const out: GeneratedRevision[] = [];
  let offset = 0;
  for (let i = 0; i < limit; i++) {
    const scaled = Math.max(1, Math.round(intervals[i]! * ease));
    offset += scaled;
    out.push({
      repetition: i,
      dueDate: addDaysToKey(input.startDate, offset),
      intervalDays: scaled,
      offsetDays: offset,
      durationMinutes: duration,
      reason: `Repetition ${i + 1} of ${limit}: ${scaled} day${scaled === 1 ? '' : 's'} after the previous review${ease !== 1 ? ` (ease x${round2(ease)})` : ''}, from the ${custom ? 'custom' : 'default'} interval ladder.`,
    });
  }
  return out;
}

/** Builds the persistable RevisionEntry drafts for a plan. */
export interface RevisionEntryDraft {
  planId: ID;
  trackerId: ID;
  dueDate: DateKey;
  repetition: number;
  intervalDays: number;
  status: RevisionEntryStatus;
  durationMinutes: number;
  reason: string;
}

export function buildEntriesForPlan(
  plan: RevisionPlan,
  config: SchedulingConfig,
  options: { manualDates?: readonly DateKey[]; maxRepetitions?: number } = {},
): RevisionEntryDraft[] {
  const generated = generateRevisionSchedule(
    {
      startDate: plan.startDate,
      customIntervals: plan.intervals,
      ...(options.manualDates ? { manualDates: options.manualDates } : {}),
      ...(options.maxRepetitions !== undefined ? { maxRepetitions: options.maxRepetitions } : {}),
      durationMinutes: plan.defaultDurationMinutes,
    },
    config,
  );

  return generated
    .filter((g) => g.repetition >= plan.currentIndex)
    .map((g) => ({
      planId: plan.id,
      trackerId: plan.trackerId,
      dueDate: g.dueDate,
      repetition: g.repetition,
      intervalDays: g.intervalDays,
      status: 'scheduled' as const,
      durationMinutes: g.durationMinutes,
      reason: g.reason,
    }));
}

/* ------------------------------------------------------------------ */
/* Review outcome                                                      */
/* ------------------------------------------------------------------ */

export interface ReviewOutcomeInput {
  plan: RevisionPlan;
  entry: RevisionEntry;
  /** SM-2 recall quality, 0 (blank) .. 5 (perfect). */
  quality: number;
  /** Day the review actually happened. */
  reviewedOn: DateKey;
}

export interface ReviewOutcome {
  lapsed: boolean;
  /** Ease after the review, clamped to config bounds. */
  nextEase: number;
  /** Ladder index the plan should move to. */
  nextIndex: number;
  nextIntervalDays: number;
  nextDueDate: DateKey;
  explanation: string;
}

/**
 * SM-2 flavoured: quality raises or lowers the ease, and a lapse rewinds the
 * ladder one step and applies `lapsePenalty` to the interval, so weak material
 * comes back sooner instead of drifting away.
 */
export function applyReviewOutcome(
  input: ReviewOutcomeInput,
  config: SchedulingConfig,
): ReviewOutcome {
  const { plan, entry, quality, reviewedOn } = input;
  const q = clamp(quality, 0, 5);
  const lapsed = q < config.revision.lapseQualityThreshold;

  // Standard SM-2 ease update.
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const nextEase = clamp(
    round2(plan.ease + delta),
    config.revision.minEase,
    config.revision.maxEase,
  );

  const intervals = normaliseIntervals(plan.intervals.length ? plan.intervals : config.revision.intervals);
  const nextIndex = lapsed
    ? Math.max(0, entry.repetition - 1)
    : Math.min(intervals.length - 1, entry.repetition + 1);

  const baseInterval = intervals[nextIndex] ?? intervals[intervals.length - 1]!;
  const raw = lapsed
    ? baseInterval * config.revision.lapsePenalty
    : baseInterval * (nextEase / config.revision.initialEase);
  const nextIntervalDays = Math.max(1, Math.round(raw));

  return {
    lapsed,
    nextEase,
    nextIndex,
    nextIntervalDays,
    nextDueDate: addDaysToKey(reviewedOn, nextIntervalDays),
    explanation: lapsed
      ? `Recall was ${q}/5 (below ${config.revision.lapseQualityThreshold}) — the ladder steps back to repetition ${nextIndex + 1} and the next review is in ${nextIntervalDays} day${nextIntervalDays === 1 ? '' : 's'} instead of ${baseInterval}. Ease drops to ${nextEase}.`
      : `Recall was ${q}/5 — moving to repetition ${nextIndex + 1}, next review in ${nextIntervalDays} day${nextIntervalDays === 1 ? '' : 's'}. Ease is now ${nextEase}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Missed revisions                                                    */
/* ------------------------------------------------------------------ */

export type RevisionBucket = 'overdue' | 'due_today' | 'tomorrow' | 'upcoming' | 'done' | 'missed';

export interface RevisionStatusView {
  entryId: ID;
  planId: ID;
  dueDate: DateKey;
  bucket: RevisionBucket;
  daysLate: number;
  label: string;
}

export interface BucketRevisionsInput {
  entries: readonly RevisionEntry[];
  today: DateKey;
}

/** Dashboard grouping: Overdue / Due today / Tomorrow / Upcoming / Completed. */
export function bucketRevisions(
  input: BucketRevisionsInput,
  config: SchedulingConfig,
): RevisionStatusView[] {
  return input.entries.map((e) => {
    const delta = diffDays(input.today, e.dueDate);
    const daysLate = Math.max(0, -delta);

    let bucket: RevisionBucket;
    if (e.status === 'completed') bucket = 'done';
    else if (e.status === 'missed') bucket = 'missed';
    else if (delta < 0) bucket = daysLate > config.revision.missedAfterDays ? 'missed' : 'overdue';
    else if (delta === 0) bucket = 'due_today';
    else if (delta === 1) bucket = 'tomorrow';
    else bucket = 'upcoming';

    return {
      entryId: e.id,
      planId: e.planId,
      dueDate: e.dueDate,
      bucket,
      daysLate,
      label: bucketLabel(bucket, delta, daysLate),
    };
  });
}

function bucketLabel(bucket: RevisionBucket, delta: number, daysLate: number): string {
  switch (bucket) {
    case 'done': return 'Completed';
    case 'missed': return `Missed — ${daysLate} day${daysLate === 1 ? '' : 's'} past due`;
    case 'overdue': return `Overdue by ${daysLate} day${daysLate === 1 ? '' : 's'}`;
    case 'due_today': return 'Due today';
    case 'tomorrow': return 'Due tomorrow';
    default: return `Due in ${delta} days`;
  }
}

export interface MissedRecomputeInput {
  plan: RevisionPlan;
  entries: readonly RevisionEntry[];
  today: DateKey;
  /** Reference clock for `updatedAt`-style bookkeeping by the caller. */
  now: Date;
}

export interface RecomputedEntry {
  entryId: ID;
  /** Original due date, kept so the UI can show what slipped. */
  fromDueDate: DateKey;
  toDueDate: DateKey;
  status: RevisionEntryStatus;
  daysLate: number;
  reason: string;
}

export interface MissedRecomputeResult {
  /** Entries whose due date moves. */
  updates: RecomputedEntry[];
  /** Entries that should be flagged missed (past the grace period). */
  missedEntryIds: ID[];
  /** Ease the plan should adopt after the misses. */
  adjustedEase: number;
  explanation: string;
}

/**
 * Re-anchors an overdue ladder on today.
 *
 * Rule: the oldest overdue repetition is brought to today; every later
 * repetition is re-spaced from there using its own interval, so the shape of
 * the ladder survives the gap. Entries missed by more than the grace period
 * also cost the plan some ease — you clearly did not remember it.
 */
export function recomputeMissedRevisions(
  input: MissedRecomputeInput,
  config: SchedulingConfig,
): MissedRecomputeResult {
  const pending = input.entries
    .filter((e) => e.status === 'scheduled' || e.status === 'missed')
    .sort((a, b) => a.repetition - b.repetition || (a.dueDate < b.dueDate ? -1 : 1));

  const overdue = pending.filter((e) => diffDays(input.today, e.dueDate) < 0);
  if (overdue.length === 0) {
    return {
      updates: [],
      missedEntryIds: [],
      adjustedEase: input.plan.ease,
      explanation: 'No overdue revisions — the ladder is on track.',
    };
  }

  const missedEntryIds = overdue
    .filter((e) => -diffDays(input.today, e.dueDate) > config.revision.missedAfterDays)
    .map((e) => e.id);

  // One ease penalty per genuinely missed repetition, floored at minEase.
  const adjustedEase = clamp(
    round2(input.plan.ease - 0.15 * missedEntryIds.length),
    config.revision.minEase,
    config.revision.maxEase,
  );

  const updates: RecomputedEntry[] = [];
  let anchor = input.today;
  let first = true;

  for (const e of pending) {
    const daysLate = Math.max(0, -diffDays(input.today, e.dueDate));
    const isOverdue = diffDays(input.today, e.dueDate) < 0;

    if (first && isOverdue) {
      // Oldest overdue item comes back today, shrunk if it was truly missed.
      updates.push({
        entryId: e.id,
        fromDueDate: e.dueDate,
        toDueDate: input.today,
        status: 'rescheduled',
        daysLate,
        reason: `Was due ${e.dueDate} (${daysLate} day${daysLate === 1 ? '' : 's'} ago) — pulled to today so the ladder restarts from real life rather than piling up.`,
      });
      anchor = input.today;
      first = false;
      continue;
    }

    // Later repetitions re-space from the new anchor using their own interval.
    const interval = Math.max(1, Math.round(e.intervalDays * (isOverdue ? config.revision.lapsePenalty : 1)));
    const next = addDaysToKey(anchor, interval);
    anchor = next;

    if (next !== e.dueDate) {
      updates.push({
        entryId: e.id,
        fromDueDate: e.dueDate,
        toDueDate: next,
        status: 'rescheduled',
        daysLate,
        reason: isOverdue
          ? `Also overdue — re-spaced ${interval} day${interval === 1 ? '' : 's'} after the repetition before it (interval halved because the material lapsed).`
          : `Pushed to ${next} to keep the ${interval}-day gap after the repetition before it.`,
      });
    }
  }

  return {
    updates,
    missedEntryIds,
    adjustedEase,
    explanation: `${overdue.length} revision${overdue.length === 1 ? '' : 's'} slipped past their due date. The oldest is brought forward to today and the rest re-spaced behind it${missedEntryIds.length > 0 ? `; ${missedEntryIds.length} were more than ${config.revision.missedAfterDays} day${config.revision.missedAfterDays === 1 ? '' : 's'} late, so ease drops from ${input.plan.ease} to ${adjustedEase}` : ''}.`,
  };
}

/** Next due date for a plan without touching its entries. */
export function nextDueDate(
  plan: RevisionPlan,
  fromDate: DateKey,
  config: SchedulingConfig,
): { dueDate: DateKey; intervalDays: number; reason: string } {
  const intervals = normaliseIntervals(plan.intervals.length ? plan.intervals : config.revision.intervals);
  const index = clamp(plan.currentIndex, 0, intervals.length - 1);
  const interval = Math.max(1, Math.round(intervals[index]! * (plan.ease / config.revision.initialEase)));
  return {
    dueDate: addDaysToKey(fromDate, interval),
    intervalDays: interval,
    reason: `Repetition ${index + 1} uses a ${intervals[index]} day base interval, scaled by ease ${plan.ease} to ${interval} days.`,
  };
}

/** Convenience for callers holding a timestamp rather than a date key. */
export function todayKeyOf(now: Date): DateKey {
  return toDateKey(now.getTime() as Timestamp);
}

/* ------------------------------------------------------------------ */

/** Positive integers, ascending, de-duplicated. Guarantees a usable ladder. */
function normaliseIntervals(intervals: readonly number[]): number[] {
  const cleaned = [...new Set(intervals.map((n) => Math.max(1, Math.round(n))))].sort((a, b) => a - b);
  return cleaned.length > 0 ? cleaned : [1];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
