import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newId } from '@/lib/id';

/**
 * Notification Center — the inbox behind every banner.
 *
 * Every notification the app raises (user-action results, real activity such
 * as XP / achievements / payments, and time-based reminders) lands here, so
 * nothing that flashed past as a banner is lost. Stored in this browser only
 * (localStorage), capped, newest first.
 */
export type NotificationCategory =
  | 'schedule' | 'tasks' | 'progress' | 'money' | 'study' | 'checklists' | 'reviews' | 'system';

export const NOTIFICATION_CATEGORIES: readonly { id: NotificationCategory; label: string; detail: string }[] = [
  { id: 'schedule', label: 'Schedule', detail: 'Blocks starting soon, blocks that ended unlogged' },
  { id: 'tasks', label: 'Tasks', detail: 'Due today, overdue, completed' },
  { id: 'checklists', label: 'Checklists', detail: 'Unfinished routines near the end of their period' },
  { id: 'progress', label: 'Progress', detail: 'XP, level-ups, achievements, milestones, goals' },
  { id: 'money', label: 'Earning', detail: 'Payments, overdue invoices, follow-ups' },
  { id: 'study', label: 'Study', detail: 'Revision due, papers, sources, skills' },
  { id: 'reviews', label: 'Reviews', detail: 'Close the day, weekly review' },
  { id: 'system', label: 'System', detail: 'Saves, imports, backups, errors' },
];

export type NotificationTone = 'default' | 'success' | 'warning' | 'error';

export interface AppNotification {
  id: string;
  at: number;
  title: string;
  body?: string;
  category: NotificationCategory;
  tone: NotificationTone;
  /** In-app route to open when tapped. */
  link?: string;
  read: boolean;
}

export interface NotificationPrefs {
  /** Per category: show a floating banner (true) or only file it in the Center (false). */
  banners: Record<NotificationCategory, boolean>;
  /** Mirror banners to the OS when the app is in the background (needs permission). */
  system: boolean;
  /** Quiet hours: no banners, still filed. Minutes from midnight, or null. */
  quietFrom: number | null;
  quietTo: number | null;
}

const ALL_ON = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, true])) as Record<NotificationCategory, boolean>;
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { banners: ALL_ON, system: true, quietFrom: null, quietTo: null };

const CAP = 250;

interface State {
  items: AppNotification[];
  prefs: NotificationPrefs;
  /** Dedupe keys of fired time-based reminders → when fired. */
  fired: Record<string, number>;
  centerOpen: boolean;
  add: (n: Omit<AppNotification, 'id' | 'at' | 'read'> & { at?: number }) => AppNotification;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  setPrefs: (p: Partial<NotificationPrefs>) => void;
  markFired: (key: string, at?: number) => void;
  setCenterOpen: (v: boolean) => void;
}

export const useNotificationStore = create<State>()(
  persist(
    (set) => ({
      items: [],
      prefs: DEFAULT_NOTIFICATION_PREFS,
      fired: {},
      centerOpen: false,
      add: (n) => {
        const item: AppNotification = { id: newId('ntf'), at: n.at ?? Date.now(), read: false, ...n };
        set((s) => ({ items: [item, ...s.items].slice(0, CAP) }));
        return item;
      },
      markRead: (id) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })),
      markAllRead: () => set((s) => ({ items: s.items.map((i) => (i.read ? i : { ...i, read: true })) })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p, banners: { ...s.prefs.banners, ...(p.banners ?? {}) } } })),
      markFired: (key, at = Date.now()) => set((s) => {
        // Prune keys older than 3 days so the map stays small.
        const cutoff = at - 3 * 86_400_000;
        const fired: Record<string, number> = {};
        for (const [k, v] of Object.entries(s.fired)) if (v >= cutoff) fired[k] = v;
        fired[key] = at;
        return { fired };
      }),
      setCenterOpen: (v) => set({ centerOpen: v }),
    }),
    {
      name: 'lifeos.notifications',
      partialize: (s) => ({ items: s.items, prefs: s.prefs, fired: s.fired }),
    },
  ),
);

export function inQuietHours(prefs: NotificationPrefs, now = new Date()): boolean {
  if (prefs.quietFrom === null || prefs.quietTo === null) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return prefs.quietFrom <= prefs.quietTo ? m >= prefs.quietFrom && m < prefs.quietTo : m >= prefs.quietFrom || m < prefs.quietTo;
}

export function useUnreadCount(): number {
  return useNotificationStore((s) => s.items.reduce((n, i) => n + (i.read ? 0 : 1), 0));
}
