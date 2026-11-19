import { create } from 'zustand';
import { BRIDGE_PROTOCOL, DEFAULT_AGENT_PORT, OPERATION_BY_NAME, type AgentResult, type PermissionLevel } from './catalog';
import { dispatch } from './dispatcher';
import { toast } from '@/state/toastStore';

/**
 * Connects this LifeOS window to the local agent server (lifeos-agent) so
 * external AI agents can operate the app. Off by default; the user enables it
 * in Settings → Agents and pastes the token printed by `lifeos-agent token`.
 *
 * Transport: the server cannot reach into the browser, so the tab opens a
 * Server-Sent-Events stream (`/bridge/events`) and receives requests on it;
 * answers go back with `POST /bridge/result`. EventSource reconnects by itself
 * when the server restarts. Settings live in localStorage — the token is a
 * device secret and must never end up in exported backups.
 */

export interface AgentConnectionPrefs {
  enabled: boolean;
  url: string;
  token: string;
  /** App-side ceiling; the effective level is the stricter of this and the server's. */
  permission: PermissionLevel;
  /** Show a quiet notification for each change an agent makes. */
  announce: boolean;
}

const KEY = 'lifeos.agent';
export const DEFAULT_AGENT_PREFS: AgentConnectionPrefs = {
  enabled: false, url: `http://127.0.0.1:${DEFAULT_AGENT_PORT}`, token: '', permission: 'write', announce: true,
};

export function readAgentPrefs(): AgentConnectionPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_AGENT_PREFS, ...(JSON.parse(raw) as Partial<AgentConnectionPrefs>) } : DEFAULT_AGENT_PREFS;
  } catch { return DEFAULT_AGENT_PREFS; }
}

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'unreachable' | 'unauthorized';

interface BridgeState {
  prefs: AgentConnectionPrefs;
  status: BridgeStatus;
  detail: string | null;
  handled: number;
  lastOp: { op: string; ok: boolean; at: number } | null;
  setPrefs: (p: Partial<AgentConnectionPrefs>) => void;
}

export const useAgentBridge = create<BridgeState>((set, get) => ({
  prefs: readAgentPrefs(),
  status: 'off',
  detail: null,
  handled: 0,
  lastOp: null,
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
    set({ prefs });
    restartAgentBridge();
  },
}));

const RANK: Record<PermissionLevel, number> = { read: 0, write: 1, full: 2 };
const stricter = (a: PermissionLevel, b: PermissionLevel): PermissionLevel => (RANK[a] <= RANK[b] ? a : b);

let source: EventSource | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(status: BridgeStatus, detail: string | null = null) {
  useAgentBridge.setState({ status, detail });
}

