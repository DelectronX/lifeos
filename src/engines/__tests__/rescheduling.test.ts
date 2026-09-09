import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as BASE } from '@/config/schedulingConfig';
import {
  autoReschedule, buildRescheduleOptions, computeRemainingWork, detectOverload,
} from '@/engines/rescheduling';
import type { SchedulingConfig } from '@/types';
import {
  ALL_DAY_HOURS, DAY, DAY2, PREFS, at, makeBlock, makeTask, nowAt, resetIds,
} from './fixtures';

const CONFIG: SchedulingConfig = {
  ...BASE,
  slots: { ...BASE.slots, leadTimeMinutes: 0, horizonDays: 5 },
};

const base = { preferences: PREFS, now: nowAt(DAY, 8), blocks: [] as never[] };

describe('computeRemainingWork', () => {
  it('reports a skipped task as fully outstanding', () => {
    resetIds();
    const r = computeRemainingWork(
      { task: makeTask({ status: 'skipped', estimatedMinutes: 60 }), now: nowAt() }, CONFIG,
    );
    expect(r.kind).toBe('skipped');
    expect(r.remainingMinutes).toBe(60);
    expect(r.completedMinutes).toBe(0);
    expect(r.explanation).toContain('60 min still to do');
  });

  it('computes the remaining half of a partially-done task', () => {
    resetIds();
    const r = computeRemainingWork(
      { task: makeTask({ estimatedMinutes: 90, actualMinutes: 40 }), now: nowAt() }, CONFIG,
    );
    expect(r.kind).toBe('partial');
    expect(r.remainingMinutes).toBe(50);
    expect(r.explanation).toContain('40 of 90 min done');
  });

  it('detects an overrun beyond the tolerance', () => {
    resetIds();
    const r = computeRemainingWork(
      { task: makeTask({ estimatedMinutes: 60, actualMinutes: 95 }), now: nowAt() }, CONFIG,
    );
    expect(r.kind).toBe('overrun');
    expect(r.overrunMinutes).toBe(35);
    expect(r.remainingMinutes).toBe(0);
  });

  it('an overrun inside tolerance is not flagged as an overrun', () => {
    resetIds();
    const r = computeRemainingWork(
      { task: makeTask({ estimatedMinutes: 60, actualMinutes: 62 }), now: nowAt() }, CONFIG,
    );
    expect(r.kind).not.toBe('overrun');
    expect(r.overrunMinutes).toBe(2);
  });

  it('derives real time from block actuals when actualMinutes lags', () => {
    resetIds();
    const task = makeTask({ id: 'T', estimatedMinutes: 120, actualMinutes: 0 });
    const block = makeBlock({
      taskId: 'T', status: 'partial',
      actualStart: at(DAY, 9), actualEnd: at(DAY, 10),
    });
    const r = computeRemainingWork({ task, blocks: [block], now: nowAt() }, CONFIG);
    expect(r.completedMinutes).toBe(60);
    expect(r.remainingMinutes).toBe(60);
  });

  it('counts days overdue', () => {
    resetIds();
    const r = computeRemainingWork(
      { task: makeTask({ dueDate: '2026-02-27', status: 'planned' }), now: nowAt(DAY, 8) },
      CONFIG,
    );
    expect(r.daysOverdue).toBe(3);
    expect(r.explanation).toContain('3 days overdue');
  });
});

