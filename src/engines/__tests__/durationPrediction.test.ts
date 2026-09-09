import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as CONFIG } from '@/config/schedulingConfig';
import {
  buildSamples, predictDurations, predictForGroup, suggestDurationForTask,
} from '@/engines/durationPrediction';
import { TRACKER_FITNESS, TRACKER_STUDY, makeSession, makeTask, resetIds } from './fixtures';

/** n completed tasks that each took `actual` against an `estimated` plan. */
function pairs(n: number, estimated: number, actual: number, over: Partial<Parameters<typeof makeTask>[0]> = {}) {
  return Array.from({ length: n }, (_, i) =>
    makeTask({
      id: `p${estimated}_${actual}_${i}`,
      status: 'completed',
      estimatedMinutes: estimated,
      actualMinutes: actual,
      ...over,
    }));
}

describe('buildSamples', () => {
  it('ignores tasks that are not completed or have no tracked time', () => {
    resetIds();
    const tasks = [
      makeTask({ id: 'a', status: 'planned', estimatedMinutes: 60, actualMinutes: 60 }),
      makeTask({ id: 'b', status: 'completed', estimatedMinutes: 60, actualMinutes: 0 }),
      makeTask({ id: 'c', status: 'completed', estimatedMinutes: 0, actualMinutes: 30 }),
      makeTask({ id: 'd', status: 'completed', estimatedMinutes: 60, actualMinutes: 90 }),
    ];
    const s = buildSamples({ tasks });
    expect(s.map((x) => x.taskId)).toEqual(['d']);
    expect(s[0]!.ratio).toBe(1.5);
  });

  it('prefers real TimerSession time over the task rollup', () => {
    resetIds();
    const task = makeTask({ id: 'T', status: 'completed', estimatedMinutes: 60, actualMinutes: 10 });
    const sessions = [
      makeSession({ taskId: 'T', workMs: 30 * 60_000 }),
      makeSession({ taskId: 'T', workMs: 60 * 60_000 }),
    ];
    const s = buildSamples({ tasks: [task], sessions });
    expect(s[0]!.actualMinutes).toBe(90);
    expect(s[0]!.ratio).toBe(1.5);
  });

  it('falls back to Activity duration when nothing else exists', () => {
    resetIds();
    const task = makeTask({ id: 'T', status: 'completed', estimatedMinutes: 40, actualMinutes: 0 });
    const activities = [{
      taskId: 'T', durationMs: 60 * 60_000, type: 'timer_session', at: 0, date: '',
    }] as never;
    const s = buildSamples({ tasks: [task], activities });
    expect(s[0]!.actualMinutes).toBe(60);
  });
});

