import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closingStatus, clickUpPriorityFromLifeos, decideCompletionSync, embedVerdict, isClickUpUrl, isClosedStatus,
  lifeosPriorityFromClickUp, normaliseTask, normaliseTimeEntry, openingStatus,
} from '../shared';

const RAW_TASK = {
  id: 'abc123', custom_id: null, name: 'Ship landing page', markdown_description: '**Hero** section',
  status: { status: 'in progress', color: '#4194f6', type: 'custom', orderindex: 1 },
  priority: { id: '2', priority: 'high', color: '#ffcc00', orderindex: '2' },
  due_date: '1795000000000', due_date_time: false, start_date: null, url: 'https://app.clickup.com/t/abc123',
  list: { id: '901', name: 'Sprint' }, folder: { id: '55', name: 'Acme', hidden: false }, space: { id: '7' },
  assignees: [{ id: 42, username: 'Aksh Kumar', color: '#123456', initials: 'AK' }],
  tags: [{ name: 'client' }], time_estimate: 3600000, time_spent: null, parent: null,
  subtasks: [{ id: 'sub1', name: 'Copy', status: { status: 'complete', type: 'closed' }, list: { id: '901' } }],
  date_created: '1790000000000', date_updated: '1791000000000', date_closed: null,
};

describe('ClickUp shared logic', () => {
  it('normalises a raw ClickUp task', () => {
    const t = normaliseTask(RAW_TASK);
    expect(t).toMatchObject({
      id: 'abc123', name: 'Ship landing page', description: '**Hero** section',
      status: { name: 'in progress', type: 'custom' }, priority: { level: 2, label: 'High' },
      dueDate: 1795000000000, list: { id: '901', name: 'Sprint' }, folder: { id: '55', name: 'Acme' }, spaceId: '7',
      tags: ['client'], timeEstimate: 3600000,
    });
    expect(t.assignees[0]).toMatchObject({ id: 42, name: 'Aksh Kumar', initials: 'AK' });
    expect(t.subtasks[0]!.status.type).toBe('closed');
    expect(normaliseTask({ id: 'x', folder: { id: '1', name: 'hidden', hidden: true } }).folder).toBeNull();
    expect(normaliseTask({ id: 'x' }).priority).toBeNull();
  });

  it('reads running timers (negative duration) and finished ones', () => {
    expect(normaliseTimeEntry({ id: 't', task: { id: 'a', name: 'A' }, start: '100', duration: '-100' })).toMatchObject({ running: true, durationMs: null, taskId: 'a' });
    expect(normaliseTimeEntry({ id: 't', start: '100', duration: '5000' })).toMatchObject({ running: false, durationMs: 5000 });
    expect(normaliseTimeEntry(null)).toBeNull();
  });

  it('maps statuses and priorities both ways', () => {
    const statuses = [
      { name: 'to do', color: '', type: 'open', order: 0 }, { name: 'doing', color: '', type: 'custom', order: 1 },
      { name: 'complete', color: '', type: 'closed', order: 2 },
    ];
    expect(closingStatus(statuses)!.name).toBe('complete');
    expect(openingStatus(statuses)!.name).toBe('to do');
    expect(isClosedStatus({ type: 'done' })).toBe(true);
    expect(isClosedStatus({ type: 'custom' })).toBe(false);
    for (const p of [1, 2, 3, 4] as const) expect(clickUpPriorityFromLifeos(lifeosPriorityFromClickUp({ level: p, label: '', color: '' }))).toBe(p);
    expect(lifeosPriorityFromClickUp(null)).toBe(3);
  });

  it('decides two-way completion sync without overwriting concurrent edits', () => {
    const none = { lifeosCompleted: false, clickupClosed: false };
    expect(decideCompletionSync({ ...none, last: null })).toBe('none');
    expect(decideCompletionSync({ lifeosCompleted: false, clickupClosed: true, last: null })).toBe('complete_in_lifeos');
    expect(decideCompletionSync({ lifeosCompleted: false, clickupClosed: true, last: none })).toBe('complete_in_lifeos');
    expect(decideCompletionSync({ lifeosCompleted: true, clickupClosed: false, last: none })).toBe('close_in_clickup');
    const both = { lifeosCompleted: true, clickupClosed: true };
    expect(decideCompletionSync({ lifeosCompleted: false, clickupClosed: true, last: both })).toBe('reopen_in_clickup');
    expect(decideCompletionSync({ lifeosCompleted: true, clickupClosed: false, last: both })).toBe('reopen_in_lifeos');
    expect(decideCompletionSync({ lifeosCompleted: true, clickupClosed: false, last: { lifeosCompleted: false, clickupClosed: true } })).toBe('conflict');
  });

  it('judges embeddability from real ClickUp headers', () => {
    // app.clickup.com, verified 19 Nov 2026
    expect(embedVerdict({ csp: "default-src 'self'; frame-ancestors 'self' https://clickup.com https://stage1-landing.clickup.com" }).embeddable).toBe(false);
    expect(embedVerdict({ xFrameOptions: 'SAMEORIGIN' }).embeddable).toBe(false);
    expect(embedVerdict({ csp: 'frame-ancestors *' }).embeddable).toBe(true);
    expect(embedVerdict({}).embeddable).toBe(true); // sharing.clickup.com, forms.clickup.com send none
    expect(isClickUpUrl('https://sharing.clickup.com/9015/l/h/abc/xyz')).toBe(true);
    expect(isClickUpUrl('https://clickup.com.evil.io/x')).toBe(false);
    expect(isClickUpUrl('http://forms.clickup.com/x')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Server adapter against a fake ClickUp API                           */
/* ------------------------------------------------------------------ */

describe('ClickUp server adapter', () => {
  let home: string;
  let calls: Array<{ method: string; url: string; auth: string | null; body: any }>;
  let mod: typeof import('../../../../agent/src/clickup');
  const TOKEN = 'pk_test_0000000000_FAKE';

  const fakeFetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: url.toString(), auth: init.headers?.Authorization ?? null, body });
    const ok = (data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status: 200, headers });
    if (url.hostname === 'sharing.clickup.com') return new Response('<html/>', { status: 200 });
    if (url.hostname === 'app.clickup.com') return new Response('<html/>', { status: 200, headers: { 'content-security-policy': "frame-ancestors 'self' https://clickup.com" } });
    if (init.headers?.Authorization !== TOKEN) return new Response(JSON.stringify({ err: 'Token invalid', ECODE: 'OAUTH_019' }), { status: 401 });
    const p = url.pathname.replace('/api/v2', '');
    if (p === '/user') return ok({ user: { id: 42, username: 'Aksh', email: 'a@example.com' } });
    if (p === '/team') return ok({ teams: [{ id: 9001, name: 'Aksh HQ' }] });
    if (p === '/team/9001/space') return ok({ spaces: [{ id: 7, name: 'Business' }] });
    if (p === '/space/7/folder') return ok({ folders: [{ id: 55, name: 'Acme', lists: [{ id: 901, name: 'Sprint', task_count: 2 }] }] });
    if (p === '/space/7/list') return ok({ lists: [{ id: 902, name: 'Inbox' }] });
    if (p === '/list/901') return ok({ id: 901, name: 'Sprint', statuses: [{ status: 'complete', type: 'closed', orderindex: 2 }, { status: 'to do', type: 'open', orderindex: 0 }] });
    if (p === '/list/901/task' && method === 'GET') return ok({ tasks: [RAW_TASK], last_page: true });
    if (p === '/list/901/task' && method === 'POST') return ok({ ...RAW_TASK, id: 'new1', name: body.name });
    if (p === '/task/abc123' && method === 'PUT') return ok({ ...RAW_TASK, status: { status: body.status ?? 'in progress', type: body.status === 'complete' ? 'closed' : 'custom' } });
    if (p === '/team/9001/time_entries/current') return ok({ data: null });
    if (p === '/team/9001/time_entries/start') return ok({ data: { id: 'te1', task: { id: body.tid }, start: '1', duration: '-1' } });
    return new Response(JSON.stringify({ err: 'Route not found' }), { status: 404 });
  }) as typeof fetch;

  const run = (action: string, method = 'GET', query: Record<string, string> = {}, body: unknown = {}, permission: 'read' | 'write' | 'full' = 'write') =>
    mod.runClickUp(action, method, new URLSearchParams(query), body, { permission, fetch: fakeFetch });

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lifeos-cu-'));
    process.env.LIFEOS_AGENT_HOME = home;
    delete process.env.LIFEOS_CLICKUP_TOKEN;
    mod = await import('../../../../agent/src/clickup');
  });
  afterAll(() => { rmSync(home, { recursive: true, force: true }); });
  beforeEach(() => { calls = []; mod.clearClickUpCache(); });

  it('refuses to work before connecting, then stores the token server-side only', async () => {
    await expect(run('teams')).rejects.toMatchObject({ code: 'CLICKUP_NOT_CONNECTED' });
    await expect(run('connect', 'POST', {}, { token: 'pk_wrong_0000000000' })).rejects.toMatchObject({ code: 'CLICKUP_AUTH' });
    const r = await run('connect', 'POST', {}, { token: TOKEN }) as any;
    expect(r).toEqual({ connected: true, user: { id: 42, name: 'Aksh', email: 'a@example.com' } });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.parse(readFileSync(join(home, 'clickup.json'), 'utf8')).token).toBe(TOKEN);
    expect(JSON.stringify(await run('status'))).not.toContain(TOKEN);
  });

  it('builds the sidebar tree and reads tasks', async () => {
    const tree = await run('tree', 'GET', { teamId: '9001' }) as any[];
    expect(tree[0]).toMatchObject({ id: '7', name: 'Business', folders: [{ id: '55', lists: [{ id: '901', name: 'Sprint' }] }], lists: [{ id: '902' }] });
    expect(calls.every((c) => c.auth === TOKEN)).toBe(true);
    const n = calls.length;
    await run('tree', 'GET', { teamId: '9001' });
    expect(calls.length).toBe(n); // cached
    const list = await run('list', 'GET', { listId: '901' }) as any;
    expect(list.statuses.map((s: any) => s.name)).toEqual(['to do', 'complete']);
    const page = await run('tasks', 'GET', { listId: '901' }) as any;
    expect(page.tasks[0].name).toBe('Ship landing page');
    expect(page.lastPage).toBe(true);
  });

  it('creates and updates tasks with ClickUp field names', async () => {
    const t = await run('task-create', 'POST', {}, { listId: '901', name: 'New thing', priority: 2, dueDate: 1795000000000, description: 'md' }) as any;
    expect(t.id).toBe('new1');
    expect(calls.at(-1)!.body).toMatchObject({ name: 'New thing', priority: 2, due_date: 1795000000000, markdown_content: 'md' });
    const u = await run('task-update', 'POST', {}, { id: 'abc123', status: 'complete' }) as any;
    expect(u.status.type).toBe('closed');
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'complete' } });
    await expect(run('task-update', 'POST', {}, { id: 'abc123' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(run('task-update', 'POST', {}, { id: '../../evil', name: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('respects the read-only permission and starts timers idempotently', async () => {
    await expect(run('task-create', 'POST', {}, { listId: '901', name: 'x' }, 'read')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const te = await run('timer-start', 'POST', {}, { teamId: '9001', taskId: 'abc123' }) as any;
    expect(te).toMatchObject({ running: true, taskId: 'abc123' });
    expect(await run('timer-stop', 'POST', {}, { teamId: '9001' })).toBeNull(); // nothing running in the fake → no-op
  });

  it('checks embeddability and only for ClickUp hosts', async () => {
    expect(await run('embed-check', 'GET', { url: 'https://sharing.clickup.com/9001/l/h/abc' })).toMatchObject({ embeddable: true });
    expect(await run('embed-check', 'GET', { url: 'https://app.clickup.com/9001/v/l/abc' })).toMatchObject({ embeddable: false });
    await expect(run('embed-check', 'GET', { url: 'http://127.0.0.1:22/' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('disconnects by deleting the stored token', async () => {
    await run('disconnect', 'POST');
    expect(existsSync(join(home, 'clickup.json'))).toBe(false);
    expect(await run('status')).toMatchObject({ connected: false });
  });
});
