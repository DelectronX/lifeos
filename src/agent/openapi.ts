import { DEFAULT_AGENT_PORT, ERROR_CODES, OPERATIONS, type OperationDef } from './catalog';
import type { JsonSchema } from './schema';

/** HTTP status used by the REST API for each error code. */
export const HTTP_STATUS: Record<keyof typeof ERROR_CODES, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  UNKNOWN_OPERATION: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  CONFIRMATION_REQUIRED: 428,
  INTERNAL_ERROR: 500,
  APP_NOT_CONNECTED: 503,
  TIMEOUT: 504,
};

/** JSON Schema → OpenAPI 3.1 (which IS JSON Schema 2020-12; only `format` nuances). */
function toOas(schema: JsonSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

const envelopeOk = {
  type: 'object', required: ['ok', 'data'],
  properties: {
    ok: { const: true },
    data: { description: 'Operation result (shape documented per operation description).' },
    meta: { type: 'object', description: 'Pagination: total, limit, offset, hasMore; `replayed: true` for idempotent replays.' },
  },
};
const envelopeErr = {
  type: 'object', required: ['ok', 'error'],
  properties: {
    ok: { const: false },
    error: {
      type: 'object', required: ['code', 'message'],
      properties: { code: { enum: Object.keys(ERROR_CODES) }, message: { type: 'string' }, details: {} },
    },
  },
};

function operationObject(op: OperationDef) {
  return {
    operationId: op.name,
    summary: op.title,
    description: `${op.description}\n\nKind: **${op.kind}**${op.idempotent ? ' · idempotent' : ''}.${op.kind === 'destructive' ? ' Requires `"confirm": true`.' : ''}`,
    tags: [op.area],
    'x-lifeos-kind': op.kind,
    'x-lifeos-idempotent': op.idempotent,
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: envelopeOk } } },
      default: { description: 'Error — see `error.code`.', content: { 'application/json': { schema: envelopeErr } } },
    },
  };
}

export function buildOpenApi(baseUrl = `http://127.0.0.1:${DEFAULT_AGENT_PORT}`): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const op of OPERATIONS) {
    const post = {
      ...operationObject(op),
      parameters: op.kind === 'read' ? [] : [{
        name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 200 },
        description: 'Repeat-safe key: a retried request with the same key returns the first result instead of running again.',
      }],
      requestBody: { required: false, content: { 'application/json': { schema: toOas(op.input) } } },
    };
    const entry: Record<string, unknown> = { post };
    if (op.kind === 'read') {
      entry.get = {
        ...operationObject(op),
        operationId: `${op.name}_get`,
        parameters: [{ name: 'input', in: 'query', required: false, description: 'The JSON input, URL-encoded. Individual fields may also be passed as query parameters.', schema: { type: 'string' } }],
      };
    }
    paths[`/api/v1/ops/${op.name}`] = entry;
  }
  paths['/api/v1/health'] = { get: { operationId: 'health', summary: 'Server health and whether a LifeOS window is connected', security: [], responses: { 200: { description: 'OK' } } } };
  paths['/api/v1/operations'] = { get: { operationId: 'list_operations', summary: 'The operation catalog (names, kinds, input schemas)', responses: { 200: { description: 'OK' } } } };

  return {
    openapi: '3.1.0',
    info: {
      title: 'LifeOS Local Agent API',
      version: '1.0.0',
      description: [
        'Structured, local-only API for operating LifeOS. Every operation runs inside the LifeOS app through the same services as its UI, against the same database.',
        'Auth: `Authorization: Bearer <token>` — the token is in %LOCALAPPDATA%\\LifeOS\\agent.json (`lifeos-agent token`).',
        'Times: date-times without an offset are LOCAL time (e.g. `2026-11-19T14:30`). Dates are `YYYY-MM-DD`.',
        'Concurrency: pass `expectedUpdatedAt` on updates to get CONFLICT instead of overwriting a newer edit.',
        'Safety: destructive operations require `"confirm": true`; the agent permission level (read / write / full) is enforced by both server and app.',
      ].join('\n\n'),
    },
    servers: [{ url: baseUrl, description: 'Local machine only' }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    tags: [...new Set(OPERATIONS.map((o) => o.area))].map((name) => ({ name })),
    paths,
  };
}
