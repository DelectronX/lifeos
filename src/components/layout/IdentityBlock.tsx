import { Link } from 'react-router-dom';
import { Flame, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { levelProgress } from '@/engines/xp';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { useLiveProfile, useLiveSettings } from '@/state/useLiveData';
import { setTheme } from '@/services/settingsService';

/**
 * IdentityBlock — the rail's pinned footer.
 *
 * Avatar, display name, and a level / XP line with a hairline-thin progress
 * track. Collapsed, it becomes just the avatar with the level as a tooltip.
 */
export function IdentityBlock({ collapsed }: { collapsed: boolean }) {
  const profile = useLiveProfile();
  const settings = useLiveSettings();
  const xpConfig = mergeSchedulingConfig(settings?.scheduling).xp;
  const lp = profile ? levelProgress(profile.totalXP, xpConfig) : null;

  const name = profile?.displayName?.trim() || 'You';
  const initials = name.trim().slice(0, 1).toUpperCase() || 'Y';
  const streak = profile?.currentStreak ?? 0;

  const isDark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark');
  const nextTheme = isDark ? 'light' : 'dark';

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-3">
        <Tooltip
          label={name}
          hint={lp ? `Lv ${lp.level}` : undefined}
          side="right"
        >
          <Link
            to="/settings"
            aria-label={`${name}${lp ? `, level ${lp.level}` : ''} — open settings`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-raised text-xs font-semibold text-ink-muted transition-colors duration-base ease-calm hover:border-line-strong hover:text-ink"
          >
            {initials}
          </Link>
        </Tooltip>
        <Tooltip label={`Switch to ${nextTheme} theme`} side="right">
          <button
            type="button"
            aria-label={`Switch to ${nextTheme} theme`}
            onClick={() => void setTheme(nextTheme)}
            className="rounded-[var(--r-sm)] p-1.5 text-ink-faint transition-colors duration-base ease-calm hover:bg-surface-raised hover:text-ink"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-xs font-semibold text-ink-muted"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8125rem] font-medium leading-tight text-ink">{name}</div>
          <div className="t-meta t-num mt-0.5 flex items-center gap-1.5 leading-tight">
            {lp ? <span>Level {lp.level}</span> : <span>Getting started</span>}
            {streak > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-caution">
                <Flame className="h-3 w-3" aria-hidden />
                {streak}
              </span>
            ) : null}
          </div>
        </div>
        <Tooltip label={`Switch to ${nextTheme} theme`} side="top">
          <button
            type="button"
            aria-label={`Switch to ${nextTheme} theme`}
            onClick={() => void setTheme(nextTheme)}
            className="rounded-[var(--r-sm)] p-1.5 text-ink-faint transition-colors duration-base ease-calm hover:bg-surface-raised hover:text-ink"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
        <Tooltip label="Settings" side="top">
          <Link
            to="/settings"
            aria-label="Settings"
            className="rounded-[var(--r-sm)] p-1.5 text-ink-faint transition-colors duration-base ease-calm hover:bg-surface-raised hover:text-ink"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
          </Link>
        </Tooltip>
      </div>

      {lp ? (
        <div className="mt-2.5">
          <div
            className="h-[3px] w-full overflow-hidden rounded-full bg-line-faint"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(lp.progress * 100)}
            aria-label={`Level ${lp.level} progress`}
          >
            <div
              className={cn('h-full rounded-full bg-accent transition-[width] duration-slow ease-calm')}
              style={{ width: `${Math.min(100, Math.max(2, lp.progress * 100))}%` }}
            />
          </div>
          <div className="t-meta t-num mt-1.5 flex justify-between">
            <span>{Math.round(lp.into)} XP</span>
            <span>{Math.round(lp.span)} to next</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
