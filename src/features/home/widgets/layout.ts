import { newId } from '@/lib/id';
import type { DashboardWidgetConfig, DashboardWidgetType } from '@/types';
import { RECOMMENDED_LAYOUT, WIDGET_REGISTRY } from './registry';
import type { DashboardWidgetSize } from '@/types';

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

/** Shows or hides one widget without removing it (its settings are kept). */
export function setWidgetHidden(layout: DashboardWidgetConfig[], id: string, hidden: boolean): DashboardWidgetConfig[] {
  return layout.map((w) => (w.id === id ? { ...w, hidden } : w));
}

const SIZE_CYCLE: DashboardWidgetSize[] = ['small', 'medium', 'large'];
/** Cycles a widget through small → medium → large → small. */
export function cycleWidgetSize(layout: DashboardWidgetConfig[], id: string): DashboardWidgetConfig[] {
  return layout.map((w) => (w.id === id ? { ...w, size: SIZE_CYCLE[(SIZE_CYCLE.indexOf(w.size) + 1) % SIZE_CYCLE.length] } : w));
}

/** Moves a widget one place earlier/later (keyboard-accessible alternative to drag). */
export function moveWidget(layout: DashboardWidgetConfig[], id: string, delta: -1 | 1): DashboardWidgetConfig[] {
  const i = layout.findIndex((w) => w.id === id);
  return i === -1 ? layout : reorderWidgets(layout, i, Math.max(0, Math.min(layout.length - 1, i + delta)));
}

/**
 * Introduces widget types the user has never been offered. An empty layout
 * gets the recommended arrangement; an existing layout keeps its order and
 * gains only the never-seen types at the end. A type the user removed is
 * never re-added, because it is recorded in `introduced` the first time.
 * Pure: returns the next layout and the next `introduced` list.
 */
export function introduceWidgets(
  layout: DashboardWidgetConfig[],
  introduced: readonly DashboardWidgetType[] | undefined,
): { layout: DashboardWidgetConfig[]; introduced: DashboardWidgetType[]; changed: boolean } {
  const seen = new Set<DashboardWidgetType>(introduced ?? []);
  // Types already in the layout count as introduced.
  for (const w of layout) seen.add(w.type);
  let next = layout;
  const toAdd = (layout.length === 0 && !introduced?.length ? RECOMMENDED_LAYOUT : RECOMMENDED_LAYOUT.filter((t) => !seen.has(t)));
  for (const t of toAdd) if (!next.some((w) => w.type === t)) next = addWidget(next, t);
  for (const t of RECOMMENDED_LAYOUT) seen.add(t);
  const nextIntroduced = [...seen];
  const changed = next !== layout || nextIntroduced.length !== (introduced?.length ?? 0);
  return { layout: next, introduced: nextIntroduced, changed };
}
