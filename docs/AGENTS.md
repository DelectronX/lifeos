# LifeOS for AI agents — MCP server, REST API, CLI

LifeOS can be operated end-to-end by external AI agents (Claude Desktop, Claude
Code, Cursor, VS Code, or any MCP client), through a local server on your PC.
Agents get the same operations as the app, against the same data, and both
stay in sync. Nothing is exposed beyond `127.0.0.1`.

- Operation reference: [`agent-operations.md`](agent-operations.md) (generated, 121 operations)
- OpenAPI 3.1: `http://127.0.0.1:7457/openapi.json` (or `node agent/dist/lifeos-agent.mjs openapi`)

## Architecture

```
 Claude Desktop / Code / Cursor ──stdio──┐
 any MCP client ───── Streamable HTTP ───┤
 scripts / curl ──────── REST ───────────┤   lifeos-agent (Node, 127.0.0.1:7457)
 terminal ─────────────── CLI ───────────┘     │  validates input against the catalog
                                               │  bearer-token auth, Host check, permission ceiling
                                               ▼
                                   app bridge (SSE ⇄ POST)
                                               │
                         LifeOS window (browser) ── dispatcher ── services ── IndexedDB
                                                   (validate · permission · confirm ·
                                                    idempotency · serial queue · audit)
```

LifeOS stores everything in the browser (IndexedDB) — a deliberate choice, so
the data never lives on a server. The open LifeOS window is therefore the
executor: it connects to the local server, receives requests, runs them
through **the same service layer the UI uses** and answers. There is no second
copy of any business logic, so an agent completing a block runs exactly the
code the Done button runs (XP, streaks, bonuses, linked task, achievements).

Source map:

| Piece | Where |
|---|---|
| Operation catalog (names, schemas, kinds) | `src/agent/catalog.ts` |
| JSON-Schema validator | `src/agent/schema.ts` |
| Handlers → existing services | `src/agent/handlers.ts` |
| Dispatcher (validation, permission, confirm, idempotency, queue, audit) | `src/agent/dispatcher.ts` |
| Browser side of the bridge | `src/agent/bridgeClient.ts` |
| Who-did-it tagging (`meta.source = "agent"`) | `src/agent/actor.ts` |
| OpenAPI generator | `src/agent/openapi.ts` |
| Server: HTTP / bridge / MCP / CLI | `agent/src/{http,bridge,mcp,main}.ts` → `agent/dist/lifeos-agent.mjs` |
| Audit log table (local only, not exported) | `db.auditLog` (Dexie v10) |

## Setup (Windows)

1. Build once: `npm run agent:build` (the start script also builds if needed).
2. Start the server: double-click **`scripts\windows\lifeos-agent-start.cmd`**
   (or `npm run agent:start`). It runs in the background, logs to
   `%LOCALAPPDATA%\LifeOS\agent.log`, and prints your access token.
3. In LifeOS → **Settings → Agents**: paste the token, turn on **Allow agent
   access**, pick a permission level. The status turns **Connected**.
4. Add LifeOS to your agent (below).

Stop: `scripts\windows\lifeos-agent-stop.cmd` (or `npm run agent:stop`).
Start at sign-in (optional): `scripts\windows\install-autostart.cmd`.
CLI shim: add `scripts\windows` to PATH and use `lifeos status`, `lifeos ops`, `lifeos call …`.

LifeOS keeps working normally with the server stopped or no agent connected —
the Agents panel just shows "Server not running", and the window reconnects by
itself within seconds when the server comes back.

## Connecting agents

Print a ready-made config with `node agent/dist/lifeos-agent.mjs config <claude|cursor|vscode|claude-code|http>`.
Examples are in `agent/examples/`.

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{ "mcpServers": { "lifeos": { "command": "node", "args": ["D:\\lifeos\\agent\\dist\\lifeos-agent.mjs", "mcp"] } } }
```

**Claude Code**: `claude mcp add lifeos -- node D:\lifeos\agent\dist\lifeos-agent.mjs mcp`

**Cursor** — `.cursor/mcp.json`: same shape as Claude Desktop.

**VS Code** — `.vscode/mcp.json`:

```json
{ "servers": { "lifeos": { "type": "stdio", "command": "node", "args": ["D:\\lifeos\\agent\\dist\\lifeos-agent.mjs", "mcp"] } } }
```

**HTTP MCP clients**: `http://127.0.0.1:7457/mcp` with header `Authorization: Bearer <token>`.

The stdio server reuses a running `lifeos-agent` if there is one; otherwise it
hosts the app bridge itself for as long as the agent session lasts.

