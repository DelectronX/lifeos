import { db, SCHEMA_VERSION } from '@/db/db';
import { ACHIEVEMENT_DEFINITIONS } from '@/config/achievements';
import { recomputeAllGoalProgress } from '@/services/goalService';
import { evaluateAchievements } from '@/services/achievementService';
import { evaluateRewardsWith } from '@/services/rewardService';
import { rollSnapshots } from '@/services/analyticsService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { createDefaultSettings, ensureSeeded } from '@/db/seed';
import { DEFAULT_DEMO_STATE, type Settings } from '@/types';
import { createContext, FUTURE_DAYS, HISTORY_DAYS, type DemoContext, type DemoWorld } from './world';
import { DEMO_SEED } from './rng';
import { seedTrackers } from './trackers';
import { seedGoals } from './goals';
import { seedTasks } from './tasks';
import { seedSchedule } from './schedule';
import { seedSessions } from './sessions';
import { seedPapers } from './papers';
import { seedRevision } from './revision';
import { seedHabits } from './habits';
import { seedResources, seedRewards } from './resources';
import { seedActivities } from './activities';
import { seedXP } from './xp';

/**
 * Demo dataset installer.
 *
 * Generation order matters and is not arbitrary: tasks need goals and
 * milestones to link to, the schedule needs tasks, sessions need the schedule's
 * actual start/end times, and XP needs every activity that came before it.
 * After the world is written, DERIVED state is recomputed by the real
 * services — goal progress, achievements, rewards and analytics snapshots —
 * rather than being fabricated here, which is what keeps the numbers on every
 * screen consistent with the records behind them.
 */

export { DEMO_SEED } from './rng';
export type { DemoWorld } from './world';

export interface DemoDataSummary {
  seed: number;
  counts: Record<string, number>;
  totalRecords: number;
  historyDays: number;
  futureDays: number;
}

export function generateDemoWorld(seed: number = DEMO_SEED, now = Date.now()): DemoContext {
  const ctx = createContext(seed, now);

  seedTrackers(ctx);
  seedGoals(ctx);
  seedTasks(ctx);
  seedSchedule(ctx);
  seedSessions(ctx);
  seedPapers(ctx);
  seedRevision(ctx);
  seedHabits(ctx);
  seedResources(ctx);
  seedRewards(ctx);
  seedActivities(ctx);
  seedXP(ctx);

  return ctx;
}

export function summarise(world: DemoWorld, seed: number): DemoDataSummary {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [key, value] of Object.entries(world)) {
    if (!Array.isArray(value)) continue;
    counts[key] = value.length;
    total += value.length;
  }
  if (world.profile) { counts.profile = 1; total += 1; }
  return { seed, counts, totalRecords: total, historyDays: HISTORY_DAYS, futureDays: FUTURE_DAYS };
}

/** Tables the demo dataset owns. Cleared before a load, wiped by "Clear all". */
const DEMO_TABLES = [
  'trackers', 'goals', 'milestones', 'tasks', 'blocks', 'templates', 'recurringRules',
  'sessions', 'papers', 'questions', 'attempts', 'revisionPlans', 'revisionEntries',
  'resources', 'attachments', 'habits', 'activities', 'xp', 'achievements', 'snapshots',
  'planRuns', 'rewards', 'rewardEarnings', 'backups',
] as const;

async function clearDemoTables(): Promise<void> {
  await db.transaction('rw', [
    db.trackers, db.goals, db.milestones, db.tasks, db.blocks, db.templates,
    db.recurringRules, db.sessions, db.papers, db.questions, db.attempts,
    db.revisionPlans, db.revisionEntries, db.resources, db.attachments, db.habits,
    db.activities, db.xp, db.achievements, db.snapshots, db.planRuns, db.rewards,
    db.rewardEarnings, db.backups,
  ], async () => {
    await Promise.all([
      db.trackers.clear(), db.goals.clear(), db.milestones.clear(), db.tasks.clear(),
      db.blocks.clear(), db.templates.clear(), db.recurringRules.clear(), db.sessions.clear(),
      db.papers.clear(), db.questions.clear(), db.attempts.clear(), db.revisionPlans.clear(),
      db.revisionEntries.clear(), db.resources.clear(), db.attachments.clear(), db.habits.clear(),
      db.activities.clear(), db.xp.clear(), db.achievements.clear(), db.snapshots.clear(),
      db.planRuns.clear(), db.rewards.clear(), db.rewardEarnings.clear(), db.backups.clear(),
    ]);
  });
}

/**
 * Wipes every record and reinstates a pristine empty install — default
 * trackers, achievement definitions and settings, nothing else. Settings
 * themselves are preserved apart from the demo bookkeeping, because a user who
 * clears their data does not expect their theme and working hours to move.
 */
