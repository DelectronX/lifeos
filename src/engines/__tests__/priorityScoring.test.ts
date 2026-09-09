import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULING_CONFIG as CONFIG } from '@/config/schedulingConfig';
import {
  comparePriority, prioritizeTasks, scoreTask, scoreTasks,
} from '@/engines/priorityScoring';
import { DAY, makeGoal, makeTask, nowAt, resetIds } from './fixtures';

const ctx = { now: nowAt(), today: DAY };

describe('priorityScoring', () => {
  it('scores a bare task inside 0..100 and explains every term', () => {
    resetIds();
    const s = scoreTask(makeTask(), ctx, CONFIG);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.terms).toHaveLength(8);
    for (const t of s.terms) {
      expect(t.explanation.length).toBeGreaterThan(0);
      expect(t.raw).toBeGreaterThanOrEqual(0);
      expect(t.raw).toBeLessThanOrEqual(1);
    }
    expect(s.summary).toContain('/100');
  });

  it('contributions sum to the total score', () => {
    resetIds();
    const s = scoreTask(
      makeTask({ basePriority: 4, dueDate: DAY, deadlineHard: true, estimatedMinutes: 30 }),
      ctx, CONFIG,
    );
    const sum = s.terms.reduce((a, t) => a + t.contribution, 0);
    expect(sum).toBeCloseTo(s.score, 1);
  });

  it('ranks a task due today above the same task due in two weeks', () => {
    resetIds();
    const soon = scoreTask(makeTask({ dueDate: DAY, deadlineHard: true }), ctx, CONFIG);
    const later = scoreTask(makeTask({ dueDate: '2026-03-16', deadlineHard: true }), ctx, CONFIG);
    expect(soon.score).toBeGreaterThan(later.score);
    expect(soon.terms.find((t) => t.key === 'deadline')!.explanation).toBe('Due today.');
  });

  it('applies the overdue penalty and reports days overdue', () => {
    resetIds();
    const overdue = scoreTask(
      makeTask({ dueDate: '2026-02-26', deadlineHard: true }), ctx, CONFIG,
    );
    const term = overdue.terms.find((t) => t.key === 'overdue')!;
    expect(overdue.daysUntilDue).toBe(-4);
    expect(term.raw).toBeGreaterThan(0);
    expect(term.explanation).toBe('4 days overdue.');
  });

  it('discounts soft deadlines relative to hard ones', () => {
    resetIds();
    const hard = scoreTask(makeTask({ dueDate: DAY, deadlineHard: true }), ctx, CONFIG);
    const soft = scoreTask(makeTask({ dueDate: DAY, deadlineHard: false }), ctx, CONFIG);
    expect(hard.score).toBeGreaterThan(soft.score);
  });

  it('boosts tasks linked to a heavy active goal, but not a paused one', () => {
    resetIds();
    const heavy = makeGoal({ id: 'g1', weight: 1, status: 'active' });
    const paused = makeGoal({ id: 'g2', weight: 1, status: 'paused' });
    const goalsById = { g1: heavy, g2: paused };

    const a = scoreTask(makeTask({ goalId: 'g1' }), { ...ctx, goalsById }, CONFIG);
    const b = scoreTask(makeTask({ goalId: 'g2' }), { ...ctx, goalsById }, CONFIG);
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.terms.find((t) => t.key === 'goal')!.raw).toBe(0);
  });

  it('boosts revision tasks', () => {
    resetIds();
    const rev = scoreTask(makeTask({ type: 'revision' }), ctx, CONFIG);
    const plain = scoreTask(makeTask({ type: 'study' }), ctx, CONFIG);
    expect(rev.score).toBeGreaterThan(plain.score);
  });

  it('derives the dependency graph: blockers score up, blocked are flagged', () => {
    resetIds();
    const blocker = makeTask({ id: 'A', title: 'A' });
    const b = makeTask({ id: 'B', dependsOn: ['A'] });
    const c = makeTask({ id: 'C', dependsOn: ['A'] });
    const lone = makeTask({ id: 'D' });

    const { byTaskId } = scoreTasks([blocker, b, c, lone], ctx, CONFIG);

    expect(byTaskId.A!.terms.find((t) => t.key === 'dependency')!.raw)
      .toBeCloseTo(2 / CONFIG.priority.dependencySaturation, 5);
    expect(byTaskId.A!.blocked).toBe(false);
    expect(byTaskId.B!.blocked).toBe(true);
    expect(byTaskId.B!.blockedBy).toEqual(['A']);
    expect(byTaskId.A!.score).toBeGreaterThan(byTaskId.D!.score);
  });

  it('treats a completed dependency as satisfied', () => {
    resetIds();
    const done = makeTask({ id: 'A', status: 'completed' });
    const b = makeTask({ id: 'B', dependsOn: ['A'] });
    const { byTaskId } = scoreTasks([done, b], ctx, CONFIG);
    expect(byTaskId.B!.blocked).toBe(false);
  });

  it('orders tasks deterministically: score, then deadline, then id', () => {
    resetIds();
    const high = makeTask({ id: 'hi', basePriority: 5, dueDate: DAY, deadlineHard: true });
    const mid = makeTask({ id: 'mid', basePriority: 3, dueDate: '2026-03-09' });
    const low = makeTask({ id: 'lo', basePriority: 1 });

    const ordered = prioritizeTasks([low, mid, high], ctx, CONFIG);
    expect(ordered.map((o) => o.task.id)).toEqual(['hi', 'mid', 'lo']);

    // Same input in a different order gives the same result.
    const again = prioritizeTasks([high, low, mid], ctx, CONFIG);
    expect(again.map((o) => o.task.id)).toEqual(['hi', 'mid', 'lo']);
  });

  it('comparePriority breaks exact ties by earlier deadline', () => {
    const a = { taskId: 'a', score: 50, daysUntilDue: 10 } as never;
    const b = { taskId: 'b', score: 50, daysUntilDue: 2 } as never;
    expect(comparePriority(a, b)).toBeGreaterThan(0);
  });

  it('respects reconfigured weights: zeroing deadline weight removes its effect', () => {
    resetIds();
    const noDeadlineWeight = {
      ...CONFIG,
      priority: { ...CONFIG.priority, weights: { ...CONFIG.priority.weights, deadline: 0, overdue: 0 } },
    };
    const soon = scoreTask(makeTask({ id: 'x', dueDate: DAY, deadlineHard: true }), ctx, noDeadlineWeight);
    const later = scoreTask(makeTask({ id: 'y', dueDate: '2026-04-01', deadlineHard: true }), ctx, noDeadlineWeight);
    expect(soon.score).toBeCloseTo(later.score, 5);
  });
});
