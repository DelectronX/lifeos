import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { addDaysToKey, diffDays, toDateKey, todayKey } from '@/lib/date';
import { getSchedulingConfig } from './settingsService';
import { logActivity } from './activityService';
import { awardXP, revokeXPFor } from './xpService';
import { createTask } from './taskService';
import {
  applyReviewOutcome, bucketRevisions, buildEntriesForPlan, nextDueDate,
  recomputeMissedRevisions,
  type GeneratedRevision, type RevisionBucket, type RevisionEntryDraft,
} from '@/engines/revisionScheduling';
import { generateRevisionSchedule } from '@/engines/revisionScheduling';
import type {
  DateKey, ID, RevisionEntry, RevisionPlan, RevisionSourceType, Tracker,
} from '@/types';

/**
 * RevisionService — the persistence layer over RevisionSchedulingEngine.
 *
 * All interval maths, SM-2 outcomes, bucketing and missed-revision recomputation
 * live in `@/engines/revisionScheduling` and are imported read-only here. This
 * file only reads/writes Dexie, logs Activity and awards XP.
 */

/* ------------------------------------------------------------------ */
/* Creating plans                                                      */
/* ------------------------------------------------------------------ */

export interface RevisionPlanDraft {
  title: string;
  trackerId: ID;
  sourceType?: RevisionSourceType;
  sourceId?: ID | null;
  /** Day the material was learnt. Defaults to today. */
  startDate?: DateKey;
  /** Overrides the configured default ladder. */
  customIntervals?: number[];
  /** Explicit dates; when supplied they win over any ladder. */
  manualDates?: DateKey[];
  durationMinutes?: number;
  notes?: string;
  maxRepetitions?: number;
}

export interface CreatedPlan {
  plan: RevisionPlan;
  entries: RevisionEntry[];
  explanation: string;
}

/**
 * Schedules the full revision ladder for a completed learning unit. Every entry
 * is materialised up-front so the dashboard can show the whole plan, and so
 * missed-revision recomputation has something concrete to re-space.
 */
