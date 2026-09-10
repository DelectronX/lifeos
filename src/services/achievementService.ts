import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { toDateKey, diffDays } from '@/lib/date';
import { levelProgress } from '@/engines/xp';
import { getSchedulingConfig } from './settingsService';
import { logActivity } from './activityService';
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementDefinition,
  type AchievementStats,
} from '@/config/achievements';
import type {
  Achievement, AchievementCategory, Activity, Paper, Pillar, QuestionAttempt,
  ScheduleBlock, Task, TimerSession, Tracker, UserProfile,
} from '@/types';

/**
 * AchievementEngine + its persistence.
 *
 * Every achievement is a threshold on ONE measurable stat derived from stored
 * records — there are no participation trophies and nothing is awarded for
 * merely creating something. `computeStats` is the whole vocabulary: if a
 * number cannot be counted from the Activity log, TimerSessions, Tasks, Papers
 * or the profile, no achievement can depend on it.
 */

export interface AchievementSourceData {
  activities: readonly Activity[];
  tasks: readonly Task[];
  sessions: readonly TimerSession[];
  papers: readonly Paper[];
  attempts: readonly QuestionAttempt[];
  blocks: readonly ScheduleBlock[];
  profile: UserProfile | undefined;
  level: number;
  /** trackerId -> root pillar. Resolved by the caller so nesting is honoured. */
  pillarByTracker: Readonly<Record<string, Pillar>>;
}

/** Walks every tracker up to its root and records the owning pillar. */
export function buildPillarLookup(trackers: readonly Tracker[]): Record<string, Pillar> {
  const byId = new Map(trackers.map((t) => [t.id, t]));
  const out: Record<string, Pillar> = {};
  for (const t of trackers) {
    let cur = t;
    let guard = 0;
    while (cur.parentId && guard++ < 32) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      cur = parent;
    }
    out[t.id] = cur.pillar;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stat computation (pure)                                             */
/* ------------------------------------------------------------------ */

export function computeStats(data: AchievementSourceData): AchievementStats {
  const { activities, tasks, sessions, papers, attempts, blocks, profile } = data;
  const pillarOf = (trackerId: string): Pillar | null => data.pillarByTracker[trackerId] ?? null;

  let studyMinutes = 0;
  let fitnessMinutes = 0;
  let skillsMinutes = 0;
  let personalMinutes = 0;
  let focusMinutes = 0;

  for (const s of sessions) {
    const minutes = s.workMs / 60_000;
    focusMinutes += minutes;
    switch (pillarOf(s.trackerId)) {
      case 'study': studyMinutes += minutes; break;
      case 'fitness': fitnessMinutes += minutes; break;
      case 'skills': skillsMinutes += minutes; break;
      case 'personal': personalMinutes += minutes; break;
      default: break;
    }
  }

  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const tasksOnTime = completedTasks.filter(
    (t) => t.dueDate !== null && t.completedAt !== null && diffDays(toDateKey(t.completedAt), t.dueDate) >= 0,
  ).length;

  const longestSessionMinutes = sessions.length
    ? Math.max(...sessions.map((s) => s.workMs / 60_000))
    : 0;
  const pomodorosCompleted = sessions.reduce((s, x) => s + x.pomodoroCount, 0);

  const submittedPapers = papers.filter((p) => p.status === 'submitted' || p.status === 'reviewed');
  const answered = attempts.filter((a) => a.status === 'correct' || a.status === 'incorrect');

  // Best single-paper accuracy, as a percentage.
  let bestPaperAccuracy = 0;
  for (const p of submittedPapers) {
    const list = attempts.filter((a) => a.paperId === p.id && (a.status === 'correct' || a.status === 'incorrect'));
    if (list.length === 0) continue;
    const acc = (list.filter((a) => a.status === 'correct').length / list.length) * 100;
    if (acc > bestPaperAccuracy) bestPaperAccuracy = acc;
  }

  const revisionActivities = activities.filter((a) => a.type === 'revision_completed');
  const revisionsOnTime = revisionActivities.filter((a) => a.meta?.onTime === true).length;

  // --- consistency ------------------------------------------------------
  const activeDates = new Set(activities.map((a) => a.date));
  const perDayTrackers = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!a.trackerId || a.durationMs <= 0) continue;
    const pillar = pillarOf(a.trackerId);
    if (!pillar || pillar === 'system') continue;
    const set = perDayTrackers.get(a.date) ?? new Set<string>();
    set.add(pillar);
    perDayTrackers.set(a.date, set);
  }
  const bestPillarSpread = perDayTrackers.size
    ? Math.max(...[...perDayTrackers.values()].map((s) => s.size))
    : 0;

  // A perfect day: at least one non-protected planned block, and all of them
  // finished. Days with nothing scheduled do not count — that would be free.
  const blocksByDay = new Map<string, ScheduleBlock[]>();
  for (const b of blocks) {
    if (b.protected || b.kind === 'sleep' || b.kind === 'meal') continue;
    const list = blocksByDay.get(b.date) ?? [];
    list.push(b);
    blocksByDay.set(b.date, list);
  }
  let perfectDays = 0;
  for (const [, list] of blocksByDay) {
    if (list.length > 0 && list.every((b) => b.status === 'completed')) perfectDays++;
  }

  return {
    tasksCompleted: completedTasks.length,
    tasksOnTime,
    focusMinutes: Math.round(focusMinutes),
    studyMinutes: Math.round(studyMinutes),
    fitnessMinutes: Math.round(fitnessMinutes),
    skillsMinutes: Math.round(skillsMinutes),
    personalMinutes: Math.round(personalMinutes),
    pomodorosCompleted,
    longestSessionMinutes: Math.round(longestSessionMinutes),
    papersSubmitted: submittedPapers.length,
    questionsAttempted: answered.length,
    bestPaperAccuracy: Math.round(bestPaperAccuracy),
    revisionsCompleted: revisionActivities.length,
    revisionsOnTime,
    goalsCompleted: activities.filter((a) => a.type === 'goal_completed').length,
    milestonesCompleted: activities.filter((a) => a.type === 'milestone_completed').length,
    habitCheckins: activities.filter((a) => a.type === 'habit_checkin').length,
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    activeDays: activeDates.size,
    perfectDays,
    dailyReviews: activities.filter((a) => a.type === 'daily_review').length,
    weeklyReviews: activities.filter((a) => a.type === 'weekly_review').length,
    bestPillarSpread,
    level: data.level,
  };
}

