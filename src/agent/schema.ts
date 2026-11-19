/**
 * Minimal JSON-Schema (draft 2020-12 subset) — enough to describe every agent
 * operation precisely and to validate inputs identically in the browser
 * (dispatcher) and in Node (MCP / REST server). Pure, dependency-free.
 */
export interface JsonSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null' | Array<'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'>;
  description?: string;
  enum?: ReadonlyArray<string | number | boolean | null>;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: 'date' | 'date-time' | 'time' | 'uri';
  default?: unknown;
  examples?: unknown[];
}

export interface ValidationIssue { path: string; message: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

/** Validates `value` against `schema`. Returns every issue found (empty = valid). */
export function validate(schema: JsonSchema, value: unknown, path = '$'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (message: string, p = path) => issues.push({ path: p, message });

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      push(`expected ${types.join(' | ')}, got ${typeOf(value)}`);
      return issues;
    }
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    push(`must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) push(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) push(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`must match ${schema.pattern}`);
    if (schema.format === 'date') {
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00`))) push('must be a date YYYY-MM-DD');
    } else if (schema.format === 'date-time') {
      if (Number.isNaN(Date.parse(value))) push('must be an ISO 8601 date-time, e.g. 2026-11-19T14:30 (local) or 2026-11-19T09:00:00Z');
    } else if (schema.format === 'time') {
      if (!TIME_RE.test(value)) push('must be a 24h time HH:MM');
    } else if (schema.format === 'uri') {
      try { new URL(value); } catch { push('must be an absolute URL'); }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) push(`must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) push(`must be ≤ ${schema.maximum}`);
    if (!Number.isFinite(value)) push('must be a finite number');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => issues.push(...validate(schema.items!, item, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) push(`is required`, `${path}.${key}`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const sub = props[key];
      if (sub) issues.push(...validate(sub, v, `${path}.${key}`));
      else if (schema.additionalProperties === false) push(`unknown field "${key}"`, `${path}.${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        issues.push(...validate(schema.additionalProperties, v, `${path}.${key}`));
      }
    }
  }
  return issues;
}

/** Fills top-level defaults (shallow) so handlers see documented defaults. */
export function applyDefaults<T extends Record<string, unknown>>(schema: JsonSchema, input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (out[k] === undefined && sub.default !== undefined) out[k] = sub.default;
  }
  return out as T;
}

/* ------------------------------------------------------------------ */
/* Builders — keep the catalog readable                                */
/* ------------------------------------------------------------------ */

type Extra = Omit<JsonSchema, 'type'>;
export const s = {
  str: (description?: string, extra: Extra = {}): JsonSchema => ({ type: 'string', description, ...extra }),
  text: (description?: string, max = 20_000): JsonSchema => ({ type: 'string', description, maxLength: max }),
  id: (what = 'record'): JsonSchema => ({ type: 'string', minLength: 1, maxLength: 128, description: `ID of the ${what}.` }),
  int: (description?: string, extra: Extra = {}): JsonSchema => ({ type: 'integer', description, ...extra }),
  num: (description?: string, extra: Extra = {}): JsonSchema => ({ type: 'number', description, ...extra }),
  bool: (description?: string, extra: Extra = {}): JsonSchema => ({ type: 'boolean', description, ...extra }),
  date: (description = 'Local calendar date.'): JsonSchema => ({ type: 'string', format: 'date', description: `${description} Format YYYY-MM-DD.` }),
  nullableDate: (description = 'Local calendar date, or null to clear.'): JsonSchema => ({ type: ['string', 'null'], format: 'date', description: `${description} Format YYYY-MM-DD.` }),
  dateTime: (description = 'Date-time.'): JsonSchema => ({ type: 'string', format: 'date-time', description: `${description} ISO 8601; without an offset it is read as LOCAL time (e.g. 2026-11-19T14:30).` }),
  time: (description = 'Local time of day.'): JsonSchema => ({ type: 'string', format: 'time', description: `${description} 24h HH:MM.` }),
  enum: <T extends string | number>(values: readonly T[], description?: string): JsonSchema => ({ enum: values, description }),
  arr: (items: JsonSchema, description?: string, extra: Extra = {}): JsonSchema => ({ type: 'array', items, description, ...extra }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema => ({
    type: 'object', properties, required, additionalProperties: false, description,
  }),
};