export async function createRevisionPlan(draft: RevisionPlanDraft): Promise<CreatedPlan> {
  const config = await getSchedulingConfig();
  const now = Date.now();
  const startDate = draft.startDate ?? todayKey(now);
  const intervals = draft.customIntervals?.length ? draft.customIntervals : config.revision.intervals;

  const plan: RevisionPlan = {
    id: newId('rpl'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    trackerId: draft.trackerId,
    sourceType: draft.sourceType ?? 'topic',
    sourceId: draft.sourceId ?? null,
    intervals: [...intervals],
    currentIndex: 0,
    ease: config.revision.initialEase,
    status: 'active',
    startDate,
    lastRevisedAt: null,
    defaultDurationMinutes: draft.durationMinutes ?? config.revision.defaultDurationMinutes,
    notes: draft.notes,
  };

  const drafts = buildEntriesForPlan(plan, config, {
    ...(draft.manualDates?.length ? { manualDates: draft.manualDates } : {}),
    ...(draft.maxRepetitions !== undefined ? { maxRepetitions: draft.maxRepetitions } : {}),
  });
  const entries = drafts.map((d) => materialiseEntry(d, now));

  await db.transaction('rw', [db.revisionPlans, db.revisionEntries], async () => {
    await db.revisionPlans.add(plan);
    await db.revisionEntries.bulkAdd(entries);
  });

  return {
    plan,
    entries,
    explanation: draft.manualDates?.length
      ? `${entries.length} revision${entries.length === 1 ? '' : 's'} scheduled on the dates you chose.`
      : `${entries.length} revision${entries.length === 1 ? '' : 's'} scheduled from ${startDate} using the ${draft.customIntervals?.length ? 'custom' : 'default'} ladder (${intervals.join(', ')} days).`,
  };
}

/** Preview the dates a draft would produce, without writing anything. */
export async function previewRevisionSchedule(draft: RevisionPlanDraft): Promise<GeneratedRevision[]> {
  const config = await getSchedulingConfig();
  return generateRevisionSchedule(
    {
      startDate: draft.startDate ?? todayKey(),
      ...(draft.customIntervals?.length ? { customIntervals: draft.customIntervals } : {}),
      ...(draft.manualDates?.length ? { manualDates: draft.manualDates } : {}),
      ...(draft.maxRepetitions !== undefined ? { maxRepetitions: draft.maxRepetitions } : {}),
      durationMinutes: draft.durationMinutes ?? config.revision.defaultDurationMinutes,
    },
    config,
  );
}

function materialiseEntry(d: RevisionEntryDraft, now: number): RevisionEntry {
  return {
    id: newId('rev'),
    createdAt: now,
    updatedAt: now,
    planId: d.planId,
    trackerId: d.trackerId,
    dueDate: d.dueDate,
    repetition: d.repetition,
    intervalDays: d.intervalDays,
    status: d.status,
    completedAt: null,
    quality: null,
    taskId: null,
    durationMinutes: d.durationMinutes,
  };
}

/* ------------------------------------------------------------------ */
/* Completing / postponing / rescheduling                              */
/* ------------------------------------------------------------------ */

export interface CompleteRevisionResult {
  entry: RevisionEntry;
  /** Whether recall was below the lapse threshold. */
  lapsed: boolean;
  /** Explanation string produced by the engine. */
  explanation: string;
  xpAwarded: number;
  nextEntry: RevisionEntry | null;
}

/**
 * Marks a revision done and lets the engine decide what happens next: the ease
 * moves, the ladder advances (or steps back on a lapse), and the following
 * repetition is re-dated from the day the review actually happened.
 */
export async function completeRevision(
  entryId: ID,
  quality: number,
  options: { at?: number; minutes?: number } = {},
): Promise<CompleteRevisionResult | null> {
  const config = await getSchedulingConfig();
  const at = options.at ?? Date.now();
  const reviewedOn = toDateKey(at);

  const entry = await db.revisionEntries.get(entryId);
  if (!entry) return null;
  const plan = await db.revisionPlans.get(entry.planId);
  if (!plan) return null;

  const outcome = applyReviewOutcome({ plan, entry, quality, reviewedOn }, config);
  const onTime = diffDays(reviewedOn, entry.dueDate) >= 0;

  const updatedEntry: RevisionEntry = {
    ...entry,
    status: 'completed',
    completedAt: at,
    quality: Math.max(0, Math.min(5, Math.round(quality))),
    updatedAt: at,
  };

  // The next repetition in the ladder is re-dated from today's review.
  const following = (await db.revisionEntries.where('planId').equals(plan.id).toArray())
    .filter((e) => e.status === 'scheduled' && e.repetition > entry.repetition)
    .sort((a, b) => a.repetition - b.repetition)[0] ?? null;

  let nextEntry: RevisionEntry | null = null;
  if (following) {
    nextEntry = {
      ...following,
      dueDate: outcome.nextDueDate,
      intervalDays: outcome.nextIntervalDays,
      updatedAt: at,
    };
  }

  await db.transaction('rw', [db.revisionEntries, db.revisionPlans], async () => {
    await db.revisionEntries.put(updatedEntry);
    if (nextEntry) await db.revisionEntries.put(nextEntry);

    const remaining = await db.revisionEntries
      .where('planId').equals(plan.id)
      .filter((e) => e.status === 'scheduled' || e.status === 'rescheduled')
      .count();

    await db.revisionPlans.update(plan.id, {
      ease: outcome.nextEase,
      currentIndex: outcome.nextIndex,
      lastRevisedAt: at,
      status: remaining === 0 ? 'completed' : plan.status,
      updatedAt: at,
    });
  });

  const minutes = options.minutes ?? entry.durationMinutes;
  const activity = await logActivity({
    type: 'revision_completed',
    at,
    title: plan.title,
    trackerId: entry.trackerId,
    revisionEntryId: entry.id,
    durationMs: minutes * 60_000,
    value: updatedEntry.quality,
    unit: 'recall',
    meta: {
      planId: plan.id,
      repetition: entry.repetition,
      dueDate: entry.dueDate,
      onTime,
      lapsed: outcome.lapsed,
      ease: outcome.nextEase,
    },
  });

  const award = await awardXP(
    {
      reason: 'revision_completed',
      sourceType: 'revision_entry',
      sourceId: entry.id,
      minutes,
      description: `Revision: ${plan.title}`,
    },
    { activityId: activity.id, at },
  );

  return {
    entry: updatedEntry,
    lapsed: outcome.lapsed,
    explanation: outcome.explanation,
    xpAwarded: award.amount,
    nextEntry,
  };
}

/** Undo a completion: the entry returns to scheduled and its XP is revoked. */
export async function uncompleteRevision(entryId: ID): Promise<void> {
  const entry = await db.revisionEntries.get(entryId);
  if (!entry || entry.status !== 'completed') return;

  await db.revisionEntries.update(entryId, {
    status: 'scheduled',
    completedAt: null,
    quality: null,
    updatedAt: Date.now(),
  });
  const rows = await db.activities.where('revisionEntryId').equals(entryId).toArray();
  await db.activities.bulkDelete(rows.filter((a) => a.type === 'revision_completed').map((a) => a.id));
  await revokeXPFor('revision_entry', entryId);
}

export interface PostponeResult {
  entry: RevisionEntry;
  explanation: string;
}

/** Pushes a revision out by N days. Later repetitions keep their own spacing. */
export async function postponeRevision(entryId: ID, days: number): Promise<PostponeResult | null> {
  const entry = await db.revisionEntries.get(entryId);
  if (!entry) return null;
  const shift = Math.max(1, Math.round(days));
  const toDate = addDaysToKey(entry.dueDate, shift);

  const updated: RevisionEntry = {
    ...entry,
    dueDate: toDate,
    status: 'rescheduled',
    updatedAt: Date.now(),
  };
  await db.revisionEntries.put(updated);

  return {
    entry: updated,
    explanation: `Moved from ${entry.dueDate} to ${toDate} (+${shift} day${shift === 1 ? '' : 's'}). The rest of the ladder is unchanged, so the gaps after it stay as planned.`,
  };
}

/** Moves a revision to a specific date chosen by the user. */
export async function rescheduleRevision(entryId: ID, dueDate: DateKey): Promise<PostponeResult | null> {
  const entry = await db.revisionEntries.get(entryId);
  if (!entry) return null;
  const delta = diffDays(entry.dueDate, dueDate);
  const updated: RevisionEntry = {
    ...entry,
    dueDate,
    status: 'rescheduled',
    intervalDays: Math.max(1, entry.intervalDays + delta),
    updatedAt: Date.now(),
  };
  await db.revisionEntries.put(updated);
  return {
    entry: updated,
    explanation: delta === 0
      ? `Kept on ${dueDate}.`
      : `Moved ${delta > 0 ? 'forward' : 'back'} ${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'} to ${dueDate}.`,
  };
}

export async function skipRevision(entryId: ID, reason?: string): Promise<void> {
  const entry = await db.revisionEntries.get(entryId);
  if (!entry) return;
  await db.revisionEntries.update(entryId, { status: 'skipped', updatedAt: Date.now() });
  await logActivity({
    type: 'revision_missed',
    title: 'Revision skipped',
    trackerId: entry.trackerId,
    revisionEntryId: entryId,
    meta: { reason: reason ?? null, dueDate: entry.dueDate },
  });
}

/** Materialises a schedulable Task for a revision so it can be time-blocked. */
export async function createTaskForRevision(entryId: ID): Promise<ID | null> {
  const entry = await db.revisionEntries.get(entryId);
  if (!entry) return null;
  if (entry.taskId) return entry.taskId;
  const plan = await db.revisionPlans.get(entry.planId);
  if (!plan) return null;

  const task = await createTask({
    title: `Revise: ${plan.title}`,
    trackerId: entry.trackerId,
    type: 'revision',
    status: 'planned',
    dueDate: entry.dueDate,
    estimatedMinutes: entry.durationMinutes,
    basePriority: 4,
    revisionEntryId: entry.id,
    intensity: 'medium',
    splittable: false,
  });

  await db.revisionEntries.update(entryId, { taskId: task.id, updatedAt: Date.now() });
  return task.id;
}

export async function deleteRevisionPlan(planId: ID): Promise<void> {
  await db.transaction('rw', [db.revisionPlans, db.revisionEntries], async () => {
    const entries = await db.revisionEntries.where('planId').equals(planId).toArray();
    await db.revisionEntries.bulkDelete(entries.map((e) => e.id));
    await db.revisionPlans.delete(planId);
  });
}

export async function setPlanStatus(planId: ID, status: RevisionPlan['status']): Promise<void> {
  await db.revisionPlans.update(planId, { status, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Missed handling                                                     */
/* ------------------------------------------------------------------ */

export interface MissedSweepResult {
  plansTouched: number;
  entriesMoved: number;
  entriesMissed: number;
  explanations: string[];
}

/**
 * Re-anchors every overdue ladder on today using the engine, marks genuinely
 * missed repetitions and applies the ease penalty. Idempotent — running it
 * twice on the same day changes nothing the second time.
 */
export async function recomputeAllMissedRevisions(today = todayKey()): Promise<MissedSweepResult> {
  const config = await getSchedulingConfig();
  const now = new Date();
  const plans = await db.revisionPlans.where('status').equals('active').toArray();

  let entriesMoved = 0;
  let entriesMissed = 0;
  let plansTouched = 0;
  const explanations: string[] = [];

  for (const plan of plans) {
    const entries = await db.revisionEntries.where('planId').equals(plan.id).toArray();
    const result = recomputeMissedRevisions({ plan, entries, today, now }, config);
    if (result.updates.length === 0 && result.missedEntryIds.length === 0) continue;

    plansTouched++;
    explanations.push(`${plan.title}: ${result.explanation}`);

    const missed = new Set(result.missedEntryIds);
    const at = Date.now();

    await db.transaction('rw', [db.revisionEntries, db.revisionPlans], async () => {
      for (const update of result.updates) {
        await db.revisionEntries.update(update.entryId, {
          dueDate: update.toDueDate,
          status: missed.has(update.entryId) ? 'missed' : update.status,
          updatedAt: at,
        });
        entriesMoved++;
      }
      for (const id of result.missedEntryIds) {
        if (!result.updates.some((u) => u.entryId === id)) {
          await db.revisionEntries.update(id, { status: 'missed', updatedAt: at });
        }
        entriesMissed++;
      }
      if (result.adjustedEase !== plan.ease) {
        await db.revisionPlans.update(plan.id, { ease: result.adjustedEase, updatedAt: at });
      }
    });

    for (const id of result.missedEntryIds) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;
      const already = await db.activities
        .where('revisionEntryId').equals(id)
        .filter((a) => a.type === 'revision_missed')
        .count();
      if (already > 0) continue;
      await logActivity({
        type: 'revision_missed',
        title: plan.title,
        trackerId: entry.trackerId,
        revisionEntryId: id,
        meta: { planId: plan.id, dueDate: entry.dueDate, repetition: entry.repetition },
      });
    }
  }

  return { plansTouched, entriesMoved, entriesMissed, explanations };
}

/* ------------------------------------------------------------------ */
/* Dashboard view model                                                */
/* ------------------------------------------------------------------ */

export interface RevisionCard {
  entry: RevisionEntry;
  plan: RevisionPlan;
  bucket: RevisionBucket;
  /** Engine-produced label, e.g. "Overdue by 2 days". */
  label: string;
  daysLate: number;
  trackerName: string;
  /** Day the source material was originally learnt. */
  learnedOn: DateKey;
  /** 1-based repetition number shown to the user. */
  revisionNumber: number;
  totalRepetitions: number;
  /** Every completed repetition of this plan, oldest first. */
  history: { repetition: number; dueDate: DateKey; completedAt: number | null; quality: number | null }[];
  durationMinutes: number;
}

export interface RevisionDashboard {
  overdue: RevisionCard[];
  dueToday: RevisionCard[];
  tomorrow: RevisionCard[];
  upcoming: RevisionCard[];
  missed: RevisionCard[];
  recentlyCompleted: RevisionCard[];
  totalActivePlans: number;
  /** Completed / (completed + missed) across all history, 0..1. */
  completionRate: number;
}

/** Builds the dashboard purely from records + the engine's bucketing. */
export function buildDashboard(
  plans: readonly RevisionPlan[],
  entries: readonly RevisionEntry[],
  trackers: readonly Tracker[],
  config: Parameters<typeof bucketRevisions>[1],
  today = todayKey(),
  recentlyCompletedDays = 14,
): RevisionDashboard {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const trackerById = new Map(trackers.map((t) => [t.id, t]));
  const buckets = new Map(bucketRevisions({ entries, today }, config).map((v) => [v.entryId, v]));

  const historyByPlan = new Map<ID, RevisionCard['history']>();
  for (const e of entries) {
    if (e.status !== 'completed') continue;
    const list = historyByPlan.get(e.planId) ?? [];
    list.push({ repetition: e.repetition, dueDate: e.dueDate, completedAt: e.completedAt, quality: e.quality });
    historyByPlan.set(e.planId, list);
  }
  for (const list of historyByPlan.values()) list.sort((a, b) => a.repetition - b.repetition);

  const totalByPlan = new Map<ID, number>();
  for (const e of entries) totalByPlan.set(e.planId, (totalByPlan.get(e.planId) ?? 0) + 1);

  const cards: RevisionCard[] = [];
  for (const entry of entries) {
    const plan = planById.get(entry.planId);
    const view = buckets.get(entry.id);
    if (!plan || !view) continue;
    cards.push({
      entry,
      plan,
      bucket: view.bucket,
      label: view.label,
      daysLate: view.daysLate,
      trackerName: trackerById.get(entry.trackerId)?.name ?? 'Unknown tracker',
      learnedOn: plan.startDate,
      revisionNumber: entry.repetition + 1,
      totalRepetitions: totalByPlan.get(entry.planId) ?? 1,
      history: historyByPlan.get(entry.planId) ?? [],
      durationMinutes: entry.durationMinutes,
    });
  }

  const byDue = (a: RevisionCard, b: RevisionCard) =>
    a.entry.dueDate < b.entry.dueDate ? -1 : a.entry.dueDate > b.entry.dueDate ? 1 : 0;

  const completedCards = cards
    .filter((c) => c.bucket === 'done' && c.entry.completedAt !== null
      && diffDays(toDateKey(c.entry.completedAt), today) <= recentlyCompletedDays)
    .sort((a, b) => (b.entry.completedAt ?? 0) - (a.entry.completedAt ?? 0));

  const doneCount = cards.filter((c) => c.bucket === 'done').length;
  const missedCount = cards.filter((c) => c.bucket === 'missed').length;

  return {
    overdue: cards.filter((c) => c.bucket === 'overdue').sort(byDue),
    dueToday: cards.filter((c) => c.bucket === 'due_today').sort(byDue),
    tomorrow: cards.filter((c) => c.bucket === 'tomorrow').sort(byDue),
    upcoming: cards.filter((c) => c.bucket === 'upcoming').sort(byDue),
    missed: cards.filter((c) => c.bucket === 'missed').sort(byDue),
    recentlyCompleted: completedCards,
    totalActivePlans: plans.filter((p) => p.status === 'active').length,
    completionRate: doneCount + missedCount > 0 ? doneCount / (doneCount + missedCount) : 0,
  };
}

/** Next due date for a plan without touching entries — used by plan detail. */
export async function peekNextDue(planId: ID, fromDate = todayKey()) {
  const config = await getSchedulingConfig();
  const plan = await db.revisionPlans.get(planId);
  if (!plan) return null;
  return nextDueDate(plan, fromDate, config);
}
