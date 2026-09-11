import { useCallback, useEffect, useState } from 'react';
import type { ThemeMode } from '@/types';

/**
 * Theme control for the LifeOS shell.
 *
 * Contract:
 *  - DARK IS THE DEFAULT. A user with no stored preference gets dark.
 *  - The resolved theme is expressed as the `dark` class on <html>, which is
 *    also written statically in index.html and re-asserted by the inline
 *    pre-paint script, so there is never a flash of the wrong theme.
 *  - The choice persists to localStorage under `lifeos.theme`, the same key
 *    the settings service mirrors, so the Settings page and this hook agree.
 */

const STORAGE_KEY = 'lifeos.theme';

export type ResolvedTheme = 'dark' | 'light';

function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'dark' || v === 'light' || v === 'system';
}

/** The stored preference, defaulting to `dark` when nothing is stored. */
export function readThemeMode(): ThemeMode {
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
  try {
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

  // Stay in sync with other tabs and with the Settings page's service call.
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
