#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS, OPERATION_BY_NAME, type AgentResult } from '../../src/agent/catalog';
import { buildOpenApi } from '../../src/agent/openapi';
import { clearPid, configDir, configPath, loadConfig, readPid, rotateToken, saveConfig, writePid, type AgentConfig } from './config';
import { inputFromQuery, startHttpServer } from './http';
import { createMcpServer, type Exec } from './mcp';

/**
 * lifeos-agent — local MCP server, REST API and CLI for LifeOS.
 *
 *   lifeos-agent start      Start the server in the background (detached)
 *   lifeos-agent serve      Run the server in the foreground (REST + MCP over HTTP + app bridge)
 *   lifeos-agent mcp        MCP over stdio (for Claude Desktop, Claude Code, Cursor…)
 *   lifeos-agent status     Is the server up? Is a LifeOS window connected?
 *   lifeos-agent ops        List operations
 *   lifeos-agent call <op> [json] [--field value …] [--idempotency-key k]
 *   lifeos-agent token [--rotate]
 *   lifeos-agent openapi    Print the OpenAPI document
 *   lifeos-agent config <claude|cursor|vscode|claude-code>
 *   lifeos-agent stop
 */

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const has = (name: string) => argv.includes(`--${name}`);
const err = (m: string) => process.stderr.write(`${m}\n`);

function overrides(): Partial<AgentConfig> {
  return {
    port: flag('port') ? Number(flag('port')) : undefined,
    host: flag('host'),
    permission: flag('permission') as AgentConfig['permission'] | undefined,
  };
}

async function health(cfg: AgentConfig): Promise<Record<string, any> | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() as Record<string, any> : null;
  } catch { return null; }
}

