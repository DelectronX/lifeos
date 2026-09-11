import { diffDays } from '@/lib/date';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { applyDailyCaps, computeXPAward, levelProgress, nextStreak, type XPEventInput } from '@/engines/xp';
import type { Activity, UserProfile, XPTransaction } from '@/types';
import type { DemoContext } from './world';

/**
 * XP + profile, replayed rather than invented.
 *
 * Every seeded Activity is fed through the SAME engine functions the live
 * write path uses (`computeXPAward` → `applyDailyCaps`), in chronological
 * order, with the running streak and the per-day ledger carried forward. The
 * result is that the profile's totalXP is exactly the sum of the transactions,
 * the level follows from the level curve, the daily caps genuinely bite on the
 * heavy days, and the streak matches the activity dates.
 *
 * Anything the engine rejects (too short, no qualifying effort, capped out)
 * simply produces no transaction — just as it would in the app.
 */

interface AwardSpec {
  reason: string;
  sourceType: string;
  sourceId: string | null;
  minutes?: number;
  intensity?: XPEventInput['intensity'];
  basePriority?: number;
  description: string;
}

function specFor(ctx: DemoContext, activity: Activity): AwardSpec | null {
  const minutes = activity.durationMs / 60_000;
  switch (activity.type) {
    case 'task_completed': {
      const task = ctx.world.tasks.find((t) => t.id === activity.taskId);
      return {
        reason: 'task_completed',
        sourceType: 'task',
        sourceId: activity.taskId,
        minutes,
        intensity: task?.intensity,
        basePriority: task?.basePriority,
        description: activity.title,
      };
    }
    case 'block_completed':
      return {
        reason: 'block_completed', sourceType: 'block', sourceId: activity.blockId,
        minutes, description: activity.title,
      };
    case 'timer_session':
      return {
        reason: 'timer_session', sourceType: 'session', sourceId: activity.sessionId,
        minutes, description: activity.title,
      };
    case 'paper_submitted':
      return {
        reason: 'paper_submitted', sourceType: 'paper', sourceId: activity.paperId,
        minutes, description: activity.title,
      };
    case 'revision_completed':
      return {
        reason: 'revision_completed', sourceType: 'revision_entry', sourceId: activity.revisionEntryId,
        minutes, description: `Revision: ${activity.title}`,
      };
    case 'habit_checkin':
      return {
        reason: 'habit_checkin', sourceType: 'habit_day',
        sourceId: `${activity.habitId}:${activity.date}`,
        minutes, description: `Habit: ${activity.title}`,
      };
    case 'milestone_completed':
      return {
        reason: 'milestone_completed', sourceType: 'milestone', sourceId: activity.goalId,
        description: activity.title,
      };
    case 'goal_completed':
      return {
        reason: 'goal_completed', sourceType: 'goal', sourceId: activity.goalId,
        description: activity.title,
      };
    case 'daily_review':
      return {
        reason: 'daily_review', sourceType: 'day', sourceId: activity.date,
        description: 'Daily review',
      };
    case 'weekly_review':
      return {
        reason: 'weekly_review', sourceType: 'week', sourceId: activity.date,
        description: 'Weekly review',
      };
    default:
      return null;
  }
}

export function seedXP(ctx: DemoContext): void {
  const config = mergeSchedulingConfig({}).xp;
  const ordered = [...ctx.world.activities].sort((a, b) => a.at - b.at);

  const seenDedupe = new Set<string>();
  const perDay = new Map<string, { byReason: Record<string, number>; total: number }>();
  const transactions: XPTransaction[] = [];

  let totalXP = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let lastActiveDate: string | null = null;
  let firstActivityAt = ctx.now;

  for (const activity of ordered) {
    firstActivityAt = Math.min(firstActivityAt, activity.at);
    const spec = specFor(ctx, activity);
    if (!spec) continue;

    const award = computeXPAward(
      {
        ...spec,
        streakDays: currentStreak,
        // Seeded records are always days old by construction; the anti-farming
        // age gate is satisfied honestly rather than bypassed.
        recordAgeSeconds: 86_400,
      },
      config,
    );
    if (award.amount <= 0) continue;
    if (seenDedupe.has(award.dedupeKey)) continue;

    const ledger = perDay.get(activity.date) ?? { byReason: {}, total: 0 };
    const capped = applyDailyCaps(
      award.amount,
      award.reason,
      { earnedTodayByReason: ledger.byReason, earnedTodayTotal: ledger.total },
      config,
    );
    if (capped.amount <= 0) continue;

    seenDedupe.add(award.dedupeKey);
    ledger.byReason[award.reason] = (ledger.byReason[award.reason] ?? 0) + capped.amount;
    ledger.total += capped.amount;
    perDay.set(activity.date, ledger);

    totalXP += capped.amount;
    transactions.push({
      id: ctx.id('xp'),
      createdAt: activity.at,
      updatedAt: activity.at,
      at: activity.at,
      date: activity.date,
      amount: capped.amount,
      reason: award.reason,
      description: award.description,
      sourceType: spec.sourceType,
      sourceId: spec.sourceId,
      activityId: activity.id,
      dedupeKey: award.dedupeKey,
      balanceAfter: totalXP,
    });

    // Streak advances on the first qualifying event of each calendar day.
    const step = nextStreak(currentStreak, longestStreak, lastActiveDate, activity.date, diffDays);
    if (step.changed) {
      currentStreak = step.currentStreak;
      longestStreak = step.longestStreak;
      lastActiveDate = activity.date;
    }
  }

  const level = levelProgress(totalXP, config).level;

  const profile: UserProfile = {
    id: 'profile',
    createdAt: firstActivityAt,
    updatedAt: ctx.now,
    displayName: 'Sam',
    totalXP,
    level,
    currentStreak,
    longestStreak,
    lastActiveDate,
    onboardedAt: firstActivityAt,
  };

  ctx.world.xp.push(...transactions);
  ctx.world.profile = profile;

  // Level-up events are real history too — one per level actually crossed.
  let seenLevel = 1;
  for (const tx of transactions) {
    const reached = levelProgress(tx.balanceAfter, config).level;
    while (seenLevel < reached) {
      seenLevel += 1;
      ctx.world.activities.push({
        id: ctx.id('act'),
        createdAt: tx.at,
        updatedAt: tx.at,
        type: 'level_up',
        at: tx.at,
        date: tx.date,
        trackerId: null,
        taskId: null,
        goalId: null,
        blockId: null,
        sessionId: null,
        paperId: null,
        revisionEntryId: null,
        habitId: null,
        resourceId: null,
        durationMs: 0,
        value: seenLevel,
        unit: null,
        title: `Reached level ${seenLevel}`,
        meta: { totalXP: tx.balanceAfter, from: seenLevel - 1 },
      });
    }
  }
  ctx.world.activities.sort((a, b) => a.at - b.at);
}
