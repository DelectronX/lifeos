import type {
  DateKey, Goal, ID, MinuteOfDay, SchedulingConfig, ScheduleBlock, Task, TimeWindow, Timestamp,
} from '@/types';
import type {
  AvailabilityInput, DayAvailability, FreeSlot, ProposedBlock,
  SchedulingPreferences, UnplacedTask, UnplacedReasonCode,
} from '@/types/scheduling';
import {
  MINUTE_MS, addDaysToKey, atMinute, dateKeyRange, diffDays,
  minuteOfDay, snapUp, toDateKey,
} from '@/lib/date';
import { subtractIntervals, type Interval } from '@/lib/intervals';
import { comparePriority, isFinished, scoreTasks, type PriorityScore } from './priorityScoring';

/**
 * SchedulingEngine — free-slot computation and task placement.
 *
 * Two independent halves:
 *   1. `computeAvailability` turns working hours minus existing blocks into a
 *      list of concrete free slots per day. Protected blocks (sleep / school /
 *      meals) and locked blocks are hard subtractions: the engine can never
 *      propose over them.
 *   2. `planSchedule` walks a priority-ordered task list and greedily places
 *      each task into the best-scoring slot, honouring deadlines, earliest
 *      available date, preferred window, min/max session length, splitting,
 *      dependency ordering, per-day load ceiling and break padding after
 *      intensive sessions.
 *
 * The engine mutates nothing and touches no clock: pass `now`. It returns
 * proposals plus, for every task it could NOT place, a machine code and a
 * human sentence saying why.
 */

/* ------------------------------------------------------------------ */
/* 1. Availability                                                     */
/* ------------------------------------------------------------------ */

/** Blocks in these statuses no longer occupy their time. */
const RELEASED_STATUSES = new Set(['cancelled', 'skipped']);

export function computeAvailability(
  input: AvailabilityInput,
  config: SchedulingConfig,
): DayAvailability[] {
  const ignore = new Set(input.ignoreBlockIds ?? []);
  const earliest = snapUp(
    input.now.getTime() + config.slots.leadTimeMinutes * MINUTE_MS,
    config.slots.granularityMinutes,
  );

  const blocksByDate = new Map<DateKey, ScheduleBlock[]>();
  for (const block of input.blocks) {
    if (ignore.has(block.id)) continue;
    if (RELEASED_STATUSES.has(block.status)) continue;
    const list = blocksByDate.get(block.date);
    if (list) list.push(block);
    else blocksByDate.set(block.date, [block]);
  }

  const out: DayAvailability[] = [];

  for (const date of dateKeyRange(input.from, input.to)) {
    const dayOfWeek = new Date(atMinute(date, 0)).getDay();
    const ranges = input.workingHours[dayOfWeek] ?? [];

    const working: Interval[] = ranges
      .map((r) => ({ start: atMinute(date, r.startMinute), end: atMinute(date, r.endMinute) }))
      .filter((i) => i.end > i.start);
    const workingMinutes = working.reduce((s, i) => s + (i.end - i.start) / MINUTE_MS, 0);

    const dayBlocks = blocksByDate.get(date) ?? [];
    const busy: Interval[] = dayBlocks.map((b) => ({
      start: b.start - config.slots.bufferMinutes * MINUTE_MS,
      end: b.end + config.slots.bufferMinutes * MINUTE_MS,
    }));

    let protectedMinutes = 0;
    let committedMinutes = 0;
    for (const b of dayBlocks) {
      const mins = (b.end - b.start) / MINUTE_MS;
      if (b.protected) protectedMinutes += mins;
      else committedMinutes += mins;
    }

    const free = subtractIntervals(working, busy)
      // Never offer time that has already passed.
      .map((i) => ({ start: Math.max(i.start, earliest), end: i.end }))
      .filter((i) => i.end - i.start >= config.slots.minUsableSlotMinutes * MINUTE_MS);

    const slots: FreeSlot[] = free.map((i) => {
      const start = snapUp(i.start, config.slots.granularityMinutes);
      return {
        date,
        start,
        end: i.end,
        durationMinutes: Math.max(0, (i.end - start) / MINUTE_MS),
        startMinute: minuteOfDay(start),
        endMinute: minuteOfDay(i.end - 1) + 1,
      };
    }).filter((s) => s.durationMinutes >= config.slots.minUsableSlotMinutes);

    out.push({
      date,
      dayOfWeek,
      slots,
      freeMinutes: slots.reduce((s, x) => s + x.durationMinutes, 0),
      workingMinutes,
      protectedMinutes,
      committedMinutes,
    });
  }

  return out;
}