function remoteExec(cfg: AgentConfig): Exec {
  return async (op, input, { client, idempotencyKey }) => {
    try {
      const r = await fetch(`http://127.0.0.1:${cfg.port}/api/v1/ops/${op}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'X-LifeOS-Client': client, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify(input ?? {}),
        signal: AbortSignal.timeout((cfg.timeoutSeconds + 5) * 1000),
      });
      return await r.json() as AgentResult;
    } catch (e) {
      return { ok: false, error: { code: 'APP_NOT_CONNECTED', message: `LifeOS agent server is not reachable: ${e instanceof Error ? e.message : String(e)}` } };
    }
  };
}

async function serve(cfg: AgentConfig, quiet = false): Promise<void> {
  const log = (m: string) => err(`[lifeos-agent ${new Date().toLocaleTimeString()}] ${m}`);
  let running: Awaited<ReturnType<typeof startHttpServer>>;
  const shutdown = async () => {
    log('stopping');
    await running?.close();
    clearPid();
    process.exit(0);
  };
  try {
    running = await startHttpServer(cfg, log, () => void shutdown());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      err(`Port ${cfg.port} is already in use — is lifeos-agent already running? (lifeos-agent status)`);
      process.exit(3);
    }
    throw e;
  }
  writePid();
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  if (!quiet) {
    log(`listening on http://${cfg.host}:${cfg.port}  (permission: ${cfg.permission})`);
    log(`REST: /api/v1/ops/<name>  ·  MCP: /mcp  ·  OpenAPI: /openapi.json`);
    log(`waiting for LifeOS — open the app → Settings → Agents → Allow agent access`);
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') log(`WARNING: bound to ${cfg.host}; reachable from other machines on your network.`);
  }
}

async function stdio(cfg: AgentConfig): Promise<void> {
  // Reuse a running server if there is one; otherwise host it in this process
  // so the LifeOS tab has something to connect to.
  let exec: Exec;
  if (await health(cfg)) {
    exec = remoteExec(cfg);
    err('[lifeos-agent] stdio MCP → using the running local server');
  } else {
    const running = await startHttpServer(cfg, (m) => err(`[lifeos-agent] ${m}`), () => process.exit(0));
    exec = running.exec;
    err(`[lifeos-agent] stdio MCP; hosting the app bridge on 127.0.0.1:${cfg.port}`);
  }
  const server = createMcpServer(exec, 'stdio');
  await server.connect(new StdioServerTransport());
}

function mcpConfig(kind: string): unknown {
  const node = process.execPath;
  const entry = { command: node, args: [SELF, 'mcp'] };
  const cfg = loadConfig();
  switch (kind) {
    case 'vscode': return { servers: { lifeos: { type: 'stdio', ...entry } } };
    case 'http': return { mcpServers: { lifeos: { type: 'http', url: `http://127.0.0.1:${cfg.port}/mcp`, headers: { Authorization: `Bearer ${cfg.token}` } } } };
    case 'claude-code': return `claude mcp add lifeos -- "${node}" "${SELF}" mcp`;
    default: return { mcpServers: { lifeos: entry } };
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig(overrides());
  switch (cmd) {
    case 'serve': return serve(cfg);
    case 'start': {
      // Detached background server (used by the Windows start script and npm run agent:start).
      if (await health(cfg)) { process.stdout.write('LifeOS agent server is already running.\n'); }
      else {
        const logFile = join(configDir(), 'agent.log');
        const out = openSync(logFile, 'a');
        const pass = argv.slice(1);
        const child = spawn(process.execPath, [SELF, 'serve', ...pass], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env: process.env });
        child.unref();
        let up = false;
        for (let i = 0; i < 25 && !up; i++) { await new Promise((r) => setTimeout(r, 200)); up = !!(await health(cfg)); }
        process.stdout.write(up ? `Started (pid ${child.pid}). Log: ${logFile}\n` : `The server did not come up — see ${logFile}\n`);
        if (!up) { process.exitCode = 1; return; }
      }
      const h = await health(cfg);
      process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${cfg.port}`, appConnected: h?.appConnected ?? false, permission: cfg.permission }, null, 2)}\n`);
      return;
    }
    case 'mcp': return stdio(cfg);
    case 'status': {
      const h = await health(cfg);
      const out = { config: configPath(), url: `http://127.0.0.1:${cfg.port}`, serverRunning: !!h, appConnected: h?.appConnected ?? false, permission: cfg.permission, pid: readPid(), stats: h?.stats };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      process.exitCode = h ? (h.appConnected ? 0 : 2) : 1;
      return;
    }
    case 'ops': {
      const area = flag('area');
      for (const o of OPERATIONS.filter((x) => !area || x.area === area)) process.stdout.write(`${o.name.padEnd(34)} ${o.kind.padEnd(12)} ${o.title}\n`);
      return;
    }
    case 'call': {
      const op = argv[1];
      const def = op ? OPERATION_BY_NAME.get(op) : undefined;
      if (!def) { err(`Unknown operation "${op ?? ''}". Try: lifeos-agent ops`); process.exitCode = 1; return; }
      let input: Record<string, unknown> = {};
      const jsonArg = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
      if (jsonArg) input = JSON.parse(jsonArg) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (let k = jsonArg ? 3 : 2; k < argv.length; k++) {
        const a = argv[k];
        if (a.startsWith('--') && a !== '--idempotency-key') { params.append(a.slice(2), argv[k + 1] ?? 'true'); k++; } else if (a === '--idempotency-key') k++;
      }
      input = { ...input, ...inputFromQuery(def.input, params) };
      const h = await health(cfg);
      if (!h) { err('lifeos-agent server is not running. Start it with: lifeos-agent serve (or scripts\\windows\\lifeos-agent-start.cmd)'); process.exitCode = 2; return; }
      const r = await remoteExec(cfg)(def.name, input, { client: 'cli', idempotencyKey: flag('idempotency-key') });
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      process.exitCode = r.ok ? 0 : r.error.code === 'APP_NOT_CONNECTED' ? 2 : 1;
      return;
    }
    case 'token': {
      if (has('rotate')) { process.stdout.write(`${rotateToken()}\n`); err('Token rotated. Paste the new token into LifeOS → Settings → Agents, and restart the server.'); return; }
      process.stdout.write(`${cfg.token}\n`);
      return;
    }
    case 'permission': {
      const level = argv[1];
      if (!['read', 'write', 'full'].includes(level ?? '')) { err('Usage: lifeos-agent permission <read|write|full>'); process.exitCode = 1; return; }
      saveConfig({ ...loadConfig(), permission: level as AgentConfig['permission'] });
      process.stdout.write(`Server permission set to ${level}. Restart the server to apply.\n`);
      return;
    }
    case 'openapi': process.stdout.write(`${JSON.stringify(buildOpenApi(`http://127.0.0.1:${cfg.port}`), null, 2)}\n`); return;
    case 'config': {
      const c = mcpConfig(argv[1] ?? 'claude');
      process.stdout.write(typeof c === 'string' ? `${c}\n` : `${JSON.stringify(c, null, 2)}\n`);
      return;
    }
    case 'stop': {
      try {
        const r = await fetch(`http://127.0.0.1:${cfg.port}/api/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(2000) });
        process.stdout.write(r.ok ? 'Stopped.\n' : `Server answered ${r.status}.\n`);
      } catch {
        const pid = readPid();
        if (pid) { try { process.kill(pid); process.stdout.write(`Stopped (pid ${pid}).\n`); } catch { process.stdout.write('Not running.\n'); } clearPid(); } else process.stdout.write('Not running.\n');
      }
      return;
    }
    default:
      process.stdout.write([
        'lifeos-agent — local MCP server, REST API and CLI for LifeOS', '',
        '  start [--port 7457] [--permission read|write|full]   start the server in the background',
        '  serve [--port 7457] [--permission read|write|full]   run the server in this terminal',
        '  mcp                                                  MCP over stdio (desktop agents)',
        '  status                                               server / app connection status',
        '  ops [--area schedule]                                list operations',
        '  call <op> [json] [--field value ...]                 run one operation',
        '  token [--rotate]                                     print / rotate the access token',
        '  permission <read|write|full>                         server permission ceiling',
        '  openapi                                              print the OpenAPI document',
        '  config <claude|cursor|vscode|claude-code|http>       MCP client configuration',
        '  stop                                                 stop the server', '',
        `Config: ${configPath()}`, '',
      ].join('\n'));
  }
}

main().catch((e) => { err(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