export async function clearAllData(): Promise<void> {
  const previous = await db.settings.get('settings');
  await clearDemoTables();
  await db.profile.clear();

  const settings: Settings = previous
    ? { ...previous, demo: { ...DEFAULT_DEMO_STATE, firstRunAnswered: true }, updatedAt: Date.now() }
    : { ...createDefaultSettings(), demo: { ...DEFAULT_DEMO_STATE, firstRunAnswered: true } };
  await db.settings.put(settings);

  await ensureSeeded();
}

/**
 * Installs the demo dataset. Existing records in the demo-owned tables are
 * REPLACED, which is why the UI insists on a confirmation: mixing seeded data
 * with real data is not a supported state and the copy says so.
 */
export async function loadDemoData(
  options: { seed?: number; now?: number } = {},
): Promise<DemoDataSummary> {
  const seed = options.seed ?? DEMO_SEED;
  const ctx = generateDemoWorld(seed, options.now ?? Date.now());
  const world = ctx.world;

  await clearDemoTables();

  // Achievement rows mirror the definition list; progress is filled in by the
  // real evaluator below, from the seeded history.
  const now = Date.now();
  const achievements = ACHIEVEMENT_DEFINITIONS.map((d, i) => ({
    id: `ach_demo${i}`,
    createdAt: now,
    updatedAt: now,
    key: d.key,
    title: d.title,
    description: d.description,
    category: d.category,
    tier: d.tier,
    target: d.target,
    progress: 0,
    unlockedAt: null,
    xpReward: d.xpReward,
  }));

  await db.transaction('rw', [
    db.profile, db.settings, db.trackers, db.goals, db.milestones, db.tasks, db.blocks,
    db.templates, db.recurringRules, db.sessions, db.papers, db.questions, db.attempts,
    db.revisionPlans, db.revisionEntries, db.resources, db.habits, db.activities, db.xp,
    db.achievements, db.rewards,
  ], async () => {
    await db.trackers.bulkPut(world.trackers);
    await db.goals.bulkPut(world.goals);
    await db.milestones.bulkPut(world.milestones);
    await db.tasks.bulkPut(world.tasks);
    await db.blocks.bulkPut(world.blocks);
    await db.templates.bulkPut(world.templates);
    await db.recurringRules.bulkPut(world.recurringRules);
    await db.sessions.bulkPut(world.sessions);
    await db.papers.bulkPut(world.papers);
    await db.questions.bulkPut(world.questions);
    await db.attempts.bulkPut(world.attempts);
    await db.revisionPlans.bulkPut(world.revisionPlans);
    await db.revisionEntries.bulkPut(world.revisionEntries);
    await db.resources.bulkPut(world.resources);
    await db.habits.bulkPut(world.habits);
    await db.activities.bulkPut(world.activities);
    await db.xp.bulkPut(world.xp);
    await db.achievements.bulkPut(achievements);
    await db.rewards.bulkPut(world.rewards);
    if (world.profile) await db.profile.put(world.profile);

    const existing = await db.settings.get('settings');
    const settings: Settings = {
      ...(existing ?? createDefaultSettings(now)),
      schemaVersion: SCHEMA_VERSION,
      demo: { loadedAt: now, seed, firstRunAnswered: true },
      updatedAt: now,
    };
    await db.settings.put(settings);
  });

  /* --- derived state, recomputed by the real services ------------------ */
  await recomputeAllGoalProgress();

  const evaluation = await evaluateAchievements();
  await evaluateRewardsWith(evaluation.metrics, new Date(ctx.now));

  try {
    await rollSnapshots();
  } catch {
    // Snapshots are pure cache: a failure here must not fail the load.
  }

  const summary = summarise(world, seed);
  summary.counts.achievementsUnlocked = evaluation.views.filter((v) => v.unlocked).length;
  return summary;
}

/** Clear + load in one confirmed step. */
export async function resetToDemoData(seed: number = DEMO_SEED): Promise<DemoDataSummary> {
  await clearAllData();
  return loadDemoData({ seed });
}

/** True when this install has never held any user records. */
export async function isFreshInstall(): Promise<boolean> {
  const [tasks, activities, blocks] = await Promise.all([
    db.tasks.count(), db.activities.count(), db.blocks.count(),
  ]);
  return tasks === 0 && activities === 0 && blocks === 0;
}

/** Whether the first-run demo offer should still be shown. */
export async function shouldOfferDemoData(): Promise<boolean> {
  const settings = await getSettings();
  if (settings.demo?.firstRunAnswered) return false;
  return isFreshInstall();
}

export async function dismissDemoOffer(): Promise<void> {
  const settings = await getSettings();
  await updateSettings({
    demo: { ...DEFAULT_DEMO_STATE, ...(settings.demo ?? {}), firstRunAnswered: true },
  });
}

export { DEMO_TABLES };
