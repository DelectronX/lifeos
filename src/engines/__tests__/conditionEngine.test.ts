import { describe, expect, it } from 'vitest';
import {
  addChild, cloneCondition, compare, computeProgress, countLeaves,
  describeNextAvailability, describeWindow, evaluateCondition, isEarnableNow,
  isLeaf, isLeafTrace, isValidCondition, leafProgress, periodKeyFor, readMetric,
  removeNode, replaceNode, resolveWindow,
  type Condition, type GroupCondition, type LeafCondition, type MetricSource,
  EMPTY_METRIC_SOURCE, COMPARISON_OPERATORS,
} from '../conditionEngine';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Wednesday 2026-03-11, 10:00 local. ISO week 2026-W11, week starts Mon 09. */
const NOW = new Date(2026, 2, 11, 10, 0, 0);

let idCounter = 0;
const nextId = () => `n${++idCounter}`;

function leaf(
  metric: string,
  operator: LeafCondition['operator'],
  value: number,
  window: LeafCondition['window'] = { kind: 'all_time' },
): LeafCondition {
  return { id: nextId(), type: 'leaf', metric, operator, value, window };
}

function group(type: GroupCondition['type'], ...children: Condition[]): GroupCondition {
  return { id: nextId(), type, children };
}

/**
 * Study minutes across the month: 100 on the 1st (this month, not this week),
 * 60 on Mon the 9th and 40 on Wed the 11th (both this week and today for the
 * 11th). Tasks are counted on two days only.
 */
const SOURCE: MetricSource = {
  totals: {
    studyMinutes: 1000,
    tasksCompleted: 42,
    level: 7,
    longestSessionMinutes: 95,
  },
  daily: [
    { date: '2026-02-20', values: { studyMinutes: 500, tasksCompleted: 10, longestSessionMinutes: 95 } },
    { date: '2026-03-01', values: { studyMinutes: 100, tasksCompleted: 4, longestSessionMinutes: 50 } },
    { date: '2026-03-09', values: { studyMinutes: 60, tasksCompleted: 3, longestSessionMinutes: 30 } },
    { date: '2026-03-11', values: { studyMinutes: 40, tasksCompleted: 1, longestSessionMinutes: 40 } },
  ],
  meta: {
    studyMinutes: { aggregation: 'sum', windowable: true },
    tasksCompleted: { aggregation: 'sum', windowable: true },
    longestSessionMinutes: { aggregation: 'max', windowable: true },
    level: { aggregation: 'snapshot', windowable: false },
  },
  weekStartsOn: 1,
};

/* ------------------------------------------------------------------ */
/* Operators                                                           */
/* ------------------------------------------------------------------ */

describe('compare', () => {
  it('implements every operator', () => {
    expect(compare(5, '>=', 5)).toBe(true);
    expect(compare(4, '>=', 5)).toBe(false);
    expect(compare(6, '>', 5)).toBe(true);
    expect(compare(5, '>', 5)).toBe(false);
    expect(compare(5, '<=', 5)).toBe(true);
    expect(compare(6, '<=', 5)).toBe(false);
    expect(compare(4, '<', 5)).toBe(true);
    expect(compare(5, '<', 5)).toBe(false);
    expect(compare(5, '==', 5)).toBe(true);
    expect(compare(5, '==', 4)).toBe(false);
    expect(compare(5, '!=', 4)).toBe(true);
    expect(compare(5, '!=', 5)).toBe(false);
  });

  it('exposes exactly the six supported operators', () => {
    expect([...COMPARISON_OPERATORS].sort()).toEqual(['!=', '<', '<=', '==', '>', '>='].sort());
  });
});

