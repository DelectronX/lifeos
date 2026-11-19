import { db, SCHEMA_VERSION } from '@/db/db';
import { addDaysToKey, todayKey, toDateKey } from '@/lib/date';
import { newId } from '@/lib/id';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { levelProgress } from '@/engines/xp';
import { isRequiredBlock } from '@/engines/customMetrics';
import {
  balanceDue, checklistProgress, earningSummary, isOverdue, paidSoFar, periodKeyFor, projectHealth, skillGap, studyProgress,
  thinThemes, workProgress,
} from '@/engines/workgrowth';
import { getDayProgress } from '@/services/dashboardService';
import {
  completeBlock, createBlock, deleteBlock, getCurrentBlock, getNextBlock, overlaps, reopenBlock, scheduleTaskAt, setBlockTimes,
  settleStartedBlocks, skipBlock, startBlock, updateBlock,
} from '@/services/scheduleService';
import {
  createRecurringRule, deleteFromSeries, describeRule, editSeries, materialiseAllRules, updateRecurringRule,
} from '@/services/recurrenceService';
import { applyAutoPlan, previewAutoPlan, undoLastChange } from '@/services/planService';
import { createTask, deleteTask, rescheduleTaskTo, setTaskStatus, updateTask } from '@/services/taskService';
import { sectionTasks } from '@/services/taskQuery';
import {
  addChecklistItem, createChecklist, deleteChecklist, removeChecklistItem, toggleChecklistItem, updateChecklist,
} from '@/services/checklistService';
import {
  createGoal, createMilestone, deleteGoal, deleteMilestone, toggleMilestone, updateGoal, updateMilestone,
} from '@/services/goalService';
import { progressFromLoaded } from '@/services/goalQuery';
import { customAchievementIssues, readAchievements, upsertCustomAchievement } from '@/services/achievementService';
import { getRecentXP } from '@/services/xpService';
import { currencyBalance } from '@/services/currencyService';
import { createReward, listEarnings, listRewards, redeemReward } from '@/services/rewardService';
import { createTracker } from '@/services/trackerService';
import { isValidCondition, type Condition } from '@/engines/conditionEngine';
import {
  addDeliverable, addProjectTask, createProject, deleteProject, toggleDeliverable, updateProject,
} from '@/services/projectService';
import {
  addMoney, addScore, addSkillEvidence, createContact, createSkill, createSource, createStudy, deleteContact, deleteMoney,
  deletePayment, deleteSkill, deleteSource, deleteStudy, logInteraction, markPaid, parseReference, recordPayment, setContactStage,
  setSkillLevel, toggleSkillPathItem, updateContact, updateMoney, updateSkill, updateSource, updateStudy,
} from '@/services/workgrowthService';
import { checkIn, getHabitStatuses, undoCheckin } from '@/services/habitService';
import { listSessions, loadSnapshot, readTimer, summariseSessions } from '@/services/timerService';
import { computeAnalyticsFor, loadDailyReview, loadWeeklyReview } from '@/services/analyticsService';
import { getSettings, setTheme, updateSettings } from '@/services/settingsService';
import { setStageBackground, setUiMode } from '@/lib/uiMode';
import { useNotificationStore } from '@/state/notificationStore';
import { readSoundPrefs } from '@/lib/sounds';
import { AgentError, guardVersion, invalidState, notFound } from './errors';
import type { PermissionLevel } from './catalog';
import type {
  Activity, BlockKind, DateKey, Goal, ID, ScheduleBlock, Task, Tracker,
} from '@/types';
import type { Checklist, ContactStage, MoneyEntry, Project } from '@/types/workgrowth';

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

export interface HandlerContext { client: string; permission: PermissionLevel }
export interface HandlerOutput {
  data: unknown;
  meta?: Record<string, unknown>;
  /** Primary entity touched — recorded in the audit log. */
  entity?: { type: string; id: string };
}
type Input = Record<string, any>; // validated against the catalog schema before arriving here
type Handler = (input: Input, ctx: HandlerContext) => Promise<HandlerOutput>;

const MINUTE = 60_000;
const out = (data: unknown, entity?: HandlerOutput['entity'], meta?: Record<string, unknown>): HandlerOutput => ({ data, entity, meta });

/** Local wall-clock ISO (no offset) — matches how inputs are read. */
export function localIso(ts: number | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseTime(value: string, field: string): number {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new AgentError('VALIDATION_ERROR', `${field} is not a valid date-time.`);
  return t;
}

function hhmmToMinute(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function paginate<T>(rows: T[], input: Input): HandlerOutput {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  return { data: rows.slice(offset, offset + limit), meta: { total: rows.length, limit, offset, hasMore: offset + limit < rows.length } };
}

async function need<T>(promise: Promise<T | undefined>, what: string, id: string): Promise<T> {
  const v = await promise;
  if (!v) throw notFound(what, id);
  return v;
}

function rangeGuard(from: DateKey, to: DateKey, maxDays = 93): void {
  if (to < from) throw new AgentError('VALIDATION_ERROR', '`to` must not be before `from`.');
  const days = (Date.parse(`${to}T00:00`) - Date.parse(`${from}T00:00`)) / 86_400_000;
  if (days > maxDays) throw new AgentError('VALIDATION_ERROR', `Range too large (max ${maxDays + 1} days).`);
}

function pick<T extends object>(src: Input, keys: readonly (keyof T)[]): Partial<T> {
  const o: Partial<T> = {};
  for (const k of keys) if (src[k as string] !== undefined) o[k] = src[k as string];
  return o;
}

async function trackerMap(): Promise<Record<ID, Tracker>> {
  return Object.fromEntries((await db.trackers.toArray()).map((t) => [t.id, t]));
}

function blockView(b: ScheduleBlock, trackers: Record<ID, Tracker>) {
  return {
    id: b.id, title: b.title, date: b.date, status: b.status, kind: b.kind,
    start: localIso(b.start), end: localIso(b.end), startMs: b.start, endMs: b.end,
    durationMinutes: Math.round((b.end - b.start) / MINUTE),
    trackerId: b.trackerId, trackerName: trackers[b.trackerId]?.name ?? null,
    taskId: b.taskId ?? null, goalId: b.goalId ?? null,
    protected: !!b.protected, locked: !!b.locked, optional: !!b.optional, required: isRequiredBlock(b),
    actualStart: localIso(b.actualStart ?? null), actualEnd: localIso(b.actualEnd ?? null),
    recurringRuleId: b.recurringRuleId ?? null, notes: b.notes ?? null, updatedAt: b.updatedAt,
  };
}

function taskView(t: Task, today = todayKey()) {
  return {
    id: t.id, title: t.title, status: t.status, dueDate: t.dueDate ?? null, deadlineHard: !!t.deadlineHard,
    overdue: !!t.dueDate && t.dueDate < today && !['completed', 'cancelled', 'skipped'].includes(t.status),
    basePriority: t.basePriority, estimatedMinutes: t.estimatedMinutes, actualMinutes: t.actualMinutes,
    type: t.type, trackerId: t.trackerId, goalId: t.goalId ?? null, milestoneId: t.milestoneId ?? null, tags: t.tags ?? [],
    notes: t.notes ?? null, completedAt: localIso(t.completedAt ?? null), createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

function conflictsAmong(blocks: ScheduleBlock[]) {
  const live = blocks.filter((b) => b.status !== 'cancelled').sort((a, b) => a.start - b.start);
  const pairs: Array<{ a: ID; b: ID; aTitle: string; bTitle: string; overlapMinutes: number }> = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].start < live[i].end; j++) {
      if (overlaps(live[i].start, live[i].end, live[j].start, live[j].end)) {
        pairs.push({ a: live[i].id, b: live[j].id, aTitle: live[i].title, bTitle: live[j].title, overlapMinutes: Math.round((Math.min(live[i].end, live[j].end) - live[j].start) / MINUTE) });
      }
    }
  }
  return pairs;
}

async function blockConflicts(block: ScheduleBlock) {
  const day = await db.blocks.where('date').equals(block.date).toArray();
  return day.filter((b) => b.id !== block.id && b.status !== 'cancelled' && overlaps(b.start, b.end, block.start, block.end)).map((b) => ({ id: b.id, title: b.title, start: localIso(b.start), end: localIso(b.end) }));
}

async function goalViews(goals: Goal[]) {
  const [tasks, milestones, activities] = await Promise.all([db.tasks.toArray(), db.milestones.toArray(), db.activities.toArray()]);
  return goals.map((g) => {
    const r = progressFromLoaded(g, tasks, milestones, activities);
    const ms = milestones.filter((m) => m.goalId === g.id).sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: g.id, title: g.title, type: g.type, status: g.status, trackerId: g.trackerId, description: g.description ?? null,
      startDate: g.startDate, targetDate: g.targetDate, targetValue: g.targetValue, unit: g.unit ?? null,
      progress: Math.round(r.progress * 1000) / 1000, completedAt: localIso(g.completedAt), updatedAt: g.updatedAt,
      milestones: ms.map((m) => ({ id: m.id, title: m.title, targetDate: m.targetDate, done: m.completedAt !== null, completedAt: localIso(m.completedAt), weight: m.weight })),
    };
  });
}

