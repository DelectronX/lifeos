import type { Intensity, XPConfig } from '@/types';

/**
 * XPEngine — deterministic, rule-based experience/level maths.
 *
 * Anti-farming design (the spec's requirement that create/cancel loops earn
 * nothing) is enforced on three independent axes:
 *   1. `dedupeKey`  — one award per real-world event, enforced by a unique DB
 *                     index. Re-completing the same task cannot pay twice.
 *   2. `minTaskAgeSeconds` / `minQualifyingMinutes` — an event must represent
 *      real elapsed effort, not an instant create-then-complete.
 *   3. per-reason daily caps + a global daily cap, applied against XP already
 *      earned today.
 *
 * Pure: no DB, no Date.now() unless passed in.
 */

export interface LevelProgress {
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP required to clear the current level. */
  span: number;
  /** 0..1 within the current level. */
  progress: number;
  totalXP: number;
  /** Cumulative XP at which the next level begins. */
  nextLevelAt: number;
}

/** XP required to advance FROM `level` TO `level + 1`. */
export function xpForLevel(level: number, config: XPConfig): number {
  const { base, exponent } = config.levelCurve;
  return Math.round(base * Math.pow(Math.max(1, level), exponent));
}

/** Cumulative XP required to reach `level` (level 1 = 0 XP). */
export function cumulativeXPForLevel(level: number, config: XPConfig): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(l, config);
  return total;
}

export function levelProgress(totalXP: number, config: XPConfig): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXP));
  let level = 1;
  let consumed = 0;
  // Level curve grows superlinearly, so this terminates quickly even for huge XP.
  for (let guard = 0; guard < 10_000; guard++) {
    const need = xpForLevel(level, config);
    if (consumed + need > xp) break;
    consumed += need;
    level++;
  }
  const span = xpForLevel(level, config);
  const into = xp - consumed;
  return {
    level,
    into,
    span,
    progress: span > 0 ? Math.min(1, into / span) : 0,
    totalXP: xp,
    nextLevelAt: consumed + span,
  };
}

export interface XPEventInput {
  /** Config key, e.g. `task_completed`. */
  reason: string;
  /** Stable identity of the underlying real event. */
  sourceType: string;
  sourceId: string | null;
  /** Real tracked minutes this event represents (drives duration XP). */
  minutes?: number;
  intensity?: Intensity;
  basePriority?: number;
  /** Consecutive-day streak at the time of the event. */
  streakDays?: number;
  /** Seconds between record creation and the event; guards instant-complete farming. */
  recordAgeSeconds?: number;
  description?: string;
}

export interface XPAward {
  amount: number;
  reason: string;
  description: string;
  dedupeKey: string;
  /** Transparent breakdown for the UI / tests. */
  breakdown: { label: string; value: number }[];
  /** Set when the award was zeroed; explains why. */
  rejected?: string;
}

export function computeXPAward(input: XPEventInput, config: XPConfig): XPAward {
  const dedupeKey = `${input.reason}:${input.sourceType}:${input.sourceId ?? 'none'}`;
  const description = input.description ?? input.reason.replace(/_/g, ' ');
  const breakdown: { label: string; value: number }[] = [];

  const flat = config.awards[input.reason] ?? 0;

  // --- anti-farming gate 2: the event must represent real elapsed effort ----
  const needsAge = input.reason === 'task_completed' || input.reason === 'block_completed';
  if (needsAge && input.recordAgeSeconds !== undefined && input.recordAgeSeconds < config.minTaskAgeSeconds) {
    return {
      amount: 0, reason: input.reason, description, dedupeKey, breakdown,
      rejected: `Created less than ${config.minTaskAgeSeconds}s ago — no XP for instant completion loops.`,
    };
  }

  const minutes = Math.max(0, input.minutes ?? 0);
  const durationXP =
    minutes >= config.minQualifyingMinutes ? minutes * config.perFocusMinute : 0;

  if (flat > 0) breakdown.push({ label: 'Base', value: flat });
  if (durationXP > 0) breakdown.push({ label: `${Math.round(minutes)} min tracked`, value: round1(durationXP) });

  let subtotal = flat + durationXP;
  if (subtotal <= 0) {
    return { amount: 0, reason: input.reason, description, dedupeKey, breakdown, rejected: 'No qualifying effort recorded.' };
  }

  const intensityMult = input.intensity ? (config.intensityMultiplier[input.intensity] ?? 1) : 1;
  if (intensityMult !== 1) {
    const delta = subtotal * (intensityMult - 1);
    breakdown.push({ label: `Intensity ${input.intensity}`, value: round1(delta) });
    subtotal += delta;
  }

  const priorityMult = input.basePriority ? (config.priorityMultiplier[input.basePriority] ?? 1) : 1;
  if (priorityMult !== 1) {
    const delta = subtotal * (priorityMult - 1);
    breakdown.push({ label: `Priority ${input.basePriority}`, value: round1(delta) });
    subtotal += delta;
  }

  const streakBonusPct = Math.min(
    config.streakBonusCap,
    Math.max(0, (input.streakDays ?? 0) * config.streakBonusPerDay),
  );
  if (streakBonusPct > 0) {
    const delta = subtotal * streakBonusPct;
    breakdown.push({ label: `${input.streakDays}-day streak +${Math.round(streakBonusPct * 100)}%`, value: round1(delta) });
    subtotal += delta;
  }

  return { amount: Math.max(0, Math.round(subtotal)), reason: input.reason, description, dedupeKey, breakdown };
}

export interface CapContext {
  /** XP already awarded today, keyed by reason. */
  earnedTodayByReason: Record<string, number>;
  earnedTodayTotal: number;
}

export interface CappedAward {
  amount: number;
  capped: boolean;
  capReason?: string;
}

/** Applies per-reason and global daily ceilings — anti-farming gate 3. */
export function applyDailyCaps(amount: number, reason: string, ctx: CapContext, config: XPConfig): CappedAward {
  if (amount <= 0) return { amount: 0, capped: false };

  let allowed = amount;
  let capReason: string | undefined;

  const reasonCap = config.dailyCaps[reason];
  if (typeof reasonCap === 'number') {
    const used = ctx.earnedTodayByReason[reason] ?? 0;
    const remaining = Math.max(0, reasonCap - used);
    if (allowed > remaining) {
      allowed = remaining;
      capReason = `Daily cap for ${reason.replace(/_/g, ' ')} reached (${reasonCap} XP).`;
    }
  }

  const totalRemaining = Math.max(0, config.dailyTotalCap - ctx.earnedTodayTotal);
  if (allowed > totalRemaining) {
    allowed = totalRemaining;
    capReason = `Daily XP ceiling reached (${config.dailyTotalCap} XP).`;
  }

  return { amount: Math.round(allowed), capped: allowed < amount, capReason };
}

/**
 * Streak update rule: a streak advances on consecutive calendar days with at
 * least one qualifying activity, is preserved on same-day repeats, and resets
 * on any gap.
 */
export function nextStreak(
  current: number,
  longest: number,
  lastActiveDate: string | null,
  today: string,
  daysBetween: (a: string, b: string) => number,
): { currentStreak: number; longestStreak: number; changed: boolean } {
  if (lastActiveDate === today) return { currentStreak: current, longestStreak: longest, changed: false };
  const gap = lastActiveDate ? daysBetween(lastActiveDate, today) : Infinity;
  const currentStreak = gap === 1 ? current + 1 : 1;
  return {
    currentStreak,
    longestStreak: Math.max(longest, currentStreak),
    changed: true,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
