import { db } from '@/db/db';
import { newId } from '@/lib/id';
import type { ID, ScheduleRule } from '@/types';
import type { SubjectWindowRule } from '@/types/scheduling';

/**
 * ScheduleRuleService — CRUD for user-defined HARD subject/day/time-window
 * rules (the "Auto Plan" rule builder), plus the adapter that turns active
 * rules into the constraint shape the scheduling engine consumes.
 *
 * A ScheduleRule never materialises anything on its own (unlike
 * RecurringRule): it only narrows WHERE `planSchedule` is allowed to place
 * tasks belonging to its tracker. Multiple active rules for the same
 * tracker are unioned (any of their windows is allowed) — the guarantee is
 * "never outside ALL configured windows", not "only inside one particular
 * rule".
 */

export interface ScheduleRuleDraft {
  trackerId: ID;
  days: number[];
  startMinute: number;
  endMinute: number;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
  priority?: 1 | 2 | 3 | 4 | 5;
  active?: boolean;
}

export function buildScheduleRule(draft: ScheduleRuleDraft, now = Date.now()): ScheduleRule {
  return {
    id: newId('sr'),
    createdAt: now,
    updatedAt: now,
    trackerId: draft.trackerId,
    days: [...new Set(draft.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b),
    startMinute: Math.max(0, Math.min(1440, Math.round(draft.startMinute))),
    endMinute: Math.max(0, Math.min(1440, Math.round(draft.endMinute))),
    minSessionMinutes: draft.minSessionMinutes ?? 20,
    maxSessionMinutes: draft.maxSessionMinutes ?? 120,
    priority: draft.priority ?? 3,
    active: draft.active ?? true,
  };
}

export async function createScheduleRule(draft: ScheduleRuleDraft): Promise<ScheduleRule> {
  const rule = buildScheduleRule(draft);
  await db.scheduleRules.add(rule);
  return rule;
}

export async function updateScheduleRule(id: ID, patch: Partial<ScheduleRule>): Promise<void> {
  await db.scheduleRules.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteScheduleRule(id: ID): Promise<void> {
  await db.scheduleRules.delete(id);
}

export async function duplicateScheduleRule(id: ID): Promise<ScheduleRule | null> {
  const rule = await db.scheduleRules.get(id);
  if (!rule) return null;
  return createScheduleRule({
    trackerId: rule.trackerId,
    days: rule.days,
    startMinute: rule.startMinute,
    endMinute: rule.endMinute,
    minSessionMinutes: rule.minSessionMinutes,
    maxSessionMinutes: rule.maxSessionMinutes,
    priority: rule.priority,
    active: false, // duplicates land inactive so they never silently double-constrain
  });
}

export async function listScheduleRules(): Promise<ScheduleRule[]> {
  return db.scheduleRules.toArray();
}

export async function listActiveScheduleRules(): Promise<ScheduleRule[]> {
  const all = await db.scheduleRules.toArray();
  return all.filter((r) => r.active);
}

/**
 * Converts every active rule into the engine's `SubjectWindowRule` shape.
 * Multiple rules for the same tracker keep their own day/window pairs —
 * `outsideAllowedWindow` (in scheduling.ts) checks whether ANY of a
 * subject's rules cover a candidate moment.
 */
export function toSubjectWindowRules(rules: readonly ScheduleRule[]): SubjectWindowRule[] {
  return rules
    .filter((r) => r.active && r.days.length > 0 && r.endMinute > r.startMinute)
    .map((r) => ({
      trackerId: r.trackerId,
      days: r.days,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    }));
}

export async function loadSubjectWindowRules(): Promise<SubjectWindowRule[]> {
  const rules = await listScheduleRules();
  return toSubjectWindowRules(rules);
}

/* ------------------------------------------------------------------ */
/* Conflict detection                                                  */
/* ------------------------------------------------------------------ */

export interface RuleConflict {
  kind: 'overlap' | 'capacity';
  trackerIds: ID[];
  message: string;
}

/**
 * Two kinds of conflicts are surfaced (never silently dropped):
 *  - `overlap`: two DIFFERENT subjects both claim exclusive-looking windows
 *    that overlap on the same day. Rules are still unioned (both remain
 *    hard constraints for their own subject), but the user is told their
 *    windows compete for the same clock time.
 *  - `capacity`: a rule's total weekly window (days × window length) is
 *    zero, or the rule was defined active without any days — the window is
 *    unusable in practice.
 */
export function detectRuleConflicts(rules: readonly ScheduleRule[]): RuleConflict[] {
  const active = rules.filter((r) => r.active);
  const out: RuleConflict[] = [];

  for (const r of active) {
    if (r.days.length === 0) {
      out.push({
        kind: 'capacity',
        trackerIds: [r.trackerId],
        message: 'This rule has no days selected, so it can never place anything.',
      });
    } else if (r.endMinute <= r.startMinute) {
      out.push({
        kind: 'capacity',
        trackerIds: [r.trackerId],
        message: 'This rule\'s end time is not after its start time, so its window is empty.',
      });
    }
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      if (a.trackerId === b.trackerId) continue;
      const sharedDays = a.days.filter((d) => b.days.includes(d));
      if (sharedDays.length === 0) continue;
      const overlaps = a.startMinute < b.endMinute && b.startMinute < a.endMinute;
      if (overlaps) {
        out.push({
          kind: 'overlap',
          trackerIds: [a.trackerId, b.trackerId],
          message: 'These two subjects have overlapping hard windows on the same day(s) — only one can actually use the shared time.',
        });
      }
    }
  }

  return out;
}
