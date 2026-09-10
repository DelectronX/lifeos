import { describe, expect, it } from 'vitest';
import { resolvePreset } from '../range';

/**
 * The range selector is the only piece of computation the analytics UI owns:
 * turning a preset into the [from, to] window the pure engine expects. It is
 * tested here so the sections can trust the window they are handed.
 */
describe('resolvePreset', () => {
  // 2026-09-10 is a Thursday.
  const today = '2026-09-10';

  it('starts "this week" on Monday when weeks start on Monday', () => {
    expect(resolvePreset('week', today, 1)).toEqual({ from: '2026-09-07', to: today });
  });

  it('starts "this week" on Sunday when weeks start on Sunday', () => {
    expect(resolvePreset('week', today, 0)).toEqual({ from: '2026-09-06', to: today });
  });

  it('returns the full previous week, not a partial one', () => {
    expect(resolvePreset('lastWeek', today, 1)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });

  it('runs "this month" from the first of the month to today', () => {
    expect(resolvePreset('month', today, 1)).toEqual({ from: '2026-09-01', to: today });
  });

  it('makes "last 30 days" an inclusive 30-day window', () => {
    expect(resolvePreset('30d', today, 1)).toEqual({ from: '2026-08-12', to: today });
  });

  it('keeps last week adjacent to this week with no gap or overlap', () => {
    const thisWeek = resolvePreset('week', today, 1);
    const lastWeek = resolvePreset('lastWeek', today, 1);
    expect(lastWeek.to < thisWeek.from).toBe(true);
    const dayAfterLastWeek = new Date(`${lastWeek.to}T00:00:00Z`);
    dayAfterLastWeek.setUTCDate(dayAfterLastWeek.getUTCDate() + 1);
    expect(dayAfterLastWeek.toISOString().slice(0, 10)).toBe(thisWeek.from);
  });

  it('handles a month boundary for the 30-day window across a year change', () => {
    expect(resolvePreset('30d', '2027-01-05', 1)).toEqual({ from: '2026-12-07', to: '2027-01-05' });
  });
});
