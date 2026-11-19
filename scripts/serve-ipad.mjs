#!/usr/bin/env node
/**
 * serve-ipad.mjs — serve the built app to an iPad over the LOCAL network,
 * with HTTPS, so Safari treats LifeOS as a real offline app.
 *
 * Why HTTPS matters on iPad (plain http://192.168.x.x is NOT enough):
 *   - Service workers (offline app shell) only run on HTTPS. Without one the
 *     app cannot open when this PC is off.
 *   - navigator.storage.persist() only works on HTTPS.
 *   - A Home Screen web app (Share → Add to Home Screen) keeps its own
 *     storage and is not subject to Safari's 7-day "delete website data of
 *     sites you haven't visited" rule.
 *
 * No internet needed. On first run this script creates a private certificate
 * authority (CA) in ./.certs. You install that CA on the iPad once:
 *   1. On the iPad open  http://<PC-IP>:4080  → tap "Download certificate".
 *   2. Settings → "Profile Downloaded" → Install.
 *   3. Settings → General → About → Certificate Trust Settings → turn ON
 *      "LifeOS Local CA".
 *   4. Open  https://<PC-IP>:4443  → Share → Add to Home Screen.
 *   5. Open LifeOS from the Home Screen. From now on it works with the PC off.
 *
 * The CA is created once and reused; the server certificate is re-issued
 * automatically when this PC's IP addresses change, so the iPad keeps
 * trusting it. KEEP THE SAME ADDRESS AND PORT: the browser stores data per
 * address (origin). A different IP or port is a different, empty app.
 *
 *   npm run ipad            # build + serve
 *   node scripts/serve-ipad.mjs [--port 4443] [--http-port 4080] [--root dist]
 */

import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import forge from 'node-forge';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? 4443);
const HTTP_PORT = Number(args['http-port'] ?? 4080);
const ROOT = resolve(args.root ?? 'dist');
const CERT_DIR = resolve('.certs');

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`No build found in ${ROOT}. Run "npm run build" first (or use "npm run ipad").`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // Skip common virtual adapters (VirtualBox, Hyper-V/WSL, Docker).
      const virtual = /virtual|vethernet|wsl|docker|vbox|hyper-v/i.test(name) || a.address.startsWith('192.168.56.') || a.address.startsWith('172.17.');
      out.push({ name, address: a.address, virtual });
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

const addresses = lanAddresses();
const host = hostname();
const sanNames = ['localhost', host, `${host}.local`, 'lifeos.local'];
const sanIps = ['127.0.0.1', ...addresses.map((a) => a.address)];

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

function newSerial() {
  return '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
}

function loadOrCreateCA() {
  const keyPath = join(CERT_DIR, 'ca.key.pem');
  const certPath = join(CERT_DIR, 'ca.crt.pem');
  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: forge.pki.privateKeyFromPem(readFileSync(keyPath, 'utf8')),
      cert: forge.pki.certificateFromPem(readFileSync(certPath, 'utf8')),
      pem: readFileSync(certPath, 'utf8'),
      created: false,
    };
  }
  console.log('Creating a private certificate authority (one time)…');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = newSerial();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'LifeOS Local CA' }, { name: 'organizationName', value: 'LifeOS (this PC only)' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
  writeFileSync(certPath, pem);
  return { key: keys.privateKey, cert, pem, created: true };
}

function loadOrCreateServerCert(ca) {
  const keyPath = join(CERT_DIR, 'server.key.pem');
  const certPath = join(CERT_DIR, 'server.crt.pem');
  const sanPath = join(CERT_DIR, 'server.san.json');
  const wanted = JSON.stringify({ sanNames, sanIps: [...sanIps].sort() });
  if (existsSync(keyPath) && existsSync(certPath) && existsSync(sanPath) && readFileSync(sanPath, 'utf8') === wanted) {
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
  }
  console.log('Issuing a server certificate for:', [...sanNames, ...sanIps].join(', '));
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = newSerial();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  // Apple rejects TLS server certificates valid for more than 825 days.
  cert.validity.notAfter = new Date(Date.now() + 800 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'LifeOS on this PC' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [...sanNames.map((value) => ({ type: 2, value })), ...sanIps.map((ip) => ({ type: 7, ip }))],
    },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  const out = { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
  writeFileSync(keyPath, out.key);
  writeFileSync(certPath, out.cert);
  writeFileSync(sanPath, wanted);
  return out;
}

const ca = loadOrCreateCA();
const serverCert = loadOrCreateServerCert(ca);

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.wasm': 'application/wasm', '.mjs.map': 'application/json', '.map': 'application/json',
};