/** Checks the server and the token before opening the stream, for clear errors. */
async function probe(prefs: AgentConnectionPrefs): Promise<boolean> {
  try {
    const h = await fetch(`${prefs.url}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    if (!h.ok) { setStatus('unreachable', `Server answered ${h.status}.`); return false; }
    const ops = await fetch(`${prefs.url}/api/v1/operations`, { headers: { Authorization: `Bearer ${prefs.token}` }, signal: AbortSignal.timeout(3000) });
    if (ops.status === 401) { setStatus('unauthorized', 'The token was rejected. Run `lifeos-agent token` and paste it again.'); return false; }
    return true;
  } catch {
    setStatus('unreachable', 'The agent server is not running. Start it with scripts\\windows\\lifeos-agent-start.cmd (or `npm run agent:start`).');
    return false;
  }
}

async function answer(prefs: AgentConnectionPrefs, id: string, result: AgentResult) {
  try {
    await fetch(`${prefs.url}/bridge/result`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${prefs.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, result }),
    });
  } catch (e) {
    console.error('[agent] could not deliver result', e);
  }
}

export function startAgentBridge(): void {
  stopAgentBridge();
  const prefs = useAgentBridge.getState().prefs;
  if (!prefs.enabled) { setStatus('off'); return; }
  if (!prefs.token) { setStatus('unauthorized', 'Paste the access token from `lifeos-agent token`.'); return; }
  if (typeof EventSource === 'undefined') { setStatus('unreachable', 'This browser cannot hold the agent connection.'); return; }
  setStatus('connecting');

  void probe(prefs).then((good) => {
    if (!good) {
      // Keep trying quietly — the server may simply not be started yet.
      probeTimer = setTimeout(startAgentBridge, 15_000);
      return;
    }
    const label = encodeURIComponent(`LifeOS · ${navigator.userAgent.includes('Edg') ? 'Edge' : navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Browser'}`);
    source = new EventSource(`${prefs.url}/bridge/events?token=${encodeURIComponent(prefs.token)}&label=${label}`);
    source.addEventListener('hello', (e) => {
      const hello = JSON.parse((e as MessageEvent).data) as { protocol: number };
      if (hello.protocol !== BRIDGE_PROTOCOL) setStatus('unreachable', `Server speaks bridge protocol v${hello.protocol}; this app speaks v${BRIDGE_PROTOCOL}. Rebuild the agent (npm run agent:build).`);
      else setStatus('connected');
    });
    source.addEventListener('request', (e) => {
      const req = JSON.parse((e as MessageEvent).data) as { id: string; op: string; input: unknown; client: string; idempotencyKey?: string; permission: PermissionLevel };
      const permission = stricter(req.permission, useAgentBridge.getState().prefs.permission);
      void dispatch({ op: req.op, input: req.input, client: req.client, idempotencyKey: req.idempotencyKey, permission }).then(async (result) => {
        await answer(prefs, req.id, result);
        useAgentBridge.setState((s) => ({ handled: s.handled + 1, lastOp: { op: req.op, ok: result.ok, at: Date.now() } }));
        const def = OPERATION_BY_NAME.get(req.op);
        if (def && def.kind !== 'read' && useAgentBridge.getState().prefs.announce) {
          announce({ title: def.title, ok: result.ok, client: req.client.replace(/^mcp:/, ''), error: result.ok ? undefined : result.error.message });
        }
      });
    });
    source.onerror = () => {
      // EventSource retries on its own; reflect the gap honestly.
      if (useAgentBridge.getState().status === 'connected') setStatus('connecting', 'Connection lost — retrying…');
    };
  });
}

/*
 * Announcements are coalesced: a burst of agent changes (e.g. importing a
 * plan) becomes ONE summary banner/notification instead of one per change.
 * A lone change still reads "Agent · Create a task".
 */
interface Announcement { title: string; ok: boolean; client: string; error?: string }
let pending: Announcement[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const ANNOUNCE_IDLE_MS = 1500;

function announce(a: Announcement): void {
  pending.push(a);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushAnnouncements, ANNOUNCE_IDLE_MS);
}

function flushAnnouncements(): void {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;
  const failed = batch.filter((a) => !a.ok);
  const clients = [...new Set(batch.map((a) => a.client))].join(', ');
  if (batch.length === 1) {
    const [a] = batch;
    toast.notify({
      title: a!.ok ? `Agent · ${a!.title}` : `Agent · ${a!.title} failed`,
      description: a!.ok ? a!.client : a!.error, tone: a!.ok ? 'default' : 'warning', category: 'system', silent: a!.ok,
    });
    return;
  }
  const kinds = [...new Set(batch.map((a) => a.title))];
  toast.notify({
    title: `Agent made ${batch.length} changes${failed.length ? ` · ${failed.length} failed` : ''}`,
    description: `${kinds.slice(0, 3).join(', ')}${kinds.length > 3 ? ` +${kinds.length - 3} more` : ''} — ${clients}`,
    tone: failed.length ? 'warning' : 'default', category: 'system', silent: failed.length === 0,
  });
}

export function stopAgentBridge(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  source?.close();
  source = null;
}

export function restartAgentBridge(): void {
  startAgentBridge();
}
