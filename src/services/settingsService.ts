import { db } from '@/db/db';
import { createDefaultSettings } from '@/db/seed';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import {
  flushUiState, getPersistedTheme, persistTheme, setUiState as setUiStateSync,
} from './uiStateStore';
import {
  DEFAULT_STORAGE_PREFERENCES,
  type DashboardWidgetConfig,
  type DeepPartial, type SchedulingConfig, type Settings, type StoragePreferences, type ThemeMode,
} from '@/types';

const THEME_KEY = 'lifeos.theme';

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('settings');
  if (existing) return existing;
  const fresh = createDefaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.settings.update('settings', { ...patch, updatedAt: Date.now() });
}

/** Resolved scheduling config = defaults merged with the user's overrides. */
export async function getSchedulingConfig(): Promise<SchedulingConfig> {
  const settings = await getSettings();
  return mergeSchedulingConfig(settings.scheduling);
}

export async function updateSchedulingConfig(patch: DeepPartial<SchedulingConfig>): Promise<void> {
  const settings = await getSettings();
  await db.settings.update('settings', {
    scheduling: mergeDeep(settings.scheduling ?? {}, patch),
    updatedAt: Date.now(),
  });
}

function mergeDeep(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) {
      out[k] = mergeDeep(a[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Home dashboard layout                                               */
/* ------------------------------------------------------------------ */

export async function getDashboardLayout(): Promise<DashboardWidgetConfig[]> {
  const settings = await getSettings();
  return settings.dashboardLayout ?? [];
}

export async function setDashboardLayout(layout: DashboardWidgetConfig[]): Promise<void> {
  await updateSettings({ dashboardLayout: layout });
}

/* ------------------------------------------------------------------ */
/* Storage preferences (persisted into data/settings.json)             */
/* ------------------------------------------------------------------ */

export async function getStoragePreferences(): Promise<Required<StoragePreferences>> {
  const settings = await getSettings();
  return { ...DEFAULT_STORAGE_PREFERENCES, ...(settings.storage ?? {}) };
}

export async function updateStoragePreferences(patch: Partial<StoragePreferences>): Promise<void> {
  const current = await getStoragePreferences();
  await updateSettings({ storage: { ...current, ...patch } });
}

/* ------------------------------------------------------------------ */
/* Small UI bookkeeping                                                */
/* ------------------------------------------------------------------ */

/**
 * Values that used to be individual localStorage keys now live in
 * `settings.uiState`, so they travel with an export and land in
 * `data/settings.json` like everything else. localStorage remains only as the
 * theme's paint-before-boot cache.
 *
 * The synchronous mirror in {@link module:services/uiStateStore} is the entry
 * point most call sites use (zustand initialisers and `useState` defaults
 * cannot await Dexie). These async wrappers exist for code that is already in
 * an async context and wants a guaranteed-fresh read.
 */
export async function getUiState<T>(key: string, fallback: T): Promise<T> {
  const settings = await getSettings();
  const value = settings.uiState?.[key];
  return value === undefined ? fallback : (value as T);
}

export async function setUiState(key: string, value: unknown): Promise<void> {
  setUiStateSync(key, value);
  await flushUiState();
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

/**
 * The theme to paint with right now.
 *
 * Authoritative source: `settings.theme` (→ `data/settings.json`), read from
 * the hydrated mirror. The localStorage copy is consulted only before storage
 * has booted, purely so the first paint is not the wrong colour scheme — it is
 * the single sanctioned use of localStorage left in the app.
 */
export function readCachedTheme(): ThemeMode {
  const persisted = getPersistedTheme();
  if (persisted === 'light' || persisted === 'dark' || persisted === 'system') return persisted;
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  persistTheme(mode);
  try {
    localStorage.setItem(THEME_KEY, mode); // pre-paint cache only
  } catch { /* private mode */ }
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  applyTheme(mode);
  await updateSettings({ theme: mode });
}

/** Re-applies the theme when the OS preference changes and mode is `system`. */
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const handler = () => { if (getMode() === 'system') applyTheme('system'); };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
