import { MINUTE_MS } from '@/lib/date';
import { getSettings } from './settingsService';
import type { ID, Settings } from '@/types';

/**
 * NotificationService — local reminders while the app is open.
 *
 * Design constraints, in order of importance:
 *   1. Never surprise the user. Permission is requested only from an explicit
 *      control in Settings, never on load.
 *   2. Degrade silently. On a browser with no Notification API, or with
 *      permission denied, every function here is a well-typed no-op that
 *      reports what happened rather than throwing.
 *   3. No server. These are `new Notification(...)` calls scheduled with
 *      setTimeout, so they only fire while a tab is open — which is stated
 *      plainly in the Settings copy rather than pretending otherwise.
 */

export type NotificationSupport = 'unsupported' | 'default' | 'granted' | 'denied';

export function getSupport(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
}

export function isEnabled(): boolean {
  return getSupport() === 'granted';
}

/** Requests permission. Returns the resulting state; never throws. */
export async function requestPermission(): Promise<NotificationSupport> {
  if (getSupport() === 'unsupported') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default';
  } catch {
    return 'denied';
  }
}

export interface NotifyOptions {
  body?: string;
  tag?: string;
  /** Silent notifications still appear but make no sound. */
  silent?: boolean;
  onClick?: () => void;
}

/** Shows a notification if allowed. Returns false when it could not be shown. */
export function notify(title: string, options: NotifyOptions = {}): boolean {
  if (!isEnabled()) return false;
  const init = {
    body: options.body,
    tag: options.tag,
    silent: options.silent ?? false,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  // iPad/iPhone Home Screen apps (and Android) only support notifications
  // through the service worker; `new Notification()` throws there.
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw?.controller) {
    void sw.ready.then((reg) => reg.showNotification(title, init)).catch(() => undefined);
    return true;
  }
  try {
    const n = new Notification(title, init);
    if (options.onClick) {
      n.onclick = () => {
        window.focus();
        options.onClick?.();
      };
    }
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

interface ScheduledReminder {
  key: string;
  at: number;
  timer: ReturnType<typeof setTimeout>;
}

const scheduled = new Map<string, ScheduledReminder>();

/** Timers beyond this are not armed; the sweep re-arms them when closer. */
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

function schedule(key: string, at: number, fire: () => void): void {
  const delay = at - Date.now();
  if (delay <= 0 || delay > MAX_TIMEOUT_MS) return;
  const existing = scheduled.get(key);
  if (existing) {
    if (existing.at === at) return;
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    scheduled.delete(key);
    fire();
  }, delay);
  scheduled.set(key, { key, at, timer });
}

export function cancelAllReminders(): void {
  for (const r of scheduled.values()) clearTimeout(r.timer);
  scheduled.clear();
}

export function scheduledCount(): number {
  return scheduled.size;
}

/* ------------------------------------------------------------------ */
/* Reminder sources                                                    */
/* ------------------------------------------------------------------ */

export interface SweepResult {
  armed: number;
  skipped: string | null;
}

/**
 * Runs the reminder sweep now. Reminders are owned by the Notification Center
 * engine (`notificationCenter.sweepReminders`), which files them, plays the
 * alert sound and mirrors them to the desktop — so there is exactly one source
 * and an upcoming block can never produce two OS notifications.
 */
export async function sweep(now = Date.now()): Promise<SweepResult> {
  if (getSupport() === 'unsupported') return { armed: 0, skipped: 'This browser does not support notifications.' };
  const settings = await getSettings();
  if (!settings.notifications.enabled) return { armed: 0, skipped: 'Notifications are switched off in Settings.' };
  const { sweepReminders } = await import('./notificationCenter');
  return { armed: await sweepReminders(now), skipped: null };
}

let loopTimer: ReturnType<typeof setInterval> | null = null; // legacy handle; no longer armed

/**
 * Kept for compatibility: the Notification Center runs the minute sweep, so
 * this only cancels any one-off manual reminders on stop. Idempotent.
 */
export function startNotificationLoop(_intervalMs = 5 * MINUTE_MS): () => void {
  stopNotificationLoop();
  return stopNotificationLoop;
}

export function stopNotificationLoop(): void {
  if (loopTimer !== null) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  cancelAllReminders();
}

/** Fires a sample so the user can confirm the OS actually shows them. */
export function sendTestNotification(): boolean {
  return notify('LifeOS notifications are working', {
    body: 'You will get reminders like this while LifeOS is open (on iPad: opened from the Home Screen).',
    tag: 'test',
  });
}

/** One-off reminder for a specific block, used by the "remind me" control. */
export function remindAboutBlock(blockId: ID, title: string, startsAt: number, leadMinutes: number): boolean {
  if (!isEnabled()) return false;
  const at = startsAt - leadMinutes * MINUTE_MS;
  if (at <= Date.now()) return false;
  schedule(`manual:${blockId}`, at, () => {
    notify(title, { body: `Starts in ${leadMinutes} min.`, tag: `manual:${blockId}` });
  });
  return true;
}

/** Plain-English status line for the Settings panel. */
export function describeStatus(settings: Settings | undefined): string {
  const support = getSupport();
  if (support === 'unsupported') {
    return 'This browser does not support notifications. Everything else works normally.';
  }
  if (support === 'denied') {
    return 'Notifications are blocked for this site. Re-enable them in your browser settings, then reload.';
  }
  if (support === 'default') {
    return 'Permission has not been granted yet. Nothing will be shown until you allow it.';
  }
  if (!settings?.notifications.enabled) {
    return 'Permission granted, but reminders are switched off below.';
  }
  return 'Desktop notifications are on. They are generated by LifeOS itself, so a LifeOS window must be open (it can be minimised or in the background).';
}
