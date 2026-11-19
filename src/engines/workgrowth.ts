import { addDaysToKey, dateKeyToDate, diffDays, isoWeekKey, monthKey } from '@/lib/date';
import type { DateKey, Milestone, MistakeType, Question, QuestionAttempt, Task } from '@/types';
import type {
  Checklist, ChecklistCadence, ChecklistItem, ChecklistRun, Contact, ContactStage, MoneyEntry,
  ExamTrack, Project, ScoreEntry, Skill, Source, Study,
} from '@/types/workgrowth';

/**
 * Pure Work & Growth logic (no DB). Services feed it rows; tests feed it
 * fixtures. Everything is generic — no subject, client or project is named.
 */

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

export function periodKeyFor(cadence: ChecklistCadence, date: DateKey): string {
  if (cadence === 'daily') return date;
  if (cadence === 'weekly') return isoWeekKey(date);
  return monthKey(date);
}

/** Items that apply on `date` (daily items may be limited to weekdays). */
export function itemsFor(list: Checklist, date: DateKey): ChecklistItem[] {
  if (list.cadence !== 'daily') return list.items;
  const dow = dateKeyToDate(date).getDay();
  return list.items.filter((i) => !i.days?.length || i.days.includes(dow));
}

export interface ChecklistProgress {
  done: number;
  total: number;
  complete: boolean;
}