/** Convenience wrapper for a single day. */
export function findFreeSlots(
  date: DateKey,
  input: Omit<AvailabilityInput, 'from' | 'to'>,
  config: SchedulingConfig,
): FreeSlot[] {
  return computeAvailability({ ...input, from: date, to: date }, config)[0]?.slots ?? [];
}

/* ------------------------------------------------------------------ */
/* 2. Placement                                                        */
/* ------------------------------------------------------------------ */

export interface PlanScheduleInput {
  tasks: readonly Task[];
  blocks: readonly ScheduleBlock[];
  goals?: readonly Goal[];
  preferences: SchedulingPreferences;
  now: Date;
  /** Defaults to the day containing `now`. */
  from?: DateKey;
  /** Defaults to `from + config.slots.horizonDays`. */
  to?: DateKey;
  /** Blocks whose time should be freed (e.g. re-planning an existing block). */
  ignoreBlockIds?: readonly ID[];
  /** Stable prefix for generated tempIds so previews are reproducible. */
  runId?: string;
}

export interface TaskPlacement {
  taskId: ID;
  title: string;
  priorityScore: number;
  blocks: ProposedBlock[];
  scheduledMinutes: number;
  /** Human sentence covering the whole placement decision. */
  reason: string;
  split: boolean;
}

export interface PlanScheduleResult {
  proposals: ProposedBlock[];
  placements: TaskPlacement[];
  unplaced: UnplacedTask[];
  /** Availability AFTER every proposal was inserted. */
  remainingAvailability: DayAvailability[];
  /** Scheduled minutes added per day by this run. */
  loadByDate: Record<DateKey, number>;
  explanation: string[];
}

interface MutableSlot {
  date: DateKey;
  start: Timestamp;
  end: Timestamp;
}

