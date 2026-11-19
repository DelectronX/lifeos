// Generates docs/agent-operations.md from the operation catalog, so the
// reference can never drift from what the server actually exposes.
//   node scripts/gen-agent-docs.mjs
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = resolve(root, 'node_modules/.cache/agent-catalog.mjs');
mkdirSync(dirname(tmp), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/agent/catalog.ts')], outfile: tmp, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { OPERATIONS, ERROR_CODES } = await import(pathToFileURL(tmp).href);
rmSync(tmp);

const describeSchema = (schema) => {
  const props = schema.properties ?? {};
  const req = new Set(schema.required ?? []);
  const rows = Object.entries(props).map(([k, v]) => {
    const t = v.enum ? v.enum.map((e) => `\`${e}\``).join(' \\| ') : Array.isArray(v.type) ? v.type.join(' \\| ') : v.type === 'array' ? `${v.items?.enum ? 'enum' : v.items?.type ?? 'any'}[]` : (v.format ?? v.type ?? 'any');
    return `| \`${k}\`${req.has(k) ? ' **(required)**' : ''} | ${t} | ${(v.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`;
  });
  return rows.length ? ['| Field | Type | Notes |', '|---|---|---|', ...rows].join('\n') : '_No input._';
};

const areas = [...new Set(OPERATIONS.map((o) => o.area))];
const out = [
  '# LifeOS agent operations',
  '',
  `Generated from \`src/agent/catalog.ts\` by \`node scripts/gen-agent-docs.mjs\` — ${OPERATIONS.length} operations.`,
  'Each is an MCP tool (same name), a REST endpoint `POST /api/v1/ops/<name>` (reads also `GET`), and `lifeos-agent call <name>`.',
  '',
  'Kinds: **read** (never changes data) · **write** (changes data; needs permission "Read & edit") · **destructive** (deletes; needs "Full" and `"confirm": true`).',
  '',
  '## Error codes',
  '',
  '| Code | Meaning |', '|---|---|',
  ...Object.entries(ERROR_CODES).map(([k, v]) => `| \`${k}\` | ${v} |`),
  '',
  '## Contents',
  '',
  ...areas.map((a) => `- [${a}](#${a})`),
  '',
];
for (const area of areas) {
  out.push(`## ${area}`, '');
  for (const op of OPERATIONS.filter((o) => o.area === area)) {
    out.push(`### \`${op.name}\` — ${op.title}`, '', `${op.kind}${op.idempotent ? ' · idempotent' : ''}`, '', op.description, '', describeSchema(op.input), '');
  }
}
writeFileSync(resolve(root, 'docs/agent-operations.md'), out.join('\n'));
console.log(`docs/agent-operations.md — ${OPERATIONS.length} operations`);
