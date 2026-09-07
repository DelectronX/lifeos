import { db } from '@/db/db';
import { createDefaultSettings } from '@/db/seed';
import { mergeSchedulingConfig } from '@/config/schedulingConfig';
import type { DeepPartial, SchedulingConfig, Settings, ThemeMode } from '@/types';

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
/* Theme                                                               */
/* ------------------------------------------------------------------ */

/** LocalStorage mirror so the theme paints before IndexedDB opens (no flash). */
export function readCachedTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, mode);
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
