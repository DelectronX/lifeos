/**
 * Pure interval arithmetic on absolute timestamps.
 *
 * Used by every scheduling engine so that "what time is actually free" is
 * computed in exactly one place. No clock reads, no DB, no side effects.
 */

import type { Timestamp } from '@/types';

export interface Interval {
  start: Timestamp;
  end: Timestamp;
}

export function durationMs(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Sorts ascending by start then end. Returns a new array. */
export function sortIntervals<T extends Interval>(intervals: readonly T[]): T[] {
  return [...intervals].sort((x, y) => x.start - y.start || x.end - y.end);
}

/** Merges overlapping/adjacent intervals into a minimal disjoint set. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = sortIntervals(intervals).filter((i) => i.end > i.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** Removes every `busy` interval from every `base` interval. */
export function subtractIntervals(
  base: readonly Interval[],
  busy: readonly Interval[],
): Interval[] {
  const blockers = mergeIntervals(busy);
  const out: Interval[] = [];

  for (const range of sortIntervals(base)) {
    let cursor = range.start;
    for (const b of blockers) {
      if (b.end <= cursor) continue;
      if (b.start >= range.end) break;
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, range.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= range.end) break;
    }
    if (cursor < range.end) out.push({ start: cursor, end: range.end });
  }

  return out.filter((i) => i.end > i.start);
}

/** Intersection of two interval sets. */
export function intersectIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const out: Interval[] = [];
  for (const x of mergeIntervals(a)) {
    for (const y of mergeIntervals(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return sortIntervals(out);
}

/** Total covered milliseconds of a (possibly overlapping) interval set. */
export function totalMs(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + durationMs(i), 0);
}