describe('leafProgress', () => {
  it('is 1 whenever the comparison already holds', () => {
    for (const op of COMPARISON_OPERATORS) {
      const actual = op === '<' || op === '<=' ? 1 : 10;
      const target = op === '!=' ? 99 : op === '<' || op === '<=' ? 5 : 5;
      if (compare(actual, op, target)) expect(leafProgress(actual, op, target)).toBe(1);
    }
  });

  it('measures the ratio toward an ascending target', () => {
    expect(leafProgress(120, '>=', 300)).toBeCloseTo(0.4);
    expect(leafProgress(0, '>', 10)).toBe(0);
  });

  it('never divides by zero on a zero or negative target', () => {
    expect(leafProgress(0, '>', 0)).toBe(0);
    expect(leafProgress(5, '>=', -3)).toBe(1);
    expect(Number.isFinite(leafProgress(1, '>=', 0))).toBe(true);
  });

  it('measures descent toward a "at most" target without dividing by zero', () => {
    expect(leafProgress(10, '<=', 5)).toBeCloseTo(0.5);
    expect(leafProgress(0, '<', 0)).toBe(0);
    expect(leafProgress(4, '<=', -1)).toBe(0);
  });

  it('gives no partial credit for equality operators', () => {
    expect(leafProgress(4, '==', 5)).toBe(0);
    expect(leafProgress(5, '!=', 5)).toBe(0);
  });

  it('clamps above 1 and rejects non-finite input', () => {
    expect(leafProgress(600, '>=', 300)).toBe(1);
    expect(leafProgress(Number.NaN, '>=', 300)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

describe('resolveWindow', () => {
  it('resolves all-time to an open range', () => {
    expect(resolveWindow({ kind: 'all_time' }, NOW)).toEqual({ from: null, to: null, label: 'all time' });
  });

  it('resolves today to a single day', () => {
    expect(resolveWindow({ kind: 'today' }, NOW)).toMatchObject({ from: '2026-03-11', to: '2026-03-11' });
  });

  it('starts the week on Monday by default and Sunday when asked', () => {
    expect(resolveWindow({ kind: 'this_week' }, NOW).from).toBe('2026-03-09');
    expect(resolveWindow({ kind: 'this_week' }, NOW, 0).from).toBe('2026-03-08');
  });

  it('starts the month on the first', () => {
    expect(resolveWindow({ kind: 'this_month' }, NOW).from).toBe('2026-03-01');
  });

  it('includes today in a rolling window, so N=1 means today', () => {
    expect(resolveWindow({ kind: 'rolling_days', days: 1 }, NOW).from).toBe('2026-03-11');
    expect(resolveWindow({ kind: 'rolling_days', days: 7 }, NOW).from).toBe('2026-03-05');
  });

  it('clamps a nonsensical rolling length to at least one day', () => {
    expect(resolveWindow({ kind: 'rolling_days', days: 0 }, NOW).from).toBe('2026-03-11');
    expect(resolveWindow({ kind: 'rolling_days', days: -5 }, NOW).from).toBe('2026-03-11');
  });

  it('describes each window in plain words', () => {
    expect(describeWindow({ kind: 'all_time' })).toBe('all time');
    expect(describeWindow({ kind: 'this_month' })).toBe('this month');
    expect(describeWindow({ kind: 'rolling_days', days: 30 })).toBe('in the last 30 days');
  });
});

describe('readMetric', () => {
  it('reads the all-time total for an all-time window', () => {
    expect(readMetric('studyMinutes', { kind: 'all_time' }, SOURCE, NOW)).toBe(1000);
  });

  it('sums only the day samples inside the window', () => {
    expect(readMetric('studyMinutes', { kind: 'today' }, SOURCE, NOW)).toBe(40);
    expect(readMetric('studyMinutes', { kind: 'this_week' }, SOURCE, NOW)).toBe(100);
    expect(readMetric('studyMinutes', { kind: 'this_month' }, SOURCE, NOW)).toBe(200);
    // A 30-day window reaches back to 2026-02-11, so the February sample counts.
    expect(readMetric('studyMinutes', { kind: 'rolling_days', days: 30 }, SOURCE, NOW)).toBe(700);
    expect(readMetric('studyMinutes', { kind: 'rolling_days', days: 7 }, SOURCE, NOW)).toBe(100);
  });

  it('takes the maximum for max-aggregated metrics', () => {
    expect(readMetric('longestSessionMinutes', { kind: 'this_week' }, SOURCE, NOW)).toBe(40);
    expect(readMetric('longestSessionMinutes', { kind: 'this_month' }, SOURCE, NOW)).toBe(50);
  });

  it('ignores windows for snapshot metrics', () => {
    expect(readMetric('level', { kind: 'today' }, SOURCE, NOW)).toBe(7);
  });

  it('returns 0 for a known metric with no samples in the window', () => {
    expect(readMetric('studyMinutes', { kind: 'rolling_days', days: 1 }, { ...SOURCE, daily: [] }, NOW)).toBe(0);
  });

  it('returns null for an unknown metric key', () => {
    expect(readMetric('nonsenseMetric', { kind: 'all_time' }, SOURCE, NOW)).toBeNull();
  });

  it('treats a non-numeric stored value as zero', () => {
    const dirty: MetricSource = {
      totals: { studyMinutes: Number.NaN },
      daily: [{ date: '2026-03-11', values: { studyMinutes: Number.POSITIVE_INFINITY } }],
    };
    expect(readMetric('studyMinutes', { kind: 'all_time' }, dirty, NOW)).toBe(0);
    expect(readMetric('studyMinutes', { kind: 'today' }, dirty, NOW)).toBe(0);
  });

  it('handles an entirely empty source', () => {
    expect(readMetric('studyMinutes', { kind: 'all_time' }, EMPTY_METRIC_SOURCE, NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Evaluation + trace                                                  */
/* ------------------------------------------------------------------ */

describe('evaluateCondition', () => {
  it('evaluates a single met leaf and traces the real numbers', () => {
    const result = evaluateCondition(leaf('studyMinutes', '>=', 100, { kind: 'this_week' }), SOURCE, NOW, {
      labels: { studyMinutes: 'Study minutes' },
      units: { studyMinutes: 'min' },
    });
    expect(result.met).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.leaves).toHaveLength(1);
    expect(result.leaves[0]).toMatchObject({ metric: 'studyMinutes', actual: 100, target: 100, met: true });
    expect(result.nearestUnmet).toBeNull();
    expect(result.summary).toBe('You meet this right now.');
  });

  it('explains an unmet leaf with metric, actual, operator and target', () => {
    const result = evaluateCondition(leaf('studyMinutes', '>=', 300, { kind: 'this_week' }), SOURCE, NOW, {
      labels: { studyMinutes: 'Study minutes' },
      units: { studyMinutes: 'min' },
    });
    expect(result.met).toBe(false);
    expect(result.progress).toBeCloseTo(100 / 300);
    expect(result.summary).toBe('Study minutes this week is 100 min and needs to be at least 300 min.');
    const [trace] = result.leaves;
    expect(trace).toMatchObject({
      metric: 'studyMinutes', actual: 100, operator: '>=', target: 300, met: false, unknownMetric: false,
    });
  });

  it('requires every child of an AND group', () => {
    const cond = group('and',
      leaf('studyMinutes', '>=', 50, { kind: 'this_week' }),
      leaf('tasksCompleted', '>=', 100));
    const result = evaluateCondition(cond, SOURCE, NOW);
    expect(result.met).toBe(false);
    expect(result.leaves.filter((l) => l.met)).toHaveLength(1);
    // Averaged: 1 for the met leaf, 0.42 for the unmet one.
    expect(result.progress).toBeCloseTo((1 + 42 / 100) / 2);
  });

  it('accepts any child of an OR group and reports the best progress', () => {
    const cond = group('or',
      leaf('studyMinutes', '>=', 10_000),
      leaf('tasksCompleted', '>=', 100));
    const result = evaluateCondition(cond, SOURCE, NOW);
    expect(result.met).toBe(false);
    expect(result.progress).toBeCloseTo(0.42);

    const met = group('or', leaf('studyMinutes', '>=', 10_000), leaf('tasksCompleted', '>=', 40));
    expect(evaluateCondition(met, SOURCE, NOW).met).toBe(true);
  });

  it('negates with NOT', () => {
    expect(evaluateCondition(group('not', leaf('tasksCompleted', '>=', 100)), SOURCE, NOW).met).toBe(true);
    expect(evaluateCondition(group('not', leaf('tasksCompleted', '>=', 10)), SOURCE, NOW).met).toBe(false);
  });

  it('evaluates nested AND / OR / NOT together', () => {
    const cond = group('and',
      leaf('studyMinutes', '>=', 100, { kind: 'this_week' }),
      group('or',
        leaf('level', '>=', 50),
        group('and',
          leaf('tasksCompleted', '>=', 40),
          group('not', leaf('studyMinutes', '>=', 5000)))));
    const result = evaluateCondition(cond, SOURCE, NOW);
    expect(result.met).toBe(true);
    expect(result.leaves).toHaveLength(4);
    expect(countLeaves(cond)).toBe(4);
  });

  it('fails a nested tree when one deep leaf is unmet, and names it', () => {
    const cond = group('and',
      leaf('studyMinutes', '>=', 100, { kind: 'this_week' }),
      group('and', leaf('tasksCompleted', '>=', 50)));
    const result = evaluateCondition(cond, SOURCE, NOW, { labels: { tasksCompleted: 'Tasks completed' } });
    expect(result.met).toBe(false);
    expect(result.nearestUnmet?.metric).toBe('tasksCompleted');
    expect(result.summary).toContain('Tasks completed');
  });

  it('picks the closest unmet leaf as the one standing in the way', () => {
    const cond = group('and',
      leaf('studyMinutes', '>=', 2000),        // 50%
      leaf('tasksCompleted', '>=', 4200));     // 1%
    const result = evaluateCondition(cond, SOURCE, NOW);
    expect(result.nearestUnmet?.metric).toBe('studyMinutes');
  });

  it('treats an empty group as never met rather than vacuously true', () => {
    const result = evaluateCondition(group('and'), SOURCE, NOW);
    expect(result.met).toBe(false);
    expect(result.progress).toBe(0);
    expect(result.summary).toBe('No conditions defined yet.');
  });

  it('surfaces an unknown metric key instead of silently scoring zero', () => {
    const result = evaluateCondition(leaf('nopeMetric', '>=', 1), SOURCE, NOW);
    expect(result.met).toBe(false);
    const [trace] = result.leaves;
    expect(trace.unknownMetric).toBe(true);
    expect(trace.actual).toBeNull();
    expect(trace.explanation).toContain('not a metric');
  });

  it('handles empty data without throwing', () => {
    const result = evaluateCondition(
      group('and', leaf('studyMinutes', '>=', 100, { kind: 'this_week' })),
      EMPTY_METRIC_SOURCE,
      NOW,
    );
    expect(result.met).toBe(false);
    expect(result.leaves[0].unknownMetric).toBe(true);
  });

  it('stops evaluating pathologically deep trees', () => {
    let node: Condition = leaf('tasksCompleted', '>=', 1);
    for (let i = 0; i < 20; i++) node = group('and', node);
    const result = evaluateCondition(node, SOURCE, NOW);
    expect(result.met).toBe(false);
  });

  it('distinguishes leaf traces from group traces', () => {
    const result = evaluateCondition(group('and', leaf('tasksCompleted', '>=', 1)), SOURCE, NOW);
    expect(isLeafTrace(result.trace)).toBe(false);
    expect(result.trace.kind).toBe('and');
    if (!isLeafTrace(result.trace)) expect(isLeafTrace(result.trace.children[0])).toBe(true);
  });
});

describe('computeProgress', () => {
  it('returns 0..1 toward the condition', () => {
    expect(computeProgress(leaf('tasksCompleted', '>=', 84), SOURCE, NOW)).toBeCloseTo(0.5);
    expect(computeProgress(leaf('tasksCompleted', '>=', 1), SOURCE, NOW)).toBe(1);
    expect(computeProgress(group('and'), SOURCE, NOW)).toBe(0);
  });

  it('is zero when the metric cannot be measured at all', () => {
    expect(computeProgress(leaf('unknownThing', '>=', 10), SOURCE, NOW)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Repeat periods                                                      */
/* ------------------------------------------------------------------ */

describe('periodKeyFor', () => {
  it('buckets one-shot rewards into a single period', () => {
    expect(periodKeyFor('once', NOW)).toBe('once');
    expect(periodKeyFor('once', new Date(2030, 0, 1))).toBe('once');
  });

  it('buckets by day, ISO week and month', () => {
    expect(periodKeyFor('daily', NOW)).toBe('2026-03-11');
    expect(periodKeyFor('weekly', NOW)).toBe('2026-W11');
    expect(periodKeyFor('monthly', NOW)).toBe('2026-03');
  });

  it('keeps every day of one Monday-start week in the same weekly bucket', () => {
    const monday = new Date(2026, 2, 9, 8, 0, 0);
    const sunday = new Date(2026, 2, 15, 23, 0, 0);
    expect(periodKeyFor('weekly', monday)).toBe(periodKeyFor('weekly', sunday));
    expect(periodKeyFor('weekly', new Date(2026, 2, 16))).not.toBe(periodKeyFor('weekly', monday));
  });

  it('supports Sunday-start weeks', () => {
    expect(periodKeyFor('weekly', NOW, 0)).toBe('w:2026-03-08');
  });
});

describe('isEarnableNow', () => {
  it('blocks a one-shot reward once it has been earned', () => {
    expect(isEarnableNow('once', [], NOW)).toBe(true);
    expect(isEarnableNow('once', ['once'], NOW)).toBe(false);
  });

  it('lets a daily reward be earned again on the next day', () => {
    const earned = [periodKeyFor('daily', NOW)];
    expect(isEarnableNow('daily', earned, NOW)).toBe(false);
    expect(isEarnableNow('daily', earned, new Date(2026, 2, 12, 9, 0, 0))).toBe(true);
  });

  it('lets a weekly reward be earned again the following week', () => {
    const earned = [periodKeyFor('weekly', NOW)];
    expect(isEarnableNow('weekly', earned, new Date(2026, 2, 13))).toBe(false);
    expect(isEarnableNow('weekly', earned, new Date(2026, 2, 17))).toBe(true);
  });

  it('lets a monthly reward be earned again the following month', () => {
    const earned = [periodKeyFor('monthly', NOW)];
    expect(isEarnableNow('monthly', earned, new Date(2026, 2, 31))).toBe(false);
    expect(isEarnableNow('monthly', earned, new Date(2026, 3, 1))).toBe(true);
  });

  it('describes when the reward comes back', () => {
    expect(describeNextAvailability('daily', NOW)).toContain('tomorrow');
    expect(describeNextAvailability('weekly', NOW)).toContain('next week');
    expect(describeNextAvailability('monthly', NOW)).toContain('next month');
    expect(describeNextAvailability('once', NOW)).toContain('once');
  });
});

/* ------------------------------------------------------------------ */
/* AST helpers                                                         */
/* ------------------------------------------------------------------ */

describe('AST helpers', () => {
  it('replaces a node without mutating the original tree', () => {
    const target = leaf('tasksCompleted', '>=', 5);
    const root = group('and', target, leaf('studyMinutes', '>=', 1));
    const next = replaceNode(root, target.id, leaf('level', '>=', 9));
    expect(isLeaf(next)).toBe(false);
    if (!isLeaf(next)) expect((next.children[0] as LeafCondition).metric).toBe('level');
    expect((root.children[0] as LeafCondition).metric).toBe('tasksCompleted');
  });

  it('returns null when the root itself is removed', () => {
    const root = group('and', leaf('level', '>=', 1));
    expect(removeNode(root, root.id)).toBeNull();
  });

  it('removes a nested node', () => {
    const target = leaf('tasksCompleted', '>=', 5);
    const root = group('and', group('or', target, leaf('level', '>=', 1)));
    const next = removeNode(root, target.id);
    expect(next && countLeaves(next)).toBe(1);
  });

  it('appends a child to the addressed group only', () => {
    const inner = group('or', leaf('level', '>=', 1));
    const root = group('and', inner, leaf('tasksCompleted', '>=', 1));
    const next = addChild(root, inner.id, leaf('studyMinutes', '>=', 1));
    expect(countLeaves(next)).toBe(3);
    expect(countLeaves(root)).toBe(2);
  });

  it('clones deeply with fresh ids', () => {
    const root = group('and', leaf('level', '>=', 1), group('or', leaf('studyMinutes', '>=', 2)));
    let n = 0;
    const copy = cloneCondition(root, () => `c${++n}`);
    expect(copy.id).not.toBe(root.id);
    expect(countLeaves(copy)).toBe(2);
    expect(JSON.stringify(copy)).not.toBe(JSON.stringify(root));
  });
});

describe('isValidCondition', () => {
  it('accepts well-formed leaves and groups', () => {
    expect(isValidCondition(leaf('studyMinutes', '>=', 1))).toBe(true);
    expect(isValidCondition(group('and', leaf('studyMinutes', '>=', 1)))).toBe(true);
    expect(isValidCondition(group('or'))).toBe(true);
  });

  it('rejects junk from storage or an import file', () => {
    expect(isValidCondition(null)).toBe(false);
    expect(isValidCondition('nope')).toBe(false);
    expect(isValidCondition({ id: 'x', type: 'leaf' })).toBe(false);
    expect(isValidCondition({ id: 'x', type: 'leaf', metric: 'a', operator: '~', value: 1, window: { kind: 'today' } })).toBe(false);
    expect(isValidCondition({ id: 'x', type: 'leaf', metric: 'a', operator: '>=', value: Number.NaN, window: { kind: 'today' } })).toBe(false);
    expect(isValidCondition({ id: 'x', type: 'and', children: [{ bad: true }] })).toBe(false);
    expect(isValidCondition({ id: 'x', type: 'xor', children: [] })).toBe(false);
  });

  it('round-trips through JSON', () => {
    const root = group('and', leaf('studyMinutes', '>=', 300, { kind: 'rolling_days', days: 14 }));
    const restored: unknown = JSON.parse(JSON.stringify(root));
    expect(isValidCondition(restored)).toBe(true);
    if (isValidCondition(restored)) {
      expect(evaluateCondition(restored, SOURCE, NOW).met).toBe(false);
    }
  });
});