async function projectView(p: Project, today = todayKey()) {
  const [milestones, tasks] = await Promise.all([db.milestones.where('goalId').equals(p.goalId).toArray(), db.tasks.where('goalId').equals(p.goalId).toArray()]);
  const wp = workProgress(milestones, tasks, today);
  return {
    id: p.id, title: p.title, kind: p.kind, status: p.status, summary: p.summary ?? null, goalId: p.goalId,
    startDate: p.startDate ?? null, targetDate: p.targetDate ?? null, health: projectHealth(p, wp, today),
    progress: Math.round(wp.progress * 1000) / 1000, repoUrl: p.repoUrl ?? null, demoUrl: p.demoUrl ?? null,
    deliverables: p.deliverables.map((d) => ({ id: d.id, title: d.title, done: d.doneAt !== null })),
    milestones: milestones.sort((a, b) => a.sortOrder - b.sortOrder).map((m) => ({ id: m.id, title: m.title, done: m.completedAt !== null, targetDate: m.targetDate })),
    openTasks: tasks.filter((t) => !['completed', 'cancelled'].includes(t.status)).length, updatedAt: p.updatedAt,
  };
}

async function checklistView(l: Checklist, date: DateKey) {
  const run = await db.checklistRuns.where('[checklistId+periodKey]').equals([l.id, periodKeyFor(l.cadence, date)]).first();
  const p = checklistProgress(l, run, date);
  return {
    id: l.id, title: l.title, cadence: l.cadence, active: l.active, periodKey: periodKeyFor(l.cadence, date),
    done: p.done, total: p.total, complete: p.complete, completionXP: l.completionXP ?? 0, updatedAt: l.updatedAt,
    items: l.items.map((i) => ({ id: i.id, title: i.title, checked: run?.checked[i.id] !== undefined, doneDefinition: i.doneDefinition ?? null, timing: i.timing ?? null })),
  };
}

function moneyView(e: MoneyEntry, today = todayKey()) {
  return { ...e, paidSoFar: paidSoFar(e), balanceDue: balanceDue(e), overdue: isOverdue(e, today) };
}

