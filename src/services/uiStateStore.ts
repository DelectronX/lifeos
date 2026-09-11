import { db } from '@/db/db';
import { createDefaultSettings } from '@/db/seed';
import type { Settings, ThemeMode } from '@/types';

/**
 * uiStateStore — the synchronous face of `settings.uiState`.
 *
 * Everything in LifeOS must end up inside `data/settings.json`, including the
 * small bits of bookkeeping that used to sit in `localStorage`: the collapsed
 * rail, the command palette's recents, the live timer snapshot, the open paper
 * run, the last maintenance date. Those call sites are synchronous (a zustand
 * store initialiser, a `useState` default) and cannot await Dexie, so this
 * module keeps an in-memory mirror:
 *
 *   boot ──► hydrate() reads settings.uiState once, before the first render
 *   read ──► getUiState(key) is a synchronous Map lookup
 *   write ─► setUiState(key, v) updates the mirror, then debounces one
 *            `db.settings.update(...)`, which trips the Dexie hook and makes
 *            the storage layer rewrite settings.json.
 *
 * The ONLY thing still allowed in localStorage is the theme, and only as a
 * paint-before-boot cache so there is no flash of the wrong colour scheme —
 * the authoritative theme value lives in `settings.theme` like everything else.
 */

const FLUSH_DEBOUNCE_MS = 400;

let mirror: Record<string, unknown> = {};
let theme: ThemeMode | null = null;
let hydrated = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<void> | null = null;

const hydrationListeners = new Set<() => void>();

/** True once {@link hydrateUiState} has run at least once. */
export function isUiStateHydrated(): boolean {
  return hydrated;
}

/**
 * Registers a callback for "the persisted UI state is now available".
 * Fires immediately when hydration already happened, and again after a bundle
 * import replaces the working set. Returns an unsubscribe function.
 */
export function onUiStateHydrated(listener: () => void): () => void {
  hydrationListeners.add(listener);
  if (hydrated) listener();
  return () => hydrationListeners.delete(listener);
}

/** Reads `settings.uiState` into the synchronous mirror. Safe to call twice. */
export async function hydrateUiState(): Promise<void> {
  try {
    const settings = await db.settings.get('settings');
    mirror = { ...((settings?.uiState ?? {}) as Record<string, unknown>) };
    theme = settings?.theme ?? null;
  } catch {
    mirror = {};
    theme = null;
  }
  hydrated = true;
  for (const listener of [...hydrationListeners]) {
    try {
      listener();
    } catch (e) {
      console.warn('[uiState] hydration listener failed', e);
    }
  }
}

export function getUiState<T>(key: string, fallback: T): T {
  const value = mirror[key];
  return value === undefined ? fallback : (value as T);
}

/** Updates the mirror and schedules a write. `undefined` removes the key. */
export function setUiState(key: string, value: unknown): void {
  if (value === undefined) {
    if (!(key in mirror)) return;
    delete mirror[key];
  } else {
    if (Object.is(mirror[key], value)) return;
    mirror[key] = value;
  }
  schedule();
}

/** The theme as stored in settings.json, or null before hydration. */
export function getPersistedTheme(): ThemeMode | null {
  return theme;
}

/** Writes the theme into settings.json (debounced with the rest of uiState). */
export function persistTheme(mode: ThemeMode): void {
  if (theme === mode) return;
  theme = mode;
  schedule();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushUiState();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Writes the mirror into the settings row. Awaited by tests and by the
 * before-unload path, so nothing typed in the last half second is lost.
 */
export async function flushUiState(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) return pending;

  const uiState = { ...mirror };
  const mode = theme;

  pending = (async () => {
    try {
      const changes: Partial<Settings> = { uiState, updatedAt: Date.now() };
      if (mode) changes.theme = mode;
      const updated = await db.settings.update('settings', changes);
      if (updated === 0) {
        const fresh = createDefaultSettings();
        await db.settings.put({ ...fresh, ...(mode ? { theme: mode } : {}), uiState });
      }
    } catch (e) {
      console.warn('[uiState] could not persist UI state', e);
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/** Test seam: drops the mirror so a fresh hydrate starts from nothing. */
export function resetUiStateForTests(): void {
  mirror = {};
  theme = null;
  hydrated = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
