import { db } from '@/db/db';
import { MINUTE_MS, formatTime, todayKey } from '@/lib/date';
import { checklistProgress, isOverdue, periodKeyFor } from '@/engines/workgrowth';
import { toast } from '@/state/toastStore';
import { inQuietHours, useNotificationStore, type NotificationCategory } from '@/state/notificationStore';
import { playCue, type SoundCue } from '@/lib/sounds';
import { getSupport, notify as systemNotify } from './notificationService';
import { getSettings } from './settingsService';
import type { Activity, ActivityType, Settings } from '@/types';

/**
 * Notification Center engine — the ONE place every reminder and alert is
 * raised. Two sources, both real:
 *
 *  1. Activity — every row written to `activities` (only real completions /
 *     events ever are) raises a notification once its transaction commits.
 *  2. Time — a once-a-minute sweep: blocks about to start / starting now /
 *     ended unlogged, tasks due and overdue, hard deadlines within 24 h,
 *     overdue invoices, follow-ups, unfinished checklists, revision due,
 *     Close the day. Each fires once per dedupe key.
 *
 * Every notification is filed in the Center, then delivered according to the
 * user's preferences: an in-app banner (per category, quiet hours), an alert
 * sound (per cue, volume, quiet hours) and a desktop notification (per kind;
 * by default only while LifeOS is in the background). The dedupe key doubles
 * as the OS notification tag, so a repeat replaces rather than stacks.
 *
 * Nothing here awards XP or changes data — it only reads and tells.
 */

/** What a notification is about — decides desktop + sound delivery. */
export type NotifyKind =
  | 'blockUpcoming' | 'blockStart' | 'blockMissed' | 'completion' | 'task' | 'deadline'
  | 'achievement' | 'revision' | 'alert' | 'breakEnd' | 'info';

const SOUND_FOR: Record<NotifyKind, SoundCue | null> = {
  blockUpcoming: 'schedule', blockStart: 'schedule', blockMissed: 'warning', completion: 'completion', task: 'task',
  deadline: 'warning', achievement: 'achievement', revision: 'task', alert: 'warning', breakEnd: 'schedule', info: null,
};

/** Desktop preference for a kind (defaults keep existing behaviour sensible). */
export function desktopAllowed(kind: NotifyKind, n: Settings['notifications']): boolean {
  if (!n.enabled) return false;
  switch (kind) {
    case 'blockUpcoming': return n.blockStart;
    case 'blockStart': return n.blockStartNow ?? n.blockStart;
    case 'blockMissed': return n.blockMissed ?? true;
    case 'completion': return n.completions ?? false;
    case 'task': return n.taskDue ?? true;
    case 'deadline': return n.deadlines ?? true;
    case 'achievement': return n.achievements ?? true;
    case 'revision': return n.revisionDue;
    case 'alert': return n.alerts ?? true;
    case 'breakEnd': return n.breakEnd;
    default: return false;
  }
}

export interface DeliveryPlan { banner: boolean; desktop: boolean; sound: SoundCue | null }

/**
 * Pure delivery decision — what a notification should do right now. Exported
 * for tests; `raise` executes it.
 */
export function planDelivery(input: {
  kind: NotifyKind;
  banner: boolean;
  settings: Settings['notifications'];
  quiet: boolean;
  appVisible: boolean;
  permission: string;
}): DeliveryPlan {
  const { kind, settings, quiet, appVisible, permission } = input;
  const desktop = !quiet && permission === 'granted' && desktopAllowed(kind, settings) && (!appVisible || !!settings.desktopWhenVisible);
  const interruptive = (input.banner && appVisible) || desktop;
  return { banner: input.banner, desktop, sound: !quiet && interruptive ? SOUND_FOR[kind] : null };
}

interface ActivityRule { category: NotificationCategory; kind: NotifyKind; banner: boolean; title: (a: Activity) => string; body?: (a: Activity) => string | undefined; link?: (a: Activity) => string | undefined; tone?: 'success' | 'default' }

const money = (a: Activity) => {
  if (!a.value) return undefined;
  try {
    if (a.unit && /^[A-Z]{3}$/.test(a.unit)) return new Intl.NumberFormat(undefined, { style: 'currency', currency: a.unit, maximumFractionDigits: 0 }).format(a.value);
  } catch { /* unknown currency code — fall through */ }
  return `${a.unit ?? ''} ${Math.round(a.value).toLocaleString()}`.trim();
};