async function appCurrency(): Promise<string> {
  const profile = await db.profile.toCollection().first() as { currency?: string } | undefined;
  return profile?.currency ?? (await db.money.toCollection().first())?.currency ?? 'INR';
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

export const HANDLERS: Record<string, Handler> = {
  /* Overview */
  async dashboard_get(i) {
    const date = i.date ?? todayKey();
    const now = Date.now();
    const [progress, trackers, profile, settings, tasks, current, next, sessions, recentAch] = await Promise.all([
      getDayProgress(date), trackerMap(), db.profile.get('profile'), getSettings(), db.tasks.toArray(),
      date === todayKey() ? getCurrentBlock(now) : Promise.resolve(undefined),
      date === todayKey() ? getNextBlock(now) : Promise.resolve(undefined),
      db.sessions.where('date').equals(date).toArray(),
      db.achievements.where('unlockedAt').above(0).reverse().sortBy('unlockedAt'),
    ]);
    const sections = sectionTasks(tasks, date);
    const xp = levelProgress(profile?.totalXP ?? 0, mergeSchedulingConfig(settings.scheduling).xp);
    const upcoming = tasks.filter((t) => t.dueDate && t.dueDate > date && t.dueDate <= addDaysToKey(date, 7) && !['completed', 'cancelled', 'skipped'].includes(t.status))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return out({
      date, progress,
      currentBlock: current ? blockView(current, trackers) : null,
      nextBlock: next ? blockView(next, trackers) : null,
      overdueTasks: sections.overdue.slice(0, 10).map((t) => taskView(t, date)), overdueCount: sections.overdue.length,
      dueToday: sections.today.filter((t) => t.status !== 'completed').map((t) => taskView(t, date)),
      upcomingDeadlines: upcoming.slice(0, 10).map((t) => taskView(t, date)),
      streak: { current: profile?.currentStreak ?? 0, longest: profile?.longestStreak ?? 0 },
      level: { level: xp.level, totalXP: xp.totalXP, intoLevel: xp.into, levelSpan: xp.span, progress: xp.progress },
      focus: { minutes: Math.round(sessions.reduce((s, x) => s + x.workMs, 0) / MINUTE), sessions: sessions.length, completed: sessions.filter((x) => x.completed).length },
      recentAchievements: recentAch.slice(0, 5).map((a) => ({ key: a.key, title: a.title, unlockedAt: localIso(a.unlockedAt) })),
    });
  },

  async progress_get(i) {
    const anchor: DateKey = i.date ?? todayKey();
    const d = new Date(`${anchor}T00:00`);
    let from = anchor; let to = anchor;
    if (i.period === 'week') { from = addDaysToKey(anchor, -((d.getDay() + 6) % 7)); to = addDaysToKey(from, 6); }
    if (i.period === 'month') { from = `${anchor.slice(0, 7)}-01`; to = toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime()); }
    const [blocks, acts, xp, runs] = await Promise.all([
      db.blocks.where('date').between(from, to, true, true).toArray(),
      db.activities.where('date').between(from, to, true, true).toArray(),
      db.xp.where('date').between(from, to, true, true).toArray(),
      db.checklistRuns.filter((r) => r.completedAt !== null && toDateKey(r.completedAt) >= from && toDateKey(r.completedAt) <= to).toArray(),
    ]);
    const days: DateKey[] = [];
    for (let k = from; k <= to; k = addDaysToKey(k, 1)) days.push(k);
    const perDay = days.map((date) => {
      const req = blocks.filter((b) => b.date === date && isRequiredBlock(b));
      const a = acts.filter((x) => x.date === date);
      return {
        date, requiredBlocks: req.length, requiredCompleted: req.filter((b) => b.status === 'completed').length,
        tasksCompleted: a.filter((x) => x.type === 'task_completed').length,
        trackedMinutes: Math.round(a.reduce((s, x) => s + x.durationMs, 0) / MINUTE),
        xp: xp.filter((x) => x.date === date).reduce((s, x) => s + x.amount, 0),
      };
    });
    const sum = (k: keyof (typeof perDay)[number]) => perDay.reduce((s, x) => s + (x[k] as number), 0);
    const req = sum('requiredBlocks');
    return out({
      period: i.period, from, to,
      totals: {
        requiredBlocks: req, requiredCompleted: sum('requiredCompleted'), completionRate: req ? sum('requiredCompleted') / req : null,
        tasksCompleted: sum('tasksCompleted'), trackedMinutes: sum('trackedMinutes'), xp: sum('xp'), checklistsCompleted: runs.length,
      },
      days: i.period === 'day' ? undefined : perDay,
      today: i.period === 'day' ? await getDayProgress(anchor) : undefined,
    });
  },

  /* Schedule */
  async schedule_get_day(i) {
    const date = i.date ?? todayKey();
    const [blocks, trackers] = await Promise.all([db.blocks.where('date').equals(date).toArray(), trackerMap()]);
    const list = blocks.filter((b) => i.includeCancelled || b.status !== 'cancelled').sort((a, b) => a.start - b.start);
    return out({ date, blocks: list.map((b) => blockView(b, trackers)), conflicts: conflictsAmong(list) });
  },
  async schedule_list_blocks(i) {
    rangeGuard(i.from, i.to);
    const [blocks, trackers] = await Promise.all([db.blocks.where('[date+start]').between([i.from, -Infinity], [i.to, Infinity]).toArray(), trackerMap()]);
    const rows = blocks
      .filter((b) => (!i.status || i.status.includes(b.status)) && (!i.trackerId || b.trackerId === i.trackerId) && (!i.kind || i.kind.includes(b.kind)))
      .sort((a, b) => a.start - b.start).map((b) => blockView(b, trackers));
    return paginate(rows, i);
  },
  async schedule_get_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    return out({ ...blockView(b, await trackerMap()), conflicts: await blockConflicts(b) }, { type: 'block', id: b.id });
  },
  async schedule_get_current() {
    const now = Date.now();
    const [cur, next, trackers] = await Promise.all([getCurrentBlock(now), getNextBlock(now), trackerMap()]);
    return out({ now: localIso(now), current: cur ? blockView(cur, trackers) : null, next: next ? blockView(next, trackers) : null });
  },
  async schedule_create_block(i) {
    const start = parseTime(i.start, 'start'); const end = parseTime(i.end, 'end');
    if (end <= start) throw new AgentError('VALIDATION_ERROR', '`end` must be after `start`.');
    await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    if (i.taskId) await need(db.tasks.get(i.taskId), 'Task', i.taskId);
    if (i.goalId) await need(db.goals.get(i.goalId), 'Goal', i.goalId);
    const b = await createBlock({
      title: i.title.trim(), start, end, trackerId: i.trackerId, kind: (i.kind ?? (i.taskId ? 'task' : 'fixed')) as BlockKind,
      taskId: i.taskId ?? null, goalId: i.goalId ?? null, notes: i.notes, protected: i.protected, locked: i.locked, origin: 'manual',
    });
    if (i.optional) { await db.blocks.update(b.id, { optional: true }); b.optional = true; }
    return out({ block: blockView(b, await trackerMap()), conflicts: await blockConflicts(b) }, { type: 'block', id: b.id });
  },
  async schedule_update_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    guardVersion(b, i.expectedUpdatedAt, 'Block');
    if (i.trackerId) await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    const patch = pick<ScheduleBlock>(i, ['title', 'notes', 'trackerId', 'kind', 'protected', 'locked', 'taskId', 'goalId']);
    await updateBlock(b.id, patch);
    return out(blockView((await db.blocks.get(b.id))!, await trackerMap()), { type: 'block', id: b.id });
  },
  async schedule_reschedule_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    guardVersion(b, i.expectedUpdatedAt, 'Block');
    if (b.locked) throw invalidState('Block is locked; unlock it first (schedule_update_block locked:false).');
    if (b.status === 'completed') throw invalidState('Completed blocks cannot be moved; reopen it first.');
    const start = parseTime(i.start, 'start');
    const end = i.end ? parseTime(i.end, 'end') : start + (b.end - b.start);
    if (end <= start) throw new AgentError('VALIDATION_ERROR', '`end` must be after `start`.');
    await setBlockTimes(b.id, start, end);
    const after = (await db.blocks.get(b.id))!;
    return out({ block: blockView(after, await trackerMap()), conflicts: await blockConflicts(after) }, { type: 'block', id: b.id });
  },
  async schedule_complete_block(i) {
    const r = await completeBlock(i.id, { trackerId: i.trackerId, units: i.units });
    if (r.status === 'not_found') throw notFound('Block', i.id);
    if (r.status === 'invalid_state') throw invalidState(`Block is ${r.blockStatus} and cannot be completed.`, r);
    const b = (await db.blocks.get(i.id))!;
    return out({ result: r.status, block: blockView(b, await trackerMap()) }, { type: 'block', id: i.id });
  },
  async schedule_reopen_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    if (b.status === 'planned') return out({ result: 'already_open', block: blockView(b, await trackerMap()) }, { type: 'block', id: b.id });
    await reopenBlock(b.id);
    return out({ result: 'reopened', block: blockView((await db.blocks.get(b.id))!, await trackerMap()) }, { type: 'block', id: b.id });
  },
  async schedule_start_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    if (b.status === 'in_progress') return out({ result: 'already_started', block: blockView(b, await trackerMap()) }, { type: 'block', id: b.id });
    if (b.status !== 'planned') throw invalidState(`Block is ${b.status}; only planned blocks can be started.`);
    await startBlock(b.id);
    return out({ result: 'started', block: blockView((await db.blocks.get(b.id))!, await trackerMap()) }, { type: 'block', id: b.id });
  },
  async schedule_skip_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    if (b.status === 'skipped') return out({ result: 'already_skipped' }, { type: 'block', id: b.id });
    if (b.status === 'completed') throw invalidState('Block is completed; reopen it before skipping.');
    await skipBlock(b.id, i.reason);
    return out({ result: 'skipped', block: blockView((await db.blocks.get(b.id))!, await trackerMap()) }, { type: 'block', id: b.id });
  },
  async schedule_cancel_block(i) {
    const b = await need(db.blocks.get(i.id), 'Block', i.id);
    guardVersion(b, i.expectedUpdatedAt, 'Block');
    if (b.status === 'cancelled') return out({ result: 'already_cancelled' }, { type: 'block', id: b.id });
    if (b.status === 'completed') throw invalidState('Block is completed; reopen it before cancelling.');
    await updateBlock(b.id, { status: 'cancelled' });
    return out({ result: 'cancelled' }, { type: 'block', id: b.id });
  },
  async schedule_delete_block(i) {
    const b = await db.blocks.get(i.id);
    if (!b) return out({ result: 'already_deleted' }, { type: 'block', id: i.id });
    await deleteBlock(b.id);
    return out({ result: 'deleted', title: b.title }, { type: 'block', id: b.id });
  },
  async schedule_get_conflicts(i) {
    const to = i.to ?? i.from; rangeGuard(i.from, to);
    const blocks = await db.blocks.where('date').between(i.from, to, true, true).toArray();
    const byDay: Record<string, ReturnType<typeof conflictsAmong>> = {};
    for (const date of new Set(blocks.map((b) => b.date))) {
      const c = conflictsAmong(blocks.filter((b) => b.date === date));
      if (c.length) byDay[date] = c;
    }
    return out({ from: i.from, to, conflicts: byDay, total: Object.values(byDay).reduce((s, x) => s + x.length, 0) });
  },
  async schedule_completion_history(i) {
    rangeGuard(i.from, i.to, 366);
    const rows = (await db.activities.where('date').between(i.from, i.to, true, true).toArray())
      .filter((a) => (a.type === 'block_completed' || a.type === 'block_skipped') && (!i.trackerId || a.trackerId === i.trackerId))
      .sort((a, b) => b.at - a.at)
      .map((a) => ({ type: a.type, blockId: a.blockId, title: a.title, at: localIso(a.at), date: a.date, minutes: Math.round(a.durationMs / MINUTE), trackerId: a.trackerId, source: (a.meta?.source as string) ?? 'user' }));
    return paginate(rows, i);
  },
  async schedule_run_auto_completion() {
    const settled = await settleStartedBlocks();
    return out({ completed: settled });
  },
  async schedule_auto_completion_status() {
    const [started, trackers] = await Promise.all([db.blocks.where('status').equals('in_progress').toArray(), trackerMap()]);
    const now = Date.now();
    return out({
      rule: 'A block you started is completed automatically at its planned end. Blocks never started are not auto-completed.',
      pending: started.filter((b) => b.end <= now).map((b) => blockView(b, trackers)),
      running: started.filter((b) => b.end > now).map((b) => blockView(b, trackers)),
    });
  },

  /* Recurring */
  async recurring_list(i) {
    const rules = (await db.recurringRules.toArray()).filter((r) => !i.activeOnly || r.active);
    return out(rules.map((r) => ({ id: r.id, title: r.title, description: describeRule(r), active: r.active, freq: r.freq, interval: r.interval, byWeekday: r.byWeekday, byMonthDay: r.byMonthDay, startDate: r.startDate, endDate: r.endDate, target: r.target, blockTemplate: r.blockTemplate, updatedAt: r.updatedAt })));
  },
  async recurring_create(i) {
    await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    if (i.freq === 'weekly' && !(i.byWeekday?.length)) throw new AgentError('VALIDATION_ERROR', 'Weekly rules need byWeekday.');
    const rule = await createRecurringRule({
      title: i.title, freq: i.freq, interval: i.interval, byWeekday: i.byWeekday, byMonthDay: i.byMonthDay,
      startDate: i.startDate ?? todayKey(), endDate: i.endDate ?? null, target: 'block',
      blockTemplate: { startMinute: hhmmToMinute(i.startTime), durationMinutes: i.durationMinutes, trackerId: i.trackerId, title: i.title, kind: i.kind ?? 'fixed', protected: !!i.protected, notes: i.notes },
    });
    const from = i.startDate && i.startDate > todayKey() ? i.startDate : todayKey();
    const gen = await materialiseAllRules(from, addDaysToKey(from, 59));
    return out({ rule: { id: rule.id, description: describeRule(rule) }, generated: gen }, { type: 'recurringRule', id: rule.id });
  },
  async recurring_edit(i) {
    await need(db.recurringRules.get(i.ruleId), 'Recurring rule', i.ruleId);
    const message = await editSeries(i.ruleId, i.occurrenceDate, i.scope, {
      title: i.title, startMinute: i.startTime ? hhmmToMinute(i.startTime) : undefined, durationMinutes: i.durationMinutes,
      trackerId: i.trackerId, kind: i.kind, protected: i.protected, notes: i.notes,
    });
    return out({ message }, { type: 'recurringRule', id: i.ruleId });
  },
  async recurring_set_active(i) {
    const r = await need(db.recurringRules.get(i.ruleId), 'Recurring rule', i.ruleId);
    if (r.active !== i.active) await updateRecurringRule(r.id, { active: i.active });
    if (i.active) await materialiseAllRules(todayKey(), addDaysToKey(todayKey(), 59));
    return out({ id: r.id, active: i.active }, { type: 'recurringRule', id: r.id });
  },
  async recurring_delete(i) {
    await need(db.recurringRules.get(i.ruleId), 'Recurring rule', i.ruleId);
    return out({ message: await deleteFromSeries(i.ruleId, i.occurrenceDate, i.scope) }, { type: 'recurringRule', id: i.ruleId });
  },

  /* Planning */
  async plan_preview(i) {
    const p = await previewAutoPlan({ from: i.from, days: i.days, taskIds: i.taskIds, regenerate: i.regenerate });
    return out({
      dates: p.dates, proposedMinutes: p.proposedMinutes,
      proposals: p.result.proposals.map((x) => ({ taskId: x.taskId, title: x.title, date: x.date, start: localIso(x.start), end: localIso(x.end), minutes: x.durationMinutes, trackerId: x.trackerId, reason: x.reason })),
      unplaced: p.result.unplaced.map((u) => ({ taskId: u.taskId, title: u.title, reason: u.reason, code: u.code, missingMinutes: u.missingMinutes })),
      explanation: p.result.explanation,
    });
  },
  async plan_apply(i) {
    const p = await previewAutoPlan({ from: i.from, days: i.days, taskIds: i.taskIds, regenerate: i.regenerate });
    const accepted = i.acceptTaskIds ? p.result.proposals.filter((x) => x.taskId && i.acceptTaskIds.includes(x.taskId)).map((x) => x.tempId) : undefined;
    const r = await applyAutoPlan(p, accepted);
    return out(r);
  },
  async plan_undo_last() { return out(await undoLastChange()); },

  /* Tasks */
  async tasks_list(i) {
    const today = todayKey();
    const q = (i.search ?? '').toLowerCase();
    let rows = (await db.tasks.toArray()).filter((t) =>
      (!i.status || i.status.includes(t.status)) && (!i.trackerId || t.trackerId === i.trackerId) && (!i.goalId || t.goalId === i.goalId)
      && (!i.tag || (t.tags ?? []).includes(i.tag)) && (!i.dueFrom || (t.dueDate && t.dueDate >= i.dueFrom)) && (!i.dueTo || (t.dueDate && t.dueDate <= i.dueTo))
      && (!q || `${t.title} ${t.notes ?? ''}`.toLowerCase().includes(q)));
    const key = i.sort ?? 'dueDate'; const dir = i.order === 'desc' ? -1 : 1;
    rows = rows.sort((a, b) => {
      const va = key === 'priority' ? a.basePriority : (a as never)[key] ?? ''; const vb = key === 'priority' ? b.basePriority : (b as never)[key] ?? '';
      if (key === 'dueDate') { if (!a.dueDate) return 1; if (!b.dueDate) return -1; }
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
    return paginate(rows.map((t) => taskView(t, today)), i);
  },
  async tasks_get(i) {
    const t = await need(db.tasks.get(i.id), 'Task', i.id);
    const [blocks, acts, trackers] = await Promise.all([db.blocks.where('taskId').equals(t.id).toArray(), db.activities.where('taskId').equals(t.id).toArray(), trackerMap()]);
    return out({ ...taskView(t), blocks: blocks.sort((a, b) => a.start - b.start).map((b) => blockView(b, trackers)), history: acts.sort((a, b) => b.at - a.at).slice(0, 50).map((a) => ({ type: a.type, at: localIso(a.at), minutes: Math.round(a.durationMs / MINUTE), title: a.title })) }, { type: 'task', id: t.id });
  },
  async tasks_overdue(i) {
    const today = todayKey();
    const rows = sectionTasks(await db.tasks.toArray(), today).overdue.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return paginate(rows.map((t) => taskView(t, today)), i);
  },
  async tasks_upcoming(i) {
    const today = todayKey(); const until = addDaysToKey(today, i.days ?? 7);
    const rows = (await db.tasks.toArray()).filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= until && !['completed', 'cancelled', 'skipped'].includes(t.status))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || b.basePriority - a.basePriority);
    return paginate(rows.map((t) => taskView(t, today)), i);
  },
  async tasks_create(i) {
    await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    if (i.goalId) await need(db.goals.get(i.goalId), 'Goal', i.goalId);
    const t = await createTask({ ...pick(i, ['notes', 'dueDate', 'deadlineHard', 'basePriority', 'estimatedMinutes', 'type', 'goalId', 'milestoneId', 'tags', 'preferredWindow', 'intensity', 'flexibility', 'status']), title: i.title.trim(), trackerId: i.trackerId } as never);
    return out(taskView(t), { type: 'task', id: t.id });
  },
  async tasks_update(i) {
    const t = await need(db.tasks.get(i.id), 'Task', i.id);
    guardVersion(t, i.expectedUpdatedAt, 'Task');
    await updateTask(t.id, pick<Task>(i, ['title', 'notes', 'dueDate', 'deadlineHard', 'basePriority', 'estimatedMinutes', 'type', 'trackerId', 'goalId', 'milestoneId', 'tags', 'preferredWindow', 'intensity', 'flexibility']) as Partial<Task>);
    return out(taskView((await db.tasks.get(t.id))!), { type: 'task', id: t.id });
  },
  async tasks_set_status(i) {
    const t = await need(db.tasks.get(i.id), 'Task', i.id);
    if (t.status === i.status) return out({ result: 'unchanged', task: taskView(t) }, { type: 'task', id: t.id });
    const r = await setTaskStatus(t.id, i.status, { reason: i.reason, actualMinutes: i.actualMinutes });
    if (!r) throw invalidState(`Cannot move task from ${t.status} to ${i.status}.`);
    const after = (await db.tasks.get(t.id))!;
    if (after.status !== i.status) throw invalidState(`Transition ${t.status} → ${i.status} is not allowed.`);
    return out({ result: 'changed', task: taskView(after) }, { type: 'task', id: t.id });
  },
  async tasks_reschedule(i) {
    const t = await need(db.tasks.get(i.id), 'Task', i.id);
    if ((t.dueDate ?? null) === i.dueDate) return out({ result: 'unchanged', task: taskView(t) }, { type: 'task', id: t.id });
    await rescheduleTaskTo(t.id, i.dueDate, i.reason);
    return out({ result: 'rescheduled', task: taskView((await db.tasks.get(t.id))!) }, { type: 'task', id: t.id });
  },
  async tasks_schedule_at(i) {
    await need(db.tasks.get(i.id), 'Task', i.id);
    const b = await scheduleTaskAt(i.id, parseTime(i.start, 'start'), i.minutes);
    if (!b) throw invalidState('The task could not be scheduled (it may be completed or have no remaining time).');
    return out({ block: blockView(b, await trackerMap()), conflicts: await blockConflicts(b) }, { type: 'task', id: i.id });
  },
  async tasks_delete(i) {
    const t = await db.tasks.get(i.id);
    if (!t) return out({ result: 'already_deleted' }, { type: 'task', id: i.id });
    await deleteTask(t.id);
    return out({ result: 'deleted', title: t.title }, { type: 'task', id: t.id });
  },

  /* Checklists */
  async checklists_list(i) {
    const date = i.date ?? todayKey();
    const lists = (await db.checklists.orderBy('sortOrder').toArray()).filter((l) => (i.includeInactive || l.active) && (!i.cadence || l.cadence === i.cadence));
    return out(await Promise.all(lists.map((l) => checklistView(l, date))));
  },
  async checklists_create(i) {
    if (i.trackerId) await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    const l = await createChecklist({ title: i.title, cadence: i.cadence, description: i.description, items: i.items, completionXP: i.completionXP, trackerId: i.trackerId });
    return out(await checklistView(l, todayKey()), { type: 'checklist', id: l.id });
  },
  async checklists_update(i) {
    const l = await need(db.checklists.get(i.id), 'Checklist', i.id);
    guardVersion(l, i.expectedUpdatedAt, 'Checklist');
    await updateChecklist(l.id, pick<Checklist>(i, ['title', 'description', 'active', 'completionXP']));
    return out(await checklistView((await db.checklists.get(l.id))!, todayKey()), { type: 'checklist', id: l.id });
  },
  async checklists_add_item(i) {
    await need(db.checklists.get(i.id), 'Checklist', i.id);
    await addChecklistItem(i.id, { title: i.title, doneDefinition: i.doneDefinition, timing: i.timing });
    return out(await checklistView((await db.checklists.get(i.id))!, todayKey()), { type: 'checklist', id: i.id });
  },
  async checklists_remove_item(i) {
    const l = await need(db.checklists.get(i.id), 'Checklist', i.id);
    if (!l.items.some((x) => x.id === i.itemId)) return out({ result: 'already_removed' }, { type: 'checklist', id: l.id });
    await removeChecklistItem(l.id, i.itemId);
    return out({ result: 'removed' }, { type: 'checklist', id: l.id });
  },
  async checklists_set_item(i) {
    const l = await need(db.checklists.get(i.id), 'Checklist', i.id);
    if (!l.items.some((x) => x.id === i.itemId)) throw notFound('Checklist item', i.itemId);
    const date = i.date ?? todayKey();
    const run = await db.checklistRuns.where('[checklistId+periodKey]').equals([l.id, periodKeyFor(l.cadence, date)]).first();
    const isChecked = run?.checked[i.itemId] !== undefined;
    let justCompleted = false;
    if (isChecked !== i.checked) justCompleted = (await toggleChecklistItem(l.id, i.itemId, date)).justCompleted;
    return out({ result: isChecked === i.checked ? 'unchanged' : 'changed', justCompleted, checklist: await checklistView((await db.checklists.get(l.id))!, date) }, { type: 'checklist', id: l.id });
  },
  async checklists_delete(i) {
    const l = await db.checklists.get(i.id);
    if (!l) return out({ result: 'already_deleted' }, { type: 'checklist', id: i.id });
    await deleteChecklist(l.id);
    return out({ result: 'deleted', title: l.title }, { type: 'checklist', id: l.id });
  },

  /* Goals */
  async goals_list(i) {
    const goals = (await db.goals.toArray()).filter((g) => (!i.status || i.status.includes(g.status)) && (!i.trackerId || g.trackerId === i.trackerId));
    return paginate(await goalViews(goals), i);
  },
  async goals_get(i) {
    const g = await need(db.goals.get(i.id), 'Goal', i.id);
    const [view] = await goalViews([g]);
    const tasks = await db.tasks.where('goalId').equals(g.id).toArray();
    return out({ ...view, tasks: tasks.map((t) => taskView(t)) }, { type: 'goal', id: g.id });
  },
  async goals_history(i) {
    await need(db.goals.get(i.id), 'Goal', i.id);
    const acts = (await db.activities.where('goalId').equals(i.id).toArray()).sort((a, b) => b.at - a.at);
    return paginate(acts.map((a) => ({ type: a.type, title: a.title, at: localIso(a.at), minutes: Math.round(a.durationMs / MINUTE), value: a.value })), i);
  },
  async goals_create(i) {
    await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    const g = await createGoal({ title: i.title, type: i.type, trackerId: i.trackerId, description: i.description, targetDate: i.targetDate, targetValue: i.targetValue, unit: i.unit, color: i.color });
    for (const m of i.milestones ?? []) await createMilestone(g.id, m);
    const [view] = await goalViews([(await db.goals.get(g.id))!]);
    return out(view, { type: 'goal', id: g.id });
  },
  async goals_update(i) {
    const g = await need(db.goals.get(i.id), 'Goal', i.id);
    guardVersion(g, i.expectedUpdatedAt, 'Goal');
    await updateGoal(g.id, pick<Goal>(i, ['title', 'description', 'status', 'targetDate', 'targetValue', 'unit', 'color']));
    const [view] = await goalViews([(await db.goals.get(g.id))!]);
    return out(view, { type: 'goal', id: g.id });
  },
  async goals_delete(i) {
    const g = await db.goals.get(i.id);
    if (!g) return out({ result: 'already_deleted' }, { type: 'goal', id: i.id });
    await deleteGoal(g.id);
    return out({ result: 'deleted', title: g.title }, { type: 'goal', id: g.id });
  },
  async milestones_create(i) {
    await need(db.goals.get(i.goalId), 'Goal', i.goalId);
    const m = await createMilestone(i.goalId, i.title, i.targetDate ?? null, i.weight ?? 1);
    return out(m, { type: 'milestone', id: m.id });
  },
  async milestones_update(i) {
    const m = await need(db.milestones.get(i.id), 'Milestone', i.id);
    await updateMilestone(m.id, pick(i, ['title', 'targetDate', 'weight']));
    return out(await db.milestones.get(m.id), { type: 'milestone', id: m.id });
  },
  async milestones_set_done(i) {
    const m = await need(db.milestones.get(i.id), 'Milestone', i.id);
    const isDone = m.completedAt !== null;
    if (isDone !== i.done) await toggleMilestone(m.id);
    return out({ result: isDone === i.done ? 'unchanged' : 'changed', milestone: await db.milestones.get(m.id) }, { type: 'milestone', id: m.id });
  },
  async milestones_delete(i) {
    const m = await db.milestones.get(i.id);
    if (!m) return out({ result: 'already_deleted' }, { type: 'milestone', id: i.id });
    await deleteMilestone(m.id);
    return out({ result: 'deleted' }, { type: 'milestone', id: m.id });
  },

  /* Achievements / XP / rewards */
  async achievements_list(i) {
    const r = await readAchievements();
    const rows = r.views
      .filter((v) => (i.unlocked === undefined || v.unlocked === i.unlocked) && (!i.category || v.definition.category === i.category))
      .map((v) => ({ key: v.definition.key, title: v.definition.title, description: v.definition.description, category: v.definition.category, tier: v.definition.tier, xpReward: v.definition.xpReward, current: v.current, target: v.target, unlocked: v.unlocked, unlockedAt: localIso(v.unlockedAt ?? null) }));
    return paginate(rows, i);
  },
  async xp_get(i) {
    const [profile, settings, recent] = await Promise.all([db.profile.get('profile'), getSettings(), getRecentXP(i.recent ?? 20)]);
    const lp = levelProgress(profile?.totalXP ?? 0, mergeSchedulingConfig(settings.scheduling).xp);
    return out({ level: lp.level, totalXP: lp.totalXP, intoLevel: lp.into, levelSpan: lp.span, progress: lp.progress, streak: { current: profile?.currentStreak ?? 0, longest: profile?.longestStreak ?? 0 }, recent: recent.map((t) => ({ at: localIso(t.at), amount: t.amount, reason: t.reason, description: t.description })) });
  },
  async rewards_list() {
    const [rewards, balance, earnings] = await Promise.all([listRewards(false), currencyBalance(), listEarnings()]);
    return out({ balance, rewards, recentEarnings: earnings.slice(0, 30) });
  },
  async achievements_create(i) {
    const def = i as unknown as Parameters<typeof upsertCustomAchievement>[0];
    const issues = customAchievementIssues(def);
    if (issues.length) throw new AgentError('VALIDATION_ERROR', issues.join(' '), { issues });
    const r = await upsertCustomAchievement(def);
    return out({ result: r.created ? 'created' : 'updated', achievement: { key: r.achievement.key, title: r.achievement.title, category: r.achievement.category, target: r.achievement.target, xpReward: r.achievement.xpReward, progress: r.achievement.progress, unlockedAt: localIso(r.achievement.unlockedAt ?? null) } }, { type: 'achievement', id: r.achievement.id });
  },
  async rewards_create(i) {
    const kind = i.kind ?? 'redeemable';
    if (kind === 'redeemable' && !i.cost) throw new AgentError('VALIDATION_ERROR', 'A redeemable reward needs a cost.');
    if (kind === 'condition' && !isValidCondition(i.condition)) throw new AgentError('VALIDATION_ERROR', 'A condition reward needs a valid condition tree.');
    const existing = (await db.rewards.toArray()).find((r) => !r.archived && r.name.trim().toLowerCase() === String(i.name).trim().toLowerCase());
    if (existing) return out({ result: 'already_exists', reward: existing }, { type: 'reward', id: existing.id });
    const condition: Condition = kind === 'condition' ? i.condition : { id: 'root', type: 'and', children: [] } as Condition;
    const reward = await createReward({ name: i.name, description: i.description, treat: i.treat ?? i.name, xpValue: i.xpValue, condition, repeat: i.repeat ?? 'once', kind, cost: i.cost });
    return out({ result: 'created', reward }, { type: 'reward', id: reward.id });
  },
  async rewards_redeem(i) {
    await need(db.rewards.get(i.id), 'Reward', i.id);
    const r = await redeemReward(i.id);
    if (!r.ok) throw invalidState(r.message);
    return out(r, { type: 'reward', id: i.id });
  },

  /* Projects */
  async projects_list(i) {
    const today = todayKey();
    const rows = (await db.projects.orderBy('sortOrder').toArray()).filter((p) => !i.status || i.status.includes(p.status));
    return paginate(await Promise.all(rows.map((p) => projectView(p, today))), i);
  },
  async projects_get(i) {
    const p = await need(db.projects.get(i.id), 'Project', i.id);
    const view = await projectView(p);
    const history = (await db.activities.where('goalId').equals(p.goalId).toArray()).sort((a, b) => b.at - a.at).slice(0, 30).map((a) => ({ type: a.type, title: a.title, at: localIso(a.at) }));
    return out({ ...view, history }, { type: 'project', id: p.id });
  },
  async projects_create(i) {
    if (i.trackerId) await need(db.trackers.get(i.trackerId), 'Tracker', i.trackerId);
    const p = await createProject(pick(i, ['title', 'summary', 'kind', 'status', 'trackerId', 'startDate', 'targetDate', 'definitionOfDone', 'milestones', 'deliverables', 'repoUrl', 'demoUrl']) as never);
    return out(await projectView(p), { type: 'project', id: p.id });
  },
  async projects_update(i) {
    const p = await need(db.projects.get(i.id), 'Project', i.id);
    guardVersion(p, i.expectedUpdatedAt, 'Project');
    await updateProject(p.id, pick<Project>(i, ['title', 'summary', 'kind', 'status', 'startDate', 'targetDate', 'definitionOfDone', 'repoUrl', 'demoUrl']));
    return out(await projectView((await db.projects.get(p.id))!), { type: 'project', id: p.id });
  },
  async projects_add_task(i) {
    const p = await need(db.projects.get(i.id), 'Project', i.id);
    const t = await addProjectTask(p, i.title, { milestoneId: i.milestoneId, estimatedMinutes: i.estimatedMinutes, dueDate: i.dueDate });
    return out(taskView(t), { type: 'project', id: p.id });
  },
  async projects_add_deliverable(i) {
    await need(db.projects.get(i.id), 'Project', i.id);
    await addDeliverable(i.id, i.title);
    return out(await projectView((await db.projects.get(i.id))!), { type: 'project', id: i.id });
  },
  async projects_set_deliverable(i) {
    const p = await need(db.projects.get(i.id), 'Project', i.id);
    const d = p.deliverables.find((x) => x.id === i.deliverableId);
    if (!d) throw notFound('Deliverable', i.deliverableId);
    if ((d.doneAt !== null) !== i.done) await toggleDeliverable(p.id, d.id);
    return out(await projectView((await db.projects.get(p.id))!), { type: 'project', id: p.id });
  },
  async projects_delete(i) {
    const p = await db.projects.get(i.id);
    if (!p) return out({ result: 'already_deleted' }, { type: 'project', id: i.id });
    await deleteProject(p.id);
    return out({ result: 'deleted', title: p.title }, { type: 'project', id: p.id });
  },

  /* Skills */
  async skills_list(i) {
    const rows = (await db.skills.orderBy('sortOrder').toArray()).filter((x) => !i.category || x.category === i.category);
    return out(rows.map((x) => ({ ...x, gap: skillGap(x), pathDone: x.path.filter((p) => p.doneAt).length, pathTotal: x.path.length })));
  },
  async skills_create(i) {
    const x = await createSkill(pick(i, ['name', 'category', 'level', 'targetLevel', 'trackerId', 'notes']) as never);
    return out(x, { type: 'skill', id: x.id });
  },
  async skills_update(i) {
    const x = await need(db.skills.get(i.id), 'Skill', i.id);
    guardVersion(x, i.expectedUpdatedAt, 'Skill');
    await updateSkill(x.id, pick(i, ['name', 'category', 'targetLevel', 'notes']));
    return out(await db.skills.get(x.id), { type: 'skill', id: x.id });
  },
  async skills_set_level(i) {
    const x = await need(db.skills.get(i.id), 'Skill', i.id);
    if (x.level !== i.level) await setSkillLevel(x.id, i.level);
    return out(await db.skills.get(x.id), { type: 'skill', id: x.id });
  },
  async skills_add_evidence(i) {
    await need(db.skills.get(i.id), 'Skill', i.id);
    await addSkillEvidence(i.id, { title: i.title, kind: i.kind, date: i.date ?? todayKey(), url: i.url, note: i.note });
    return out(await db.skills.get(i.id), { type: 'skill', id: i.id });
  },
  async skills_add_path_item(i) {
    const x = await need(db.skills.get(i.id), 'Skill', i.id);
    await updateSkill(x.id, { path: [...x.path, { id: newId('sp'), title: i.title.trim(), doneAt: null }] });
    return out(await db.skills.get(x.id), { type: 'skill', id: x.id });
  },
  async skills_set_path_item(i) {
    const x = await need(db.skills.get(i.id), 'Skill', i.id);
    const item = x.path.find((p) => p.id === i.itemId);
    if (!item) throw notFound('Path item', i.itemId);
    if ((item.doneAt !== null) !== i.done) await toggleSkillPathItem(x.id, item.id);
    return out(await db.skills.get(x.id), { type: 'skill', id: x.id });
  },
  async skills_delete(i) {
    const x = await db.skills.get(i.id);
    if (!x) return out({ result: 'already_deleted' }, { type: 'skill', id: i.id });
    await deleteSkill(x.id);
    return out({ result: 'deleted', name: x.name }, { type: 'skill', id: x.id });
  },

  /* Earning */
  async earning_summary(i) {
    rangeGuard(i.from, i.to, 3660);
    const [entries, contacts] = await Promise.all([db.money.toArray(), db.contacts.toArray()]);
    return out(earningSummary(entries, contacts, i.from, i.to, todayKey(), i.currency ?? await appCurrency()));
  },
  async contacts_list(i) {
    const today = todayKey(); const q = (i.search ?? '').toLowerCase();
    const rows = (await db.contacts.toArray()).filter((c) => (!i.stage || i.stage.includes(c.stage)) && (!i.followUpDue || (c.nextFollowUp && c.nextFollowUp <= today))
      && (!q || `${c.name} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
    return paginate(rows, i);
  },
  async contacts_create(i) {
    const c = await createContact(pick(i, ['name', 'company', 'email', 'phone', 'website', 'source', 'stage', 'dealValue', 'service', 'nextFollowUp', 'tags', 'notes']) as never);
    return out(c, { type: 'contact', id: c.id });
  },
  async contacts_update(i) {
    const c = await need(db.contacts.get(i.id), 'Contact', i.id);
    guardVersion(c, i.expectedUpdatedAt, 'Contact');
    await updateContact(c.id, pick(i, ['name', 'company', 'email', 'phone', 'website', 'source', 'dealValue', 'service', 'nextFollowUp', 'tags', 'notes']));
    return out(await db.contacts.get(c.id), { type: 'contact', id: c.id });
  },
  async contacts_set_stage(i) {
    const c = await need(db.contacts.get(i.id), 'Contact', i.id);
    if (c.stage !== i.stage) await setContactStage(c.id, i.stage as ContactStage, i.note);
    return out(await db.contacts.get(c.id), { type: 'contact', id: c.id });
  },
  async contacts_log_interaction(i) {
    await need(db.contacts.get(i.id), 'Contact', i.id);
    await logInteraction(i.id, i.kind, i.summary, i.nextFollowUp);
    return out(await db.contacts.get(i.id), { type: 'contact', id: i.id });
  },
  async contacts_delete(i) {
    const c = await db.contacts.get(i.id);
    if (!c) return out({ result: 'already_deleted' }, { type: 'contact', id: i.id });
    await deleteContact(c.id);
    return out({ result: 'deleted', name: c.name }, { type: 'contact', id: c.id });
  },
  async money_list(i) {
    const today = todayKey();
    const rows = (await db.money.orderBy('date').reverse().toArray()).filter((e) => (!i.from || e.date >= i.from) && (!i.to || e.date <= i.to) && (!i.direction || e.direction === i.direction)
      && (!i.status || i.status.includes(e.status)) && (!i.contactId || e.contactId === i.contactId) && (!i.projectId || e.projectId === i.projectId));
    return paginate(rows.map((e) => moneyView(e, today)), i);
  },
  async money_add(i) {
    const e = await addMoney({ ...pick(i, ['date', 'direction', 'amount', 'currency', 'category', 'status', 'stream', 'dueDate', 'contactId', 'projectId', 'hours', 'invoiceNumber']), description: i.description ?? '' } as never);
    return out(moneyView(e), { type: 'money', id: e.id });
  },
  async money_update(i) {
    const e = await need(db.money.get(i.id), 'Money entry', i.id);
    guardVersion(e, i.expectedUpdatedAt, 'Money entry');
    await updateMoney(e.id, pick<MoneyEntry>(i, ['date', 'amount', 'category', 'description', 'status', 'dueDate', 'contactId', 'projectId', 'hours', 'invoiceNumber']));
    return out(moneyView((await db.money.get(e.id))!), { type: 'money', id: e.id });
  },
  async money_record_payment(i) {
    const e = await need(db.money.get(i.id), 'Money entry', i.id);
    if (e.status === 'cancelled') throw invalidState('Entry is cancelled.');
    try {
      await recordPayment(e.id, { amount: i.amount, date: i.date, method: i.method, note: i.note });
    } catch (err) {
      throw invalidState(err instanceof Error ? err.message : String(err));
    }
    return out(moneyView((await db.money.get(e.id))!), { type: 'money', id: e.id });
  },
  async money_delete_payment(i) {
    const e = await need(db.money.get(i.id), 'Money entry', i.id);
    if (!(e.payments ?? []).some((p) => p.id === i.paymentId)) return out({ result: 'already_removed' }, { type: 'money', id: e.id });
    await deletePayment(e.id, i.paymentId);
    return out(moneyView((await db.money.get(e.id))!), { type: 'money', id: e.id });
  },
  async money_mark_paid(i) {
    const e = await need(db.money.get(i.id), 'Money entry', i.id);
    if (e.status === 'paid') return out({ result: 'already_paid', entry: moneyView(e) }, { type: 'money', id: e.id });
    await markPaid(e.id, i.date ?? todayKey());
    return out({ result: 'paid', entry: moneyView((await db.money.get(e.id))!) }, { type: 'money', id: e.id });
  },
  async money_delete(i) {
    const e = await db.money.get(i.id);
    if (!e) return out({ result: 'already_deleted' }, { type: 'money', id: i.id });
    await deleteMoney(e.id);
    return out({ result: 'deleted' }, { type: 'money', id: e.id });
  },

  /* Research */
  async studies_list(i) {
    const [studies, sources] = await Promise.all([db.studies.orderBy('sortOrder').toArray(), db.sources.toArray()]);
    return out(studies.filter((x) => !i.stage || i.stage.includes(x.stage)).map((x) => {
      const p = studyProgress(x, sources);
      return { id: x.id, title: x.title, kind: x.kind, stage: x.stage, targetDate: x.targetDate ?? null, progress: Math.round(p.progress * 1000) / 1000, sources: p.sources, extracted: p.extracted, words: p.words, updatedAt: x.updatedAt };
    }));
  },
  async studies_get(i) {
    const x = await need(db.studies.get(i.id), 'Study', i.id);
    const sources = await db.sources.toArray();
    const p = studyProgress(x, sources);
    return out({ ...x, progress: p, thinThemes: thinThemes(p), sources: sources.filter((s) => s.studyIds.includes(x.id)) }, { type: 'study', id: x.id });
  },
  async studies_create(i) {
    const x = await createStudy({ title: i.title, kind: i.kind, question: i.question, targetDate: i.targetDate, themes: i.themes, sections: i.sections });
    return out(x, { type: 'study', id: x.id });
  },
  async studies_update(i) {
    const x = await need(db.studies.get(i.id), 'Study', i.id);
    guardVersion(x, i.expectedUpdatedAt, 'Study');
    await updateStudy(x.id, pick(i, ['title', 'stage', 'question', 'scope', 'searchStrategy', 'targetDate', 'venue', 'themes', 'notes']));
    return out(await db.studies.get(x.id), { type: 'study', id: x.id });
  },
  async studies_set_section(i) {
    const x = await need(db.studies.get(i.id), 'Study', i.id);
    let sections = x.sections;
    if (i.sectionId) {
      if (!sections.some((s) => s.id === i.sectionId)) throw notFound('Section', i.sectionId);
      sections = sections.map((s) => (s.id === i.sectionId ? { ...s, ...pick(i, ['title', 'status', 'words', 'targetWords']) } : s));
    } else {
      if (!i.title) throw new AgentError('VALIDATION_ERROR', 'title is required when adding a section.');
      sections = [...sections, { id: newId('sec'), title: i.title, status: i.status ?? 'todo', words: i.words, targetWords: i.targetWords }];
    }
    await updateStudy(x.id, { sections });
    return out(await db.studies.get(x.id), { type: 'study', id: x.id });
  },
  async studies_delete(i) {
    const x = await db.studies.get(i.id);
    if (!x) return out({ result: 'already_deleted' }, { type: 'study', id: i.id });
    await deleteStudy(x.id);
    return out({ result: 'deleted', title: x.title }, { type: 'study', id: x.id });
  },
  async sources_list(i) {
    const q = (i.search ?? '').toLowerCase();
    const rows = (await db.sources.toArray()).filter((s) => (!i.studyId || s.studyIds.includes(i.studyId)) && (!i.status || i.status.includes(s.status)) && (!i.theme || s.themes.includes(i.theme))
      && (!q || [s.title, s.authors, s.findings, s.themes.join(' ')].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || (b.year ?? 0) - (a.year ?? 0));
    return paginate(rows, i);
  },
  async sources_create(i) {
    const parsed = i.reference ? parseReference(i.reference) : {};
    const draft = { ...parsed, ...pick<Record<string, unknown>>(i, ['title', 'authors', 'year', 'venue', 'doi', 'url', 'studyIds', 'status', 'relevance', 'themes', 'notes']) } as { title?: string };
    if (!draft.title?.trim()) throw new AgentError('VALIDATION_ERROR', 'Provide a title or a reference that contains one.');
    for (const sid of (draft as { studyIds?: string[] }).studyIds ?? []) await need(db.studies.get(sid), 'Study', sid);
    const src = await createSource(draft as never);
    return out(src, { type: 'source', id: src.id });
  },
  async sources_update(i) {
    const src = await need(db.sources.get(i.id), 'Source', i.id);
    guardVersion(src, i.expectedUpdatedAt, 'Source');
    await updateSource(src.id, pick(i, ['title', 'authors', 'year', 'venue', 'doi', 'url', 'studyIds', 'status', 'relevance', 'method', 'sample', 'findings', 'limitations', 'themes', 'notes']));
    return out(await db.sources.get(src.id), { type: 'source', id: src.id });
  },
  async sources_delete(i) {
    const src = await db.sources.get(i.id);
    if (!src) return out({ result: 'already_deleted' }, { type: 'source', id: i.id });
    await deleteSource(src.id);
    return out({ result: 'deleted' }, { type: 'source', id: src.id });
  },

  /* Exams */
  async exams_list() {
    const [tracks, scores] = await Promise.all([db.examTracks.orderBy('sortOrder').toArray(), db.scores.toArray()]);
    return out(tracks.map((t) => ({ ...t, scores: scores.filter((s) => s.trackId === t.id).sort((a, b) => a.date.localeCompare(b.date)) })));
  },
  async exams_add_score(i) {
    const track = await need(db.examTracks.get(i.trackId), 'Exam track', i.trackId);
    const sections: Record<string, number> = i.sections ?? {};
    for (const k of Object.keys(sections)) if (!track.sections.some((s) => s.id === k)) throw new AgentError('VALIDATION_ERROR', `Unknown section "${k}" for this track.`, { sections: track.sections.map((s) => s.id) });
    const total = i.total ?? Object.values(sections).reduce((a, b) => a + b, 0);
    const sc = await addScore({ trackId: track.id, date: i.date, label: i.label, kind: i.kind, sections, total, notes: i.notes });
    return out(sc, { type: 'score', id: sc.id });
  },

  /* Habits */
  async habits_list(i) { return out(await getHabitStatuses(i.date ?? todayKey())); },
  async habits_check_in(i) {
    await need(db.habits.get(i.id), 'Habit', i.id);
    return out(await checkIn(i.id, { value: i.value, minutes: i.minutes, notes: i.notes }), { type: 'habit', id: i.id });
  },
  async habits_undo_check_in(i) {
    await need(db.habits.get(i.id), 'Habit', i.id);
    await undoCheckin(i.id, i.date ?? todayKey());
    return out({ result: 'undone' }, { type: 'habit', id: i.id });
  },

  /* Focus */
  async focus_sessions(i) {
    rangeGuard(i.from, i.to, 366);
    const rows = await listSessions({ from: i.from, to: i.to });
    const totals = summariseSessions(rows);
    const p = paginate(rows.map((x) => ({ ...x, startedAtLocal: localIso(x.startedAt), minutes: Math.round(x.workMs / MINUTE) })), i);
    return { data: { totals, sessions: p.data }, meta: p.meta };
  },
  async focus_status() {
    const snap = loadSnapshot();
    if (!snap) return out({ running: false });
    const r = readTimer(snap);
    return out({ running: snap.runningSince !== null, paused: snap.runningSince === null, snapshot: snap, reading: r });
  },

  /* Analytics */
  async analytics_summary(i) {
    rangeGuard(i.from, i.to, 366);
    const { result } = await computeAnalyticsFor(i.from, i.to);
    const o = result.overview;
    return out({
      from: o.from, to: o.to, days: o.dayCount, headline: o.headline,
      totalMinutes: o.totalMinutes, dailyAverageMinutes: o.dailyAverageMinutes,
      completion: o.completion, plannedVsActual: o.plannedVsActual, streak: o.streak, distribution: o.distribution,
      minutesTrend: o.minutesTrend, tasksTrend: o.tasksTrend, strongestPillar: o.strongestPillar, weakestPillar: o.weakestPillar,
      peakHour: result.time.peakHour, byWeekday: result.time.byWeekday, weekly: result.time.weekly, goals: result.goals, planning: result.planning,
    });
  },
  async analytics_time_allocation(i) {
    rangeGuard(i.from, i.to, 366);
    const [acts, trackers] = await Promise.all([db.activities.where('date').between(i.from, i.to, true, true).toArray(), trackerMap()]);
    const by = new Map<string, number>();
    for (const a of acts as Activity[]) {
      if (a.durationMs <= 0 || !a.trackerId) continue;
      let id = a.trackerId;
      if (i.rollup !== false) { const seen = new Set<string>(); while (trackers[id]?.parentId && !seen.has(id)) { seen.add(id); id = trackers[id].parentId as string; } }
      by.set(id, (by.get(id) ?? 0) + a.durationMs / MINUTE);
    }
    const total = [...by.values()].reduce((s, m) => s + m, 0);
    return out({ from: i.from, to: i.to, totalMinutes: Math.round(total), areas: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, m]) => ({ trackerId: id, name: trackers[id]?.name ?? id, pillar: trackers[id]?.pillar ?? null, minutes: Math.round(m), share: total ? m / total : 0 })) });
  },
  async analytics_streaks(i) {
    const days = i.days ?? 30; const today = todayKey(); const from = addDaysToKey(today, -(days - 1));
    const [profile, acts] = await Promise.all([db.profile.get('profile'), db.activities.where('date').between(from, today, true, true).toArray()]);
    const active = new Set(acts.map((a) => a.date));
    const series = Array.from({ length: days }, (_, k) => { const d = addDaysToKey(from, k); return { date: d, active: active.has(d) }; });
    return out({ current: profile?.currentStreak ?? 0, longest: profile?.longestStreak ?? 0, lastActiveDate: profile?.lastActiveDate ?? null, activeDays: active.size, windowDays: days, series });
  },
  async analytics_daily_review(i) { return out(await loadDailyReview(i.date ?? todayKey())); },
  async analytics_weekly_review(i) { rangeGuard(i.from, i.to, 31); return out(await loadWeeklyReview(i.from, i.to)); },
  async activity_list(i) {
    const to = i.to ?? todayKey(); const from = i.from ?? addDaysToKey(to, -29);
    rangeGuard(from, to, 366);
    const rows = (await db.activities.where('date').between(from, to, true, true).toArray()).filter((a) => !i.type || i.type.includes(a.type)).sort((a, b) => b.at - a.at)
      .map((a) => ({ id: a.id, type: a.type, title: a.title, at: localIso(a.at), date: a.date, minutes: Math.round(a.durationMs / MINUTE), value: a.value, unit: a.unit, trackerId: a.trackerId, taskId: a.taskId, goalId: a.goalId, blockId: a.blockId, source: (a.meta?.source as string) ?? 'user' }));
    return paginate(rows, i);
  },

  /* Settings */
  async settings_get() {
    const st = await getSettings();
    return out({
      theme: st.theme, weekStartsOn: st.weekStartsOn, mode: st.appearance?.mode ?? 'simple', background: st.appearance?.background ?? 'galaxy',
      notifications: st.notifications, dashboardLayout: st.dashboardLayout ?? [], updatedAt: st.updatedAt,
    });
  },
  async settings_update(i) {
    if (i.theme) await setTheme(i.theme);
    if (i.mode) await setUiMode(i.mode);
    if (i.background) await setStageBackground(i.background);
    if (i.weekStartsOn !== undefined) await updateSettings({ weekStartsOn: i.weekStartsOn });
    return HANDLERS.settings_get({}, null as never);
  },
  async notifications_get_prefs() {
    const st = await getSettings();
    const center = useNotificationStore.getState().prefs;
    return out({
      reminders: st.notifications,
      inApp: { bannersByCategory: center.banners, mirrorToSystem: center.system, quietFrom: center.quietFrom, quietTo: center.quietTo },
      sounds: readSoundPrefs(),
      desktopPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    });
  },
  async notifications_update_prefs(i) {
    const st = await getSettings();
    await updateSettings({ notifications: { ...st.notifications, ...pick(i, ['enabled', 'leadMinutes', 'blockStart', 'taskDue', 'revisionDue', 'dailyReviewHour']) } });
    return HANDLERS.notifications_get_prefs({}, null as never);
  },
  async trackers_create(i) {
    const parentId = i.parentId ?? null;
    if (parentId) await need(db.trackers.get(parentId), 'Tracker', parentId);
    const same = (await db.trackers.toArray()).find((t) => !t.archived && (t.parentId ?? null) === parentId && t.name.trim().toLowerCase() === String(i.name).trim().toLowerCase());
    if (same) return out({ result: 'already_exists', tracker: same }, { type: 'tracker', id: same.id });
    const tracker = await createTracker({ name: i.name, pillar: i.pillar, parentId, color: i.color, weeklyTargetMinutes: i.weeklyTargetMinutes });
    return out({ result: 'created', tracker }, { type: 'tracker', id: tracker.id });
  },
  async trackers_list(i) {
    const rows = (await db.trackers.orderBy('sortOrder').toArray()).filter((t) => i.includeArchived || !t.archived);
    return out(rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parentId, pillar: t.pillar, color: t.color, archived: t.archived, unitLabel: t.unitLabel ?? null })));
  },

  /* System */
  async system_info(_i, ctx) {
    const counts: Record<string, number> = {};
    for (const t of ['tasks', 'blocks', 'goals', 'milestones', 'projects', 'checklists', 'contacts', 'money', 'skills', 'studies', 'sources', 'activities'] as const) counts[t] = await db.table(t).count();
    return out({ app: 'LifeOS', schemaVersion: SCHEMA_VERSION, dbVersion: db.verno, today: todayKey(), now: localIso(Date.now()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, permission: ctx.permission, client: ctx.client, counts });
  },
  async audit_log(i) {
    const rows = (await db.auditLog.orderBy('at').reverse().toArray()).filter((r) => !i.op || r.op === i.op).map(({ result: _r, ...r }) => ({ ...r, at: localIso(r.at) }));
    return paginate(rows, i);
  },
};
