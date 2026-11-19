import { db } from '@/db/db';
import { addDaysToKey, dateKeyToDate, toDateKey } from '@/lib/date';
import { cycleLengthDays, isInPhase } from '@/engines/cycles';
import { isValidCondition } from '@/engines/conditionEngine';
import { ACHIEVEMENT_DEFINITIONS } from '@/config/achievements';
import { updateSchedulingConfig } from './settingsService';
import { materialiseAllRules } from './recurrenceService';
import { syncAllSequences } from './goalService';
import { evaluateAchievements } from './achievementService';
import { REVIEW_SECTIONS, PAPER_SECTIONS } from './workgrowthService';
import type {
  Checklist, ChecklistCadence, ExamTrack, Milestone, Project, ProjectKind, ProjectStatus, Skill, SkillLevel, Study, StudyKind,
} from '@/types';
import type {
  Achievement, AchievementCategory, BlockKind, CustomReward, CycleDefinition, DateKey, Goal,
  DeepPartial, GoalType, ID, Pillar, RecurringRule, SchedulingConfig, ScheduleRule, Tracker, TrackerColor,
} from '@/types';

/**
 * LifeOS configuration import — the "set up my LifeOS" file.
 *
 * A config file is plain DATA in the shape a user would otherwise click
 * together in the app: trackers, cycles, recurring rules, goals, achievement
 * definitions, a reward catalogue and XP numbers. This module:
 *   1. validates it (unique ids/keys, valid times/days, recurrence, cycle
 *      references, conditions, no overlapping REQUIRED blocks on any weekday
 *      or cycle phase, sane XP/reward numbers),
 *   2. upserts it idempotently by stable id / key — re-importing the same file
 *      changes nothing and creates no duplicates, and
 *   3. never deletes or resets anything else (XP, streaks, sessions, papers,
 *      unlocked achievements, history, settings outside what the file names).
 *
 * Nothing here knows any particular user, subject or schedule.
 */

export interface ConfigTracker {
  id: ID;
  name: string;
  pillar: Pillar;
  parentId?: ID | null;
  color?: TrackerColor;
  defaultProtected?: boolean;
  weeklyTargetMinutes?: number;
  unitLabel?: string;
}

export interface ConfigRule {
  id: ID;
  title: string;
  trackerId: ID;
  /** 0 = Sunday .. 6 = Saturday. */
  days: number[];
  start: string; // HH:MM
  end: string; // HH:MM, may be 24:00
  kind?: BlockKind;
  protected?: boolean;
  optional?: boolean;
  notes?: string;
  /** Every N weeks (default 1). */
  interval?: number;
  cyclePhase?: { cycleId: ID; phaseKey: string } | null;
  /** Paper slot: subjects the exam planner may assign to each occurrence. */
  paperSubjects?: ID[];
  paperQuestions?: number;
}

export interface ConfigGoal {
  id: ID;
  title: string;
  description?: string;
  trackerId: ID;
  type?: GoalType;
  sequence?: { group: string; order: number } | null;
  completionXP?: number;
  startDate?: DateKey;
  targetDate?: DateKey | null;
  /** Milestones under this goal; ids default to `<goalId>__m<n>` so re-import is stable. */
  milestones?: Array<{ id?: ID; title: string; targetDate?: DateKey | null }>;
}

export interface ConfigChecklist {
  id: ID;
  title: string;
  cadence: ChecklistCadence;
  description?: string;
  items: Array<{ id: ID; title: string; doneDefinition?: string; timing?: string; area?: string; days?: number[] }>;
  dueWeekday?: number;
  dueMonthDay?: number | 'last';
  completionXP?: number;
  trackerId?: ID | null;
}

export interface ConfigProject {
  id: ID;
  title: string;
  goalId: ID;
  kind?: ProjectKind;
  status?: ProjectStatus;
  summary?: string;
  definitionOfDone?: string;
  deliverables?: string[];
  repoUrl?: string;
  startDate?: DateKey | null;
  targetDate?: DateKey | null;
}

export interface ConfigStudy {
  id: ID;
  title: string;
  kind: StudyKind;
  goalId: ID;
  question?: string;
  themes?: string[];
  sections?: string[];
  targetDate?: DateKey | null;
}

export interface ConfigSkill {
  id: ID;
  name: string;
  category: string;
  level?: SkillLevel;
  targetLevel?: SkillLevel;
  trackerId?: ID | null;
  path?: Array<{ id: ID; title: string; url?: string }>;
}

export interface ConfigAchievement {
  key: string;
  title: string;
  description: string;
  category: AchievementCategory;
  target: number;
  xpReward: number;
  unit?: string;
  tier?: 1 | 2 | 3;
  condition: unknown;
}

export interface ConfigReward {
  id: ID;
  name: string;
  description?: string;
  cost: number;
}

