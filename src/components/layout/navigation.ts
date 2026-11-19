import {
  BarChart3, BookOpen, Briefcase, GraduationCap, CalendarDays, CheckSquare, ClipboardList, FlaskConical, FolderKanban, Home,
  ListChecks, ListTodo, RotateCcw, SquareKanban, Settings as SettingsIcon, SlidersHorizontal, Sparkles, Target, Timer, Trophy,
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
  /** Only shown in Advanced mode. */
  advanced?: boolean;
  /** Pinned into the desktop dock (wide screens fit more than the phone tab bar). */
  dock?: boolean;
}

export interface NavGroup {
  /** Small uppercase rail label. */
  label: string;
  items: NavDestination[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    // What am I doing right now?
    label: 'Today',
    items: [
      { to: '/', label: 'Home', icon: Home, keywords: 'today dashboard overview start now', mobile: true, shortcut: '1' },
      { to: '/schedule', label: 'Schedule', icon: CalendarDays, keywords: 'calendar day timeline blocks plan', mobile: true, shortcut: '2' },
      { to: '/focus', label: 'Focus', icon: Timer, keywords: 'timer pomodoro deep work session', mobile: true, shortcut: '3' },
      { to: '/tasks', label: 'Tasks', icon: ListTodo, keywords: 'todo inbox backlog items homework', mobile: true, shortcut: '4' },
      { to: '/checklists', label: 'Checklists', icon: ListChecks, keywords: 'daily weekly monthly recurring routine checklist review', shortcut: '5', dock: true },
    ],
  },
  {
    // What am I working toward?
    label: 'Plan',
    items: [
      { to: '/goals', label: 'Goals', icon: Target, keywords: 'objectives milestones outcomes courses sequence', dock: true },
      { to: '/projects', label: 'Projects', icon: FolderKanban, keywords: 'portfolio app build repo deliverables milestones board', dock: true },
      { to: '/planning/rules', label: 'Auto Plan rules', icon: SlidersHorizontal, keywords: 'rule builder subject window time constraint hard schedule', advanced: true },
      { to: '/trackers', label: 'Areas & subjects', icon: CheckSquare, keywords: 'trackers habits areas subjects life domains', advanced: true },
    ],
  },
  {
    // Getting better at things.
    label: 'Study',
    items: [
      { to: '/practice', label: 'Practice & papers', icon: BookOpen, keywords: 'resources library files papers exams pdf notes' },
      { to: '/exams', label: 'Exams', icon: GraduationCap, keywords: 'sat ap score dashboard target domain section mock official' },
      { to: '/revision', label: 'Revision', icon: RotateCcw, keywords: 'spaced repetition recall study review queue', advanced: true },
      { to: '/research', label: 'Research', icon: FlaskConical, keywords: 'literature review paper sources citations manuscript synthesis' },
      { to: '/skills', label: 'Skills', icon: Sparkles, keywords: 'skill level evidence learning path portfolio competencies' },
    ],
  },
  {
    // Money and the people who pay it.
    label: 'Work',
    items: [
      { to: '/earning', label: 'Earning', icon: Briefcase, keywords: 'income revenue freelance clients crm leads invoices passive active expenses partial payment', dock: true },
      { to: '/clickup', label: 'ClickUp', icon: SquareKanban, keywords: 'clickup integration project management tasks board list workspace sync' },
    ],
  },
  {
    // How is it going?
    label: 'Progress',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3, keywords: 'stats charts insights trends metrics hours', advanced: true },
      { to: '/achievements', label: 'Achievements & rewards', icon: Trophy, keywords: 'badges xp level streaks rewards shop redeem' },
      { to: '/review/daily', label: 'Daily review', icon: ClipboardList, keywords: 'reflect journal end of day shutdown close' },
      { to: '/review/weekly', label: 'Weekly review', icon: ClipboardList, keywords: 'reflect week retrospective planning', advanced: true },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: SettingsIcon, keywords: 'preferences theme backup export import config storage' },
    ],
  },
] as const;

/** Groups visible in a mode (empty groups dropped). */
export function navGroupsFor(advanced: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((d) => advanced || !d.advanced) })).filter((g) => g.items.length > 0);
}

/** Destinations shown in the dock for a width class and mode, in rail order. */
export function dockItemsFor(wide: boolean, advanced: boolean): NavDestination[] {
  return NAV_DESTINATIONS.filter((d) => (advanced || !d.advanced) && (d.mobile || (wide && d.dock)));
}

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
