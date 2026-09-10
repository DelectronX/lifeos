import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { diffDays, todayKey } from '@/lib/date';
import { getSchedulingConfig } from './settingsService';
import { logActivity } from './activityService';
import {
  applyDailyCaps, computeXPAward, levelProgress, nextStreak,
  type LevelProgress, type XPEventInput,
} from '@/engines/xp';
import type { DateKey, ID, XPConfig, XPTransaction } from '@/types';

/**
 * XP write path — the single place an XPTransaction is created.
 *
 * Anti-farming is layered, and every layer is enforced HERE rather than in the
 * caller, so no feature can accidentally bypass it:
 *
 *  1. `dedupeKey` is unique in Dexie (`&dedupeKey`). One real-world event pays
 *     out exactly once, forever. Completing, reopening and re-completing a task
 *     earns nothing the second time.
 *  2. The engine rejects events that represent no real elapsed effort
 *     (`minTaskAgeSeconds`, `minQualifyingMinutes`) — the create-then-complete
 *     loop the spec calls out.
 *  3. Per-reason and global daily ceilings are applied against XP already
 *     banked today.
 *  4. Cancelling/deleting the source record REVOKES the award (see
 *     `revokeXPFor`), so a create/cancel loop cannot leave XP behind.
 */

export interface XPAwardOutcome {
  /** XP actually banked. 0 when rejected, capped out or already awarded. */
  amount: number;
  /** Plain-English reason when nothing (or less) was awarded. */
  note?: string;
  levelUp: boolean;
  level: number;
  totalXP: number;
  transactionId: ID | null;
}

const NO_AWARD = (level: number, totalXP: number, note?: string): XPAwardOutcome => ({
  amount: 0, note, levelUp: false, level, totalXP, transactionId: null,
});

/**
 * Awards XP for one real event. Safe to call more than once for the same
 * event — the second call is a no-op thanks to the unique dedupe key.
 */
export async function awardXP(
  input: XPEventInput,
  options: { activityId?: ID | null; at?: number } = {},
): Promise<XPAwardOutcome> {
  const at = options.at ?? Date.now();
  const date = todayKey(at);
  const config = (await getSchedulingConfig()).xp;
  const profile = await db.profile.get('profile');
  const totalXP = profile?.totalXP ?? 0;
  const before = levelProgress(totalXP, config);

  const award = computeXPAward({ ...input, streakDays: profile?.currentStreak ?? 0 }, config);
  if (award.amount <= 0) return NO_AWARD(before.level, totalXP, award.rejected);

  // Already paid for this exact event?
  const existing = await db.xp.where('dedupeKey').equals(award.dedupeKey).first();
  if (existing) return NO_AWARD(before.level, totalXP, 'Already awarded for this event.');

  const earned = await xpEarnedOn(date);
  const capped = applyDailyCaps(award.amount, award.reason, earned, config);
  if (capped.amount <= 0) return NO_AWARD(before.level, totalXP, capped.capReason);

  const balanceAfter = totalXP + capped.amount;
  const tx: XPTransaction = {
    id: newId('xp'),
    createdAt: at,
    updatedAt: at,
    at,
    date,
    amount: capped.amount,
    reason: award.reason,
    description: award.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    activityId: options.activityId ?? null,
    dedupeKey: award.dedupeKey,
    balanceAfter,
  };

  try {
    await db.xp.add(tx);
  } catch {
    // Lost a race on the unique index — the other writer already paid it.
    return NO_AWARD(before.level, totalXP, 'Already awarded for this event.');
  }

  const after = levelProgress(balanceAfter, config);
  if (profile) {
    const streak = nextStreak(
      profile.currentStreak, profile.longestStreak, profile.lastActiveDate, date, diffDays,
    );
    await db.profile.update('profile', {
      totalXP: balanceAfter,
      level: after.level,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastActiveDate: date,
      updatedAt: at,
    });
  }

  if (after.level > before.level) {
    await logActivity({
      type: 'level_up',
      at,
      title: `Reached level ${after.level}`,
      value: after.level,
      meta: { totalXP: balanceAfter, from: before.level },
    });
  }

  return {
    amount: capped.amount,
    note: capped.capped ? capped.capReason : undefined,
    levelUp: after.level > before.level,
    level: after.level,
    totalXP: balanceAfter,
    transactionId: tx.id,
  };
}

/**
 * Removes every award tied to a source record and refunds the profile balance.
 * Called when the underlying event is undone (task reopened then cancelled,
 * revision un-completed, paper deleted), which is what closes the
 * create/complete/cancel farming loop for good.
 */
export async function revokeXPFor(sourceType: string, sourceId: ID): Promise<number> {
  const rows = (await db.xp.where('sourceId').equals(sourceId).toArray())
    .filter((t) => t.sourceType === sourceType);
  if (rows.length === 0) return 0;

  const refund = rows.reduce((s, t) => s + t.amount, 0);
  await db.xp.bulkDelete(rows.map((t) => t.id));

  const profile = await db.profile.get('profile');
  if (profile) {
    const config = (await getSchedulingConfig()).xp;
    const total = Math.max(0, profile.totalXP - refund);
    await db.profile.update('profile', {
      totalXP: total,
      level: levelProgress(total, config).level,
      updatedAt: Date.now(),
    });
  }
  return refund;
}

/** XP banked today, split per reason — the input the daily caps need. */
export async function xpEarnedOn(date: DateKey): Promise<{
  earnedTodayByReason: Record<string, number>;
  earnedTodayTotal: number;
}> {
  const rows = await db.xp.where('date').equals(date).toArray();
  const byReason: Record<string, number> = {};
  let total = 0;
  for (const t of rows) {
    byReason[t.reason] = (byReason[t.reason] ?? 0) + t.amount;
    total += t.amount;
  }
  return { earnedTodayByReason: byReason, earnedTodayTotal: total };
}

export async function getXPTransactions(from: DateKey, to: DateKey): Promise<XPTransaction[]> {
  const rows = await db.xp.where('date').between(from, to, true, true).toArray();
  return rows.sort((a, b) => b.at - a.at);
}

export async function getRecentXP(limit = 25): Promise<XPTransaction[]> {
  return db.xp.orderBy('at').reverse().limit(limit).toArray();
}

export async function totalXPOn(date: DateKey): Promise<number> {
  return (await xpEarnedOn(date)).earnedTodayTotal;
}

/** Current level + progress, resolved against the live config. */
export async function getLevelProgress(): Promise<LevelProgress> {
  const config = (await getSchedulingConfig()).xp;
  const profile = await db.profile.get('profile');
  return levelProgress(profile?.totalXP ?? 0, config);
}

/** Presentation helper: XP grouped by reason over a window. */
export interface XPByReason {
  reason: string;
  label: string;
  amount: number;
  count: number;
  share: number;
}

export function groupXPByReason(rows: readonly XPTransaction[]): XPByReason[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const t of rows) {
    const row = map.get(t.reason) ?? { amount: 0, count: 0 };
    row.amount += t.amount;
    row.count++;
    map.set(t.reason, row);
  }
  const total = [...map.values()].reduce((s, r) => s + r.amount, 0);
  return [...map.entries()]
    .map(([reason, r]) => ({
      reason,
      label: reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      amount: r.amount,
      count: r.count,
      share: total > 0 ? r.amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** The configured award table, for the Settings/Achievements explainers. */
export async function getXPConfig(): Promise<XPConfig> {
  return (await getSchedulingConfig()).xp;
}
