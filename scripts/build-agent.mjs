// Bundles the local agent server into one self-contained ESM file:
//   agent/dist/lifeos-agent.mjs
// Uses the esbuild that already ships with Vite — no extra dependency.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'agent/src/main.ts')],
  outfile: resolve(root, 'agent/dist/lifeos-agent.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'linked',
  logLevel: 'info',
  // Some bundled CJS deps call require(); give ESM a real one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
