/**
 * LifeOS domain model.
 *
 * Architectural rule: there is exactly ONE universal activity architecture.
 * Every trackable thing in the app is either:
 *   - a definition record (Tracker, Goal, Task, Habit, Resource, Paper, RevisionPlan), or
 *   - a scheduled intent (ScheduleBlock), or
 *   - a real recorded event (Activity + its typed detail record such as TimerSession).
 *
 * Analytics, XP, streaks and goal progress read from the Activity log, never from
 * per-pillar duplicated tables. Pillars (Study/Fitness/Skills/Personal) are just
 * root Trackers; subjects/disciplines are child Trackers via `parentId`.
 */

export type ID = string;
/** Epoch milliseconds. */
export type Timestamp = number;
/** Local calendar day, YYYY-MM-DD. Used for all day-bucketed indexes. */
export type DateKey = string;
/** Minutes from local midnight, 0..1440. */
export type MinuteOfDay = number;

export interface BaseEntity {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Trackers (pillars + subjects)                                       */
/* ------------------------------------------------------------------ */

export type Pillar = 'study' | 'fitness' | 'skills' | 'personal' | 'system';

/** Semantic colour keys - mapped to a restrained palette in the design system. */
export type TrackerColor =
  | 'indigo' | 'teal' | 'amber' | 'rose' | 'violet'
  | 'slate' | 'sky' | 'lime' | 'stone';

export interface Tracker extends BaseEntity {
  name: string;
  pillar: Pillar;
  parentId: ID | null;
  color: TrackerColor;
  icon?: string;
  /** System trackers (Sleep/School/Meals/Break/Free) cannot be deleted. */
  system: boolean;
  /** Blocks of this tracker default to protected (scheduler may not overwrite). */
  defaultProtected: boolean;
  archived: boolean;
  sortOrder: number;
  /** Optional weekly time target in minutes, used by analytics + goals. */
  weeklyTargetMinutes?: number;
}

/* ------------------------------------------------------------------ */
/* Profile & settings                                                  */
/* ------------------------------------------------------------------ */

export interface UserProfile extends BaseEntity {
  displayName: string;
  totalXP: number;
  level: number;
  /** Consecutive days with at least one qualifying activity. */
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: DateKey | null;
  onboardedAt: Timestamp | null;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface Settings extends BaseEntity {
  /** Singleton row id. */
  id: 'settings';
  schemaVersion: number;
  theme: ThemeMode;
  weekStartsOn: 0 | 1;
  /** Overrides merged over DEFAULT_SCHEDULING_CONFIG. */
  scheduling: DeepPartial<SchedulingConfig>;
  /** Availability per weekday, 0 = Sunday. */
  workingHours: WorkingHours;
  /** Preferred deep-work ranges, used as a scoring bonus. */
  focusHours: { startMinute: MinuteOfDay; endMinute: MinuteOfDay }[];
  notifications: {
    enabled: boolean;
    blockStart: boolean;
    breakEnd: boolean;
    revisionDue: boolean;
    dailyReviewHour: number;
    /** Phase 8: how far ahead of a block an "upcoming" reminder fires. */
    leadMinutes?: number;
    /** Phase 8: notify when a task's due date arrives. */
    taskDue?: boolean;
  };
  lastDailyReviewDate: DateKey | null;
  lastWeeklyReviewDate: DateKey | null;

  /* --- Phase 8 additions (all optional so existing rows stay valid) --- */
  /** Timer + pomodoro defaults, read by the Focus module. */
  timers?: TimerPreferences;
  /** Presentation-only preferences. */
  appearance?: AppearancePreferences;
  /** Automatic local backup policy. */
  backup?: BackupPreferences;

  /* --- Phase 9 additions (optional; existing rows stay valid) --- */
  /** How the app treats work that slipped. See {@link AutoRescheduleMode}. */
  autoReschedule?: AutoReschedulePreferences;
  /** Analytics snapshot rollup policy. */
  analytics?: AnalyticsMaintenancePreferences;
  /** First-run / demo-data bookkeeping. */
  demo?: DemoDataState;
}

/**
 * Full-auto rescheduling behaviour.
 *
 *   off       — nothing runs; rescheduling stays a per-task, user-driven action.
 *   suggest   — the engine runs on a preview basis and the app shows what it
 *               *would* do. Nothing is written until the user accepts.
 *   automatic — the engine runs and applies its decisions as one undoable
 *               PlanRun, then surfaces a dismissible notice saying exactly what
 *               moved, with Undo. Per SPEC §40 nothing may move invisibly.
 */
export type AutoRescheduleMode = 'off' | 'suggest' | 'automatic';

export interface AutoReschedulePreferences {
  mode: AutoRescheduleMode;
  /** Also sweep on a timer while a tab is open, not only at app start. */
  runWhileOpen: boolean;
  /** Minutes between sweeps when `runWhileOpen` is set. */
  intervalMinutes: number;
  /** Guard so one app start does not sweep repeatedly. */
  lastRunAt: Timestamp | null;
  /** Id of the most recent automatic run, so the notice survives a reload. */
  lastRunId: ID | null;
}

export const DEFAULT_AUTO_RESCHEDULE_PREFERENCES: AutoReschedulePreferences = {
  mode: 'suggest',
  runWhileOpen: true,
  intervalMinutes: 60,
  lastRunAt: null,
  lastRunId: null,
};

export interface AnalyticsMaintenancePreferences {
  /** Roll day/week snapshots so long-range views do not replay the event log. */
  rollSnapshots: boolean;
  /** Minutes between rollups while a tab is open. */
  intervalMinutes: number;
  lastRolledAt: Timestamp | null;
}

export const DEFAULT_ANALYTICS_MAINTENANCE: AnalyticsMaintenancePreferences = {
  rollSnapshots: true,
  intervalMinutes: 180,
  lastRolledAt: null,
};

/** Bookkeeping for the preloaded demo dataset and the first-run choice. */
export interface DemoDataState {
  /** Set when the demo dataset was last installed. */
  loadedAt: Timestamp | null;
  /** Seed the dataset was generated from, so a reload reproduces it exactly. */
  seed: number | null;
  /** True once the user has answered the first-run "load demo data?" prompt. */
  firstRunAnswered: boolean;
}

export const DEFAULT_DEMO_STATE: DemoDataState = {
  loadedAt: null,
  seed: null,
  firstRunAnswered: false,
};

export interface TimerPreferences {
  defaultFocusMinutes: number;
  pomodoroWorkMinutes: number;
  pomodoroShortBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodorosBeforeLongBreak: number;
  autoStartBreaks: boolean;
}

export interface AppearancePreferences {
  density: 'comfortable' | 'compact';
  use24HourClock: boolean;
  reduceMotion: boolean;
}

export interface BackupPreferences {
  autoBackupEnabled: boolean;
  /** Minimum days between automatic snapshots. */
  intervalDays: number;
  /** How many automatic snapshots to retain; older ones are pruned. */
  keepCount: number;
  lastBackupAt: Timestamp | null;
}

/** Default values for every Phase 8 preference group. */
export const DEFAULT_TIMER_PREFERENCES: TimerPreferences = {
  defaultFocusMinutes: 45,
  pomodoroWorkMinutes: 25,
  pomodoroShortBreakMinutes: 5,
  pomodoroLongBreakMinutes: 20,
  pomodorosBeforeLongBreak: 4,
  autoStartBreaks: true,
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  density: 'comfortable',
  use24HourClock: false,
  reduceMotion: false,
};

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  autoBackupEnabled: true,
  intervalDays: 1,
  keepCount: 5,
  lastBackupAt: null,
};

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export type GoalType =
  /** Progress = completed linked tasks / total linked tasks. */
  | 'completion'
  /** Progress = accumulated Activity.value against targetValue. */
  | 'metric'
  /** Progress = accumulated tracked minutes against targetValue. */
  | 'time'
  /** Progress = weighted completed milestones. */
  | 'milestone'
  /** Progress = habit check-ins against targetValue. */
  | 'habit';

export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface Goal extends BaseEntity {
  title: string;
  description?: string;
  type: GoalType;
  trackerId: ID;
  status: GoalStatus;
  startDate: DateKey;
  targetDate: DateKey | null;
  /** For metric/time/habit goals. Time goals store minutes. */
  targetValue: number | null;
  unit?: string;
  /** 0..1 - feeds PriorityScoringEngine's goalWeight component. */
  weight: number;
  /** Cached progress 0..1, recomputed by GoalProgressEngine. */
  progress: number;
  progressComputedAt: Timestamp | null;
  completedAt: Timestamp | null;
  color?: TrackerColor;
}

export interface Milestone extends BaseEntity {
  goalId: ID;
  title: string;
  targetDate: DateKey | null;
  sortOrder: number;
  weight: number;
  completedAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type TaskStatus =
  | 'inbox' | 'planned' | 'in_progress'
  | 'completed' | 'skipped' | 'rescheduled' | 'cancelled';

export type TaskType =
  | 'study' | 'practice' | 'revision' | 'reading' | 'writing'
  | 'workout' | 'project' | 'admin' | 'chore' | 'other';

/** Preferred time-of-day window. Soft constraint - scheduler scores, not rejects. */
export type TimeWindow = 'morning' | 'afternoon' | 'evening' | 'night' | 'any';

/** Cognitive/physical intensity - drives mandatory breaks between sessions. */
export type Intensity = 'low' | 'medium' | 'high';

/**
 * How willing the user is to let engines move this task.
 *   fixed    - must stay exactly where the user put it
 *   movable  - may be moved, but only as a whole
 *   flexible - may be moved, split and reshaped freely
 */
export type TaskFlexibility = 'fixed' | 'movable' | 'flexible';

export interface TaskStatusChange {
  from: TaskStatus | null;
  to: TaskStatus;
  at: Timestamp;
  reason?: string;
  /** Set when an engine (not the user) made the change, for undo grouping. */
  planRunId?: ID;
}

export interface Task extends BaseEntity {
  title: string;
  notes?: string;
  trackerId: ID;
  goalId: ID | null;
  milestoneId: ID | null;
  parentTaskId: ID | null;
  type: TaskType;
  status: TaskStatus;
  statusHistory: TaskStatusChange[];
  /** 1 (lowest) .. 5 (highest) - user-declared importance. */
  basePriority: 1 | 2 | 3 | 4 | 5;
  dueDate: DateKey | null;
  /** Hard deadlines are never scheduled past; soft ones only penalise the score. */
  deadlineHard: boolean;
  estimatedMinutes: number;
  /** Rolled up from TimerSessions + manual completion entries. */
  actualMinutes: number;
  /** Task IDs that must be completed before this one may be scheduled. */
  dependsOn: ID[];
  tags: string[];
  preferredWindow: TimeWindow;
  intensity: Intensity;
  splittable: boolean;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  resourceIds: ID[];
  /** Set when generated from a RecurringRule. */
  recurringRuleId: ID | null;
  /** Set when generated by the revision engine. */
  revisionEntryId: ID | null;
  /** Cached PriorityScoringEngine output (0..100). */
  priorityScore: number;
  priorityComputedAt: Timestamp | null;
  completedAt: Timestamp | null;
  /** Number of times a rescheduling engine has moved this task. */
  rescheduleCount: number;
  sortOrder: number;

