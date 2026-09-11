import type { AchievementCategory } from '@/types';

/**
 * Every achievement is derived from a measurable counter computed from real
 * stored records (Activity / Task / TimerSession / Paper / Goal). There are no
 * "participation" achievements and nothing is awarded for creating records —
 * see AchievementEngine.computeStats for how each stat is measured.
 */
export interface AchievementStats {
  tasksCompleted: number;
  /** Tasks completed on or before their due date. */
  tasksOnTime: number;
  focusMinutes: number;
  studyMinutes: number;
  fitnessMinutes: number;
  skillsMinutes: number;
  personalMinutes: number;
  pomodorosCompleted: number;
  longestSessionMinutes: number;
  papersSubmitted: number;
  questionsAttempted: number;
  bestPaperAccuracy: number;
  revisionsCompleted: number;
  revisionsOnTime: number;
  goalsCompleted: number;
  milestonesCompleted: number;
  habitCheckins: number;
  currentStreak: number;
  longestStreak: number;
  /** Distinct days with any recorded activity. */
  activeDays: number;
  /** Days where every planned block was completed. */
  perfectDays: number;
  dailyReviews: number;
  weeklyReviews: number;
  /** Distinct trackers used in a single day, max over history. */
  bestPillarSpread: number;
  level: number;
}

