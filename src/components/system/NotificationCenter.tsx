import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Bell, BellOff, Briefcase, CalendarDays, Check, CheckCheck, ClipboardList, GraduationCap, ListChecks, ListTodo, Settings2, Trophy, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime } from './relativeTime';
import {
  NOTIFICATION_CATEGORIES, useNotificationStore, useUnreadCount,
  type AppNotification, type NotificationCategory,
} from '@/state/notificationStore';

const CAT_ICON: Record<NotificationCategory, typeof Bell> = {
  schedule: CalendarDays, tasks: ListTodo, progress: Trophy, money: Briefcase, study: GraduationCap,
  checklists: ListChecks, reviews: ClipboardList, system: Settings2,
};
const CAT_TINT: Record<NotificationCategory, string> = {
  schedule: 'bg-[rgb(10_132_255/0.18)] text-[rgb(100_178_255)]',
  tasks: 'bg-[rgb(255_159_10/0.18)] text-[rgb(255_179_64)]',
  progress: 'bg-[rgb(255_214_10/0.16)] text-[rgb(255_214_10)]',
  money: 'bg-[rgb(48_209_88/0.16)] text-[rgb(80_220_120)]',
  study: 'bg-[rgb(191_90_242/0.18)] text-[rgb(214_140_250)]',
  checklists: 'bg-[rgb(64_200_224/0.16)] text-[rgb(100_215_235)]',
  reviews: 'bg-[rgb(94_92_230/0.2)] text-[rgb(150_148_255)]',
  system: 'bg-white/10 text-ink-muted',
};

