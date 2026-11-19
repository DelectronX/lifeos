import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { configDir } from './config';
import {
  embedVerdict, isClickUpUrl, normaliseComment, normaliseList, normaliseTask, normaliseTimeEntry, normaliseUser,
  type CUFolder, type CUSpace, type CUTeam,
} from '../../src/integrations/clickup/shared';
import type { PermissionLevel } from '../../src/agent/catalog';

/**
 * ClickUp adapter for the local LifeOS server.
 *
 *   GET  /api/v1/clickup/status                    connection state (never the token)
 *   POST /api/v1/clickup/connect     {token}       validate + store a personal API token
 *   POST /api/v1/clickup/disconnect                forget the token
 *   GET  /api/v1/clickup/teams                     workspaces
 *   GET  /api/v1/clickup/tree?teamId               spaces → folders → lists (one call for the sidebar)
 *   GET  /api/v1/clickup/list?listId               a list with its statuses
 *   GET  /api/v1/clickup/tasks?listId&page&closed  tasks in a list (100 per page)
 *   GET  /api/v1/clickup/my-tasks?teamId&page&closed   tasks assigned to me across the workspace
 *   GET  /api/v1/clickup/task?id                   one task with subtasks
 *   POST /api/v1/clickup/task-create {listId,…}
 *   POST /api/v1/clickup/task-update {id,…}
 *   GET  /api/v1/clickup/comments?taskId
 *   POST /api/v1/clickup/comment {taskId,text}
 *   GET  /api/v1/clickup/timer?teamId              running timer
 *   POST /api/v1/clickup/timer-start {teamId,taskId}
 *   POST /api/v1/clickup/timer-stop {teamId}
 *   GET  /api/v1/clickup/embed-check?url           may this ClickUp URL be framed?
 *
 * The token lives only in clickup.json next to agent.json (file mode 600). It
 * never goes back to the browser and is never logged. All routes sit behind
 * the same bearer auth as the rest of the server; changes need the server's
 * permission to be at least `write`.
 */

const API = 'https://api.clickup.com/api/v2';
const UA = 'LifeOS-ClickUp/1.0';

export interface ClickUpStore { token: string; connectedAt: number; user: { id: number; name: string; email?: string } }
type Fetch = typeof fetch;

export class ClickUpError extends Error {
  constructor(public code: 'CLICKUP_NOT_CONNECTED' | 'CLICKUP_AUTH' | 'CLICKUP_RATE_LIMITED' | 'CLICKUP_NOT_FOUND' | 'CLICKUP_ERROR' | 'VALIDATION_ERROR' | 'PERMISSION_DENIED',
    message: string, public status = 502, public details?: unknown) { super(message); }
}

const storePath = () => join(configDir(), 'clickup.json');
export function readStore(): ClickUpStore | null {
  if (process.env.LIFEOS_CLICKUP_TOKEN) return { token: process.env.LIFEOS_CLICKUP_TOKEN, connectedAt: 0, user: { id: 0, name: 'env' } };
  try { return existsSync(storePath()) ? JSON.parse(readFileSync(storePath(), 'utf8')) as ClickUpStore : null; } catch { return null; }
}
function writeStore(s: ClickUpStore): void { writeFileSync(storePath(), `${JSON.stringify(s, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); }

/** Low-level call with rate-limit handling (waits once, up to 15 s, on 429). */
export async function cuFetch(token: string, path: string, init: { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined> } = {}, f: Fetch = fetch): Promise<any> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await f(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: token, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 429 && attempt === 0) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const waitMs = Number.isFinite(reset) && reset > 0 ? Math.min(15_000, Math.max(500, reset * 1000 - Date.now())) : 5_000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { err: text.slice(0, 200) }; }
    if (res.ok) return body;
    const msg = body?.err ?? `ClickUp answered ${res.status}.`;
    if (res.status === 401 || body?.ECODE === 'OAUTH_017' || body?.ECODE === 'OAUTH_019') throw new ClickUpError('CLICKUP_AUTH', `ClickUp rejected the token: ${msg} Reconnect in LifeOS → ClickUp.`, 424);
    if (res.status === 429) throw new ClickUpError('CLICKUP_RATE_LIMITED', 'ClickUp rate limit reached; try again in a minute.', 429);
    if (res.status === 404) throw new ClickUpError('CLICKUP_NOT_FOUND', msg, 404);
    throw new ClickUpError('CLICKUP_ERROR', msg, 502, { status: res.status, ecode: body?.ECODE });
  }
  throw new ClickUpError('CLICKUP_RATE_LIMITED', 'ClickUp rate limit reached; try again in a minute.', 429);
}

/* Small TTL cache for the hierarchy, which changes rarely and costs many calls. */
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function clearClickUpCache(): void { cache.clear(); }

function need<T>(v: T | undefined | null, field: string): T {
  if (v === undefined || v === null || v === '') throw new ClickUpError('VALIDATION_ERROR', `\`${field}\` is required.`, 400);
  return v;
}
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function id(v: unknown, field: string): string {
  const s = String(need(v, field));
  if (!ID_RE.test(s)) throw new ClickUpError('VALIDATION_ERROR', `\`${field}\` is not a valid ClickUp id.`, 400);
  return s;
}

