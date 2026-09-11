import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey } from '@/lib/date';
import { levelProgress } from '@/engines/xp';
import { getSchedulingConfig } from './settingsService';
import {
  METRIC_LABELS, METRIC_UNITS, measureMetrics,
} from './achievementService';
import {
  cloneCondition, evaluateCondition, isValidCondition, periodKeyFor,
  type Condition, type ConditionEvaluation, type MetricSource, type RepeatMode,
} from '@/engines/conditionEngine';
import { defaultCondition } from '@/config/rewards';
import type { CustomReward, ID, RewardEarning } from '@/types';

/**
 * RewardService — persistence and evaluation for user-defined rewards.
 *
 * All the thinking lives in the pure ConditionEngine; this module only does
 * the three things a service should: read/write Dexie, decide when an earning
 * row may be inserted, and bank XP through the same dedupe discipline the
 * achievement rewards use. It is called at the same trigger points as
 * `evaluateAchievements`, so the two can never disagree about the numbers —
 * both read from the same MetricSource.
 */

const EVAL_OPTIONS = { labels: METRIC_LABELS, units: METRIC_UNITS } as const;

/* ------------------------------------------------------------------ */
/* Reading + validation                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns the reward's stored condition, or a safe empty AND group when the
 * stored value has been corrupted. An empty group evaluates to false, so a
 * damaged reward silently stops paying rather than paying wrongly.
 */
export function conditionOf(reward: CustomReward): Condition {
  if (isValidCondition(reward.condition)) return reward.condition;
  return { id: `${reward.id}:root`, type: 'and', children: [] };
}

export function repeatOf(reward: CustomReward): RepeatMode {
  const mode = reward.repeat;
  return mode === 'daily' || mode === 'weekly' || mode === 'monthly' ? mode : 'once';
}

