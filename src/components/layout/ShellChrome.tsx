import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, LayoutGrid, Search, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SaveIndicator } from '@/components/system/SaveIndicator';
import { NotificationBell } from '@/components/system/NotificationCenter';
import { Tooltip } from '@/components/ui/Tooltip';
import { useUiMode } from '@/lib/uiMode';
import { modKeyLabel } from '@/lib/platform';
import { Notch, notchRestMax } from '@/features/schedule/NowStrip';
import { NAV_DESTINATIONS, dockItemsFor, navGroupsFor, type NavDestination } from './navigation';
import { useShell } from './ShellContext';
import { BrandMark } from './BrandMark';
import { Clock } from './WindowChrome';
import { levelProgress } from '@/engines/xp';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import { useLiveProfile, useLiveSettings } from '@/state/useLiveData';

const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';

function destinationFor(pathname: string): NavDestination | undefined {
  if (pathname === '/') return NAV_DESTINATIONS.find((d) => d.to === '/');
  let best: NavDestination | undefined;
  for (const d of NAV_DESTINATIONS) {
    if (d.to === '/') continue;
    if ((pathname === d.to || pathname.startsWith(`${d.to}/`)) && (!best || d.to.length > best.to.length)) best = d;
  }
  return best;
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(window.innerWidth)); };
    window.addEventListener('resize', on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on); };
  }, []);
  return w;
}

const iconBtn = 'touch-hit pressable grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-ink-muted transition-colors hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

/**
 * AppHeader — one compact floating bar.
 *   left    brand · breadcrumb (module › detail)
 *   centre  the Notch (live activity), pinned to the viewport axis
 *   right   date & time · save state · search · notifications · settings
 * The side columns are capped to the room the notch leaves, so nothing can
 * overlap at any width; low-priority items drop out first.
 */
export function AppHeader() {
  const { pathname } = useLocation();
  const { openCommandPalette } = useShell();
  const vw = useViewportWidth();
  const dest = destinationFor(pathname);
  const isDetail = !!dest && dest.to !== '/' && pathname !== dest.to;
  const side = `calc(50% - ${Math.round(notchRestMax(vw) / 2)}px - 14px)`;

  return (
    <header className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-40 h-12" role="banner">
      <div className="glass relative flex h-full items-center rounded-[16px] px-2">
        {/* Left: identity + breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2" style={{ maxWidth: side }}>
          <Link to="/" aria-label="Home" className="pressable shrink-0 rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <BrandMark className="h-8 w-8" />
          </Link>
          <ol className="flex min-w-0 items-center gap-1 text-[0.8125rem]">
            <li className="hidden shrink-0 font-medium text-ink-faint md:block">LifeOS</li>
            {dest ? (
              <>
                <li aria-hidden className="hidden text-ink-faint md:block"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li className="min-w-0 truncate">
                  {isDetail ? (
                    <Link to={dest.to} className="font-medium text-ink-muted hover:text-ink">{dest.label}</Link>
                  ) : (
                    <span aria-current="page" className="font-semibold text-ink">{dest.label}</span>
                  )}
                </li>
                {isDetail ? (
                  <>
                    <li aria-hidden className="text-ink-faint"><ChevronRight className="h-3.5 w-3.5" /></li>
                    <li aria-current="page" className="min-w-0 truncate font-semibold text-ink">Details</li>
                  </>
                ) : null}
              </>
            ) : null}
          </ol>
        </nav>

        {/* Right: status + controls */}
        <div className="ml-auto flex min-w-0 items-center justify-end gap-0.5" style={{ maxWidth: side }}>
          {vw >= 1100 ? <Clock className="mr-1 whitespace-nowrap px-1.5 text-[0.8125rem]" withDate /> : null}
          {vw >= 900 ? <SaveIndicator className="mr-1 flex" /> : null}
          <Tooltip label={`Search  ${modKeyLabel()}K`}>
            <button type="button" aria-label="Search" onClick={() => openCommandPalette()} className={iconBtn}>
              <Search className="h-[1.0625rem] w-[1.0625rem]" />
            </button>
          </Tooltip>
          <NotificationBell />
          {vw >= 400 ? <HeaderIdentity /> : null}
          {vw >= 520 ? (
            <Tooltip label="Settings">
              <Link to="/settings" aria-label="Settings" className={iconBtn}>
                <SettingsIcon className="h-[1.0625rem] w-[1.0625rem]" />
              </Link>
            </Tooltip>
          ) : null}
        </div>

        {/* Centre: the Notch, on the viewport axis (not affected by side widths). */}
        <div className="pointer-events-none absolute left-1/2 top-1 flex -translate-x-1/2 justify-center">
          <Notch />
        </div>
      </div>
    </header>
  );
}