/* ------------------------------------------------------------------ */
/* Progress + unlocking                                                */
/* ------------------------------------------------------------------ */

export interface AchievementView {
  definition: AchievementDefinition;
  record: Achievement;
  /** Raw measured value for the achievement's stat. */
  current: number;
  target: number;
  /** 0..1 */
  progress: number;
  unlocked: boolean;
  unlockedAt: number | null;
  /** e.g. "3 000 of 12 000 minutes" — always the real numbers. */
  progressLabel: string;
}

export function buildViews(
  stats: AchievementStats,
  records: readonly Achievement[],
): AchievementView[] {
  const byKey = new Map(records.map((r) => [r.key, r]));
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const record = byKey.get(def.key);
    const current = stats[def.stat];
    const target = def.target;
    const progress = target > 0 ? Math.min(1, current / target) : 0;
    const unlocked = Boolean(record?.unlockedAt) || current >= target;
    return {
      definition: def,
      record: record ?? draftRecord(def),
      current,
      target,
      progress,
      unlocked,
      unlockedAt: record?.unlockedAt ?? null,
      progressLabel: formatProgress(def, current, target),
    };
  });
}

function formatProgress(def: AchievementDefinition, current: number, target: number): string {
  const isMinutes = def.stat.endsWith('Minutes');
  if (isMinutes) {
    return `${Math.round(current / 60)}h of ${Math.round(target / 60)}h`;
  }
  if (def.stat === 'bestPaperAccuracy') return `${Math.round(current)}% best (need ${target}%)`;
  return `${Math.min(current, target)} of ${target}`;
}

function draftRecord(def: AchievementDefinition): Achievement {
  const now = Date.now();
  return {
    id: newId('ach'),
    createdAt: now,
    updatedAt: now,
    key: def.key,
    title: def.title,
    description: def.description,
    category: def.category,
    tier: def.tier,
    target: def.target,
    progress: 0,
    unlockedAt: null,
    xpReward: def.xpReward,
  };
}

/* ------------------------------------------------------------------ */
/* DB-backed evaluation                                                */
/* ------------------------------------------------------------------ */

