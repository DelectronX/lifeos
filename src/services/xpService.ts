import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { diffDays, todayKey } from '@/lib/date';
import { getSchedulingConfig } from './settingsService';
import { logActivity } from './activityService';
import { createDefaultProfile } from '@/db/seed';
import {
  applyDailyCaps, computeXPAward, levelProgress, nextStreak,
  type LevelProgress, type XPEventInput,
} from '@/engines/xp';
import { mintForXP, revokeMintsFor } from './currencyService';
import type { DateKey, ID, Tracker, XPConfig, XPTransaction } from '@/types';

/** Reasons whose flat amount may be replaced by a per-tracker award. */
const TRACKER_AWARD_REASONS = new Set(['task_completed', 'block_completed', 'timer_session']);

/**
 * Data-driven tracker resolution: walks up from `trackerId` and returns the
 * nearest configured award, and whether any ancestor is a no-XP tracker
 * (breaks, free time, entertainment, or any root 'system' tracker that is not
 * explicitly given an award).
 */
export async function resolveTrackerXP(
  trackerId: ID | null | undefined,
  config: XPConfig,
): Promise<{ award: number | undefined; noXP: boolean }> {
  if (!trackerId) return { award: undefined, noXP: false };
  const noXP = new Set(config.noXPTrackers ?? []);
  const awards = config.trackerAwards ?? {};
  let cursor: ID | null = trackerId;
  let award: number | undefined;
  let blocked = false;
  let guard = 0;
  while (cursor && guard++ < 32) {
    if (award === undefined && typeof awards[cursor] === 'number') award = awards[cursor];
    if (noXP.has(cursor)) blocked = true;
    const tracker: Tracker | undefined = await db.trackers.get(cursor);
    if (!tracker) break;
    if (!tracker.parentId && tracker.pillar === 'system' && award === undefined) blocked = true;
    cursor = tracker.parentId;
  }
  return { award, noXP: blocked };
}

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

  let effective = input;
  if (TRACKER_AWARD_REASONS.has(input.reason) && input.trackerId) {
    const resolved = await resolveTrackerXP(input.trackerId, config);
    if (resolved.noXP) {
      return NO_AWARD(before.level, totalXP, 'Breaks and free time do not earn productivity XP.');
    }
    if (resolved.award !== undefined) {
      // A configured per-tracker award is the WHOLE payout for that unit of
      // work; duration XP is not added on top (it would double-count).
      effective = {
        ...input,
        flatOverride: resolved.award,
        minutes: 0,
        dedupeKey: `tracker_award:${input.workUnitKey ?? `${input.sourceType}:${input.sourceId ?? 'none'}`}`,
      };
    }
  }

  const award = computeXPAward({ ...effective, streakDays: profile?.currentStreak ?? 0 }, config);
  if (award.amount <= 0) return NO_AWARD(before.level, totalXP, award.rejected);

  const earned = await xpEarnedOn(date);
  const capped = applyDailyCaps(award.amount, award.reason, earned, config);
  if (capped.amount <= 0) return NO_AWARD(before.level, totalXP, capped.capReason);

  // Ledger row + cached profile move together in one transaction, and the
  // balance is re-read INSIDE it — so concurrent awards can never lose XP
  // (read-modify-write race) and a duplicate dedupeKey is a clean no-op.
  const written = await db.transaction('rw', db.xp, db.profile, async () => {
    if (await db.xp.where('dedupeKey').equals(award.dedupeKey).first()) return null;
    const fresh = await db.profile.get('profile');
    const base = fresh?.totalXP ?? 0;
    const balanceAfter = base + capped.amount;
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
    await db.xp.add(tx);
    const streak = nextStreak(
      fresh?.currentStreak ?? 0, fresh?.longestStreak ?? 0, fresh?.lastActiveDate ?? null, date, diffDays,
    );
    // Upsert, so a missing/never-seeded profile row can never leave totalXP
    // undefined while real XPTransactions exist.
    await db.profile.put({
      ...(fresh ?? createDefaultProfile(at)),
      totalXP: balanceAfter,
      level: levelProgress(balanceAfter, config).level,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastActiveDate: date,
      updatedAt: at,
    });
    return { tx, streak, before: levelProgress(base, config) };
  }).catch((e: unknown) => {
    if (e instanceof Error && e.name === 'ConstraintError') return null; // lost the race; already paid
    throw e;
  });
  if (!written) return NO_AWARD(before.level, totalXP, 'Already awarded for this event.');
  const { tx, streak } = written;
  const balanceAfter = tx.balanceAfter;

  await mintForXP(tx, config.rewardCurrencyPerXP ?? 0);

  const after = levelProgress(balanceAfter, config);
  const levelledFrom = written.before.level;

  await awardStreakMilestones(streak.currentStreak, at, config);

  if (after.level > levelledFrom) {
    await logActivity({
      type: 'level_up',
      at,
      title: `Reached level ${after.level}`,
      value: after.level,
      meta: { totalXP: balanceAfter, from: levelledFrom },
    });
  }

  return {
    amount: capped.amount,
    note: capped.capped ? capped.capReason : undefined,
    levelUp: after.level > levelledFrom,
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
  await revokeMintsFor(rows.map((t) => t.id));

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

/**
 * Banks a one-off bonus straight to the ledger (bypassing the flat-award
 * table and daily caps), deduped by `dedupeKey`. Used for streak milestones
 * and full-day / full-week bonuses — each is paid at most once per key.
 */
export async function bankBonus(
  dedupeKey: string,
  amount: number,
  reason: string,
  description: string,
  at = Date.now(),
): Promise<number> {
  if (!(amount > 0)) return 0;
  const config = (await getSchedulingConfig()).xp;
  const tx = await db.transaction('rw', db.xp, db.profile, async () => {
    if (await db.xp.where('dedupeKey').equals(dedupeKey).first()) return null;
    const profile = await db.profile.get('profile');
    const balanceAfter = (profile?.totalXP ?? 0) + amount;
    const row: XPTransaction = {
      id: newId('xp'), createdAt: at, updatedAt: at, at, date: todayKey(at),
      amount, reason, description, sourceType: 'bonus', sourceId: dedupeKey,
      activityId: null, dedupeKey, balanceAfter,
    };
    await db.xp.add(row);
    await db.profile.put({
      ...(profile ?? createDefaultProfile(at)),
      totalXP: balanceAfter,
      level: levelProgress(balanceAfter, config).level,
      updatedAt: at,
    });
    return row;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.name === 'ConstraintError') return null;
    throw e;
  });
  if (!tx) return 0;
  await mintForXP(tx, config.rewardCurrencyPerXP ?? 0);
  return amount;
}

/**
 * Streak milestone bonuses (data: `xp.streakMilestones`, e.g. {7:150}).
 * Keyed by the streak's START date so each threshold pays once per streak:
 * a broken-and-rebuilt streak may earn it again, the same streak never.
 */
async function awardStreakMilestones(currentStreak: number, at: number, config: XPConfig): Promise<void> {
  const table = config.streakMilestones ?? {};
  const startKey = todayKey(at - (currentStreak - 1) * 86_400_000);
  for (const [days, amount] of Object.entries(table)) {
    const threshold = Number(days);
    if (!(threshold > 0) || currentStreak < threshold) continue;
    await bankBonus(
      `streak_milestone:${threshold}:${startKey}`,
      Number(amount),
      'streak_bonus',
      `${threshold}-day streak`,
      at,
    );
  }
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