describe('buildRescheduleOptions', () => {
  const optBase = { ...base, tasks: [] as never[], now: nowAt(DAY, 8) };

  it('offers next-slot, tomorrow, manual and cancel with real explanations', () => {
    resetIds();
    const task = makeTask({ id: 'T', status: 'skipped', estimatedMinutes: 60 });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);

    const kinds = r.options.map((o) => o.strategy);
    expect(kinds).toContain('next_slot');
    expect(kinds).toContain('tomorrow');
    expect(kinds).toContain('manual');
    expect(kinds).toContain('cancel');
    for (const o of r.options) expect(o.explanation.length).toBeGreaterThan(20);
  });

  it('next-slot lands today and tomorrow lands tomorrow', () => {
    resetIds();
    const task = makeTask({ id: 'T', estimatedMinutes: 60 });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);

    const next = r.options.find((o) => o.strategy === 'next_slot')!;
    const tom = r.options.find((o) => o.strategy === 'tomorrow')!;
    expect(next.proposedBlocks[0]!.date).toBe(DAY);
    expect(tom.proposedBlocks[0]!.date).toBe(DAY2);
    expect(tom.explanation).toContain('Move to tomorrow');
  });

  it('flags an option that lands after a hard deadline', () => {
    resetIds();
    // Today is entirely booked, so the earliest option is tomorrow — past the deadline.
    const busy = makeBlock({ protected: true, start: at(DAY, 9), end: at(DAY, 18) });
    const task = makeTask({ id: 'T', estimatedMinutes: 60, dueDate: DAY, deadlineHard: true });
    const r = buildRescheduleOptions(
      { ...optBase, task, tasks: [task], blocks: [busy] }, CONFIG,
    );
    const tom = r.options.find((o) => o.strategy === 'tomorrow')!;
    expect(tom.meetsDeadline).toBe(false);
    expect(tom.explanation).toContain('AFTER the');
  });

  it('offers a split option for a splittable task and explains the sessions', () => {
    resetIds();
    const task = makeTask({
      id: 'T', estimatedMinutes: 180, splittable: true, minSessionMinutes: 30,
    });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);
    const split = r.options.find((o) => o.strategy === 'split')!;
    expect(split.unavailableReason).toBeUndefined();
    expect(split.proposedBlocks.length).toBeGreaterThan(1);
    expect(split.coveredMinutes).toBe(180);
    expect(split.explanation).toContain('Break the remaining 180 min');
  });

  it('refuses to split a non-splittable task and says so', () => {
    resetIds();
    const task = makeTask({ id: 'T', estimatedMinutes: 180, splittable: false });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);
    const split = r.options.find((o) => o.strategy === 'split')!;
    expect(split.unavailableReason).toContain('not splittable');
  });

  it('displaces a clearly lower-priority flexible block', () => {
    resetIds();
    const mover = makeTask({
      id: 'urgent', title: 'Urgent', basePriority: 5,
      dueDate: DAY, deadlineHard: true, estimatedMinutes: 60,
    });
    const victim = makeTask({ id: 'meh', title: 'Meh', basePriority: 1, estimatedMinutes: 60 });
    const victimBlock = makeBlock({
      id: 'vb', title: 'Meh', taskId: 'meh',
      start: at(DAY, 10), end: at(DAY, 11),
    });

    const r = buildRescheduleOptions(
      { ...optBase, task: mover, tasks: [mover, victim], blocks: [victimBlock] }, CONFIG,
    );
    const d = r.options.find((o) => o.strategy === 'displace')!;
    expect(d.unavailableReason).toBeUndefined();
    expect(d.displaces[0]!.blockId).toBe('vb');
    expect(d.explanation).toContain('Meh');
  });

  it('never displaces a locked or protected block', () => {
    resetIds();
    const mover = makeTask({
      id: 'urgent', basePriority: 5, dueDate: DAY, deadlineHard: true, estimatedMinutes: 60,
    });
    const victim = makeTask({ id: 'meh', basePriority: 1 });
    const locked = makeBlock({ id: 'lb', taskId: 'meh', locked: true, start: at(DAY, 10), end: at(DAY, 11) });
    const prot = makeBlock({ id: 'pb', taskId: 'meh', protected: true, start: at(DAY, 12), end: at(DAY, 13) });

    const r = buildRescheduleOptions(
      { ...optBase, task: mover, tasks: [mover, victim], blocks: [locked, prot] }, CONFIG,
    );
    const d = r.options.find((o) => o.strategy === 'displace')!;
    expect(d.unavailableReason).toBeDefined();
  });

  it('refuses to displace a similarly-prioritised task', () => {
    resetIds();
    const mover = makeTask({ id: 'a', basePriority: 3, estimatedMinutes: 60 });
    const peer = makeTask({ id: 'b', basePriority: 3 });
    const peerBlock = makeBlock({ id: 'pb', taskId: 'b', start: at(DAY, 10), end: at(DAY, 11) });

    const r = buildRescheduleOptions(
      { ...optBase, task: mover, tasks: [mover, peer], blocks: [peerBlock] }, CONFIG,
    );
    const d = r.options.find((o) => o.strategy === 'displace')!;
    expect(d.unavailableReason).toContain('below this one');
  });

  it('recommends a deadline-meeting option over one that misses', () => {
    resetIds();
    const task = makeTask({ id: 'T', estimatedMinutes: 60, dueDate: DAY, deadlineHard: true });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.meetsDeadline).toBe(true);
    expect(r.recommended!.proposedBlocks[0]!.date).toBe(DAY);
  });

  it('returns only cancel when nothing is left to do', () => {
    resetIds();
    const task = makeTask({ estimatedMinutes: 60, actualMinutes: 60 });
    const r = buildRescheduleOptions({ ...optBase, task, tasks: [task] }, CONFIG);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.strategy).toBe('cancel');
    expect(r.recommended).toBeNull();
  });
});