export interface EvaluationResult {
  stats: AchievementStats;
  views: AchievementView[];
  /** Achievements that crossed their threshold on this run. */
  newlyUnlocked: AchievementView[];
}

/**
 * Recomputes every stat from stored records, persists progress, and unlocks
 * anything that has crossed its threshold. Idempotent: an already-unlocked
 * achievement is never unlocked (or paid) twice.
 */
export async function evaluateAchievements(): Promise<EvaluationResult> {
  const [activities, tasks, sessions, papers, attempts, blocks, profile, trackers, records] =
    await Promise.all([
      db.activities.toArray(),
      db.tasks.toArray(),
      db.sessions.toArray(),
      db.papers.toArray(),
      db.attempts.toArray(),
      db.blocks.toArray(),
      db.profile.get('profile'),
      db.trackers.toArray(),
      db.achievements.toArray(),
    ]);

  // Resolve every tracker to its root pillar so nested subjects count.
  const pillarByTracker = buildPillarLookup(trackers);

  const config = (await getSchedulingConfig()).xp;
  const level = levelProgress(profile?.totalXP ?? 0, config).level;

  const stats = computeStats({
    activities, tasks, sessions, papers, attempts, blocks, profile, level, pillarByTracker,
  });
  const views = buildViews(stats, records);

  const now = Date.now();
  const newlyUnlocked: AchievementView[] = [];

  for (const view of views) {
    const existing = records.find((r) => r.key === view.definition.key);
    const justUnlocked = view.current >= view.target && !existing?.unlockedAt;

    const patch: Achievement = {
      ...(existing ?? view.record),
      // Definitions are the source of truth for copy + thresholds.
      title: view.definition.title,
      description: view.definition.description,
      category: view.definition.category,
      tier: view.definition.tier,
      target: view.definition.target,
      xpReward: view.definition.xpReward,
      progress: Math.min(view.current, view.target),
      unlockedAt: existing?.unlockedAt ?? (justUnlocked ? now : null),
      updatedAt: now,
    };
    await db.achievements.put(patch);

    if (justUnlocked) {
      const unlockedView: AchievementView = { ...view, unlocked: true, unlockedAt: now, record: patch };
      newlyUnlocked.push(unlockedView);

      await logActivity({
        type: 'achievement_unlocked',
        at: now,
        title: view.definition.title,
        value: view.definition.xpReward,
        meta: {
          key: view.definition.key,
          category: view.definition.category,
          tier: view.definition.tier,
          measured: view.current,
          target: view.target,
        },
      });

      if (view.definition.xpReward > 0) {
        await bankAchievementReward(view.definition, now);
      }
    }
  }

  return { stats, views, newlyUnlocked };
}

/**
 * Achievement rewards vary per definition, so they cannot come from the flat
 * XP award table. They are banked as their own transaction, deduped by the
 * achievement key so re-evaluation can never pay twice.
 */
async function bankAchievementReward(def: AchievementDefinition, at: number): Promise<void> {
  const dedupeKey = `achievement_reward:achievement:${def.key}`;
  if (await db.xp.where('dedupeKey').equals(dedupeKey).first()) return;

  const profile = await db.profile.get('profile');
  const config = (await getSchedulingConfig()).xp;
  const balanceAfter = (profile?.totalXP ?? 0) + def.xpReward;

  await db.xp.add({
    id: newId('xp'),
    createdAt: at,
    updatedAt: at,
    at,
    date: toDateKey(at),
    amount: def.xpReward,
    reason: 'achievement_reward',
    description: `Achievement: ${def.title}`,
    sourceType: 'achievement',
    sourceId: def.key,
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

/** Read-only view of every achievement with live progress. */
export async function listAchievements(): Promise<EvaluationResult> {
  return evaluateAchievements();
}

export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = [
  'study', 'mastery', 'goals', 'consistency', 'fitness', 'skills',
];

export function groupByCategory(views: readonly AchievementView[]): {
  category: AchievementCategory;
  views: AchievementView[];
  unlocked: number;
}[] {
  return ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const list = views
      .filter((v) => v.definition.category === category)
      .sort((a, b) => a.definition.tier - b.definition.tier || b.progress - a.progress);
    return { category, views: list, unlocked: list.filter((v) => v.unlocked).length };
  }).filter((g) => g.views.length > 0);
}
