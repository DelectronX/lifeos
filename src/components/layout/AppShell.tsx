import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette } from '@/components/system/CommandPalette';
import { BundleDropZone } from '@/components/system/SaveIndicator';
import { hasModKey, isTypingTarget, useIsMobile, usePersistentState } from '@/lib/platform';
import { useTheme } from '@/lib/theme';
import { SidebarRail } from './SidebarRail';
import { IdentityBlock } from './IdentityBlock';
import { WindowChrome } from './WindowChrome';
import { MobileMoreSheet, MobileTabBar, MobileTopBar } from './MobileShell';
import { ShellContext, type ShellContextValue } from './ShellContext';
import { NAV_DESTINATIONS, moduleTitleFor } from './navigation';

/**
 * AppShell — the LifeOS window.
 *
 * Desktop: a navigation rail (collapsible to icon-only), a slim window-chrome
 * top bar, and an inset content region. Mobile (<lg): a compact top bar and a
 * bottom tab bar with a More sheet — a genuinely different layout, not a
 * narrowed desktop.
 *
 * Global keyboard:
 *   ⌘K / Ctrl K   command palette
 *   ⌘\ / Ctrl \   collapse / expand the rail
 *   ⌘1…4          jump to the first four destinations
 *   /             focus the palette (when not typing)
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [railCollapsedRaw, setRailCollapsedRaw] = usePersistentState('rail.collapsed', false);
  const railCollapsed = railCollapsedRaw;
  // `usePersistentState` returns a fresh setter each render; pin it through a
  // ref so the shell context and the global key handler stay referentially
  // stable and the keydown listener is not re-registered on every render.
  const setterRef = useRef(setRailCollapsedRaw);
  setterRef.current = setRailCollapsedRaw;
  const setRailCollapsed = useCallback((v: boolean) => setterRef.current(v), []);

  // Mount the theme system: reads the persisted preference, follows the OS in
  // `system` mode, and keeps <html class="dark"> authoritative.
  useTheme();

  const openCommandPalette = useCallback((query = '') => {
    setPaletteQuery(query);
    setPaletteOpen(true);
  }, []);
  const closeCommandPalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = hasModKey(e);

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        setRailCollapsed(!railCollapsed);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const dest = NAV_DESTINATIONS.find((d) => d.shortcut === e.key);
        if (dest) {
          e.preventDefault();
          navigate(dest.to);
        }
        return;
      }
      if (e.key === '/' && !mod && !isTypingTarget(e.target)) {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, openCommandPalette, railCollapsed, setRailCollapsed]);

  const title = useMemo(() => moduleTitleFor(location.pathname), [location.pathname]);

  const ctx: ShellContextValue = useMemo(
    () => ({
      openCommandPalette,
      closeCommandPalette,
      commandPaletteOpen: paletteOpen,
      railCollapsed,
      setRailCollapsed,
      isMobile,
    }),
    [openCommandPalette, closeCommandPalette, paletteOpen, railCollapsed, setRailCollapsed, isMobile],
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-full min-h-screen bg-surface-base">
        <SidebarRail identity={<IdentityBlock collapsed={railCollapsed} />} />

        <div className="flex min-w-0 flex-1 flex-col">
          {isMobile ? <MobileTopBar title={title} /> : <WindowChrome title={title} />}

          {/* Inset content region: a sunken well one luminance step below chrome. */}
          <main
            id="lo-content"
            className="min-w-0 flex-1 overflow-y-auto bg-surface-base pb-24 lg:pb-0"
          >
            <div key={location.pathname} className="animate-fade">
              <Outlet />
            </div>
          </main>

          {isMobile ? (
            <>
              <MobileTabBar moreOpen={moreOpen} onMore={() => setMoreOpen((v) => !v)} />
              <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
            </>
          ) : null}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={closeCommandPalette}
        initialQuery={paletteQuery}
      />

      {/* Drop a lifeos.json anywhere to restore it — the other half of manual mode. */}
      <BundleDropZone />
    </ShellContext.Provider>
  );
}
