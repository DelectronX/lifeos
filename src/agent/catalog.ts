import { s, type JsonSchema } from './schema';
import type {
  AchievementCategory, BlockKind, BlockStatus, ChecklistCadence, GoalStatus, GoalType, Intensity, RecurrenceFreq, TaskFlexibility, TaskStatus,
  Pillar, TaskType, ThemeMode, TimeWindow, TrackerColor,
} from '../types';
import type {
  ContactStage, MoneyDirection, MoneyStatus, ProjectKind, ProjectStatus, SourceStatus, StudyKind, StudyStage,
} from '../types/workgrowth';

/**
 * The LifeOS agent operation catalog — ONE definition of every operation an
 * external agent can perform. It drives:
 *   - MCP tools (names, descriptions, input schemas, annotations),
 *   - the REST API routes and the generated OpenAPI document,
 *   - the CLI,
 *   - input validation in the browser dispatcher (the executor).
 *
 * Pure data; no imports with side effects, so Node can bundle it too.
 */

export type OperationKind = 'read' | 'write' | 'destructive';

export interface OperationDef {
  /** Stable tool name: `<area>_<verb>`; [a-z0-9_] only (valid for MCP, URLs and shells). */
  name: string;
  title: string;
  description: string;
  area: OperationArea;
  kind: OperationKind;
  /** Safe to repeat with the same input (same end state). */
  idempotent: boolean;
  input: JsonSchema;
}

export type OperationArea =
  | 'overview' | 'schedule' | 'recurring' | 'planning' | 'tasks' | 'checklists' | 'goals' | 'progress'
  | 'projects' | 'skills' | 'earning' | 'research' | 'exams' | 'habits' | 'focus' | 'analytics'
  | 'settings' | 'system';

/* ------------------------------------------------------------------ */
/* Enums (checked against the app's types at compile time)             */
/* ------------------------------------------------------------------ */

