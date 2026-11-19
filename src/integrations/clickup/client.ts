import { readAgentPrefs } from '@/agent/bridgeClient';
import type { CUComment, CUList, CUSpace, CUTask, CUTeam, CUTimeEntry } from './shared';

/**
 * Browser-side client for the ClickUp routes of the local LifeOS server.
 * It reuses the agent connection (Settings → Agents: server URL + token);
 * the ClickUp token itself never reaches the browser.
 */

export class ClickUpClientError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export interface ClickUpStatus { connected: boolean; user: { id: number; name: string; email?: string | null } | null; connectedAt: number | null }

async function request<T>(action: string, opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T> {
  const prefs = readAgentPrefs();
  if (!prefs.token) throw new ClickUpClientError('AGENT_NOT_SET_UP', 'Set up the local LifeOS server first (Settings → Agents).', 0);
  const url = new URL(`${prefs.url.replace(/\/$/, '')}/api/v1/clickup/${action}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${prefs.token}`, ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ClickUpClientError('SERVER_UNREACHABLE', 'The local LifeOS server is not running. Start it with scripts\\windows\\lifeos-agent-start.cmd.', 0);
  }
  const json = await res.json().catch(() => null) as { ok: boolean; data?: T; error?: { code: string; message: string } } | null;
  if (!json) throw new ClickUpClientError('BAD_RESPONSE', `Unexpected answer (${res.status}) from the LifeOS server.`, res.status);
  if (!json.ok) {
    const e = json.error ?? { code: 'ERROR', message: 'Request failed.' };
    if (e.code === 'UNKNOWN_OPERATION' && res.status === 404) throw new ClickUpClientError('SERVER_OUTDATED', 'The LifeOS server is older than this app. Run npm run agent:build and restart it.', 404);
    throw new ClickUpClientError(e.code, e.message, res.status);
  }
  return json.data as T;
}

export const clickup = {
  status: () => request<ClickUpStatus>('status'),
  connect: (token: string) => request<ClickUpStatus>('connect', { body: { token } }),
  disconnect: () => request<{ connected: false }>('disconnect', { body: {} }),
  teams: () => request<CUTeam[]>('teams'),
  tree: (teamId: string, fresh = false) => request<CUSpace[]>('tree', { query: { teamId, fresh: fresh ? 1 : undefined } }),
  list: (listId: string) => request<CUList>('list', { query: { listId } }),
  tasks: (listId: string, opts: { page?: number; closed?: boolean } = {}) =>
    request<{ tasks: CUTask[]; lastPage: boolean }>('tasks', { query: { listId, page: opts.page ?? 0, closed: opts.closed ? 1 : undefined } }),
  myTasks: (teamId: string, opts: { page?: number; closed?: boolean } = {}) =>
    request<{ tasks: CUTask[]; lastPage: boolean }>('my-tasks', { query: { teamId, page: opts.page ?? 0, closed: opts.closed ? 1 : undefined } }),
  task: (id: string) => request<CUTask>('task', { query: { id } }),
  createTask: (input: { listId: string; name: string; description?: string; status?: string; priority?: 1 | 2 | 3 | 4; dueDate?: number; dueHasTime?: boolean; parentId?: string }) =>
    request<CUTask>('task-create', { body: input }),
  updateTask: (input: { id: string; name?: string; description?: string; status?: string; priority?: 1 | 2 | 3 | 4 | null; dueDate?: number | null; dueHasTime?: boolean }) =>
    request<CUTask>('task-update', { body: input }),
  comments: (taskId: string) => request<CUComment[]>('comments', { query: { taskId } }),
  comment: (taskId: string, text: string) => request<{ posted: true }>('comment', { body: { taskId, text } }),
  timer: (teamId: string) => request<CUTimeEntry | null>('timer', { query: { teamId } }),
  startTimer: (teamId: string, taskId: string) => request<CUTimeEntry | null>('timer-start', { body: { teamId, taskId } }),
  stopTimer: (teamId: string) => request<CUTimeEntry | null>('timer-stop', { body: { teamId } }),
  embedCheck: (url: string) => request<{ url: string; finalUrl: string; embeddable: boolean; reason: string }>('embed-check', { query: { url } }),
};

export type ClickUpClient = typeof clickup;
