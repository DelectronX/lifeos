import { db, type AuditEntry } from '@/db/db';
import { newId } from '@/lib/id';
import { runAs } from './actor';
import { OPERATION_BY_NAME, permits, type AgentResult, type PermissionLevel } from './catalog';
import { AgentError } from './errors';
import { HANDLERS } from './handlers';
import { applyDefaults, validate } from './schema';

/**
 * The agent dispatcher — the ONLY way agent requests reach the app.
 *
 * For every request it:
 *  1. resolves the operation from the catalog (UNKNOWN_OPERATION),
 *  2. checks the agent's permission level (PERMISSION_DENIED),
 *  3. validates the input against the operation's JSON schema (VALIDATION_ERROR),
 *  4. requires `confirm: true` for destructive operations (CONFIRMATION_REQUIRED),
 *  5. replays the stored result for a repeated `idempotencyKey` instead of
 *     running the mutation twice,
 *  6. runs operations ONE AT A TIME (a FIFO queue) with the actor set to
 *     "agent", so concurrent agent calls can't interleave half-way and every
 *     event they write is tagged as agent-initiated,
 *  7. maps failures to stable error codes, and
 *  8. writes an audit entry for every mutation (success or failure).
 *
 * Handlers call the same services the UI calls; there is no second copy of
 * business logic. Frontend edits and agent edits meet in the same Dexie
 * transactions, and `expectedUpdatedAt` lets an agent detect that the user
 * changed a record since it was read (CONFLICT).
 */

export interface AgentRequest {
  op: string;
  input?: unknown;
  /** Who is calling, as reported by the server: "mcp:<client>", "rest", "cli". */
  client?: string;
  /** Repeat-safe key for mutations: the same key returns the first result. */
  idempotencyKey?: string;
  /** Effective permission level (the stricter of server and app settings). */
  permission: PermissionLevel;
}

let queue: Promise<unknown> = Promise.resolve();
const AUDIT_CAP = 2000;

function truncate(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return depth > 3 ? `[${value.length} items]` : value.slice(0, 50).map((v) => truncate(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncate(v, depth + 1)]));
  }
  return value;
}

function cacheable(result: AgentResult): unknown {
  try {
    const json = JSON.stringify(result);
    return json.length <= 20_000 ? JSON.parse(json) : { ok: result.ok, truncated: true };
  } catch {
    return undefined;
  }
}

async function audit(entry: Omit<AuditEntry, 'id' | 'source'>): Promise<void> {
  try {
    await db.auditLog.add({ id: newId('aud'), source: 'agent', ...entry });
    const count = await db.auditLog.count();
    if (count > AUDIT_CAP + 100) {
      const old = await db.auditLog.orderBy('at').limit(count - AUDIT_CAP).primaryKeys();
      await db.auditLog.bulkDelete(old);
    }
  } catch (e) {
    console.error('[agent] audit write failed', e);
  }
}

export function dispatch(req: AgentRequest): Promise<AgentResult> {
  const run = queue.then(() => execute(req), () => execute(req));
  queue = run.catch(() => undefined);
  return run;
}

async function execute(req: AgentRequest): Promise<AgentResult> {
  const started = performance.now();
  const def = OPERATION_BY_NAME.get(req.op);
  if (!def) return { ok: false, error: { code: 'UNKNOWN_OPERATION', message: `Unknown operation "${req.op}". Call the tools list to see what exists.` } };

  const client = req.client ?? 'unknown';
  const raw = req.input ?? {};
  const fail = (code: AgentError['code'], message: string, details?: unknown): AgentResult => ({ ok: false, error: { code, message, details } });

  let result: AgentResult;
  let entity: { type: string; id: string } | undefined;

  if (!permits(req.permission, def.kind)) {
    result = fail('PERMISSION_DENIED', `"${def.name}" is a ${def.kind} operation; the agent's access level is "${req.permission}". Change it in LifeOS → Settings → Agents.`);
  } else {
    const issues = validate(def.input, raw);
    if (issues.length) {
      result = fail('VALIDATION_ERROR', issues.map((x) => `${x.path} ${x.message}`).join('; '), issues);
    } else if (def.kind === 'destructive' && (raw as { confirm?: unknown }).confirm !== true) {
      result = fail('CONFIRMATION_REQUIRED', `"${def.name}" permanently changes data. Repeat the call with "confirm": true once the user has agreed.`);
    } else {
      // Idempotent replay for mutations.
      if (def.kind !== 'read' && req.idempotencyKey) {
        const prior = await db.auditLog.where('idempotencyKey').equals(req.idempotencyKey).filter((e) => e.op === def.name && e.ok).first();
        if (prior?.result) {
          const replay = prior.result as AgentResult;
          return replay.ok ? { ...replay, meta: { ...(replay.meta ?? {}), replayed: true } } : replay;
        }
      }
      try {
        const input = applyDefaults(def.input, raw as Record<string, unknown>);
        const output = await runAs({ kind: 'agent', client, op: def.name }, () => HANDLERS[def.name]!(input, { client, permission: req.permission }));
        entity = output.entity;
        result = { ok: true, data: output.data, ...(output.meta ? { meta: output.meta } : {}) };
      } catch (e) {
        if (e instanceof AgentError) {
          result = fail(e.code, e.message, e.details);
        } else if (e instanceof Error && e.name === 'ConstraintError') {
          result = fail('CONFLICT', 'The change conflicts with existing data (unique constraint).', e.message);
        } else {
          console.error(`[agent] ${def.name} failed`, e);
          result = fail('INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
        }
      }
    }
  }

  if (def.kind !== 'read') {
    const inputObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    await audit({
      at: Date.now(), op: def.name, client, kind: def.kind, ok: result.ok,
      errorCode: result.ok ? undefined : result.error.code,
      entityType: entity?.type, entityId: entity?.id ?? (typeof inputObj.id === 'string' ? inputObj.id : undefined),
      input: truncate(raw), durationMs: Math.round(performance.now() - started),
      idempotencyKey: req.idempotencyKey, result: req.idempotencyKey && result.ok ? cacheable(result) : undefined,
    });
  }
  return result;
}

/** Every catalog operation must have a handler — checked by tests and at startup. */
export function missingHandlers(): string[] {
  return [...OPERATION_BY_NAME.keys()].filter((name) => !HANDLERS[name]);
}