export function planSchedule(
  input: PlanScheduleInput,
  config: SchedulingConfig,
): PlanScheduleResult {
  const today = toDateKey(input.now);
  const from = input.from ?? today;
  const to = input.to ?? addDaysToKey(from, Math.max(0, config.slots.horizonDays - 1));

  const goalsById: Record<ID, Goal> = {};
  for (const g of input.goals ?? []) goalsById[g.id] = g;

  const schedulable = input.tasks.filter((t) => !isFinished(t));

  const { byTaskId } = scoreTasks(input.tasks, { now: input.now, today, goalsById }, config);

  // --- dependency-aware ordering ---------------------------------------
  const ordered = topoOrderByPriority(schedulable, byTaskId);

  // --- mutable availability --------------------------------------------
  const availability = computeAvailability(
    {
      from, to,
      workingHours: input.preferences.workingHours,
      blocks: input.blocks,
      now: input.now,
      ignoreBlockIds: input.ignoreBlockIds,
    },
    config,
  );

  const slots: MutableSlot[] = [];
  for (const day of availability) {
    for (const s of day.slots) slots.push({ date: s.date, start: s.start, end: s.end });
  }
  slots.sort((a, b) => a.start - b.start);

  // Existing committed (non-protected) load per day feeds the daily ceiling.
  const loadByDate: Record<DateKey, number> = {};
  const existingLoad: Record<DateKey, number> = {};
  for (const day of availability) existingLoad[day.date] = day.committedMinutes;

  const proposals: ProposedBlock[] = [];
  const placements: TaskPlacement[] = [];
  const unplaced: UnplacedTask[] = [];
  const explanation: string[] = [];
  const runId = input.runId ?? 'plan';

  // Tracks the end of the last intensive session per day for break padding.
  const lastIntensiveEnd: Record<DateKey, Timestamp> = {};
  const placedTaskIds = new Set<ID>();
  let seq = 0;

  for (const task of ordered) {
    const score = byTaskId[task.id]!;

    // -- hard gate: unfinished dependency --------------------------------
    const pendingDeps = score.blockedBy.filter((id) => !placedTaskIds.has(id));
    if (pendingDeps.length > 0) {
      unplaced.push(reject(task, 'blocked_by_dependency',
        `Waiting on ${pendingDeps.length} unfinished prerequisite task${pendingDeps.length === 1 ? '' : 's'}.`,
        task.estimatedMinutes));
      continue;
    }

    const needed = Math.max(0, Math.round(task.estimatedMinutes - task.actualMinutes));
    if (needed <= 0) {
      unplaced.push(reject(task, 'zero_duration', 'Estimated time is already covered by logged work.', 0));
      continue;
    }

    // -- deadline bound ---------------------------------------------------
    const dueTs = task.dueDate ? atMinute(task.dueDate, 24 * 60) : null;
    if (task.dueDate && task.deadlineHard && diffDays(today, task.dueDate) < 0) {
      unplaced.push(reject(task, 'deadline_passed',
        `Hard deadline ${task.dueDate} is already in the past — reschedule or extend it first.`, needed));
      continue;
    }

    const minSession = Math.max(
      config.slots.granularityMinutes,
      task.minSessionMinutes || config.slots.minSessionMinutes,
    );
    const maxSession = Math.max(
      minSession,
      Math.min(task.maxSessionMinutes || config.slots.maxSessionMinutes, config.slots.maxSessionMinutes),
    );

    let remaining = needed;
    const taskBlocks: ProposedBlock[] = [];
    const reasons: string[] = [];
    let guard = 0;

    while (remaining > 0 && guard++ < 64) {
      // A non-splittable task must fit whole; a splittable one takes chunks.
      const want = task.splittable
        ? Math.min(maxSession, remaining)
        : remaining;
      // The final sliver of a splittable task may legitimately be < minSession.
      const floor = task.splittable ? Math.min(minSession, remaining) : want;

      const pick = pickSlot({
        slots, want, floor, task, dueTs, config,
        preferences: input.preferences,
        loadByDate, existingLoad,
        lastIntensiveEnd,
        originTs: atMinute(from, 0),
      });

      if (!pick) break;

      const { index, start, minutes } = pick;
      const slot = slots[index]!;
      const end = start + minutes * MINUTE_MS;

      const block: ProposedBlock = {
        tempId: `${runId}:${task.id}:${seq++}`,
        title: task.title,
        date: slot.date,
        start,
        end,
        durationMinutes: minutes,
        trackerId: task.trackerId,
        kind: 'task',
        taskId: task.id,
        goalId: task.goalId,
        locked: false,
        protected: false,
        origin: 'scheduler',
        splitGroupId: null,
        splitIndex: 0,
        splitCount: 1,
        reason: placementReason(task, slot.date, start, minutes, score, input.preferences, config),
      };
      taskBlocks.push(block);
      reasons.push(block.reason);

      // Consume the slot, and pad afterwards if this was intensive work.
      let consumedEnd = end;
      if (config.breaks.enforceBetweenIntensive
        && task.intensity === 'high'
        && minutes >= config.breaks.intensiveThresholdMinutes) {
        consumedEnd = end + config.breaks.breakMinutes * MINUTE_MS;
        lastIntensiveEnd[slot.date] = consumedEnd;
      }
      consumeSlot(slots, index, start, consumedEnd);

      loadByDate[slot.date] = (loadByDate[slot.date] ?? 0) + minutes;
      remaining -= minutes;

      if (!task.splittable) break;
    }

    if (taskBlocks.length === 0) {
      unplaced.push(reject(task, noSlotCode(task, dueTs, slots, config),
        noSlotReason(task, dueTs, slots, config), remaining));
      continue;
    }

    if (taskBlocks.length > 1) {
      const groupId = `${runId}:${task.id}:group`;
      taskBlocks.forEach((b, i) => {
        b.splitGroupId = groupId;
        b.splitIndex = i;
        b.splitCount = taskBlocks.length;
        b.title = `${task.title} (${i + 1}/${taskBlocks.length})`;
      });
    }

    proposals.push(...taskBlocks);
    placedTaskIds.add(task.id);

    const scheduled = taskBlocks.reduce((s, b) => s + b.durationMinutes, 0);
    placements.push({
      taskId: task.id,
      title: task.title,
      priorityScore: score.score,
      blocks: taskBlocks,
      scheduledMinutes: scheduled,
      split: taskBlocks.length > 1,
      reason: taskBlocks.length > 1
        ? `Split into ${taskBlocks.length} sessions totalling ${scheduled} min. ${reasons[0]}`
        : reasons[0]!,
    });
    explanation.push(`${task.title}: ${placements[placements.length - 1]!.reason}`);

    if (remaining > 0) {
      unplaced.push(reject(task, 'no_slot_before_deadline',
        `Only ${scheduled} of ${needed} min fitted; ${remaining} min still needs a slot.`, remaining));
    }
  }

  const remainingAvailability = availability.map((day) => {
    const daySlots = slots.filter((s) => s.date === day.date && (s.end - s.start) / MINUTE_MS >= config.slots.minUsableSlotMinutes);
    const mapped: FreeSlot[] = daySlots.map((s) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      durationMinutes: (s.end - s.start) / MINUTE_MS,
      startMinute: minuteOfDay(s.start),
      endMinute: minuteOfDay(s.end - 1) + 1,
    }));
    return {
      ...day,
      slots: mapped,
      freeMinutes: mapped.reduce((sum, s) => sum + s.durationMinutes, 0),
      committedMinutes: day.committedMinutes + (loadByDate[day.date] ?? 0),
    };
  });

  return { proposals, placements, unplaced, remainingAvailability, loadByDate, explanation };
}

