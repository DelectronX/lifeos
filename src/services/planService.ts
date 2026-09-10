import { db, tableByName } from '@/db/db';
import { newId } from '@/lib/id';
import { MINUTE_MS, addDaysToKey, todayKey, toDateKey } from '@/lib/date';
import { getSchedulingConfig, getSettings } from './settingsService';
import { logActivity } from './activityService';
import { planSchedule, type PlanScheduleResult } from '@/engines/scheduling';
import {
  autoReschedule, buildRescheduleOptions, computeRemainingWork, detectOverload,
  type AutoRescheduleResult, type OverloadReport, type RescheduleOption, type RescheduleProposal,
} from '@/engines/rescheduling';
import { resolveConflicts, type ConflictResolutionResult, type ConflictStrategy } from '@/engines/conflictResolution';
import { suggestDurationForTask, type DurationPrediction } from '@/engines/durationPrediction';
import type {
  DateKey, ID, PlanRun, RecordChange, ScheduleBlock, SchedulingConfig,
  Settings, Task,
} from '@/types';
import type { ProposedBlock, SchedulingPreferences } from '@/types/scheduling';

/**
 * PlanService — the persistence half of the scheduling intelligence.
 *
 * The engines in `src/engines/` are pure: they read a snapshot of the world and
 * return PROPOSALS. Nothing in this app writes an engine's output to Dexie
 * except this module, and it always does three things at once:
 *
 *   1. capture a `before` snapshot of every affected row,
 *   2. apply the change inside a single Dexie transaction,
 *   3. store a PlanRun holding the human-readable explanation and the exact
 *      change list, so `undoPlanRun` can restore the previous state verbatim.
 *
 * Consequences that matter for the UI: every automated change is explainable
 * and reversible, and nothing ever happens without the user pressing a button.
 */

/* ------------------------------------------------------------------ */
/* Shared context                                                      */
/* ------------------------------------------------------------------ */

export interface PlanContext {
  config: SchedulingConfig;
  preferences: SchedulingPreferences;
  settings: Settings;
  tasks: Task[];
  blocks: ScheduleBlock[];
  now: Date;
  from: DateKey;
  to: DateKey;
}

/** Reads everything the engines need for a horizon starting at `from`. */
export async function loadPlanContext(options: {
  from?: DateKey;
  days?: number;
  now?: Date;
} = {}): Promise<PlanContext> {
  const now = options.now ?? new Date();
  const config = await getSchedulingConfig();
  const settings = await getSettings();
  const from = options.from ?? toDateKey(now);
  const days = options.days ?? config.slots.horizonDays;
  const to = addDaysToKey(from, Math.max(0, days - 1));

  // Range-scan the [date+start] index rather than loading the whole table:
  // this stays O(days) with years of history behind it.
  const blocks = await db.blocks
    .where('[date+start]')
    .between([from, -Infinity], [to, Infinity])
    .sortBy('start');

  const tasks = await db.tasks
    .where('status')
    .anyOf('inbox', 'planned', 'in_progress', 'rescheduled', 'skipped')
    .toArray();

  return {
    config,
    settings,
    preferences: preferencesFrom(settings),
    tasks,
    blocks,
    now,
    from,
    to,
  };
}

