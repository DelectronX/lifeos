import { addDaysToKey, dateKeyToDate, isoWeekKey, minuteOfDay, monthKey } from '@/lib/date';
import { elapsedPhases } from './cycles';
import type {
  Activity, CycleDefinition, DateKey, Goal, ID, Paper, ScheduleBlock, Task, TimerSession,
} from '@/types';

/**
 * CustomMetrics — generic, parameterised metric families for DATA-defined
 * achievements (and anything else that speaks ConditionEngine metric keys).
 *
 * A metric key is `family:args`. Tracker lists are comma separated and always
 * include each tracker's whole subtree, so `minutes:trk_cyber` counts every
 * child of Cybersecurity too. Nothing here knows any particular tracker,
 * subject, user or schedule — the achievement definition supplies all of it.
 *
 *   minutes:<trackers>              completed work minutes
 *   sessions:<trackers>             completed work units (session / block / task)
 *   units:<trackers>                Activity values: habit check-in values + completed tasks
 *   days:<trackers>                 distinct days with completed work
 *   streak:<trackers>               longest run of consecutive days with completed work
 *   allDays:<trackers>              days on which EVERY listed tracker had completed work
 *   sameWeek:<trackers>             ISO weeks in which every listed tracker had work
 *   sameMonth:<trackers>            months in which every listed tracker had work
 *   lateSessions:<trackers>:<min>   work units starting at/after minute-of-day <min>
 *   papers:<trackers|*>             submitted papers (any section in the trackers)
 *   goals:<trackers>                completed goals
 *   windowDays:<from>-<to>          days whose required blocks starting in [from,to) were all completed
 *   perfectDays                     elapsed days whose required blocks were all completed
 *   scheduleStreak                  longest run of consecutive perfect days
 *   perfectWeeks                    Mon–Sun weeks made of seven perfect days
 *   comebacks                       perfect days that directly follow a missed day
 *   cycles:<cycleId>                fully elapsed cycles whose every phase met its completion rule
 *   perfectPhases:<cycleId>:<phase>:<trackers>
 *                                   elapsed occurrences of the phase in which every required
 *                                   block of those trackers was completed (min. one)
 *   totalXP                         lifetime XP
 *
 * "Required" block = not optional and not a sleep/meal/break/buffer block.
 * Only days strictly before `today` are judged, so an unfinished today is
 * never counted as a miss.
 */

export interface CustomMetricInput {
  activities: readonly Activity[];
  tasks: readonly Task[];
  sessions: readonly TimerSession[];
  papers: readonly Paper[];
  blocks: readonly ScheduleBlock[];
  goals: readonly Goal[];
  /** trackerId -> parentId. */
  trackerParents: Readonly<Record<ID, ID | null>>;
  cycles: readonly CycleDefinition[];
  totalXP: number;
  today: DateKey;
  /** Sessions shorter than this many minutes are not work units. */
  minUnitMinutes?: number;
}

/** One completed piece of work, deduplicated across sessions/blocks/tasks. */
export interface WorkUnit {
  date: DateKey;
  startMinute: number;
  trackerId: ID;
  minutes: number;
  source: 'session' | 'block' | 'task';
}

const NON_REQUIRED_KINDS = new Set(['sleep', 'meal', 'break', 'buffer']);

export function isRequiredBlock(b: ScheduleBlock): boolean {
  return !b.optional && !NON_REQUIRED_KINDS.has(b.kind) && b.status !== 'cancelled';
}

/* ------------------------------------------------------------------ */
/* Tracker subtrees                                                    */
/* ------------------------------------------------------------------ */

export function inSubtree(
  trackerId: ID | null | undefined,
  roots: ReadonlySet<ID>,
  parents: Readonly<Record<ID, ID | null>>,
): boolean {
  let cursor: ID | null | undefined = trackerId;
  let guard = 0;
  while (cursor && guard++ < 32) {
    if (roots.has(cursor)) return true;
    cursor = parents[cursor] ?? null;
  }
  return false;
}

function trackerSet(arg: string): Set<ID> {
  return new Set(arg.split(',').map((s) => s.trim()).filter(Boolean));
}

/* ------------------------------------------------------------------ */
/* Work units                                                          */
/* ------------------------------------------------------------------ */

