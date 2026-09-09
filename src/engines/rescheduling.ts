import type {
  DateKey, Goal, ID, RescheduleStrategy, SchedulingConfig,
  ScheduleBlock, Task, Timestamp,
} from '@/types';
import type {
  DayAvailability, ProposedBlock, SchedulingPreferences, UnplacedTask,
} from '@/types/scheduling';
import { MINUTE_MS, addDaysToKey, atMinute, diffDays, minuteOfDay, toDateKey } from '@/lib/date';
import { computeAvailability, planSchedule } from './scheduling';
import { isFinished, scoreTasks } from './priorityScoring';

/**
 * ReschedulingEngine — what to do with work that did not happen.
 *
 * Given a task that was skipped, left incomplete, overran, was only partially
 * done, or is simply overdue, it computes the *remaining* minutes and offers
 * concrete, costed options. Every option carries a human sentence in the
 * spec's voice, e.g.
 *
 *   "Move to tomorrow 4:00 PM — 45 min free after your Physics block;
 *    still 3 days before the deadline."
 *
 * The engine never writes anything. `autoReschedule` picks an option using the
 * configured strategy order; the caller decides whether to apply it.
 */

/* ------------------------------------------------------------------ */
/* Remaining work                                                      */
/* ------------------------------------------------------------------ */

export type IncompleteKind =
  | 'skipped' | 'incomplete' | 'overrun' | 'partial' | 'overdue' | 'in_progress';

export interface RemainingWork {
  taskId: ID;
  title: string;
  kind: IncompleteKind;
  estimatedMinutes: number;
  /** Minutes genuinely logged against the task. */
  completedMinutes: number;
  /** What still has to be done. Never negative. */
  remainingMinutes: number;
  /** Minutes spent beyond the estimate; 0 unless the task overran. */
  overrunMinutes: number;
  daysOverdue: number;
  explanation: string;
}

export interface RemainingWorkInput {
  task: Task;
  /** Blocks already scheduled for this task; `partial` blocks count actual time. */
  blocks?: readonly ScheduleBlock[];
  now: Date;
}

export function computeRemainingWork(input: RemainingWorkInput, config: SchedulingConfig): RemainingWork {
  const { task, now } = input;
  const today = toDateKey(now);

  // Real time = logged actualMinutes, plus any block actualStart/actualEnd not
  // yet rolled up. We take the larger of the two so we never double count.
  const blockMinutes = (input.blocks ?? [])
    .filter((b) => b.taskId === task.id && b.actualStart !== null && b.actualEnd !== null)
    .reduce((s, b) => s + (b.actualEnd! - b.actualStart!) / MINUTE_MS, 0);
  const completed = Math.max(0, Math.round(Math.max(task.actualMinutes, blockMinutes)));

  const estimated = Math.max(0, Math.round(task.estimatedMinutes));
  const remaining = Math.max(0, estimated - completed);
  const overrun = Math.max(0, completed - estimated);
  const daysOverdue = task.dueDate ? Math.max(0, -diffDays(today, task.dueDate)) : 0;

  let kind: IncompleteKind;
  if (task.status === 'skipped') kind = 'skipped';
  else if (overrun > config.rescheduling.overrunToleranceMinutes) kind = 'overrun';
  else if (completed > 0 && remaining > 0) kind = 'partial';
  else if (task.status === 'in_progress') kind = 'in_progress';
  else if (daysOverdue > 0) kind = 'overdue';
  else kind = 'incomplete';

  return {
    taskId: task.id,
    title: task.title,
    kind,
    estimatedMinutes: estimated,
    completedMinutes: completed,
    remainingMinutes: remaining,
    overrunMinutes: overrun,
    daysOverdue,
    explanation: describeRemaining(task, kind, estimated, completed, remaining, overrun, daysOverdue),
  };
}

