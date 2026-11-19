import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette } from '@/components/system/CommandPalette';
import { BundleDropZone } from '@/components/system/SaveIndicator';
import { hasModKey, isTypingTarget, useIsMobile } from '@/lib/platform';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/cn';
import { AppHeader, Dock, Launcher } from './ShellChrome';
import { NotificationCenter } from '@/components/system/NotificationCenter';
import { StageBackground } from './StageBackground';
import { useContentScrolled } from './WindowChrome';
import { ShellContext, type ShellContextValue } from './ShellContext';
import { NAV_DESTINATIONS, moduleTitleFor } from './navigation';
import { useSpaceName } from '@/state/useLiveData';


/**
 * AppShell — the LifeOS stage.
 *
 * Two layers, per HIG › Liquid Glass:
 *   content    one centred column that scrolls under everything, over a
 *              quiet ambient field so the glass has something to refract;
 *   functional floating Liquid Glass: the sidebar (regular+), the notch
 *              (top centre), title and status clusters, and the dock on
 *              compact widths. Nothing is pinned to the window edges.
 *
 * Keyboard: ⌘K palette · ⌘\ apps launcher · ⌘1…9 destinations · / search.
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [launcherOpen, setLauncherOpen] = useState(false);
  // The sidebar is gone; kept in context for older consumers.
  const railCollapsed = true;
  const setRailCollapsed = useCallback((_v: boolean) => undefined, []);
  const closeLauncher = useCallback(() => setLauncherOpen(false), []);

  useTheme();

  const openCommandPalette = useCallback((query = '') => { setPaletteQuery(query); setPaletteOpen(true); }, []);
  const closeCommandPalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    setLauncherOpen(false);
    document.getElementById('lo-content')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = hasModKey(e);
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (mod && e.key === '\\') { e.preventDefault(); setLauncherOpen((v) => !v); return; }
      if (mod && /^[1-9]$/.test(e.key)) {
        const dest = NAV_DESTINATIONS.find((d) => d.shortcut === e.key);
        if (dest) { e.preventDefault(); navigate(dest.to); }
        return;
      }
      if (e.key === '/' && !mod && !isTypingTarget(e.target)) { e.preventDefault(); openCommandPalette(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, openCommandPalette]);

  const title = useMemo(() => moduleTitleFor(location.pathname), [location.pathname]);
  const spaceName = useSpaceName();
  useEffect(() => { document.title = title === 'Home' ? spaceName : `${title} — ${spaceName}`; }, [title, spaceName]);

  const ctx: ShellContextValue = useMemo(() => ({
    openCommandPalette, closeCommandPalette, commandPaletteOpen: paletteOpen, railCollapsed, setRailCollapsed, isMobile,
  }), [openCommandPalette, closeCommandPalette, paletteOpen, railCollapsed, setRailCollapsed, isMobile]);

  return (
    <ShellContext.Provider value={ctx}>
      <StageBackground />

      {/* Content layer: the only scroller. Gutters clear the header (top) and dock (bottom). */}
      <main
        id="lo-content"
        className="fixed inset-0 z-10 overflow-y-auto overflow-x-hidden overscroll-y-contain pl-safe pr-safe"
        style={{
          paddingTop: 'calc(max(0.5rem, env(safe-area-inset-top)) + 3rem + 1rem)',
          paddingBottom: 'calc(max(0.625rem, env(safe-area-inset-bottom)) + 3.5rem + 2.5rem)',
        }}
      >
        <div key={location.pathname} className="route-enter">
          <Outlet />
        </div>
      </main>

      <ScrollEdge />
      <ScrollEdgeBottom />

      <AppHeader />
      <Launcher open={launcherOpen} onClose={closeLauncher} />
      <Dock launcherOpen={launcherOpen} onLauncher={() => setLauncherOpen((v) => !v)} />
      <NotificationCenter />

      <CommandPalette open={paletteOpen} onClose={closeCommandPalette} initialQuery={paletteQuery} />
      <BundleDropZone />
    </ShellContext.Provider>
  );
}

/** Bottom scroll edge: content fades as it slides under the dock. */
function ScrollEdgeBottom() {
  return <div aria-hidden className="scroll-edge-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 h-24" />;
}

/** Top scroll edge: content fades under the header once scrolled. */
function ScrollEdge() {
  const scrolled = useContentScrolled(8);
  return (
    <div
      aria-hidden
      className={cn('scroll-edge-top pointer-events-none fixed inset-x-0 top-0 z-30 h-20 transition-opacity duration-slow', scrolled ? 'opacity-100' : 'opacity-0')}
    />
  );
}
