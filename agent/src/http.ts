import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OPERATION_BY_NAME, OPERATIONS, type AgentResult } from '../../src/agent/catalog';
import { validate, type JsonSchema } from '../../src/agent/schema';
import { buildOpenApi, HTTP_STATUS } from '../../src/agent/openapi';
import { Bridge } from './bridge';
import { createMcpServer, SERVER_INFO, type Exec } from './mcp';
import { handleClickUp } from './clickup';
import type { AgentConfig } from './config';

/**
 * One local HTTP server, bound to 127.0.0.1 by default:
 *
 *   GET  /api/v1/health              — no auth; is a LifeOS window connected?
 *   GET  /openapi.json               — no auth; the OpenAPI 3.1 document
 *   GET  /api/v1/operations          — the operation catalog
 *   POST /api/v1/ops/{name}          — run an operation (JSON body = input)
 *   GET  /api/v1/ops/{name}?…        — run a READ operation from query params
 *   POST|GET|DELETE /mcp             — MCP over Streamable HTTP (stateless)
 *   GET  /bridge/events?token=…      — the LifeOS tab's request stream (SSE)
 *   POST /bridge/result              — the LifeOS tab's answers
 *   POST /api/v1/shutdown            — graceful stop (used by the stop script)
 *   GET|POST /api/v1/clickup/{action} — ClickUp integration (see clickup.ts)
 *
 * Everything except health/openapi needs `Authorization: Bearer <token>`
 * (the SSE stream takes it as ?token= because EventSource cannot set headers).
 * Requests whose Host header is not loopback are refused (DNS-rebinding guard).
 */

const MAX_BODY = 1_000_000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function statusFor(r: AgentResult): number {
  return r.ok ? 200 : HTTP_STATUS[r.error.code] ?? 500;
}

/** Coerces query-string values using the operation schema (numbers, booleans, arrays). */
export function inputFromQuery(schema: JsonSchema, params: URLSearchParams): Record<string, unknown> {
  const raw = params.get('input');
  if (raw) return JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const values = params.getAll(key);
    if (!values.length) continue;
    const types = Array.isArray(sub.type) ? sub.type : sub.type ? [sub.type] : [];
    const coerce = (v: string, s: JsonSchema): unknown => {
      const t = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
      if (t.includes('integer') || t.includes('number')) return Number(v);
      if (t.includes('boolean')) return v === 'true' || v === '1';
      if (s.enum && s.enum.some((e) => typeof e === 'number')) return Number(v);
      return v;
    };
    out[key] = types.includes('array') ? values.flatMap((v) => v.split(',')).map((v) => coerce(v, sub.items ?? {})) : coerce(values[0], sub);
  }
  return out;
}

export interface RunningServer { http: HttpServer; bridge: Bridge; exec: Exec; close: () => Promise<void> }

export function startHttpServer(cfg: AgentConfig, log: (m: string) => void, onShutdown: () => void): Promise<RunningServer> {
  const bridge = new Bridge(cfg.timeoutSeconds * 1000, log);
  const exec: Exec = (op, input, { client, idempotencyKey }) => {
    const def = OPERATION_BY_NAME.get(op);
    if (!def) return Promise.resolve({ ok: false, error: { code: 'UNKNOWN_OPERATION', message: `Unknown operation "${op}".` } });
    // Validate here too, so bad input never reaches the app.
    const issues = validate(def.input, input ?? {});
    if (issues.length) return Promise.resolve({ ok: false, error: { code: 'VALIDATION_ERROR', message: issues.map((x) => `${x.path} ${x.message}`).join('; '), details: issues } });
    return bridge.call({ op, input: input ?? {}, client, idempotencyKey, permission: cfg.permission });
  };

  const allowedHosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`]);
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') allowedHosts.add(`${cfg.host}:${cfg.port}`);
  const authed = (req: IncomingMessage, url: URL): boolean => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') ?? '';
    return token.length > 0 && safeEqual(token, cfg.token);
  };

  const http = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (!allowedHosts.has(req.headers.host ?? '')) { json(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Host not allowed.' } }); return; }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      if (path === '/api/v1/health') {
        json(res, 200, { ok: true, server: SERVER_INFO, appConnected: bridge.connected, windows: bridge.info().length, permission: cfg.permission, operations: OPERATIONS.length, stats: bridge.stats });
        return;
      }
      if (path === '/openapi.json') { json(res, 200, buildOpenApi(`http://127.0.0.1:${cfg.port}`)); return; }

      if (!authed(req, url)) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="lifeos"');
        json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or wrong bearer token. Run `lifeos-agent token`.' } });
        return;
      }

      if (path === '/bridge/events' && req.method === 'GET') {
        bridge.attach(res, url.searchParams.get('label') ?? 'LifeOS');
        return;
      }
      if (path === '/bridge/result' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { id: string; result: AgentResult };
        json(res, bridge.resolve(body.id, body.result) ? 200 : 404, { ok: true });
        return;
      }
      if (path === '/api/v1/operations') {
        json(res, 200, { ok: true, data: OPERATIONS });
        return;
      }
      const m = /^\/api\/v1\/ops\/([a-z0-9_]+)$/.exec(path);
      if (m) {
        const def = OPERATION_BY_NAME.get(m[1]);
        if (!def) { json(res, 404, { ok: false, error: { code: 'UNKNOWN_OPERATION', message: `Unknown operation "${m[1]}".` } }); return; }
        let input: unknown = {};
        if (req.method === 'GET') {
          if (def.kind !== 'read') { json(res, 405, { ok: false, error: { code: 'VALIDATION_ERROR', message: `${def.name} changes data; use POST.` } }); return; }
          input = inputFromQuery(def.input, url.searchParams);
        } else if (req.method === 'POST') {
          const body = await readBody(req);
          input = body.trim() ? JSON.parse(body) : {};
        } else { json(res, 405, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Use GET or POST.' } }); return; }
        const client = String(req.headers['x-lifeos-client'] ?? 'rest');
        const idem = req.headers['idempotency-key'];
        const r = await exec(def.name, input, { client, idempotencyKey: typeof idem === 'string' ? idem : undefined });
        json(res, statusFor(r), r);
        return;
      }
      if (path === '/mcp') {
        // Stateless Streamable HTTP: a fresh server + transport per request.
        const server = createMcpServer(exec, 'http');
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || 'null') : undefined;
        await transport.handleRequest(req, res, body);
        return;
      }
      const cu = /^\/api\/v1\/clickup\/([a-z-]+)$/.exec(path);
      if (cu) { await handleClickUp(req, res, cu[1]!, url, () => readBody(req), cfg.permission, log); return; }
      if (path === '/api/v1/shutdown' && req.method === 'POST') {
        json(res, 200, { ok: true, message: 'Shutting down.' });
        setTimeout(onShutdown, 50);
        return;
      }
      json(res, 404, { ok: false, error: { code: 'UNKNOWN_OPERATION', message: `No route ${req.method} ${path}.` } });
    } catch (e) {
      if (e instanceof SyntaxError) { json(res, 400, { ok: false, error: { code: 'VALIDATION_ERROR', message: `Invalid JSON: ${e.message}` } }); return; }
      log(`error on ${req.method} ${path}: ${e instanceof Error ? e.stack : String(e)}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) } });
    }
  });
  http.keepAliveTimeout = 65_000;

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(cfg.port, cfg.host, () => {
      http.off('error', reject);
      resolve({
        http, bridge, exec,
        close: () => new Promise<void>((r) => { bridge.close(); http.closeAllConnections?.(); http.close(() => r()); }),
      });
    });
  });
}
