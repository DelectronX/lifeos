import Dexie, { type Table } from 'dexie';
import type {
  Achievement, Activity, AnalyticsSnapshot, Attachment, Goal, Habit, Milestone,
  Paper, PlanRun, Question, QuestionAttempt, RecurringRule, Resource,
  RevisionEntry, RevisionPlan, ScheduleBlock, ScheduleTemplate, Settings,
  Task, TimerSession, Tracker, UserProfile, XPTransaction,
} from '@/types';

/** Bumped whenever the Dexie stores definition changes. Also written into exports. */
export const SCHEMA_VERSION = 2;

/**
 * Index design notes (this app must stay fast with years of history):
 *  - Anything rendered for "a day" or "a range of days" is indexed on `date`
 *    (a YYYY-MM-DD string), so a range query is a single index scan.
 *  - Compound indexes match the exact shape of the hot queries:
 *      blocks:     [date+start]           -> ordered day/week timeline render
 *      activities: [date+type], [trackerId+date] -> analytics rollups
 *      tasks:      [status+dueDate]       -> "planned & due this week"
 *      xp:         [date+reason]          -> daily anti-farming caps
 *  - Multi-entry indexes (*tags, *dependsOn) support reverse lookups without
 *    scanning: "which tasks are blocked by X".
 *  - Attachments live in their own table so large blobs are never pulled in by
 *    a resource list query.
 */
export class LifeOSDatabase extends Dexie {
  profile!: Table<UserProfile, string>;
  settings!: Table<Settings, string>;
  trackers!: Table<Tracker, string>;
  goals!: Table<Goal, string>;
  milestones!: Table<Milestone, string>;
  tasks!: Table<Task, string>;
  blocks!: Table<ScheduleBlock, string>;
  templates!: Table<ScheduleTemplate, string>;
  recurringRules!: Table<RecurringRule, string>;
  sessions!: Table<TimerSession, string>;
  papers!: Table<Paper, string>;
  questions!: Table<Question, string>;
  attempts!: Table<QuestionAttempt, string>;
  revisionPlans!: Table<RevisionPlan, string>;
  revisionEntries!: Table<RevisionEntry, string>;
  resources!: Table<Resource, string>;
  attachments!: Table<Attachment, string>;
  habits!: Table<Habit, string>;
  activities!: Table<Activity, string>;
  xp!: Table<XPTransaction, string>;
  achievements!: Table<Achievement, string>;
  snapshots!: Table<AnalyticsSnapshot, string>;
  planRuns!: Table<PlanRun, string>;

  constructor(name = 'lifeos') {
    super(name);

    this.version(1).stores({
      profile: 'id, updatedAt',
      settings: 'id',
      trackers: 'id, parentId, pillar, sortOrder, archived, [pillar+archived]',
      goals: 'id, trackerId, status, targetDate, [status+targetDate], updatedAt',
      milestones: 'id, goalId, sortOrder, completedAt, [goalId+sortOrder]',
      tasks:
        'id, status, trackerId, goalId, milestoneId, parentTaskId, dueDate, type, ' +
        'priorityScore, completedAt, createdAt, updatedAt, revisionEntryId, recurringRuleId, ' +
        '[status+dueDate], [trackerId+status], [goalId+status], *tags, *dependsOn',
      blocks:
        'id, date, start, end, taskId, trackerId, goalId, status, kind, planRunId, splitGroupId, ' +
        '[date+start], [date+status], [taskId+date], [trackerId+date], [status+start]',
      templates: 'id, name, active',
      recurringRules: 'id, active, startDate, lastGeneratedDate, target',
      sessions:
        'id, date, mode, taskId, blockId, trackerId, goalId, paperId, startedAt, endedAt, ' +
        '[date+mode], [trackerId+date], [taskId+date]',
      papers: 'id, date, status, startedAt, submittedAt',
      questions: 'id, paperId, sectionId, trackerId, index, [paperId+index]',
      attempts:
        'id, paperId, questionId, sectionId, trackerId, status, mistakeType, ' +
        '[paperId+status], [trackerId+status], [paperId+questionId]',
      revisionPlans: 'id, trackerId, status, sourceType, sourceId, startDate',
      revisionEntries:
        'id, planId, trackerId, dueDate, status, taskId, ' +
        '[status+dueDate], [planId+repetition], [dueDate+status]',
      resources: 'id, trackerId, type, archived, title, *tags',
      attachments: 'id, resourceId, taskId, createdAt',
      habits: 'id, trackerId, goalId, archived, lastCheckinDate',
      activities:
        'id, at, date, type, trackerId, taskId, goalId, blockId, sessionId, paperId, ' +
        'revisionEntryId, habitId, resourceId, [date+type], [trackerId+date], [taskId+date], [type+at]',
      xp: 'id, at, date, reason, &dedupeKey, sourceId, [date+reason]',
      achievements: 'id, &key, category, unlockedAt, [category+tier]',
      snapshots: 'id, scope, periodKey, &[scope+periodKey], computedAt',
      planRuns: 'id, at, kind, undone, [kind+at]',
    });

    /**
     * v2 (Phase 2): schedule blocks gained a link back to the RecurringRule /
     * ScheduleTemplate that produced them, so "this occurrence / this and
     * future / entire series" edits and template re-applies can find their
     * materialised rows without a full table scan. Only `blocks` changes;
     * every other store is carried forward untouched.
     */
    this.version(2).stores({
      blocks:
        'id, date, start, end, taskId, trackerId, goalId, status, kind, planRunId, splitGroupId, ' +
        'recurringRuleId, templateId, occurrenceDate, ' +
        '[date+start], [date+status], [taskId+date], [trackerId+date], [status+start], ' +
        '[recurringRuleId+date], [templateId+date]',
    });
  }
}

export const db = new LifeOSDatabase();

/** Table name -> Dexie table, used by the generic undo + export/import services. */
export function tableByName(name: string): Table<any, string> | null {
  const map: Record<string, Table<any, string>> = {
    profile: db.profile,
    settings: db.settings,
    trackers: db.trackers,
    goals: db.goals,
    milestones: db.milestones,
    tasks: db.tasks,
    blocks: db.blocks,
    templates: db.templates,
    recurringRules: db.recurringRules,
    sessions: db.sessions,
    papers: db.papers,
    questions: db.questions,
    attempts: db.attempts,
    revisionPlans: db.revisionPlans,
    revisionEntries: db.revisionEntries,
    resources: db.resources,
    attachments: db.attachments,
    habits: db.habits,
    activities: db.activities,
    xp: db.xp,
    achievements: db.achievements,
    snapshots: db.snapshots,
    planRuns: db.planRuns,
  };
  return map[name] ?? null;
}

/** Every table exported to JSON. `attachments` is handled separately (blobs). */
export const EXPORTABLE_TABLES = [
  'profile', 'settings', 'trackers', 'goals', 'milestones', 'tasks', 'blocks',
  'templates', 'recurringRules', 'sessions', 'papers', 'questions', 'attempts',
  'revisionPlans', 'revisionEntries', 'resources', 'habits', 'activities',
  'xp', 'achievements', 'snapshots', 'planRuns',
] as const;

export type ExportableTable = (typeof EXPORTABLE_TABLES)[number];
