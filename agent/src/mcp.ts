import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { OPERATIONS, OPERATION_BY_NAME, type AgentResult } from '../../src/agent/catalog';

export type Exec = (op: string, input: unknown, opts: { client: string; idempotencyKey?: string }) => Promise<AgentResult>;

export const SERVER_INFO = { name: 'lifeos', title: 'LifeOS', version: '1.0.0' };

const INSTRUCTIONS = [
  'LifeOS is the user\'s personal operating system: schedule (time blocks), tasks, checklists, goals & milestones, projects, skills, earning (clients, invoices, partial payments), research, exams, habits, focus sessions, XP and achievements.',
  'Start with `dashboard_get` to see today. IDs come from list/get tools; tracker IDs (areas/subjects) from `trackers_list`.',
  'Date-times without an offset are LOCAL time (e.g. 2026-11-19T14:30). Dates are YYYY-MM-DD.',
  'Completing a block or task is idempotent and awards XP exactly once — only mark things complete when the user actually did them.',
  'Destructive tools need "confirm": true — ask the user first. Pass `expectedUpdatedAt` on updates to avoid overwriting edits the user made in the app; on CONFLICT, re-read and retry.',
  'For writes you may pass `idempotencyKey` so a retry after a timeout cannot apply twice.',
  'If a tool returns APP_NOT_CONNECTED, ask the user to open LifeOS in their browser (Settings → Agents → Allow agent access).',
].join('\n');

function toolInputSchema(name: string) {
  const def = OPERATION_BY_NAME.get(name)!;
  const schema = JSON.parse(JSON.stringify(def.input)) as { properties?: Record<string, unknown> };
  if (def.kind !== 'read') {
    schema.properties = { ...(schema.properties ?? {}), idempotencyKey: { type: 'string', maxLength: 200, description: 'Optional. Reuse the same key when retrying so the change is applied at most once.' } };
  }
  return schema;
}

function asToolResult(result: AgentResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const RESOURCES = [
  { uri: 'lifeos://dashboard/today', name: 'Today', description: 'Dashboard for today: progress, current/next block, overdue, streak, level.', op: 'dashboard_get', input: () => ({}) },
  { uri: 'lifeos://schedule/today', name: 'Today\'s schedule', description: 'All blocks today with status and conflicts.', op: 'schedule_get_day', input: () => ({}) },
  { uri: 'lifeos://tasks/overdue', name: 'Overdue tasks', description: 'Open tasks past their due date.', op: 'tasks_overdue', input: () => ({}) },
  { uri: 'lifeos://tasks/upcoming', name: 'Upcoming tasks', description: 'Tasks due in the next 7 days.', op: 'tasks_upcoming', input: () => ({}) },
  { uri: 'lifeos://goals', name: 'Goals', description: 'Goals with progress and milestones.', op: 'goals_list', input: () => ({}) },
  { uri: 'lifeos://trackers', name: 'Areas & subjects', description: 'Tracker IDs used across the app.', op: 'trackers_list', input: () => ({}) },
] as const;

const PROMPTS = [
  {
    name: 'plan_my_day', title: 'Plan my day',
    description: 'Review today and propose a realistic plan; apply only after confirmation.',
    arguments: [{ name: 'focus', description: 'Optional: what matters most today.', required: false }],
    text: (a: Record<string, string>) => `Help me plan today in LifeOS.${a.focus ? ` Priority: ${a.focus}.` : ''}
1. Call dashboard_get and schedule_get_day to see what is already fixed.
2. Call tasks_overdue and tasks_upcoming.
3. Call plan_preview for today and explain the proposal in a short table (time, task, why), plus anything unplaced.
4. Ask me before calling plan_apply. Never mark anything complete on my behalf.`,
  },
  {
    name: 'weekly_review', title: 'Weekly review',
    description: 'Summarise the week from real data and suggest next week\'s focus.',
    arguments: [],
    text: () => `Run my weekly review in LifeOS: call progress_get (period "week"), analytics_summary for the last 7 days, analytics_time_allocation, goals_list and projects_list. Report completion rate, where time went vs. goals, wins, slips and overdue items, then suggest 3 priorities for next week. Do not change anything unless I ask.`,
  },
  {
    name: 'close_the_day', title: 'Close the day',
    description: 'Go through today\'s blocks with me and log what actually happened.',
    arguments: [],
    text: () => `Help me close today in LifeOS. Call schedule_get_day and list blocks that are still "planned" or "in_progress" and already ended. For each one ask me whether it happened; only then call schedule_complete_block or schedule_skip_block. Finish with dashboard_get.`,
  },
] as const;

export function createMcpServer(exec: Exec, transportLabel: string): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: INSTRUCTIONS,
  });
  const client = () => `mcp:${server.getClientVersion()?.name ?? transportLabel}`;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: OPERATIONS.map((op) => ({
      name: op.name,
      title: op.title,
      description: `${op.description}${op.kind === 'destructive' ? ' DESTRUCTIVE: requires "confirm": true after the user agrees.' : ''}`,
      inputSchema: toolInputSchema(op.name) as { type: 'object'; properties?: Record<string, object> },
      annotations: {
        title: op.title,
        readOnlyHint: op.kind === 'read',
        destructiveHint: op.kind === 'destructive',
        idempotentHint: op.idempotent,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = { ...((req.params.arguments ?? {}) as Record<string, unknown>) };
    const idempotencyKey = typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined;
    delete args.idempotencyKey;
    if (!OPERATION_BY_NAME.has(name)) {
      return asToolResult({ ok: false, error: { code: 'UNKNOWN_OPERATION', message: `Unknown tool "${name}".` } });
    }
    return asToolResult(await exec(name, args, { client: client(), idempotencyKey }));
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      ...RESOURCES.map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: 'application/json' })),
      { uri: 'lifeos://operations', name: 'Operation catalog', description: 'Every operation with kind and input schema.', mimeType: 'application/json' },
    ],
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      { uriTemplate: 'lifeos://schedule/{date}', name: 'Schedule for a date', description: 'Blocks on a date (YYYY-MM-DD).', mimeType: 'application/json' },
      { uriTemplate: 'lifeos://dashboard/{date}', name: 'Dashboard for a date', description: 'Day summary for a date (YYYY-MM-DD).', mimeType: 'application/json' },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    let result: AgentResult;
    const fixed = RESOURCES.find((r) => r.uri === uri);
    const sched = /^lifeos:\/\/schedule\/(\d{4}-\d{2}-\d{2})$/.exec(uri);
    const dash = /^lifeos:\/\/dashboard\/(\d{4}-\d{2}-\d{2})$/.exec(uri);
    if (uri === 'lifeos://operations') {
      result = { ok: true, data: OPERATIONS.map((o) => ({ name: o.name, title: o.title, area: o.area, kind: o.kind, idempotent: o.idempotent, input: o.input })) };
    } else if (fixed) {
      result = await exec(fixed.op, fixed.input(), { client: client() });
    } else if (sched) {
      result = await exec('schedule_get_day', { date: sched[1] }, { client: client() });
    } else if (dash) {
      result = await exec('dashboard_get', { date: dash[1] === 'today' ? today() : dash[1] }, { client: client() });
    } else {
      throw new Error(`Unknown resource ${uri}`);
    }
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: [...p.arguments] })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = PROMPTS.find((x) => x.name === req.params.name);
    if (!p) throw new Error(`Unknown prompt ${req.params.name}`);
    return { description: p.description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text((req.params.arguments ?? {}) as Record<string, string>) } }] };
  });

  return server;
}