/** Bell button with an unread badge; opens the Center. */
export function NotificationBell() {
  const unread = useUnreadCount();
  const open = useNotificationStore((s) => s.centerOpen);
  const setOpen = useNotificationStore((s) => s.setCenterOpen);
  return (
    <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}
      onClick={() => setOpen(!open)}
      className="touch-hit pressable relative grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-white/10 hover:text-ink">
      <Bell className={cn('h-[1.0625rem] w-[1.0625rem]', unread > 0 && 'animate-[lo-bell_1.2s_ease-in-out_1]')} />
      {unread > 0 ? (
        <span className="t-num absolute -right-0.5 -top-0.5 grid h-[1.05rem] min-w-[1.05rem] place-items-center rounded-full bg-[#D70015] px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-[rgb(var(--c-surface-base))]">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The Notification Center: a glass panel that drops from the top-right
 * cluster. Grouped Today / Yesterday / Earlier; a category filter row;
 * tap opens the source; each row can be dismissed; Mark all read; Clear.
 */
export function NotificationCenter() {
  const open = useNotificationStore((s) => s.centerOpen);
  const setOpen = useNotificationStore((s) => s.setCenterOpen);
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const remove = useNotificationStore((s) => s.remove);
  const clear = useNotificationStore((s) => s.clear);
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const present = useMemo(() => new Set(items.map((i) => i.category)), [items]);
  const groups = useMemo(() => {
    const shown = filter === 'all' ? items : items.filter((i) => i.category === filter);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const t0 = start.getTime(); const y0 = t0 - 86_400_000;
    const out: { label: string; rows: AppNotification[] }[] = [
      { label: 'Today', rows: shown.filter((i) => i.at >= t0) },
      { label: 'Yesterday', rows: shown.filter((i) => i.at >= y0 && i.at < t0) },
      { label: 'Earlier', rows: shown.filter((i) => i.at < y0) },
    ];
    return out.filter((g) => g.rows.length);
  }, [items, filter]);

  if (!open) return null;
  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="fixed inset-0 z-[70]" role="presentation">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade" onClick={() => setOpen(false)} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Notifications"
        className="glass glass-regular absolute right-3 top-[3.75rem] flex max-h-[min(44rem,calc(100dvh-5rem))] w-[min(25rem,calc(100vw-1.5rem))] origin-top-right flex-col overflow-hidden rounded-[26px] animate-in-pop focus:outline-none">
        <div className="flex items-center gap-2 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-[1.25rem] font-bold tracking-[-0.02em] text-ink">Notifications</div>
            <div className="text-[0.75rem] text-ink-faint">{unread ? `${unread} unread` : 'All caught up'}</div>
          </div>
          {unread ? (
            <button type="button" onClick={markAllRead} className="pressable inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[0.75rem] font-semibold text-ink hover:bg-white/15 [:root:not(.dark)_&]:bg-black/5">
              <CheckCheck className="h-3.5 w-3.5" /> Read all
            </button>
          ) : null}
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="touch-hit pressable grid h-8 w-8 place-items-center rounded-full text-ink-faint hover:bg-white/10 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto px-5 pb-3 scrollbar-none">
          {(['all', ...NOTIFICATION_CATEGORIES.map((c) => c.id).filter((c) => present.has(c))] as const).map((c) => (
            <button key={c} type="button" onClick={() => setFilter(c)}
              className={cn('pressable h-7 shrink-0 rounded-full px-3 text-[0.75rem] font-semibold transition-colors',
                filter === c ? 'bg-ink text-surface-base' : 'bg-white/[0.07] text-ink-muted hover:text-ink [:root:not(.dark)_&]:bg-black/5')}>
              {c === 'all' ? 'All' : NOTIFICATION_CATEGORIES.find((x) => x.id === c)?.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.06]"><BellOff className="h-6 w-6 text-ink-faint" /></span>
              <div className="mt-4 text-[0.9375rem] font-semibold text-ink">Nothing here yet</div>
              <p className="mt-1 text-[0.8125rem] text-ink-faint">Reminders, achievements, payments and everything you do shows up here.</p>
            </div>
          ) : groups.map((g) => (
            <section key={g.label} className="mb-2">
              <div className="px-2 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">{g.label}</div>
              <ul className="space-y-1.5">
                {g.rows.map((n, i) => {
                  const Icon = n.tone === 'warning' || n.tone === 'error' ? AlertTriangle : n.tone === 'success' && n.category === 'system' ? Check : CAT_ICON[n.category];
                  return (
                    <li key={n.id} className="group relative animate-in-rise" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                      <button type="button"
                        onClick={() => { markRead(n.id); if (n.link) { setOpen(false); navigate(n.link); } }}
                        className={cn('pressable flex w-full items-start gap-3 rounded-[18px] p-3 pr-9 text-left transition-colors',
                          n.read ? 'bg-white/[0.03] hover:bg-white/[0.06] [:root:not(.dark)_&]:bg-black/[0.02]' : 'bg-white/[0.08] hover:bg-white/[0.11] [:root:not(.dark)_&]:bg-white')}>
                        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[11px]', n.tone === 'error' ? 'bg-critical/20 text-critical' : n.tone === 'warning' ? 'bg-caution/20 text-caution' : CAT_TINT[n.category])}>
                          <Icon className="h-[1.0625rem] w-[1.0625rem]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn('min-w-0 flex-1 truncate text-[0.875rem] text-ink', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
                            <span className="t-num shrink-0 text-[0.6875rem] text-ink-faint">{relativeTime(n.at)}</span>
                          </span>
                          {n.body ? <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[0.8125rem] leading-snug text-ink-muted">{n.body}</span> : null}
                        </span>
                        {!n.read ? <span className="absolute right-3.5 top-4 h-2 w-2 rounded-full bg-accent" aria-label="Unread" /> : null}
                      </button>
                      <button type="button" aria-label="Dismiss" onClick={() => remove(n.id)}
                        className="absolute bottom-2.5 right-2 grid h-7 w-7 place-items-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-white/10 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-60">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {items.length ? (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-2.5 [:root:not(.dark)_&]:border-black/[0.06]">
            <button type="button" onClick={() => { setOpen(false); navigate('/settings?tab=notifications'); }} className="text-[0.75rem] font-semibold text-accent-ink hover:underline">Notification settings</button>
            <button type="button" onClick={clear} className="text-[0.75rem] font-semibold text-ink-faint hover:text-critical">Clear all</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