export interface ClickUpContext { permission: PermissionLevel; fetch?: Fetch }

/** Runs one ClickUp action. Returns plain data or throws ClickUpError. */
export async function runClickUp(action: string, method: string, q: URLSearchParams, body: any, ctx: ClickUpContext): Promise<unknown> {
  const f = ctx.fetch ?? fetch;
  const isWrite = method === 'POST';
  if (isWrite && ctx.permission === 'read') throw new ClickUpError('PERMISSION_DENIED', 'The LifeOS server is read-only (permission "read"); ClickUp changes are disabled.', 403);

  if (action === 'status') {
    const s = readStore();
    return { connected: !!s, user: s?.user ?? null, connectedAt: s?.connectedAt ?? null };
  }
  if (action === 'connect' && isWrite) {
    const token = String(need(body?.token, 'token')).trim();
    if (token.length < 10 || /\s/.test(token)) throw new ClickUpError('VALIDATION_ERROR', 'That does not look like a ClickUp API token.', 400);
    const me = await cuFetch(token, '/user', {}, f);
    const user = normaliseUser(me?.user);
    writeStore({ token, connectedAt: Date.now(), user: { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) } });
    clearClickUpCache();
    return { connected: true, user: { id: user.id, name: user.name, email: user.email ?? null } };
  }
  if (action === 'disconnect' && isWrite) {
    if (existsSync(storePath())) rmSync(storePath());
    clearClickUpCache();
    return { connected: false };
  }

  if (action === 'embed-check') {
    const raw = String(need(q.get('url'), 'url'));
    if (!isClickUpUrl(raw)) throw new ClickUpError('VALIDATION_ERROR', 'Only https://*.clickup.com links can be embedded.', 400);
    const res = await f(raw, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA } });
    void res.body?.cancel();
    return { url: raw, finalUrl: res.url || raw, status: res.status, ...embedVerdict({ xFrameOptions: res.headers.get('x-frame-options'), csp: res.headers.get('content-security-policy') }) };
  }

  const store = readStore();
  if (!store) throw new ClickUpError('CLICKUP_NOT_CONNECTED', 'ClickUp is not connected. Add your personal API token in LifeOS → ClickUp.', 409);
  const call = (path: string, init?: Parameters<typeof cuFetch>[2]) => cuFetch(store.token, path, init, f);

  switch (action) {
    case 'teams': {
      const r = await cached('teams', 60_000, () => call('/team'));
      return (r?.teams ?? []).map((t: any): CUTeam => ({ id: String(t.id), name: String(t.name ?? 'Workspace'), color: t.color ?? null }));
    }
    case 'tree': {
      const teamId = id(q.get('teamId'), 'teamId');
      if (q.get('fresh') === '1') clearClickUpCache();
      return cached(`tree:${teamId}`, 60_000, async () => {
        const spaces = (await call(`/team/${teamId}/space`, { query: { archived: 'false' } }))?.spaces ?? [];
        return Promise.all(spaces.map(async (s: any): Promise<CUSpace> => {
          const [folders, lists] = await Promise.all([
            call(`/space/${s.id}/folder`, { query: { archived: 'false' } }),
            call(`/space/${s.id}/list`, { query: { archived: 'false' } }),
          ]);
          return {
            id: String(s.id), name: String(s.name ?? 'Space'), color: s.color ?? null,
            folders: (folders?.folders ?? []).map((fo: any): CUFolder => ({ id: String(fo.id), name: String(fo.name ?? 'Folder'), lists: (fo.lists ?? []).map(normaliseList) })),
            lists: (lists?.lists ?? []).map(normaliseList),
          };
        }));
      });
    }
    case 'list': {
      const listId = id(q.get('listId'), 'listId');
      return normaliseList(await cached(`list:${listId}`, 60_000, () => call(`/list/${listId}`)));
    }
    case 'tasks': {
      const listId = id(q.get('listId'), 'listId');
      const r = await call(`/list/${listId}/task`, { query: {
        page: q.get('page') ?? '0', include_closed: q.get('closed') === '1' ? 'true' : 'false', subtasks: 'true',
        order_by: 'due_date', reverse: 'true', include_markdown_description: 'true',
      } });
      const tasks = (r?.tasks ?? []).map(normaliseTask);
      return { tasks, lastPage: typeof r?.last_page === 'boolean' ? r.last_page : tasks.length < 100 };
    }
    case 'my-tasks': {
      const teamId = id(q.get('teamId'), 'teamId');
      const r = await call(`/team/${teamId}/task`, { query: {
        page: q.get('page') ?? '0', include_closed: q.get('closed') === '1' ? 'true' : 'false', subtasks: 'true',
        order_by: 'due_date', reverse: 'true', 'assignees[]': String(store.user.id), include_markdown_description: 'true',
      } });
      const tasks = (r?.tasks ?? []).map(normaliseTask);
      return { tasks, lastPage: typeof r?.last_page === 'boolean' ? r.last_page : tasks.length < 100 };
    }
    case 'task': {
      const taskId = id(q.get('id'), 'id');
      return normaliseTask(await call(`/task/${taskId}`, { query: { include_subtasks: 'true', include_markdown_description: 'true' } }));
    }
    case 'task-create': {
      if (!isWrite) break;
      const listId = id(body?.listId, 'listId');
      const payload: Record<string, unknown> = { name: String(need(body?.name, 'name')).slice(0, 500) };
      if (body.description) payload.markdown_content = String(body.description);
      if (body.status) payload.status = String(body.status);
      if ([1, 2, 3, 4].includes(body.priority)) payload.priority = body.priority;
      if (typeof body.dueDate === 'number') { payload.due_date = body.dueDate; payload.due_date_time = !!body.dueHasTime; }
      if (body.parentId) payload.parent = id(body.parentId, 'parentId');
      return normaliseTask(await call(`/list/${listId}/task`, { method: 'POST', body: payload }));
    }
    case 'task-update': {
      if (!isWrite) break;
      const taskId = id(body?.id, 'id');
      const payload: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) payload.name = body.name.trim().slice(0, 500);
      if (typeof body.description === 'string') payload.markdown_content = body.description;
      if (typeof body.status === 'string' && body.status) payload.status = body.status;
      if (body.priority === null) payload.priority = null;
      else if ([1, 2, 3, 4].includes(body.priority)) payload.priority = body.priority;
      if (body.dueDate === null) payload.due_date = null;
      else if (typeof body.dueDate === 'number') { payload.due_date = body.dueDate; payload.due_date_time = !!body.dueHasTime; }
      if (!Object.keys(payload).length) throw new ClickUpError('VALIDATION_ERROR', 'Nothing to update.', 400);
      return normaliseTask(await call(`/task/${taskId}`, { method: 'PUT', body: payload }));
    }
    case 'comments': {
      const taskId = id(q.get('taskId'), 'taskId');
      const r = await call(`/task/${taskId}/comment`);
      return (r?.comments ?? []).map(normaliseComment).sort((a: { at: number | null }, b: { at: number | null }) => (a.at ?? 0) - (b.at ?? 0));
    }
    case 'comment': {
      if (!isWrite) break;
      const taskId = id(body?.taskId, 'taskId');
      const text = String(need(body?.text, 'text')).slice(0, 10_000);
      await call(`/task/${taskId}/comment`, { method: 'POST', body: { comment_text: text, notify_all: false } });
      return { posted: true };
    }
    case 'timer': {
      const teamId = id(q.get('teamId'), 'teamId');
      const r = await call(`/team/${teamId}/time_entries/current`);
      return normaliseTimeEntry(r?.data);
    }
    case 'timer-start': {
      if (!isWrite) break;
      const teamId = id(body?.teamId, 'teamId');
      const taskId = id(body?.taskId, 'taskId');
      const running = normaliseTimeEntry((await call(`/team/${teamId}/time_entries/current`))?.data);
      if (running?.running && running.taskId === taskId) return running; // already timing this task
      const r = await call(`/team/${teamId}/time_entries/start`, { method: 'POST', body: { tid: taskId } });
      return normaliseTimeEntry(r?.data);
    }
    case 'timer-stop': {
      if (!isWrite) break;
      const teamId = id(body?.teamId, 'teamId');
      const running = normaliseTimeEntry((await call(`/team/${teamId}/time_entries/current`))?.data);
      if (!running?.running) return null; // nothing running: idempotent
      const r = await call(`/team/${teamId}/time_entries/stop`, { method: 'POST', body: {} });
      return normaliseTimeEntry(r?.data);
    }
  }
  throw new ClickUpError('VALIDATION_ERROR', `Unknown ClickUp action "${method} ${action}".`, 404);
}

/** HTTP glue: /api/v1/clickup/{action}. */
export async function handleClickUp(req: IncomingMessage, res: ServerResponse, action: string, url: URL, readBody: () => Promise<string>, permission: PermissionLevel, log: (m: string) => void): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    const raw = req.method === 'POST' ? await readBody() : '';
    const body = raw.trim() ? JSON.parse(raw) : {};
    const data = await runClickUp(action, req.method ?? 'GET', url.searchParams, body, { permission });
    send(200, { ok: true, data });
  } catch (e) {
    if (e instanceof ClickUpError) { send(e.status, { ok: false, error: { code: e.code, message: e.message, details: e.details } }); return; }
    if (e instanceof SyntaxError) { send(400, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON.' } }); return; }
    log(`clickup ${action} failed: ${e instanceof Error ? e.message : String(e)}`);
    send(502, { ok: false, error: { code: 'CLICKUP_ERROR', message: e instanceof Error ? e.message : String(e) } });
  }
}
