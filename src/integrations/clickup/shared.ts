/**
 * ClickUp integration — pure, dependency-free logic shared by the local
 * LifeOS server (which talks to ClickUp's API) and the app (which renders it
 * and links ClickUp tasks to LifeOS tasks). No DOM, no Node, no I/O.
 *
 * Why a server at all: ClickUp's API must not be called from the browser
 * (CORS, and the personal token would sit in page JavaScript), and the real
 * ClickUp app refuses to be framed (`frame-ancestors 'self' clickup.com`).
 * So LifeOS renders its own native ClickUp workspace from API data, embeds
 * only content ClickUp allows to be framed (public shares, forms, docs), and
 * deep-links to ClickUp for everything else.
 */

/* ------------------------------------------------------------------ */
/* Normalised shapes (what the app receives)                           */
/* ------------------------------------------------------------------ */

export interface CUStatus { name: string; color: string; type: 'open' | 'custom' | 'closed' | 'done' | string; order: number }
export interface CUPriority { level: 1 | 2 | 3 | 4; label: string; color: string }
export interface CUUser { id: number; name: string; initials: string; color: string; email?: string }

export interface CUTask {
  id: string;
  customId: string | null;
  name: string;
  description: string;
  status: CUStatus;
  priority: CUPriority | null;
  dueDate: number | null;
  dueHasTime: boolean;
  startDate: number | null;
  url: string;
  list: { id: string; name: string };
  folder: { id: string; name: string } | null;
  spaceId: string | null;
  assignees: CUUser[];
  tags: string[];
  timeEstimate: number | null;
  timeSpent: number | null;
  parentId: string | null;
  subtasks: CUTask[];
  createdAt: number | null;
  updatedAt: number | null;
  closedAt: number | null;
}

export interface CUList { id: string; name: string; taskCount: number | null; statuses: CUStatus[] }
export interface CUFolder { id: string; name: string; lists: CUList[] }
export interface CUSpace { id: string; name: string; color: string | null; folders: CUFolder[]; lists: CUList[] }
export interface CUTeam { id: string; name: string; color: string | null }
export interface CUComment { id: string; text: string; author: string; at: number | null }
export interface CUTimeEntry { id: string; taskId: string | null; taskName: string | null; start: number; durationMs: number | null; running: boolean }

export const PRIORITY_LABELS: Record<1 | 2 | 3 | 4, { label: string; color: string }> = {
  1: { label: 'Urgent', color: '#f50000' },
  2: { label: 'High', color: '#f8ae00' },
  3: { label: 'Normal', color: '#6fddff' },
  4: { label: 'Low', color: '#d8d8d8' },
};

/* ------------------------------------------------------------------ */
/* Normalisers (raw ClickUp v2 JSON → shapes above)                    */
/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function normaliseStatus(raw: unknown): CUStatus {
  const s = obj(raw);
  return { name: str(s.status) || 'to do', color: str(s.color) || '#87909e', type: str(s.type) || 'open', order: num(s.orderindex) ?? 0 };
}

export function normalisePriority(raw: unknown): CUPriority | null {
  const p = obj(raw);
  const level = num(p.id ?? p.orderindex);
  if (level !== 1 && level !== 2 && level !== 3 && level !== 4) return null;
  return { level, label: PRIORITY_LABELS[level].label, color: str(p.color) || PRIORITY_LABELS[level].color };
}

export function normaliseUser(raw: unknown): CUUser {
  const u = obj(raw);
  const name = str(u.username) || str(u.email) || 'Member';
  const initials = str(u.initials) || name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return { id: num(u.id) ?? 0, name, initials, color: str(u.color) || '#7b68ee', ...(u.email ? { email: str(u.email) } : {}) };
}

export function normaliseTask(raw: unknown): CUTask {
  const t = obj(raw);
  const list = obj(t.list);
  const folder = obj(t.folder);
  const hidden = folder.hidden === true || str(folder.name) === 'hidden';
  return {
    id: str(t.id),
    customId: t.custom_id ? str(t.custom_id) : null,
    name: str(t.name) || 'Untitled task',
    description: str(t.markdown_description ?? t.text_content ?? t.description),
    status: normaliseStatus(t.status),
    priority: normalisePriority(t.priority),
    dueDate: num(t.due_date),
    dueHasTime: t.due_date_time === true,
    startDate: num(t.start_date),
    url: str(t.url) || `https://app.clickup.com/t/${str(t.id)}`,
    list: { id: str(list.id), name: str(list.name) },
    folder: folder.id && !hidden ? { id: str(folder.id), name: str(folder.name) } : null,
    spaceId: obj(t.space).id ? str(obj(t.space).id) : null,
    assignees: arr(t.assignees).map(normaliseUser),
    tags: arr(t.tags).map((x) => str(obj(x).name)).filter(Boolean),
    timeEstimate: num(t.time_estimate),
    timeSpent: num(t.time_spent),
    parentId: t.parent ? str(t.parent) : null,
    subtasks: arr(t.subtasks).map(normaliseTask),
    createdAt: num(t.date_created),
    updatedAt: num(t.date_updated),
    closedAt: num(t.date_closed ?? t.date_done),
  };
}

export function normaliseList(raw: unknown): CUList {
  const l = obj(raw);
  return {
    id: str(l.id), name: str(l.name) || 'List', taskCount: num(l.task_count),
    statuses: arr(l.statuses).map(normaliseStatus).sort((a, b) => a.order - b.order),
  };
}