export async function listRewards(includeArchived = false): Promise<CustomReward[]> {
  const rows = await db.rewards.toArray();
  return rows
    .filter((r) => includeArchived || !r.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export async function getReward(id: ID): Promise<CustomReward | undefined> {
  return db.rewards.get(id);
}

export async function listEarnings(rewardId?: ID): Promise<RewardEarning[]> {
  const rows = rewardId
    ? await db.rewardEarnings.where('rewardId').equals(rewardId).toArray()
    : await db.rewardEarnings.toArray();
  return rows.sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export interface RewardInput {
  name: string;
  description?: string;
  xpValue?: number;
  treat?: string;
  condition: Condition;
  repeat: RepeatMode;
}

export async function createReward(input: RewardInput): Promise<CustomReward> {
  const now = Date.now();
  const count = await db.rewards.count();
  const reward: CustomReward = {
    id: newId('rwd'),
    createdAt: now,
    updatedAt: now,
    name: input.name.trim() || 'Untitled reward',
    description: (input.description ?? '').trim(),
    xpValue: Math.max(0, Math.round(input.xpValue ?? 0)),
    treat: (input.treat ?? '').trim(),
    condition: input.condition,
    repeat: input.repeat,
    archived: false,
    sortOrder: count,
  };
  await db.rewards.add(reward);
  return reward;
}

export async function updateReward(id: ID, patch: Partial<RewardInput>): Promise<void> {
  const next: Partial<CustomReward> = { updatedAt: Date.now() };
  if (patch.name !== undefined) next.name = patch.name.trim() || 'Untitled reward';
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.treat !== undefined) next.treat = patch.treat.trim();
  if (patch.xpValue !== undefined) next.xpValue = Math.max(0, Math.round(patch.xpValue));
  if (patch.condition !== undefined) next.condition = patch.condition;
  if (patch.repeat !== undefined) next.repeat = patch.repeat;
  await db.rewards.update(id, next);
}

/** Copies a reward, including a deep clone of its condition with fresh ids. */
export async function duplicateReward(id: ID): Promise<CustomReward | null> {
  const source = await db.rewards.get(id);
  if (!source) return null;
  return createReward({
    name: `${source.name} (copy)`,
    description: source.description,
    xpValue: source.xpValue,
    treat: source.treat,
    condition: cloneCondition(conditionOf(source), () => newId('cnd')),
    repeat: repeatOf(source),
  });
}

/** Deletes the reward and its earning history — the user asked for it gone. */
export async function deleteReward(id: ID): Promise<void> {
  await db.transaction('rw', db.rewards, db.rewardEarnings, async () => {
    await db.rewardEarnings.where('rewardId').equals(id).delete();
    await db.rewards.delete(id);
  });
}

export async function setRewardArchived(id: ID, archived: boolean): Promise<void> {
  await db.rewards.update(id, { archived, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export interface RewardView {
  reward: CustomReward;
  condition: Condition;
  repeat: RepeatMode;
  evaluation: ConditionEvaluation;
  /** Earnings for this reward, newest first. */
  earnings: RewardEarning[];
  /** True when the condition holds AND this period has not been earned. */
  earnableNow: boolean;
  /** Period bucket this evaluation belongs to. */
  periodKey: string;
  /** Set when this period's earning already exists. */
  earnedThisPeriod: RewardEarning | null;
  /** Unclaimed earnings, oldest first — what the user still owes themselves. */
  pendingClaims: RewardEarning[];
}

/** Evaluates rewards against an already-measured metric source (pure-ish). */
export function buildRewardViews(
  rewards: readonly CustomReward[],
  earnings: readonly RewardEarning[],
  metrics: MetricSource,
  now: Date,
): RewardView[] {
  const byReward = new Map<ID, RewardEarning[]>();
  for (const e of earnings) {
    const list = byReward.get(e.rewardId) ?? [];
    list.push(e);
    byReward.set(e.rewardId, list);
  }

  return rewards.map((reward) => {
    const condition = conditionOf(reward);
    const repeat = repeatOf(reward);
    const evaluation = evaluateCondition(condition, metrics, now, EVAL_OPTIONS);
    const mine = (byReward.get(reward.id) ?? []).slice().sort((a, b) => b.at - a.at);
    const periodKey = periodKeyFor(repeat, now, metrics.weekStartsOn ?? 1);
    const earnedThisPeriod = mine.find((e) => e.periodKey === periodKey) ?? null;

    return {
      reward,
      condition,
      repeat,
      evaluation,
      earnings: mine,
      periodKey,
      earnedThisPeriod,
      earnableNow: evaluation.met && earnedThisPeriod === null && !reward.archived,
      pendingClaims: mine.filter((e) => e.claimedAt === null).sort((a, b) => a.at - b.at),
    };
  });
}

export interface RewardEvaluationResult {
  views: RewardView[];
  /** Earnings inserted by this run. */
  newlyEarned: RewardView[];
  metrics: MetricSource;
}

/**
 * Recomputes every reward from stored records and records any that became
 * earned. Safe to call as often as achievements are evaluated: the unique
 * [rewardId+periodKey] index means a concurrent second call cannot double-pay.
 */
export async function evaluateRewards(now: Date = new Date()): Promise<RewardEvaluationResult> {
  const metrics = await measureMetrics();
  return evaluateRewardsWith(metrics, now);
}

/** Same as `evaluateRewards` but reuses metrics already measured by the caller. */
export async function evaluateRewardsWith(
  metrics: MetricSource,
  now: Date = new Date(),
): Promise<RewardEvaluationResult> {
  const [rewards, earnings] = await Promise.all([
    db.rewards.toArray(),
    db.rewardEarnings.toArray(),
  ]);

  const views = buildRewardViews(
    rewards.filter((r) => !r.archived).sort((a, b) => a.sortOrder - b.sortOrder),
    earnings,
    metrics,
    now,
  );

  const newlyEarned: RewardView[] = [];
  for (const view of views) {
    if (!view.earnableNow) continue;
    const earning = await recordEarning(view, now);
    if (earning) {
      newlyEarned.push({
        ...view,
        earnings: [earning, ...view.earnings],
        earnedThisPeriod: earning,
        earnableNow: false,
        pendingClaims: [...view.pendingClaims, earning],
      });
    }
  }

  return { views, newlyEarned, metrics };
}

/**
 * Inserts the earning row and banks its XP. Returns null when the row already
 * existed — the unique index is the real guard, so a lost race is a no-op
 * rather than an error the user has to see.
 */
async function recordEarning(view: RewardView, now: Date): Promise<RewardEarning | null> {
  const at = now.getTime();
  const earning: RewardEarning = {
    id: newId('rwe'),
    createdAt: at,
    updatedAt: at,
    rewardId: view.reward.id,
    at,
    date: toDateKey(at),
    periodKey: view.periodKey,
    xpAwarded: view.reward.xpValue,
    claimedAt: null,
    summary: view.evaluation.summary,
  };

  try {
    await db.rewardEarnings.add(earning);
  } catch {
    return null;
  }

  if (view.reward.xpValue > 0) {
    await bankRewardXP(view.reward, view.periodKey, at);
  }
  return earning;
}

/** Marks the treat as taken. */
export async function claimEarning(earningId: ID): Promise<void> {
  const now = Date.now();
  await db.rewardEarnings.update(earningId, { claimedAt: now, updatedAt: now });
}

export async function unclaimEarning(earningId: ID): Promise<void> {
  await db.rewardEarnings.update(earningId, { claimedAt: null, updatedAt: Date.now() });
}

/**
 * Reward XP is banked as its own transaction, deduped by reward id + period so
 * re-evaluation can never pay twice for the same period.
 */
async function bankRewardXP(reward: CustomReward, periodKey: string, at: number): Promise<void> {
  const dedupeKey = `custom_reward:reward:${reward.id}:${periodKey}`;
  if (await db.xp.where('dedupeKey').equals(dedupeKey).first()) return;

  const profile = await db.profile.get('profile');
  const config = (await getSchedulingConfig()).xp;
  const balanceAfter = (profile?.totalXP ?? 0) + reward.xpValue;

  await db.xp.add({
    id: newId('xp'),
    createdAt: at,
    updatedAt: at,
    at,
    date: toDateKey(at),
    amount: reward.xpValue,
    reason: 'custom_reward',
    description: `Reward: ${reward.name}`,
    sourceType: 'reward',
    sourceId: reward.id,
    activityId: null,
    dedupeKey,
    balanceAfter,
  });

  if (profile) {
    await db.profile.update('profile', {
      totalXP: balanceAfter,
      level: levelProgress(balanceAfter, config).level,
      updatedAt: at,
    });
  }
}

/** A blank condition for a new reward, with ids the builder can address. */
export function newCondition(): Condition {
  return defaultCondition(() => newId('cnd'));
}