  /* --- Phase 2 additions (all optional so existing records stay valid) --- */
  /** Free-text topic/chapter within the tracker's subject. */
  topic?: string;
  /** Do not schedule before this day (soft floor for the scheduler). */
  earliestDate?: DateKey | null;
  /** Movement policy for engines. Defaults to `flexible`. */
  flexibility?: TaskFlexibility;
  /** External reference links (URLs) attached to the task. */
  links?: string[];
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export type BlockKind =
  | 'task'
  | 'fixed'
  | 'break'
  | 'buffer'
  | 'sleep'
  | 'meal'
  | 'event';

export type BlockStatus =
  | 'planned' | 'in_progress' | 'completed'
  | 'partial' | 'skipped' | 'cancelled';

export type BlockOrigin =
  | 'manual' | 'scheduler' | 'template' | 'recurring' | 'reschedule' | 'timer';

export interface ScheduleBlock extends BaseEntity {
  title: string;
  date: DateKey;
  start: Timestamp;
  end: Timestamp;
  trackerId: ID;
  kind: BlockKind;
  taskId: ID | null;
  goalId: ID | null;
  resourceId: ID | null;
  status: BlockStatus;
  /** User-pinned: engines must not move or shorten it. */
  locked: boolean;
  /** Protected time (sleep/school/meals): engines must never schedule over it. */
  protected: boolean;
  origin: BlockOrigin;
  /** Groups the blocks produced by one automated run, for undo + explanation. */
  planRunId: ID | null;
  /** Blocks belonging to one split task share this id. */
  splitGroupId: ID | null;
  splitIndex: number;
  splitCount: number;
  actualStart: Timestamp | null;
  actualEnd: Timestamp | null;
  notes?: string;