/* ------------------------------------------------------------------ */
/* Slot selection                                                      */
/* ------------------------------------------------------------------ */

interface PickArgs {
  slots: MutableSlot[];
  want: number;
  floor: number;
  task: Task;
  dueTs: Timestamp | null;
  config: SchedulingConfig;
  preferences: SchedulingPreferences;
  loadByDate: Record<DateKey, number>;
  existingLoad: Record<DateKey, number>;
  lastIntensiveEnd: Record<DateKey, Timestamp>;
  /** Local midnight of the first planned day — the earliness origin. */
  originTs: Timestamp;
}

interface Pick { index: number; start: Timestamp; minutes: number; score: number }

/**
 * Candidate start offsets inside one slot.
 *
 * A slot is not just its leading edge: a 9am-6pm gap can host an evening
 * session. We therefore probe the slot start plus every preferred-window and
 * focus-hour boundary that falls inside it — a small, deterministic set that
 * lets soft time preferences actually win without a full grid search.
 */
function candidateStarts(
  slot: MutableSlot,
  earliest: Timestamp,
  minutes: number,
  task: Task,
  config: SchedulingConfig,
  preferences: SchedulingPreferences,
): Timestamp[] {
  const latest = slot.end - minutes * MINUTE_MS;
  const out = new Set<Timestamp>();
  const add = (ts: Timestamp) => {
    const snapped = snapUp(ts, config.slots.granularityMinutes);
    if (snapped >= earliest && snapped <= latest) out.add(snapped);
  };

  add(earliest);

  const boundaries: MinuteOfDay[] = [];
  if (task.preferredWindow !== 'any') {
    const [lo, hi] = config.windows[task.preferredWindow];
    boundaries.push(lo);
    // Finishing exactly at the window edge is also a valid in-window placement.
    if (hi <= 1440) boundaries.push(hi - minutes);
  }
  for (const fh of preferences.focusHours) {
    boundaries.push(fh.startMinute);
    boundaries.push(fh.endMinute - minutes);
  }
  for (const m of boundaries) {
    if (m >= 0 && m <= 1440) add(atMinute(slot.date, m));
  }

  return [...out].sort((a, b) => a - b);
}

/**
 * Scores every candidate slot and returns the best. Constraints (deadline,
 * daily ceiling, minimum session) reject; preferences (window fit, focus
 * hours, earliness, fragmentation) merely score.
 */
function pickSlot(args: PickArgs): Pick | null {
  const { slots, want, floor, task, dueTs, config, preferences } = args;
  let best: Pick | null = null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;

    // Break padding after an intensive session on the same day.
    const padUntil = args.lastIntensiveEnd[slot.date] ?? 0;
    const earliest = snapUp(Math.max(slot.start, padUntil), config.slots.granularityMinutes);
    if (earliest >= slot.end) continue;

    // Daily ceiling.
    const dayLoad = (args.loadByDate[slot.date] ?? 0) + (args.existingLoad[slot.date] ?? 0);
    const dayRoom = config.slots.maxDailyLoadMinutes - dayLoad;
    if (dayRoom < floor) continue;

    // Hard deadline: the session must END by the deadline.
    const hardEnd = dueTs !== null && task.deadlineHard ? Math.min(slot.end, dueTs) : slot.end;
    const avail = Math.floor((hardEnd - earliest) / MINUTE_MS);
    if (avail < floor) continue;

    const minutes = Math.min(want, avail, dayRoom);
    if (minutes < floor) continue;

    for (const start of candidateStarts(slot, earliest, minutes, task, config, preferences)) {
      if (start + minutes * MINUTE_MS > hardEnd) continue;
      const score = scoreSlot(start, minutes, slot, task, config, preferences, dueTs, args.originTs);
      if (!best || score > best.score) best = { index: i, start, minutes, score };
    }
  }

  return best;
}

