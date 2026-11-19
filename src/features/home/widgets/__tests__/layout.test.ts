import { describe, expect, it } from 'vitest';
import {
  addWidget, availableWidgetTypes, removeWidget, reorderWidgets, updateWidgetSettings,
} from '../layout';
import { cycleWidgetSize, introduceWidgets, moveWidget, setWidgetHidden } from '../layout';
import { RECOMMENDED_LAYOUT, WIDGET_TYPES } from '../registry';
import type { DashboardWidgetConfig } from '@/types';

/**
 * Pure layout-editing logic — add/remove/reorder/settings-patch producing the
 * correct persisted array. Widget rendering itself is not tested here.
 */
describe('dashboard layout editing', () => {
  it('addWidget appends a new instance at its registry default size', () => {
    const layout = addWidget([], 'today_tasks');
    expect(layout).toHaveLength(1);
    expect(layout[0].type).toBe('today_tasks');
    expect(layout[0].size).toBe('medium');
    expect(layout[0].hidden).toBe(false);
    expect(layout[0].id).toBeTruthy();
  });

  it('addWidget preserves existing widgets and appends at the end', () => {
    const first = addWidget([], 'today_tasks');
    const second = addWidget(first, 'study_streak');
    expect(second).toHaveLength(2);
    expect(second[0].type).toBe('today_tasks');
    expect(second[1].type).toBe('study_streak');
  });

  it('removeWidget drops exactly the matching id and nothing else', () => {
    const layout = addWidget(addWidget([], 'today_tasks'), 'study_streak');
    const targetId = layout[0].id;
    const next = removeWidget(layout, targetId);
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe('study_streak');
  });

  it('removeWidget is a no-op for an id not present', () => {
    const layout = addWidget([], 'today_tasks');
    const next = removeWidget(layout, 'does-not-exist');
    expect(next).toHaveLength(1);
    expect(next).toEqual(layout);
  });

  it('reorderWidgets moves an item from one index to another, preserving order of the rest', () => {
    let layout: DashboardWidgetConfig[] = [];
    layout = addWidget(layout, 'today_tasks');
    layout = addWidget(layout, 'today_schedule');
    layout = addWidget(layout, 'study_streak');
    // Move the last widget to the front.
    const next = reorderWidgets(layout, 2, 0);
    expect(next.map((w) => w.type)).toEqual(['study_streak', 'today_tasks', 'today_schedule']);
  });

  it('reorderWidgets is a no-op when indices are equal or out of range', () => {
    const layout = addWidget(addWidget([], 'today_tasks'), 'study_streak');
    expect(reorderWidgets(layout, 0, 0)).toEqual(layout);
    expect(reorderWidgets(layout, -1, 1)).toEqual(layout);
    expect(reorderWidgets(layout, 0, 5)).toEqual(layout);
  });

  it('updateWidgetSettings merges a patch into only the targeted widget', () => {
    let layout: DashboardWidgetConfig[] = [];
    layout = addWidget(layout, 'subject_progress');
    layout = addWidget(layout, 'study_streak');
    const targetId = layout[0].id;
    const next = updateWidgetSettings(layout, targetId, { trackerId: 'tr_math' });
    expect(next[0].settings).toEqual({ trackerId: 'tr_math' });
    expect(next[1].settings).toEqual(layout[1].settings);
  });

  it('updateWidgetSettings merges rather than replaces existing settings', () => {
    let layout: DashboardWidgetConfig[] = [addWidget([], 'subject_progress')[0]];
    layout = updateWidgetSettings(layout, layout[0].id, { trackerId: 'tr_math' });
    layout = updateWidgetSettings(layout, layout[0].id, { extra: true });
    expect(layout[0].settings).toEqual({ trackerId: 'tr_math', extra: true });
  });

  it('availableWidgetTypes excludes every type already present in the layout', () => {
    const layout = addWidget(addWidget([], 'today_tasks'), 'study_streak');
    const available = availableWidgetTypes(layout);
    expect(available).not.toContain('today_tasks');
    expect(available).not.toContain('study_streak');
    expect(available).toContain('today_schedule');
    expect(available.length).toBeGreaterThan(0);
  });

  it('availableWidgetTypes returns every registered type for an empty layout', () => {
    const available = availableWidgetTypes([]);
    expect(available).toContain('today_tasks');
    expect(available).toContain('achievement_progress');
    expect(available.length).toBe(WIDGET_TYPES.length);
  });
});

describe('introduceWidgets / hide / size / move', () => {
  it('gives an empty layout the recommended arrangement once', () => {
    const r = introduceWidgets([], undefined);
    expect(r.layout.map((w) => w.type)).toEqual(RECOMMENDED_LAYOUT);
    expect(r.changed).toBe(true);
    const again = introduceWidgets(r.layout, r.introduced);
    expect(again.changed).toBe(false);
    expect(again.layout).toBe(r.layout);
  });

  it('appends only never-seen types to an existing layout and never re-adds removed ones', () => {
    const existing = addWidget(addWidget([], 'xp_progress'), 'today_schedule');
    const r = introduceWidgets(existing, ['xp_progress', 'today_schedule']);
    expect(r.layout.slice(0, 2).map((w) => w.type)).toEqual(['xp_progress', 'today_schedule']);
    expect(r.layout.filter((w) => w.type === 'today_schedule')).toHaveLength(1);
    const removed = removeWidget(r.layout, r.layout.find((w) => w.type === 'focus_stats')!.id);
    const again = introduceWidgets(removed, r.introduced);
    expect(again.layout.some((w) => w.type === 'focus_stats')).toBe(false);
  });

  it('hides without losing settings, cycles size and moves by one', () => {
    let l = addWidget(addWidget([], 'xp_progress'), 'study_streak');
    const id = l[0].id;
    l = setWidgetHidden(l, id, true);
    expect(l[0].hidden).toBe(true);
    l = cycleWidgetSize(l, id);
    expect(l[0].size).not.toBe(addWidget([], 'xp_progress')[0].size);
    l = moveWidget(l, id, 1);
    expect(l[1].id).toBe(id);
    expect(moveWidget(l, id, 1)[1].id).toBe(id);
  });
});