  /* --- Phase 2 additions (optional; existing rows stay valid) --- */
  /** Set when this block was materialised from a RecurringRule. */
  recurringRuleId?: ID | null;
  /**
   * The rule's nominal occurrence day. Kept even when the block is dragged to
   * another time so "this occurrence" edits stay attached to the right slot.
   */
  occurrenceDate?: DateKey | null;
  /** True when the user detached this occurrence from its series. */
  detachedFromSeries?: boolean;
  /** Set when this block came from applying a ScheduleTemplate. */
  templateId?: ID | null;
}

export interface ScheduleTemplateEntry {
  id: ID;
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
  title: string;
  trackerId: ID;
  kind: BlockKind;
  protected: boolean;
  locked: boolean;
}

export interface ScheduleTemplate extends BaseEntity {
  name: string;
  description?: string;
  entries: ScheduleTemplateEntry[];
  /** Applied automatically when generating future days. */
  active: boolean;
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly';

export interface RecurringRule extends BaseEntity {
  title: string;
  freq: RecurrenceFreq;
  interval: number;
  /** For weekly: 0..6 weekday numbers. */
  byWeekday: number[];
  /** For monthly: 1..31 day numbers. */
  byMonthDay: number[];
  startDate: DateKey;
  endDate: DateKey | null;
  count: number | null;
  /** What gets materialised on each occurrence. */
  target: 'task' | 'block';
  taskTemplate: Partial<Task> | null;
  blockTemplate: {
    startMinute: MinuteOfDay;
    durationMinutes: number;
    trackerId: ID;
    title: string;
    kind: BlockKind;
    protected: boolean;
  } | null;
  lastGeneratedDate: DateKey | null;
  active: boolean;

