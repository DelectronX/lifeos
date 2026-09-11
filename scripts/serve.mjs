#!/usr/bin/env node
/**
 * serve.mjs — an OPTIONAL tiny static file server with PUT support.
 *
 * LifeOS works with no server at all (manual-file mode). This script exists
 * only to unlock the *best* mode: when the page is served over http(s) by
 * something that accepts PUT, the HttpFileAdapter writes `data/tasks.json` and
 * friends straight back to disk, and saving becomes completely automatic.
 *
 * Deliberately zero dependencies — Node's own `http` and `fs`. Nothing in the
 * app imports this file; it is never bundled and never part of the app's
 * dependency path.
 *
 *   node scripts/serve.mjs                     # serve ./dist on :4173
 *   node scripts/serve.mjs --root dist --port 8080 --host 0.0.0.0
 *   node scripts/serve.mjs --data ./lifeos-data
 *
 * Method support:
 *   GET/HEAD  — static files from --root, SPA-fallback to index.html
 *   PUT       — writes into --data (default `<root>/data`), creating dirs
 *   DELETE    — removes a file under --data
 *   OPTIONS   — advertises the above (so the adapter's probe is cheap)
 *
 * Security: writes are confined to the --data directory and to `.json` files.
 * Bind to 127.0.0.1 unless you actually want LAN access.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { root: 'dist', port: 4173, host: '127.0.0.1', data: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--root' && value) { out.root = value; i += 1; }
    else if (key === '--port' && value) { out.port = Number(value); i += 1; }
    else if (key === '--host' && value) { out.host = value; i += 1; }
    else if (key === '--data' && value) { out.data = value; i += 1; }
    else if (key === '--help' || key === '-h') { out.help = true; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
LifeOS optional file server

  node scripts/serve.mjs [--root dist] [--port 4173] [--host 127.0.0.1] [--data <dir>]

Serves --root over HTTP and accepts PUT/DELETE of .json files into --data
(default: <root>/data), which is what makes LifeOS save automatically.
Use --host 0.0.0.0 to reach it from a phone on the same network.
`);
  process.exit(0);
}

const ROOT = resolve(process.cwd(), args.root);
const DATA = resolve(process.cwd(), args.data ?? join(args.root, 'data'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Resolves a URL path inside `base`, refusing anything that escapes it. */
function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = resolve(base, `.${normalize(decoded)}`);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readBody(req, limitBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Where a PUT/DELETE of `/data/tasks.json` actually lands. */
function dataTargetFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  // Anything under /data/ maps into DATA; a bare /tasks.json does too, so the
  // adapter works whether or not the app is served from a subdirectory.
  const rel = decoded.replace(/^\/+/, '').replace(/^data\//, '');
  if (!rel || rel.endsWith('/')) return null;
  if (extname(rel).toLowerCase() !== '.json') return null;
  return safeJoin(DATA, `/${rel}`);
}

const server = createServer(async (req, res) => {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? '/';

  try {
    if (method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, Allow: 'GET, HEAD, PUT, DELETE, OPTIONS', DAV: '1' });
      res.end();
      return;
    }

    if (method === 'PUT') {
      const target = dataTargetFor(url);
      if (!target) {
        res.writeHead(403, CORS).end('Only .json files under the data directory may be written.');
        return;
      }
      const body = await readBody(req);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      console.log(`PUT  ${url} -> ${target} (${body.length} bytes)`);
      res.writeHead(204, CORS).end();
      return;
    }

    if (method === 'DELETE') {
      const target = dataTargetFor(url);
      if (!target) {
        res.writeHead(403, CORS).end('Refused.');
        return;
      }
      await rm(target, { force: true });
      res.writeHead(204, CORS).end();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { ...CORS, Allow: 'GET, HEAD, PUT, DELETE, OPTIONS' }).end();
      return;
    }

    /* ---- static ---- */
    const pathname = url.split('?')[0];

    // Data files are read back out of DATA, not ROOT, so the folder the app
    // writes to is the folder it reads from even when they differ.
    const dataRead = pathname.startsWith('/data/') ? dataTargetFor(pathname) : null;
    let file = dataRead ?? safeJoin(ROOT, pathname);
    if (!file) {
      res.writeHead(403, CORS).end('Forbidden');
      return;
    }

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }

    if (!info) {
      if (dataRead || extname(pathname)) {
        // A missing data file is a normal "not written yet" answer, and a
        // missing asset must 404 rather than silently returning the HTML shell.
        res.writeHead(404, CORS).end('Not found');
        return;
      }
      // SPA fallback for client-side routes.
      file = join(ROOT, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) {
        res.writeHead(404, CORS).end(`No index.html in ${ROOT}. Run "npm run build" first.`);
        return;
      }
    }

    const headers = {
      ...CORS,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    };
    res.writeHead(200, headers);
    if (method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  } catch (e) {
    console.error(`[serve] ${method} ${url} failed:`, e);
    if (!res.headersSent) res.writeHead(500, CORS);
    res.end(e instanceof Error ? e.message : 'Server error');
  }
});

await mkdir(DATA, { recursive: true });

server.listen(args.port, args.host, () => {
  const shown = args.host === '0.0.0.0' ? 'localhost' : args.host;
  console.log(`LifeOS server`);
  console.log(`  app   http://${shown}:${args.port}/`);
  console.log(`  root  ${ROOT}`);
  console.log(`  data  ${DATA}  (PUT enabled — saving is automatic)`);
  if (args.host === '0.0.0.0') {
    console.log(`  LAN   reachable from other devices on this network`);
  }
});