const ACTIVITY_RULES: Partial<Record<ActivityType, ActivityRule>> = {
  level_up: { category: 'progress', kind: 'achievement', banner: true, tone: 'success', title: (a) => a.title || 'Level up', body: () => 'New level reached.', link: () => '/achievements' },
  achievement_unlocked: { category: 'progress', kind: 'achievement', banner: true, tone: 'success', title: () => 'Achievement unlocked', body: (a) => a.title, link: () => '/achievements' },
  goal_completed: { category: 'progress', kind: 'achievement', banner: true, tone: 'success', title: () => 'Goal completed', body: (a) => a.title, link: (a) => (a.goalId ? `/goals/${a.goalId}` : '/goals') },
  milestone_completed: { category: 'progress', kind: 'achievement', banner: true, tone: 'success', title: () => 'Milestone reached', body: (a) => a.title, link: () => '/goals' },
  project_shipped: { category: 'progress', kind: 'achievement', banner: true, tone: 'success', title: () => 'Project shipped', body: (a) => a.title, link: () => '/projects' },
  payment_received: { category: 'money', kind: 'achievement', banner: true, tone: 'success', title: (a) => `Payment received${money(a) ? ` · ${money(a)}` : ''}`, body: (a) => a.title, link: () => '/earning' },
  checklist_completed: { category: 'checklists', kind: 'completion', banner: false, tone: 'success', title: () => 'Checklist complete', body: (a) => a.title, link: () => '/checklists' },
  task_completed: { category: 'tasks', kind: 'completion', banner: false, tone: 'success', title: () => 'Task done', body: (a) => a.title, link: () => '/tasks' },
  block_completed: { category: 'schedule', kind: 'completion', banner: false, tone: 'success', title: () => 'Block logged', body: (a) => a.title, link: () => '/schedule' },
  block_skipped: { category: 'schedule', kind: 'info', banner: false, title: () => 'Block skipped', body: (a) => a.title, link: () => '/schedule' },
  timer_session: { category: 'schedule', kind: 'info', banner: false, title: () => 'Focus session saved', body: (a) => `${a.title} · ${Math.round(a.durationMs / MINUTE_MS)} min`, link: () => '/focus' },
  paper_submitted: { category: 'study', kind: 'completion', banner: false, tone: 'success', title: () => 'Paper submitted', body: (a) => a.title, link: () => '/practice' },
  revision_completed: { category: 'study', kind: 'completion', banner: false, tone: 'success', title: () => 'Revision done', body: (a) => a.title, link: () => '/revision' },
  revision_missed: { category: 'study', kind: 'info', banner: false, title: () => 'Revision missed', body: (a) => a.title, link: () => '/revision' },
  source_read: { category: 'study', kind: 'info', banner: false, tone: 'success', title: () => 'Source read', body: (a) => a.title, link: () => '/research' },
  skill_evidence: { category: 'study', kind: 'info', banner: false, tone: 'success', title: () => 'Skill evidence added', body: (a) => a.title, link: () => '/skills' },
  daily_review: { category: 'reviews', kind: 'info', banner: false, tone: 'success', title: () => 'Day closed', body: (a) => a.title },
  weekly_review: { category: 'reviews', kind: 'info', banner: false, tone: 'success', title: () => 'Weekly review saved', body: (a) => a.title },
  habit_checkin: { category: 'checklists', kind: 'info', banner: false, tone: 'success', title: () => 'Habit checked in', body: (a) => a.title },
};

export function notificationForActivity(a: Activity): { rule: ActivityRule; title: string; body?: string; link?: string } | null {
  const rule = ACTIVITY_RULES[a.type];
  if (!rule) return null;
  return { rule, title: rule.title(a), body: rule.body?.(a), link: rule.link?.(a) };
}

let cachedNotifSettings: Settings['notifications'] | null = null;
async function notifSettings(): Promise<Settings['notifications']> {
  try { cachedNotifSettings = (await getSettings()).notifications; } catch { /* keep last known */ }
  return cachedNotifSettings ?? { enabled: false, blockStart: true, breakEnd: false, revisionDue: true, dailyReviewHour: 21 };
}

interface RaiseInput { key: string; kind: NotifyKind; title: string; body?: string; category: NotificationCategory; link?: string; tone?: 'success' | 'default' | 'warning'; banner: boolean }