/**
 * Identity: avatar with a level ring (progress through the current level).
 * Links to achievements, where XP, level and rewards live.
 */
function HeaderIdentity() {
  const profile = useLiveProfile();
  const settings = useLiveSettings();
  const xpConfig = mergeSchedulingConfig(settings?.scheduling).xp;
  const lp = profile ? levelProgress(profile.totalXP, xpConfig) : null;
  const name = profile?.displayName?.trim() || 'You';
  const initial = name.slice(0, 1).toUpperCase() || 'Y';
  const streak = profile?.currentStreak ?? 0;
  const R = 13, C = 2 * Math.PI * R;
  return (
    <Tooltip label={name} hint={lp ? `Lv ${lp.level} · ${lp.into}/${lp.span} XP${streak ? ` · ${streak}d streak` : ''}` : undefined}>
      <Link to="/achievements" aria-label={`${name}${lp ? `, level ${lp.level}, ${Math.round(lp.progress * 100)}% to next` : ''}`}
        className="pressable relative ml-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="16" cy="16" r={R} fill="none" stroke="rgb(var(--c-ink) / 0.12)" strokeWidth="2.5" />
          {lp ? <circle cx="16" cy="16" r={R} fill="none" stroke="rgb(var(--c-accent))" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - lp.progress)} style={{ transition: 'stroke-dashoffset 900ms var(--ease-out)' }} /> : null}
        </svg>
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-surface-sunken text-[0.6875rem] font-semibold text-ink">{initial}</span>
      </Link>
    </Tooltip>
  );
}

/**
 * Dock — the floating navigation bar at the bottom of every screen.
 * Centred by a non-animated full-width row (so no entrance animation can
 * disturb the centring), capped to the viewport, scrolls as a last resort.
 * Active item: an illuminated well that slides between items + an accent
 * marker. Wide screens pin more destinations than phones.
 */
