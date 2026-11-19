// End-to-end check of the LifeOS agent stack against a REAL running app.
//
// Prerequisites: `npm run agent:start` (or the Windows start script), and
// LifeOS open in a browser with Settings → Agents → Allow agent access on.
//
// It connects with the official MCP SDK client over stdio (exactly like
// Claude Desktop / Claude Code) and over Streamable HTTP, then exercises the
// REST API and the CLI. Everything it creates is deleted at the end.
//
//   node scripts/agent-e2e.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = resolve(root, 'agent/dist/lifeos-agent.mjs');
const cli = (...args) => execFileSync(process.execPath, [AGENT, ...args], { encoding: 'utf8', env: process.env });
const token = cli('token').trim();
const status = JSON.parse(cli('status'));
const base = status.url;

let pass = 0; let fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ''}`); }
};
const body = (r) => r.structuredContent ?? JSON.parse(r.content[0].text);
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tag = `e2e-${Date.now()}`;

if (!status.serverRunning) { console.error('Agent server is not running. Start it first.'); process.exit(2); }
if (!status.appConnected) { console.error('No LifeOS window is connected (Settings → Agents).'); process.exit(2); }

// ---------------- MCP over stdio (official SDK client) ----------------
console.log('\nMCP · stdio');
const stdio = new Client({ name: 'lifeos-e2e-stdio', version: '1.0.0' });
await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [AGENT, 'mcp'], env: { ...process.env }, stderr: 'ignore' }));
const tools = await stdio.listTools();
check(`lists ${tools.tools.length} tools`, tools.tools.length >= 100);
check('tools carry annotations', tools.tools.find((t) => t.name === 'tasks_delete')?.annotations?.destructiveHint === true);
const call = async (name, args = {}) => body(await stdio.callTool({ name, arguments: args }));

const info = await call('system_info');
check('system_info from the live app', info.ok && info.data.counts && info.data.client.startsWith('mcp:'), info);
const trackers = await call('trackers_list');
const trk = trackers.data[0].id;
const dash = await call('dashboard_get');
check('dashboard_get returns real progress', dash.ok && typeof dash.data.progress.blocks.total === 'number', dash);

const task = await call('tasks_create', { title: `E2E task ${tag}`, trackerId: trk, dueDate: today, tags: [tag], idempotencyKey: `${tag}-task` });
check('tasks_create', task.ok, task);
const again = await call('tasks_create', { title: `E2E task ${tag}`, trackerId: trk, dueDate: today, tags: [tag], idempotencyKey: `${tag}-task` });
check('idempotent replay returns the same task', again.ok && again.data.id === task.data.id && again.meta?.replayed === true, again);
const listed = await call('tasks_list', { tag });
check('exactly one task persisted', listed.ok && listed.data.length === 1, listed);

const start = `${today}T23:00`; const end = `${today}T23:30`;
const blk = await call('schedule_create_block', { title: `E2E block ${tag}`, start, end, trackerId: trk, taskId: task.data.id });
check('schedule_create_block', blk.ok && blk.data.block.start === start, blk);
const c1 = await call('schedule_complete_block', { id: blk.data.block.id });
const c2 = await call('schedule_complete_block', { id: blk.data.block.id });
check('complete block → completed, then already_completed', c1.ok && c1.data.result === 'completed' && c2.ok && c2.data.result === 'already_completed', [c1, c2]);
const hist = await call('schedule_completion_history', { from: today, to: today });
check('one completion event, tagged agent', hist.ok && hist.data.filter((h) => h.blockId === blk.data.block.id).length === 1 && hist.data.find((h) => h.blockId === blk.data.block.id).source === 'agent', hist);
const reopened = await call('schedule_reopen_block', { id: blk.data.block.id });
check('reopen block (mark incomplete)', reopened.ok && reopened.data.result === 'reopened', reopened);
const stale = await call('tasks_update', { id: task.data.id, notes: 'x', expectedUpdatedAt: 1 });
check('stale update → CONFLICT', !stale.ok && stale.error.code === 'CONFLICT', stale);
const noConfirm = await call('schedule_delete_block', { id: blk.data.block.id, confirm: false });
check('destructive without confirm → CONFIRMATION_REQUIRED', !noConfirm.ok && noConfirm.error.code === 'CONFIRMATION_REQUIRED', noConfirm);
const bad = await call('tasks_create', { title: 'x', trackerId: trk, dueDate: 'tomorrow' });
check('invalid input → VALIDATION_ERROR', !bad.ok && bad.error.code === 'VALIDATION_ERROR', bad);

const res = await stdio.listResources();
check('resources listed', res.resources.some((r) => r.uri === 'lifeos://dashboard/today'));
const todayRes = await stdio.readResource({ uri: 'lifeos://schedule/today' });
check('read resource lifeos://schedule/today', JSON.parse(todayRes.contents[0].text).ok === true);
const prompts = await stdio.listPrompts();
check('prompts listed', prompts.prompts.some((p) => p.name === 'plan_my_day'));
const prompt = await stdio.getPrompt({ name: 'plan_my_day', arguments: { focus: 'AP Calc' } });
check('get prompt', prompt.messages[0].content.text.includes('AP Calc'));

// ---------------- MCP over Streamable HTTP ----------------
console.log('\nMCP · Streamable HTTP');
const http = new Client({ name: 'lifeos-e2e-http', version: '1.0.0' });
await http.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const htools = await http.listTools();
check(`HTTP lists ${htools.tools.length} tools`, htools.tools.length === tools.tools.length);
const hcur = body(await http.callTool({ name: 'schedule_get_current', arguments: {} }));
check('HTTP schedule_get_current', hcur.ok, hcur);
await http.close();

// ---------------- REST + OpenAPI ----------------
console.log('\nREST');
const rest = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
const oas = await (await fetch(`${base}/openapi.json`)).json();
check('OpenAPI 3.1 document', oas.openapi === '3.1.0' && Object.keys(oas.paths).length > 100);
const r1 = await rest(`/api/v1/ops/tasks_list?tag=${tag}&limit=5`);
const r1b = await r1.json();
check('GET read op with query params', r1.status === 200 && r1b.data.length === 1, r1b);
const r2 = await rest('/api/v1/ops/tasks_get', { method: 'POST', body: JSON.stringify({ id: 'does-not-exist' }) });
check('404 for NOT_FOUND', r2.status === 404);
const r3 = await rest('/api/v1/ops/tasks_create', { method: 'GET' });
check('405 for mutation over GET', r3.status === 405);
const r4 = await fetch(`${base}/api/v1/ops/dashboard_get`, { method: 'POST' });
check('401 without token', r4.status === 401);

// ---------------- CLI ----------------
console.log('\nCLI');
const cliOut = JSON.parse(cli('call', 'tasks_get', '--id', task.data.id));
check('cli call tasks_get', cliOut.ok && cliOut.data.title.includes(tag), cliOut);

// ---------------- Audit + cleanup ----------------
console.log('\nCleanup');
const audit = await call('audit_log', { limit: 100 });
check('mutations are in the audit log', audit.ok && audit.data.some((e) => e.op === 'schedule_complete_block' && e.ok));
const del1 = await call('schedule_delete_block', { id: blk.data.block.id, confirm: true });
const del2 = await call('tasks_delete', { id: task.data.id, confirm: true });
check('cleanup deleted test records', del1.ok && del2.ok, [del1, del2]);
await stdio.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