export function normaliseComment(raw: unknown): CUComment {
  const c = obj(raw);
  const text = str(c.comment_text) || arr(c.comment).map((p) => str(obj(p).text)).join('');
  return { id: str(c.id), text, author: normaliseUser(c.user).name, at: num(c.date) };
}

export function normaliseTimeEntry(raw: unknown): CUTimeEntry | null {
  const e = obj(raw);
  if (!e.id) return null;
  const task = obj(e.task);
  const duration = num(e.duration);
  return {
    id: str(e.id), taskId: task.id ? str(task.id) : null, taskName: task.name ? str(task.name) : null,
    start: num(e.start) ?? 0,
    // ClickUp reports a running timer as a negative duration.
    durationMs: duration !== null && duration >= 0 ? duration : null,
    running: duration !== null && duration < 0,
  };
}

/* ------------------------------------------------------------------ */
/* Status semantics                                                    */
/* ------------------------------------------------------------------ */

/** A ClickUp status counts as finished when its type is `closed` or `done`. */
export function isClosedStatus(s: Pick<CUStatus, 'type'>): boolean {
  return s.type === 'closed' || s.type === 'done';
}

/** The status to move a task into when it is finished in LifeOS. */
export function closingStatus(statuses: CUStatus[]): CUStatus | null {
  return statuses.find((s) => s.type === 'closed') ?? statuses.find((s) => s.type === 'done') ?? null;
}

/** The status to reopen a task into (first open status). */
export function openingStatus(statuses: CUStatus[]): CUStatus | null {
  return statuses.find((s) => s.type === 'open') ?? statuses.find((s) => !isClosedStatus(s)) ?? null;
}

/** LifeOS priority (1 lowest … 5 highest) ↔ ClickUp priority (1 urgent … 4 low). */
export function lifeosPriorityFromClickUp(p: CUPriority | null): 1 | 2 | 3 | 4 | 5 {
  if (!p) return 3;
  return ({ 1: 5, 2: 4, 3: 3, 4: 2 } as const)[p.level];
}
export function clickUpPriorityFromLifeos(p: number): 1 | 2 | 3 | 4 {
  return p >= 5 ? 1 : p === 4 ? 2 : p <= 2 ? 4 : 3;
}

/* ------------------------------------------------------------------ */
/* Two-way completion sync for linked tasks                            */
/* ------------------------------------------------------------------ */

export interface LinkSnapshot {
  /** LifeOS task status. */
  lifeosCompleted: boolean;
  /** ClickUp status state now. */
  clickupClosed: boolean;
  /** What each side looked like at the last successful sync (null = never synced). */
  last: { lifeosCompleted: boolean; clickupClosed: boolean } | null;
}

export type SyncAction =
  | 'none'
  | 'complete_in_lifeos'
  | 'reopen_in_lifeos'
  | 'close_in_clickup'
  | 'reopen_in_clickup'
  | 'conflict';

/**
 * Decides how to reconcile one linked task. Whichever side changed since the
 * last sync wins; if both changed in opposite directions it is a conflict and
 * nothing is overwritten. Without a previous sync, ClickUp (the execution
 * system) is treated as the source of truth for completion.
 */
export function decideCompletionSync(s: LinkSnapshot): SyncAction {
  if (s.lifeosCompleted === s.clickupClosed) return 'none';
  if (!s.last) return s.clickupClosed ? 'complete_in_lifeos' : 'reopen_in_lifeos';
  const lifeosChanged = s.lifeosCompleted !== s.last.lifeosCompleted;
  const clickupChanged = s.clickupClosed !== s.last.clickupClosed;
  if (lifeosChanged && clickupChanged) return 'conflict';
  if (clickupChanged) return s.clickupClosed ? 'complete_in_lifeos' : 'reopen_in_lifeos';
  if (lifeosChanged) return s.lifeosCompleted ? 'close_in_clickup' : 'reopen_in_clickup';
  return 'none';
}

/* ------------------------------------------------------------------ */
/* Embedding                                                            */
/* ------------------------------------------------------------------ */

/** Hosts LifeOS will check / frame. Everything else just opens in a new tab. */
export function isClickUpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname === 'clickup.com' || u.hostname.endsWith('.clickup.com'));
  } catch {
    return false;
  }
}

export interface EmbedVerdict { embeddable: boolean; reason: string }

/**
 * Whether a page with these response headers may be shown in an iframe on a
 * LifeOS origin. `frame-ancestors` (CSP) wins over X-Frame-Options when both
 * exist, as in browsers.
 */
export function embedVerdict(headers: { xFrameOptions?: string | null; csp?: string | null }): EmbedVerdict {
  const csp = headers.csp ?? '';
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp);
  if (fa) {
    const sources = fa[1]!.trim().split(/\s+/);
    if (sources.includes('*')) return { embeddable: true, reason: 'The page allows any site to embed it.' };
    if (sources.includes("'none'")) return { embeddable: false, reason: 'ClickUp does not allow this page to be embedded anywhere.' };
    return { embeddable: false, reason: `ClickUp only allows this page inside ${sources.filter((x) => x !== "'self'").join(', ') || 'ClickUp itself'}.` };
  }
  const xfo = (headers.xFrameOptions ?? '').trim().toUpperCase();
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return { embeddable: false, reason: `ClickUp blocks embedding (X-Frame-Options: ${xfo}).` };
  return { embeddable: true, reason: 'No embedding restriction.' };
}
