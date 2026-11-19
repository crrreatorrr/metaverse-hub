// Serves a sample tree with deploy/Caddyfile and checks precompression and
// Cache-Control on both hosts. Needs a caddy binary: CADDY_BIN, or caddy on
// PATH. Without one it prints a skip line and exits 0, so `npm test` still
// runs on machines without Caddy.
//
// The deploy file is used as is, except: the Cloudflare import is dropped,
// the origin-cert tls lines are dropped, the two site addresses become plain
// http on a local port, and /srv is pointed at a temp dir.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const caddy = process.env.CADDY_BIN || 'caddy';

if (spawnSync(caddy, ['version'], { stdio: 'ignore' }).status !== 0) {
  console.log('[caddy-headers] skipped: no caddy binary (set CADDY_BIN)');
  process.exit(0);
}

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'caddy-headers-'));
const srv = join(tmp, 'srv');

function put(rel, body, precompress = true) {
  const file = join(srv, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (precompress) {
    writeFileSync(`${file}.br`, brotliCompressSync(Buffer.from(body)));
    writeFileSync(`${file}.gz`, gzipSync(Buffer.from(body)));
  }
}

const filler = 'x'.repeat(4096);
put('hub/current/hub/index.html', `<!doctype html>${filler}`);
put('hub/current/asset-manifest.json', `{"a":"${filler}"}`);
put('hub/current/assets/index-AbC123xy.js', `console.log(1);${filler}`);
put('hub/current/world/v2/pet.glb', `glTF${filler}`);
put('hub/current/world/basis/basis_transcoder.wasm', `\0asm${filler}`);
put('play/sproto-arcade/current/index.html', `<!doctype html>${filler}`);
put('play/sproto-arcade/current/asset-manifest.json', `{"a":"${filler}"}`);
put('play/sproto-arcade/current/assets/main-Df9_kQ2a.js', `console.log(2);${filler}`);
put('play/sproto-arcade/current/assets/boss-defeated.mp3', 'ID3', false);
put('play/sproto-arcade/current/assets/hero-sheet.png', 'PNG', false);
put('play/sproto-coop-battle/current/sprites/hero.png', 'PNG', false);
put('play/sproto-coop-battle/current/index.html', `<!doctype html>${filler}`);
put('play/hpos10i/current/index.Ab12cd.wasm', `\0asm${filler}`);
put('play/shared-assets/sproto/current/rigs/wizard.glb', `glTF${filler}`);
put('play/shared-assets/sproto/current/rigs/wizard-Ab3dE9xQ.glb', `glTF${filler}`);

const port = await freePort();
let cf = readFileSync(join(root, 'deploy/Caddyfile'), 'utf8');
cf = cf
  .replace(/^\s*import \/etc\/caddy\/cloudflare-proxies\.caddy\s*$/m, '')
  .replace(/^\s*tls \/etc\/caddy\/certs\/origin\.pem.*$/gm, '')
  .replace(/^\{\$DOMAIN\} \{/m, `http://hub.test:${port} {`)
  .replace(/^www\.\{\$DOMAIN\} \{/m, `http://www.hub.test:${port} {`)
  .replace(/^play\.\{\$DOMAIN\} \{/m, `http://play.hub.test:${port} {`)
  .replaceAll('/srv/', `${srv}/`);
cf = `{\n\tadmin off\n\tauto_https off\n}\n${cf.replace(/^\{\n[\s\S]*?\n\}\n/m, '')}`;
const cfPath = join(tmp, 'Caddyfile');
writeFileSync(cfPath, cf);

const validate = spawnSync(caddy, ['validate', '--config', cfPath, '--adapter', 'caddyfile'], { encoding: 'utf8' });
assert.equal(validate.status, 0, validate.stderr);

const child = spawn(caddy, ['run', '--config', cfPath, '--adapter', 'caddyfile'], { stdio: ['ignore', 'ignore', 'pipe'] });
let log = '';
child.stderr.on('data', (d) => { log += d; });

// fetch() drops a Host header, so use node:http.
function once(host, path, enc) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `${host}:${port}`, 'Accept-Encoding': enc } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function get(host, path, enc = 'br, gzip') {
  for (let i = 0; i < 50; i++) {
    try {
      return await once(host, path, enc);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`caddy did not start\n${log}`);
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const cases = [
  // host, path, Content-Encoding, Cache-Control
  ['hub.test', '/hub/', 'br', 'no-cache'],
  ['hub.test', '/asset-manifest.json', 'br', 'no-cache'],
  ['hub.test', '/assets/index-AbC123xy.js', 'br', IMMUTABLE],
  ['hub.test', '/world/v2/pet.glb', 'br', 'public, max-age=3600, stale-while-revalidate=86400'],
  ['hub.test', '/world/basis/basis_transcoder.wasm', 'br', 'public, max-age=3600, stale-while-revalidate=86400'],
  ['play.hub.test', '/sproto-arcade/', 'br', 'no-cache'],
  ['play.hub.test', '/sproto-arcade/asset-manifest.json', 'br', 'no-cache'],
  ['play.hub.test', '/sproto-arcade/assets/main-Df9_kQ2a.js', 'br', IMMUTABLE],
  ['play.hub.test', '/sproto-arcade/assets/boss-defeated.mp3', null, 'public, max-age=300'],
  ['play.hub.test', '/sproto-arcade/assets/hero-sheet.png', null, 'public, max-age=300'],
  ['play.hub.test', '/sproto-coop-battle/sprites/hero.png?v=0123456789abcdef01234567', null, IMMUTABLE],
  ['play.hub.test', '/sproto-coop-battle/sprites/hero.png?v=nothex', null, 'public, max-age=300'],
  ['play.hub.test', '/sproto-coop-battle/index.html?v=0123456789abcdef01234567', 'br', 'no-cache'],
  ['play.hub.test', '/hpos10i/index.Ab12cd.wasm', 'br', IMMUTABLE],
  ['play.hub.test', '/shared-assets/sproto/rigs/wizard.glb', 'br', 'public, max-age=3600, stale-while-revalidate=86400'],
  ['play.hub.test', '/shared-assets/sproto/rigs/wizard-Ab3dE9xQ.glb', 'br', IMMUTABLE],
];

let failed = 0;
try {
  for (const [host, path, enc, cc] of cases) {
    const res = await get(host, path);
    const got = { status: res.status, enc: res.headers['content-encoding'] ?? null, cc: res.headers['cache-control'] ?? null };
    const ok = got.status === 200 && got.enc === enc && got.cc === cc;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${host}${path} -> ${JSON.stringify(got)}${ok ? '' : ` want enc=${enc} cc=${cc}`}`);
  }
  const gz = await get('hub.test', '/world/v2/pet.glb', 'gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(gz.headers.vary ?? '', /Accept-Encoding/i);
} finally {
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
}
assert.equal(failed, 0, `${failed} header case(s) failed`);
console.log('[caddy-headers] ok');
