import type { AchievementCategory } from '@/types';

/**
 * Every achievement is derived from a measurable counter computed from real
 * stored records (Activity / Task / TimerSession / Paper / Question /
 * RevisionEntry / Habit / ScheduleBlock / profile). There are no
 * "participation" achievements and nothing is awarded for creating records or
 * for opening the app — see achievementService.computeStats for how each stat
 * is measured.
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

  /* --- Phase 9 additions. Every one is counted from stored records. --- */

  /** Sessions of 15+ recorded minutes that started before 07:00 local. */
  earlyBirdSessions: number;
  /** Sessions of 15+ recorded minutes that started at or after 22:00 local. */
  nightOwlSessions: number;
  /** Sessions of 25+ minutes finished with zero recorded interruptions. */
  uninterruptedSessions: number;
  /** Sessions explicitly finished (not abandoned) with real recorded time. */
  sessionsCompleted: number;
  /** Most focus minutes recorded within one calendar day. */
  longestDailyFocusMinutes: number;
  /** Days with at least 120 recorded focus minutes. */
  deepFocusDays: number;
  /** Distinct Saturdays and Sundays with recorded activity. */
  weekendActiveDays: number;
  /** Weeks where both Saturday and Sunday had recorded activity. */
  weekendConsistencyWeeks: number;
  /** Calendar weeks where all seven days had recorded activity. */
  fullWeeks: number;
  /** Times a 5-day-plus active run was rebuilt after a break of 2+ idle days. */
  comebacks: number;
  /** Active days that ended with no task past its due date left open. */
  zeroOverdueDays: number;
  /** Most tasks completed within one calendar day. */
  bestTaskDay: number;
  /** Completed tasks whose base priority was 4 or 5. */
  tasksHighPriority: number;
  /** Completed tasks where actual time landed within 20% of the estimate. */
  planAccurateTasks: number;
  /** Days with 3+ planned blocks where 80%+ of planned minutes were completed. */
  planAdherenceDays: number;
  /** Scheduled blocks marked completed. */
  blocksCompleted: number;
  /** Papers that scored higher accuracy than the previously submitted paper. */
  papersImproved: number;
  /** Submitted papers of 10+ answered questions with no incorrect answer. */
  cleanPapers: number;
  /** Question attempts answered correctly. */
  questionsCorrect: number;
  /** Distinct subjects (trackers) that have at least one answered question. */
  distinctSubjectsExamined: number;
  /** Percentage-point drop in error rate, earliest 5 papers vs latest 5. */
  mistakeRateImprovement: number;
  /** Distinct revision plans with at least one completed repetition. */
  distinctTopicsRevised: number;
  /** Completed revisions graded 4 or 5 for recall quality. */
  revisionQualityHigh: number;
  /** Most milestones completed within a single calendar month. */
  bestMilestoneMonth: number;
  /** Longest streak reached by any single habit. */
  habitLongestStreak: number;
  /** Distinct habits with at least one recorded check-in. */
  distinctHabits: number;
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
  { key: 'study_500h', title: 'Long Haul', description: 'Record 500 hours of study time.', category: 'study', tier: 3, stat: 'studyMinutes', target: 30000, xpReward: 2500 },
  { key: 'pomodoro_50', title: 'Fifty Tomatoes', description: 'Complete 50 pomodoro cycles.', category: 'study', tier: 2, stat: 'pomodorosCompleted', target: 50, xpReward: 250 },
  { key: 'pomodoro_250', title: 'Cycle Discipline', description: 'Complete 250 pomodoro cycles.', category: 'study', tier: 3, stat: 'pomodorosCompleted', target: 250, xpReward: 900 },
  { key: 'long_session_120', title: 'Deep Work', description: 'Complete a single focus session of 2 hours.', category: 'study', tier: 2, stat: 'longestSessionMinutes', target: 120, xpReward: 200 },
  { key: 'papers_10', title: 'Test Ready', description: 'Submit 10 mock papers.', category: 'mastery', tier: 2, stat: 'papersSubmitted', target: 10, xpReward: 400 },
  { key: 'questions_1000', title: 'Thousand Questions', description: 'Attempt 1,000 paper questions.', category: 'mastery', tier: 3, stat: 'questionsAttempted', target: 1000, xpReward: 800 },
  { key: 'accuracy_90', title: 'Sharp Shooter', description: 'Score 90% accuracy on a paper.', category: 'mastery', tier: 3, stat: 'bestPaperAccuracy', target: 90, xpReward: 500 },

  // --- Goals -------------------------------------------------------------
  { key: 'milestone_10', title: 'Step by Step', description: 'Complete 10 milestones.', category: 'goals', tier: 1, stat: 'milestonesCompleted', target: 10, xpReward: 200 },
  { key: 'milestone_50', title: 'Sustained Progress', description: 'Complete 50 milestones.', category: 'goals', tier: 3, stat: 'milestonesCompleted', target: 50, xpReward: 800 },
  { key: 'goal_1', title: 'Follow Through', description: 'Complete your first goal.', category: 'goals', tier: 1, stat: 'goalsCompleted', target: 1, xpReward: 250 },
  { key: 'goal_5', title: 'Finisher', description: 'Complete 5 goals.', category: 'goals', tier: 2, stat: 'goalsCompleted', target: 5, xpReward: 600 },
  { key: 'goal_20', title: 'Architect of Habits', description: 'Complete 20 goals.', category: 'goals', tier: 3, stat: 'goalsCompleted', target: 20, xpReward: 1500 },
  { key: 'milestone_month_8', title: 'Momentum Month', description: 'Complete 8 milestones within one calendar month.', category: 'goals', tier: 2, stat: 'bestMilestoneMonth', target: 8, xpReward: 450 },
  { key: 'milestone_month_15', title: 'Shipping Pace', description: 'Complete 15 milestones within one calendar month.', category: 'goals', tier: 3, stat: 'bestMilestoneMonth', target: 15, xpReward: 900 },

  // --- Consistency -------------------------------------------------------
  { key: 'streak_7', title: 'One Good Week', description: 'Maintain a 7-day activity streak.', category: 'consistency', tier: 1, stat: 'longestStreak', target: 7, xpReward: 150 },
  { key: 'streak_30', title: 'Month of Momentum', description: 'Maintain a 30-day activity streak.', category: 'consistency', tier: 2, stat: 'longestStreak', target: 30, xpReward: 600 },
  { key: 'streak_100', title: 'Unbroken', description: 'Maintain a 100-day activity streak.', category: 'consistency', tier: 3, stat: 'longestStreak', target: 100, xpReward: 2000 },
  { key: 'active_days_10', title: 'First Ten', description: 'Be active on 10 separate days.', category: 'consistency', tier: 1, stat: 'activeDays', target: 10, xpReward: 100 },
  { key: 'active_days_50', title: 'Showing Up', description: 'Be active on 50 separate days.', category: 'consistency', tier: 2, stat: 'activeDays', target: 50, xpReward: 300 },
  { key: 'active_days_200', title: 'Two Hundred Days', description: 'Be active on 200 separate days.', category: 'consistency', tier: 3, stat: 'activeDays', target: 200, xpReward: 1200 },
  { key: 'perfect_days_10', title: 'Plan Kept', description: 'Finish every planned block on 10 days.', category: 'consistency', tier: 2, stat: 'perfectDays', target: 10, xpReward: 400 },
  { key: 'reviews_30', title: 'Reflective', description: 'Complete 30 daily reviews.', category: 'consistency', tier: 2, stat: 'dailyReviews', target: 30, xpReward: 350 },
  { key: 'weekly_reviews_12', title: 'Quarter Steward', description: 'Complete 12 weekly reviews.', category: 'consistency', tier: 3, stat: 'weeklyReviews', target: 12, xpReward: 600 },
  { key: 'tasks_25', title: 'Twenty-Five Done', description: 'Complete 25 tasks.', category: 'consistency', tier: 1, stat: 'tasksCompleted', target: 25, xpReward: 120 },
  { key: 'tasks_100', title: 'Century', description: 'Complete 100 tasks.', category: 'consistency', tier: 2, stat: 'tasksCompleted', target: 100, xpReward: 300 },
  { key: 'tasks_500', title: 'Five Hundred Done', description: 'Complete 500 tasks.', category: 'consistency', tier: 3, stat: 'tasksCompleted', target: 500, xpReward: 1400 },
  { key: 'tasks_on_time_50', title: 'Dependable', description: 'Complete 50 tasks on or before their due date.', category: 'consistency', tier: 2, stat: 'tasksOnTime', target: 50, xpReward: 400 },
  { key: 'tasks_on_time_200', title: 'Deadline Keeper', description: 'Complete 200 tasks on or before their due date.', category: 'consistency', tier: 3, stat: 'tasksOnTime', target: 200, xpReward: 1000 },
  { key: 'habit_100', title: 'Habitual', description: 'Log 100 habit check-ins.', category: 'consistency', tier: 2, stat: 'habitCheckins', target: 100, xpReward: 300 },
  { key: 'habit_365', title: 'A Year of Check-ins', description: 'Log 365 habit check-ins.', category: 'consistency', tier: 3, stat: 'habitCheckins', target: 365, xpReward: 1200 },
  { key: 'habit_streak_30', title: 'Thirty Straight', description: 'Reach a 30-day streak on a single habit.', category: 'consistency', tier: 2, stat: 'habitLongestStreak', target: 30, xpReward: 450 },
  { key: 'habit_distinct_5', title: 'Broad Routine', description: 'Record a check-in on 5 different habits.', category: 'consistency', tier: 1, stat: 'distinctHabits', target: 5, xpReward: 150 },
  { key: 'weekend_days_20', title: 'Weekends Count', description: 'Record activity on 20 separate Saturdays or Sundays.', category: 'consistency', tier: 2, stat: 'weekendActiveDays', target: 20, xpReward: 350 },
  { key: 'weekend_weeks_10', title: 'No Weekend Gap', description: 'Record activity on both weekend days in 10 separate weeks.', category: 'consistency', tier: 2, stat: 'weekendConsistencyWeeks', target: 10, xpReward: 400 },
  { key: 'full_weeks_4', title: 'Four Full Weeks', description: 'Record activity on all seven days in 4 separate weeks.', category: 'consistency', tier: 2, stat: 'fullWeeks', target: 4, xpReward: 400 },
  { key: 'full_weeks_20', title: 'Twenty Full Weeks', description: 'Record activity on all seven days in 20 separate weeks.', category: 'consistency', tier: 3, stat: 'fullWeeks', target: 20, xpReward: 1100 },
  { key: 'comeback_1', title: 'Back to It', description: 'Rebuild a 5-day active run after a break of two or more idle days.', category: 'consistency', tier: 1, stat: 'comebacks', target: 1, xpReward: 200 },
  { key: 'comeback_5', title: 'Resilient', description: 'Rebuild a 5-day active run after a break five separate times.', category: 'consistency', tier: 3, stat: 'comebacks', target: 5, xpReward: 700 },

  // --- Focus -------------------------------------------------------------
  { key: 'focus_25h', title: 'Time on Task', description: 'Record 25 hours of focused session time.', category: 'focus', tier: 1, stat: 'focusMinutes', target: 1500, xpReward: 200 },
  { key: 'focus_100h', title: 'Hundred Hours', description: 'Record 100 hours of focused session time.', category: 'focus', tier: 2, stat: 'focusMinutes', target: 6000, xpReward: 700 },
  { key: 'focus_500h', title: 'Five Hundred Hours', description: 'Record 500 hours of focused session time.', category: 'focus', tier: 3, stat: 'focusMinutes', target: 30000, xpReward: 2500 },
  { key: 'sessions_100', title: 'Hundred Sessions', description: 'Finish 100 timer sessions with recorded work time.', category: 'focus', tier: 2, stat: 'sessionsCompleted', target: 100, xpReward: 400 },
  { key: 'early_bird_20', title: 'Early Start', description: 'Run 20 sessions of 15+ minutes starting before 07:00.', category: 'focus', tier: 2, stat: 'earlyBirdSessions', target: 20, xpReward: 400 },
  { key: 'night_owl_20', title: 'Late Shift', description: 'Run 20 sessions of 15+ minutes starting at or after 22:00.', category: 'focus', tier: 2, stat: 'nightOwlSessions', target: 20, xpReward: 400 },
  { key: 'uninterrupted_25', title: 'Undisturbed', description: 'Finish 25 sessions of 25+ minutes with zero interruptions.', category: 'focus', tier: 2, stat: 'uninterruptedSessions', target: 25, xpReward: 450 },
  { key: 'day_focus_240', title: 'Four-Hour Day', description: 'Record 4 hours of focus within a single day.', category: 'focus', tier: 2, stat: 'longestDailyFocusMinutes', target: 240, xpReward: 350 },
  { key: 'day_focus_420', title: 'Seven-Hour Day', description: 'Record 7 hours of focus within a single day.', category: 'focus', tier: 3, stat: 'longestDailyFocusMinutes', target: 420, xpReward: 900 },
  { key: 'deep_focus_days_30', title: 'Two Hours a Day', description: 'Record at least 2 hours of focus on 30 separate days.', category: 'focus', tier: 3, stat: 'deepFocusDays', target: 30, xpReward: 800 },

  // --- Planning ----------------------------------------------------------
  { key: 'blocks_completed_100', title: 'Schedule Honoured', description: 'Complete 100 scheduled blocks.', category: 'planning', tier: 2, stat: 'blocksCompleted', target: 100, xpReward: 350 },
  { key: 'blocks_completed_500', title: 'Timetable Kept', description: 'Complete 500 scheduled blocks.', category: 'planning', tier: 3, stat: 'blocksCompleted', target: 500, xpReward: 1200 },
  { key: 'plan_adherence_20', title: 'Days as Planned', description: 'Finish 80% of planned minutes on 20 days with 3+ blocks scheduled.', category: 'planning', tier: 2, stat: 'planAdherenceDays', target: 20, xpReward: 500 },
  { key: 'estimate_accurate_25', title: 'Honest Estimates', description: 'Complete 25 tasks within 20% of their estimated time.', category: 'planning', tier: 2, stat: 'planAccurateTasks', target: 25, xpReward: 400 },
  { key: 'estimate_accurate_100', title: 'Calibrated', description: 'Complete 100 tasks within 20% of their estimated time.', category: 'planning', tier: 3, stat: 'planAccurateTasks', target: 100, xpReward: 1000 },
  { key: 'zero_overdue_30', title: 'Nothing Overdue', description: 'End 30 active days with no task left past its due date.', category: 'planning', tier: 2, stat: 'zeroOverdueDays', target: 30, xpReward: 500 },
  { key: 'best_task_day_12', title: 'Clearing Day', description: 'Complete 12 tasks within a single day.', category: 'planning', tier: 2, stat: 'bestTaskDay', target: 12, xpReward: 300 },
  { key: 'high_priority_50', title: 'First Things First', description: 'Complete 50 tasks set at priority 4 or 5.', category: 'planning', tier: 2, stat: 'tasksHighPriority', target: 50, xpReward: 450 },

  // --- Revision ----------------------------------------------------------
  { key: 'revision_50', title: 'Spaced Out', description: 'Complete 50 scheduled revisions.', category: 'revision', tier: 2, stat: 'revisionsCompleted', target: 50, xpReward: 400 },
  { key: 'revision_200', title: 'Long Memory', description: 'Complete 200 scheduled revisions.', category: 'revision', tier: 3, stat: 'revisionsCompleted', target: 200, xpReward: 1100 },
  { key: 'revision_on_time_25', title: 'Right on Schedule', description: 'Complete 25 revisions on their due date.', category: 'revision', tier: 2, stat: 'revisionsOnTime', target: 25, xpReward: 300 },
  { key: 'revision_topics_20', title: 'Wide Recall', description: 'Complete at least one revision for 20 different plans.', category: 'revision', tier: 2, stat: 'distinctTopicsRevised', target: 20, xpReward: 400 },
  { key: 'revision_quality_50', title: 'Solid Recall', description: 'Grade 50 completed revisions at recall quality 4 or 5.', category: 'revision', tier: 3, stat: 'revisionQualityHigh', target: 50, xpReward: 700 },

  // --- Mastery -----------------------------------------------------------
  { key: 'papers_3', title: 'First Papers', description: 'Submit 3 mock papers.', category: 'mastery', tier: 1, stat: 'papersSubmitted', target: 3, xpReward: 150 },
  { key: 'papers_25', title: 'Exam Hardened', description: 'Submit 25 mock papers.', category: 'mastery', tier: 3, stat: 'papersSubmitted', target: 25, xpReward: 1000 },
  { key: 'questions_250', title: 'Two Fifty', description: 'Attempt 250 paper questions.', category: 'mastery', tier: 1, stat: 'questionsAttempted', target: 250, xpReward: 200 },
  { key: 'questions_correct_500', title: 'Five Hundred Right', description: 'Answer 500 paper questions correctly.', category: 'mastery', tier: 2, stat: 'questionsCorrect', target: 500, xpReward: 600 },
  { key: 'papers_improved_5', title: 'Upward Trend', description: 'Beat your previous paper’s accuracy 5 times.', category: 'mastery', tier: 2, stat: 'papersImproved', target: 5, xpReward: 500 },
  { key: 'clean_paper_1', title: 'Flawless Paper', description: 'Submit a paper of 10+ answered questions with no wrong answer.', category: 'mastery', tier: 3, stat: 'cleanPapers', target: 1, xpReward: 600 },
  { key: 'subjects_examined_4', title: 'Across Subjects', description: 'Answer questions in 4 different subjects.', category: 'mastery', tier: 1, stat: 'distinctSubjectsExamined', target: 4, xpReward: 200 },
  { key: 'mistake_drop_10', title: 'Fewer Mistakes', description: 'Cut your error rate by 10 percentage points from your first five papers to your latest five.', category: 'mastery', tier: 3, stat: 'mistakeRateImprovement', target: 10, xpReward: 800 },
  { key: 'level_5', title: 'Level 5', description: 'Reach level 5.', category: 'mastery', tier: 1, stat: 'level', target: 5, xpReward: 0 },
  { key: 'level_15', title: 'Level 15', description: 'Reach level 15.', category: 'mastery', tier: 2, stat: 'level', target: 15, xpReward: 0 },
  { key: 'level_30', title: 'Level 30', description: 'Reach level 30.', category: 'mastery', tier: 3, stat: 'level', target: 30, xpReward: 0 },
  { key: 'level_50', title: 'Level 50', description: 'Reach level 50.', category: 'mastery', tier: 3, stat: 'level', target: 50, xpReward: 0 },

  // --- Fitness & skills --------------------------------------------------
  { key: 'fitness_20h', title: 'Moving', description: 'Record 20 hours of fitness time.', category: 'fitness', tier: 1, stat: 'fitnessMinutes', target: 1200, xpReward: 200 },
  { key: 'fitness_100h', title: 'Athlete', description: 'Record 100 hours of fitness time.', category: 'fitness', tier: 3, stat: 'fitnessMinutes', target: 6000, xpReward: 900 },
  { key: 'fitness_250h', title: 'Conditioned', description: 'Record 250 hours of fitness time.', category: 'fitness', tier: 3, stat: 'fitnessMinutes', target: 15000, xpReward: 1800 },
  { key: 'skills_25h', title: 'Apprentice', description: 'Record 25 hours of skill practice.', category: 'skills', tier: 1, stat: 'skillsMinutes', target: 1500, xpReward: 250 },
  { key: 'skills_100h', title: 'Craftsman', description: 'Record 100 hours of skill practice.', category: 'skills', tier: 3, stat: 'skillsMinutes', target: 6000, xpReward: 900 },
  { key: 'skills_300h', title: 'Practised Hand', description: 'Record 300 hours of skill practice.', category: 'skills', tier: 3, stat: 'skillsMinutes', target: 18000, xpReward: 2000 },

  // --- Personal ----------------------------------------------------------
  { key: 'personal_25h', title: 'Time for Yourself', description: 'Record 25 hours of personal time.', category: 'personal', tier: 1, stat: 'personalMinutes', target: 1500, xpReward: 200 },
  { key: 'personal_100h', title: 'Life Outside the Desk', description: 'Record 100 hours of personal time.', category: 'personal', tier: 3, stat: 'personalMinutes', target: 6000, xpReward: 800 },
  { key: 'balance_4', title: 'Balanced Day', description: 'Log time across all four pillars in one day.', category: 'personal', tier: 1, stat: 'bestPillarSpread', target: 4, xpReward: 150 },
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