export function buildWorkUnits(input: CustomMetricInput): WorkUnit[] {
  const minMinutes = input.minUnitMinutes ?? 2;
  const units: WorkUnit[] = [];
  const blocksWithSession = new Set<ID>();
  const tasksWithWork = new Set<ID>();

  for (const s of input.sessions) {
    const minutes = s.workMs / 60_000;
    if (minutes < minMinutes) continue;
    if (s.blockId) blocksWithSession.add(s.blockId);
    if (s.taskId) tasksWithWork.add(s.taskId);
    units.push({ date: s.date, startMinute: minuteOfDay(s.startedAt), trackerId: s.trackerId, minutes, source: 'session' });
  }

  // Minutes of completed blocks hosted inside another block are not counted
  // twice: the host's minutes are reduced by its completed children.
  const hostedMinutes = new Map<ID, number>();
  for (const b of input.blocks) {
    if (b.status !== 'completed' || !b.hostBlockId) continue;
    hostedMinutes.set(b.hostBlockId, (hostedMinutes.get(b.hostBlockId) ?? 0) + blockMinutes(b));
  }

  for (const b of input.blocks) {
    if (b.status !== 'completed' || b.optional) continue;
    if (NON_REQUIRED_KINDS.has(b.kind)) continue;
    if (b.taskId) tasksWithWork.add(b.taskId);
    if (blocksWithSession.has(b.id)) continue;
    const minutes = Math.max(0, blockMinutes(b) - (hostedMinutes.get(b.id) ?? 0));
    units.push({
      date: b.date,
      startMinute: minuteOfDay(b.actualStart ?? b.start),
      trackerId: b.trackerId,
      minutes,
      source: 'block',
    });
  }

  for (const t of input.tasks) {
    if (t.status !== 'completed' || !t.completedAt || tasksWithWork.has(t.id)) continue;
    const date = (t.completedAt ? localKey(t.completedAt) : null) ?? input.today;
    units.push({ date, startMinute: minuteOfDay(t.completedAt), trackerId: t.trackerId, minutes: t.actualMinutes, source: 'task' });
  }
  return units;
}

function blockMinutes(b: ScheduleBlock): number {
  const start = b.actualStart ?? b.start;
  const end = b.actualEnd ?? b.end;
  return Math.max(0, (end - start) / 60_000);
}

