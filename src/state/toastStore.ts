import { create } from 'zustand';
import { newId } from '@/lib/id';
import { inQuietHours, useNotificationStore, type NotificationCategory } from './notificationStore';

export type ToastTone = 'default' | 'success' | 'warning' | 'error';

/** Route prefix → Notification Center category, for notifications raised without one. */
const ROUTE_CATEGORY: Array<[string, NotificationCategory]> = [
  ['/schedule', 'schedule'], ['/planning', 'schedule'], ['/focus', 'schedule'],
  ['/tasks', 'tasks'],
  ['/checklists', 'checklists'], ['/trackers', 'checklists'],
  ['/goals', 'progress'], ['/projects', 'progress'], ['/achievements', 'progress'], ['/analytics', 'progress'],
  ['/earning', 'money'],
  ['/practice', 'study'], ['/exams', 'study'], ['/revision', 'study'], ['/research', 'study'], ['/skills', 'study'],
  ['/review', 'reviews'],
];

function inferFromRoute(): { category: NotificationCategory; link?: string } {
  if (typeof window === 'undefined') return { category: 'system' };
  const path = window.location.pathname;
  const hit = ROUTE_CATEGORY.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit ? { category: hit[1], link: path } : { category: 'system' };
}

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Optional inline action — used heavily for "Undo" on engine-driven changes. */
  action?: { label: string; onClick: () => void | Promise<void> };
  durationMs: number;
  category?: NotificationCategory;
  /** In-app route; makes the banner tappable. */
  link?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'tone' | 'durationMs'> & { tone?: ToastTone; durationMs?: number; /** File in the Center only, no banner. */ silent?: boolean; /** Don't file (already filed by the caller). */ unfiled?: boolean }) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = newId('tst');
    const toast: Toast = {
      id,
      title: t.title,
      description: t.description,
      tone: t.tone ?? 'default',
      action: t.action,
      durationMs: t.durationMs ?? (t.action ? 9000 : 4500),
      ...(() => { const inferred = t.category ? null : inferFromRoute(); return { category: t.category ?? inferred?.category ?? 'system', link: t.link ?? inferred?.link }; })(),
    };
    const center = useNotificationStore.getState();
    if (!t.unfiled) {
      center.add({ title: toast.title, body: toast.description, tone: toast.tone, category: toast.category ?? 'system', link: toast.link });
    }
    // Errors and undo-able actions always show; everything else honours prefs.
    const forced = toast.tone === 'error' || !!toast.action;
    const banner = forced || (!t.silent && center.prefs.banners[toast.category ?? 'system'] !== false && !inQuietHours(center.prefs));
    if (!banner) return id;
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.durationMs > 0) {
      // Fallback only — the banner owns the visible (pausable) timer.
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), toast.durationMs * 4);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helper usable from services (outside React). */
export const toast = {
  show: (title: string, description?: string) => useToastStore.getState().push({ title, description }),
  success: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'success' }),
  warning: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'warning' }),
  error: (title: string, description?: string) => useToastStore.getState().push({ title, description, tone: 'error' }),
  /** Full form: category, tappable link, or file-only (`silent`). */
  notify: (n: { title: string; description?: string; tone?: ToastTone; category?: NotificationCategory; link?: string; silent?: boolean; action?: Toast['action']; durationMs?: number }) =>
    useToastStore.getState().push(n),
  withAction: (title: string, description: string | undefined, action: Toast['action']) =>
    useToastStore.getState().push({ title, description, action }),
};