describe('autoReschedule', () => {
  it('places several tasks without them colliding with each other', () => {
    resetIds();
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 120, basePriority: 5 }),
      makeTask({ id: 'b', estimatedMinutes: 120, basePriority: 4 }),
      makeTask({ id: 'c', estimatedMinutes: 120, basePriority: 3 }),
    ];
    const r = autoReschedule(
      { ...base, tasks, allTasks: tasks, now: nowAt(DAY, 8) }, CONFIG,
    );
    expect(r.decisions).toHaveLength(3);

    const all = r.decisions.flatMap((d) => d.proposedBlocks);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]!.start < all[j]!.end && all[j]!.start < all[i]!.end).toBe(false);
      }
    }
  });

  it('refuses to move a task that has already slipped too many times', () => {
    resetIds();
    const stubborn = makeTask({ id: 'x', title: 'Stubborn', rescheduleCount: 3 });
    const r = autoReschedule(
      { ...base, tasks: [stubborn], allTasks: [stubborn], now: nowAt(DAY, 8) }, CONFIG,
    );
    expect(r.decisions).toHaveLength(0);
    expect(r.needsUserInput[0]!.reason).toContain('keeps slipping');
  });

  it('never schedules over a protected block', () => {
    resetIds();
    const school = makeBlock({ protected: true, start: at(DAY, 9), end: at(DAY, 15) });
    const task = makeTask({ id: 't', estimatedMinutes: 60 });
    const r = autoReschedule(
      { ...base, tasks: [task], allTasks: [task], blocks: [school], now: nowAt(DAY, 8) },
      CONFIG,
    );
    const b = r.decisions[0]!.proposedBlocks[0]!;
    expect(b.start >= school.end || b.end <= school.start).toBe(true);
  });

  it('produces a human-readable explanation line per decision', () => {
    resetIds();
    const task = makeTask({ id: 't', title: 'Physics', estimatedMinutes: 60 });
    const r = autoReschedule(
      { ...base, tasks: [task], allTasks: [task], now: nowAt(DAY, 8) }, CONFIG,
    );
    expect(r.explanation[0]).toContain('Physics');
    expect(r.explanation[0]!.length).toBeGreaterThan(30);
  });
});

