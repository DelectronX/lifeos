import { useCallback, useEffect, useState } from 'react';
import { getPersistedTheme, onUiStateHydrated, persistTheme } from '@/services/uiStateStore';
import type { ThemeMode } from '@/types';

/**
 * Theme control for the LifeOS shell.
 *
 * Contract:
 *  - DARK IS THE DEFAULT. A user with no stored preference gets dark.
 *  - The resolved theme is expressed as the `dark` class on <html>, which is
 *    also written statically in index.html and re-asserted by the inline
 *    pre-paint script, so there is never a flash of the wrong theme.
 *  - The choice is PERSISTED IN `settings.theme`, and therefore inside
 *    `data/settings.json` along with everything else. localStorage holds a
 *    copy under `lifeos.theme` for exactly one reason: the pre-paint script in
 *    index.html has to decide the colour scheme synchronously, long before
 *    IndexedDB or the JSON files are open. That cache is written, never
 *    trusted over the file value once storage has booted.
 */

const STORAGE_KEY = 'lifeos.theme';

export type ResolvedTheme = 'dark' | 'light';

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'dark' || v === 'light' || v === 'system';
}

/**
 * The stored preference. `settings.theme` (i.e. settings.json) wins when the
 * storage layer has hydrated; the localStorage cache is only the pre-boot
 * stand-in, and `dark` is the default when neither has an answer.
 */
export function readThemeMode(): ThemeMode {
  const persisted = getPersistedTheme();
  if (isThemeMode(persisted)) return persisted;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'dark';
  } catch {
    return 'dark';
  }
}

export function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light';
  return mode;
}

/** Writes the resolved theme to the document. Safe to call repeatedly. */
export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  // The durable copy — this is what lands in data/settings.json.
  persistTheme(mode);
  try {
    // Pre-paint cache only. Never read in preference to settings.json.
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode — the DOM class is still correct for this session */
  }
  return resolved;
}

export interface ThemeController {
  /** The user's preference: dark | light | system. */
  mode: ThemeMode;
  /** What that preference currently resolves to. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Flip between dark and light, pinning the result (never lands on system). */
  toggle: () => void;
}

/**
 * @example
 * const { mode, resolved, setMode, toggle } = useTheme();
 * <SegmentedControl value={mode} onChange={setMode} items={[...]} />
 */
export function useTheme(): ThemeController {
  const [mode, setModeState] = useState<ThemeMode>(() => readThemeMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemeMode()));

  // Apply on mount and whenever the preference changes.
  useEffect(() => {
    setResolved(applyThemeMode(mode));
  }, [mode]);

  // Follow the OS when the preference is `system`.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = () => setResolved(applyThemeMode('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // Adopt the value from settings.json as soon as storage finishes hydrating,
  // so a bundle imported from another device brings its theme with it.
  useEffect(() => onUiStateHydrated(() => {
    const persisted = getPersistedTheme();
    if (persisted) setModeState(persisted);
  }), []);

  // Stay in sync with other tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = isThemeMode(e.newValue) ? e.newValue : 'dark';
      setModeState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setResolved(applyThemeMode(next));
  }, []);

  const toggle = useCallback(() => {
    setMode(resolveTheme(readThemeMode()) === 'dark' ? 'light' : 'dark');
  }, [setMode]);

  return { mode, resolved, setMode, toggle };
}
