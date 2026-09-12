import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingConfig';
import type { RevisionEntry, RevisionPlan, RevisionPlanStatus } from '@/types';
import type { DemoContext } from './world';

/**
 * Revision plans + entries, arranged so the dashboard has something in EVERY
 * bucket: overdue, due today, tomorrow, upcoming, missed and recently
 * completed. Ladder positions are computed from the real interval ladder, and
 * each plan's `currentIndex` / `lastRevisedAt` / `ease` agree with the entries
 * that exist, so the SM-2 maths continues correctly from here.
 */

const LADDER = DEFAULT_SCHEDULING_CONFIG.revision.intervals; // [1,3,7,14,30,60,120]

interface PlanSeed {
  id: string;
  title: string;
  trackerId: string;
  /** Days ago the material was learnt. */
  learnedOffset: number;
  status: RevisionPlanStatus;
  /** How many ladder steps have already been completed. */
  completed: number;
  /** Repetitions that were missed rather than completed (by ladder index). */
  missedIndexes?: number[];
  durationMinutes: number;
  /** Recall quality recorded for the completed repetitions. */
  qualities: number[];
  notes?: string;
}

const PLANS: PlanSeed[] = [
  {
    id: 'rpl_demo_integration', title: 'Integration techniques', trackerId: 'trk_demo_maths',
    learnedOffset: -31, status: 'active', completed: 4, durationMinutes: 30,
    qualities: [3, 4, 4, 5], notes: 'Substitution and by-parts. Partial fractions still shaky.',
  },
  {
    id: 'rpl_demo_electrostatics', title: 'Electrostatics', trackerId: 'trk_demo_physics',
    learnedOffset: -15, status: 'active', completed: 3, durationMinutes: 25,
    qualities: [2, 3, 4],
  },
  {
    id: 'rpl_demo_organic', title: 'Organic named reactions', trackerId: 'trk_demo_chemistry',
    learnedOffset: -8, status: 'active', completed: 2, missedIndexes: [1], durationMinutes: 35,
    qualities: [3, 2], notes: 'Missed the day-3 pass during the mock week.',
  },
  {
    id: 'rpl_demo_genetics', title: 'Genetics — inheritance patterns', trackerId: 'trk_demo_biology',
    learnedOffset: -3, status: 'active', completed: 1, durationMinutes: 25,
    qualities: [4],
  },
  {
    id: 'rpl_demo_waves', title: 'Wave optics', trackerId: 'trk_demo_physics',
    learnedOffset: -45, status: 'active', completed: 5, missedIndexes: [2], durationMinutes: 30,
    qualities: [3, 3, 4, 4, 5],
  },
  {
    id: 'rpl_demo_vectors', title: 'Vectors and 3D geometry', trackerId: 'trk_demo_maths',
    learnedOffset: -1, status: 'active', completed: 0, durationMinutes: 30,
    qualities: [],
  },
  {
    id: 'rpl_demo_essay', title: 'Essay structure patterns', trackerId: 'trk_demo_english',
    learnedOffset: -58, status: 'completed', completed: 7, durationMinutes: 20,
    qualities: [3, 4, 4, 5, 5, 5, 5], notes: 'Ladder finished — reliably recalled.',
  },
  {
    id: 'rpl_demo_thermo', title: 'Thermodynamics laws', trackerId: 'trk_demo_physics',
    learnedOffset: -22, status: 'paused', completed: 2, durationMinutes: 30,
    qualities: [3, 3], notes: 'Paused until the mechanics unit is finished.',
  },
];