export function preferencesFrom(settings: Settings): SchedulingPreferences {
  return {
    workingHours: settings.workingHours,
    focusHours: settings.focusHours ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Change recording                                                    */
/* ------------------------------------------------------------------ */

/**
 * Accumulates before/after pairs while a plan is applied. The `before` values
 * are deep-cloned at capture time so a later mutation of the same object can
 * never corrupt the undo record.
 */
class ChangeSet {
  readonly changes: RecordChange[] = [];

  create(table: string, id: ID, after: unknown): void {
    this.changes.push({ table, id, op: 'create', before: null, after: clone(after) });
  }

  update(table: string, id: ID, before: unknown, after: unknown): void {
    this.changes.push({ table, id, op: 'update', before: clone(before), after: clone(after) });
  }

  remove(table: string, id: ID, before: unknown): void {
    this.changes.push({ table, id, op: 'delete', before: clone(before), after: null });
  }

  get size(): number {
    return this.changes.length;
  }
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/* Materialising proposals                                             */
/* ------------------------------------------------------------------ */

function materialise(p: ProposedBlock, planRunId: ID, now: number): ScheduleBlock {
  return {
    id: newId('blk'),
    createdAt: now,
    updatedAt: now,
    title: p.title,
    date: p.date,
    start: p.start,
    end: p.end,
    trackerId: p.trackerId,
    kind: p.kind,
    taskId: p.taskId,
    goalId: p.goalId,
    resourceId: null,
    status: 'planned',
    locked: p.locked,
    protected: p.protected,
    origin: p.origin,
    planRunId,
    splitGroupId: p.splitGroupId,
    splitIndex: p.splitIndex,
    splitCount: p.splitCount,
    actualStart: null,
    actualEnd: null,
    notes: p.reason,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Auto-plan a day / range                                          */
/* ------------------------------------------------------------------ */

export interface AutoPlanPreview {
  /** Engine output, unchanged. */
  result: PlanScheduleResult;
  context: PlanContext;
  /** Blocks that already exist on the affected days, for the "current plan". */
  existingBlocks: ScheduleBlock[];
  /** Total minutes this plan would add. */
  proposedMinutes: number;
  /** Days the plan would touch. */
  dates: DateKey[];
  /** One-line human summary shown at the top of the preview. */
  summary: string;
}

export interface AutoPlanOptions {
  /** Defaults to today. */
  from?: DateKey;
  /** Number of days to plan across. 1 = "plan my day". */
  days?: number;
  /** Restrict planning to these tasks. Defaults to every open task. */
  taskIds?: readonly ID[];
  now?: Date;
}

/**
 * Runs the scheduling engine and returns a preview. NOTHING is written — the
 * caller shows the preview and calls `applyAutoPlan` only if the user accepts.
 */
export async function previewAutoPlan(options: AutoPlanOptions = {}): Promise<AutoPlanPreview> {
  const days = options.days ?? 1;
  const context = await loadPlanContext({ from: options.from, days, now: options.now });

  const pool = options.taskIds
    ? context.tasks.filter((t) => options.taskIds!.includes(t.id))
    : context.tasks;

  // A task that already has planned time on the horizon is not re-planned;
  // auto-plan fills gaps, it does not silently rebuild what the user arranged.
  const alreadyScheduled = new Set(
    context.blocks
      .filter((b) => b.taskId && (b.status === 'planned' || b.status === 'in_progress'))
      .map((b) => b.taskId!),
  );
  const candidates = pool.filter((t) => !alreadyScheduled.has(t.id));

  const goals = await db.goals.toArray();

  const result = planSchedule(
    {
      tasks: candidates,
      blocks: context.blocks,
      goals,
      preferences: context.preferences,
      now: context.now,
      from: context.from,
      to: context.to,
      runId: 'autoplan',
    },
    context.config,
  );

  const dates = [...new Set(result.proposals.map((p) => p.date))].sort();
  const proposedMinutes = result.proposals.reduce((s, p) => s + p.durationMinutes, 0);

  return {
    result,
    context,
    existingBlocks: context.blocks,
    proposedMinutes,
    dates,
    summary: buildPlanSummary(result, proposedMinutes, dates, days),
  };
}

function buildPlanSummary(
  result: PlanScheduleResult,
  minutes: number,
  dates: DateKey[],
  days: number,
): string {
  if (result.placements.length === 0) {
    return result.unplaced.length > 0
      ? `Nothing could be placed: all ${result.unplaced.length} candidate task${result.unplaced.length === 1 ? '' : 's'} were blocked. See the reasons below.`
      : 'There is nothing left to plan — every open task already has time on the calendar.';
  }
  const span = dates.length <= 1
    ? (dates[0] ?? 'today')
    : `${dates[0]} to ${dates[dates.length - 1]}`;
  const unplaced = result.unplaced.length > 0
    ? ` ${result.unplaced.length} task${result.unplaced.length === 1 ? '' : 's'} could not be placed.`
    : '';
  return `${result.placements.length} task${result.placements.length === 1 ? '' : 's'} placed into ${result.proposals.length} block${result.proposals.length === 1 ? '' : 's'} (${minutes} min) across ${span}${days > 1 ? '' : ''}.${unplaced}`;
}

export interface ApplyResult {
  planRunId: ID;
  created: number;
  updated: number;
  deleted: number;
  explanation: string[];
}

/**
 * Persists an accepted auto-plan. `acceptedTempIds` lets the user drop
 * individual proposals in the preview before accepting ("Edit").
 */
export async function applyAutoPlan(
  preview: AutoPlanPreview,
  acceptedTempIds?: readonly string[],
): Promise<ApplyResult> {
  const accepted = acceptedTempIds
    ? preview.result.proposals.filter((p) => acceptedTempIds.includes(p.tempId))
    : preview.result.proposals;

  if (accepted.length === 0) {
    return { planRunId: '', created: 0, updated: 0, deleted: 0, explanation: [] };
  }

  const now = Date.now();
  const planRunId = newId('run');
  const set = new ChangeSet();
  const blocks = accepted.map((p) => materialise(p, planRunId, now));

  const touchedTaskIds = [...new Set(accepted.map((p) => p.taskId).filter((x): x is ID => !!x))];

  await db.transaction('rw', [db.blocks, db.tasks, db.planRuns], async () => {
    for (const block of blocks) {
      await db.blocks.add(block);
      set.create('blocks', block.id, block);
    }
    for (const taskId of touchedTaskIds) {
      const task = await db.tasks.get(taskId);
      if (!task) continue;
      if (task.status === 'planned') continue;
      const after: Task = {
        ...task,
        status: 'planned',
        updatedAt: now,
        statusHistory: [
          ...task.statusHistory,
          { from: task.status, to: 'planned', at: now, reason: 'Auto-planned', planRunId },
        ],
      };
      await db.tasks.put(after);
      set.update('tasks', task.id, task, after);
    }

    const explanation = buildAutoPlanExplanation(preview, accepted);
    const run: PlanRun = {
      id: planRunId,
      createdAt: now,
      updatedAt: now,
      kind: 'auto_schedule',
      at: now,
      explanation,
      changes: set.changes,
      undone: false,
      undoneAt: null,
    };
    await db.planRuns.add(run);
  });

  await logActivity({
    type: 'task_rescheduled',
    title: `Auto-planned ${accepted.length} block${accepted.length === 1 ? '' : 's'}`,
    at: now,
    meta: { planRunId, kind: 'auto_schedule', blocks: accepted.length },
  });

  const run = await db.planRuns.get(planRunId);
  return {
    planRunId,
    created: blocks.length,
    updated: touchedTaskIds.length,
    deleted: 0,
    explanation: run?.explanation ?? [],
  };
}

function buildAutoPlanExplanation(
  preview: AutoPlanPreview,
  accepted: readonly ProposedBlock[],
): string[] {
  const acceptedIds = new Set(accepted.map((p) => p.tempId));
  const lines: string[] = [preview.summary];
  for (const placement of preview.result.placements) {
    const kept = placement.blocks.filter((b) => acceptedIds.has(b.tempId));
    if (kept.length === 0) continue;
    lines.push(`${placement.title}: ${placement.reason}`);
  }
  for (const u of preview.result.unplaced) {
    lines.push(`Not placed — ${u.title}: ${u.reason}`);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* 2. Reschedule one task                                              */
/* ------------------------------------------------------------------ */

export interface ReschedulePreview {
  proposal: RescheduleProposal;
  context: PlanContext;
  task: Task;
  /** Blocks currently holding this task's time; applying releases them. */
  releaseBlocks: ScheduleBlock[];
}

/** Builds the option list for a task that did not happen as planned. */
export async function previewReschedule(taskId: ID, now?: Date): Promise<ReschedulePreview | null> {
  const task = await db.tasks.get(taskId);
  if (!task) return null;

  const context = await loadPlanContext({ now });
  const goals = await db.goals.toArray();

  // Only future, still-planned blocks are released; completed history stays.
  const taskBlocks = await db.blocks.where('taskId').equals(taskId).toArray();
  const releaseBlocks = taskBlocks.filter(
    (b) => b.status === 'planned' || b.status === 'in_progress',
  );

  const proposal = buildRescheduleOptions(
    {
      task,
      tasks: context.tasks,
      blocks: context.blocks,
      goals,
      preferences: context.preferences,
      now: context.now,
      releaseBlockIds: releaseBlocks.map((b) => b.id),
    },
    context.config,
  );

  return { proposal, context, task, releaseBlocks };
}

/** Applies one chosen reschedule option, transactionally and undoably. */
export async function applyRescheduleOption(
  preview: ReschedulePreview,
  option: RescheduleOption,
): Promise<ApplyResult> {
  const now = Date.now();
  const planRunId = newId('run');
  const set = new ChangeSet();
  const { task } = preview;

  const explanation: string[] = [
    `${task.title}: ${option.label}.`,
    option.explanation,
    preview.proposal.remaining.explanation,
  ];

  await db.transaction('rw', [db.blocks, db.tasks, db.planRuns], async () => {
    // 1. Release the blocks that failed.
    for (const block of preview.releaseBlocks) {
      const fresh = await db.blocks.get(block.id);
      if (!fresh) continue;
      await db.blocks.delete(fresh.id);
      set.remove('blocks', fresh.id, fresh);
    }

    // 2. Free any block we displace, and mark its task as needing a new home.
    for (const d of option.displaces) {
      const victim = await db.blocks.get(d.blockId);
      if (!victim) continue;
      await db.blocks.delete(victim.id);
      set.remove('blocks', victim.id, victim);
      explanation.push(`Displaced "${victim.title}" — ${d.reason}`);
      if (victim.taskId) {
        const vt = await db.tasks.get(victim.taskId);
        if (vt) {
          const after: Task = {
            ...vt,
            status: 'rescheduled',
            rescheduleCount: vt.rescheduleCount + 1,
            updatedAt: now,
            statusHistory: [
              ...vt.statusHistory,
              { from: vt.status, to: 'rescheduled', at: now, reason: `Displaced by "${task.title}"`, planRunId },
            ],
          };
          await db.tasks.put(after);
          set.update('tasks', vt.id, vt, after);
        }
      }
    }

    // 3. Create the new blocks.
    for (const p of option.proposedBlocks) {
      const block = materialise(p, planRunId, now);
      block.origin = 'reschedule';
      await db.blocks.add(block);
      set.create('blocks', block.id, block);
    }

    // 4. Move the task itself into the right state.
    const fresh = await db.tasks.get(task.id);
    if (fresh) {
      const to = option.strategy === 'cancel'
        ? 'cancelled' as const
        : option.proposedBlocks.length > 0 ? 'planned' as const : 'rescheduled' as const;
      const after: Task = {
        ...fresh,
        status: to,
        rescheduleCount: fresh.rescheduleCount + 1,
        updatedAt: now,
        completedAt: null,
        statusHistory: [
          ...fresh.statusHistory,
          { from: fresh.status, to, at: now, reason: option.label, planRunId },
        ],
      };
      await db.tasks.put(after);
      set.update('tasks', fresh.id, fresh, after);
    }

    const run: PlanRun = {
      id: planRunId,
      createdAt: now,
      updatedAt: now,
      kind: 'reschedule',
      at: now,
      explanation,
      changes: set.changes,
      undone: false,
      undoneAt: null,
    };
    await db.planRuns.add(run);
  });

  await logActivity({
    type: 'task_rescheduled',
    title: task.title,
    at: now,
    taskId: task.id,
    trackerId: task.trackerId,
    goalId: task.goalId,
    meta: { planRunId, strategy: option.strategy, explanation: option.explanation },
  });

  return {
    planRunId,
    created: option.proposedBlocks.length,
    updated: 1,
    deleted: preview.releaseBlocks.length + option.displaces.length,
    explanation,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Full-auto reschedule                                             */
/* ------------------------------------------------------------------ */

export interface AutoReschedulePreview {
  result: AutoRescheduleResult;
  context: PlanContext;
  tasks: Task[];
}

/** Everything that slipped: overdue, skipped, or left in progress. */
export async function findSlippedTasks(now = new Date()): Promise<Task[]> {
  const today = todayKey(now.getTime());
  const open = await db.tasks
    .where('status')
    .anyOf('planned', 'in_progress', 'skipped', 'rescheduled')
    .toArray();

  const stale = await db.blocks
    .where('date')
    .below(today)
    .filter((b) => b.status === 'planned' || b.status === 'in_progress')
    .toArray();
  const staleTaskIds = new Set(stale.map((b) => b.taskId).filter((x): x is ID => !!x));

  return open.filter(
    (t) =>
      staleTaskIds.has(t.id) ||
      t.status === 'skipped' ||
      (t.dueDate !== null && t.dueDate < today),
  );
}

export async function previewAutoReschedule(
  taskIds?: readonly ID[],
  now?: Date,
): Promise<AutoReschedulePreview> {
  const context = await loadPlanContext({ now });
  const goals = await db.goals.toArray();
  const slipped = taskIds
    ? (await db.tasks.bulkGet([...taskIds])).filter((t): t is Task => !!t)
    : await findSlippedTasks(context.now);

  const result = autoReschedule(
    {
      tasks: slipped,
      allTasks: context.tasks,
      blocks: context.blocks,
      goals,
      preferences: context.preferences,
      now: context.now,
    },
    context.config,
  );

  return { result, context, tasks: slipped };
}

/** Applies every accepted decision from a full-auto run as ONE undoable run. */
export async function applyAutoReschedule(
  preview: AutoReschedulePreview,
  acceptedTaskIds?: readonly ID[],
): Promise<ApplyResult> {
  const decisions = acceptedTaskIds
    ? preview.result.decisions.filter((d) => acceptedTaskIds.includes(d.taskId))
    : preview.result.decisions;

  if (decisions.length === 0) {
    return { planRunId: '', created: 0, updated: 0, deleted: 0, explanation: [] };
  }

  const now = Date.now();
  const planRunId = newId('run');
  const set = new ChangeSet();
  const explanation: string[] = [
    `Auto-rescheduled ${decisions.length} task${decisions.length === 1 ? '' : 's'} that had slipped.`,
  ];
  let created = 0;
  let deleted = 0;

  await db.transaction('rw', [db.blocks, db.tasks, db.planRuns], async () => {
    for (const decision of decisions) {
      const stale = await db.blocks
        .where('taskId')
        .equals(decision.taskId)
        .filter((b) => b.status === 'planned' || b.status === 'in_progress')
        .toArray();
      for (const block of stale) {
        await db.blocks.delete(block.id);
        set.remove('blocks', block.id, block);
        deleted++;
      }

      for (const p of decision.proposedBlocks) {
        const block = materialise(p, planRunId, now);
        block.origin = 'reschedule';
        await db.blocks.add(block);
        set.create('blocks', block.id, block);
        created++;
      }

      const task = await db.tasks.get(decision.taskId);
      if (task) {
        const after: Task = {
          ...task,
          status: 'planned',
          rescheduleCount: task.rescheduleCount + 1,
          updatedAt: now,
          statusHistory: [
            ...task.statusHistory,
            { from: task.status, to: 'planned', at: now, reason: decision.explanation, planRunId },
          ],
        };
        await db.tasks.put(after);
        set.update('tasks', task.id, task, after);
      }

      explanation.push(`${decision.title}: ${decision.explanation}`);
    }

    for (const n of preview.result.needsUserInput) {
      explanation.push(`Left alone — ${n.title}: ${n.reason}`);
    }

    const run: PlanRun = {
      id: planRunId,
      createdAt: now,
      updatedAt: now,
      kind: 'reschedule',
      at: now,
      explanation,
      changes: set.changes,
      undone: false,
      undoneAt: null,
    };
    await db.planRuns.add(run);
  });

  return { planRunId, created, updated: decisions.length, deleted, explanation };
}

/* ------------------------------------------------------------------ */
/* 4. Conflict resolution                                              */
/* ------------------------------------------------------------------ */

export interface ConflictPreview {
  result: ConflictResolutionResult;
  block: ScheduleBlock;
  actualEnd: number;
  dayBlocks: ScheduleBlock[];
  context: PlanContext;
}

/**
 * Called when a block overran (or the user reports it did). Produces the
 * candidate strategies with their before/after previews.
 */
export async function previewConflict(
  blockId: ID,
  actualEnd: number,
  now?: Date,
): Promise<ConflictPreview | null> {
  const block = await db.blocks.get(blockId);
  if (!block) return null;

  const context = await loadPlanContext({ from: block.date, days: 1, now });
  const dayBlocks = context.blocks.filter((b) => b.date === block.date);

  const result = resolveConflicts(
    {
      block,
      actualEnd,
      dayBlocks,
      now: context.now,
      preferences: context.preferences,
    },
    context.config,
  );

  return { result, block, actualEnd, dayBlocks, context };
}

/** Applies one conflict strategy's block changes as a single undoable run. */
export async function applyConflictStrategy(
  preview: ConflictPreview,
  strategy: ConflictStrategy,
): Promise<ApplyResult> {
  const now = Date.now();
  const planRunId = newId('run');
  const set = new ChangeSet();
  const explanation: string[] = [
    preview.result.detection.summary,
    `${strategy.label}: ${strategy.why}`,
  ];
  let updated = 0;
  let deleted = 0;

  await db.transaction('rw', [db.blocks, db.tasks, db.planRuns], async () => {
    // Record the overrun on the block itself so the day reflects reality.
    const overrun = await db.blocks.get(preview.block.id);
    if (overrun) {
      const after: ScheduleBlock = {
        ...overrun,
        end: Math.max(overrun.end, preview.actualEnd),
        actualStart: overrun.actualStart ?? overrun.start,
        actualEnd: preview.actualEnd,
        updatedAt: now,
        planRunId,
      };
      await db.blocks.put(after);
      set.update('blocks', overrun.id, overrun, after);
      updated++;
    }

    for (const change of strategy.changes) {
      if (change.action === 'unchanged') continue;
      const block = await db.blocks.get(change.blockId);
      if (!block) continue;

      if (change.to === null || change.action === 'drop') {
        // Dropped from the day: the block goes, the task returns to the queue.
        await db.blocks.delete(block.id);
        set.remove('blocks', block.id, block);
        deleted++;
        if (block.taskId) {
          const task = await db.tasks.get(block.taskId);
          if (task) {
            const after: Task = {
              ...task,
              status: 'rescheduled',
              rescheduleCount: task.rescheduleCount + 1,
              updatedAt: now,
              statusHistory: [
                ...task.statusHistory,
                { from: task.status, to: 'rescheduled', at: now, reason: change.reason, planRunId },
              ],
            };
            await db.tasks.put(after);
            set.update('tasks', task.id, task, after);
          }
        }
        explanation.push(`${block.title}: ${change.reason}`);
        continue;
      }

      const after: ScheduleBlock = {
        ...block,
        start: change.to.start,
        end: change.to.end,
        date: toDateKey(change.to.start),
        updatedAt: now,
        planRunId,
        origin: 'reschedule',
      };
      await db.blocks.put(after);
      set.update('blocks', block.id, block, after);
      updated++;
      explanation.push(`${block.title}: ${change.reason}`);

      // A split leaves a remainder that still needs a home; it becomes a new
      // block immediately after the truncated one so nothing is silently lost.
      if (change.action === 'split') {
        const leftoverMinutes = Math.round(
          ((change.from.end - change.from.start) - (change.to.end - change.to.start)) / MINUTE_MS,
        );
        if (leftoverMinutes > 0) {
          explanation.push(
            `${block.title}: ${leftoverMinutes} min carried over — reschedule the remainder from the task.`,
          );
        }
      }
    }

    const run: PlanRun = {
      id: planRunId,
      createdAt: now,
      updatedAt: now,
      kind: 'conflict_resolution',
      at: now,
      explanation,
      changes: set.changes,
      undone: false,
      undoneAt: null,
    };
    await db.planRuns.add(run);
  });

  return { planRunId, created: 0, updated, deleted, explanation };
}

/* ------------------------------------------------------------------ */
/* 5. Undo                                                             */
/* ------------------------------------------------------------------ */

export interface UndoResult {
  ok: boolean;
  planRunId: ID | null;
  restored: number;
  message: string;
}

/** Reverts one PlanRun exactly, restoring every `before` snapshot. */
export async function undoPlanRun(planRunId: ID): Promise<UndoResult> {
  const run = await db.planRuns.get(planRunId);
  if (!run) return { ok: false, planRunId: null, restored: 0, message: 'That change no longer exists.' };
  if (run.undone) {
    return { ok: false, planRunId, restored: 0, message: 'This change has already been undone.' };
  }

  const tables = [...new Set(run.changes.map((c) => c.table))]
    .map((name) => tableByName(name))
    .filter((t): t is NonNullable<ReturnType<typeof tableByName>> => t !== null);

  let restored = 0;

  await db.transaction('rw', [...tables, db.planRuns], async () => {
    // Reverse order so creates are removed before their dependants reappear.
    for (const change of [...run.changes].reverse()) {
      const table = tableByName(change.table);
      if (!table) continue;
      if (change.op === 'create') {
        await table.delete(change.id);
      } else {
        if (change.before === null || change.before === undefined) continue;
        await table.put(change.before as Record<string, unknown>);
      }
      restored++;
    }
    await db.planRuns.update(planRunId, { undone: true, undoneAt: Date.now(), updatedAt: Date.now() });
  });

  return {
    ok: true,
    planRunId,
    restored,
    message: `Reverted ${restored} change${restored === 1 ? '' : 's'}. Your schedule is back to how it was.`,
  };
}

/** The most recent run that has not been undone. */
export async function getLastUndoableRun(): Promise<PlanRun | null> {
  const runs = await db.planRuns.orderBy('at').reverse().limit(20).toArray();
  return runs.find((r) => !r.undone && r.changes.length > 0) ?? null;
}

export async function undoLastChange(): Promise<UndoResult> {
  const run = await getLastUndoableRun();
  if (!run) {
    return { ok: false, planRunId: null, restored: 0, message: 'There is nothing to undo.' };
  }
  return undoPlanRun(run.id);
}

/* ------------------------------------------------------------------ */
/* 6. Overload + duration hints                                        */
/* ------------------------------------------------------------------ */

export async function getOverloadReport(
  from?: DateKey,
  days = 7,
  now?: Date,
): Promise<OverloadReport> {
  const context = await loadPlanContext({ from, days, now });
  return detectOverload(
    {
      from: context.from,
      to: context.to,
      tasks: context.tasks,
      blocks: context.blocks,
      preferences: context.preferences,
      now: context.now,
    },
    context.config,
  );
}

/**
 * Advisory duration hint for one task. Never applied automatically — the UI
 * shows it beside the estimate and the user decides.
 */
export async function getDurationHint(taskId: ID): Promise<DurationPrediction | null> {
  const task = await db.tasks.get(taskId);
  if (!task) return null;
  const config = await getSchedulingConfig();

  // Only completed tasks carry signal, and only the recent ones matter.
  const completed = await db.tasks.where('status').equals('completed').toArray();
  const trackers = await db.trackers.toArray();
  const trackerNames = Object.fromEntries(trackers.map((t) => [t.id, t.name]));

  return suggestDurationForTask(
    task,
    {
      tasks: completed,
      subjectOf: (t) => t.topic ?? null,
      trackerNames,
    },
    config,
  );
}

/** Remaining-work summary for a task, used by the reschedule dialog header. */
export async function getRemainingWork(taskId: ID, now = new Date()) {
  const task = await db.tasks.get(taskId);
  if (!task) return null;
  const config = await getSchedulingConfig();
  const blocks = await db.blocks.where('taskId').equals(taskId).toArray();
  return computeRemainingWork({ task, blocks, now }, config);
}
