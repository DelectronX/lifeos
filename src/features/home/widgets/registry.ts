import type { DashboardWidgetSize, DashboardWidgetType } from '@/types';
import { TodayTasksWidget } from './TodayTasksWidget';
import { TodayScheduleWidget } from './TodayScheduleWidget';
import { FocusTimeTodayWidget } from './FocusTimeTodayWidget';
import { XPProgressWidget } from './XPProgressWidget';
import { StudyStreakWidget } from './StudyStreakWidget';
import { WeeklyStudyTimeWidget } from './WeeklyStudyTimeWidget';
import { SubjectProgressWidget } from './SubjectProgressWidget';
import { UpcomingDeadlinesWidget } from './UpcomingDeadlinesWidget';
import { RecentMaterialWidget } from './RecentMaterialWidget';
import { ContinueStudyingWidget } from './ContinueStudyingWidget';
import { AchievementProgressWidget } from './AchievementProgressWidget';
import type { WidgetComponentProps } from './types';

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
    label: "Today's Schedule",
    description: "Today's scheduled blocks in time order.",
    defaultSize: 'medium',
    component: TodayScheduleWidget,
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
    description: 'Your nearest task due dates.',
    defaultSize: 'medium',
    component: UpcomingDeadlinesWidget,
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
};

export const WIDGET_TYPES = Object.keys(WIDGET_REGISTRY) as DashboardWidgetType[];
