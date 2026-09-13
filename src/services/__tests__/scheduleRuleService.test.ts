import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import {
  createScheduleRule, deleteScheduleRule, detectRuleConflicts, duplicateScheduleRule,
  listActiveScheduleRules, loadSubjectWindowRules, toSubjectWindowRules, updateScheduleRule,
} from '@/services/scheduleRuleService';

describe('scheduleRuleService', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) {
      await db.table(name).clear();
    }
    await db.scheduleRules.clear();
  });

  it('creates a rule with sorted, deduped days', async () => {
    const rule = await createScheduleRule({
      trackerId: 'trk_maths', days: [5, 1, 3, 1], startMinute: 16 * 60, endMinute: 18 * 60,
    });
    expect(rule.days).toEqual([1, 3, 5]);
    expect(rule.active).toBe(true);
    expect(await db.scheduleRules.count()).toBe(1);
  });

  it('updates and toggles active without touching other fields', async () => {
    const rule = await createScheduleRule({ trackerId: 't1', days: [1], startMinute: 60, endMinute: 120 });
    await updateScheduleRule(rule.id, { active: false });
    const fresh = await db.scheduleRules.get(rule.id);
    expect(fresh!.active).toBe(false);
    expect(fresh!.days).toEqual([1]);
  });

  it('deletes a rule', async () => {
    const rule = await createScheduleRule({ trackerId: 't1', days: [1], startMinute: 60, endMinute: 120 });
    await deleteScheduleRule(rule.id);
    expect(await db.scheduleRules.get(rule.id)).toBeUndefined();
  });

  it('duplicates a rule as inactive so it never silently doubles a constraint', async () => {
    const rule = await createScheduleRule({
      trackerId: 't1', days: [1, 2], startMinute: 60, endMinute: 120, active: true,
    });
    const copy = await duplicateScheduleRule(rule.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(rule.id);
    expect(copy!.active).toBe(false);
    expect(copy!.days).toEqual([1, 2]);
  });

  it('listActiveScheduleRules excludes inactive rules', async () => {
    await createScheduleRule({ trackerId: 't1', days: [1], startMinute: 60, endMinute: 120, active: true });
    await createScheduleRule({ trackerId: 't2', days: [1], startMinute: 60, endMinute: 120, active: false });
    const active = await listActiveScheduleRules();
    expect(active).toHaveLength(1);
    expect(active[0]!.trackerId).toBe('t1');
  });

  it('toSubjectWindowRules drops inactive rules and empty/invalid windows', () => {
    const rules = [
      { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 't1', days: [1], startMinute: 60, endMinute: 120, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3 as const, active: true },
      { id: 'b', createdAt: 0, updatedAt: 0, trackerId: 't2', days: [1], startMinute: 60, endMinute: 120, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3 as const, active: false },
      { id: 'c', createdAt: 0, updatedAt: 0, trackerId: 't3', days: [], startMinute: 60, endMinute: 120, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3 as const, active: true },
      { id: 'd', createdAt: 0, updatedAt: 0, trackerId: 't4', days: [1], startMinute: 120, endMinute: 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3 as const, active: true },
    ];
    const out = toSubjectWindowRules(rules);
    expect(out).toHaveLength(1);
    expect(out[0]!.trackerId).toBe('t1');
  });

  it('loadSubjectWindowRules reads straight from Dexie', async () => {
    await createScheduleRule({ trackerId: 'trk_maths', days: [1, 2, 3, 4, 5], startMinute: 16 * 60, endMinute: 18 * 60 });
    const out = await loadSubjectWindowRules();
    expect(out).toHaveLength(1);
    expect(out[0]!.trackerId).toBe('trk_maths');
  });

  describe('detectRuleConflicts', () => {
    it('flags a rule with no days as a capacity conflict', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 't1', days: [], startMinute: 60, endMinute: 120, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
      ]);
      expect(conflicts.some((c) => c.kind === 'capacity' && c.trackerIds.includes('t1'))).toBe(true);
    });

    it('flags an inverted window (end <= start) as a capacity conflict', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 't1', days: [1], startMinute: 120, endMinute: 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
      ]);
      expect(conflicts.some((c) => c.kind === 'capacity')).toBe(true);
    });

    it('flags two DIFFERENT subjects with overlapping windows on a shared day', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 'maths', days: [1], startMinute: 16 * 60, endMinute: 18 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
        { id: 'b', createdAt: 0, updatedAt: 0, trackerId: 'physics', days: [1], startMinute: 17 * 60, endMinute: 19 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
      ]);
      const overlap = conflicts.find((c) => c.kind === 'overlap');
      expect(overlap).toBeDefined();
      expect(overlap!.trackerIds).toEqual(expect.arrayContaining(['maths', 'physics']));
    });

    it('does not flag the same subject having two rules on the same day as an overlap', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 'maths', days: [1], startMinute: 16 * 60, endMinute: 18 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
        { id: 'b', createdAt: 0, updatedAt: 0, trackerId: 'maths', days: [1], startMinute: 17 * 60, endMinute: 19 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
      ]);
      expect(conflicts.some((c) => c.kind === 'overlap')).toBe(false);
    });

    it('does not flag non-overlapping windows or different days', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 'maths', days: [1], startMinute: 16 * 60, endMinute: 18 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
        { id: 'b', createdAt: 0, updatedAt: 0, trackerId: 'physics', days: [2], startMinute: 16 * 60, endMinute: 18 * 60, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: true },
      ]);
      expect(conflicts.some((c) => c.kind === 'overlap')).toBe(false);
    });

    it('ignores inactive rules entirely', () => {
      const conflicts = detectRuleConflicts([
        { id: 'a', createdAt: 0, updatedAt: 0, trackerId: 't1', days: [], startMinute: 60, endMinute: 120, minSessionMinutes: 20, maxSessionMinutes: 60, priority: 3, active: false },
      ]);
      expect(conflicts).toHaveLength(0);
    });
  });
});