export type AchievementStatKey = keyof AchievementStats;

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: 1 | 2 | 3;
  stat: AchievementStatKey;
  target: number;
  xpReward: number;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // --- Study -------------------------------------------------------------
  { key: 'study_10h', title: 'Getting Started', description: 'Record 10 hours of study time.', category: 'study', tier: 1, stat: 'studyMinutes', target: 600, xpReward: 100 },
  { key: 'study_50h', title: 'Deep Roots', description: 'Record 50 hours of study time.', category: 'study', tier: 2, stat: 'studyMinutes', target: 3000, xpReward: 350 },
  { key: 'study_200h', title: 'Scholar', description: 'Record 200 hours of study time.', category: 'study', tier: 3, stat: 'studyMinutes', target: 12000, xpReward: 1200 },
  { key: 'pomodoro_50', title: 'Fifty Tomatoes', description: 'Complete 50 pomodoro cycles.', category: 'study', tier: 2, stat: 'pomodorosCompleted', target: 50, xpReward: 250 },
  { key: 'long_session_120', title: 'Deep Work', description: 'Complete a single focus session of 2 hours.', category: 'study', tier: 2, stat: 'longestSessionMinutes', target: 120, xpReward: 200 },
  { key: 'papers_10', title: 'Test Ready', description: 'Submit 10 mock papers.', category: 'mastery', tier: 2, stat: 'papersSubmitted', target: 10, xpReward: 400 },
  { key: 'questions_1000', title: 'Thousand Questions', description: 'Attempt 1,000 paper questions.', category: 'mastery', tier: 3, stat: 'questionsAttempted', target: 1000, xpReward: 800 },
  { key: 'accuracy_90', title: 'Sharp Shooter', description: 'Score 90% accuracy on a paper.', category: 'mastery', tier: 3, stat: 'bestPaperAccuracy', target: 90, xpReward: 500 },

  // --- Goals -------------------------------------------------------------
  { key: 'milestone_10', title: 'Step by Step', description: 'Complete 10 milestones.', category: 'goals', tier: 1, stat: 'milestonesCompleted', target: 10, xpReward: 200 },
  { key: 'goal_1', title: 'Follow Through', description: 'Complete your first goal.', category: 'goals', tier: 1, stat: 'goalsCompleted', target: 1, xpReward: 250 },
  { key: 'goal_5', title: 'Finisher', description: 'Complete 5 goals.', category: 'goals', tier: 2, stat: 'goalsCompleted', target: 5, xpReward: 600 },
  { key: 'goal_20', title: 'Architect of Habits', description: 'Complete 20 goals.', category: 'goals', tier: 3, stat: 'goalsCompleted', target: 20, xpReward: 1500 },

  // --- Consistency -------------------------------------------------------
  { key: 'streak_7', title: 'One Good Week', description: 'Maintain a 7-day activity streak.', category: 'consistency', tier: 1, stat: 'longestStreak', target: 7, xpReward: 150 },
  { key: 'streak_30', title: 'Month of Momentum', description: 'Maintain a 30-day activity streak.', category: 'consistency', tier: 2, stat: 'longestStreak', target: 30, xpReward: 600 },
  { key: 'streak_100', title: 'Unbroken', description: 'Maintain a 100-day activity streak.', category: 'consistency', tier: 3, stat: 'longestStreak', target: 100, xpReward: 2000 },
  { key: 'active_days_50', title: 'Showing Up', description: 'Be active on 50 separate days.', category: 'consistency', tier: 2, stat: 'activeDays', target: 50, xpReward: 300 },
  { key: 'perfect_days_10', title: 'Plan Kept', description: 'Finish every planned block on 10 days.', category: 'consistency', tier: 2, stat: 'perfectDays', target: 10, xpReward: 400 },
  { key: 'reviews_30', title: 'Reflective', description: 'Complete 30 daily reviews.', category: 'consistency', tier: 2, stat: 'dailyReviews', target: 30, xpReward: 350 },
  { key: 'weekly_reviews_12', title: 'Quarter Steward', description: 'Complete 12 weekly reviews.', category: 'consistency', tier: 3, stat: 'weeklyReviews', target: 12, xpReward: 600 },
  { key: 'tasks_100', title: 'Century', description: 'Complete 100 tasks.', category: 'consistency', tier: 2, stat: 'tasksCompleted', target: 100, xpReward: 300 },
  { key: 'tasks_on_time_50', title: 'Dependable', description: 'Complete 50 tasks on or before their due date.', category: 'consistency', tier: 2, stat: 'tasksOnTime', target: 50, xpReward: 400 },

  // --- Revision ----------------------------------------------------------
  { key: 'revision_50', title: 'Spaced Out', description: 'Complete 50 scheduled revisions.', category: 'study', tier: 2, stat: 'revisionsCompleted', target: 50, xpReward: 400 },
  { key: 'revision_on_time_25', title: 'Right on Schedule', description: 'Complete 25 revisions on their due date.', category: 'study', tier: 2, stat: 'revisionsOnTime', target: 25, xpReward: 300 },

  // --- Fitness & skills --------------------------------------------------
  { key: 'fitness_20h', title: 'Moving', description: 'Record 20 hours of fitness time.', category: 'fitness', tier: 1, stat: 'fitnessMinutes', target: 1200, xpReward: 200 },
  { key: 'fitness_100h', title: 'Athlete', description: 'Record 100 hours of fitness time.', category: 'fitness', tier: 3, stat: 'fitnessMinutes', target: 6000, xpReward: 900 },
  { key: 'habit_100', title: 'Habitual', description: 'Log 100 habit check-ins.', category: 'consistency', tier: 2, stat: 'habitCheckins', target: 100, xpReward: 300 },
  { key: 'skills_25h', title: 'Apprentice', description: 'Record 25 hours of skill practice.', category: 'skills', tier: 1, stat: 'skillsMinutes', target: 1500, xpReward: 250 },
  { key: 'skills_100h', title: 'Craftsman', description: 'Record 100 hours of skill practice.', category: 'skills', tier: 3, stat: 'skillsMinutes', target: 6000, xpReward: 900 },
  { key: 'balance_4', title: 'Balanced Day', description: 'Log time across all four pillars in one day.', category: 'consistency', tier: 1, stat: 'bestPillarSpread', target: 4, xpReward: 150 },

  // --- Mastery -----------------------------------------------------------
  { key: 'level_5', title: 'Level 5', description: 'Reach level 5.', category: 'mastery', tier: 1, stat: 'level', target: 5, xpReward: 0 },
  { key: 'level_15', title: 'Level 15', description: 'Reach level 15.', category: 'mastery', tier: 2, stat: 'level', target: 15, xpReward: 0 },
  { key: 'level_30', title: 'Level 30', description: 'Reach level 30.', category: 'mastery', tier: 3, stat: 'level', target: 30, xpReward: 0 },
];

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  study: 'Study',
  goals: 'Goals',
  skills: 'Skills',
  consistency: 'Consistency',
  fitness: 'Fitness',
  mastery: 'Mastery',
  personal: 'Personal',
  revision: 'Revision',
  focus: 'Focus',
  planning: 'Planning',
};