describe('detectOverload', () => {
  const loadBase = { preferences: PREFS, now: nowAt(DAY, 8), from: DAY, to: DAY };

  it('reports ok when demand fits comfortably', () => {
    resetIds();
    const blocks = [makeBlock({ taskId: 't1', start: at(DAY, 9), end: at(DAY, 11) })];
    const r = detectOverload({ ...loadBase, tasks: [], blocks }, CONFIG);
    expect(r.days[0]!.severity).toBe('ok');
    expect(r.overloadedDays).toHaveLength(0);
    expect(r.summary).toContain('Workload fits');
  });

  it('flags a day where due work exceeds available capacity', () => {
    resetIds();
    // 9-18 working, but 9-16 is protected: only 2 h capacity for 5 h of work.
    const school = makeBlock({ protected: true, start: at(DAY, 9), end: at(DAY, 16) });
    const tasks = [
      makeTask({ id: 'a', dueDate: DAY, estimatedMinutes: 180 }),
      makeTask({ id: 'b', dueDate: DAY, estimatedMinutes: 120 }),
    ];
    const r = detectOverload({ ...loadBase, tasks, blocks: [school] }, CONFIG);
    const day = r.days[0]!;

    expect(day.capacityMinutes).toBe(120);
    expect(day.demandMinutes).toBe(300);
    expect(day.overflowMinutes).toBe(180);
    expect(['overloaded', 'impossible']).toContain(day.severity);
    expect(day.message).toContain('300 min');
    expect(day.recommendations.length).toBeGreaterThan(0);
    expect(r.overloadedDays).toHaveLength(1);
  });

  it('calls a fully-protected day impossible', () => {
    resetIds();
    const allDay = makeBlock({ protected: true, start: at(DAY, 9), end: at(DAY, 18) });
    const tasks = [makeTask({ id: 'a', dueDate: DAY, estimatedMinutes: 60 })];
    const r = detectOverload({ ...loadBase, tasks, blocks: [allDay] }, CONFIG);
    expect(r.days[0]!.severity).toBe('impossible');
    expect(r.days[0]!.message).toContain('no free time at all');
  });

  it('marks a nearly-full day as tight rather than overloaded', () => {
    resetIds();
    const busy = makeBlock({ protected: true, start: at(DAY, 9), end: at(DAY, 15) });
    const tasks = [makeTask({ id: 'a', dueDate: DAY, estimatedMinutes: 170 })]; // 170 of 180
    const r = detectOverload({ ...loadBase, tasks, blocks: [busy] }, CONFIG);
    expect(r.days[0]!.severity).toBe('tight');
    expect(r.days[0]!.message).toContain('no slack');
  });

  it('counts already-scheduled flexible blocks as demand, not lost capacity', () => {
    resetIds();
    const scheduled = makeBlock({ taskId: 'x', start: at(DAY, 9), end: at(DAY, 12) });
    const r = detectOverload({ ...loadBase, tasks: [], blocks: [scheduled] }, CONFIG);
    const day = r.days[0]!;
    expect(day.demandMinutes).toBe(180);
    expect(day.capacityMinutes).toBe(480); // capped by maxDailyLoadMinutes
    expect(day.severity).toBe('ok');
  });

  it('does not double-count a task that already has a block', () => {
    resetIds();
    const task = makeTask({ id: 'dup', dueDate: DAY, estimatedMinutes: 120 });
    const block = makeBlock({ taskId: 'dup', start: at(DAY, 9), end: at(DAY, 11) });
    const r = detectOverload({ ...loadBase, tasks: [task], blocks: [block] }, CONFIG);
    expect(r.days[0]!.demandMinutes).toBe(120);
    expect(r.days[0]!.taskIds).toEqual(['dup']);
  });

  it('walks a multi-day range', () => {
    resetIds();
    const r = detectOverload(
      { ...loadBase, to: DAY2, tasks: [], blocks: [], workingHours: ALL_DAY_HOURS } as never,
      CONFIG,
    );
    expect(r.days).toHaveLength(2);
    expect(r.days.map((d) => d.date)).toEqual([DAY, DAY2]);
  });
});
