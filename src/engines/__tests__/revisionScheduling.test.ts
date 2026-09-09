import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as CONFIG } from '@/config/schedulingConfig';
import {
  applyReviewOutcome, bucketRevisions, buildEntriesForPlan,
  generateRevisionSchedule, nextDueDate, recomputeMissedRevisions,
} from '@/engines/revisionScheduling';
import { DAY, makeRevisionEntry, makeRevisionPlan, nowAt, resetIds } from './fixtures';

describe('generateRevisionSchedule', () => {
  it('generates the default ladder as cumulative offsets from the start date', () => {
    const r = generateRevisionSchedule({ startDate: '2026-03-02' }, CONFIG);
    expect(r).toHaveLength(CONFIG.revision.intervals.length);
    expect(r.map((x) => x.intervalDays)).toEqual([1, 3, 7, 14, 30, 60, 120]);
    expect(r.map((x) => x.offsetDays)).toEqual([1, 4, 11, 25, 55, 115, 235]);
    expect(r[0]!.dueDate).toBe('2026-03-03');
    expect(r[1]!.dueDate).toBe('2026-03-06');
    expect(r[2]!.dueDate).toBe('2026-03-13');
  });

  it('uses custom intervals in preference to the config ladder', () => {
    const r = generateRevisionSchedule(
      { startDate: '2026-03-02', customIntervals: [2, 5, 10] }, CONFIG,
    );
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.intervalDays)).toEqual([2, 5, 10]);
    expect(r.map((x) => x.dueDate)).toEqual(['2026-03-04', '2026-03-09', '2026-03-19']);
    expect(r[0]!.reason).toContain('custom');
  });

  it('normalises a messy custom ladder (dupes, out of order, non-integer)', () => {
    const r = generateRevisionSchedule(
      { startDate: '2026-03-02', customIntervals: [7, 1, 3, 3, 1.4] }, CONFIG,
    );
    expect(r.map((x) => x.intervalDays)).toEqual([1, 3, 7]);
  });

  it('honours explicit manual dates and derives their gaps', () => {
    const r = generateRevisionSchedule(
      { startDate: '2026-03-02', manualDates: ['2026-03-20', '2026-03-05'] }, CONFIG,
    );
    expect(r.map((x) => x.dueDate)).toEqual(['2026-03-05', '2026-03-20']);
    expect(r[0]!.intervalDays).toBe(3);
    expect(r[1]!.intervalDays).toBe(15);
    expect(r[0]!.reason).toContain('Manually chosen');
  });

  it('caps the number of repetitions', () => {
    const r = generateRevisionSchedule({ startDate: DAY, maxRepetitions: 3 }, CONFIG);
    expect(r).toHaveLength(3);
  });

  it('stretches every interval by the ease factor', () => {
    const tight = generateRevisionSchedule({ startDate: DAY, easeFactor: 1 }, CONFIG);
    const loose = generateRevisionSchedule({ startDate: DAY, easeFactor: 2 }, CONFIG);
    expect(loose[0]!.intervalDays).toBe(tight[0]!.intervalDays * 2);
    expect(loose[3]!.offsetDays).toBeGreaterThan(tight[3]!.offsetDays);
    expect(loose[0]!.reason).toContain('ease');
  });

  it('never emits a zero or negative interval', () => {
    const r = generateRevisionSchedule(
      { startDate: DAY, customIntervals: [1, 2], easeFactor: 0.25 }, CONFIG,
    );
    for (const x of r) expect(x.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('carries the plan duration onto every generated entry', () => {
    const r = generateRevisionSchedule({ startDate: DAY, durationMinutes: 40 }, CONFIG);
    expect(r.every((x) => x.durationMinutes === 40)).toBe(true);
  });
});

describe('buildEntriesForPlan', () => {
  it('emits scheduled drafts from the plan current index onward', () => {
    resetIds();
    const plan = makeRevisionPlan({ intervals: [1, 3, 7, 14, 30], currentIndex: 2 });
    const drafts = buildEntriesForPlan(plan, CONFIG);

    expect(drafts.map((d) => d.repetition)).toEqual([2, 3, 4]);
    expect(drafts.every((d) => d.status === 'scheduled')).toBe(true);
    expect(drafts.every((d) => d.planId === plan.id)).toBe(true);
    expect(drafts.every((d) => d.durationMinutes === plan.defaultDurationMinutes)).toBe(true);
  });

  it('accepts manual dates as an override', () => {
    resetIds();
    const plan = makeRevisionPlan({ currentIndex: 0 });
    const drafts = buildEntriesForPlan(plan, CONFIG, { manualDates: ['2026-04-01', '2026-05-01'] });
    expect(drafts.map((d) => d.dueDate)).toEqual(['2026-04-01', '2026-05-01']);
  });
});

describe('applyReviewOutcome', () => {
  it('advances the ladder and raises ease on a perfect recall', () => {
    resetIds();
    const plan = makeRevisionPlan({ intervals: [1, 3, 7, 14, 30], currentIndex: 1, ease: 2.5 });
    const entry = makeRevisionEntry({ repetition: 1 });
    const r = applyReviewOutcome({ plan, entry, quality: 5, reviewedOn: '2026-03-10' }, CONFIG);

    expect(r.lapsed).toBe(false);
    expect(r.nextIndex).toBe(2);
    expect(r.nextEase).toBeGreaterThan(2.5);
    expect(r.nextIntervalDays).toBeGreaterThanOrEqual(7);
    expect(r.nextDueDate > '2026-03-10').toBe(true);
    expect(r.explanation).toContain('repetition 3');
  });

  it('rewinds the ladder, shrinks the interval and drops ease on a lapse', () => {
    resetIds();
    const plan = makeRevisionPlan({ intervals: [1, 3, 7, 14, 30], currentIndex: 3, ease: 2.5 });
    const entry = makeRevisionEntry({ repetition: 3 });
    const r = applyReviewOutcome({ plan, entry, quality: 1, reviewedOn: '2026-03-10' }, CONFIG);

    expect(r.lapsed).toBe(true);
    expect(r.nextIndex).toBe(2);                  // stepped back
    expect(r.nextEase).toBeLessThan(2.5);
    expect(r.nextIntervalDays).toBe(Math.round(7 * CONFIG.revision.lapsePenalty)); // 4
    expect(r.nextDueDate).toBe('2026-03-14');
    expect(r.explanation).toContain('steps back');
  });

  it('clamps ease to the configured bounds after repeated failures', () => {
    resetIds();
    let ease = CONFIG.revision.initialEase;
    for (let i = 0; i < 20; i++) {
      const plan = makeRevisionPlan({ ease });
      const r = applyReviewOutcome(
        { plan, entry: makeRevisionEntry({ repetition: 0 }), quality: 0, reviewedOn: DAY },
        CONFIG,
      );
      ease = r.nextEase;
    }
    expect(ease).toBe(CONFIG.revision.minEase);
  });

  it('clamps ease upward too', () => {
    resetIds();
    let ease = CONFIG.revision.initialEase;
    for (let i = 0; i < 20; i++) {
      const plan = makeRevisionPlan({ ease });
      ease = applyReviewOutcome(
        { plan, entry: makeRevisionEntry({ repetition: 0 }), quality: 5, reviewedOn: DAY },
        CONFIG,
      ).nextEase;
    }
    expect(ease).toBe(CONFIG.revision.maxEase);
  });

  it('does not run off the end of the ladder', () => {
    resetIds();
    const plan = makeRevisionPlan({ intervals: [1, 3, 7] });
    const r = applyReviewOutcome(
      { plan, entry: makeRevisionEntry({ repetition: 2 }), quality: 5, reviewedOn: DAY }, CONFIG,
    );
    expect(r.nextIndex).toBe(2);
  });

  it('treats quality exactly at the threshold as a pass', () => {
    resetIds();
    const plan = makeRevisionPlan();
    const r = applyReviewOutcome(
      {
        plan, entry: makeRevisionEntry({ repetition: 0 }),
        quality: CONFIG.revision.lapseQualityThreshold, reviewedOn: DAY,
      },
      CONFIG,
    );
    expect(r.lapsed).toBe(false);
  });
});

describe('bucketRevisions', () => {
  it('sorts entries into dashboard buckets relative to today', () => {
    resetIds();
    const entries = [
      makeRevisionEntry({ id: 'e1', dueDate: '2026-03-02' }), // today
      makeRevisionEntry({ id: 'e2', dueDate: '2026-03-03' }), // tomorrow
      makeRevisionEntry({ id: 'e3', dueDate: '2026-03-10' }), // upcoming
      makeRevisionEntry({ id: 'e4', dueDate: '2026-03-01' }), // 1 day late
      makeRevisionEntry({ id: 'e5', dueDate: '2026-02-20' }), // long gone
      makeRevisionEntry({ id: 'e6', dueDate: '2026-03-01', status: 'completed' }),
    ];
    const r = bucketRevisions({ entries, today: DAY }, CONFIG);
    const by = Object.fromEntries(r.map((x) => [x.entryId, x.bucket]));

    expect(by.e1).toBe('due_today');
    expect(by.e2).toBe('tomorrow');
    expect(by.e3).toBe('upcoming');
    expect(by.e4).toBe('overdue');  // within the 1-day grace period
    expect(by.e5).toBe('missed');   // beyond it
    expect(by.e6).toBe('done');

    expect(r.find((x) => x.entryId === 'e5')!.daysLate).toBe(10);
    expect(r.find((x) => x.entryId === 'e2')!.label).toBe('Due tomorrow');
  });
});

describe('recomputeMissedRevisions', () => {
  const now = nowAt(DAY, 8);

  it('does nothing when nothing is overdue', () => {
    resetIds();
    const r = recomputeMissedRevisions(
      {
        plan: makeRevisionPlan(),
        entries: [makeRevisionEntry({ dueDate: '2026-03-05' })],
        today: DAY, now,
      },
      CONFIG,
    );
    expect(r.updates).toHaveLength(0);
    expect(r.missedEntryIds).toHaveLength(0);
    expect(r.explanation).toContain('on track');
  });

  it('pulls the oldest overdue revision to today and re-spaces the rest behind it', () => {
    resetIds();
    const plan = makeRevisionPlan({ ease: 2.5 });
    const entries = [
      makeRevisionEntry({ id: 'r0', repetition: 0, dueDate: '2026-02-20', intervalDays: 1 }),
      makeRevisionEntry({ id: 'r1', repetition: 1, dueDate: '2026-02-23', intervalDays: 3 }),
      makeRevisionEntry({ id: 'r2', repetition: 2, dueDate: '2026-03-01', intervalDays: 7 }),
      makeRevisionEntry({ id: 'r3', repetition: 3, dueDate: '2026-03-20', intervalDays: 14 }),
    ];
    const r = recomputeMissedRevisions({ plan, entries, today: DAY, now }, CONFIG);
    const by = Object.fromEntries(r.updates.map((u) => [u.entryId, u]));

    // Oldest comes back today.
    expect(by.r0!.toDueDate).toBe(DAY);
    expect(by.r0!.fromDueDate).toBe('2026-02-20');
    expect(by.r0!.daysLate).toBe(10);

    // Overdue followers are re-spaced with the lapse penalty (3 -> 2, 7 -> 4).
    expect(by.r1!.toDueDate).toBe('2026-03-04');
    expect(by.r2!.toDueDate).toBe('2026-03-08');
    // The future one keeps its full interval, anchored behind r2.
    expect(by.r3!.toDueDate).toBe('2026-03-22');

    // Dates stay strictly increasing — no ladder collisions.
    const dates = [DAY, by.r1!.toDueDate, by.r2!.toDueDate, by.r3!.toDueDate];
    for (let i = 1; i < dates.length; i++) expect(dates[i]! > dates[i - 1]!).toBe(true);

    for (const u of r.updates) expect(u.reason.length).toBeGreaterThan(20);
  });

  it('flags entries past the grace period as missed and docks ease', () => {
    resetIds();
    const plan = makeRevisionPlan({ ease: 2.5 });
    const entries = [
      makeRevisionEntry({ id: 'a', repetition: 0, dueDate: '2026-02-20' }), // 10 late
      makeRevisionEntry({ id: 'b', repetition: 1, dueDate: '2026-02-25' }), // 5 late
      makeRevisionEntry({ id: 'c', repetition: 2, dueDate: '2026-03-01' }), // 1 late (grace)
    ];
    const r = recomputeMissedRevisions({ plan, entries, today: DAY, now }, CONFIG);

    expect(r.missedEntryIds).toEqual(['a', 'b']);
    expect(r.adjustedEase).toBe(2.2); // 2.5 - 2 * 0.15
    expect(r.explanation).toContain('ease drops from 2.5 to 2.2');
  });

  it('never drops ease below the configured minimum', () => {
    resetIds();
    const plan = makeRevisionPlan({ ease: 1.4 });
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeRevisionEntry({ id: `m${i}`, repetition: i, dueDate: '2026-01-10' }));
    const r = recomputeMissedRevisions({ plan, entries, today: DAY, now }, CONFIG);
    expect(r.adjustedEase).toBe(CONFIG.revision.minEase);
  });

  it('ignores completed entries when re-anchoring', () => {
    resetIds();
    const plan = makeRevisionPlan();
    const entries = [
      makeRevisionEntry({ id: 'done', repetition: 0, dueDate: '2026-02-01', status: 'completed' }),
      makeRevisionEntry({ id: 'late', repetition: 1, dueDate: '2026-02-25' }),
    ];
    const r = recomputeMissedRevisions({ plan, entries, today: DAY, now }, CONFIG);
    expect(r.updates.map((u) => u.entryId)).toEqual(['late']);
    expect(r.updates[0]!.toDueDate).toBe(DAY);
  });
});

describe('nextDueDate', () => {
  it('scales the base interval by the plan ease', () => {
    resetIds();
    const slow = makeRevisionPlan({ intervals: [1, 3, 7], currentIndex: 2, ease: 1.25 });
    const fast = makeRevisionPlan({ intervals: [1, 3, 7], currentIndex: 2, ease: 2.5 });

    const a = nextDueDate(slow, DAY, CONFIG);
    const b = nextDueDate(fast, DAY, CONFIG);
    expect(a.intervalDays).toBe(4);  // 7 * (1.25 / 2.5) = 3.5 -> 4
    expect(b.intervalDays).toBe(7);
    expect(b.dueDate).toBe('2026-03-09');
    expect(a.reason).toContain('ease');
  });

  it('clamps an out-of-range current index', () => {
    resetIds();
    const plan = makeRevisionPlan({ intervals: [1, 3], currentIndex: 99 });
    expect(nextDueDate(plan, DAY, CONFIG).intervalDays).toBe(3);
  });
});
