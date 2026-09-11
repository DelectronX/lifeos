import { describe, expect, it, vi } from 'vitest';
import { DirtyTracker } from '../dirtyTracker';

describe('DirtyTracker', () => {
  it('deduplicates marks and reports the dirty set sorted', () => {
    const tracker = new DirtyTracker();
    tracker.mark('tasks', 'goals', 'tasks');
    expect(tracker.size).toBe(2);
    expect(tracker.snapshot()).toEqual(['goals', 'tasks']);
  });

  it('only notifies subscribers when the set actually changes', () => {
    const tracker = new DirtyTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);

    tracker.mark('tasks');
    tracker.mark('tasks');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('take() hands over the set and settle() clears it', () => {
    const tracker = new DirtyTracker();
    tracker.mark('tasks', 'goals');

    const taken = tracker.take();
    expect(taken.sort()).toEqual(['goals', 'tasks']);
    // Still counted as dirty while the write is in flight.
    expect(tracker.isDirty()).toBe(true);

    tracker.settle();
    expect(tracker.isDirty()).toBe(false);
    expect(tracker.snapshot()).toEqual([]);
  });

  it('keeps a mutation that lands during a flush', () => {
    const tracker = new DirtyTracker();
    tracker.mark('tasks');
    tracker.take();

    // A write happens while tasks.json is being uploaded.
    tracker.mark('blocks');
    tracker.settle();

    expect(tracker.snapshot()).toEqual(['blocks']);
  });

  it('restores the in-flight set when a write fails, losing nothing', () => {
    const tracker = new DirtyTracker();
    tracker.mark('tasks', 'goals');
    tracker.take();

    tracker.restore();

    expect(tracker.snapshot()).toEqual(['goals', 'tasks']);
    expect(tracker.isDirty('tasks')).toBe(true);
  });

  it('reports per-collection dirtiness including the in-flight set', () => {
    const tracker = new DirtyTracker();
    tracker.mark('tasks');
    tracker.take();
    expect(tracker.isDirty('tasks')).toBe(true);
    expect(tracker.isDirty('goals')).toBe(false);
  });

  it('clear() wipes everything and notifies once', () => {
    const tracker = new DirtyTracker();
    const listener = vi.fn();
    tracker.mark('tasks');
    tracker.subscribe(listener);
    listener.mockClear();

    tracker.clear();
    tracker.clear();

    expect(tracker.isDirty()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('markAll accepts any iterable', () => {
    const tracker = new DirtyTracker();
    tracker.markAll(new Set(['a', 'b']));
    expect(tracker.snapshot()).toEqual(['a', 'b']);
  });
});
