import type { ServerResponse } from 'node:http';
import { BRIDGE_PROTOCOL, type AgentResult, type PermissionLevel } from '../../src/agent/catalog';
import { requestId } from './config';

/**
 * The bridge to the LifeOS app running in a browser tab.
 *
 * LifeOS keeps its data in the browser (IndexedDB), so the app itself is the
 * executor: a tab with "Agent access" enabled opens a Server-Sent-Events
 * stream to this server, receives operation requests on it, runs them through
 * its dispatcher (the same services the UI uses) and POSTs the result back.
 *
 * Only the most recently connected tab serves requests; older ones are kept as
 * fall-backs if it disconnects.
 */
interface AppClient {
  id: string;
  res: ServerResponse;
  connectedAt: number;
  label: string;
  heartbeat: ReturnType<typeof setInterval>;
}

interface Pending {
  resolve: (r: AgentResult) => void;
  timer: ReturnType<typeof setTimeout>;
  clientId: string;
}

export interface BridgeCall {
  op: string;
  input: unknown;
  client: string;
  idempotencyKey?: string;
  permission: PermissionLevel;
}

export class Bridge {
  private clients: AppClient[] = [];
  private pending = new Map<string, Pending>();
  stats = { served: 0, failed: 0, lastRequestAt: 0 };

  constructor(private timeoutMs: number, private log: (msg: string) => void) {}

  get connected(): boolean { return this.clients.length > 0; }
  info() {
    return this.clients.map((c) => ({ id: c.id, label: c.label, connectedAt: new Date(c.connectedAt).toISOString() }));
  }

  attach(res: ServerResponse, label: string): void {
    const id = requestId();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ protocol: BRIDGE_PROTOCOL, clientId: id })}\n\n`);
    const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);
    const client: AppClient = { id, res, connectedAt: Date.now(), label, heartbeat };
    this.clients.push(client);
    this.log(`app connected (${label}); ${this.clients.length} window(s)`);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients = this.clients.filter((c) => c !== client);
      // Anything in flight on that tab fails fast rather than timing out.
      for (const [rid, p] of this.pending) {
        if (p.clientId === id) {
          clearTimeout(p.timer);
          this.pending.delete(rid);
          p.resolve({ ok: false, error: { code: 'APP_NOT_CONNECTED', message: 'The LifeOS window closed while handling the request. It may or may not have been applied; re-read before retrying.' } });
        }
      }
      this.log(`app disconnected (${label}); ${this.clients.length} window(s)`);
    });
  }

  call(req: BridgeCall): Promise<AgentResult> {
    const client = this.clients[this.clients.length - 1];
    if (!client) {
      return Promise.resolve({ ok: false, error: { code: 'APP_NOT_CONNECTED', message: 'No LifeOS window is connected. Open LifeOS in your browser and turn on Settings → Agents → Allow agent access.' } });
    }
    const id = requestId();
    this.stats.lastRequestAt = Date.now();
    return new Promise<AgentResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stats.failed++;
        resolve({ ok: false, error: { code: 'TIMEOUT', message: `LifeOS did not answer within ${Math.round(this.timeoutMs / 1000)} s. The tab may be asleep in the background; bring it to the front and retry (mutations are safe to retry with the same idempotencyKey).` } });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer, clientId: client.id });
      client.res.write(`event: request\ndata: ${JSON.stringify({ id, ...req })}\n\n`);
    });
  }

  resolve(id: string, result: AgentResult): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (result.ok) this.stats.served++; else this.stats.failed++;
    p.resolve(result);
    return true;
  }

  close(): void {
    for (const c of this.clients) { clearInterval(c.heartbeat); c.res.end(); }
    this.clients = [];
  }
}