  /* --- Phase 2 additions --- */
  /** Occurrence dates the user removed. Never regenerated. */
  exceptions?: DateKey[];
  /**
   * Per-occurrence overrides keyed by the occurrence DateKey. Used by the
   * "this occurrence only" edit mode so the series definition stays intact.
   */
  overrides?: Record<DateKey, RecurrenceOverride>;
}

/** A single-occurrence override of a recurring block. */
export interface RecurrenceOverride {
  title?: string;
  startMinute?: MinuteOfDay;
  durationMinutes?: number;
  trackerId?: ID;
  kind?: BlockKind;
  protected?: boolean;
  notes?: string;
}

/** Which occurrences an edit to a recurring series applies to. */
export type RecurrenceEditScope = 'occurrence' | 'future' | 'series';

/* ------------------------------------------------------------------ */
/* Timers                                                              */
/* ------------------------------------------------------------------ */

export type TimerMode =
  | 'focus' | 'pomodoro' | 'stopwatch' | 'countdown' | 'paper' | 'question';

export type PomodoroPhase = 'work' | 'short_break' | 'long_break';

export interface TimerSegment {
  start: Timestamp;
  end: Timestamp;
  phase?: PomodoroPhase;
}

export interface TimerSession extends BaseEntity {
  mode: TimerMode;
  taskId: ID | null;
  blockId: ID | null;
  goalId: ID | null;
  trackerId: ID;
  paperId: ID | null;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  /** Sum of segment durations that count as work, in ms. */
  workMs: number;
  breakMs: number;
  plannedMs: number | null;
  segments: TimerSegment[];
  pomodoroCount: number;
  interruptions: number;
  /** True when it ran to its planned end / was explicitly finished, not abandoned. */
  completed: boolean;
  notes?: string;
  date: DateKey;
}

/* ------------------------------------------------------------------ */
/* Papers & questions                                                  */
/* ------------------------------------------------------------------ */

export type PaperStatus = 'draft' | 'in_progress' | 'submitted' | 'reviewed';

export interface PaperSection {
  id: ID;
  name: string;
  trackerId: ID;
  questionCount: number;
  marksPerQuestion: number;
  negativeMarks: number;
}

export interface Paper extends BaseEntity {
  title: string;
  sections: PaperSection[];
  durationMinutes: number;
  timed: boolean;
  status: PaperStatus;
  startedAt: Timestamp | null;
  submittedAt: Timestamp | null;
  date: DateKey;
  /** Cached derived score; recomputed from attempts. */
  score: number;
  maxScore: number;
  notes?: string;
}

export interface Question extends BaseEntity {
  paperId: ID;
  sectionId: ID;
  /** 1-based position within the whole paper. */
  index: number;
  trackerId: ID;
  topic?: string;
  marks: number;
  negativeMarks: number;
  expectedSeconds: number;
}

export type QuestionStatus =
  | 'unattempted' | 'correct' | 'incorrect' | 'skipped' | 'marked';

export type MistakeType =
  | 'unknown_concept'
  | 'conceptual'
  | 'calculation'
  | 'silly'
  | 'misread'
  | 'time_pressure'
  | 'guess'
  | 'other';

export interface QuestionAttempt extends BaseEntity {
  questionId: ID;
  paperId: ID;
  sectionId: ID;
  trackerId: ID;
  status: QuestionStatus;
  /** Accumulated across every visit to the question. */
  timeSpentMs: number;
  visits: number;
  mistakeType: MistakeType | null;
  confidence: 1 | 2 | 3 | 4 | 5 | null;
  notes?: string;
  attemptedAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Revision (spaced repetition)                                        */
/* ------------------------------------------------------------------ */

export type RevisionSourceType = 'topic' | 'task' | 'paper' | 'resource';
export type RevisionPlanStatus = 'active' | 'completed' | 'paused';

export interface RevisionPlan extends BaseEntity {
  title: string;
  trackerId: ID;
  sourceType: RevisionSourceType;
  sourceId: ID | null;
  /** Interval ladder in days, copied from config at creation. */
  intervals: number[];
  /** Index into `intervals` for the NEXT repetition. */
  currentIndex: number;
  /** SM-2 style ease factor, 1.3..3.0. */
  ease: number;
  status: RevisionPlanStatus;
  startDate: DateKey;
  lastRevisedAt: Timestamp | null;
  defaultDurationMinutes: number;
  notes?: string;
}

export type RevisionEntryStatus =
  | 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'skipped';

export interface RevisionEntry extends BaseEntity {
  planId: ID;
  trackerId: ID;
  dueDate: DateKey;
  /** Repetition number (0-based) within the plan. */
  repetition: number;
  intervalDays: number;
  status: RevisionEntryStatus;
  completedAt: Timestamp | null;
  /** Recall quality 0..5 (SM-2 scale) recorded on completion. */
  quality: number | null;
  /** Task materialised for this revision, if the user scheduled it. */
  taskId: ID | null;
  durationMinutes: number;
}

/* ------------------------------------------------------------------ */
/* Resources & attachments                                             */
/* ------------------------------------------------------------------ */

export type ResourceType =
  | 'book' | 'video' | 'course' | 'pdf' | 'link' | 'note' | 'other';

export interface Resource extends BaseEntity {
  title: string;
  type: ResourceType;
  trackerId: ID;
  url?: string;
  attachmentId: ID | null;
  /** Progress unit label, e.g. "pages", "lectures". */
  unit: string;
  currentUnit: number;
  totalUnits: number | null;
  tags: string[];
  archived: boolean;
  notes?: string;