function describeRemaining(
  task: Task, kind: IncompleteKind, estimated: number,
  completed: number, remaining: number, overrun: number, daysOverdue: number,
): string {
  const due = task.dueDate ? ` Due ${task.dueDate}${daysOverdue > 0 ? ` — ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue` : ''}.` : '';
  switch (kind) {
    case 'skipped': return `Skipped without any time logged — all ${estimated} min still to do.${due}`;
    case 'overrun': return `Ran ${overrun} min over the ${estimated} min estimate (${completed} min spent).${due}`;
    case 'partial': return `${completed} of ${estimated} min done — ${remaining} min left.${due}`;
    case 'in_progress': return `In progress: ${completed} min logged, ${remaining} min remaining.${due}`;
    case 'overdue': return `Not started and ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past its due date — ${remaining} min outstanding.${due}`;
    default: return `Not completed — ${remaining} min outstanding.${due}`;
  }
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface RescheduleOption {
  strategy: RescheduleStrategy;
  label: string;
  /** Plain-English sentence shown next to the option in the UI. */
  explanation: string;
  /** Blocks that would be created. Empty for `cancel` and `manual`. */
  proposedBlocks: ProposedBlock[];
  /** Existing blocks that would be moved/dropped to make room. */
  displaces: { blockId: ID; taskId: ID | null; title: string; reason: string }[];
  /** Minutes this option actually finds a home for. */
  coveredMinutes: number;
  /** True when the option lands the work on/before the task's due date. */
  meetsDeadline: boolean;
  /** Ranking hint, higher is better. Deterministic. */
  score: number;
  /** Set when the option cannot be offered; UI should grey it out. */
  unavailableReason?: string;
}

export interface RescheduleOptionsInput {
  task: Task;
  tasks: readonly Task[];
  blocks: readonly ScheduleBlock[];
  goals?: readonly Goal[];
  preferences: SchedulingPreferences;
  now: Date;
  /** Blocks of the failed attempt whose time should be released. */
  releaseBlockIds?: readonly ID[];
}

export interface RescheduleProposal {
  remaining: RemainingWork;
  options: RescheduleOption[];
  /** The option `autoReschedule` would take, or null if nothing works. */
  recommended: RescheduleOption | null;
}

export function buildRescheduleOptions(
  input: RescheduleOptionsInput,
  config: SchedulingConfig,
): RescheduleProposal {
  const remaining = computeRemainingWork(
    { task: input.task, blocks: input.blocks, now: input.now },
    config,
  );
  const today = toDateKey(input.now);
  const options: RescheduleOption[] = [];

  const plannedTask: Task = {
    ...input.task,
    estimatedMinutes: remaining.remainingMinutes,
    actualMinutes: 0,
  };

  const basePlan = {
    tasks: [plannedTask],
    blocks: input.blocks,
    goals: input.goals,
    preferences: input.preferences,
    now: input.now,
    ignoreBlockIds: input.releaseBlockIds,
  };

  if (remaining.remainingMinutes <= 0) {
    return {
      remaining,
      options: [cancelOption(input.task, 'Nothing left to do — the estimate is already covered.')],
      recommended: null,
    };
  }

  // --- 1. next available slot ------------------------------------------
  const nextSlot = planSchedule({ ...basePlan, runId: 'next_slot' }, config);
  if (nextSlot.proposals.length > 0) {
    const blocks = nextSlot.proposals;
    const covered = sumMinutes(blocks);
    const first = blocks[0]!;
    options.push({
      strategy: 'next_slot',
      label: 'Move to the next free slot',
      explanation: `Next free slot is ${dayPhrase(first.date, today)} at ${fmt(first.start)} — ${covered} min available${deadlinePhrase(input.task, first.date, today)}.`,
      proposedBlocks: blocks,
      displaces: [],
      coveredMinutes: covered,
      meetsDeadline: meetsDeadline(input.task, blocks),
      score: 100 - daysAway(first.date, today) * 5,
    });
  } else {
    options.push(unavailable('next_slot', 'Move to the next free slot',
      firstUnplacedReason(nextSlot.unplaced) ?? 'No free slot in the planning horizon.'));
  }

  // --- 2. tomorrow ------------------------------------------------------
  // "Move to tomorrow" is an explicit user choice, so a hard deadline is
  // relaxed here rather than suppressing the option: we would rather offer it
  // and label it late than silently hide it.
  const tomorrow = addDaysToKey(today, 1);
  const tomorrowPlan = planSchedule(
    {
      ...basePlan,
      tasks: [{ ...plannedTask, deadlineHard: false }],
      from: tomorrow, to: tomorrow, runId: 'tomorrow',
    },
    config,
  );
  if (tomorrowPlan.proposals.length > 0) {
    const blocks = tomorrowPlan.proposals;
    const covered = sumMinutes(blocks);
    const first = blocks[0]!;
    options.push({
      strategy: 'tomorrow',
      label: 'Move to tomorrow',
      explanation: `Move to tomorrow ${fmt(first.start)} — ${covered} min free${afterBlockPhrase(input.blocks, first.start)}${deadlinePhrase(input.task, first.date, today)}.`,
      proposedBlocks: blocks,
      displaces: [],
      coveredMinutes: covered,
      meetsDeadline: meetsDeadline(input.task, blocks),
      score: 80,
    });
  } else {
    options.push(unavailable('tomorrow', 'Move to tomorrow',
      firstUnplacedReason(tomorrowPlan.unplaced) ?? 'Tomorrow has no free time in your working hours.'));
  }

  // --- 3. split into sessions ------------------------------------------
  if (input.task.splittable) {
    const splitTask: Task = {
      ...plannedTask,
      splittable: true,
      maxSessionMinutes: Math.max(
        config.slots.minSessionMinutes,
        Math.ceil(remaining.remainingMinutes / 2),
      ),
    };
    const splitPlan = planSchedule({ ...basePlan, tasks: [splitTask], runId: 'split' }, config);
    if (splitPlan.proposals.length > 1) {
      const blocks = splitPlan.proposals;
      const covered = sumMinutes(blocks);
      options.push({
        strategy: 'split',
        label: `Split into ${blocks.length} sessions`,
        explanation: `Break the remaining ${remaining.remainingMinutes} min into ${blocks.length} sessions (${blocks.map((b) => `${b.durationMinutes} min ${dayPhrase(b.date, today)}`).join(', ')}) so it fits the gaps you actually have.`,
        proposedBlocks: blocks,
        displaces: [],
        coveredMinutes: covered,
        meetsDeadline: meetsDeadline(input.task, blocks),
        score: 70,
      });
    } else {
      options.push(unavailable('split', 'Split into sessions',
        'The remaining time already fits one session, or there are not enough usable gaps to split into.'));
    }
  } else {
    options.push(unavailable('split', 'Split into sessions',
      'This task is marked as not splittable — it needs one unbroken sitting.'));
  }

  // --- 4. shrink --------------------------------------------------------
  const shrinkMin = Math.round(remaining.remainingMinutes * config.rescheduling.minShrinkFactor);
  if (shrinkMin >= config.slots.minSessionMinutes && shrinkMin < remaining.remainingMinutes) {
    const shrinkPlan = planSchedule(
      { ...basePlan, tasks: [{ ...plannedTask, estimatedMinutes: shrinkMin, splittable: false }], runId: 'shrink' },
      config,
    );
    if (shrinkPlan.proposals.length > 0) {
      const blocks = shrinkPlan.proposals;
      options.push({
        strategy: 'shrink',
        label: `Do a shorter ${shrinkMin} min session`,
        explanation: `Fit a reduced ${shrinkMin} min session ${dayPhrase(blocks[0]!.date, today)} at ${fmt(blocks[0]!.start)} instead of the full ${remaining.remainingMinutes} min — ${remaining.remainingMinutes - shrinkMin} min would carry over.`,
        proposedBlocks: blocks,
        displaces: [],
        coveredMinutes: sumMinutes(blocks),
        meetsDeadline: false,
        score: 45,
      });
    }
  }

  // --- 5. displace a lower-priority flexible task -----------------------
  const displace = buildDisplaceOption(input, remaining, config);
  if (displace) options.push(displace);

  // --- 6. manual / cancel ----------------------------------------------
  options.push({
    strategy: 'manual',
    label: 'Pick a time myself',
    explanation: 'Open the schedule and drop this block where you want it — nothing is moved automatically.',
    proposedBlocks: [],
    displaces: [],
    coveredMinutes: 0,
    meetsDeadline: false,
    score: 10,
  });
  options.push(cancelOption(
    input.task,
    `Drop the remaining ${remaining.remainingMinutes} min. The task is marked cancelled and stops appearing in plans.`,
  ));

  const recommended = pickRecommended(options, config);
  return { remaining, options, recommended };
}

function buildDisplaceOption(
  input: RescheduleOptionsInput,
  remaining: RemainingWork,
  config: SchedulingConfig,
): RescheduleOption | null {
  const today = toDateKey(input.now);
  const { byTaskId } = scoreTasks(
    input.tasks,
    { now: input.now, today, goalsById: goalMap(input.goals) },
    config,
  );
  const myScore = byTaskId[input.task.id]?.score ?? 0;
  const release = new Set(input.releaseBlockIds ?? []);

  // Only future, unlocked, unprotected, task-backed blocks are displaceable,
  // and only if their task scores meaningfully lower than ours.
  const candidates = input.blocks.filter((b) => {
    if (release.has(b.id)) return false;
    if (b.locked || b.protected) return false;
    if (b.kind !== 'task' || !b.taskId || b.taskId === input.task.id) return false;
    if (b.status !== 'planned') return false;
    if (b.start <= input.now.getTime()) return false;
    const other = byTaskId[b.taskId]?.score ?? 0;
    return myScore - other >= config.rescheduling.displacementPriorityMargin;
  });

  if (candidates.length === 0) {
    return unavailable('displace', 'Displace a lower-priority task',
      `No scheduled task scores at least ${config.rescheduling.displacementPriorityMargin} points below this one, so nothing should be pushed aside.`);
  }

  // Prefer the soonest block that is big enough, else the soonest overall.
  const need = remaining.remainingMinutes;
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const victim = sorted.find((b) => (b.end - b.start) / MINUTE_MS >= need) ?? sorted[0]!;
  const victimMinutes = Math.round((victim.end - victim.start) / MINUTE_MS);
  const victimScore = byTaskId[victim.taskId!]?.score ?? 0;

  const minutes = Math.min(need, victimMinutes);
  const block: ProposedBlock = {
    tempId: `displace:${input.task.id}:0`,
    title: input.task.title,
    date: victim.date,
    start: victim.start,
    end: victim.start + minutes * MINUTE_MS,
    durationMinutes: minutes,
    trackerId: input.task.trackerId,
    kind: 'task',
    taskId: input.task.id,
    goalId: input.task.goalId,
    locked: false,
    protected: false,
    origin: 'reschedule',
    splitGroupId: null,
    splitIndex: 0,
    splitCount: 1,
    reason: `Takes the ${fmt(victim.start)} slot currently held by "${victim.title}".`,
  };

  return {
    strategy: 'displace',
    label: `Displace "${victim.title}"`,
    explanation: `Take the ${fmt(victim.start)} slot ${dayPhrase(victim.date, today)} from "${victim.title}" (priority ${victimScore} vs ${myScore}) and reschedule that task instead — it is flexible and less urgent.`,
    proposedBlocks: [block],
    displaces: [{
      blockId: victim.id,
      taskId: victim.taskId,
      title: victim.title,
      reason: `Priority ${victimScore} is at least ${config.rescheduling.displacementPriorityMargin} below this task's ${myScore}.`,
    }],
    coveredMinutes: minutes,
    meetsDeadline: meetsDeadline(input.task, [block]),
    score: 55,
  };
}

function pickRecommended(options: RescheduleOption[], config: SchedulingConfig): RescheduleOption | null {
  const usable = options.filter((o) => !o.unavailableReason && o.proposedBlocks.length > 0);
  if (usable.length === 0) return null;

  // Configured strategy order wins; deadline-meeting options are preferred
  // within the same strategy rank.
  const rank = (s: RescheduleStrategy) => {
    const i = config.rescheduling.strategyOrder.indexOf(s);
    return i === -1 ? 999 : i;
  };
  return [...usable].sort((a, b) => {
    if (a.meetsDeadline !== b.meetsDeadline) return a.meetsDeadline ? -1 : 1;
    const ra = rank(a.strategy);
    const rb = rank(b.strategy);
    if (ra !== rb) return ra - rb;
    return b.score - a.score;
  })[0]!;
}

/* ------------------------------------------------------------------ */
/* Auto reschedule                                                     */
/* ------------------------------------------------------------------ */

export interface AutoRescheduleInput {
  /** Tasks that need a new home. */
  tasks: readonly Task[];
  allTasks: readonly Task[];
  blocks: readonly ScheduleBlock[];
  goals?: readonly Goal[];
  preferences: SchedulingPreferences;
  now: Date;
  releaseBlockIds?: readonly ID[];
}

export interface AutoRescheduleDecision {
  taskId: ID;
  title: string;
  strategy: RescheduleStrategy;
  proposedBlocks: ProposedBlock[];
  displaces: RescheduleOption['displaces'];
  explanation: string;
}

export interface AutoRescheduleResult {
  decisions: AutoRescheduleDecision[];
  /** Tasks the engine refused to move automatically, with the reason. */
  needsUserInput: { taskId: ID; title: string; reason: string }[];
  explanation: string[];
}

/**
 * Full-auto mode. Honours deadlines, priority order, locked/protected blocks
 * and dependency order (via planSchedule), and refuses to move a task that has
 * already been auto-moved `maxAutoMoves` times — repeated slippage is a signal
 * for the human, not the machine.
 */
export function autoReschedule(
  input: AutoRescheduleInput,
  config: SchedulingConfig,
): AutoRescheduleResult {
  const today = toDateKey(input.now);
  const { byTaskId } = scoreTasks(
    input.allTasks,
    { now: input.now, today, goalsById: goalMap(input.goals) },
    config,
  );

  const ordered = [...input.tasks]
    .filter((t) => !isFinished(t))
    .sort((a, b) => (byTaskId[b.id]?.score ?? 0) - (byTaskId[a.id]?.score ?? 0)
      || (a.id < b.id ? -1 : 1));

  const decisions: AutoRescheduleDecision[] = [];
  const needsUserInput: AutoRescheduleResult['needsUserInput'] = [];
  const explanation: string[] = [];

  // Proposals accumulate so later tasks see earlier placements as busy.
  const committed: ScheduleBlock[] = [...input.blocks];

  for (const task of ordered) {
    if (task.rescheduleCount >= config.rescheduling.maxAutoMoves) {
      const reason = `Already auto-moved ${task.rescheduleCount} times (limit ${config.rescheduling.maxAutoMoves}) — this keeps slipping, decide manually.`;
      needsUserInput.push({ taskId: task.id, title: task.title, reason });
      explanation.push(`${task.title}: ${reason}`);
      continue;
    }

    const proposal = buildRescheduleOptions(
      {
        task,
        tasks: input.allTasks,
        blocks: committed,
        goals: input.goals,
        preferences: input.preferences,
        now: input.now,
        releaseBlockIds: input.releaseBlockIds,
      },
      config,
    );

    const chosen = proposal.recommended;
    if (!chosen) {
      const reason = proposal.remaining.remainingMinutes <= 0
        ? 'Nothing left to schedule.'
        : 'No automatic option fits — every strategy failed to find room.';
      needsUserInput.push({ taskId: task.id, title: task.title, reason });
      explanation.push(`${task.title}: ${reason}`);
      continue;
    }

    decisions.push({
      taskId: task.id,
      title: task.title,
      strategy: chosen.strategy,
      proposedBlocks: chosen.proposedBlocks,
      displaces: chosen.displaces,
      explanation: chosen.explanation,
    });
    explanation.push(`${task.title}: ${chosen.explanation}`);

    for (const p of chosen.proposedBlocks) committed.push(asBlock(p, input.now));
  }

  return { decisions, needsUserInput, explanation };
}

/* ------------------------------------------------------------------ */
/* Overload detection                                                  */
/* ------------------------------------------------------------------ */

export type OverloadSeverity = 'ok' | 'tight' | 'overloaded' | 'impossible';

export interface DayLoad {
  date: DateKey;
  /** Free minutes inside working hours after fixed commitments. */
  capacityMinutes: number;
  /** Minutes of flexible task work assigned to (or due on) this day. */
  demandMinutes: number;
  /** Minutes already locked into protected blocks. */
  protectedMinutes: number;
  /** demand / capacity; Infinity when capacity is 0 and demand is not. */
  utilisation: number;
  severity: OverloadSeverity;
  overflowMinutes: number;
  taskIds: ID[];
  message: string;
  recommendations: string[];
}

export interface OverloadInput {
  from: DateKey;
  to: DateKey;
  tasks: readonly Task[];
  blocks: readonly ScheduleBlock[];
  preferences: SchedulingPreferences;
  now: Date;
}

export interface OverloadReport {
  days: DayLoad[];
  overloadedDays: DayLoad[];
  totalCapacityMinutes: number;
  totalDemandMinutes: number;
  summary: string;
}

/**
 * Compares flexible workload against real available capacity per day and emits
 * recommendations. Demand for a day = scheduled flexible task blocks on that
 * day + unscheduled tasks whose due date falls on that day.
 */
export function detectOverload(input: OverloadInput, config: SchedulingConfig): OverloadReport {
  const availability = computeAvailability(
    {
      from: input.from,
      to: input.to,
      workingHours: input.preferences.workingHours,
      blocks: input.blocks,
      now: input.now,
    },
    config,
  );

  const scheduledTaskIds = new Set(
    input.blocks.filter((b) => b.taskId && b.status === 'planned').map((b) => b.taskId!),
  );

  const days: DayLoad[] = availability.map((day) => {
    const flexibleBlocks = input.blocks.filter(
      (b) => b.date === day.date && !b.protected && !b.locked
        && b.kind === 'task' && b.status === 'planned',
    );
    const scheduledDemand = flexibleBlocks.reduce((s, b) => s + (b.end - b.start) / MINUTE_MS, 0);

    const dueUnscheduled = input.tasks.filter(
      (t) => !isFinished(t) && t.dueDate === day.date && !scheduledTaskIds.has(t.id),
    );
    const unscheduledDemand = dueUnscheduled.reduce(
      (s, t) => s + Math.max(0, t.estimatedMinutes - t.actualMinutes), 0,
    );

    const demand = Math.round(scheduledDemand + unscheduledDemand);
    // Capacity = time still free + time those flexible blocks already occupy.
    const capacity = Math.round(Math.min(
      day.freeMinutes + scheduledDemand,
      config.slots.maxDailyLoadMinutes,
    ));

    const utilisation = capacity > 0 ? demand / capacity : demand > 0 ? Infinity : 0;
    const overflow = Math.max(0, demand - capacity);

    let severity: OverloadSeverity;
    if (demand === 0) severity = 'ok';
    else if (capacity === 0) severity = 'impossible';
    else if (utilisation > 1.5) severity = 'impossible';
    else if (utilisation > 1) severity = 'overloaded';
    else if (utilisation > 0.85) severity = 'tight';
    else severity = 'ok';

    const taskIds = [
      ...new Set([
        ...flexibleBlocks.map((b) => b.taskId!).filter(Boolean),
        ...dueUnscheduled.map((t) => t.id),
      ]),
    ];

    return {
      date: day.date,
      capacityMinutes: capacity,
      demandMinutes: demand,
      protectedMinutes: Math.round(day.protectedMinutes),
      utilisation: Number.isFinite(utilisation) ? Math.round(utilisation * 100) / 100 : Infinity,
      severity,
      overflowMinutes: overflow,
      taskIds,
      message: loadMessage(day.date, demand, capacity, severity, overflow),
      recommendations: loadRecommendations(severity, overflow, dueUnscheduled, flexibleBlocks.length),
    };
  });

  const totalCapacity = days.reduce((s, d) => s + d.capacityMinutes, 0);
  const totalDemand = days.reduce((s, d) => s + d.demandMinutes, 0);
  const overloadedDays = days.filter((d) => d.severity === 'overloaded' || d.severity === 'impossible');

  return {
    days,
    overloadedDays,
    totalCapacityMinutes: totalCapacity,
    totalDemandMinutes: totalDemand,
    summary: overloadedDays.length === 0
      ? `Workload fits: ${totalDemand} min planned against ${totalCapacity} min of capacity over ${days.length} day${days.length === 1 ? '' : 's'}.`
      : `${overloadedDays.length} of ${days.length} day${days.length === 1 ? '' : 's'} are over capacity (${totalDemand} min planned vs ${totalCapacity} min available). Earliest problem: ${overloadedDays[0]!.date}.`,
  };
}

function loadMessage(
  date: DateKey, demand: number, capacity: number,
  severity: OverloadSeverity, overflow: number,
): string {
  switch (severity) {
    case 'impossible':
      return capacity === 0
        ? `${date}: ${demand} min of work planned but no free time at all — every working hour is already committed or protected.`
        : `${date}: ${demand} min planned against ${capacity} min available — more than 1.5x over capacity.`;
    case 'overloaded':
      return `${date}: ${demand} min planned but only ${capacity} min free — ${overflow} min will not fit.`;
    case 'tight':
      return `${date}: ${demand} of ${capacity} available min committed — no slack for overruns.`;
    default:
      return `${date}: ${demand} of ${capacity} available min committed.`;
  }
}

function loadRecommendations(
  severity: OverloadSeverity, overflow: number,
  dueUnscheduled: readonly Task[], flexibleCount: number,
): string[] {
  if (severity === 'ok') return [];
  const out: string[] = [];
  if (overflow > 0) out.push(`Move ${overflow} min of flexible work to another day.`);
  if (flexibleCount > 0) out.push(`Reschedule the lowest-priority of the ${flexibleCount} flexible block${flexibleCount === 1 ? '' : 's'} on this day.`);
  const soft = dueUnscheduled.filter((t) => !t.deadlineHard);
  if (soft.length > 0) out.push(`${soft.length} of the tasks due have soft deadlines — pushing them costs nothing but the date.`);
  if (severity === 'impossible') out.push('Consider shortening or cancelling a protected block, or accept that some work slips.');
  else out.push('Shorten estimates only if the history supports it — see duration predictions.');
  return out;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function cancelOption(_task: Task, explanation: string): RescheduleOption {
  return {
    strategy: 'cancel',
    label: 'Cancel this task',
    explanation,
    proposedBlocks: [],
    displaces: [],
    coveredMinutes: 0,
    meetsDeadline: false,
    score: 0,
  };
}

function unavailable(strategy: RescheduleStrategy, label: string, reason: string): RescheduleOption {
  return {
    strategy, label,
    explanation: reason,
    proposedBlocks: [], displaces: [],
    coveredMinutes: 0, meetsDeadline: false, score: -1,
    unavailableReason: reason,
  };
}

function goalMap(goals: readonly Goal[] | undefined): Record<ID, Goal> {
  const out: Record<ID, Goal> = {};
  for (const g of goals ?? []) out[g.id] = g;
  return out;
}

function sumMinutes(blocks: readonly ProposedBlock[]): number {
  return blocks.reduce((s, b) => s + b.durationMinutes, 0);
}

function meetsDeadline(task: Task, blocks: readonly ProposedBlock[]): boolean {
  if (!task.dueDate || blocks.length === 0) return true;
  const last = blocks.reduce((m, b) => Math.max(m, b.end), 0);
  return last <= atMinute(task.dueDate, 24 * 60);
}

function daysAway(date: DateKey, today: DateKey): number {
  return Math.max(0, diffDays(today, date));
}

function dayPhrase(date: DateKey, today: DateKey): string {
  const d = diffDays(today, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 0) return `on ${date}`;
  return `in ${d} days (${date})`;
}

function deadlinePhrase(task: Task, date: DateKey, today: DateKey): string {
  if (!task.dueDate) return '';
  const slack = diffDays(date, task.dueDate);
  if (slack < 0) return `, but that is ${Math.abs(slack)} day${Math.abs(slack) === 1 ? '' : 's'} AFTER the ${task.dueDate} deadline`;
  if (slack === 0) return ', landing exactly on the deadline';
  void today;
  return `, still ${slack} day${slack === 1 ? '' : 's'} before the deadline`;
}

function afterBlockPhrase(blocks: readonly ScheduleBlock[], start: Timestamp): string {
  const before = blocks
    .filter((b) => b.end <= start && b.end > start - 4 * 60 * MINUTE_MS)
    .sort((a, b) => b.end - a.end)[0];
  return before ? ` right after your "${before.title}" block` : '';
}

/** Materialises a proposal into a block-shaped record for downstream planning. */
function asBlock(p: ProposedBlock, now: Date): ScheduleBlock {
  return {
    id: p.tempId,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
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
    locked: false,
    protected: false,
    origin: p.origin,
    planRunId: null,
    splitGroupId: p.splitGroupId,
    splitIndex: p.splitIndex,
    splitCount: p.splitCount,
    actualStart: null,
    actualEnd: null,
  };
}

function firstUnplacedReason(unplaced: readonly UnplacedTask[]): string | null {
  return unplaced[0]?.reason ?? null;
}

function fmt(ts: Timestamp): string {
  const m = minuteOfDay(ts);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm < 10 ? '0' : ''}${mm} ${suffix}`;
}

export type { DayAvailability };