export const TASK_STATUS = ['inbox', 'planned', 'in_progress', 'completed', 'skipped', 'rescheduled', 'cancelled'] as const satisfies readonly TaskStatus[];
export const TASK_TYPE = ['study', 'practice', 'revision', 'reading', 'writing', 'workout', 'project', 'admin', 'chore', 'other'] as const satisfies readonly TaskType[];
export const BLOCK_KIND = ['task', 'fixed', 'break', 'buffer', 'sleep', 'meal', 'event'] as const satisfies readonly BlockKind[];
export const BLOCK_STATUS = ['planned', 'in_progress', 'completed', 'partial', 'skipped', 'cancelled'] as const satisfies readonly BlockStatus[];
export const GOAL_TYPE = ['completion', 'metric', 'time', 'milestone', 'habit'] as const satisfies readonly GoalType[];
export const GOAL_STATUS = ['active', 'paused', 'completed', 'abandoned'] as const satisfies readonly GoalStatus[];
export const CADENCE = ['daily', 'weekly', 'monthly'] as const satisfies readonly ChecklistCadence[];
export const PROJECT_STATUS = ['idea', 'planning', 'active', 'testing', 'shipped', 'paused', 'archived'] as const satisfies readonly ProjectStatus[];
export const PROJECT_KIND = ['portfolio', 'client', 'app', 'research', 'course', 'personal'] as const satisfies readonly ProjectKind[];
export const CONTACT_STAGE = ['lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'client'] as const satisfies readonly ContactStage[];
export const INTERACTION_KIND = ['note', 'call', 'email', 'message', 'meeting', 'proposal'] as const;
export const MONEY_DIRECTION = ['income', 'expense'] as const satisfies readonly MoneyDirection[];
export const MONEY_STATUS = ['expected', 'invoiced', 'paid', 'overdue', 'cancelled'] as const satisfies readonly MoneyStatus[];
export const STUDY_KIND = ['literature_review', 'paper', 'experiment'] as const satisfies readonly StudyKind[];
export const STUDY_STAGE = ['planning', 'searching', 'screening', 'reading', 'synthesis', 'writing', 'revising', 'submitted', 'published'] as const satisfies readonly StudyStage[];
export const SOURCE_STATUS = ['to_read', 'skimmed', 'read', 'extracted', 'excluded'] as const satisfies readonly SourceStatus[];
export const TIME_WINDOW = ['morning', 'afternoon', 'evening', 'night', 'any'] as const satisfies readonly TimeWindow[];
export const INTENSITY = ['low', 'medium', 'high'] as const satisfies readonly Intensity[];
export const FLEXIBILITY = ['fixed', 'movable', 'flexible'] as const satisfies readonly TaskFlexibility[];
export const THEME = ['light', 'dark', 'system'] as const satisfies readonly ThemeMode[];
export const COLORS = ['indigo', 'teal', 'amber', 'rose', 'violet', 'slate', 'sky', 'lime', 'stone'] as const satisfies readonly TrackerColor[];
export const PILLARS = ['study', 'fitness', 'skills', 'personal', 'system'] as const satisfies readonly Pillar[];
export const ACH_CATEGORY = ['study', 'goals', 'skills', 'consistency', 'fitness', 'mastery', 'revision', 'focus', 'planning', 'personal', 'academic', 'projects', 'discipline', 'meta', 'research', 'earning'] as const satisfies readonly AchievementCategory[];
export const FREQ = ['daily', 'weekly', 'monthly'] as const satisfies readonly RecurrenceFreq[];
export const SERIES_SCOPE = ['occurrence', 'future', 'series'] as const;

/* ------------------------------------------------------------------ */
/* Shared fragments                                                    */
/* ------------------------------------------------------------------ */

const page = {
  limit: s.int('Max items to return (1–500).', { minimum: 1, maximum: 500, default: 50 }),
  offset: s.int('Items to skip, for pagination.', { minimum: 0, default: 0 }),
};
const expectedUpdatedAt = s.int('Optimistic-concurrency guard: the record\'s `updatedAt` you last read. If it changed since, the call fails with CONFLICT instead of overwriting someone else\'s edit.', { minimum: 0 });
const confirm = s.bool('Must be true. Destructive operations refuse to run without explicit confirmation.');
const priority = s.int('1 (lowest) – 5 (highest).', { minimum: 1, maximum: 5 });
const tags = s.arr(s.str(undefined, { maxLength: 64 }), 'Free-form tags.', { maxItems: 50 });
const title = s.str('Title.', { minLength: 1, maxLength: 300 });

function op(name: string, area: OperationArea, kind: OperationKind, title: string, description: string, input: JsonSchema, idempotent = kind === 'read'): OperationDef {
  return { name, area, kind, title, description, input, idempotent };
}
const none = s.obj({});

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export const OPERATIONS: readonly OperationDef[] = [
  /* ---------------- Overview ---------------- */
  op('dashboard_get', 'overview', 'read', 'Dashboard',
    'Everything on the Home dashboard for a day: completion of required blocks / tasks / checklist items, the current and next block, overdue and upcoming tasks, streak, level and XP, focus time, recent achievements. Start here to understand the user\'s day.',
    s.obj({ date: s.date('Day to summarise; defaults to today.') })),
  op('progress_get', 'overview', 'read', 'Progress for a period',
    'Daily, weekly or monthly progress: required blocks completed, tasks completed, checklist completion, tracked minutes, XP earned, per-day series.',
    s.obj({ period: s.enum(['day', 'week', 'month'] as const, 'Period type.'), date: s.date('Any day inside the period; defaults to today.') }, ['period'])),

  /* ---------------- Schedule ---------------- */
  op('schedule_get_day', 'schedule', 'read', 'Schedule for a day',
    'All schedule blocks on one day in time order, with status, tracker, linked task/goal, and timing. Use for "today\'s schedule".',
    s.obj({ date: s.date('Defaults to today.'), includeCancelled: s.bool('Include cancelled blocks.', { default: false }) })),
  op('schedule_list_blocks', 'schedule', 'read', 'List blocks in a range',
    'Blocks between two dates (inclusive), filterable by status / tracker / kind, paginated and sorted by start time. Use for week or month views.',
    s.obj({
      from: s.date('First day.'), to: s.date('Last day (max 93 days after `from`).'),
      status: s.arr(s.enum(BLOCK_STATUS), 'Only these statuses.'), trackerId: s.id('tracker'), kind: s.arr(s.enum(BLOCK_KIND)),
      ...page,
    }, ['from', 'to'])),
  op('schedule_get_block', 'schedule', 'read', 'Get a block', 'One block by ID, with its conflicts on the same day.', s.obj({ id: s.id('block') }, ['id'])),
  op('schedule_get_current', 'schedule', 'read', 'Current and next block', 'The block happening now (if any) and the next planned block.', none),
  op('schedule_create_block', 'schedule', 'write', 'Create a block',
    'Adds a block to the calendar. Returns the block and any overlapping blocks (conflicts are reported, not prevented).',
    s.obj({
      title, start: s.dateTime('Start.'), end: s.dateTime('End (after start).'), trackerId: s.id('tracker (area/subject); see trackers_list'),
      kind: s.enum(BLOCK_KIND, 'Block kind; default "task" when taskId is set, else "fixed".'), taskId: s.id('task to work on'), goalId: s.id('goal'),
      notes: s.text('Notes.'), protected: s.bool('Protected blocks are never moved by auto-plan.'), locked: s.bool('Locked blocks cannot be dragged.'),
      optional: s.bool('Optional blocks (free time, optional extras) never count as missed and earn no productivity XP.'),
    }, ['title', 'start', 'end', 'trackerId'])),
  op('schedule_update_block', 'schedule', 'write', 'Update a block',
    'Edits a block\'s details (not its time — use schedule_reschedule_block). Supports optimistic concurrency.',
    s.obj({
      id: s.id('block'), title, notes: s.text('Notes.'), trackerId: s.id('tracker'), kind: s.enum(BLOCK_KIND), protected: s.bool(), locked: s.bool(),
      taskId: { type: ['string', 'null'], description: 'Link a task (null to unlink).' }, goalId: { type: ['string', 'null'], description: 'Link a goal (null to unlink).' },
      expectedUpdatedAt,
    }, ['id']), true),
  op('schedule_reschedule_block', 'schedule', 'write', 'Reschedule a block',
    'Moves a block to a new start/end (any day). Locked blocks are refused. Returns conflicts at the new time.',
    s.obj({ id: s.id('block'), start: s.dateTime('New start.'), end: s.dateTime('New end; defaults to keeping the same duration.'), expectedUpdatedAt }, ['id', 'start']), true),
  op('schedule_complete_block', 'schedule', 'write', 'Complete a block',
    'Marks a block completed through the same single completion path as the app\'s Done button: logs the real elapsed time, awards XP once, updates streaks, bonuses and the linked task. Idempotent — completing twice returns status "already_completed".',
    s.obj({
      id: s.id('block'), trackerId: s.id('more specific sub-tracker actually worked on (e.g. a subject under Academics)'),
      units: s.num('Countable output (e.g. problems solved) when the tracker has a unit.', { minimum: 0 }),
    }, ['id']), true),
  op('schedule_reopen_block', 'schedule', 'write', 'Mark a block incomplete',
    'Reverts a completed or skipped block to planned and removes the XP / events its completion produced.',
    s.obj({ id: s.id('block') }, ['id']), true),
  op('schedule_start_block', 'schedule', 'write', 'Start a block',
    'Marks a block in progress now. A started block is auto-completed at its planned end (see schedule_run_auto_completion).',
    s.obj({ id: s.id('block') }, ['id']), true),
  op('schedule_skip_block', 'schedule', 'write', 'Skip a block', 'Marks a block skipped (no XP).', s.obj({ id: s.id('block'), reason: s.str('Why.', { maxLength: 500 }) }, ['id']), true),
  op('schedule_cancel_block', 'schedule', 'write', 'Cancel a block', 'Marks a block cancelled (kept for history, excluded from stats).', s.obj({ id: s.id('block'), expectedUpdatedAt }, ['id']), true),
  op('schedule_delete_block', 'schedule', 'destructive', 'Delete a block', 'Permanently deletes a block. Requires confirm: true.', s.obj({ id: s.id('block'), confirm }, ['id', 'confirm']), true),
  op('schedule_get_conflicts', 'schedule', 'read', 'Schedule conflicts', 'Pairs of overlapping (non-cancelled) blocks on each day in a range.', s.obj({ from: s.date(), to: s.date('Defaults to `from`.') }, ['from'])),
  op('schedule_completion_history', 'schedule', 'read', 'Completion history',
    'Block completions and skips (the real logged events) in a date range, newest first, with durations.',
    s.obj({ from: s.date(), to: s.date(), trackerId: s.id('tracker'), ...page }, ['from', 'to'])),
  op('schedule_run_auto_completion', 'schedule', 'write', 'Run automatic completion',
    'Settles every started block whose planned end has passed, through the same completion path. Blocks never started are left alone. Idempotent; returns how many were completed.',
    none, true),
  op('schedule_auto_completion_status', 'schedule', 'read', 'Automatic completion status', 'Started blocks that will auto-complete, and those already past their end awaiting the next settle.', none),

  /* ---------------- Recurring ---------------- */
  op('recurring_list', 'recurring', 'read', 'Recurring schedules', 'Every recurring rule (repeating blocks or tasks) with a human-readable description.', s.obj({ activeOnly: s.bool('Only active rules.', { default: false }) })),
  op('recurring_create', 'recurring', 'write', 'Create a recurring block',
    'Creates a repeating block (daily / weekly on given weekdays / monthly on given days) and generates its upcoming occurrences.',
    s.obj({
      title, freq: s.enum(FREQ), interval: s.int('Every N periods.', { minimum: 1, maximum: 52 }),
      byWeekday: s.arr(s.int(undefined, { minimum: 0, maximum: 6 }), 'Weekly: 0=Sunday … 6=Saturday.'), byMonthDay: s.arr(s.int(undefined, { minimum: 1, maximum: 31 }), 'Monthly: days of month.'),
      startDate: s.date('First possible date; defaults to today.'), endDate: s.nullableDate('Last date (null = no end).'),
      startTime: s.time('Start time.'), durationMinutes: s.int('Length.', { minimum: 5, maximum: 1440 }), trackerId: s.id('tracker'),
      kind: s.enum(BLOCK_KIND), protected: s.bool(), notes: s.text(),
    }, ['title', 'freq', 'startTime', 'durationMinutes', 'trackerId'])),
  op('recurring_edit', 'recurring', 'write', 'Edit a recurring series',
    'Edits one occurrence, this-and-future, or the whole series (like a calendar app).',
    s.obj({
      ruleId: s.id('recurring rule'), occurrenceDate: s.date('The occurrence being edited.'), scope: s.enum(SERIES_SCOPE),
      title, startTime: s.time(), durationMinutes: s.int(undefined, { minimum: 5, maximum: 1440 }), trackerId: s.id('tracker'), kind: s.enum(BLOCK_KIND), protected: s.bool(), notes: s.text(),
    }, ['ruleId', 'occurrenceDate', 'scope']), true),
  op('recurring_set_active', 'recurring', 'write', 'Pause / resume a recurring rule', 'Activates or pauses a recurring rule.', s.obj({ ruleId: s.id('recurring rule'), active: s.bool() }, ['ruleId', 'active']), true),
  op('recurring_delete', 'recurring', 'destructive', 'Delete occurrences / series',
    'Deletes one occurrence, this-and-future, or the whole series. Requires confirm: true.',
    s.obj({ ruleId: s.id('recurring rule'), occurrenceDate: s.date(), scope: s.enum(SERIES_SCOPE), confirm }, ['ruleId', 'occurrenceDate', 'scope', 'confirm']), true),

  /* ---------------- Planning ---------------- */
  op('plan_preview', 'planning', 'read', 'Preview auto-plan',
    'Runs the rule-based Auto Plan for one or more days WITHOUT saving: proposed blocks for open tasks, unplaced tasks and why.',
    s.obj({ from: s.date('Defaults to today.'), days: s.int('Days to plan.', { minimum: 1, maximum: 14, default: 1 }), taskIds: s.arr(s.id('task'), 'Only these tasks.'), regenerate: s.bool('Replace this range\'s previous auto-planned (unlocked, still planned) blocks instead of only filling gaps.', { default: false }) })),
  op('plan_apply', 'planning', 'write', 'Apply auto-plan',
    'Runs Auto Plan and saves the proposed blocks (optionally only some). Undo with plan_undo_last.',
    s.obj({ from: s.date(), days: s.int(undefined, { minimum: 1, maximum: 14, default: 1 }), taskIds: s.arr(s.id('task')), regenerate: s.bool(undefined, { default: false }), acceptTaskIds: s.arr(s.id('task'), 'Only save proposals for these tasks.') })),
  op('plan_undo_last', 'planning', 'write', 'Undo last plan', 'Reverts the most recent undoable Auto Plan / reschedule run.', none),

  /* ---------------- Tasks ---------------- */
  op('tasks_list', 'tasks', 'read', 'List tasks',
    'Tasks filtered by status, due-date range, tracker, goal, tag or text; sorted and paginated.',
    s.obj({
      status: s.arr(s.enum(TASK_STATUS)), dueFrom: s.date(), dueTo: s.date(), trackerId: s.id('tracker'), goalId: s.id('goal'), tag: s.str(), search: s.str('Text in title/notes.'),
      sort: s.enum(['dueDate', 'priority', 'createdAt', 'updatedAt', 'title'] as const, 'Sort key (default dueDate).'), order: s.enum(['asc', 'desc'] as const), ...page,
    })),
  op('tasks_get', 'tasks', 'read', 'Get a task', 'One task with its scheduled blocks and history.', s.obj({ id: s.id('task') }, ['id'])),
  op('tasks_overdue', 'tasks', 'read', 'Overdue tasks', 'Open tasks whose due date has passed, most overdue first.', s.obj({ ...page })),
  op('tasks_upcoming', 'tasks', 'read', 'Upcoming tasks', 'Open tasks due in the next N days (default 7), soonest first.', s.obj({ days: s.int(undefined, { minimum: 1, maximum: 365, default: 7 }), ...page })),
  op('tasks_create', 'tasks', 'write', 'Create a task', 'Creates a task.',
    s.obj({
      title, trackerId: s.id('tracker; see trackers_list'), notes: s.text(), dueDate: s.nullableDate('Due date.'), deadlineHard: s.bool('A hard deadline cannot slip.'),
      basePriority: priority, estimatedMinutes: s.int(undefined, { minimum: 0, maximum: 10_000 }), type: s.enum(TASK_TYPE), goalId: s.id('goal'), milestoneId: s.id('milestone'),
      tags, preferredWindow: s.enum(TIME_WINDOW), intensity: s.enum(INTENSITY), flexibility: s.enum(FLEXIBILITY), status: s.enum(['inbox', 'planned'] as const),
    }, ['title', 'trackerId'])),
  op('tasks_update', 'tasks', 'write', 'Update a task', 'Edits task fields (use tasks_set_status to change status). Optimistic concurrency via expectedUpdatedAt.',
    s.obj({
      id: s.id('task'), title, notes: s.text(), dueDate: s.nullableDate(), deadlineHard: s.bool(), basePriority: priority,
      estimatedMinutes: s.int(undefined, { minimum: 0, maximum: 10_000 }), type: s.enum(TASK_TYPE), trackerId: s.id('tracker'),
      goalId: { type: ['string', 'null'] }, milestoneId: { type: ['string', 'null'] }, tags, preferredWindow: s.enum(TIME_WINDOW), intensity: s.enum(INTENSITY), flexibility: s.enum(FLEXIBILITY),
      expectedUpdatedAt,
    }, ['id']), true),
  op('tasks_set_status', 'tasks', 'write', 'Set task status', 'Changes a task\'s status through the app\'s transition rules (completing awards XP once).',
    s.obj({ id: s.id('task'), status: s.enum(TASK_STATUS), reason: s.str(undefined, { maxLength: 500 }), actualMinutes: s.int('Time actually spent, when completing.', { minimum: 0 }) }, ['id', 'status']), true),
  op('tasks_reschedule', 'tasks', 'write', 'Reschedule a task', 'Moves a task\'s due date (logged as a reschedule).', s.obj({ id: s.id('task'), dueDate: s.nullableDate(), reason: s.str() }, ['id', 'dueDate']), true),
  op('tasks_schedule_at', 'tasks', 'write', 'Put a task on the calendar', 'Creates a block for a task at a given time.', s.obj({ id: s.id('task'), start: s.dateTime(), minutes: s.int('Length; defaults to the remaining estimate.', { minimum: 5, maximum: 1440 }) }, ['id', 'start'])),
  op('tasks_delete', 'tasks', 'destructive', 'Delete a task', 'Permanently deletes a task (and its XP). Requires confirm: true.', s.obj({ id: s.id('task'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Checklists ---------------- */
  op('checklists_list', 'checklists', 'read', 'Checklists', 'Daily / weekly / monthly checklists with items and the completion state for the period containing `date`.', s.obj({ cadence: s.enum(CADENCE), date: s.date('Defaults to today.'), includeInactive: s.bool(undefined, { default: false }) })),
  op('checklists_create', 'checklists', 'write', 'Create a checklist', 'Creates a recurring checklist.',
    s.obj({ title, cadence: s.enum(CADENCE), description: s.text(), items: s.arr(s.obj({ title, doneDefinition: s.str('What counts as done.'), timing: s.str('When, e.g. "before 9am".') }, ['title']), 'Items.'), completionXP: s.int(undefined, { minimum: 0, maximum: 10_000 }), trackerId: s.id('tracker') }, ['title', 'cadence'])),
  op('checklists_update', 'checklists', 'write', 'Update a checklist', 'Edits title, description, cadence-independent fields or active state.', s.obj({ id: s.id('checklist'), title, description: s.text(), active: s.bool(), completionXP: s.int(undefined, { minimum: 0 }), expectedUpdatedAt }, ['id']), true),
  op('checklists_add_item', 'checklists', 'write', 'Add a checklist item', 'Adds an item.', s.obj({ id: s.id('checklist'), title, doneDefinition: s.str(), timing: s.str() }, ['id', 'title'])),
  op('checklists_remove_item', 'checklists', 'destructive', 'Remove a checklist item', 'Removes an item from the template. Requires confirm: true.', s.obj({ id: s.id('checklist'), itemId: s.id('item'), confirm }, ['id', 'itemId', 'confirm']), true),
  op('checklists_set_item', 'checklists', 'write', 'Check / uncheck an item',
    'Sets an item checked or unchecked for the period containing `date`. Idempotent: setting the current state is a no-op.',
    s.obj({ id: s.id('checklist'), itemId: s.id('item'), checked: s.bool(), date: s.date('Defaults to today.') }, ['id', 'itemId', 'checked']), true),
  op('checklists_delete', 'checklists', 'destructive', 'Delete a checklist', 'Deletes a checklist and its history. Requires confirm: true.', s.obj({ id: s.id('checklist'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Goals & milestones ---------------- */
  op('goals_list', 'goals', 'read', 'Goals', 'Goals with progress (0–1), milestones and status.', s.obj({ status: s.arr(s.enum(GOAL_STATUS)), trackerId: s.id('tracker'), ...page })),
  op('goals_get', 'goals', 'read', 'Get a goal', 'A goal with progress, milestones, linked tasks and recent history.', s.obj({ id: s.id('goal') }, ['id'])),
  op('goals_history', 'goals', 'read', 'Goal history', 'Logged events for a goal (completions, milestones, time), newest first.', s.obj({ id: s.id('goal'), ...page }, ['id'])),
  op('goals_create', 'goals', 'write', 'Create a goal', 'Creates a goal; optionally with milestone titles.',
    s.obj({ title, type: s.enum(GOAL_TYPE), trackerId: s.id('tracker'), description: s.text(), targetDate: s.nullableDate(), targetValue: { type: ['number', 'null'], minimum: 0 }, unit: s.str(), color: s.enum(COLORS), milestones: s.arr(title, 'Milestone titles, in order.') }, ['title', 'type', 'trackerId'])),
  op('goals_update', 'goals', 'write', 'Update a goal', 'Edits a goal, including status (active / paused / completed / abandoned).',
    s.obj({ id: s.id('goal'), title, description: s.text(), status: s.enum(GOAL_STATUS), targetDate: s.nullableDate(), targetValue: { type: ['number', 'null'], minimum: 0 }, unit: s.str(), color: s.enum(COLORS), expectedUpdatedAt }, ['id']), true),
  op('goals_delete', 'goals', 'destructive', 'Delete a goal', 'Deletes a goal and its milestones (tasks are kept, unlinked). Requires confirm: true.', s.obj({ id: s.id('goal'), confirm }, ['id', 'confirm']), true),
  op('milestones_create', 'goals', 'write', 'Add a milestone', 'Adds a milestone to a goal.', s.obj({ goalId: s.id('goal'), title, targetDate: s.nullableDate(), weight: s.num(undefined, { minimum: 0, maximum: 100 }) }, ['goalId', 'title'])),
  op('milestones_update', 'goals', 'write', 'Update a milestone', 'Edits a milestone.', s.obj({ id: s.id('milestone'), title, targetDate: s.nullableDate(), weight: s.num(undefined, { minimum: 0, maximum: 100 }) }, ['id']), true),
  op('milestones_set_done', 'goals', 'write', 'Complete / reopen a milestone', 'Sets a milestone done or not done (banks or revokes its XP). Idempotent.', s.obj({ id: s.id('milestone'), done: s.bool() }, ['id', 'done']), true),
  op('milestones_delete', 'goals', 'destructive', 'Delete a milestone', 'Requires confirm: true.', s.obj({ id: s.id('milestone'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Achievements, XP, rewards ---------------- */
  op('achievements_list', 'progress', 'read', 'Achievements', 'Every achievement with live progress and unlock date.', s.obj({ unlocked: s.bool('Only unlocked (true) / locked (false).'), category: s.str(), ...page })),
  op('xp_get', 'progress', 'read', 'Level & XP', 'Level, XP to next level, streak, and recent XP transactions.', s.obj({ recent: s.int(undefined, { minimum: 0, maximum: 200, default: 20 }) })),
  op('rewards_list', 'progress', 'read', 'Rewards', 'Rewards with their conditions / costs, current balance and earnings.', none),
  op('rewards_redeem', 'progress', 'write', 'Redeem a reward', 'Spends reward currency on a redeemable reward.', s.obj({ id: s.id('reward') }, ['id'])),
  op('achievements_create', 'progress', 'write', 'Create / redefine an achievement',
    'Creates a custom achievement, or redefines one with the same key (its progress and unlock state are kept). It unlocks only from real activity, measured by `condition`: a condition tree whose leaves are { id, type: "leaf", metric, operator: ">=", value, window: { kind: "all_time" } } and whose groups are { id, type: "and"|"or", children }. Metrics include minutes:<trackerIds>, sessions:<trackerIds>, days:<trackerIds>, streak:<trackerIds>, units:<trackerIds>, goals:<trackerIds>, allDays:<a,b>, sameWeek:<a,b>, windowDays:<fromMin-toMin>, perfectDays, perfectWeeks, scheduleStreak, comebacks, totalXP, longestStreak, reviews:daily|weekly, checklists:daily|weekly|monthly|*, events:<activityType>, earned:*, papers:*. See achievements_list for existing keys.',
    s.obj({ key: s.str('Stable key (a-z, 0-9, _).', { pattern: '^[a-z0-9_]+$', maxLength: 80 }), title, description: s.text(), category: s.enum(ACH_CATEGORY), target: s.num('Target value shown on the progress bar.', { minimum: 1 }), xpReward: s.int('XP awarded once on unlock.', { minimum: 0, maximum: 100000 }), tier: s.enum([1, 2, 3] as const), unit: s.str('Unit label, e.g. "minutes".'), condition: { type: 'object', description: 'Condition tree (see description).' } }, ['key', 'title', 'description', 'category', 'target', 'xpReward', 'condition']), true),
  op('rewards_create', 'progress', 'write', 'Create a reward',
    'Creates a reward. kind "redeemable": a treat bought with reward currency (earned 1:1 from XP by default) at `cost`. kind "condition": earned automatically when `condition` (same tree format as achievements_create) is met, `repeat` times.',
    s.obj({ name: title, description: s.text(), kind: { ...s.enum(['redeemable', 'condition'] as const), default: 'redeemable' }, cost: s.int('Price for redeemable rewards.', { minimum: 1 }), treat: s.str(), xpValue: s.int(undefined, { minimum: 0 }), repeat: s.enum(['once', 'daily', 'weekly', 'monthly'] as const), condition: { type: 'object' } }, ['name'])),

  /* ---------------- Projects ---------------- */
  op('projects_list', 'projects', 'read', 'Projects', 'Projects with status, health and progress.', s.obj({ status: s.arr(s.enum(PROJECT_STATUS)), ...page })),
  op('projects_get', 'projects', 'read', 'Get a project', 'A project with milestones, tasks, deliverables, progress and recent history.', s.obj({ id: s.id('project') }, ['id'])),
  op('projects_create', 'projects', 'write', 'Create a project', 'Creates a project (and its backing goal).',
    s.obj({ title, summary: s.text(), kind: s.enum(PROJECT_KIND), status: s.enum(PROJECT_STATUS), trackerId: s.id('tracker'), startDate: s.nullableDate(), targetDate: s.nullableDate(), definitionOfDone: s.text(), milestones: s.arr(title), deliverables: s.arr(title), repoUrl: s.str(), demoUrl: s.str() }, ['title'])),
  op('projects_update', 'projects', 'write', 'Update a project', 'Edits a project, including its status (shipping logs an event).',
    s.obj({ id: s.id('project'), title, summary: s.text(), kind: s.enum(PROJECT_KIND), status: s.enum(PROJECT_STATUS), startDate: s.nullableDate(), targetDate: s.nullableDate(), definitionOfDone: s.text(), repoUrl: s.str(), demoUrl: s.str(), expectedUpdatedAt }, ['id']), true),
  op('projects_add_task', 'projects', 'write', 'Add a project task', 'Adds a task to a project (optionally under a milestone).', s.obj({ id: s.id('project'), title, milestoneId: s.id('milestone'), estimatedMinutes: s.int(undefined, { minimum: 0 }), dueDate: s.nullableDate() }, ['id', 'title'])),
  op('projects_add_deliverable', 'projects', 'write', 'Add a deliverable', 'Adds a deliverable.', s.obj({ id: s.id('project'), title }, ['id', 'title'])),
  op('projects_set_deliverable', 'projects', 'write', 'Tick a deliverable', 'Sets a deliverable done or not done. Idempotent.', s.obj({ id: s.id('project'), deliverableId: s.id('deliverable'), done: s.bool() }, ['id', 'deliverableId', 'done']), true),
  op('projects_delete', 'projects', 'destructive', 'Delete a project', 'Deletes a project. Requires confirm: true.', s.obj({ id: s.id('project'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Skills ---------------- */
  op('skills_list', 'skills', 'read', 'Skills', 'Skills with level, target, gap, learning path and evidence.', s.obj({ category: s.str() })),
  op('skills_create', 'skills', 'write', 'Create a skill', 'Adds a skill.', s.obj({ name: title, category: s.str(), level: s.int(undefined, { minimum: 0, maximum: 5 }), targetLevel: s.int(undefined, { minimum: 0, maximum: 5 }), trackerId: s.id('tracker'), notes: s.text() }, ['name'])),
  op('skills_update', 'skills', 'write', 'Update a skill', 'Edits a skill.', s.obj({ id: s.id('skill'), name: title, category: s.str(), targetLevel: s.int(undefined, { minimum: 0, maximum: 5 }), notes: s.text(), expectedUpdatedAt }, ['id']), true),
  op('skills_set_level', 'skills', 'write', 'Set skill level', 'Sets the current level (0–5).', s.obj({ id: s.id('skill'), level: s.int(undefined, { minimum: 0, maximum: 5 }) }, ['id', 'level']), true),
  op('skills_add_evidence', 'skills', 'write', 'Add skill evidence', 'Records proof of a skill (lab, write-up, project, certificate).', s.obj({ id: s.id('skill'), title, kind: s.enum(['lab', 'project', 'course', 'certificate', 'problem_set', 'writeup', 'assessment', 'other'] as const), date: s.date(), url: s.str(), note: s.str() }, ['id', 'title', 'kind'])),
  op('skills_add_path_item', 'skills', 'write', 'Add a learning-path step', 'Adds a step to the learning path.', s.obj({ id: s.id('skill'), title }, ['id', 'title'])),
  op('skills_set_path_item', 'skills', 'write', 'Tick a learning-path step', 'Sets a learning-path step done / not done. Idempotent.', s.obj({ id: s.id('skill'), itemId: s.id('path item'), done: s.bool() }, ['id', 'itemId', 'done']), true),
  op('skills_delete', 'skills', 'destructive', 'Delete a skill', 'Requires confirm: true.', s.obj({ id: s.id('skill'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Earning (CRM + money) ---------------- */
  op('earning_summary', 'earning', 'read', 'Earning summary', 'Revenue, expenses, profit, outstanding invoices, pipeline and per-month figures for a date range.', s.obj({ from: s.date(), to: s.date(), currency: s.str('ISO code; defaults to the app currency.') }, ['from', 'to'])),
  op('contacts_list', 'earning', 'read', 'Clients & leads', 'Contacts (leads, prospects, clients) with stage, deal value and next follow-up.', s.obj({ stage: s.arr(s.enum(CONTACT_STAGE)), followUpDue: s.bool('Only those with a follow-up due today or earlier.'), search: s.str(), ...page })),
  op('contacts_create', 'earning', 'write', 'Add a contact / lead', 'Creates a contact.', s.obj({ name: title, company: s.str(), email: s.str(), phone: s.str(), website: s.str(), source: s.str(), stage: s.enum(CONTACT_STAGE), dealValue: s.num(undefined, { minimum: 0 }), service: s.str(), nextFollowUp: s.nullableDate(), tags, notes: s.text() }, ['name'])),
  op('contacts_update', 'earning', 'write', 'Update a contact', 'Edits a contact (use contacts_set_stage for pipeline moves).', s.obj({ id: s.id('contact'), name: title, company: s.str(), email: s.str(), phone: s.str(), website: s.str(), source: s.str(), dealValue: s.num(undefined, { minimum: 0 }), service: s.str(), nextFollowUp: s.nullableDate(), tags, notes: s.text(), expectedUpdatedAt }, ['id']), true),
  op('contacts_set_stage', 'earning', 'write', 'Move in pipeline', 'Moves a contact to a pipeline stage (logged).', s.obj({ id: s.id('contact'), stage: s.enum(CONTACT_STAGE), note: s.str() }, ['id', 'stage']), true),
  op('contacts_log_interaction', 'earning', 'write', 'Log an interaction', 'Records a call / email / meeting / proposal and optionally the next follow-up.', s.obj({ id: s.id('contact'), kind: s.enum(INTERACTION_KIND), summary: s.str(undefined, { minLength: 1, maxLength: 2000 }), nextFollowUp: s.nullableDate() }, ['id', 'kind', 'summary'])),
  op('contacts_delete', 'earning', 'destructive', 'Delete a contact', 'Requires confirm: true.', s.obj({ id: s.id('contact'), confirm }, ['id', 'confirm']), true),
  op('money_list', 'earning', 'read', 'Money entries', 'Income and expense entries with payments and balance due.', s.obj({ from: s.date(), to: s.date(), direction: s.enum(MONEY_DIRECTION), status: s.arr(s.enum(MONEY_STATUS)), contactId: s.id('contact'), projectId: s.id('project'), ...page })),
  op('money_add', 'earning', 'write', 'Add income / expense', 'Records an income (invoice, expected payment) or expense.',
    s.obj({ date: s.date(), direction: s.enum(MONEY_DIRECTION), amount: s.num(undefined, { minimum: 0 }), currency: s.str(), category: s.str(undefined, { minLength: 1 }), description: s.str(), status: s.enum(MONEY_STATUS), stream: s.enum(['active', 'passive'] as const), dueDate: s.nullableDate(), contactId: s.id('contact'), projectId: s.id('project'), hours: s.num(undefined, { minimum: 0 }), invoiceNumber: s.str() }, ['date', 'direction', 'amount', 'category'])),
  op('money_update', 'earning', 'write', 'Update a money entry', 'Edits an entry.', s.obj({ id: s.id('money entry'), date: s.date(), amount: s.num(undefined, { minimum: 0 }), category: s.str(), description: s.str(), status: s.enum(MONEY_STATUS), dueDate: s.nullableDate(), contactId: { type: ['string', 'null'] }, projectId: { type: ['string', 'null'] }, hours: s.num(undefined, { minimum: 0 }), invoiceNumber: s.str(), expectedUpdatedAt }, ['id']), true),
  op('money_record_payment', 'earning', 'write', 'Record a (partial) payment', 'Records an instalment against an entry; settles it when fully paid. Overpayment is refused.', s.obj({ id: s.id('money entry'), amount: s.num(undefined, { minimum: 0.01 }), date: s.date(), method: s.str(), note: s.str() }, ['id', 'amount'])),
  op('money_delete_payment', 'earning', 'destructive', 'Remove a payment', 'Requires confirm: true.', s.obj({ id: s.id('money entry'), paymentId: s.id('payment'), confirm }, ['id', 'paymentId', 'confirm']), true),
  op('money_mark_paid', 'earning', 'write', 'Mark fully paid', 'Records the remaining balance as paid.', s.obj({ id: s.id('money entry'), date: s.date() }, ['id']), true),
  op('money_delete', 'earning', 'destructive', 'Delete a money entry', 'Requires confirm: true.', s.obj({ id: s.id('money entry'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Research ---------------- */
  op('studies_list', 'research', 'read', 'Research studies', 'Studies with stage, progress, themes and source counts.', s.obj({ stage: s.arr(s.enum(STUDY_STAGE)) })),
  op('studies_get', 'research', 'read', 'Get a study', 'A study with protocol, manuscript sections, themes (with evidence counts), thin-evidence gaps and its sources.', s.obj({ id: s.id('study') }, ['id'])),
  op('studies_create', 'research', 'write', 'Create a study', 'Creates a literature review / paper / experiment (and its backing goal).', s.obj({ title, kind: s.enum(STUDY_KIND), question: s.text(), targetDate: s.nullableDate(), themes: s.arr(s.str()), sections: s.arr(title, 'Manuscript section titles.') }, ['title', 'kind'])),
  op('studies_update', 'research', 'write', 'Update a study', 'Edits a study: stage, question, search strategy, target, venue, themes, notes.', s.obj({ id: s.id('study'), title, stage: s.enum(STUDY_STAGE), question: s.text(), scope: s.text(), searchStrategy: s.text(), targetDate: s.nullableDate(), venue: s.str(), themes: s.arr(s.str()), notes: s.text(), expectedUpdatedAt }, ['id']), true),
  op('studies_set_section', 'research', 'write', 'Update a manuscript section', 'Adds (no sectionId) or updates a manuscript section: status, words, target words.', s.obj({ id: s.id('study'), sectionId: s.id('section'), title, status: s.enum(['todo', 'outline', 'draft', 'revised', 'done'] as const), words: s.int(undefined, { minimum: 0 }), targetWords: s.int(undefined, { minimum: 0 }) }, ['id']), false),
  op('studies_delete', 'research', 'destructive', 'Delete a study', 'Sources stay in the library. Requires confirm: true.', s.obj({ id: s.id('study'), confirm }, ['id', 'confirm']), true),
  op('sources_list', 'research', 'read', 'Source library', 'Sources (papers, articles) with status, relevance, extraction fields and themes.', s.obj({ studyId: s.id('study'), status: s.arr(s.enum(SOURCE_STATUS)), theme: s.str(), search: s.str(), ...page })),
  op('sources_create', 'research', 'write', 'Add a source', 'Adds a source. Pass `reference` (APA/MLA text or DOI) to have fields parsed, or fields directly.',
    s.obj({ reference: s.text('A formatted reference or DOI to parse.'), title, authors: s.str(), year: s.int(undefined, { minimum: 1000, maximum: 3000 }), venue: s.str(), doi: s.str(), url: s.str(), studyIds: s.arr(s.id('study')), status: s.enum(SOURCE_STATUS), relevance: s.int(undefined, { minimum: 1, maximum: 5 }), themes: s.arr(s.str()), notes: s.text() })),
  op('sources_update', 'research', 'write', 'Update a source', 'Edits a source, including the literature-matrix fields (method, sample, findings, limitations).', s.obj({ id: s.id('source'), title, authors: s.str(), year: s.int(), venue: s.str(), doi: s.str(), url: s.str(), studyIds: s.arr(s.id('study')), status: s.enum(SOURCE_STATUS), relevance: s.int(undefined, { minimum: 1, maximum: 5 }), method: s.text(), sample: s.text(), findings: s.text(), limitations: s.text(), themes: s.arr(s.str()), notes: s.text(), expectedUpdatedAt }, ['id']), true),
  op('sources_delete', 'research', 'destructive', 'Delete a source', 'Requires confirm: true.', s.obj({ id: s.id('source'), confirm }, ['id', 'confirm']), true),

  /* ---------------- Exams ---------------- */
  op('exams_list', 'exams', 'read', 'Exam tracks', 'Exam tracks (SAT, AP, …) with their scores.', none),
  op('exams_add_score', 'exams', 'write', 'Add a score', 'Records a practice or real score on an exam track.', s.obj({ trackId: s.id('exam track'), date: s.date(), label: s.str('e.g. "Practice test 4".', { minLength: 1 }), kind: s.enum(['practice', 'mock', 'official'] as const), total: s.num('Total score; computed from sections when omitted.'), sections: { type: 'object', additionalProperties: { type: 'number' }, description: 'Section scores keyed by the track\'s section IDs (see exams_list).' }, notes: s.text() }, ['trackId', 'date', 'label', 'kind'])),

  /* ---------------- Habits ---------------- */
  op('habits_list', 'habits', 'read', 'Habits', 'Habits with today\'s status and streaks.', s.obj({ date: s.date() })),
  op('habits_check_in', 'habits', 'write', 'Check in a habit', 'Records a habit check-in for today.', s.obj({ id: s.id('habit'), value: s.num(), minutes: s.int(undefined, { minimum: 0 }), notes: s.str() }, ['id'])),
  op('habits_undo_check_in', 'habits', 'write', 'Undo a check-in', 'Removes the check-in for a date.', s.obj({ id: s.id('habit'), date: s.date() }, ['id']), true),

  /* ---------------- Focus ---------------- */
  op('focus_sessions', 'focus', 'read', 'Focus sessions', 'Focus / timer sessions in a range with totals.', s.obj({ from: s.date(), to: s.date(), ...page }, ['from', 'to'])),
  op('focus_status', 'focus', 'read', 'Running timer', 'The timer running in the app right now, if any.', none),

  /* ---------------- Analytics ---------------- */
  op('analytics_summary', 'analytics', 'read', 'Productivity analytics',
    'Completion rates, planned vs actual time, time allocation by area, streaks, focus and XP for a range.',
    s.obj({ from: s.date(), to: s.date() }, ['from', 'to'])),
  op('analytics_time_allocation', 'analytics', 'read', 'Time allocation', 'Tracked minutes per area (and sub-area) in a range.', s.obj({ from: s.date(), to: s.date(), rollup: s.bool('Roll sub-trackers up to their top-level area.', { default: true }) }, ['from', 'to'])),
  op('analytics_streaks', 'analytics', 'read', 'Streaks', 'Current and longest streak, and active days in the last N days.', s.obj({ days: s.int(undefined, { minimum: 7, maximum: 366, default: 30 }) })),
  op('analytics_daily_review', 'analytics', 'read', 'Daily review', 'The metrics behind Close-the-day for a date.', s.obj({ date: s.date() })),
  op('analytics_weekly_review', 'analytics', 'read', 'Weekly review', 'Weekly review metrics for a Mon–Sun range.', s.obj({ from: s.date(), to: s.date() }, ['from', 'to'])),
  op('activity_list', 'analytics', 'read', 'Activity log', 'The append-only log of real events (completions, sessions, payments…), newest first.', s.obj({ from: s.date(), to: s.date(), type: s.arr(s.str()), ...page })),

  /* ---------------- Settings ---------------- */
  op('settings_get', 'settings', 'read', 'Settings', 'User-facing settings: theme, interface mode, background, week start, notifications, dashboard layout.', none),
  op('settings_update', 'settings', 'write', 'Update settings', 'Updates supported settings.',
    s.obj({ theme: s.enum(THEME), mode: s.enum(['simple', 'advanced'] as const, 'Interface mode (simple hides power-user options).'), background: s.enum(['galaxy', 'still', 'off'] as const, 'Animated background.'), weekStartsOn: s.enum([0, 1] as const, '0 = Sunday, 1 = Monday.') }), true),
  op('notifications_get_prefs', 'settings', 'read', 'Notification preferences', 'Reminder settings (lead time, which reminders), in-app banner categories, quiet hours, desktop and sound preferences.', none),
  op('notifications_update_prefs', 'settings', 'write', 'Update notification preferences', 'Updates reminder settings.',
    s.obj({ enabled: s.bool('Desktop reminders on/off.'), leadMinutes: s.int(undefined, { minimum: 0, maximum: 120 }), blockStart: s.bool(), taskDue: s.bool(), revisionDue: s.bool(), dailyReviewHour: s.int(undefined, { minimum: 0, maximum: 23 }) }), true),
  op('trackers_list', 'settings', 'read', 'Areas & subjects', 'Trackers (areas, subjects) — the IDs used by blocks, tasks and goals.', s.obj({ includeArchived: s.bool(undefined, { default: false }) })),
  op('trackers_create', 'settings', 'write', 'Create an area / subject', 'Adds a tracker (area or subject), optionally under a parent tracker. A tracker with the same name under the same parent is returned instead of duplicated.',
    s.obj({ name: title, pillar: s.enum(PILLARS), parentId: { type: ['string', 'null'], maxLength: 128, description: 'ID of the parent tracker, or null for a top-level area.' }, color: s.enum(COLORS), weeklyTargetMinutes: s.int(undefined, { minimum: 0, maximum: 10080 }) }, ['name', 'pillar']), true),

  /* ---------------- System ---------------- */
  op('system_info', 'system', 'read', 'App info', 'App version, schema version, record counts and the agent\'s permission level.', none),
  op('audit_log', 'system', 'read', 'Agent audit log', 'Recent agent-performed operations with outcome, newest first.', s.obj({ ...page, op: s.str('Filter by operation name.') })),
];

export const OPERATION_BY_NAME: ReadonlyMap<string, OperationDef> = new Map(OPERATIONS.map((o) => [o.name, o]));

/** Machine-readable error codes returned by every interface. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'Input did not match the operation schema.',
  NOT_FOUND: 'The referenced record does not exist.',
  CONFLICT: 'The record changed since you read it (expectedUpdatedAt mismatch), or the change conflicts with its state.',
  INVALID_STATE: 'The record is in a state that does not allow this operation.',
  CONFIRMATION_REQUIRED: 'Destructive operation called without confirm: true.',
  PERMISSION_DENIED: 'The agent permission level does not allow this operation.',
  UNKNOWN_OPERATION: 'No operation with that name.',
  APP_NOT_CONNECTED: 'No LifeOS window is connected to the agent server. Open LifeOS and enable Agent access in Settings.',
  TIMEOUT: 'The app did not answer in time.',
  UNAUTHORIZED: 'Missing or wrong bearer token.',
  INTERNAL_ERROR: 'Unexpected failure inside the app.',
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export type AgentResult<T = unknown> =
  | { ok: true; data: T; meta?: { total?: number; limit?: number; offset?: number; [k: string]: unknown } }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export type PermissionLevel = 'read' | 'write' | 'full';
export function permits(level: PermissionLevel, kind: OperationKind): boolean {
  if (kind === 'read') return true;
  if (kind === 'write') return level === 'write' || level === 'full';
  return level === 'full';
}

/** Protocol version of the browser ⇄ server bridge. */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_AGENT_PORT = 7457;
