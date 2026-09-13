import Dexie, { type Table } from 'dexie';
import type {
  Achievement, Activity, AnalyticsSnapshot, Annotation, Attachment, BackupSnapshot, Goal, Habit,
  Milestone, CustomReward, Paper, PlanRun, Question, QuestionAttempt, RecurringRule, Resource,
  RewardEarning, ScheduleRule,
  RevisionEntry, RevisionPlan, ScheduleBlock, ScheduleTemplate, Settings,
  Task, TimerSession, Tracker, UserProfile, ViewerProgress, XPTransaction,
} from '@/types';

/** Bumped whenever the Dexie stores definition changes. Also written into exports. */
export const SCHEMA_VERSION = 7;

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
  backups!: Table<BackupSnapshot, string>;
  rewards!: Table<CustomReward, string>;
  rewardEarnings!: Table<RewardEarning, string>;
  annotations!: Table<Annotation, string>;
  viewerProgress!: Table<ViewerProgress, string>;
  scheduleRules!: Table<ScheduleRule, string>;

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

    /**
     * v3 (Phase 8): local backup snapshots, plus reverse-lookup multi-entry
     * indexes on resources so "what is attached to this task/block/goal" is an
     * index hit rather than a full table scan. `attachments` gains blockId and
     * goalId for the same reason. Every other store carries forward untouched.
     */
    this.version(3).stores({
      resources: 'id, trackerId, type, archived, title, *tags, *taskIds, *blockIds, *goalIds',
      attachments: 'id, resourceId, taskId, blockId, goalId, createdAt',
      backups: 'id, at, kind, [kind+at]',
    });

    /**
     * v4 (Phase 9): user-defined rewards and their earning history. A reward
     * may only be earned once per repeat period, which is enforced by the
     * unique compound index [rewardId+periodKey] rather than by a read-then-
     * write race in the service. Every other store carries forward untouched.
     */
    this.version(4).stores({
      rewards: 'id, archived, sortOrder, updatedAt, [archived+sortOrder]',
      rewardEarnings: 'id, rewardId, at, date, claimedAt, &[rewardId+periodKey], [rewardId+at]',
    });

    /**
     * v5 (in-app resource viewers): PDF annotations keyed by resource + page,
     * and a tiny per-resource viewer-progress table (video resume position /
     * last PDF page+zoom). Every other store carries forward untouched.
     */
    this.version(5).stores({
      annotations: 'id, resourceId, page, kind, [resourceId+page], createdAt',
      viewerProgress: 'id, &resourceId, updatedAt',
    });

    /**
     * v6 (Focus Mode inside the file viewer): timer sessions gained an
     * optional `resourceId` link so a Focus session started from a PDF/video/
     * image/text file in the Practice viewer shows up against that resource's
     * history. Every other store carries forward untouched; existing session
     * rows are simply missing the field until Dexie's upgrade hook backfills
     * it to null below (Dexie does not index a key that's absent on old rows).
     */
    this.version(6)
      .stores({
        sessions:
          'id, date, mode, taskId, blockId, trackerId, goalId, paperId, resourceId, startedAt, endedAt, ' +
          '[date+mode], [trackerId+date], [taskId+date], [resourceId+date]',
      })
      .upgrade(async (tx) => {
        await tx.table('sessions').toCollection().modify((row: { resourceId?: unknown }) => {
          if (row.resourceId === undefined) row.resourceId = null;
        });
      });

    /**
     * v7 (Rule-based Auto Plan): user-defined HARD subject/day/time-window
     * rules that constrain — but never themselves materialise — the
     * scheduling engine's placement of tasks belonging to a tracker. Every
     * other store carries forward untouched.
     */
    this.version(7).stores({
      scheduleRules: 'id, trackerId, active, [trackerId+active]',
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
    backups: db.backups,
    rewards: db.rewards,
    rewardEarnings: db.rewardEarnings,
    annotations: db.annotations,
    viewerProgress: db.viewerProgress,
    scheduleRules: db.scheduleRules,
  };
  return map[name] ?? null;
}

/** Every table exported to JSON. `attachments` is handled separately (blobs). */
export const EXPORTABLE_TABLES = [
  'profile', 'settings', 'trackers', 'goals', 'milestones', 'tasks', 'blocks',
  'templates', 'recurringRules', 'sessions', 'papers', 'questions', 'attempts',
  'revisionPlans', 'revisionEntries', 'resources', 'habits', 'activities',
  'xp', 'achievements', 'snapshots', 'planRuns', 'rewards', 'rewardEarnings',
  'annotations', 'viewerProgress', 'scheduleRules',
] as const;

export type ExportableTable = (typeof EXPORTABLE_TABLES)[number];