export interface LifeOSConfig {
  format: 'lifeos-config';
  version: 1;
  /** First day recurring rules apply from. */
  startDate: DateKey;
  trackers?: ConfigTracker[];
  cycles?: CycleDefinition[];
  recurring?: ConfigRule[];
  scheduleRules?: Array<Omit<ScheduleRule, 'createdAt' | 'updatedAt'>>;
  goals?: ConfigGoal[];
  achievements?: ConfigAchievement[];
  rewards?: ConfigReward[];
  xp?: DeepPartial<SchedulingConfig['xp']>;
  /** Profile basics (only the listed fields are touched). */
  profile?: { displayName?: string };
  /** Hours Auto Plan may use, per weekday (0 = Sunday), as HH:MM ranges. */
  workingHours?: Record<string, Array<{ start: string; end: string }>>;
  /** Preferred deep-work hours for Auto Plan, as HH:MM ranges. */
  focusHours?: Array<{ start: string; end: string }>;
  /** Hour (0–23) from which "Close the day" is offered. */
  dailyReviewHour?: number;
  checklists?: ConfigChecklist[];
  projects?: ConfigProject[];
  studies?: ConfigStudy[];
  skills?: ConfigSkill[];
  examTracks?: ConfigExamTrack[];
}

export interface ConfigExamTrack {
  id: ID;
  title: string;
  family?: string;
  sections: Array<{ id: ID; name: string; max: number; min?: number; trackerId?: ID | null }>;
  target?: number;
  minTotal?: number;
  maxTotal?: number;
  directTotal?: boolean;
  examDate?: DateKey | null;
  goalId?: ID | null;
}

export interface ConfigIssue {
  severity: 'error' | 'warning';
  where: string;
  message: string;
}

export interface ConfigValidation {
  ok: boolean;
  issues: ConfigIssue[];
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PILLARS = new Set(['study', 'fitness', 'skills', 'personal', 'system']);
const KINDS = new Set(['task', 'fixed', 'break', 'buffer', 'sleep', 'meal', 'event']);
const NON_REQUIRED_KINDS = new Set(['sleep', 'meal', 'break', 'buffer']);

function isRequired(rule: ConfigRule): boolean {
  return !rule.optional && !NON_REQUIRED_KINDS.has(rule.kind ?? 'fixed');
}

/** Does the rule fire on this date? Mirrors recurrenceService.ruleFiresOn for weekly rules. */
export function configRuleFiresOn(
  rule: ConfigRule,
  date: DateKey,
  startDate: DateKey,
  cycles: readonly CycleDefinition[],
): boolean {
  if (date < startDate) return false;
  const dow = dateKeyToDate(date).getDay();
  if (!rule.days.includes(dow)) return false;
  const interval = Math.max(1, rule.interval ?? 1);
  if (interval > 1) {
    const anchor = addDaysToKey(startDate, -dateKeyToDate(startDate).getDay());
    const weeks = Math.floor((dateKeyToDate(date).getTime() - dateKeyToDate(anchor).getTime()) / (7 * 86_400_000));
    if (weeks % interval !== 0) return false;
  }
  if (rule.cyclePhase) {
    const cycle = cycles.find((c) => c.id === rule.cyclePhase!.cycleId);
    if (!cycle || !cycle.active) return false;
    return isInPhase(cycle, rule.cyclePhase.phaseKey, date);
  }
  return true;
}

/** The rules (sorted by start) that would generate blocks on a date. */
export function rulesForDate(config: LifeOSConfig, date: DateKey): ConfigRule[] {
  return (config.recurring ?? [])
    .filter((r) => configRuleFiresOn(r, date, config.startDate, config.cycles ?? []))
    .sort((a, b) => (parseHHMM(a.start) ?? 0) - (parseHHMM(b.start) ?? 0));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateConfig(
  raw: unknown,
  existing: { trackerIds?: ReadonlySet<ID>; goalIds?: ReadonlySet<ID> } = {},
): ConfigValidation {
  const issues: ConfigIssue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: 'error', where, message });
  const warn = (where: string, message: string) => issues.push({ severity: 'warning', where, message });

  if (!raw || typeof raw !== 'object') return { ok: false, issues: [{ severity: 'error', where: 'file', message: 'Not a JSON object.' }] };
  const config = raw as LifeOSConfig;
  if (config.format !== 'lifeos-config') err('format', 'Expected "format": "lifeos-config".');
  if (config.version !== 1) err('version', 'Unsupported config version.');
  if (!DATE_RE.test(config.startDate ?? '')) err('startDate', 'startDate must be YYYY-MM-DD.');

