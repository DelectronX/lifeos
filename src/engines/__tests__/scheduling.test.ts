import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as BASE } from '@/config/schedulingConfig';
import { computeAvailability, findFreeSlots, planSchedule } from '@/engines/scheduling';
import { minuteOfDay } from '@/lib/date';
import type { SchedulingConfig, WorkingHours } from '@/types';
import {
  ALL_DAY_HOURS, DAY, DAY2, PREFS, at, makeBlock, makeTask, minutes, nowAt, prefs, resetIds,
} from './fixtures';

// No lead time in tests, so "now" is exactly the earliest schedulable instant.
const CONFIG: SchedulingConfig = {
  ...BASE,
  slots: { ...BASE.slots, leadTimeMinutes: 0, horizonDays: 5 },
};

const availabilityBase = {
  workingHours: ALL_DAY_HOURS,
  now: nowAt(DAY, 8),
};

describe('computeAvailability', () => {
  it('returns the whole working window when nothing is scheduled', () => {
    const slots = findFreeSlots(DAY, { ...availabilityBase, blocks: [] }, CONFIG);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startMinute).toBe(9 * 60);
    expect(slots[0]!.endMinute).toBe(18 * 60);
    expect(slots[0]!.durationMinutes).toBe(540);
  });

  it('carves protected blocks out of the day and never offers that time', () => {
    const lunch = makeBlock({
      title: 'Lunch', protected: true, kind: 'meal',
      start: at(DAY, 13), end: at(DAY, 14),
    });
    const school = makeBlock({
      title: 'School', protected: true, kind: 'fixed',
      start: at(DAY, 9), end: at(DAY, 12),
    });

    const slots = findFreeSlots(DAY, { ...availabilityBase, blocks: [school, lunch] }, CONFIG);
    expect(slots.map((s) => [s.startMinute, s.endMinute])).toEqual([
      [12 * 60, 13 * 60],
      [14 * 60, 18 * 60],
    ]);
    // Nothing offered overlaps the protected time.
    for (const s of slots) {
      expect(s.start < school.end && school.start < s.end).toBe(false);
      expect(s.start < lunch.end && lunch.start < s.end).toBe(false);
    }
  });

  it('treats locked blocks as busy too', () => {
    const locked = makeBlock({ locked: true, start: at(DAY, 10), end: at(DAY, 11) });
    const slots = findFreeSlots(DAY, { ...availabilityBase, blocks: [locked] }, CONFIG);
    expect(slots.map((s) => s.startMinute)).toEqual([9 * 60, 11 * 60]);
  });

  it('releases time held by cancelled and skipped blocks', () => {
    const cancelled = makeBlock({ status: 'cancelled', start: at(DAY, 10), end: at(DAY, 12) });
    const skipped = makeBlock({ status: 'skipped', start: at(DAY, 14), end: at(DAY, 15) });
    const slots = findFreeSlots(DAY, { ...availabilityBase, blocks: [cancelled, skipped] }, CONFIG);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.durationMinutes).toBe(540);
  });

  it('never offers time in the past', () => {
    const slots = findFreeSlots(
      DAY, { ...availabilityBase, blocks: [], now: nowAt(DAY, 14, 20) }, CONFIG,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startMinute).toBe(14 * 60 + 20);
  });

  it('honours the lead time so nothing starts immediately', () => {
    const withLead = { ...CONFIG, slots: { ...CONFIG.slots, leadTimeMinutes: 30 } };
    const slots = findFreeSlots(
      DAY, { ...availabilityBase, blocks: [], now: nowAt(DAY, 10) }, withLead,
    );
    expect(slots[0]!.startMinute).toBe(10 * 60 + 30);
  });

  it('drops gaps shorter than minUsableSlotMinutes', () => {
    const a = makeBlock({ start: at(DAY, 9), end: at(DAY, 12) });
    const b = makeBlock({ start: at(DAY, 12, 10), end: at(DAY, 18) });
    const slots = findFreeSlots(DAY, { ...availabilityBase, blocks: [a, b] }, CONFIG);
    expect(slots).toHaveLength(0); // the 10 min gap is below the 15 min floor
  });

  it('respects per-weekday working hours across a range', () => {
    const hours: WorkingHours = {
      ...ALL_DAY_HOURS,
      2: [], // Tuesday off — DAY2 is a Tuesday
    };
    const days = computeAvailability(
      { from: DAY, to: DAY2, workingHours: hours, blocks: [], now: nowAt(DAY, 8) },
      CONFIG,
    );
    expect(days).toHaveLength(2);
    expect(days[0]!.freeMinutes).toBe(540);
    expect(days[1]!.freeMinutes).toBe(0);
    expect(days[1]!.slots).toHaveLength(0);
  });

  it('reports protected vs committed minutes separately', () => {
    const day = computeAvailability(
      {
        from: DAY, to: DAY, workingHours: ALL_DAY_HOURS, now: nowAt(DAY, 8),
        blocks: [
          makeBlock({ protected: true, start: at(DAY, 13), end: at(DAY, 14) }),
          makeBlock({ start: at(DAY, 15), end: at(DAY, 16, 30) }),
        ],
      },
      CONFIG,
    )[0]!;
    expect(day.protectedMinutes).toBe(60);
    expect(day.committedMinutes).toBe(90);
    expect(day.workingMinutes).toBe(540);
  });

  it('ignoreBlockIds frees the named block for replanning', () => {
    const b = makeBlock({ id: 'moving', start: at(DAY, 10), end: at(DAY, 12) });
    const without = findFreeSlots(DAY, { ...availabilityBase, blocks: [b] }, CONFIG);
    const with_ = findFreeSlots(
      DAY, { ...availabilityBase, blocks: [b], ignoreBlockIds: ['moving'] }, CONFIG,
    );
    expect(without).toHaveLength(2);
    expect(with_).toHaveLength(1);
  });
});