function scoreSlot(
  start: Timestamp,
  minutes: number,
  slot: MutableSlot,
  task: Task,
  config: SchedulingConfig,
  preferences: SchedulingPreferences,
  dueTs: Timestamp | null,
  originTs: Timestamp,
): number {
  const s = config.scoring;
  let score = 0;

  // Earliness: prefer sooner, normalised over the whole planning horizon so
  // that a later DAY is genuinely penalised, not just a later hour.
  const horizonMs = Math.max(1, config.slots.horizonDays * 24 * 60 * MINUTE_MS);
  score += s.earliness * (1 - Math.min(1, Math.max(0, start - originTs) / horizonMs));

  // Deadline pressure: strongly prefer finishing well before the due date.
  if (dueTs !== null) {
    const slackMs = dueTs - (start + minutes * MINUTE_MS);
    score += s.earliness * (slackMs >= 0 ? 0.5 : -2);
  }

  // Preferred time window.
  const mid = minuteOfDay(start) + minutes / 2;
  if (task.preferredWindow !== 'any') {
    score += inWindow(mid, task.preferredWindow, config)
      ? config.windows.matchBonus * s.windowFit
      : -config.windows.mismatchPenalty * s.windowFit;
  }

  // Deep-work bonus.
  for (const fh of preferences.focusHours) {
    if (mid >= fh.startMinute && mid < fh.endMinute) { score += s.focusHourBonus; break; }
  }

  // Contiguity: a session that fills more of its slot fragments less.
  const slotMinutes = Math.max(1, (slot.end - slot.start) / MINUTE_MS);
  score += s.contiguity * (minutes / slotMinutes);

  // Fragmentation penalty: avoid leaving an unusable sliver behind.
  const leadGap = (start - slot.start) / MINUTE_MS;
  const tailGap = slotMinutes - leadGap - minutes;
  for (const gap of [leadGap, tailGap]) {
    if (gap > 0 && gap < config.slots.minUsableSlotMinutes) score -= s.fragmentation;
  }

  return score;
}

function inWindow(minute: number, window: TimeWindow, config: SchedulingConfig): boolean {
  if (window === 'any') return true;
  const [lo, hi] = config.windows[window];
  // The night window wraps past midnight (e.g. 22:00 -> 05:00 next day).
  return hi > 1440
    ? minute >= lo || minute < hi - 1440
    : minute >= lo && minute < hi;
}