export function Dock({ launcherOpen, onLauncher }: { launcherOpen: boolean; onLauncher: () => void }) {
  const { pathname } = useLocation();
  const { advanced } = useUiMode();
  const vw = useViewportWidth();
  const ref = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const items = dockItemsFor(vw >= 1024, advanced);
  const inDock = items.some((d) => (d.to === '/' ? pathname === '/' : pathname === d.to || pathname.startsWith(`${d.to}/`)));
  const compact = vw < 480;

  useLayoutEffect(() => {
    const el = launcherOpen || !inDock
      ? ref.current?.querySelector<HTMLElement>('[data-dock-more]')
      : ref.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [pathname, launcherOpen, inDock, items.length, vw]);

  const item = cn(
    'pressable group relative z-[1] flex h-12 shrink-0 flex-col items-center justify-center gap-[3px] rounded-[13px] font-medium tracking-[0.01em] transition-colors duration-base',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
    compact ? 'w-[3.6rem] text-[0.625rem]' : 'w-[4.25rem] text-[0.6875rem]',
  );
  const icon = 'h-[1.25rem] w-[1.25rem] transition-transform duration-base group-active:scale-90';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.625rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-2">
      <nav ref={ref} aria-label="Primary"
        className="glass pointer-events-auto relative flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[18px] p-1 scrollbar-none animate-launch">
        {pill ? (
          <span aria-hidden className="glass-pill pointer-events-none absolute top-1 h-12 rounded-[13px]"
            style={{ left: pill.left, width: pill.width, transition: `left 380ms ${SPRING}, width 380ms ${SPRING}` }}>
            <span className="absolute left-1/2 top-0 h-[2px] w-5 -translate-x-1/2 rounded-full bg-accent" />
          </span>
        ) : null}
        {items.map((d) => {
          const Icon = d.icon;
          return (
            <NavLink key={d.to} to={d.to} end={d.to === '/'} aria-label={d.label}
              title={d.shortcut ? `${d.label}  ${modKeyLabel()}${d.shortcut}` : d.label}
              className={({ isActive }) => cn(item, isActive && !launcherOpen ? 'text-ink' : 'text-ink-faint hover:text-ink-muted')}>
              {({ isActive }) => (
                <>
                  <Icon className={cn(icon, isActive && !launcherOpen && 'text-accent-ink')} strokeWidth={isActive ? 2.1 : 1.8} />
                  <span className="max-w-full truncate px-0.5">{d.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        <span className="mx-0.5 h-7 w-px shrink-0 bg-ink/10" aria-hidden />
        <button type="button" data-dock-more onClick={onLauncher} aria-expanded={launcherOpen} aria-haspopup="dialog"
          title={`All apps  ${modKeyLabel()}\\`}
          className={cn(item, launcherOpen || !inDock ? 'text-ink' : 'text-ink-faint hover:text-ink-muted')}>
          <LayoutGrid className={cn(icon, (launcherOpen || !inDock) && 'text-accent-ink')} strokeWidth={1.9} />
          {inDock || launcherOpen ? 'Apps' : (destinationFor(pathname)?.label ?? 'Apps')}
        </button>
      </nav>
    </div>
  );
}

/**
 * Launcher — every destination, grouped, searchable (Enter opens the first
 * match), with the Simple / Advanced switch. Opaque panels: no blur cost.
 */
export function Launcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { advanced, setMode } = useUiMode();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setQ('');
    const t = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 40);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;
  const needle = q.trim().toLowerCase();
  const groups = navGroupsFor(advanced)
    .map((g) => ({ ...g, items: g.items.filter((d) => !needle || `${d.label} ${d.keywords ?? ''}`.toLowerCase().includes(needle)) }))
    .filter((g) => g.items.length);
  // Enter opens the best match: label prefix > label contains > keyword match.
  const score = (d: NavDestination) => {
    const l = d.label.toLowerCase();
    return l.startsWith(needle) ? 3 : l.includes(needle) ? 2 : 1;
  };
  const first = needle
    ? groups.flatMap((g) => g.items).reduce<NavDestination | undefined>((best, d) => (!best || score(d) > score(best) ? d : best), undefined)
    : groups[0]?.items[0];

  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="All apps">
      <div className="absolute inset-0 bg-black/70 animate-fade [:root:not(.dark)_&]:bg-white/80" onClick={onClose} aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-[5.75rem] top-[4.25rem] flex justify-center px-3">
        <div className="pointer-events-auto flex min-h-0 w-full max-w-[52rem] flex-col">
          <div className="panel mx-auto flex h-11 w-full max-w-md shrink-0 items-center gap-2.5 rounded-[14px] px-3.5 animate-in-pop">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to…" aria-label="Search apps"
              onKeyDown={(e) => { if (e.key === 'Enter' && first) navigate(first.to); }}
              className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink placeholder:text-ink-faint focus:outline-none" />
            <kbd className="hidden rounded-[6px] bg-ink/[0.07] px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-faint sm:block">esc</kbd>
          </div>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1 scrollbar-none">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g, gi) => (
                <section key={g.label} className="panel rounded-[18px] p-2 animate-launch" style={{ animationDelay: `${gi * 30}ms` }}>
                  <div className="px-2.5 pb-1.5 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">{g.label}</div>
                  <ul>
                    {g.items.map((d) => {
                      const Icon = d.icon;
                      const active = d.to === '/' ? pathname === '/' : pathname === d.to || pathname.startsWith(`${d.to}/`);
                      return (
                        <li key={d.to}>
                          <NavLink to={d.to} end={d.to === '/'}
                            className={cn('pressable group flex h-10 items-center gap-3 rounded-[11px] px-2.5 text-[0.875rem] transition-colors',
                              active ? 'bg-ink/[0.08] font-semibold text-ink' : 'text-ink-muted hover:bg-ink/[0.05] hover:text-ink')}>
                            <Icon className={cn('h-[1.0625rem] w-[1.0625rem] shrink-0', active ? 'text-accent-ink' : 'text-ink-faint group-hover:text-ink-muted')} />
                            <span className="min-w-0 flex-1 truncate">{d.label}</span>
                            {d.shortcut ? <span className="text-[0.6875rem] text-ink-faint">{modKeyLabel()}{d.shortcut}</span> : null}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            {groups.length === 0 ? <p className="mt-10 text-center text-[0.875rem] text-ink-faint">Nothing matches “{q}”.</p> : null}
          </div>
          <div className="panel mx-auto mt-3 flex shrink-0 items-center gap-1 rounded-[13px] p-1 animate-in-pop" role="radiogroup" aria-label="Interface mode">
            {(['simple', 'advanced'] as const).map((m) => {
              const on = (m === 'advanced') === advanced;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} onClick={() => void setMode(m)}
                  className={cn('pressable h-8 rounded-[10px] px-4 text-[0.8125rem] font-semibold transition-colors', on ? 'bg-ink text-surface-base' : 'text-ink-muted hover:text-ink')}>
                  {m === 'simple' ? 'Simple' : 'Advanced'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