  /* --- Phase 8 additions (optional; existing rows stay valid) --- */
  /** Reverse links, multi-entry indexed so attachment lookups never scan. */
  taskIds?: ID[];
  blockIds?: ID[];
  goalIds?: ID[];
  /** MIME type of the backing attachment, cached for icon/open decisions. */
  mime?: string;
  sizeBytes?: number;
}

export interface Attachment extends BaseEntity {
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  resourceId: ID | null;
  taskId: ID | null;

  /* --- Phase 8 additions --- */
  blockId?: ID | null;
  goalId?: ID | null;
}

/* ------------------------------------------------------------------ */
/* Habits                                                              */
/* ------------------------------------------------------------------ */

export type HabitCadence = 'daily' | 'weekly';

export interface Habit extends BaseEntity {
  title: string;
  trackerId: ID;
  goalId: ID | null;
  cadence: HabitCadence;
  /** Times per period required to count the period as met. */
  targetPerPeriod: number;
  /** Optional numeric target per check-in (e.g. 30 minutes, 20 reps). */
  targetValue: number | null;
  unit?: string;
  archived: boolean;
  currentStreak: number;
  longestStreak: number;
  lastCheckinDate: DateKey | null;
  color?: TrackerColor;
}

/* ------------------------------------------------------------------ */
/* Universal Activity log                                              */
/* ------------------------------------------------------------------ */

export type ActivityType =
  | 'task_created'
  | 'task_completed'
  | 'task_skipped'
  | 'task_cancelled'
  | 'task_rescheduled'
  | 'block_completed'
  | 'block_skipped'
  | 'timer_session'
  | 'paper_submitted'
  | 'question_attempt'
  | 'revision_completed'
  | 'revision_missed'
  | 'habit_checkin'
  | 'resource_progress'
  | 'goal_completed'
  | 'milestone_completed'
  | 'level_up'
  | 'achievement_unlocked'
  | 'daily_review'
  | 'weekly_review';

/**
 * The universal event record. One row per real thing that happened.
 * Every analytics number in the app traces back to rows in this table.
 */
export interface Activity extends BaseEntity {
  type: ActivityType;
  at: Timestamp;
  date: DateKey;
  trackerId: ID | null;
  taskId: ID | null;
  goalId: ID | null;
  blockId: ID | null;
  sessionId: ID | null;
  paperId: ID | null;
  revisionEntryId: ID | null;
  habitId: ID | null;
  resourceId: ID | null;
  /** Real time contributed by this event, in ms. Only set for events with duration. */
  durationMs: number;
  /** Numeric payload for metric goals (reps, pages, marks...). */
  value: number | null;
  unit: string | null;
  title: string;
  meta: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* XP, levels, achievements                                            */
/* ------------------------------------------------------------------ */

export interface XPTransaction extends BaseEntity {
  at: Timestamp;
  date: DateKey;
  amount: number;
  /** Config key describing why, e.g. task_completed. */
  reason: string;
  description: string;
  sourceType: string;
  sourceId: ID | null;
  activityId: ID | null;
  /**
   * Unique key preventing double-award and create/cancel farming loops.
   * Indexed uniquely so a duplicate insert throws.
   */
  dedupeKey: string;
  balanceAfter: number;
}

export type AchievementCategory =
  | 'study' | 'goals' | 'skills' | 'consistency' | 'fitness' | 'mastery'
  /* --- Phase 9 additions. Existing values are unchanged. --- */
  | 'revision' | 'focus' | 'planning' | 'personal';

export interface Achievement extends BaseEntity {
  /** Stable definition key from src/config/achievements.ts */
  key: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: 1 | 2 | 3;
  target: number;
  progress: number;
  unlockedAt: Timestamp | null;
  xpReward: number;
}

/* ------------------------------------------------------------------ */
/* Analytics cache                                                     */
/* ------------------------------------------------------------------ */

export type SnapshotScope = 'day' | 'week' | 'month';

export interface AnalyticsSnapshot extends BaseEntity {
  scope: SnapshotScope;
  /** Day key, ISO week key (2026-W12) or month key (2026-03). */
  periodKey: string;
  metrics: Record<string, number>;
  /** Minutes per trackerId. */
  byTracker: Record<string, number>;
  computedAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Undo / plan runs                                                    */
/* ------------------------------------------------------------------ */

export type PlanRunKind =
  | 'auto_schedule' | 'reschedule' | 'conflict_resolution'
  | 'template_apply' | 'recurring_generate' | 'revision_generate'
  | 'daily_review' | 'bulk_edit';

export type ChangeOp = 'create' | 'update' | 'delete';

export interface RecordChange {
  table: string;
  id: ID;
  op: ChangeOp;
  before: unknown | null;
  after: unknown | null;
}

/**
 * Every automated mutation is grouped into a PlanRun so it can be explained
 * to the user in plain language and reverted exactly.
 */
export interface PlanRun extends BaseEntity {
  kind: PlanRunKind;
  at: Timestamp;
  /** Human-readable explanation lines shown in the UI. */
  explanation: string[];
  changes: RecordChange[];
  undone: boolean;
  undoneAt: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Local backup snapshots (Phase 8)                                    */
/* ------------------------------------------------------------------ */

export type BackupKind = 'auto' | 'manual' | 'pre_import';

/**
 * A point-in-time JSON export kept inside IndexedDB. Nothing leaves the
 * device: this is a local safety net, not a sync mechanism.
 */
export interface BackupSnapshot extends BaseEntity {
  at: Timestamp;
  kind: BackupKind;
  schemaVersion: number;
  /** Serialised ExportBundle. Stored as text so restore is a pure parse. */
  payload: string;
  sizeBytes: number;
  /** Row counts per table, shown in the restore list without parsing. */
  tableCounts: Record<string, number>;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Scheduling configuration (shape here, values in src/config)         */
/* ------------------------------------------------------------------ */

export interface PriorityWeights {
  base: number;
  deadline: number;
  goal: number;
  overdue: number;
  dependency: number;
  revision: number;
  age: number;
  effort: number;
}

export interface TimeRange {
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
}

/** Availability per weekday, index 0..6 (Sunday..Saturday). */
export type WorkingHours = Record<number, TimeRange[]>;

export type RescheduleStrategy =
  | 'next_slot' | 'tomorrow' | 'split' | 'displace' | 'shrink' | 'cancel' | 'manual';

export interface XPConfig {
  /** Base award per event key. */
  awards: Record<string, number>;
  /** XP per minute of tracked focus time. */
  perFocusMinute: number;
  /** Multiplier per intensity level. */
  intensityMultiplier: Record<Intensity, number>;
  /** Multiplier per base priority 1..5. */
  priorityMultiplier: Record<number, number>;
  /** Streak bonus: +streakBonusPerDay per consecutive day, capped. */
  streakBonusPerDay: number;
  streakBonusCap: number;
  /** Daily ceilings preventing farming. */
  dailyCaps: Record<string, number>;
  /** Global daily XP ceiling. */
  dailyTotalCap: number;
  /** Level curve: xp needed to go from level n to n+1. */
  levelCurve: { base: number; exponent: number };
  /** Minimum real minutes an event must represent to earn duration XP. */
  minQualifyingMinutes: number;
  /** A task must live at least this long before completion earns XP (anti-farming). */
  minTaskAgeSeconds: number;
}

export interface SchedulingConfig {
  priority: {
    weights: PriorityWeights;
    /** Days-to-deadline at which urgency reaches ~63% of max. */
    deadlineHalfLifeDays: number;
    /** Days overdue at which the overdue penalty saturates. */
    overdueSaturationDays: number;
    /** Blocked-task count at which the dependency component saturates. */
    dependencySaturation: number;
    /** Days since creation at which the age component saturates. */
    ageSaturationDays: number;
    /** Multiplier applied to tasks generated by the revision engine. */
    revisionBoost: number;
    /** Soft deadlines contribute this fraction of a hard deadline's urgency. */
    softDeadlineFactor: number;
    /** Estimated minutes at which the effort component saturates. */
    effortSaturationMinutes: number;
  };
  slots: {
    /** All placements snap to this grid, in minutes. */
    granularityMinutes: number;
    defaultSessionMinutes: number;
    minSessionMinutes: number;
    maxSessionMinutes: number;
    /** Gap left before/after an existing block when packing. */
    bufferMinutes: number;
    /** Slots shorter than this are ignored entirely. */
    minUsableSlotMinutes: number;
    /** Do not schedule anything starting sooner than this from "now". */
    leadTimeMinutes: number;
    /** How many days ahead auto-scheduling may look. */
    horizonDays: number;
    /** Ceiling on scheduled work minutes per day. */
    maxDailyLoadMinutes: number;
  };
  breaks: {
    /** Continuous high-intensity minutes after which a break is required. */
    intensiveThresholdMinutes: number;
    breakMinutes: number;
    longBreakMinutes: number;
    /** Consecutive sessions before a long break is inserted. */
    sessionsBeforeLongBreak: number;
    enforceBetweenIntensive: boolean;
  };
  windows: {
    morning: [MinuteOfDay, MinuteOfDay];
    afternoon: [MinuteOfDay, MinuteOfDay];
    evening: [MinuteOfDay, MinuteOfDay];
    night: [MinuteOfDay, MinuteOfDay];
    /** Score bonus (0..1) when a placement matches the task's preferred window. */
    matchBonus: number;
    /** Score penalty when it does not. */
    mismatchPenalty: number;
  };
  scoring: {
    earliness: number;
    fragmentation: number;
    windowFit: number;
    contiguity: number;
    loadBalance: number;
    focusHourBonus: number;
  };
  rescheduling: {
    autoReschedule: boolean;
    /** Ordered preference of strategies used by auto mode. */
    strategyOrder: RescheduleStrategy[];
    /** Never displace a task whose priority is within this margin of the mover. */
    displacementPriorityMargin: number;
    /** Maximum times a single task may be auto-moved before asking the user. */
    maxAutoMoves: number;
    /** Overrun beyond this many minutes triggers the conflict engine. */
    overrunToleranceMinutes: number;
    /** Shrink strategy may not cut a session below this fraction of its length. */
    minShrinkFactor: number;
  };
  duration: {
    /** Minimum historical samples before a prediction is offered. */
    minSamples: number;
    minRatio: number;
    maxRatio: number;
    /** Suggestions round to this many minutes. */
    roundToMinutes: number;
  };
  revision: {
    /** Default interval ladder in days. */
    intervals: number[];
    initialEase: number;
    minEase: number;
    maxEase: number;
    /** Quality below this counts as a lapse. */
    lapseQualityThreshold: number;
    /** Interval multiplier applied after a lapse. */
    lapsePenalty: number;
    defaultDurationMinutes: number;
    /** Days after due date before a scheduled revision is auto-marked missed. */
    missedAfterDays: number;
  };
  xp: XPConfig;
}
