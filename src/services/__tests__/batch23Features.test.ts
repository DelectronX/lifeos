import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, EXPORTABLE_TABLES } from '@/db/db';
import { ensureSeeded } from '@/db/seed';
import { buildBlock, skipBlock, swapBlockSlots } from '@/services/scheduleService';
import { buildRecurringRule, materialiseRule } from '@/services/recurrenceService';
import { getWeeklyReflection, saveWeeklyReflection } from '@/services/reflectionService';
import { assessLoad, makeLightDay, MISSED_THRESHOLD } from '@/services/burnoutService';
import { assignPaper, upcomingPaperSlots } from '@/services/examPlannerService';
import { buildContext, readCustomMetric } from '@/engines/customMetrics';
import { addDaysToKey, todayKey } from '@/lib/date';
import type { Tracker } from '@/types';

function tracker(id: string, parentId: string | null = null): Tracker {
  return {
    id, createdAt: 1, updatedAt: 1, name: id.replace('trk_', ''), pillar: 'study', parentId, color: 'indigo',
    system: false, defaultProtected: false, archived: false, sortOrder: 0,
  };
}

const at = (date: string, h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();

describe('Batch 2 & 3 — weekly review, swap, burnout guard, exam planner', () => {
  beforeEach(async () => {
    await db.open();
    for (const name of EXPORTABLE_TABLES) await db.table(name).clear();
    await ensureSeeded();
    await db.trackers.bulkPut([tracker('trk_academic'), tracker('trk_physics', 'trk_academic'), tracker('trk_chem', 'trk_academic'), tracker('trk_exam')]);
  });

  it('weekly review: one record per week, priorities become tasks once, and count as reviews', async () => {
    const week = '2026-10-12';
    const review = { answers: { wins: 'Consistent mornings' }, priorities: [{ title: 'Finish optics', trackerId: 'trk_physics' }] };
    const ids1 = await saveWeeklyReflection(week, review);
    const ids2 = await saveWeeklyReflection(week, { ...review, answers: { wins: 'Edited' } });
    expect(ids1).toHaveLength(1);
    expect(ids2).toEqual(ids1);
    expect(await db.tasks.count()).toBe(1);
    const task = await db.tasks.get(ids1[0]!);
    expect(task?.trackerId).toBe('trk_physics');
    expect(task?.dueDate).toBe(addDaysToKey(week, 13));
    expect((await getWeeklyReflection(week))?.answers.wins).toBe('Edited');
    expect((await db.activities.toArray()).filter((a) => a.type === 'weekly_review')).toHaveLength(1);

    const ctx = buildContext({
      activities: await db.activities.toArray(), tasks: [], sessions: [], papers: [], blocks: [], goals: [],
      cycles: [], totalXP: 0, today: week, trackerParents: {},
    });
    expect(readCustomMetric('reviews:weekly', ctx)).toBe(1);
    expect(readCustomMetric('reviews:daily', ctx)).toBe(0);
  });

  it('swap trades two slots for that day only and keeps the series for other days', async () => {
    const day = addDaysToKey(todayKey(), 1);
    const ruleA = buildRecurringRule({
      title: 'Cyber', freq: 'weekly', byWeekday: [0, 1, 2, 3, 4, 5, 6], startDate: day, target: 'block',
      blockTemplate: { startMinute: 14 * 60 + 30, durationMinutes: 60, trackerId: 'trk_academic', title: 'Cyber', kind: 'fixed', protected: false },
    } as never);
    await db.recurringRules.add(ruleA);
    await materialiseRule(ruleA, day, addDaysToKey(day, 1));
    const [a, a2] = (await db.blocks.where('recurringRuleId').equals(ruleA.id).sortBy('start'));
    const b = buildBlock({ trackerId: 'trk_physics', title: 'SAT', kind: 'fixed', start: at(day, 20), end: at(day, 21, 30) });
    await db.blocks.add(b);

    const res = await swapBlockSlots(a!.id, b.id);
    expect(res.ok).toBe(true);
    expect((await db.blocks.get(a!.id))?.start).toBe(at(day, 20));
    expect((await db.blocks.get(b.id))?.start).toBe(at(day, 14, 30));
    expect((await db.blocks.get(a2!.id))?.start).toBe(at(addDaysToKey(day, 1), 14, 30)); // next day untouched
    // Regenerating the series does not recreate the moved occurrence.
    const rule = await db.recurringRules.get(ruleA.id);
    await materialiseRule(rule!, day, addDaysToKey(day, 1));
    expect(await db.blocks.where('recurringRuleId').equals(ruleA.id).count()).toBe(2);
  });

  it('burnout guard only triggers after two heavy days and the light day spares protected blocks', async () => {
    const today = todayKey();
    const now = Date.now();
    for (const back of [1, 2]) {
      const d = addDaysToKey(today, -back);
      for (let i = 0; i < MISSED_THRESHOLD; i++) {
        const blk = buildBlock({ trackerId: 'trk_academic', title: `w${i}`, kind: 'fixed', start: at(d, 9 + i), end: at(d, 10 + i) });
        await db.blocks.add(blk);
        if (i === 0) await skipBlock(blk.id);
      }
    }
    expect((await assessLoad(today, now)).struggling).toBe(true);

    const later = new Date(now + 3_600_000);
    const s = (h: number) => later.getTime() + h * 3_600_000;
    const open = buildBlock({ trackerId: 'trk_academic', title: 'Study', kind: 'fixed', start: s(0), end: s(1) });
    const school = buildBlock({ trackerId: 'trk_academic', title: 'School', kind: 'fixed', start: s(1), end: s(2) });
    school.protected = true;
    await db.blocks.bulkAdd([{ ...open, date: today }, { ...school, date: today }]);

    expect(await makeLightDay(today, now)).toBe(1);
    expect((await db.blocks.get(open.id))?.optional).toBe(true);
    expect((await db.blocks.get(school.id))?.optional).toBeFalsy();
    const again = await assessLoad(today, now);
    expect(again.lightDayToday).toBe(true);
    expect(again.lightDayAvailable).toBe(false);
  });

  it('exam planner creates a real paper for a slot and links it to the block', async () => {
    const day = addDaysToKey(todayKey(), 2);
    const rule = buildRecurringRule({
      title: 'Exam paper', freq: 'weekly', byWeekday: [new Date(`${day}T12:00:00`).getDay()], startDate: todayKey(), target: 'block',
      blockTemplate: {
        startMinute: 18 * 60, durationMinutes: 120, trackerId: 'trk_exam', title: 'Exam paper', kind: 'fixed', protected: false,
        paperSubjects: ['trk_physics', 'trk_chem'], paperQuestions: 25,
      },
    } as never);
    await db.recurringRules.add(rule);
    await materialiseRule(rule, todayKey(), addDaysToKey(todayKey(), 13));

    const slots = await upcomingPaperSlots(todayKey());
    const slot = slots.find((s) => s.date === day)!;
    expect(slot.subjects.map((s) => s.id)).toEqual(['trk_physics', 'trk_chem']);

    const res = await assignPaper(slot, 'trk_chem', 25);
    expect(res.ok).toBe(true);
    const block = await db.blocks.get(slot.block!.id);
    expect(block?.paperId).toBe(res.paper!.id);
    expect(block?.title).toBe('Exam paper — chem');
    expect(await db.questions.where('paperId').equals(res.paper!.id).count()).toBe(25);
    expect(res.paper!.durationMinutes).toBe(120);

    // Changing the subject replaces the unstarted paper rather than adding one.
    const [again] = (await upcomingPaperSlots(todayKey())).filter((s) => s.date === day);
    await assignPaper(again!, 'trk_physics', 25);
    expect(await db.papers.count()).toBe(1);
  });
});
