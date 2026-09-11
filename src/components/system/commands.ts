import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, CircleDot, ListTodo, Moon, MonitorSmartphone, PanelLeft,
  Plus, RotateCcw, Sparkles, Sun, Target, Timer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV_DESTINATIONS } from '@/components/layout/navigation';
import { useShell } from '@/components/layout/ShellContext';
import { useGoals, useOpenTasks } from '@/state/useLiveData';
import { toast } from '@/state/toastStore';
import { applyAutoPlan, previewAutoPlan, undoLastChange } from '@/services/planService';
import { setTheme } from '@/services/settingsService';
import { dueLabel, todayKey } from '@/lib/date';

/**
 * The command registry.
 *
 * Every palette row is a `Command`. Navigation rows come from the shared nav
 * model; task and goal rows come from the live Dexie hooks; actions call the
 * same services the feature pages use, so the palette is never a second,
 * diverging implementation.
 */

export type CommandSection = 'Actions' | 'Navigate' | 'Tasks' | 'Goals' | 'Appearance';

/** Rendering + ordering weight for each section header. */
export const SECTION_ORDER: readonly CommandSection[] = [
  'Actions', 'Navigate', 'Tasks', 'Goals', 'Appearance',
];

export interface Command {
  /** Stable identity — also the recents key. */
  id: string;
  section: CommandSection;
  title: string;
  /** Secondary line, e.g. a due date or a goal's progress. */
  subtitle?: string;
  icon: LucideIcon;
  /** Extra fuzzy-match tokens, never displayed. */
  keywords?: string;
  /** Shown right-aligned as key caps. */
  shortcut?: readonly string[];
  /** Nudges a command up the ranking when the query is empty. */
  weight?: number;
  run: () => void | Promise<void>;
}

async function runAutoPlan(days: number, label: string): Promise<void> {
  try {
    const preview = await previewAutoPlan({ days });
    if (!preview.result.proposals.length) {
      toast.show(`Nothing to plan ${label}`, preview.summary);
      return;
    }
    const applied = await applyAutoPlan(preview);
    toast.success(
      `Planned ${label}`,
      `${applied.created} block${applied.created === 1 ? '' : 's'} scheduled.`,
    );
  } catch (e) {
    toast.error('Auto-plan failed', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Builds the full command list for the current app state.
 *
 * @example
 * const commands = useCommands();
 * const results = rankCommands(commands, query);
 */
export function useCommands(): Command[] {
  const navigate = useNavigate();
  const tasks = useOpenTasks();
  const goals = useGoals(true);
  const { setRailCollapsed, railCollapsed, isMobile } = useShell();
  const today = todayKey();

  const go = useCallback((to: string) => () => navigate(to), [navigate]);

  return useMemo(() => {
    const out: Command[] = [];

    /* ---- Quick actions -------------------------------------------- */
    out.push(
      {
        id: 'action:focus',
        section: 'Actions',
        title: 'Start a focus session',
        subtitle: 'Open the timer and begin deep work',
        icon: Timer,
        keywords: 'pomodoro deep work start timer session',
        weight: 100,
        run: () => navigate('/focus', { state: { start: true } }),
      },
      {
        id: 'action:new-task',
        section: 'Actions',
        title: 'Add a task',
        subtitle: 'Capture something into the inbox',
        icon: Plus,
        keywords: 'new create capture todo item',
        weight: 96,
        run: () => navigate('/tasks', { state: { compose: true } }),
      },
      {
        id: 'action:autoplan-day',
        section: 'Actions',
        title: 'Auto-plan my day',
        subtitle: 'Fill today’s open time with your highest-priority work',
        icon: Sparkles,
        keywords: 'schedule plan generate blocks today',
        weight: 92,
        run: () => runAutoPlan(1, 'today'),
      },
      {
        id: 'action:autoplan-week',
        section: 'Actions',
        title: 'Auto-plan the week',
        subtitle: 'Schedule the next seven days',
        icon: CalendarCheck,
        keywords: 'schedule plan generate week ahead',
        weight: 70,
        run: () => runAutoPlan(7, 'the week'),
      },
      {
        id: 'action:daily-review',
        section: 'Actions',
        title: 'Open today’s review',
        subtitle: 'Close the day out and log how it went',
        icon: CircleDot,
        keywords: 'reflect shutdown end of day journal',
        weight: 88,
        run: go('/review/daily'),
      },
      {
        id: 'action:undo',
        section: 'Actions',
        title: 'Undo last schedule change',
        subtitle: 'Roll back the most recent planning run',
        icon: RotateCcw,
        keywords: 'revert restore mistake',
        weight: 40,
        run: async () => {
          const r = await undoLastChange();
          if (r.ok) toast.success('Undone', r.message);
          else toast.show('Nothing to undo', r.message);
        },
      },
    );

    if (!isMobile) {
      out.push({
        id: 'action:toggle-rail',
        section: 'Actions',
        title: railCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar',
        subtitle: 'Switch the navigation rail to icon-only',
        icon: PanelLeft,
        keywords: 'sidebar rail hide show narrow wide',
        shortcut: ['\\'],
        weight: 20,
        run: () => setRailCollapsed(!railCollapsed),
      });
    }

    /* ---- Navigation ------------------------------------------------ */
    for (const d of NAV_DESTINATIONS) {
      out.push({
        id: `nav:${d.to}`,
        section: 'Navigate',
        title: d.label,
        subtitle: d.to,
        icon: d.icon,
        keywords: `go to open ${d.keywords ?? ''}`,
        weight: 50,
        run: go(d.to),
      });
    }

    /* ---- Tasks ------------------------------------------------------ */
    for (const t of tasks.slice(0, 200)) {
      const bits: string[] = [];
      if (t.dueDate) bits.push(dueLabel(t.dueDate, today));
      if (t.estimatedMinutes) bits.push(`${t.estimatedMinutes}m`);
      out.push({
        id: `task:${t.id}`,
        section: 'Tasks',
        title: t.title,
        subtitle: bits.join(' · ') || undefined,
        icon: ListTodo,
        keywords: `task ${t.tags?.join(' ') ?? ''} ${t.topic ?? ''}`,
        run: () => navigate('/tasks', { state: { focusTaskId: t.id } }),
      });
    }

    /* ---- Goals ------------------------------------------------------ */
    for (const g of goals) {
      out.push({
        id: `goal:${g.id}`,
        section: 'Goals',
        title: g.title,
        subtitle: g.targetDate ? `Target ${g.targetDate}` : 'Active goal',
        icon: Target,
        keywords: 'goal objective outcome',
        run: go(`/goals/${g.id}`),
      });
    }

    /* ---- Appearance -------------------------------------------------- */
    out.push(
      {
        id: 'theme:dark',
        section: 'Appearance',
        title: 'Use the dark theme',
        icon: Moon,
        keywords: 'theme appearance night colour scheme',
        run: () => void setTheme('dark'),
      },
      {
        id: 'theme:light',
        section: 'Appearance',
        title: 'Use the light theme',
        icon: Sun,
        keywords: 'theme appearance day colour scheme',
        run: () => void setTheme('light'),
      },
      {
        id: 'theme:system',
        section: 'Appearance',
        title: 'Match the system theme',
        icon: MonitorSmartphone,
        keywords: 'theme appearance auto os colour scheme',
        run: () => void setTheme('system'),
      },
    );

    return out;
  }, [navigate, go, tasks, goals, today, railCollapsed, setRailCollapsed, isMobile]);
}