function serveStatic(req, res) {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let target = normalize(join(ROOT, url));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) { res.writeHead(403).end(); return; }
  let isFile = false;
  try { isFile = statSync(target).isFile(); } catch { /* not found */ }
  if (!isFile) target = join(ROOT, 'index.html'); // SPA fallback
  const ext = extname(target);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' };
  // The service worker and the HTML shell must never be cached by HTTP, or
  // updates would not reach the iPad. Hashed assets can be cached forever.
  if (/(^|\/)(sw\.js|workbox-[^/]*\.js|index\.html|manifest\.webmanifest)$/.test(target.replaceAll('\\', '/'))) {
    headers['Cache-Control'] = 'no-cache';
  } else if (target.includes(`${sep}assets${sep}`)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
}

createHttps({ key: serverCert.key, cert: serverCert.cert }, serveStatic).listen(PORT, '0.0.0.0');

/* Plain-HTTP helper: certificate download + link to the HTTPS app. */
const primary = addresses.find((a) => !a.virtual)?.address ?? addresses[0]?.address ?? 'localhost';
createHttp((req, res) => {
  if ((req.url ?? '').startsWith('/lifeos-ca')) {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="LifeOS-Local-CA.crt"',
    });
    res.end(ca.pem);
    return;
  }
  const https = `https://${(req.headers.host ?? primary).split(':')[0]}:${PORT}/`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install LifeOS</title>
<style>body{font:17px -apple-system,system-ui;background:#0e1014;color:#e8e6e1;max-width:560px;margin:auto;padding:28px;line-height:1.5}
a.b{display:block;text-align:center;padding:14px;border-radius:12px;background:#d9b26f;color:#14110c;text-decoration:none;font-weight:600;margin:14px 0}
li{margin:8px 0}small{color:#9a968e}</style>
<h2>Install LifeOS on this iPad</h2>
<ol>
<li><a class="b" href="/lifeos-ca.crt">1 · Download certificate</a> Tap <b>Allow</b>, then <b>Close</b>.</li>
<li>Open <b>Settings</b> → <b>Profile Downloaded</b> → <b>Install</b>.</li>
<li><b>Settings → General → About → Certificate Trust Settings</b> → turn on <b>LifeOS Local CA</b>.</li>
<li><a class="b" href="${https}">2 · Open LifeOS (secure)</a></li>
<li>In Safari tap <b>Share → Add to Home Screen</b>, then always open LifeOS from the Home Screen icon.</li>
</ol>
<p><small>Steps 1–3 are needed only once. The certificate was made on this PC and only lets this PC's LifeOS server be trusted.
Always use the same address: <b>${https}</b></small></p>`);
}).listen(HTTP_PORT, '0.0.0.0');

console.log('\n  LifeOS is being served for the iPad.\n');
for (const a of addresses) {
  console.log(`  ${a.virtual ? '(virtual) ' : ''}https://${a.address}:${PORT}/    setup page: http://${a.address}:${HTTP_PORT}/   [${a.name}]`);
}
console.log(`  https://${host}.local:${PORT}/  (works if your network supports .local names)`);
console.log('\n  First time on the iPad: open the setup page above and follow the 5 steps.');
console.log('  Always use the SAME address — the iPad stores LifeOS data per address.');
console.log('  Once added to the Home Screen, LifeOS runs with this PC switched off.\n');
if (ca.created) console.log('  New CA created in .certs/ — keep that folder; deleting it means re-installing the certificate.\n');
