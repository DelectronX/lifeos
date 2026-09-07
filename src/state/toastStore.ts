import { create } from 'zustand';
import { newId } from '@/lib/id';

export type ToastTone = 'default' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Optional inline action — used heavily for "Undo" on engine-driven changes. */
  action?: { label: string; onClick: () => void | Promise<void> };
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'tone' | 'durationMs'> & { tone?: ToastTone; durationMs?: number }) => string;
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
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.durationMs > 0) {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), toast.durationMs);
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
  withAction: (title: string, description: string | undefined, action: Toast['action']) =>
    useToastStore.getState().push({ title, description, action }),
};