export function seedRevision(ctx: DemoContext): void {
  for (const seed of PLANS) {
    const createdAt = ctx.at(ctx.day(seed.learnedOffset), 20 * 60);
    const missed = new Set(seed.missedIndexes ?? []);

    let ease = DEFAULT_SCHEDULING_CONFIG.revision.initialEase;
    for (const q of seed.qualities) {
      // Same direction as the SM-2 update the real engine applies.
      ease = Math.min(
        DEFAULT_SCHEDULING_CONFIG.revision.maxEase,
        Math.max(DEFAULT_SCHEDULING_CONFIG.revision.minEase, ease + (0.1 - (5 - q) * 0.08)),
      );
    }

    const entries: RevisionEntry[] = [];
    let cumulative = 0;
    let lastRevisedAt: number | null = null;
    let qualityIndex = 0;

    for (let rep = 0; rep < LADDER.length; rep++) {
      const intervalDays = LADDER[rep]!;
      cumulative += intervalDays;
      const dueOffset = seed.learnedOffset + cumulative;
      const dueDate = ctx.day(dueOffset);

      const isPast = dueOffset < 0;
      const wasMissed = missed.has(rep);
      const wasCompleted = !wasMissed && qualityIndex < seed.qualities.length && isPast;

      let status: RevisionEntry['status'] = 'scheduled';
      let completedAt: number | null = null;
      let quality: number | null = null;

      if (wasMissed) {
        status = 'missed';
      } else if (wasCompleted) {
        status = 'completed';
        // Completed a little after the due time, occasionally a day late.
        const slip = ctx.rng.chance(0.25) ? 1 : 0;
        completedAt = ctx.at(ctx.day(dueOffset + slip), ctx.rng.int(17, 21) * 60);
        quality = seed.qualities[qualityIndex] ?? 3;
        qualityIndex += 1;
        lastRevisedAt = completedAt;
      } else if (isPast) {
        // Past, not completed, not explicitly missed: genuinely overdue.
        status = dueOffset < -DEFAULT_SCHEDULING_CONFIG.revision.missedAfterDays ? 'missed' : 'scheduled';
      }

      // The essay plan finished its ladder; everything after the last
      // completed repetition is dropped so the plan reads as done.
      if (seed.status === 'completed' && !wasCompleted && !isPast) break;

      entries.push({
        id: `${seed.id}_r${rep}`,
        createdAt,
        updatedAt: completedAt ?? createdAt,
        planId: seed.id,
        trackerId: seed.trackerId,
        dueDate,
        repetition: rep,
        intervalDays,
        status,
        completedAt,
        quality,
        taskId: null,
        durationMinutes: seed.durationMinutes,
      });

      if (completedAt !== null) {
        ctx.world.activities.push({
          id: ctx.id('act'),
          createdAt: completedAt,
          updatedAt: completedAt,
          type: 'revision_completed',
          at: completedAt,
          date: ctx.day(dueOffset),
          trackerId: seed.trackerId,
          taskId: null,
          goalId: null,
          blockId: null,
          sessionId: null,
          paperId: null,
          revisionEntryId: `${seed.id}_r${rep}`,
          habitId: null,
          resourceId: null,
          durationMs: seed.durationMinutes * 60_000,
          value: quality,
          unit: 'quality',
          title: seed.title,
          meta: { repetition: rep, intervalDays },
        });
      } else if (status === 'missed') {
        ctx.world.activities.push({
          id: ctx.id('act'),
          createdAt,
          updatedAt: createdAt,
          type: 'revision_missed',
          at: ctx.at(dueDate, 23 * 60),
          date: dueDate,
          trackerId: seed.trackerId,
          taskId: null,
          goalId: null,
          blockId: null,
          sessionId: null,
          paperId: null,
          revisionEntryId: `${seed.id}_r${rep}`,
          habitId: null,
          resourceId: null,
          durationMs: 0,
          value: null,
          unit: null,
          title: seed.title,
          meta: { repetition: rep },
        });
      }
    }

    const plan: RevisionPlan = {
      id: seed.id,
      createdAt,
      updatedAt: lastRevisedAt ?? createdAt,
      title: seed.title,
      trackerId: seed.trackerId,
      sourceType: 'topic',
      sourceId: null,
      intervals: [...LADDER],
      currentIndex: Math.min(LADDER.length - 1, seed.completed + (seed.missedIndexes?.length ?? 0)),
      ease: Math.round(ease * 100) / 100,
      status: seed.status,
      startDate: ctx.day(seed.learnedOffset),
      lastRevisedAt,
      defaultDurationMinutes: seed.durationMinutes,
      notes: seed.notes,
    };

    ctx.world.revisionPlans.push(plan);
    ctx.world.revisionEntries.push(...entries);
  }

  ensureDueBuckets(ctx);
}

/**
 * Guarantees the dashboard has at least one card in the today / tomorrow /
 * upcoming buckets regardless of how the ladder arithmetic landed. Without
 * this, a particular "today" could leave a section empty, which is exactly the
 * empty screen the demo dataset exists to prevent.
 */
function ensureDueBuckets(ctx: DemoContext): void {
  const has = (offset: number) =>
    ctx.world.revisionEntries.some((e) => e.status === 'scheduled' && e.dueDate === ctx.day(offset));

  const fillers: { offset: number; planId: string; trackerId: string }[] = [];
  // -1 lands in the "overdue" bucket (late, but inside the grace period).
  if (!has(-1)) fillers.push({ offset: -1, planId: 'rpl_demo_waves', trackerId: 'trk_demo_physics' });
  if (!has(0)) fillers.push({ offset: 0, planId: 'rpl_demo_integration', trackerId: 'trk_demo_maths' });
  if (!has(1)) fillers.push({ offset: 1, planId: 'rpl_demo_electrostatics', trackerId: 'trk_demo_physics' });
  if (!has(4)) fillers.push({ offset: 4, planId: 'rpl_demo_genetics', trackerId: 'trk_demo_biology' });
  if (!has(9)) fillers.push({ offset: 9, planId: 'rpl_demo_organic', trackerId: 'trk_demo_chemistry' });

  for (const filler of fillers) {
    const plan = ctx.world.revisionPlans.find((p) => p.id === filler.planId);
    if (!plan) continue;
    const existing = ctx.world.revisionEntries.filter((e) => e.planId === plan.id);
    const repetition = existing.length;
    ctx.world.revisionEntries.push({
      id: `${plan.id}_x${repetition}`,
      createdAt: ctx.at(ctx.day(-1), 20 * 60),
      updatedAt: ctx.at(ctx.day(-1), 20 * 60),
      planId: plan.id,
      trackerId: filler.trackerId,
      dueDate: ctx.day(filler.offset),
      repetition,
      intervalDays: LADDER[Math.min(repetition, LADDER.length - 1)]!,
      status: 'scheduled',
      completedAt: null,
      quality: null,
      taskId: null,
      durationMinutes: plan.defaultDurationMinutes,
    });
  }
}
