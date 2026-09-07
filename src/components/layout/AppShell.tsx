import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3, CalendarDays, CheckSquare, Home, ListTodo, Menu, Moon,
  RotateCcw, Settings as SettingsIcon, Sun, Target, Timer, Trophy, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLiveProfile, useLiveSettings } from '@/state/useLiveData';
import { levelProgress } from '@/engines/xp';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { setTheme } from '@/services/settingsService';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  /** Shown in the compact mobile tab bar. */
  mobile?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, mobile: true },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays, mobile: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, mobile: true },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/focus', label: 'Focus', icon: Timer, mobile: true },
  { to: '/revision', label: 'Revision', icon: RotateCcw },
  { to: '/trackers', label: 'Trackers', icon: CheckSquare },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const profile = useLiveProfile();
  const settings = useLiveSettings();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const xpConfig = mergeSchedulingConfig(settings?.scheduling).xp;
  const lp = profile ? levelProgress(profile.totalXP, xpConfig) : null;

  return (
    <div className="flex h-full min-h-screen bg-surface-sunken">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => <NavRow key={item.to} item={item} />)}
        </nav>
        {lp ? <LevelFooter level={lp.level} progress={lp.progress} into={lp.into} span={lp.span} /> : null}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col border-r border-line bg-surface animate-in-fade">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
              {NAV.map((item) => <NavRow key={item.to} item={item} />)}
            </nav>
            {lp ? <LevelFooter level={lp.level} progress={lp.progress} into={lp.into} span={lp.span} /> : null}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:hidden">
          <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold tracking-[-0.01em]">LifeOS</span>
          <div className="flex-1" />
          <ThemeToggle />
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Mobile bottom bar: Today / Schedule / Tasks / Focus */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-stretch border-t border-line bg-surface/95 backdrop-blur-md lg:hidden">
          {NAV.filter((n) => n.mobile).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-ink-faint',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 px-5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white dark:text-slate-950">
        L
      </div>
      <div className="text-sm font-semibold tracking-[-0.012em] text-ink">LifeOS</div>
      <div className="flex-1" />
      <div className="hidden lg:block"><ThemeToggle /></div>
    </div>
  );
}

function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150 ease-calm',
          isActive
            ? 'bg-accent-soft text-accent-ink'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );
}

function LevelFooter({ level, progress, into, span }: { level: number; progress: number; into: number; span: number }) {
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="t-label">Level {level}</span>
        <span className="t-num text-2xs text-ink-faint">{Math.round(into)} / {Math.round(span)} XP</span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-calm" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function ThemeToggle() {
  const settings = useLiveSettings();
  const isDark = document.documentElement.classList.contains('dark');
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      title={`Theme: ${settings?.theme ?? 'system'}`}
      onClick={() => void setTheme(isDark ? 'light' : 'dark')}
      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