async function raise(n: RaiseInput): Promise<DeliveryPlan> {
  const settings = await notifSettings();
  const center = useNotificationStore.getState();
  const plan = planDelivery({
    kind: n.kind, banner: n.banner, settings, quiet: inQuietHours(center.prefs),
    appVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
    permission: getSupport(),
  });
  toast.notify({ title: n.title, description: n.body, category: n.category, link: n.link, tone: n.tone, silent: !n.banner });
  if (plan.desktop && center.prefs.system !== false) systemNotify(n.title, { body: n.body, tag: n.key });
  if (plan.sound) playCue(plan.sound);
  return plan;
}

/**
 * Fires `fn` once per key — across tabs too: the persisted `fired` map is
 * re-read from storage first, so two open LifeOS windows don't both remind.
 */
function once(key: string, fn: () => void) {
  const store = useNotificationStore.getState();
  if (store.fired[key]) return;
  try {
    const raw = localStorage.getItem('lifeos.notifications');
    const persisted = raw ? (JSON.parse(raw) as { state?: { fired?: Record<string, number> } }).state?.fired : undefined;
    if (persisted?.[key]) { store.markFired(key, persisted[key]); return; }
  } catch { /* storage unavailable — fall back to this tab's memory */ }
  store.markFired(key);
  fn();
}

/* ------------------------------------------------------------------ */
/* Time sweep                                                          */
/* ------------------------------------------------------------------ */