/** Display labels for every measurable stat — reused by the reward builder. */
export const ACHIEVEMENT_STAT_LABELS: Record<AchievementStatKey, string> = {
  tasksCompleted: 'Tasks completed',
  tasksOnTime: 'Tasks completed on time',
  focusMinutes: 'Focus minutes',
  studyMinutes: 'Study minutes',
  fitnessMinutes: 'Fitness minutes',
  skillsMinutes: 'Skill practice minutes',
  personalMinutes: 'Personal minutes',
  pomodorosCompleted: 'Pomodoro cycles',
  longestSessionMinutes: 'Longest single session (minutes)',
  papersSubmitted: 'Papers submitted',
  questionsAttempted: 'Questions answered',
  bestPaperAccuracy: 'Best paper accuracy (%)',
  revisionsCompleted: 'Revisions completed',
  revisionsOnTime: 'Revisions completed on time',
  goalsCompleted: 'Goals completed',
  milestonesCompleted: 'Milestones completed',
  habitCheckins: 'Habit check-ins',
  currentStreak: 'Current streak (days)',
  longestStreak: 'Longest streak (days)',
  activeDays: 'Active days',
  perfectDays: 'Days with every block finished',
  dailyReviews: 'Daily reviews',
  weeklyReviews: 'Weekly reviews',
  bestPillarSpread: 'Pillars touched in one day',
  level: 'Level',
  earlyBirdSessions: 'Sessions before 07:00',
  nightOwlSessions: 'Sessions after 22:00',
  uninterruptedSessions: 'Uninterrupted sessions',
  sessionsCompleted: 'Sessions finished',
  longestDailyFocusMinutes: 'Best single day of focus (minutes)',
  deepFocusDays: 'Days with 2+ hours of focus',
  weekendActiveDays: 'Active weekend days',
  weekendConsistencyWeeks: 'Weeks with both weekend days active',
  fullWeeks: 'Weeks active all seven days',
  comebacks: 'Comebacks after a break',
  zeroOverdueDays: 'Days ending with nothing overdue',
  bestTaskDay: 'Most tasks completed in a day',
  tasksHighPriority: 'High-priority tasks completed',
  planAccurateTasks: 'Tasks finished close to estimate',
  planAdherenceDays: 'Days where the plan was kept',
  blocksCompleted: 'Scheduled blocks completed',
  papersImproved: 'Papers that beat the previous one',
  cleanPapers: 'Papers with no wrong answer',
  questionsCorrect: 'Questions answered correctly',
  distinctSubjectsExamined: 'Subjects examined',
  mistakeRateImprovement: 'Error-rate drop (percentage points)',
  distinctTopicsRevised: 'Distinct revision plans revised',
  revisionQualityHigh: 'Revisions recalled well',
  bestMilestoneMonth: 'Most milestones in a month',
  habitLongestStreak: 'Longest streak on one habit (days)',
  distinctHabits: 'Habits checked in',
};

/** Unit suffix per stat, for reward traces that read like sentences. */
export const ACHIEVEMENT_STAT_UNITS: Partial<Record<AchievementStatKey, string>> = {
  focusMinutes: 'min',
  studyMinutes: 'min',
  fitnessMinutes: 'min',
  skillsMinutes: 'min',
  personalMinutes: 'min',
  longestSessionMinutes: 'min',
  longestDailyFocusMinutes: 'min',
  bestPaperAccuracy: '%',
  mistakeRateImprovement: 'pts',
  currentStreak: 'days',
  longestStreak: 'days',
  habitLongestStreak: 'days',
};

export const ACHIEVEMENT_STAT_KEYS = Object.keys(ACHIEVEMENT_STAT_LABELS) as AchievementStatKey[];