  // --- trackers ---
  const trackerIds = new Set<ID>(existing.trackerIds ?? []);
  const seenTrackers = new Set<ID>();
  for (const t of config.trackers ?? []) {
    if (!t.id || seenTrackers.has(t.id)) err(`trackers.${t.id}`, 'Missing or duplicate tracker id.');
    seenTrackers.add(t.id);
    trackerIds.add(t.id);
    if (!t.name?.trim()) err(`trackers.${t.id}`, 'Tracker needs a name.');
    if (!PILLARS.has(t.pillar)) err(`trackers.${t.id}`, `Unknown pillar "${t.pillar}".`);
  }
  for (const t of config.trackers ?? []) {
    if (t.parentId && !trackerIds.has(t.parentId)) err(`trackers.${t.id}`, `Unknown parent "${t.parentId}".`);
  }
  // cycle-free parent chains
  const parentOf = new Map((config.trackers ?? []).map((t) => [t.id, t.parentId ?? null]));
  for (const t of config.trackers ?? []) {
    const chain = new Set<ID>();
    let cursor: ID | null = t.id;
    while (cursor) {
      if (chain.has(cursor)) { err(`trackers.${t.id}`, 'Parent chain loops.'); break; }
      chain.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  // --- cycles ---
  const cycleIds = new Set<ID>();
  for (const c of config.cycles ?? []) {
    if (!c.id || cycleIds.has(c.id)) err(`cycles.${c.id}`, 'Missing or duplicate cycle id.');
    cycleIds.add(c.id);
    if (!DATE_RE.test(c.anchorDate ?? '')) err(`cycles.${c.id}`, 'anchorDate must be YYYY-MM-DD.');
    if (!Array.isArray(c.phases) || c.phases.length < 1) err(`cycles.${c.id}`, 'A cycle needs phases.');
    const keys = new Set<string>();
    for (const p of c.phases ?? []) {
      if (!p.key || keys.has(p.key)) err(`cycles.${c.id}`, `Missing or duplicate phase key "${p.key}".`);
      keys.add(p.key);
      if (!Number.isInteger(p.lengthDays) || p.lengthDays < 1) err(`cycles.${c.id}.${p.key}`, 'lengthDays must be a whole number >= 1.');
    }
    if (cycleLengthDays(c) <= 0) err(`cycles.${c.id}`, 'Cycle has zero length.');
  }

  // --- recurring rules ---
  const ruleIds = new Set<ID>();
  for (const r of config.recurring ?? []) {
    const where = `recurring.${r.id}`;
    if (!r.id || ruleIds.has(r.id)) err(where, 'Missing or duplicate rule id.');
    ruleIds.add(r.id);
    if (!r.title?.trim()) err(where, 'Rule needs a title.');
    if (!trackerIds.has(r.trackerId)) err(where, `Unknown tracker "${r.trackerId}".`);
    if (!Array.isArray(r.days) || r.days.length === 0 || r.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      err(where, 'days must be a non-empty list of 0..6 (0 = Sunday).');
    }
    const s = parseHHMM(r.start);
    const e = parseHHMM(r.end);
    if (s === null || e === null) err(where, 'start/end must be HH:MM.');
    else if (e <= s) err(where, `end (${r.end}) must be after start (${r.start}).`);
    if (r.kind && !KINDS.has(r.kind)) err(where, `Unknown block kind "${r.kind}".`);
    if (r.interval !== undefined && (!Number.isInteger(r.interval) || r.interval < 1)) err(where, 'interval must be >= 1.');
    for (const id of r.paperSubjects ?? []) if (!trackerIds.has(id)) err(where, `Unknown paper subject "${id}".`);
    if (r.cyclePhase) {
      const cycle = (config.cycles ?? []).find((c) => c.id === r.cyclePhase!.cycleId);
      if (!cycle) err(where, `Unknown cycle "${r.cyclePhase.cycleId}".`);
      else if (!cycle.phases.some((p) => p.key === r.cyclePhase!.phaseKey)) err(where, `Unknown phase "${r.cyclePhase.phaseKey}".`);
    }
  }

  // --- overlap of REQUIRED blocks: check every day of two full cycle lengths ---
  if (DATE_RE.test(config.startDate ?? '') && !issues.some((i) => i.severity === 'error' && i.where.startsWith('recurring'))) {
    const span = Math.max(14, ...(config.cycles ?? []).map((c) => cycleLengthDays(c) * 2));
    const anchor = [config.startDate, ...(config.cycles ?? []).map((c) => c.anchorDate)].sort().pop()!;
    for (let i = 0; i < span; i++) {
      const date = addDaysToKey(anchor, i);
      const required = rulesForDate(config, date).filter(isRequired);
      for (let a = 0; a < required.length; a++) {
        for (let b = a + 1; b < required.length; b++) {
          const x = required[a]!;
          const y = required[b]!;
          if (parseHHMM(x.start)! < parseHHMM(y.end)! && parseHHMM(y.start)! < parseHHMM(x.end)!) {
            err(`recurring.${x.id}`, `Overlaps required "${y.title}" on ${date} (${x.start}-${x.end} vs ${y.start}-${y.end}).`);
          }
        }
      }
    }
  }

  // --- goals ---
  const goalIds = new Set<ID>();
  const seqOrders = new Map<string, Set<number>>();
  for (const g of config.goals ?? []) {
    if (!g.id || goalIds.has(g.id)) err(`goals.${g.id}`, 'Missing or duplicate goal id.');
    goalIds.add(g.id);
    if (!trackerIds.has(g.trackerId)) err(`goals.${g.id}`, `Unknown tracker "${g.trackerId}".`);
    if (g.sequence) {
      const set = seqOrders.get(g.sequence.group) ?? new Set<number>();
      if (set.has(g.sequence.order)) err(`goals.${g.id}`, `Duplicate order ${g.sequence.order} in sequence "${g.sequence.group}".`);
      set.add(g.sequence.order);
      seqOrders.set(g.sequence.group, set);
    }
    if (g.completionXP !== undefined && !(g.completionXP >= 0)) err(`goals.${g.id}`, 'completionXP must be >= 0.');
  }

  // --- achievements ---
  const builtinKeys = new Set(ACHIEVEMENT_DEFINITIONS.map((d) => d.key));
  const achKeys = new Set<string>();
  for (const a of config.achievements ?? []) {
    const where = `achievements.${a.key}`;
    if (!a.key || achKeys.has(a.key)) err(where, 'Missing or duplicate achievement key.');
    achKeys.add(a.key);
    if (builtinKeys.has(a.key)) err(where, 'Key collides with a built-in achievement.');
    if (!(a.target > 0)) err(where, 'target must be > 0.');
    if (!(a.xpReward >= 0)) err(where, 'xpReward must be >= 0.');
    if (!isValidCondition(a.condition)) err(where, 'condition is not a valid condition tree.');
    for (const id of referencedTrackers(a.condition)) {
      if (!trackerIds.has(id) && !cycleIds.has(id)) err(where, `Condition references unknown tracker/cycle "${id}".`);
    }
  }

  // --- goals: dates + milestones ---
  for (const g of config.goals ?? []) {
    if (g.targetDate && !DATE_RE.test(g.targetDate)) err(`goals.${g.id}`, 'targetDate must be YYYY-MM-DD.');
    for (const m of g.milestones ?? []) {
      if (!m.title?.trim()) err(`goals.${g.id}.milestones`, 'Milestone needs a title.');
      if (m.targetDate && !DATE_RE.test(m.targetDate)) err(`goals.${g.id}.milestones`, `Bad date "${m.targetDate}".`);
    }
  }

  // --- checklists ---
  const listIds = new Set<ID>();
  for (const c of config.checklists ?? []) {
    const where = `checklists.${c.id}`;
    if (!c.id || listIds.has(c.id)) err(where, 'Missing or duplicate checklist id.');
    listIds.add(c.id);
    if (!['daily', 'weekly', 'monthly'].includes(c.cadence)) err(where, 'cadence must be daily, weekly or monthly.');
    const itemIds = new Set<ID>();
    for (const i of c.items ?? []) {
      if (!i.id || itemIds.has(i.id)) err(where, `Missing or duplicate item id "${i.id}".`);
      itemIds.add(i.id);
      if (!i.title?.trim()) err(where, 'Item needs a title.');
    }
    if (c.dueWeekday !== undefined && !(Number.isInteger(c.dueWeekday) && c.dueWeekday >= 0 && c.dueWeekday <= 6)) err(where, 'dueWeekday must be 0..6.');
  }

  // --- projects / studies / skills reference goals that exist ---
  const allGoalIds = new Set([...(config.goals ?? []).map((g) => g.id), ...(existing.goalIds ?? [])]);
  const uniq = (list: Array<{ id: ID }> | undefined, area: string) => {
    const seen = new Set<ID>();
    for (const x of list ?? []) { if (!x.id || seen.has(x.id)) err(`${area}.${x.id}`, 'Missing or duplicate id.'); seen.add(x.id); }
  };
  uniq(config.projects, 'projects');
  uniq(config.studies, 'studies');
  uniq(config.skills, 'skills');
  uniq(config.examTracks, 'examTracks');
  for (const t of config.examTracks ?? []) {
    if (!t.sections?.length) err(`examTracks.${t.id}`, 'Needs at least one section.');
    for (const sec of t.sections ?? []) if (sec.trackerId && !trackerIds.has(sec.trackerId)) err(`examTracks.${t.id}`, `Unknown tracker "${sec.trackerId}".`);
    if (t.examDate && !DATE_RE.test(t.examDate)) err(`examTracks.${t.id}`, 'examDate must be YYYY-MM-DD.');
  }
  for (const p of config.projects ?? []) if (!allGoalIds.has(p.goalId)) err(`projects.${p.id}`, `Unknown goal "${p.goalId}".`);
  for (const st of config.studies ?? []) if (!allGoalIds.has(st.goalId)) err(`studies.${st.id}`, `Unknown goal "${st.goalId}".`);
  for (const sk of config.skills ?? []) if (sk.trackerId && !trackerIds.has(sk.trackerId)) err(`skills.${sk.id}`, `Unknown tracker "${sk.trackerId}".`);

  // --- rewards ---
  const rewardIds = new Set<ID>();
  for (const r of config.rewards ?? []) {
    if (!r.id || rewardIds.has(r.id)) err(`rewards.${r.id}`, 'Missing or duplicate reward id.');
    rewardIds.add(r.id);
    if (!Number.isInteger(r.cost) || r.cost <= 0) err(`rewards.${r.id}`, 'cost must be a positive whole number.');
  }

  // --- working / focus hours ---
  const checkRange = (where: string, r: { start: string; end: string }) => {
    const s = parseHHMM(r?.start);
    const e = parseHHMM(r?.end);
    if (s === null || e === null || e <= s) err(where, 'Each range needs HH:MM start < end.');
  };
  for (const [day, ranges] of Object.entries(config.workingHours ?? {})) {
    if (!/^[0-6]$/.test(day)) err(`workingHours.${day}`, 'Day must be 0..6 (0 = Sunday).');
    if (!Array.isArray(ranges)) { err(`workingHours.${day}`, 'Must be a list of ranges.'); continue; }
    ranges.forEach((r, i) => checkRange(`workingHours.${day}.${i}`, r));
  }
  (config.focusHours ?? []).forEach((r, i) => checkRange(`focusHours.${i}`, r));
  if (config.dailyReviewHour !== undefined && !(Number.isInteger(config.dailyReviewHour) && config.dailyReviewHour >= 0 && config.dailyReviewHour <= 23)) {
    err('dailyReviewHour', 'Must be a whole hour 0–23.');
  }

  // --- xp ---
  const xp = config.xp ?? {};
  for (const [k, v] of Object.entries(xp.trackerAwards ?? {})) {
    if (!trackerIds.has(k)) err(`xp.trackerAwards.${k}`, 'Unknown tracker.');
    if (!(typeof v === 'number' && v >= 0)) err(`xp.trackerAwards.${k}`, 'Must be a number >= 0.');
  }
  for (const k of xp.noXPTrackers ?? []) if (k && !trackerIds.has(k)) err(`xp.noXPTrackers.${k}`, 'Unknown tracker.');
  for (const [k, v] of Object.entries(xp.trackerAwards ?? {})) {
    if ((xp.noXPTrackers ?? []).includes(k) && typeof v === 'number' && v > 0) warn(`xp.trackerAwards.${k}`, 'Tracker is also listed as no-XP; it will earn nothing.');
  }
  if (xp.rewardCurrencyPerXP !== undefined && !(xp.rewardCurrencyPerXP >= 0)) err('xp.rewardCurrencyPerXP', 'Must be >= 0.');

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

/** Tracker/cycle ids mentioned in customMetrics keys of a condition tree. */
function referencedTrackers(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; metric?: string; children?: unknown[] };
  if (n.type === 'leaf' && typeof n.metric === 'string' && n.metric.includes(':')) {
    const [family, ...rest] = n.metric.split(':');
    const arg = rest.join(':');
    let ids: string[] = [];
    if (family === 'lateSessions') ids = arg.slice(0, arg.lastIndexOf(':')).split(',');
    else if (family === 'perfectPhases') { const [c, , t] = arg.split(':'); ids = [c ?? '', ...(t ?? '').split(',')]; }
    else if (family === 'windowDays' || family === 'reviews' || family === 'events' || family === 'checklists'
      || family === 'earned' || (family === 'papers' && arg === '*')) ids = [];
    else ids = arg.split(',');
    for (const id of ids) if (id) out.add(id);
  }
  for (const c of n.children ?? []) referencedTrackers(c, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

export interface ConfigApplyResult {
  ok: boolean;
  validation: ConfigValidation;
  created: Record<string, number>;
  updated: Record<string, number>;
  blocksGenerated: number;
  achievementCount: number;
  message: string;
}

export async function applyConfig(raw: unknown, options: { materialiseDays?: number; now?: number } = {}): Promise<ConfigApplyResult> {
  const existingTrackers = new Set((await db.trackers.toArray()).map((t) => t.id));
  const existingGoals = new Set((await db.goals.toArray()).map((g) => g.id));
  const validation = validateConfig(raw, { trackerIds: existingTrackers, goalIds: existingGoals });
  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  if (!validation.ok) {
    return {
      ok: false, validation, created, updated, blocksGenerated: 0,
      achievementCount: await db.achievements.count(),
      message: 'Configuration has errors — nothing was changed.',
    };
  }
  const config = raw as LifeOSConfig;
  const now = options.now ?? Date.now();
  const bump = (map: Record<string, number>, k: string) => { map[k] = (map[k] ?? 0) + 1; };

  await db.transaction('rw', [db.trackers, db.recurringRules, db.scheduleRules, db.goals, db.achievements, db.rewards, db.settings, db.profile,
    db.milestones, db.checklists, db.projects, db.studies, db.skills, db.examTracks], async () => {
    // Profile + planning hours
    if (config.profile?.displayName !== undefined) {
      await db.profile.update('profile', { displayName: config.profile.displayName, updatedAt: now });
    }
    const toRanges = (list: Array<{ start: string; end: string }>) =>
      list.map((r) => ({ startMinute: parseHHMM(r.start)!, endMinute: parseHHMM(r.end)! }));
    const settingsPatch: Record<string, unknown> = {};
    if (config.workingHours) {
      settingsPatch.workingHours = Object.fromEntries(
        Object.entries(config.workingHours).map(([d, list]) => [d, toRanges(list)]),
      );
    }
    if (config.focusHours) settingsPatch.focusHours = toRanges(config.focusHours);
    if (config.dailyReviewHour !== undefined) {
      const current = await db.settings.get('settings');
      if (current) settingsPatch.notifications = { ...current.notifications, dailyReviewHour: config.dailyReviewHour };
    }
    if (Object.keys(settingsPatch).length) {
      await db.settings.update('settings', { ...settingsPatch, updatedAt: now });
      bump(updated, 'settings');
    }

    // Trackers
    let order = await db.trackers.count();
    for (const t of config.trackers ?? []) {
      const prev = await db.trackers.get(t.id);
      const row: Tracker = {
        id: t.id,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        name: t.name.trim(),
        pillar: t.pillar,
        parentId: t.parentId ?? null,
        color: t.color ?? prev?.color ?? 'slate',
        system: prev?.system ?? false,
        defaultProtected: t.defaultProtected ?? prev?.defaultProtected ?? false,
        archived: prev?.archived ?? false,
        sortOrder: prev?.sortOrder ?? order++,
        weeklyTargetMinutes: t.weeklyTargetMinutes ?? prev?.weeklyTargetMinutes,
        unitLabel: t.unitLabel ?? prev?.unitLabel,
      };
      await db.trackers.put(row);
      bump(prev ? updated : created, 'trackers');
    }

    // Cycles + XP live in settings
    const settings = await db.settings.get('settings');
    if (settings && config.cycles) {
      const others = (settings.cycles ?? []).filter((c) => !config.cycles!.some((n) => n.id === c.id));
      await db.settings.update('settings', { cycles: [...others, ...config.cycles], updatedAt: now });
      for (const c of config.cycles) bump((settings.cycles ?? []).some((x) => x.id === c.id) ? updated : created, 'cycles');
    }

    // Recurring rules — definition changes never touch already-materialised history
    for (const r of config.recurring ?? []) {
      const prev = await db.recurringRules.get(r.id);
      const startMinute = parseHHMM(r.start)!;
      const row: RecurringRule = {
        id: r.id,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        title: r.title,
        freq: 'weekly',
        interval: Math.max(1, r.interval ?? 1),
        byWeekday: [...r.days].sort(),
        byMonthDay: [],
        startDate: prev?.startDate ?? config.startDate,
        endDate: prev?.endDate ?? null,
        count: null,
        target: 'block',
        taskTemplate: null,
        blockTemplate: {
          startMinute,
          durationMinutes: parseHHMM(r.end)! - startMinute,
          trackerId: r.trackerId,
          title: r.title,
          kind: r.kind ?? 'fixed',
          protected: r.protected ?? false,
          optional: r.optional ?? false,
          notes: r.notes,
          paperSubjects: r.paperSubjects,
          paperQuestions: r.paperQuestions,
        },
        lastGeneratedDate: prev?.lastGeneratedDate ?? null,
        active: prev?.active ?? true,
        exceptions: prev?.exceptions ?? [],
        overrides: prev?.overrides ?? {},
        cyclePhase: r.cyclePhase ?? null,
      };
      await db.recurringRules.put(row);
      bump(prev ? updated : created, 'recurringRules');
    }

    for (const s of config.scheduleRules ?? []) {
      const prev = await db.scheduleRules.get(s.id);
      await db.scheduleRules.put({ ...s, createdAt: prev?.createdAt ?? now, updatedAt: now });
      bump(prev ? updated : created, 'scheduleRules');
    }

    // Goals — status/progress/completion are the user's, never overwritten
    for (const g of config.goals ?? []) {
      const prev = await db.goals.get(g.id);
      const row: Goal = {
        id: g.id,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        title: g.title,
        description: g.description,
        type: g.type ?? prev?.type ?? 'completion',
        trackerId: g.trackerId,
        status: prev?.status ?? 'active',
        startDate: g.startDate ?? prev?.startDate ?? config.startDate,
        targetDate: g.targetDate !== undefined ? g.targetDate : (prev?.targetDate ?? null),
        targetValue: prev?.targetValue ?? null,
        unit: prev?.unit,
        weight: prev?.weight ?? 0.5,
        progress: prev?.progress ?? 0,
        progressComputedAt: prev?.progressComputedAt ?? null,
        completedAt: prev?.completedAt ?? null,
        color: prev?.color,
        sequence: g.sequence ?? null,
        completionXP: g.completionXP,
      };
      await db.goals.put(row);
      bump(prev ? updated : created, 'goals');
    }

    // Achievements — merge by key; unlock state and progress are preserved
    const byKey = new Map((await db.achievements.toArray()).map((a) => [a.key, a]));
    for (const a of config.achievements ?? []) {
      const prev = byKey.get(a.key);
      const row: Achievement = {
        id: prev?.id ?? `ach_${a.key}`,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        key: a.key,
        title: a.title,
        description: a.description,
        category: a.category,
        tier: a.tier ?? 1,
        target: a.target,
        progress: prev?.progress ?? 0,
        unlockedAt: prev?.unlockedAt ?? null,
        xpReward: a.xpReward,
        source: 'custom',
        condition: a.condition,
        unit: a.unit,
        archived: false,
      };
      await db.achievements.put(row);
      bump(prev ? updated : created, 'achievements');
    }

    // Milestones under configured goals — completion state is the user's.
    for (const g of config.goals ?? []) {
      let order = 0;
      for (const m of g.milestones ?? []) {
        const id = m.id ?? `${g.id}__m${order + 1}`;
        const prev = await db.milestones.get(id);
        const row: Milestone = {
          id, createdAt: prev?.createdAt ?? now, updatedAt: now, goalId: g.id, title: m.title.trim(),
          targetDate: m.targetDate ?? prev?.targetDate ?? null, sortOrder: order, weight: prev?.weight ?? 1,
          completedAt: prev?.completedAt ?? null,
        };
        await db.milestones.put(row);
        bump(prev ? updated : created, 'milestones');
        order++;
      }
    }

    // Checklists — ticks/runs are never touched.
    let listOrder = await db.checklists.count();
    for (const c of config.checklists ?? []) {
      const prev = await db.checklists.get(c.id);
      const row: Checklist = {
        id: c.id, createdAt: prev?.createdAt ?? now, updatedAt: now, title: c.title, cadence: c.cadence,
        description: c.description, items: c.items.map((i) => ({ ...i })), active: prev?.active ?? true,
        sortOrder: prev?.sortOrder ?? listOrder++, dueWeekday: c.dueWeekday, dueMonthDay: c.dueMonthDay,
        completionXP: c.completionXP, trackerId: c.trackerId ?? null,
      };
      await db.checklists.put(row);
      bump(prev ? updated : created, 'checklists');
    }

    // Projects — status, links and deliverable ticks are the user's once created.
    let projOrder = await db.projects.count();
    for (const pr of config.projects ?? []) {
      const prev = await db.projects.get(pr.id);
      const done = new Map((prev?.deliverables ?? []).map((d) => [d.title, d.doneAt]));
      const row: Project = {
        id: pr.id, createdAt: prev?.createdAt ?? now, updatedAt: now, title: prev?.title ?? pr.title,
        summary: pr.summary ?? prev?.summary, kind: pr.kind ?? prev?.kind ?? 'portfolio',
        status: prev?.status ?? pr.status ?? 'planning', goalId: pr.goalId,
        clientId: prev?.clientId ?? null, studyId: prev?.studyId ?? null, skillIds: prev?.skillIds ?? [],
        repoUrl: prev?.repoUrl ?? pr.repoUrl, demoUrl: prev?.demoUrl, links: prev?.links,
        startDate: pr.startDate ?? prev?.startDate ?? toDateKey(now), targetDate: pr.targetDate ?? prev?.targetDate ?? null,
        deliverables: (pr.deliverables ?? prev?.deliverables.map((d) => d.title) ?? []).map((title, i) => ({
          id: prev?.deliverables.find((d) => d.title === title)?.id ?? `${pr.id}__d${i + 1}`, title, doneAt: done.get(title) ?? null,
        })),
        definitionOfDone: pr.definitionOfDone ?? prev?.definitionOfDone, notes: prev?.notes, portfolio: prev?.portfolio,
        sortOrder: prev?.sortOrder ?? projOrder++,
      };
      await db.projects.put(row);
      bump(prev ? updated : created, 'projects');
    }

    // Research studies — stage and section progress are the user's once created.
    let studyOrder = await db.studies.count();
    for (const st of config.studies ?? []) {
      const prev = await db.studies.get(st.id);
      const titles = st.sections ?? (st.kind === 'literature_review' ? REVIEW_SECTIONS : PAPER_SECTIONS);
      const row: Study = {
        id: st.id, createdAt: prev?.createdAt ?? now, updatedAt: now, title: prev?.title ?? st.title, kind: st.kind,
        stage: prev?.stage ?? 'planning', goalId: st.goalId, question: prev?.question ?? st.question,
        scope: prev?.scope, searchStrategy: prev?.searchStrategy,
        themes: [...new Set([...(prev?.themes ?? []), ...(st.themes ?? [])])],
        sections: prev?.sections ?? titles.map((title, i) => ({ id: `${st.id}__s${i + 1}`, title, status: 'todo' as const })),
        targetDate: st.targetDate ?? prev?.targetDate ?? null, venue: prev?.venue, notes: prev?.notes,
        sortOrder: prev?.sortOrder ?? studyOrder++,
      };
      await db.studies.put(row);
      bump(prev ? updated : created, 'studies');
    }

    // Skills — level, evidence and path ticks are the user's once created.
    let skillOrder = await db.skills.count();
    for (const sk of config.skills ?? []) {
      const prev = await db.skills.get(sk.id);
      const doneAt = new Map((prev?.path ?? []).map((x) => [x.id, x.doneAt]));
      const row: Skill = {
        id: sk.id, createdAt: prev?.createdAt ?? now, updatedAt: now, name: sk.name, category: sk.category,
        level: prev?.level ?? sk.level ?? 0, targetLevel: sk.targetLevel ?? prev?.targetLevel ?? 3,
        trackerId: sk.trackerId ?? prev?.trackerId ?? null,
        path: (sk.path ?? []).map((x) => ({ ...x, doneAt: doneAt.get(x.id) ?? null })),
        evidence: prev?.evidence ?? [], notes: prev?.notes, sortOrder: prev?.sortOrder ?? skillOrder++,
      };
      await db.skills.put(row);
      bump(prev ? updated : created, 'skills');
    }

    // Exam tracks — target/date are the user's once created; score log untouched.
    let examOrder = await db.examTracks.count();
    for (const t of config.examTracks ?? []) {
      const prev = await db.examTracks.get(t.id);
      const row: ExamTrack = {
        id: t.id, createdAt: prev?.createdAt ?? now, updatedAt: now, title: t.title, family: t.family,
        sections: t.sections.map((sec) => ({ ...sec, trackerId: prev?.sections.find((x) => x.id === sec.id)?.trackerId ?? sec.trackerId ?? null })),
        target: prev?.target ?? t.target, minTotal: t.minTotal, maxTotal: t.maxTotal, directTotal: t.directTotal,
        examDate: prev?.examDate ?? t.examDate ?? null, goalId: t.goalId ?? null, notes: prev?.notes, sortOrder: prev?.sortOrder ?? examOrder++,
      };
      await db.examTracks.put(row);
      bump(prev ? updated : created, 'examTracks');
    }

    // Redeemable rewards
    let sort = await db.rewards.count();
    for (const r of config.rewards ?? []) {
      const prev = await db.rewards.get(r.id);
      const row: CustomReward = {
        id: r.id,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        name: r.name,
        description: r.description ?? '',
        xpValue: 0,
        treat: r.name,
        condition: { id: `${r.id}:root`, type: 'and', children: [] },
        repeat: 'once',
        archived: prev?.archived ?? false,
        sortOrder: prev?.sortOrder ?? sort++,
        kind: 'redeemable',
        cost: r.cost,
      };
      await db.rewards.put(row);
      bump(prev ? updated : created, 'rewards');
    }
  });

  if (config.xp) await updateSchedulingConfig({ xp: config.xp });
  await syncAllSequences();

  const today = new Date(now);
  const todayKeyStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const from = config.startDate > todayKeyStr ? config.startDate : todayKeyStr;
  const days = options.materialiseDays ?? 60;
  const gen = days > 0 ? await materialiseAllRules(from, addDaysToKey(from, days - 1)) : { blocksCreated: 0 };
  if (days > 0) await evaluateAchievements();

  const achievementCount = await db.achievements.count();
  const total = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
  return {
    ok: true,
    validation,
    created,
    updated,
    blocksGenerated: gen.blocksCreated,
    achievementCount,
    message: `Configuration applied: ${total(created)} created, ${total(updated)} updated, ${gen.blocksCreated} calendar blocks generated. ${achievementCount} achievements in total.`,
  };
}
