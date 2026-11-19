import { db } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { storage } from '@/storage';

/**
 * DataResetService — "start over" without any sample dataset.
 *
 * Deletes every productivity record and reinstates a pristine empty install
 * (default pillar trackers, built-in achievement definitions, settings). The
 * user's preferences (theme, working hours, scheduling numbers, XP tuning)
 * are kept, because clearing data is not the same as forgetting how the app
 * should behave.
 */

export const USER_DATA_TABLES = [
  'trackers', 'goals', 'milestones', 'tasks', 'blocks', 'templates', 'recurringRules',
  'sessions', 'papers', 'questions', 'attempts', 'revisionPlans', 'revisionEntries',
  'resources', 'attachments', 'habits', 'activities', 'xp', 'achievements', 'snapshots',
  'planRuns', 'rewards', 'rewardEarnings', 'backups', 'annotations', 'viewerProgress',
  'scheduleRules', 'currency',
] as const;

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [
    db.trackers, db.goals, db.milestones, db.tasks, db.blocks, db.templates,
    db.recurringRules, db.sessions, db.papers, db.questions, db.attempts,
    db.revisionPlans, db.revisionEntries, db.resources, db.attachments, db.habits,
    db.activities, db.xp, db.achievements, db.snapshots, db.planRuns, db.rewards,
    db.rewardEarnings, db.backups, db.annotations, db.viewerProgress, db.scheduleRules,
    db.currency, db.profile,
  ], async () => {
    await Promise.all([
      db.trackers.clear(), db.goals.clear(), db.milestones.clear(), db.tasks.clear(),
      db.blocks.clear(), db.templates.clear(), db.recurringRules.clear(), db.sessions.clear(),
      db.papers.clear(), db.questions.clear(), db.attempts.clear(), db.revisionPlans.clear(),
      db.revisionEntries.clear(), db.resources.clear(), db.attachments.clear(), db.habits.clear(),
      db.activities.clear(), db.xp.clear(), db.achievements.clear(), db.snapshots.clear(),
      db.planRuns.clear(), db.rewards.clear(), db.rewardEarnings.clear(), db.backups.clear(),
      db.annotations.clear(), db.viewerProgress.clear(), db.scheduleRules.clear(),
      db.currency.clear(), db.profile.clear(),
    ]);
  });
  await ensureSeeded();
  await storage.saveAll();
}

/** True when nothing but the seeded defaults exist. */
export async function isFreshInstall(): Promise<boolean> {
  const [tasks, blocks, sessions, activities] = await Promise.all([
    db.tasks.count(), db.blocks.count(), db.sessions.count(), db.activities.count(),
  ]);
  return tasks + blocks + sessions + activities === 0;
}
