import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as BASE } from '@/config/schedulingConfig';
import { planSchedule } from '@/engines/scheduling';
import { minuteOfDay } from '@/lib/date';
import type { SchedulingConfig } from '@/types';
import type { SubjectWindowRule } from '@/types/scheduling';
import {
  ALL_DAY_HOURS, DAY, TRACKER_STUDY, TRACKER_FITNESS, at, makeTask, nowAt, resetIds,
} from './fixtures';

// No lead time in tests, so "now" is exactly the earliest schedulable instant.
const CONFIG: SchedulingConfig = {
  ...BASE,
  slots: { ...BASE.slots, leadTimeMinutes: 0, horizonDays: 10 },
};

const planBase = {
  preferences: { workingHours: ALL_DAY_HOURS, focusHours: [] },
  now: nowAt(DAY, 6),
  from: DAY,
  blocks: [] as never[],
};

// DAY ('2026-03-02') is a Monday, so days 1..5 = Mon..Fri.
const MATHS_RULE: SubjectWindowRule = {
  trackerId: TRACKER_STUDY,
  days: [1, 2, 3, 4, 5],
  startMinute: 16 * 60, // 4 PM
  endMinute: 18 * 60, // 6 PM
};

describe('planSchedule — HARD subject/day/time-window constraint', () => {
  it('never places a task outside its subject\'s allowed window, even across many days', () => {
    resetIds();
    // Deliberately ask for far more time than the 2h/day * 5 weekdays window
    // can hold within the horizon, so the greedy placer is forced to try
    // every free slot in the day (9am-6pm) — proving it rejects all of them
    // except the 4-6pm sliver rather than merely preferring it.
    const task = makeTask({
      trackerId: TRACKER_STUDY,
      estimatedMinutes: 600,
      splittable: true,
      minSessionMinutes: 30,
      maxSessionMinutes: 60,
    });

    const r = planSchedule(
      { ...planBase, tasks: [task], subjectWindowRules: [MATHS_RULE] },
      CONFIG,
    );

    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) {
      const day = new Date(at(p.date, 0)).getDay();
      expect(MATHS_RULE.days).toContain(day);
      expect(minuteOfDay(p.start)).toBeGreaterThanOrEqual(MATHS_RULE.startMinute);
      expect(minuteOfDay(p.end - 1)).toBeLessThan(MATHS_RULE.endMinute);
    }
  });

  it('skips a disallowed day (Saturday) entirely for a constrained subject', () => {
    resetIds();
    // DAY2/DAY3 in fixtures are Tue/Wed; walk forward to the following
    // Saturday (day 6) using the same date arithmetic the engine uses.
    const task = makeTask({ trackerId: TRACKER_STUDY, estimatedMinutes: 60 });
    const r = planSchedule(
      {
        ...planBase,
        from: '2026-03-07', // a Saturday
        to: '2026-03-07',
        tasks: [task],
        subjectWindowRules: [MATHS_RULE],
      },
      CONFIG,
    );
    // Saturday is not in MATHS_RULE.days, so nothing can be placed that day.
    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0]!.code).toBe('outside_allowed_window');
  });

  it('reports outside_allowed_window (not a generic no-slot code) when rejected', () => {
    resetIds();
    // A window too short to ever fit the minimum session.
    const tightRule: SubjectWindowRule = {
      trackerId: TRACKER_STUDY, days: [1], startMinute: 16 * 60, endMinute: 16 * 60 + 5,
    };
    const task = makeTask({ trackerId: TRACKER_STUDY, estimatedMinutes: 60, minSessionMinutes: 30 });
    const r = planSchedule(
      { ...planBase, from: DAY, to: DAY, tasks: [task], subjectWindowRules: [tightRule] },
      CONFIG,
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.unplaced[0]!.code).toBe('outside_allowed_window');
  });

  it('an UNCONSTRAINED subject is unaffected by another subject\'s rule', () => {
    resetIds();
    const fitnessTask = makeTask({ trackerId: TRACKER_FITNESS, estimatedMinutes: 60 });
    const r = planSchedule(
      { ...planBase, from: DAY, to: DAY, tasks: [fitnessTask], subjectWindowRules: [MATHS_RULE] },
      CONFIG,
    );
    expect(r.proposals).toHaveLength(1);
    // Placed at the earliest free slot (9am), NOT forced into Maths's window.
    expect(minuteOfDay(r.proposals[0]!.start)).toBe(9 * 60);
  });

  it('union of multiple rules for the same subject: either window is valid', () => {
    resetIds();
    const eveningRule: SubjectWindowRule = {
      trackerId: TRACKER_STUDY, days: [1], startMinute: 20 * 60, endMinute: 21 * 60,
    };
    const task = makeTask({
      trackerId: TRACKER_STUDY, estimatedMinutes: 150, splittable: true,
      minSessionMinutes: 30, maxSessionMinutes: 60,
    });
    const r = planSchedule(
      { ...planBase, from: DAY, to: DAY, tasks: [task], subjectWindowRules: [MATHS_RULE, eveningRule] },
      CONFIG,
    );
    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) {
      const m = minuteOfDay(p.start);
      const inMaths = m >= MATHS_RULE.startMinute && minuteOfDay(p.end - 1) < MATHS_RULE.endMinute;
      const inEvening = m >= eveningRule.startMinute && minuteOfDay(p.end - 1) < eveningRule.endMinute;
      expect(inMaths || inEvening).toBe(true);
    }
  });

  it('still respects protected blocks WITHIN the allowed window (hard constraints compose)', () => {
    resetIds();
    const protectedBlock = {
      id: 'lunch', createdAt: 0, updatedAt: 0, title: 'Break', date: DAY,
      start: at(DAY, 16, 30), end: at(DAY, 17), trackerId: TRACKER_FITNESS, kind: 'break' as const,
      taskId: null, goalId: null, resourceId: null, status: 'planned' as const, locked: false,
      protected: true, origin: 'manual' as const, planRunId: null, splitGroupId: null,
      splitIndex: 0, splitCount: 1, actualStart: null, actualEnd: null,
    };
    const task = makeTask({ trackerId: TRACKER_STUDY, estimatedMinutes: 60 });
    const r = planSchedule(
      {
        ...planBase, from: DAY, to: DAY, tasks: [task], blocks: [protectedBlock],
        subjectWindowRules: [MATHS_RULE],
      },
      CONFIG,
    );
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0]!;
    // Must be inside 4-6pm AND must not overlap 16:30-17:00.
    expect(minuteOfDay(p.start)).toBeGreaterThanOrEqual(16 * 60);
    expect(minuteOfDay(p.end - 1)).toBeLessThan(18 * 60);
    expect(p.start < at(DAY, 17) && at(DAY, 16, 30) < p.end).toBe(false);
  });
});
