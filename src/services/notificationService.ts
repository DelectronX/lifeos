import { db } from '@/db/db';
import { MINUTE_MS, todayKey } from '@/lib/date';
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
  try {
    const n = new Notification(title, {
      body: options.body,
      tag: options.tag,
      silent: options.silent ?? false,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
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
 * Looks at the next half hour and arms reminders for it. Called on a timer by
 * `startNotificationLoop`, and again whenever the schedule changes, so a block
 * created five minutes before it starts still gets its reminder.
 */
export async function sweep(now = Date.now()): Promise<SweepResult> {
  if (!isEnabled()) return { armed: 0, skipped: 'Notifications are not permitted.' };

  const settings = await getSettings();
  if (!settings.notifications.enabled) {
    return { armed: 0, skipped: 'Notifications are switched off in Settings.' };
  }

  let armed = 0;
  const lead = Math.max(0, settings.notifications.leadMinutes ?? 5) * MINUTE_MS;
  const horizon = now + MAX_TIMEOUT_MS;

  if (settings.notifications.blockStart) {
    const today = todayKey(now);
    const blocks = await db.blocks
      .where('[date+start]')
      .between([today, now - MINUTE_MS], [today, horizon + lead])
      .toArray();

    for (const block of blocks) {
      if (block.status !== 'planned') continue;
      const at = block.start - lead;
      if (at <= now || at > horizon) continue;
      schedule(`block:${block.id}`, at, () => {
        const mins = Math.max(0, Math.round((block.start - Date.now()) / MINUTE_MS));
        notify(block.title, {
          body: mins <= 0 ? 'Starting now.' : `Starts in ${mins} min.`,
          tag: `block:${block.id}`,
        });
      });
      armed++;
    }
  }

  if (settings.notifications.revisionDue) {
    const due = await db.revisionEntries
      .where('[status+dueDate]')
      .between(['scheduled', ''], ['scheduled', todayKey(now)], true, true)
      .toArray();
    if (due.length > 0) {
      // One digest rather than N pings — a wall of notifications is noise.
      const key = `revision:${todayKey(now)}`;
      if (!scheduled.has(key)) {
        schedule(key, now + 5_000, () => {
          notify(`${due.length} revision${due.length === 1 ? '' : 's'} due`, {
            body: 'Open the Revision dashboard to work through them.',
            tag: key,
          });
        });
        armed++;
      }
    }
  }

  if (settings.notifications.taskDue) {
    const today = todayKey(now);
    const tasks = await db.tasks
      .where('[status+dueDate]')
      .between(['planned', today], ['planned', today], true, true)
      .toArray();
    if (tasks.length > 0) {
      const key = `taskdue:${today}`;
      if (!scheduled.has(key)) {
        schedule(key, now + 5_000, () => {
          notify(`${tasks.length} task${tasks.length === 1 ? '' : 's'} due today`, {
            body: tasks.slice(0, 3).map((t) => t.title).join(', '),
            tag: key,
          });
        });
        armed++;
      }
    }
  }

  return { armed, skipped: null };
}

let loopTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the periodic sweep. Idempotent; returns a stop function. */
export function startNotificationLoop(intervalMs = 5 * MINUTE_MS): () => void {
  stopNotificationLoop();
  void sweep();
  loopTimer = setInterval(() => { void sweep(); }, intervalMs);
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
    body: 'You will get reminders like this while a LifeOS tab is open.',
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
  return `Reminders are active${scheduledCount() > 0 ? ` — ${scheduledCount()} armed for the next 30 minutes` : ''}. They only fire while a LifeOS tab is open.`;
}