export function checklistProgress(list: Checklist, run: ChecklistRun | undefined, date: DateKey): ChecklistProgress {
  const items = itemsFor(list, date);
  const done = items.filter((i) => run?.checked[i.id] !== undefined).length;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** Last day of the period containing `date` (the default "due" day). */
export function periodEnd(cadence: ChecklistCadence, date: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  if (cadence === 'daily') return date;
  const d = dateKeyToDate(date);
  if (cadence === 'weekly') {
    const offset = (d.getDay() - weekStartsOn + 7) % 7;
    return addDaysToKey(date, 6 - offset);
  }
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return addDaysToKey(date, last.getDate() - d.getDate());
}

/** The day this period's checklist is due (configured weekday / month day, else period end). */
export function dueDateFor(list: Checklist, date: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  const end = periodEnd(list.cadence, date, weekStartsOn);
  if (list.cadence === 'weekly' && list.dueWeekday !== undefined) {
    // Walk back from the period end to the configured weekday.
    for (let i = 0; i < 7; i++) {
      const k = addDaysToKey(end, -i);
      if (dateKeyToDate(k).getDay() === list.dueWeekday) return k;
    }
  }
  if (list.cadence === 'monthly' && typeof list.dueMonthDay === 'number') {
    const d = dateKeyToDate(date);
    const last = dateKeyToDate(end).getDate();
    const day = Math.min(list.dueMonthDay, last);
    return addDaysToKey(date, day - d.getDate());
  }
  return end;
}

/** Consecutive completed periods, counting back from the current one (current may be open). */
export function checklistStreak(list: Checklist, runs: readonly ChecklistRun[], today: DateKey): number {
  const byKey = new Map(runs.filter((r) => r.checklistId === list.id).map((r) => [r.periodKey, r]));
  const step = (d: DateKey) => (list.cadence === 'daily' ? addDaysToKey(d, -1) : list.cadence === 'weekly' ? addDaysToKey(d, -7) : addDaysToKey(d, -dateKeyToDate(d).getDate()));
  let cursor = today;
  let streak = 0;
  // The current period does not break the streak while it is still open.
  if (!byKey.get(periodKeyFor(list.cadence, cursor))?.completedAt) cursor = step(cursor);
  for (let i = 0; i < 400; i++) {
    if (!byKey.get(periodKeyFor(list.cadence, cursor))?.completedAt) break;
    streak++;
    cursor = step(cursor);
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* Goal / milestone / task backbone                                    */
/* ------------------------------------------------------------------ */

export interface WorkProgress {
  milestonesDone: number;
  milestonesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  /** 0..1 — milestones when there are any, otherwise tasks. */
  progress: number;
  overdueTasks: number;
  nextTask: Task | null;
  nextMilestone: Milestone | null;
}

const OPEN_TASK = new Set(['inbox', 'planned', 'in_progress', 'rescheduled']);

export function workProgress(milestones: readonly Milestone[], tasks: readonly Task[], today: DateKey): WorkProgress {
  const liveTasks = tasks.filter((t) => t.status !== 'cancelled');
  const tasksDone = liveTasks.filter((t) => t.status === 'completed').length;
  const milestonesDone = milestones.filter((m) => m.completedAt).length;
  const open = liveTasks.filter((t) => OPEN_TASK.has(t.status));
  const byUrgency = [...open].sort((a, b) =>
    (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : (a.dueDate ?? '9999') > (b.dueDate ?? '9999') ? 1 : b.basePriority - a.basePriority);
  const nextMilestone = [...milestones].filter((m) => !m.completedAt)
    .sort((a, b) => (a.sortOrder - b.sortOrder))[0] ?? null;
  const progress = milestones.length
    ? milestonesDone / milestones.length
    : liveTasks.length ? tasksDone / liveTasks.length : 0;
  return {
    milestonesDone, milestonesTotal: milestones.length, tasksDone, tasksTotal: liveTasks.length, progress,
    overdueTasks: open.filter((t) => t.dueDate && t.dueDate < today).length,
    nextTask: byUrgency[0] ?? null,
    nextMilestone,
  };
}

/** True when every live task of a milestone is completed (and it has at least one). */
export function milestoneTasksDone(milestoneId: string, tasks: readonly Task[]): boolean {
  const mine = tasks.filter((t) => t.milestoneId === milestoneId && t.status !== 'cancelled');
  return mine.length > 0 && mine.every((t) => t.status === 'completed');
}

export type Health = 'on_track' | 'at_risk' | 'off_track' | 'done' | 'idle';

/**
 * Schedule health: compares progress with elapsed time between start and
 * target. A deliverable is "at risk" when it is >15 points behind the time
 * elapsed, "off track" when past its date or >35 points behind.
 */
export function scheduleHealth(
  progress: number, start: DateKey | null | undefined, target: DateKey | null | undefined, today: DateKey, finished: boolean,
): Health {
  if (finished || progress >= 1) return 'done';
  if (!target) return progress > 0 ? 'on_track' : 'idle';
  if (today > target) return 'off_track';
  const begin = start ?? today;
  const span = Math.max(1, diffDays(begin, target));
  const elapsed = Math.min(1, Math.max(0, diffDays(begin, today) / span));
  const gap = elapsed - progress;
  return gap > 0.35 ? 'off_track' : gap > 0.15 ? 'at_risk' : 'on_track';
}

export function projectHealth(project: Project, p: WorkProgress, today: DateKey): Health {
  if (project.status === 'shipped' || project.status === 'archived') return 'done';
  // Not started yet: planning/idea/paused projects are never "behind".
  if (project.status === 'paused' || project.status === 'idea' || project.status === 'planning') return 'idle';
  return scheduleHealth(p.progress, project.startDate, project.targetDate, today, false);
}

/* ------------------------------------------------------------------ */
/* Earning                                                             */
/* ------------------------------------------------------------------ */

export const PIPELINE_STAGES: ContactStage[] = ['lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won'];
const OPEN_STAGES = new Set<ContactStage>(['lead', 'contacted', 'qualified', 'proposal', 'negotiation']);

export interface EarningSummary {
  currency: string;
  /** Paid income within the period. */
  revenue: number;
  activeRevenue: number;
  passiveRevenue: number;
  expenses: number;
  profit: number;
  /** Invoiced but not paid (any date). */
  outstanding: number;
  overdue: number;
  overdueCount: number;
  /** Weighted open pipeline: deal value × stage probability. */
  pipelineValue: number;
  openDeals: number;
  clients: number;
  followUpsDue: number;
  /** Paid income ÷ billed hours in the period, when hours were logged. */
  effectiveHourlyRate: number | null;
  /** won ÷ (won + lost) across all contacts. */
  winRate: number | null;
  byMonth: Array<{ month: string; income: number; expenses: number }>;
}

const STAGE_PROBABILITY: Record<ContactStage, number> = {
  lead: 0.05, contacted: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75, won: 1, client: 1, lost: 0,
};

export function isOverdue(e: MoneyEntry, today: DateKey): boolean {
  return e.direction === 'income' && (e.status === 'overdue' || (e.status === 'invoiced' && !!e.dueDate && e.dueDate < today));
}

/* --------------------------- Payments / instalments --------------------------- */

/**
 * The payments that settle an entry. Instalments when recorded; otherwise a
 * fully-paid entry counts as one payment on its paid date. Cancelled entries
 * have none.
 */
export function paymentsOf(e: MoneyEntry): Array<{ date: DateKey; amount: number }> {
  if (e.status === 'cancelled') return [];
  if (e.payments?.length) return e.payments.map((p) => ({ date: p.date, amount: p.amount }));
  if (e.status === 'paid') return [{ date: e.paidDate ?? e.date, amount: e.amount }];
  return [];
}

export function paidSoFar(e: MoneyEntry): number {
  return sum(paymentsOf(e).map((p) => p.amount));
}

/** What is still owed on an entry (never negative). */
export function balanceDue(e: MoneyEntry): number {
  if (e.status === 'cancelled') return 0;
  return Math.max(0, Math.round((e.amount - paidSoFar(e)) * 100) / 100);
}

/** True when instalments cover part, but not all, of the amount. */
export function isPartiallyPaid(e: MoneyEntry): boolean {
  const paid = paidSoFar(e);
  return paid > 0 && paid < e.amount && e.status !== 'paid';
}

export function earningSummary(
  entries: readonly MoneyEntry[], contacts: readonly Contact[], from: DateKey, to: DateKey, today: DateKey, currency = 'INR',
): EarningSummary {
  const inPeriod = (d: DateKey | null | undefined) => !!d && d >= from && d <= to;
  const live = entries.filter((e) => e.status !== 'cancelled' && e.currency === currency);
  // Revenue is recognised per payment, on the payment's date — so instalments
  // land in the month they were actually received.
  const receivedIn = (e: MoneyEntry) => sum(paymentsOf(e).filter((p) => inPeriod(p.date)).map((p) => p.amount));
  const income = live.filter((e) => e.direction === 'income');
  const revenue = sum(income.map(receivedIn));
  const activeRevenue = sum(income.filter((e) => (e.stream ?? 'active') === 'active').map(receivedIn));
  const expenses = sum(live.filter((e) => e.direction === 'expense').map(receivedIn));
  const paidIncome = income.filter((e) => e.status === 'paid' && inPeriod(e.paidDate ?? e.date));
  const unpaid = income.filter((e) => (e.status === 'invoiced' || e.status === 'overdue' || isPartiallyPaid(e)) && balanceDue(e) > 0);
  const overdueRows = unpaid.filter((e) => isOverdue(e, today));
  const hours = sum(paidIncome.map((e) => e.hours ?? 0));
  const open = contacts.filter((c) => OPEN_STAGES.has(c.stage));
  const won = contacts.filter((c) => c.stage === 'won' || c.stage === 'client').length;
  const lost = contacts.filter((c) => c.stage === 'lost').length;

  const months = new Map<string, { income: number; expenses: number }>();
  for (const e of live) {
    for (const pay of paymentsOf(e)) {
      const m = pay.date.slice(0, 7);
      const row = months.get(m) ?? { income: 0, expenses: 0 };
      if (e.direction === 'income') row.income += pay.amount; else row.expenses += pay.amount;
      months.set(m, row);
    }
  }

  return {
    currency,
    revenue,
    activeRevenue,
    passiveRevenue: revenue - activeRevenue,
    expenses,
    profit: revenue - expenses,
    outstanding: sum(unpaid.map(balanceDue)),
    overdue: sum(overdueRows.map(balanceDue)),
    overdueCount: overdueRows.length,
    pipelineValue: Math.round(sum(open.map((c) => (c.dealValue ?? 0) * STAGE_PROBABILITY[c.stage]))),
    openDeals: open.length,
    clients: contacts.filter((c) => c.stage === 'client' || c.stage === 'won').length,
    followUpsDue: contacts.filter((c) => c.nextFollowUp && c.nextFollowUp <= today && c.stage !== 'lost').length,
    effectiveHourlyRate: hours > 0 ? Math.round(revenue / hours) : null,
    winRate: won + lost > 0 ? won / (won + lost) : null,
    byMonth: [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-12).map(([month, v]) => ({ month, ...v })),
  };
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export const SKILL_LEVELS = ['Unfamiliar', 'Beginner', 'Working', 'Proficient', 'Advanced', 'Expert'] as const;

export function skillGap(skill: Skill): number {
  return Math.max(0, skill.targetLevel - skill.level);
}

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

export interface StudyProgress {
  sources: number;
  read: number;
  extracted: number;
  excluded: number;
  sectionsDone: number;
  sectionsTotal: number;
  words: number;
  targetWords: number;
  /** 0..1 — 40% reading (extracted / included sources), 60% writing (sections). */
  progress: number;
  themes: Array<{ theme: string; sources: number }>;
}

export function studyProgress(study: Study, sources: readonly Source[]): StudyProgress {
  const mine = sources.filter((s) => s.studyIds.includes(study.id));
  const included = mine.filter((s) => s.status !== 'excluded');
  const read = included.filter((s) => s.status === 'read' || s.status === 'extracted').length;
  const extracted = included.filter((s) => s.status === 'extracted').length;
  const done = study.sections.filter((s) => s.status === 'done').length;
  const sectionWeight = { todo: 0, outline: 0.2, draft: 0.5, revised: 0.8, done: 1 } as const;
  const writing = study.sections.length ? sum(study.sections.map((s) => sectionWeight[s.status])) / study.sections.length : 0;
  const reading = included.length ? extracted / included.length : 0;
  const themeCount = new Map<string, number>();
  for (const s of included) for (const t of s.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  for (const t of study.themes) if (!themeCount.has(t)) themeCount.set(t, 0);
  return {
    sources: included.length,
    read,
    extracted,
    excluded: mine.length - included.length,
    sectionsDone: done,
    sectionsTotal: study.sections.length,
    words: sum(study.sections.map((s) => s.words ?? 0)),
    targetWords: sum(study.sections.map((s) => s.targetWords ?? 0)),
    progress: study.stage === 'published' || study.stage === 'submitted' ? 1 : 0.4 * reading + 0.6 * writing,
    themes: [...themeCount.entries()].map(([theme, n]) => ({ theme, sources: n })).sort((a, b) => b.sources - a.sources),
  };
}

/** Themes with fewer than `min` supporting sources — candidate research gaps. */
export function thinThemes(p: StudyProgress, min = 2): string[] {
  return p.themes.filter((t) => t.sources < min).map((t) => t.theme);
}

/* ------------------------------------------------------------------ */
/* Exam tracks                                                         */
/* ------------------------------------------------------------------ */

export function scoreTotal(track: ExamTrack, sections: Record<string, number>, direct?: number): number {
  if (track.directTotal) return direct ?? 0;
  return sum(track.sections.map((s) => sections[s.id] ?? 0));
}

export interface DomainRow {
  trackerId: string;
  domain: string;
  attempted: number;
  correct: number;
  accuracy: number;
}

export interface ExamSummary {
  latest: ScoreEntry | null;
  best: ScoreEntry | null;
  /** Mean of the last three entries. */
  recentAverage: number | null;
  /** Latest minus the one before. */
  delta: number | null;
  gapToTarget: number | null;
  daysToExam: number | null;
  trend: Array<{ date: DateKey; total: number; label: string; kind: ScoreEntry['kind'] }>;
  sectionTrend: Record<string, Array<{ date: DateKey; score: number }>>;
  /** Weakest first. */
  domains: DomainRow[];
  mistakes: Array<{ type: MistakeType; count: number }>;
}

/**
 * Score dashboard for one exam track. Domain accuracy and mistake mix come
 * from Practice papers whose questions belong to the track's section
 * trackers (question.topic = the domain), so nothing is entered twice.
 */
export function examSummary(
  track: ExamTrack, scores: readonly ScoreEntry[], questions: readonly Question[], attempts: readonly QuestionAttempt[], today: DateKey,
): ExamSummary {
  const mine = scores.filter((x) => x.trackId === track.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  const latest = mine[mine.length - 1] ?? null;
  const prev = mine[mine.length - 2] ?? null;
  const best = mine.reduce<ScoreEntry | null>((b, x) => (!b || x.total > b.total ? x : b), null);
  const recent = mine.slice(-3);

  const trackers = new Set(track.sections.map((s) => s.trackerId).filter(Boolean) as string[]);
  const qById = new Map(questions.filter((q) => trackers.has(q.trackerId)).map((q) => [q.id, q]));
  const domainMap = new Map<string, DomainRow>();
  const mistakeMap = new Map<MistakeType, number>();
  for (const a of attempts) {
    const q = qById.get(a.questionId);
    if (!q || (a.status !== 'correct' && a.status !== 'incorrect')) continue;
    const domain = q.topic?.trim() || 'Untagged';
    const key = `${q.trackerId}::${domain}`;
    const row = domainMap.get(key) ?? { trackerId: q.trackerId, domain, attempted: 0, correct: 0, accuracy: 0 };
    row.attempted++;
    if (a.status === 'correct') row.correct++;
    domainMap.set(key, row);
    if (a.status === 'incorrect' && a.mistakeType) mistakeMap.set(a.mistakeType, (mistakeMap.get(a.mistakeType) ?? 0) + 1);
  }
  const domains = [...domainMap.values()].map((r) => ({ ...r, accuracy: r.attempted ? r.correct / r.attempted : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted);

  const sectionTrend: ExamSummary['sectionTrend'] = {};
  for (const sec of track.sections) {
    sectionTrend[sec.id] = mine.filter((x) => x.sections[sec.id] !== undefined).map((x) => ({ date: x.date, score: x.sections[sec.id]! }));
  }

  return {
    latest,
    best,
    recentAverage: recent.length ? Math.round(sum(recent.map((x) => x.total)) / recent.length) : null,
    delta: latest && prev ? latest.total - prev.total : null,
    gapToTarget: latest && track.target !== undefined ? track.target - latest.total : null,
    daysToExam: track.examDate ? diffDays(today, track.examDate) : null,
    trend: mine.map((x) => ({ date: x.date, total: x.total, label: x.label, kind: x.kind })),
    sectionTrend,
    domains,
    mistakes: [...mistakeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