describe('predictDurations', () => {
  it('computes mean, median and stddev of the overrun ratio', () => {
    resetIds();
    // Ratios 1.0, 1.5, 2.0 -> mean 1.5, median 1.5
    const tasks = [
      makeTask({ id: 'a', status: 'completed', estimatedMinutes: 60, actualMinutes: 60 }),
      makeTask({ id: 'b', status: 'completed', estimatedMinutes: 60, actualMinutes: 90 }),
      makeTask({ id: 'c', status: 'completed', estimatedMinutes: 60, actualMinutes: 120 }),
    ];
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks }, CONFIG);

    expect(p.sampleSize).toBe(3);
    expect(p.averageOverrunRatio).toBe(1.5);
    expect(p.medianOverrunRatio).toBe(1.5);
    expect(p.meanEstimatedMinutes).toBe(60);
    expect(p.meanActualMinutes).toBe(90);
    expect(p.ratioStdDev).toBeCloseTo(0.41, 1);
  });

  it('takes the median of an even sample count', () => {
    resetIds();
    // Ratios 1.0, 1.0, 2.0, 2.0 -> median 1.5
    const tasks = [
      ...pairs(2, 60, 60, { type: 'reading' }),
      ...pairs(2, 60, 120, { type: 'reading' }),
    ];
    const p = predictForGroup('task_type', 'reading', { tasks }, CONFIG);
    expect(p.sampleSize).toBe(4);
    expect(p.medianOverrunRatio).toBe(1.5);
  });

  it('clamps a catastrophic outlier to the configured max ratio', () => {
    resetIds();
    // 10x overrun is clamped to maxRatio (3).
    const tasks = [
      makeTask({ id: 'a', status: 'completed', estimatedMinutes: 10, actualMinutes: 100 }),
      ...pairs(2, 60, 60),
    ];
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks }, CONFIG);
    // Ratios become 3, 1, 1 -> mean 1.67
    expect(p.averageOverrunRatio).toBeCloseTo(1.67, 1);
  });

  it('withholds a suggestion below minSamples and says how many are needed', () => {
    resetIds();
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks: pairs(2, 60, 90) }, CONFIG);
    expect(p.sampleSize).toBe(2);
    expect(p.confidence).toBe('none');
    expect(p.suggestion).toBeNull();
    expect(p.pattern).toContain('3 needed');
  });

  it('reports a systematic overrun with a readable pattern sentence', () => {
    resetIds();
    // Consistent 1.5x across 12 samples.
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks: pairs(12, 60, 90) }, CONFIG);

    expect(p.systematicOverrun).toBe(true);
    expect(p.systematicUnderrun).toBe(false);
    expect(p.confidence).toBe('high');
    expect(p.pattern).toContain('50% longer than planned');
    expect(p.pattern).toContain('12');
  });

  it('reports a systematic underrun', () => {
    resetIds();
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks: pairs(12, 60, 40) }, CONFIG);
    expect(p.systematicUnderrun).toBe(true);
    expect(p.pattern).toContain('shorter than planned');
  });

  it('calls accurate estimates accurate', () => {
    resetIds();
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks: pairs(8, 60, 60) }, CONFIG);
    expect(p.systematicOverrun).toBe(false);
    expect(p.systematicUnderrun).toBe(false);
    expect(p.pattern).toContain('estimates here are accurate');
  });

  it('does not call a wildly inconsistent group a pattern', () => {
    resetIds();
    const tasks = [
      ...pairs(3, 60, 30),  // 0.5
      ...pairs(3, 60, 180), // 3.0
      ...pairs(2, 60, 90),  // 1.5
    ];
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks }, CONFIG);
    expect(p.ratioStdDev).toBeGreaterThan(0.5);
    expect(p.confidence).toBe('low');
    expect(p.systematicOverrun).toBe(false);
  });

  it('builds a rounded suggestion range around the median', () => {
    resetIds();
    const p = predictForGroup('tracker', TRACKER_STUDY, { tasks: pairs(6, 60, 90) }, CONFIG);
    const s = p.suggestion!;
    expect(s.likelyMinutes).toBe(90);
    expect(s.lowMinutes).toBeLessThan(s.likelyMinutes);
    expect(s.highMinutes).toBeGreaterThan(s.likelyMinutes);
    for (const v of [s.lowMinutes, s.likelyMinutes, s.highMinutes]) {
      expect(v % CONFIG.duration.roundToMinutes).toBe(0);
    }
  });

  it('groups independently by tracker, task type and subject', () => {
    resetIds();
    const tasks = [
      ...pairs(4, 60, 120, { trackerId: TRACKER_STUDY, type: 'study' }),
      ...pairs(4, 60, 60, { trackerId: TRACKER_FITNESS, type: 'workout' }),
    ];
    const all = predictDurations({ tasks }, CONFIG);

    const study = all.find((p) => p.groupKind === 'tracker' && p.groupKey === TRACKER_STUDY)!;
    const fitness = all.find((p) => p.groupKind === 'tracker' && p.groupKey === TRACKER_FITNESS)!;
    expect(study.medianOverrunRatio).toBe(2);
    expect(fitness.medianOverrunRatio).toBe(1);

    expect(all.some((p) => p.groupKind === 'task_type' && p.groupKey === 'workout')).toBe(true);
    const global = all.find((p) => p.groupKind === 'global')!;
    expect(global.sampleSize).toBe(8);
    expect(global.medianOverrunRatio).toBe(1.5);
  });

  it('groups by an explicit subject key and uses it in the label', () => {
    resetIds();
    const tasks = pairs(5, 60, 90, { tags: ['calculus'] });
    const all = predictDurations({ tasks, subjectOf: (t) => t.tags[0] ?? null }, CONFIG);
    const calc = all.find((p) => p.groupKind === 'subject' && p.groupKey === 'calculus')!;
    expect(calc.sampleSize).toBe(5);
    expect(calc.pattern).toContain('calculus');
  });

  it('uses the friendly tracker name in the pattern sentence', () => {
    resetIds();
    const p = predictForGroup(
      'tracker', TRACKER_STUDY,
      { tasks: pairs(6, 60, 90), trackerNames: { [TRACKER_STUDY]: 'Maths' } },
      CONFIG,
    );
    expect(p.pattern).toContain('Maths');
  });
});

describe('suggestDurationForTask', () => {
  it('prefers the most specific group with enough samples', () => {
    resetIds();
    const history = [
      ...pairs(6, 60, 120, { tags: ['algebra'] }),   // subject: 2.0x
      ...pairs(6, 60, 60, { tags: ['other'], type: 'reading' }), // dilutes tracker
    ];
    const target = makeTask({ id: 'new', estimatedMinutes: 30, tags: ['algebra'] });
    const p = suggestDurationForTask(
      target, { tasks: history, subjectOf: (t) => t.tags[0] ?? null }, CONFIG,
    );
    expect(p).not.toBeNull();
    expect(p!.groupKind).toBe('subject');
    expect(p!.groupKey).toBe('algebra');
    // 30 min plan x 2.0 median = 60 min likely.
    expect(p!.suggestion!.referenceMinutes).toBe(30);
    expect(p!.suggestion!.likelyMinutes).toBe(60);
  });

  it('falls back to a broader group when the subject is thin', () => {
    resetIds();
    const history = [
      ...pairs(1, 60, 90, { tags: ['rare'] }),
      ...pairs(8, 60, 90, { tags: ['common'] }),
    ];
    const target = makeTask({ id: 'new', estimatedMinutes: 60, tags: ['rare'] });
    const p = suggestDurationForTask(
      target, { tasks: history, subjectOf: (t) => t.tags[0] ?? null }, CONFIG,
    );
    expect(p!.groupKind).not.toBe('subject');
    expect(p!.sampleSize).toBeGreaterThanOrEqual(CONFIG.duration.minSamples);
  });

  it('returns null with no history at all — it never invents a number', () => {
    resetIds();
    const p = suggestDurationForTask(makeTask({ id: 'x' }), { tasks: [] }, CONFIG);
    expect(p).toBeNull();
  });

  it('does not modify the task it is advising on', () => {
    resetIds();
    const target = makeTask({ id: 'new', estimatedMinutes: 45 });
    const before = JSON.stringify(target);
    suggestDurationForTask(target, { tasks: pairs(6, 60, 120) }, CONFIG);
    expect(JSON.stringify(target)).toBe(before);
    expect(target.estimatedMinutes).toBe(45);
  });

  it('honours a reconfigured minSamples threshold', () => {
    resetIds();
    const strict = { ...CONFIG, duration: { ...CONFIG.duration, minSamples: 10 } };
    const p = suggestDurationForTask(makeTask({ id: 'x' }), { tasks: pairs(5, 60, 90) }, strict);
    expect(p).toBeNull();
  });
});
