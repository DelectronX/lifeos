import {
  BarChart3, BookOpen, CalendarDays, CheckSquare, ClipboardList, Home, ListTodo,
  RotateCcw, Settings as SettingsIcon, SlidersHorizontal, Target, Timer, Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The single source of truth for navigation.
 *
 * Both the sidebar rail and the command palette read this model, so a
 * destination can never exist in one and be missing from the other.
 */

export interface NavDestination {
  /** Router path. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra tokens the command palette fuzzy-matches against. */
  keywords?: string;
  /** Promoted into the mobile bottom tab bar (max 4 + More). */
  mobile?: boolean;
  /** Single-key shortcut, pressed with the platform modifier. */
  shortcut?: string;
}

export interface NavGroup {
  /** Small uppercase rail label. */
  label: string;
  items: NavDestination[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Today',
    items: [
      { to: '/', label: 'Home', icon: Home, keywords: 'today dashboard overview start', mobile: true, shortcut: '1' },
      { to: '/schedule', label: 'Schedule', icon: CalendarDays, keywords: 'calendar day timeline blocks plan', mobile: true, shortcut: '2' },
      { to: '/focus', label: 'Focus', icon: Timer, keywords: 'timer pomodoro deep work session', mobile: true, shortcut: '3' },
    ],
  },
  {
    label: 'Work',
    items: [
      { to: '/tasks', label: 'Tasks', icon: ListTodo, keywords: 'todo inbox backlog items', mobile: true, shortcut: '4' },
      { to: '/goals', label: 'Goals', icon: Target, keywords: 'objectives milestones outcomes projects' },
      { to: '/revision', label: 'Revision', icon: RotateCcw, keywords: 'spaced repetition recall study review queue' },
    ],
  },
  {
    label: 'Signals',
    items: [
      { to: '/trackers', label: 'Trackers', icon: CheckSquare, keywords: 'habits areas life domains' },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, keywords: 'stats charts insights trends metrics' },
      { to: '/review/daily', label: 'Daily review', icon: ClipboardList, keywords: 'reflect journal end of day shutdown' },
      { to: '/review/weekly', label: 'Weekly review', icon: ClipboardList, keywords: 'reflect week retrospective planning' },
      { to: '/achievements', label: 'Achievements', icon: Trophy, keywords: 'badges xp level streaks rewards' },
      { to: '/practice', label: 'Practice', icon: BookOpen, keywords: 'resources library files links pdf notes' },
      { to: '/planning/rules', label: 'Auto Plan rules', icon: SlidersHorizontal, keywords: 'rule builder subject window time constraint hard schedule' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: SettingsIcon, keywords: 'preferences theme backup export config' },
    ],
  },
] as const;

/** Flattened destinations, rail order preserved. */
export const NAV_DESTINATIONS: readonly NavDestination[] = NAV_GROUPS.flatMap((g) => g.items);

/** The four destinations promoted into the mobile tab bar. */
export const MOBILE_TABS: readonly NavDestination[] = NAV_DESTINATIONS.filter((d) => d.mobile);

/** Everything not in the tab bar — shown in the mobile "More" sheet. */
export const MOBILE_OVERFLOW: readonly NavDestination[] = NAV_DESTINATIONS.filter((d) => !d.mobile);

/**
 * The module title shown in the window chrome for a pathname.
 * Falls back to the longest matching prefix so detail routes stay labelled.
 */
export function moduleTitleFor(pathname: string, fallback = 'LifeOS'): string {
  if (pathname === '/') return 'Home';
  let best: NavDestination | null = null;
  for (const d of NAV_DESTINATIONS) {
    if (d.to === '/') continue;
    if (pathname === d.to || pathname.startsWith(`${d.to}/`)) {
      if (!best || d.to.length > best.to.length) best = d;
    }
  }
  return best?.label ?? fallback;
}
