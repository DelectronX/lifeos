import type { DashboardWidgetSize, DashboardWidgetType } from '@/types';
import { TodayTasksWidget } from './TodayTasksWidget';
import { FocusTimeTodayWidget } from './FocusTimeTodayWidget';
import { XPProgressWidget } from './XPProgressWidget';
import { StudyStreakWidget } from './StudyStreakWidget';
import { WeeklyStudyTimeWidget } from './WeeklyStudyTimeWidget';
import { SubjectProgressWidget } from './SubjectProgressWidget';
import { RecentMaterialWidget } from './RecentMaterialWidget';
import { ContinueStudyingWidget } from './ContinueStudyingWidget';
import { AchievementProgressWidget } from './AchievementProgressWidget';
import type { WidgetComponentProps } from './types';
import {
  AchievementShowcaseWidget, ActivityTimelineWidget, DailyProductivityWidget, FocusStatsWidget, GoalProgressWidget,
  OverdueTasksWidget, ProjectOverviewWidget, ScheduleOverviewWidget, StreakTrackerWidget, TimeDistributionWidget,
  UpcomingDeadlinesWidget as DeadlinesWidget, WeeklyPerformanceWidget,
} from './insightWidgets';

export interface WidgetDefinition {
  type: DashboardWidgetType;
  label: string;
  description: string;
  defaultSize: DashboardWidgetSize;
  component: (props: WidgetComponentProps) => JSX.Element;
  hasSettings?: boolean;
}

/**
 * Every widget type Home can show, keyed by its type id.
 *
 * Registering a widget here is the ONLY thing required to make it available
 * in the "Add widget" picker — HomePage and the edit-mode chrome are generic
 * over this registry and never special-case a widget type by name.
 */
export const WIDGET_REGISTRY: Record<DashboardWidgetType, WidgetDefinition> = {
  today_tasks: {
    type: 'today_tasks',
    label: "Today's Tasks",
    description: 'Tasks due today, tap one to open it.',
    defaultSize: 'medium',
    component: TodayTasksWidget,
  },
  today_schedule: {
    type: 'today_schedule',
    label: 'Schedule overview',
    description: 'Current, upcoming and completed blocks today.',
    defaultSize: 'medium',
    component: ScheduleOverviewWidget,
  },
  focus_time_today: {
    type: 'focus_time_today',
    label: 'Focus Time Today',
    description: 'Minutes actually tracked today.',
    defaultSize: 'small',
    component: FocusTimeTodayWidget,
  },
  xp_progress: {
    type: 'xp_progress',
    label: 'EP/XP Progress',
    description: 'Current level and progress to the next one.',
    defaultSize: 'small',
    component: XPProgressWidget,
  },
  study_streak: {
    type: 'study_streak',
    label: 'Study Streak',
    description: 'Consecutive active days.',
    defaultSize: 'small',
    component: StudyStreakWidget,
  },
  weekly_study_time: {
    type: 'weekly_study_time',
    label: 'Weekly Study Time',
    description: 'Study minutes tracked so far this week.',
    defaultSize: 'small',
    component: WeeklyStudyTimeWidget,
  },
  subject_progress: {
    type: 'subject_progress',
    label: 'Subject Progress',
    description: 'Time tracked for one subject, or all of them.',
    defaultSize: 'medium',
    component: SubjectProgressWidget,
    hasSettings: true,
  },
  upcoming_deadlines: {
    type: 'upcoming_deadlines',
    label: 'Upcoming Deadlines',
    description: 'Your nearest task due dates, with days left.',
    defaultSize: 'medium',
    component: DeadlinesWidget,
  },
  recent_material: {
    type: 'recent_material',
    label: 'Recent Study Material',
    description: 'Recently added files and links.',
    defaultSize: 'medium',
    component: RecentMaterialWidget,
  },
  continue_studying: {
    type: 'continue_studying',
    label: 'Continue Studying',
    description: 'Pick up your most recently opened material.',
    defaultSize: 'small',
    component: ContinueStudyingWidget,
  },
  achievement_progress: {
    type: 'achievement_progress',
    label: 'Achievement Progress',
    description: "Achievements you're closest to unlocking.",
    defaultSize: 'medium',
    component: AchievementProgressWidget,
  },
  daily_productivity: { type: 'daily_productivity', label: 'Daily productivity', description: "Today's completion across blocks, tasks and checklists.", defaultSize: 'medium', component: DailyProductivityWidget },
  time_distribution: { type: 'time_distribution', label: 'Time distribution', description: 'Where tracked time went, by area — today or the last 7 days.', defaultSize: 'medium', component: TimeDistributionWidget },
  weekly_performance: { type: 'weekly_performance', label: 'Weekly performance', description: 'Daily completion rate this week vs. last week.', defaultSize: 'medium', component: WeeklyPerformanceWidget },
  goal_progress: { type: 'goal_progress', label: 'Goal progress', description: 'Active goals with their milestone tracks.', defaultSize: 'medium', component: GoalProgressWidget },
  project_overview: { type: 'project_overview', label: 'Projects', description: 'Projects with stage and health.', defaultSize: 'medium', component: ProjectOverviewWidget },
  streak_tracker: { type: 'streak_tracker', label: 'Streak tracker', description: 'Current streak and a 28-day consistency grid.', defaultSize: 'small', component: StreakTrackerWidget },
  achievement_showcase: { type: 'achievement_showcase', label: 'Achievement showcase', description: 'Recently unlocked achievements and the next one.', defaultSize: 'small', component: AchievementShowcaseWidget },
  focus_stats: { type: 'focus_stats', label: 'Focus statistics', description: 'Focus time and sessions today and this week.', defaultSize: 'small', component: FocusStatsWidget },
  overdue_tasks: { type: 'overdue_tasks', label: 'Overdue tasks', description: 'Tasks past due, completable in one tap.', defaultSize: 'small', component: OverdueTasksWidget },
  activity_timeline: { type: 'activity_timeline', label: 'Activity timeline', description: 'The latest things you actually did.', defaultSize: 'medium', component: ActivityTimelineWidget },
};

/** The recommended Home arrangement (also how new widget types are introduced). */
export const RECOMMENDED_LAYOUT: DashboardWidgetType[] = [
  'daily_productivity', 'today_schedule', 'weekly_performance', 'time_distribution',
  'streak_tracker', 'focus_stats', 'overdue_tasks', 'achievement_showcase',
  'goal_progress', 'project_overview', 'upcoming_deadlines', 'activity_timeline',
];

export const WIDGET_TYPES = Object.keys(WIDGET_REGISTRY) as DashboardWidgetType[];
