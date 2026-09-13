import { newId } from '@/lib/id';
import type { DashboardWidgetConfig, DashboardWidgetType } from '@/types';
import { WIDGET_REGISTRY } from './registry';

/**
 * Pure layout-editing helpers for the Home dashboard.
 *
 * Every function takes the current persisted array and returns a new array —
 * nothing here touches Dexie. `HomePage` (or any future caller) is responsible
 * for calling `setDashboardLayout` with the result.
 */

/** Appends a new instance of `type` at the end of the layout, at its default size. */
export function addWidget(layout: DashboardWidgetConfig[], type: DashboardWidgetType): DashboardWidgetConfig[] {
  const def = WIDGET_REGISTRY[type];
  const widget: DashboardWidgetConfig = {
    id: newId('wgt'),
    type,
    size: def?.defaultSize ?? 'medium',
    settings: {},
    hidden: false,
  };
  return [...layout, widget];
}

/** Removes one widget instance by id. No-op if the id is not present. */
export function removeWidget(layout: DashboardWidgetConfig[], id: string): DashboardWidgetConfig[] {
  return layout.filter((w) => w.id !== id);
}

/** Moves the widget at `fromIndex` to `toIndex`, preserving every other widget's relative order. */
export function reorderWidgets(layout: DashboardWidgetConfig[], fromIndex: number, toIndex: number): DashboardWidgetConfig[] {
  if (
    fromIndex === toIndex
    || fromIndex < 0 || fromIndex >= layout.length
    || toIndex < 0 || toIndex >= layout.length
  ) {
    return layout;
  }
  const next = layout.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Merges a partial settings patch into one widget's `settings`, persisted immediately by the caller. */
export function updateWidgetSettings(
  layout: DashboardWidgetConfig[],
  id: string,
  patch: Record<string, unknown>,
): DashboardWidgetConfig[] {
  return layout.map((w) => (w.id === id ? { ...w, settings: { ...w.settings, ...patch } } : w));
}

/** Widget types not already present in the layout — what the "Add widget" picker offers. */
export function availableWidgetTypes(layout: DashboardWidgetConfig[]): DashboardWidgetType[] {
  const used = new Set(layout.map((w) => w.type));
  return (Object.keys(WIDGET_REGISTRY) as DashboardWidgetType[]).filter((t) => !used.has(t));
}