export async function sweepReminders(now = Date.now()): Promise<number> {
  let raised = 0;
  const fire = (key: string, n: Omit<RaiseInput, 'key'>) => once(key, () => { void raise({ key, ...n }); raised += 1; });
  const today = todayKey(now);
  const hour = new Date(now).getHours();
  const settings = await getSettings();
  const lead = Math.max(1, settings.notifications.leadMinutes ?? 5) * MINUTE_MS;
  const repeat = Math.max(0, settings.notifications.missedRepeatMinutes ?? 0) * MINUTE_MS;

  // Schedule — about to start / starting now / ended without being logged.
  const blocks = (await db.blocks.where('date').equals(today).toArray())
    .filter((b) => b.kind !== 'sleep' && b.status !== 'cancelled' && b.status !== 'skipped');
  for (const b of blocks) {
    const quietKind = b.optional || ['break', 'buffer', 'meal'].includes(b.kind);
    if (b.status === 'planned' && !quietKind && b.start > now && b.start - now <= lead) {
      fire(`blk-soon:${b.id}:${b.start}`, { kind: 'blockUpcoming', title: `Up next · ${formatTime(b.start)}`, body: b.title, category: 'schedule', link: '/schedule', banner: true });
    }
    if (b.status === 'planned' && !quietKind && b.start <= now && now - b.start < 3 * MINUTE_MS) {
      fire(`blk-start:${b.id}:${b.start}`, { kind: 'blockStart', title: `Starting now · ${b.title}`, body: `${formatTime(b.start)} – ${formatTime(b.end)}`, category: 'schedule', link: '/schedule', banner: true });
    }
    if (b.kind === 'break' && settings.notifications.breakEnd && b.end <= now && now - b.end < 3 * MINUTE_MS) {
      fire(`break-end:${b.id}:${b.end}`, { kind: 'breakEnd', title: 'Break is over', body: `${b.title} ended at ${formatTime(b.end)}.`, category: 'schedule', link: '/schedule', banner: true });
    }
    const required = !b.optional && !['break', 'meal', 'buffer'].includes(b.kind);
    if (required && b.status === 'planned' && b.end <= now && now - b.end <= 2 * 60 * MINUTE_MS) {
      // Optional re-reminders: one key per repeat window after the first.
      const bucket = repeat > 0 ? Math.floor((now - b.end) / repeat) : 0;
      fire(`blk-ended:${b.id}:${b.end}${bucket ? `:${bucket}` : ''}`, { kind: 'blockMissed', title: 'Did this happen?', body: `${b.title} ended at ${formatTime(b.end)} — log it or skip it.`, category: 'schedule', link: '/schedule', banner: true, tone: 'warning' });
    }
  }

  // Tasks — due today (morning digest), overdue, and hard deadlines within 24 h.
  if (hour >= 7) {
    const open = (await db.tasks.toArray()).filter((t) => t.dueDate && !['completed', 'cancelled', 'skipped'].includes(t.status));
    const dueToday = open.filter((t) => t.dueDate === today);
    const overdue = open.filter((t) => (t.dueDate as string) < today);
    if (dueToday.length) fire(`tasks-due:${today}`, { kind: 'task', title: `${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`, body: dueToday.slice(0, 3).map((t) => t.title).join(' · '), category: 'tasks', link: '/tasks', banner: true });
    if (overdue.length) fire(`tasks-overdue:${today}`, { kind: 'alert', title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`, body: overdue.slice(0, 3).map((t) => t.title).join(' · '), category: 'tasks', link: '/tasks', banner: true, tone: 'warning' });
    const tomorrow = todayKey(now + 86_400_000);
    for (const t of open.filter((x) => x.deadlineHard && (x.dueDate === today || x.dueDate === tomorrow))) {
      fire(`deadline:${t.id}:${t.dueDate}`, { kind: 'deadline', title: `Deadline ${t.dueDate === today ? 'today' : 'tomorrow'}`, body: t.title, category: 'tasks', link: '/tasks', banner: true, tone: 'warning' });
    }
  }

  // Earning — overdue invoices and follow-ups due.
  if (hour >= 9) {
    const unpaid = (await db.money.toArray()).filter((e) => isOverdue(e, today));
    if (unpaid.length) fire(`inv-overdue:${today}`, { kind: 'alert', title: `${unpaid.length} invoice${unpaid.length > 1 ? 's' : ''} overdue`, body: unpaid.slice(0, 3).map((e) => e.description || e.category).join(' · '), category: 'money', link: '/earning', banner: true, tone: 'warning' });
    const follow = (await db.contacts.toArray()).filter((c) => c.nextFollowUp && c.nextFollowUp <= today && c.stage !== 'lost');
    if (follow.length) fire(`followups:${today}`, { kind: 'task', title: `${follow.length} follow-up${follow.length > 1 ? 's' : ''} due`, body: follow.slice(0, 3).map((c) => c.name).join(' · '), category: 'money', link: '/earning', banner: true });
  }

  // Study — revision due today.
  if (hour >= 8) {
    const due = (await db.revisionEntries.where('dueDate').equals(today).toArray()).filter((r) => r.status === 'scheduled');
    if (due.length) fire(`rev-due:${today}`, { kind: 'revision', title: `${due.length} revision${due.length > 1 ? 's' : ''} due today`, category: 'study', link: '/revision', banner: true });
  }

  // Checklists — daily ones still open in the evening.
  if (hour >= 19) {
    const lists = (await db.checklists.toArray()).filter((l) => l.active !== false && l.cadence === 'daily');
    const runs = await db.checklistRuns.toArray();
    const open = lists.filter((l) => !checklistProgress(l, runs.find((r) => r.checklistId === l.id && r.periodKey === periodKeyFor('daily', today)), today).complete
      && checklistProgress(l, undefined, today).total > 0);
    if (open.length) fire(`chk-open:${today}`, { kind: 'alert', title: 'Checklists still open', body: open.map((l) => l.title).join(' · '), category: 'checklists', link: '/checklists', banner: true });
  }

  // Reviews — Close the day.
  if (hour >= (settings.notifications.dailyReviewHour ?? 21) && settings.lastDailyReviewDate !== today) {
    fire(`review:${today}`, { kind: 'alert', title: 'Time to close the day', body: 'Two minutes: log what happened and set tomorrow up.', category: 'reviews', link: '/review/daily', banner: true });
  }
  return raised;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

let started = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function startNotificationCenter(): () => void {
  if (started) return stopNotificationCenter;
  started = true;
  db.activities.hook('creating', function (_pk, obj) {
    const a = obj as Activity;
    const n = notificationForActivity(a);
    if (!n) return;
    // Only after the write really commits — never for rolled-back work.
    this.onsuccess = () => {
      setTimeout(() => void raise({ key: `act:${a.id}`, kind: n.rule.kind, title: n.title, body: n.body, link: n.link, category: n.rule.category, tone: n.rule.tone, banner: n.rule.banner }), 0);
    };
  });
  const tick = () => { void sweepReminders().catch((e) => console.warn('[notifications] sweep failed', e)); };
  setTimeout(tick, 4000);
  timer = setInterval(tick, MINUTE_MS);
  // Catch up immediately when the window comes back (timers are throttled in background tabs).
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  return stopNotificationCenter;
}

export function stopNotificationCenter(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** Fires one sample of each delivery path, for Settings → "Send a test". */
export async function sendTestAlert(kind: NotifyKind = 'blockUpcoming'): Promise<DeliveryPlan> {
  return raise({ key: `test:${Date.now()}`, kind, title: 'LifeOS test notification', body: 'This is how reminders will look and sound.', category: 'system', banner: true });
}