describe('planSchedule', () => {
  const planBase = { preferences: PREFS, now: nowAt(DAY, 8), from: DAY, blocks: [] as never[] };

  it('places a single task in the earliest free slot', () => {
    resetIds();
    const task = makeTask({ estimatedMinutes: 60 });
    const r = planSchedule({ ...planBase, tasks: [task] }, CONFIG);

    expect(r.proposals).toHaveLength(1);
    expect(r.unplaced).toHaveLength(0);
    expect(minuteOfDay(r.proposals[0]!.start)).toBe(9 * 60);
    expect(r.proposals[0]!.durationMinutes).toBe(60);
    expect(r.proposals[0]!.taskId).toBe(task.id);
    expect(r.placements[0]!.reason).toContain('Placed 60 min');
  });

  it('never overlaps existing blocks or its own proposals', () => {
    resetIds();
    const existing = makeBlock({ protected: true, start: at(DAY, 12), end: at(DAY, 13) });
    const tasks = [
      makeTask({ id: 't1', estimatedMinutes: 120 }),
      makeTask({ id: 't2', estimatedMinutes: 120 }),
      makeTask({ id: 't3', estimatedMinutes: 60 }),
    ];
    const r = planSchedule({ ...planBase, tasks, blocks: [existing] }, CONFIG);

    const all = [...r.proposals.map((p) => ({ start: p.start, end: p.end })), existing];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]!.start < all[j]!.end && all[j]!.start < all[i]!.end).toBe(false);
      }
    }
  });

  it('schedules higher-priority work first', () => {
    resetIds();
    const low = makeTask({ id: 'low', basePriority: 1, estimatedMinutes: 120 });
    const high = makeTask({ id: 'high', basePriority: 5, dueDate: DAY, deadlineHard: true, estimatedMinutes: 120 });
    const r = planSchedule({ ...planBase, tasks: [low, high] }, CONFIG);

    const highBlock = r.proposals.find((p) => p.taskId === 'high')!;
    const lowBlock = r.proposals.find((p) => p.taskId === 'low')!;
    expect(highBlock.start).toBeLessThan(lowBlock.start);
  });

  it('finishes hard-deadline work before the deadline', () => {
    resetIds();
    const task = makeTask({ estimatedMinutes: 120, dueDate: DAY, deadlineHard: true });
    const r = planSchedule({ ...planBase, tasks: [task], to: '2026-03-06' }, CONFIG);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.date).toBe(DAY);
    expect(r.proposals[0]!.end).toBeLessThanOrEqual(at(DAY2, 0));
  });

  it('refuses to schedule past a hard deadline and says why', () => {
    resetIds();
    // Only 60 min free today, but 300 min of hard-deadline work due today.
    const busy = makeBlock({ protected: true, start: at(DAY, 10), end: at(DAY, 18) });
    const task = makeTask({
      id: 'big', estimatedMinutes: 300, dueDate: DAY, deadlineHard: true, splittable: false,
    });
    const r = planSchedule({ ...planBase, tasks: [task], blocks: [busy] }, CONFIG);

    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]!.taskId).toBe('big');
    expect(r.unplaced[0]!.reason.length).toBeGreaterThan(20);
    expect(['no_slot_before_deadline', 'not_splittable_no_contiguous_slot'])
      .toContain(r.unplaced[0]!.code);
  });

  it('splits a splittable task across sessions bounded by maxSessionMinutes', () => {
    resetIds();
    const task = makeTask({
      id: 'split', estimatedMinutes: 240, splittable: true,
      minSessionMinutes: 30, maxSessionMinutes: 60,
    });
    const r = planSchedule({ ...planBase, tasks: [task] }, CONFIG);

    expect(r.proposals.length).toBe(4);
    for (const p of r.proposals) expect(p.durationMinutes).toBeLessThanOrEqual(60);
    expect(r.proposals.reduce((s, p) => s + p.durationMinutes, 0)).toBe(240);
    expect(r.placements[0]!.split).toBe(true);
    expect(r.proposals[0]!.splitCount).toBe(4);
    expect(r.proposals[0]!.title).toContain('(1/4)');
    expect(r.proposals.every((p) => p.splitGroupId === r.proposals[0]!.splitGroupId)).toBe(true);
  });

  it('refuses to split a non-splittable task with no contiguous room', () => {
    resetIds();
    // Free gaps today: 9-11 (120), 12-14 (120), 15-18 (180) -> longest 180.
    const a = makeBlock({ protected: true, start: at(DAY, 11), end: at(DAY, 12) });
    const b = makeBlock({ protected: true, start: at(DAY, 14), end: at(DAY, 15) });
    const task = makeTask({ id: 'mono', estimatedMinutes: 240, splittable: false });
    const r = planSchedule(
      { ...planBase, tasks: [task], blocks: [a, b], to: DAY }, CONFIG,
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced[0]!.code).toBe('not_splittable_no_contiguous_slot');
    expect(r.unplaced[0]!.reason).toContain('one unbroken sitting');
    expect(r.unplaced[0]!.reason).toContain('180 min');
  });

  it('places the same task fine when the gap is just big enough', () => {
    resetIds();
    const a = makeBlock({ protected: true, start: at(DAY, 11), end: at(DAY, 12) });
    const b = makeBlock({ protected: true, start: at(DAY, 14), end: at(DAY, 15) });
    const task = makeTask({ id: 'fits', estimatedMinutes: 180, splittable: false });
    const r = planSchedule(
      { ...planBase, tasks: [task], blocks: [a, b], to: DAY }, CONFIG,
    );
    expect(r.proposals).toHaveLength(1);
    expect(minuteOfDay(r.proposals[0]!.start)).toBe(15 * 60);
  });

  it('never schedules a task before its unfinished dependency', () => {
    resetIds();
    const first = makeTask({ id: 'first', title: 'First', basePriority: 1, estimatedMinutes: 60 });
    const second = makeTask({
      id: 'second', title: 'Second', basePriority: 5, estimatedMinutes: 60, dependsOn: ['first'],
    });
    const r = planSchedule({ ...planBase, tasks: [second, first] }, CONFIG);

    const f = r.proposals.find((p) => p.taskId === 'first')!;
    const s = r.proposals.find((p) => p.taskId === 'second')!;
    expect(f).toBeDefined();
    expect(s).toBeDefined();
    // Even though `second` has higher priority, it comes after its prerequisite.
    expect(f.start).toBeLessThan(s.start);
  });

  it('rejects a task whose dependency is not in the batch and unfinished', () => {
    resetIds();
    const blocker = makeTask({ id: 'blk', status: 'in_progress' });
    const dependent = makeTask({ id: 'dep', dependsOn: ['blk'] });
    // Only the dependent is offered for scheduling.
    const r = planSchedule(
      { ...planBase, tasks: [dependent], blocks: [] }, CONFIG,
    );
    // `blk` is unknown to the batch, so it is treated as satisfied.
    expect(r.proposals).toHaveLength(1);

    // But when the blocker IS in scope and unfinished, ordering applies.
    const r2 = planSchedule({ ...planBase, tasks: [dependent, blocker] }, CONFIG);
    const d = r2.proposals.find((p) => p.taskId === 'dep')!;
    const b = r2.proposals.find((p) => p.taskId === 'blk')!;
    expect(b.start).toBeLessThan(d.start);
  });

  it('inserts break padding after a long high-intensity session', () => {
    resetIds();
    const intense = makeTask({
      id: 'hard', estimatedMinutes: 90, intensity: 'high', basePriority: 5,
      dueDate: DAY, deadlineHard: true,
    });
    const next = makeTask({ id: 'next', estimatedMinutes: 60, basePriority: 1 });
    const r = planSchedule({ ...planBase, tasks: [intense, next] }, CONFIG);

    const a = r.proposals.find((p) => p.taskId === 'hard')!;
    const b = r.proposals.find((p) => p.taskId === 'next')!;
    expect(minutes(a.end, b.start)).toBeGreaterThanOrEqual(CONFIG.breaks.breakMinutes);
  });

  it('prefers the task-preferred time window when it can', () => {
    resetIds();
    const evening = makeTask({ id: 'pm', estimatedMinutes: 60, preferredWindow: 'evening' });
    const r = planSchedule({ ...planBase, tasks: [evening] }, CONFIG);
    const mid = minuteOfDay(r.proposals[0]!.start) + 30;
    expect(mid).toBeGreaterThanOrEqual(CONFIG.windows.evening[0]);
  });

  it('spills work onto later days when today is full', () => {
    resetIds();
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({ id: `t${i}`, estimatedMinutes: 120, basePriority: 3 }));
    const r = planSchedule({ ...planBase, tasks, to: '2026-03-06' }, CONFIG);
    const dates = new Set(r.proposals.map((p) => p.date));
    expect(dates.size).toBeGreaterThan(1);
  });

  it('respects the daily load ceiling', () => {
    resetIds();
    const capped = { ...CONFIG, slots: { ...CONFIG.slots, maxDailyLoadMinutes: 120 } };
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ id: `c${i}`, estimatedMinutes: 60 }));
    const r = planSchedule({ ...planBase, tasks, to: DAY2 }, capped);

    for (const [, mins] of Object.entries(r.loadByDate)) {
      expect(mins).toBeLessThanOrEqual(120);
    }
  });

  it('skips completed and cancelled tasks entirely', () => {
    resetIds();
    const r = planSchedule({
      ...planBase,
      tasks: [
        makeTask({ id: 'done', status: 'completed' }),
        makeTask({ id: 'dead', status: 'cancelled' }),
      ],
    }, CONFIG);
    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced).toHaveLength(0);
  });

  it('subtracts already-logged minutes from what it schedules', () => {
    resetIds();
    const task = makeTask({ estimatedMinutes: 90, actualMinutes: 30 });
    const r = planSchedule({ ...planBase, tasks: [task] }, CONFIG);
    expect(r.proposals[0]!.durationMinutes).toBe(60);
  });

  it('reports remaining availability after the plan is applied', () => {
    resetIds();
    const r = planSchedule(
      { ...planBase, tasks: [makeTask({ estimatedMinutes: 120 })], to: DAY }, CONFIG,
    );
    expect(r.remainingAvailability[0]!.freeMinutes).toBe(540 - 120);
    expect(r.loadByDate[DAY]).toBe(120);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    resetIds();
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 60, basePriority: 4 }),
      makeTask({ id: 'b', estimatedMinutes: 45, basePriority: 2 }),
      makeTask({ id: 'c', estimatedMinutes: 90, splittable: true }),
    ];
    const one = planSchedule({ ...planBase, tasks }, CONFIG);
    const two = planSchedule({ ...planBase, tasks }, CONFIG);
    expect(JSON.stringify(one.proposals)).toBe(JSON.stringify(two.proposals));
  });

  it('places nothing on a day with no working hours', () => {
    resetIds();
    const closed = prefs({ workingHours: { ...ALL_DAY_HOURS, 1: [] } }); // Monday off
    const r = planSchedule(
      { ...planBase, preferences: closed, tasks: [makeTask()], to: DAY }, CONFIG,
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced[0]!.code).toBe('no_slot_in_horizon');
  });
});