function localKey(ts: number): DateKey {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ------------------------------------------------------------------ */
/* Schedule adherence                                                  */
/* ------------------------------------------------------------------ */

/** date -> true (all required blocks done) / false (a required block missed). Elapsed days only. */
export function dayAdherence(blocks: readonly ScheduleBlock[], today: DateKey): Map<DateKey, boolean> {
  const out = new Map<DateKey, boolean>();
  for (const b of blocks) {
    if (b.date >= today || !isRequiredBlock(b)) continue;
    const done = b.status === 'completed';
    out.set(b.date, (out.get(b.date) ?? true) && done);
  }
  return out;
}

function longestRun(sortedDates: readonly DateKey[]): number {
  let best = 0;
  let run = 0;
  let prev: DateKey | null = null;
  for (const d of sortedDates) {
    run = prev !== null && addDaysToKey(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export interface CustomMetricContext {
  input: CustomMetricInput;
  units: WorkUnit[];
  adherence: Map<DateKey, boolean>;
}

export function buildContext(input: CustomMetricInput): CustomMetricContext {
  return { input, units: buildWorkUnits(input), adherence: dayAdherence(input.blocks, input.today) };
}

/** True when the key belongs to a family this module understands. */
export function isCustomMetricKey(key: string): boolean {
  const family = key.split(':')[0]!;
  return FAMILIES.has(family);
}

const FAMILIES = new Set([
  'minutes', 'sessions', 'units', 'days', 'streak', 'allDays', 'sameWeek', 'sameMonth',
  'lateSessions', 'papers', 'goals', 'windowDays', 'perfectDays', 'scheduleStreak',
  'perfectWeeks', 'comebacks', 'cycles', 'perfectPhases', 'totalXP', 'reviews',
  'events', 'checklists', 'earned',
]);

/** Value of one metric key, or null when the key is malformed / unknown. */
export function readCustomMetric(key: string, ctx: CustomMetricContext): number | null {
  const [family, ...rest] = key.split(':');
  const arg = rest.join(':');
  const { input, units } = ctx;
  const parents = input.trackerParents;
  const unitsFor = (list: string) => {
    const roots = trackerSet(list);
    return units.filter((u) => inSubtree(u.trackerId, roots, parents));
  };
  const workDays = (list: string) => new Set(unitsFor(list).map((u) => u.date));

  switch (family) {
    case 'minutes':
      return arg ? Math.round(unitsFor(arg).reduce((s, u) => s + u.minutes, 0)) : null;
    case 'sessions':
      return arg ? unitsFor(arg).length : null;
    case 'units': {
      // Countable output, e.g. problems solved: each task that is CURRENTLY
      // completed counts once (reopen/re-complete cannot inflate it), plus
      // the logged value of every habit check-in (e.g. "3 problems").
      if (!arg) return null;
      const roots = trackerSet(arg);
      const tasks = input.tasks.filter((t) => t.status === 'completed' && inSubtree(t.trackerId, roots, parents)).length;
      const checkins = input.activities
        .filter((a) => a.type === 'habit_checkin' && inSubtree(a.trackerId, roots, parents))
        .reduce((s, a) => s + Math.max(0, a.value ?? 1), 0);
      // Counts logged directly on completed blocks (the quick "+1" counter).
      const logged = input.blocks
        .filter((b) => b.status === 'completed' && (b.units ?? 0) > 0 && inSubtree(b.trackerId, roots, parents))
        .reduce((s, b) => s + (b.units ?? 0), 0);
      return tasks + checkins + logged;
    }
    case 'days':
      return arg ? workDays(arg).size : null;
    case 'streak':
      return arg ? longestRun([...workDays(arg)].sort()) : null;
    case 'allDays':
    case 'sameWeek':
    case 'sameMonth': {
      const lists = arg.split(',').filter(Boolean);
      if (lists.length === 0) return null;
      const bucket = (d: DateKey) => family === 'allDays' ? d : family === 'sameWeek' ? isoWeekKey(d) : monthKey(d);
      const perTracker = lists.map((id) => new Set([...workDays(id)].map(bucket)));
      const [first, ...others] = perTracker;
      return [...first!].filter((b) => others.every((s) => s.has(b))).length;
    }
    case 'lateSessions': {
      const idx = arg.lastIndexOf(':');
      if (idx <= 0) return null;
      const minute = Number(arg.slice(idx + 1));
      if (!Number.isFinite(minute)) return null;
      return unitsFor(arg.slice(0, idx)).filter((u) => u.startMinute >= minute).length;
    }
    case 'papers': {
      const submitted = input.papers.filter((p) => p.status === 'submitted' || p.status === 'reviewed');
      if (arg === '*' || arg === '') return submitted.length;
      const roots = trackerSet(arg);
      return submitted.filter((p) => p.sections.some((s) => inSubtree(s.trackerId, roots, parents))).length;
    }
    case 'goals': {
      if (!arg) return null;
      const roots = trackerSet(arg);
      return input.goals.filter((g) => g.status === 'completed' && inSubtree(g.trackerId, roots, parents)).length;
    }
    case 'windowDays': {
      const m = /^(\d+)-(\d+)$/.exec(arg);
      if (!m) return null;
      const from = Number(m[1]);
      const to = Number(m[2]);
      const byDay = new Map<DateKey, boolean>();
      for (const b of input.blocks) {
        if (b.date >= input.today || !isRequiredBlock(b)) continue;
        const start = minuteOfDay(b.start);
        if (start < from || start >= to) continue;
        byDay.set(b.date, (byDay.get(b.date) ?? true) && b.status === 'completed');
      }
      return [...byDay.values()].filter(Boolean).length;
    }
    case 'perfectDays':
      return [...ctx.adherence.values()].filter(Boolean).length;
    case 'scheduleStreak':
      return longestRun([...ctx.adherence.entries()].filter(([, ok]) => ok).map(([d]) => d).sort());
    case 'perfectWeeks': {
      const perfect = new Set([...ctx.adherence.entries()].filter(([, ok]) => ok).map(([d]) => d));
      const mondays = new Set([...perfect].map(mondayOf));
      let weeks = 0;
      for (const monday of mondays) {
        let all = true;
        for (let i = 0; i < 7; i++) if (!perfect.has(addDaysToKey(monday, i))) { all = false; break; }
        if (all) weeks++;
      }
      return weeks;
    }
    case 'comebacks': {
      const sorted = [...ctx.adherence.entries()].sort(([a], [b]) => a.localeCompare(b));
      let count = 0;
      for (let i = 1; i < sorted.length; i++) {
        const [prevDate, prevOk] = sorted[i - 1]!;
        const [date, ok] = sorted[i]!;
        if (ok && !prevOk && addDaysToKey(prevDate, 1) === date) count++;
      }
      return count;
    }
    case 'cycles': {
      const cycle = input.cycles.find((c) => c.id === arg);
      if (!cycle) return null;
      const phases = elapsedPhases(cycle, addDaysToKey(input.today, -1));
      const byCycle = new Map<number, boolean[]>();
      for (const p of phases) {
        const ok = phaseCompleted(p.phase, p.start, p.end, ctx);
        const list = byCycle.get(p.cycleIndex) ?? [];
        list.push(ok);
        byCycle.set(p.cycleIndex, list);
      }
      let complete = 0;
      for (const list of byCycle.values()) {
        if (list.length === cycle.phases.filter((p) => p.lengthDays > 0).length && list.every(Boolean)) complete++;
      }
      return complete;
    }
    case 'perfectPhases': {
      const [cycleId, phaseKey, trackers] = arg.split(':');
      const cycle = input.cycles.find((c) => c.id === cycleId);
      if (!cycle || !phaseKey || !trackers) return null;
      const roots = trackerSet(trackers);
      let count = 0;
      for (const p of elapsedPhases(cycle, addDaysToKey(input.today, -1))) {
        if (p.phase.key !== phaseKey) continue;
        const required = input.blocks.filter((b) =>
          b.date >= p.start && b.date <= p.end && isRequiredBlock(b) && inSubtree(b.trackerId, roots, parents));
        if (required.length > 0 && required.every((b) => b.status === 'completed')) count++;
      }
      return count;
    }
    case 'totalXP':
      return input.totalXP;
    case 'reviews': {
      // reviews:daily | reviews:weekly — saved reflections, one per day/week.
      const type = arg === 'weekly' ? 'weekly_review' : arg === 'daily' ? 'daily_review' : null;
      if (!type) return null;
      return new Set(input.activities.filter((a) => a.type === type).map((a) => a.date)).size;
    }
    case 'events': {
      // events:<activityType>[|<activityType>…] — count of logged events, e.g.
      // events:milestone_completed, events:project_shipped, events:source_read.
      if (!arg) return null;
      const types = new Set(arg.split('|').map((x) => x.trim()).filter(Boolean));
      return input.activities.filter((a) => types.has(a.type)).length;
    }
    case 'checklists': {
      // checklists:daily|weekly|monthly|* — fully completed checklist periods.
      const done = input.activities.filter((a) => a.type === 'checklist_completed');
      if (arg === '*' || arg === '') return done.length;
      return done.filter((a) => a.meta?.cadence === arg).length;
    }
    case 'earned': {
      // earned:* | earned:active | earned:passive — total paid income logged.
      const paid = input.activities.filter((a) => a.type === 'payment_received');
      const rows = arg === 'active' || arg === 'passive' ? paid.filter((a) => (a.meta?.stream ?? 'active') === arg) : paid;
      return Math.round(rows.reduce((s, a) => s + (a.value ?? 0), 0));
    }
    default:
      return null;
  }
}

/**
 * A phase "happened" when its data-defined completion rule is met inside the
 * phase's date range: `completion.metric` is a work-unit family evaluated
 * only over that range. Phases without a rule count when any work was done.
 */
function phaseCompleted(
  phase: CycleDefinition['phases'][number],
  start: DateKey,
  end: DateKey,
  ctx: CustomMetricContext,
): boolean {
  const rule = phase.completion;
  const inRange = <T extends { date: DateKey }>(rows: readonly T[]) => rows.filter((r) => r.date >= start && r.date <= end);
  if (!rule) return inRange(ctx.units).length > 0;
  const scoped: CustomMetricContext = {
    input: {
      ...ctx.input,
      sessions: inRange(ctx.input.sessions),
      blocks: inRange(ctx.input.blocks),
      papers: inRange(ctx.input.papers),
      activities: inRange(ctx.input.activities),
      tasks: ctx.input.tasks.filter((t) => t.completedAt && localKey(t.completedAt) >= start && localKey(t.completedAt) <= end),
    },
    units: inRange(ctx.units),
    adherence: ctx.adherence,
  };
  const value = readCustomMetric(rule.metric, scoped) ?? 0;
  return value >= rule.min;
}

function mondayOf(key: DateKey): DateKey {
  const day = dateKeyToDate(key).getDay();
  return addDaysToKey(key, -((day + 6) % 7));
}

/** Every metric key referenced by a ConditionEngine AST. */
export function collectMetricKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; metric?: unknown; children?: unknown[] };
  if (n.type === 'leaf' && typeof n.metric === 'string') out.add(n.metric);
  for (const c of n.children ?? []) collectMetricKeys(c, out);
  return out;
}