/** Removes [start,end) from slot `index`, splitting it if the cut is interior. */
function consumeSlot(slots: MutableSlot[], index: number, start: Timestamp, end: Timestamp): void {
  const slot = slots[index]!;
  const head: MutableSlot | null = start > slot.start ? { date: slot.date, start: slot.start, end: start } : null;
  const tail: MutableSlot | null = end < slot.end ? { date: slot.date, start: end, end: slot.end } : null;

  const replacement: MutableSlot[] = [];
  if (head) replacement.push(head);
  if (tail) replacement.push(tail);
  slots.splice(index, 1, ...replacement);
  slots.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* Ordering & explanations                                             */
/* ------------------------------------------------------------------ */

/**
 * Priority order, but a task never precedes a prerequisite that is also in
 * this batch. Kahn's algorithm over the in-batch dependency edges; any cycle
 * degrades gracefully to pure priority order rather than dropping tasks.
 */
export function topoOrderByPriority(
  tasks: readonly Task[],
  scores: Readonly<Record<ID, PriorityScore>>,
): Task[] {
  const inBatch = new Set(tasks.map((t) => t.id));
  const remaining = new Map<ID, Task>(tasks.map((t) => [t.id, t]));
  const indegree = new Map<ID, number>();

  for (const t of tasks) {
    const deps = (t.dependsOn ?? []).filter((d) => inBatch.has(d) && !isFinished(remaining.get(d)!));
    indegree.set(t.id, deps.length);
  }

  const out: Task[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((t) => (indegree.get(t.id) ?? 0) === 0);
    // Cycle (or all blocked): fall back to priority order over what is left.
    const pool = ready.length > 0 ? ready : [...remaining.values()];
    pool.sort((a, b) => comparePriority(scores[a.id]!, scores[b.id]!));
    const next = pool[0]!;
    out.push(next);
    remaining.delete(next.id);
    for (const t of remaining.values()) {
      if ((t.dependsOn ?? []).includes(next.id)) {
        indegree.set(t.id, Math.max(0, (indegree.get(t.id) ?? 1) - 1));
      }
    }
  }
  return out;
}

function placementReason(
  task: Task,
  date: DateKey,
  start: Timestamp,
  minutes: number,
  score: PriorityScore,
  preferences: SchedulingPreferences,
  config: SchedulingConfig,
): string {
  const parts: string[] = [];
  parts.push(`Placed ${minutes} min on ${date} at ${fmt(start)}`);

  const drivers = [...score.terms].sort((a, b) => b.contribution - a.contribution)[0];
  if (drivers && drivers.contribution > 0) parts.push(`priority ${score.score}/100 (${drivers.label.toLowerCase()})`);

  const mid = minuteOfDay(start) + minutes / 2;
  if (task.preferredWindow !== 'any') {
    parts.push(inWindow(mid, task.preferredWindow, config)
      ? `matches your preferred ${task.preferredWindow} window`
      : `outside the preferred ${task.preferredWindow} window — it was the earliest fit`);
  }
  if (preferences.focusHours.some((f) => mid >= f.startMinute && mid < f.endMinute)) {
    parts.push('inside a focus-hours block');
  }
  if (task.dueDate) parts.push(`due ${task.dueDate}`);

  return `${parts.join('; ')}.`;
}

function noSlotCode(
  task: Task,
  dueTs: Timestamp | null,
  slots: MutableSlot[],
  config: SchedulingConfig,
): UnplacedReasonCode {
  if (slots.length === 0) return 'no_slot_in_horizon';

  const hardDeadline = dueTs !== null && task.deadlineHard;
  // Only time the task is actually allowed to use counts towards the diagnosis.
  const usable = hardDeadline
    ? slots.filter((s) => s.start < dueTs).map((s) => ({ ...s, end: Math.min(s.end, dueTs) }))
    : slots;

  if (usable.length === 0) return 'no_slot_before_deadline';

  const longest = usable.reduce((m, s) => Math.max(m, (s.end - s.start) / MINUTE_MS), 0);
  const need = Math.max(task.minSessionMinutes || config.slots.minSessionMinutes, 1);
  const total = usable.reduce((sum, s) => sum + (s.end - s.start) / MINUTE_MS, 0);

  if (!task.splittable && longest < task.estimatedMinutes) {
    return hardDeadline ? 'no_slot_before_deadline' : 'not_splittable_no_contiguous_slot';
  }
  if (hardDeadline && total < task.estimatedMinutes) return 'no_slot_before_deadline';
  if (longest < need) return 'daily_capacity_reached';
  return 'no_slot_in_horizon';
}

function noSlotReason(
  task: Task,
  dueTs: Timestamp | null,
  slots: MutableSlot[],
  config: SchedulingConfig,
): string {
  const code = noSlotCode(task, dueTs, slots, config);
  const hardDeadline = dueTs !== null && task.deadlineHard;
  const usable = hardDeadline
    ? slots.filter((s) => s.start < dueTs).map((s) => ({ ...s, end: Math.min(s.end, dueTs) }))
    : slots;
  const longest = Math.round(usable.reduce((m, s) => Math.max(m, (s.end - s.start) / MINUTE_MS), 0));
  const total = Math.round(usable.reduce((sum, s) => sum + (s.end - s.start) / MINUTE_MS, 0));

  switch (code) {
    case 'not_splittable_no_contiguous_slot':
      return `Needs ${task.estimatedMinutes} min in one unbroken sitting, but the largest free gap is ${longest} min. Allow splitting or free up a longer window.`;
    case 'no_slot_before_deadline':
      return `Only ${total} min of free time remains before the ${task.dueDate} deadline${!task.splittable && longest < task.estimatedMinutes ? ` (longest unbroken gap ${longest} min, and this task cannot be split)` : ''}, but ${task.estimatedMinutes} min are needed. Move the deadline, drop something else, or accept a late finish.`;
    case 'daily_capacity_reached':
      return `Every remaining gap is shorter than this task's ${task.minSessionMinutes || config.slots.minSessionMinutes} min minimum session, or the ${config.slots.maxDailyLoadMinutes} min daily ceiling is reached.`;
    default:
      return `No free slot within the ${config.slots.horizonDays}-day planning horizon.`;
  }
}

function reject(task: Task, code: UnplacedReasonCode, reason: string, missing: number): UnplacedTask {
  return { taskId: task.id, title: task.title, code, reason, missingMinutes: Math.max(0, Math.round(missing)) };
}

function fmt(ts: Timestamp): string {
  const m = minuteOfDay(ts);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm < 10 ? '0' : ''}${mm} ${suffix}`;
}