## What agents can do

121 operations across: overview & progress, areas/subjects (trackers), schedule (CRUD, reschedule,
complete / incomplete, start, skip, cancel, conflicts, completion history,
automatic completion), recurring schedules, auto-plan (preview / apply /
undo), tasks, checklists, goals & milestones, achievements / XP / rewards (including creating custom achievements and rewards),
projects, skills, earning (clients, leads, invoices, partial payments,
summary), research (studies, manuscript sections, sources), exams, habits,
focus sessions, analytics (summary, time allocation, streaks, daily / weekly
review, activity log), settings and notification preferences, system info and
the audit log. MCP also exposes **resources** (`lifeos://dashboard/today`,
`lifeos://schedule/{date}`, `lifeos://tasks/overdue`, …) and **prompts**
(`plan_my_day`, `weekly_review`, `close_the_day`).

## Contract (for agents)

- **Responses**: `{ "ok": true, "data": …, "meta"?: { total, limit, offset, hasMore } }` or
  `{ "ok": false, "error": { "code", "message", "details"? } }`.
- **Error codes**: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`,
  `CONFIRMATION_REQUIRED`, `PERMISSION_DENIED`, `UNKNOWN_OPERATION`,
  `APP_NOT_CONNECTED`, `TIMEOUT`, `UNAUTHORIZED`, `INTERNAL_ERROR`
  (REST maps them to 400/404/409/428/403/404/503/504/401/500).
- **Times**: date-times without an offset are **local** (`2026-11-19T14:30`); dates are `YYYY-MM-DD`.
  Responses give both local ISO strings and epoch ms.
- **IDs** are stable strings; tracker IDs (areas / subjects) come from `trackers_list`.
- **Pagination**: `limit` (1–500, default 50) and `offset`; `meta.total` / `hasMore`.
- **Idempotency**: completing, setting a status, checking an item, ticking a
  milestone etc. are naturally idempotent (repeating returns `already_…` / `unchanged`).
  Any mutation also accepts an idempotency key (MCP: `idempotencyKey` argument;
  REST: `Idempotency-Key` header; CLI: `--idempotency-key`) — a retry with the
  same key returns the first result (`meta.replayed: true`) instead of running again.
- **Concurrency**: updates accept `expectedUpdatedAt` (the record's `updatedAt`
  you read). If the user edited it in the app since, you get `CONFLICT` and
  nothing is overwritten. Agent operations run one at a time in the app.
- **Safety**: destructive operations need `"confirm": true` — ask the user first.
- **Honesty**: only complete things the user actually did. Completion awards XP
  exactly once and is logged as agent-made.

## Security

- Binds `127.0.0.1` only (override with `--host` prints a warning). Requests with a
  non-loopback `Host` header are refused (DNS-rebinding guard).
- Every endpoint except `/api/v1/health` and `/openapi.json` requires the bearer
  token from `%LOCALAPPDATA%\LifeOS\agent.json` (created on first run, file mode 600;
  rotate with `lifeos-agent token --rotate`). The app stores its copy in
  localStorage only — never in settings or backups.
- Two permission ceilings, the stricter wins: the server's (`lifeos-agent permission
  <read|write|full>`, default write) and the app's (Settings → Agents, default
  "Read & edit"). Deletes need "Full".
- Every agent mutation (success or failure) is in the audit log (Settings →
  Agents, or `audit_log`), with operation, time, client, entity, input and outcome;
  events it caused are tagged `source: "agent"` in history.

## Limits (honest)

- A LifeOS window must be open on the PC (it can be minimised). If none is,
  agents get `APP_NOT_CONNECTED`.
- Background tabs are throttled by the browser; a request to a long-hidden tab
  can take a moment. Requests time out after 30 s (`TIMEOUT`; safe to retry with
  the same idempotency key).
- The iPad Home Screen app is not reachable by the PC server; agents operate the
  PC copy of LifeOS.

## Testing

- `npm test` — includes `src/agent/__tests__/agentApi.test.ts`, which drives **every**
  operation through the real dispatcher and services (and fails if a new operation
  is added without coverage), plus permission, idempotency, validation and
  concurrent frontend-vs-agent tests.
- `npm run agent:test` — live end-to-end against a running server and a connected
  LifeOS window, using the official MCP SDK client over stdio and Streamable HTTP,
  plus REST and the CLI. Cleans up after itself.
- `npm run agent:typecheck`, `node scripts/gen-agent-docs.mjs` (regenerates the reference).
