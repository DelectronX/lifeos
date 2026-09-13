import { Capacitor } from '@capacitor/core';
import type { ResolvedTheme } from './theme';

/**
 * Thin, safe wrapper around Capacitor native plugins.
 *
 * Every call here is guarded by `Capacitor.isNativePlatform()`, which returns
 * `false` in the plain browser (dev server, Vite build, any desktop use of
 * the app) — so importing `@capacitor/*` packages never crashes or changes
 * behaviour outside of an actual iOS/Android WebView. No native platform is
 * registered in this repo yet (see PROGRESS.md), so today these are all
 * no-ops; they activate automatically once `npx cap add ios` is run on a Mac
 * and the plugins are linked.
 *
 * TODO for later feature waves (see PROGRESS.md → iOS/Capacitor readiness):
 *  - @capacitor/filesystem: back the file-attachment/PDF-viewer storage with
 *    native file access instead of (or alongside) IndexedDB blobs.
 *  - @capacitor/preferences: only for tiny OS-level flags if ever needed
 *    (NOT bulk data — the app's own JSON/IndexedDB layer stays authoritative).
 *  - @capacitor/haptics: light haptic feedback on task completion / timer end.
 *  - @capacitor/share: share exported JSON bundles via the iOS share sheet.
 *  - @capacitor/app: handle app-state (background/foreground) to pause/resume
 *    timers accurately — coordinate with whoever owns timerService.ts.
 */
export const isNativePlatform = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** Keeps the native iOS/Android status bar in sync with the app's theme. */
export async function syncStatusBarTheme(theme: ResolvedTheme): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({
      color: theme === 'dark' ? '#0B0D10' : '#F1F3F6',
    });
  } catch {
    /* No status bar plugin bridge available (e.g. Android without it, or
       running in a browser tab that reports native for some reason) — never
       let this crash the app. */
  }
}
