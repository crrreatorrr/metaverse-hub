// Which cloned game repos are built, and which are served as committed static files.
// Also checks the pinned classic-script SDK build used by games with no bundler.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAMES, findBuildOutput, planClone } from './fetch-game-web.mjs';
import { buildBrowserIife, sdkSourcePin } from './vendor-sdk.mjs';

const root = mkdtempSync(join(tmpdir(), 'fetch-game-web-test-'));
function repo(name, files) {
  const dir = join(root, name);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}
const page = '<!doctype html><script type="module" src="/src/main.ts"></script>';
const buildPkg = JSON.stringify({ scripts: { build: 'vite build' } });

try {
  // A Vite repo with a source index.html is built, never served raw (NOBU, Sproto Duel, People's Bitcoin).
  assert.deepEqual(planClone(repo('vite', { 'package.json': buildPkg, 'index.html': page, 'public/x.png': '' })), { kind: 'build' });
  // A stale committed dist/ without index.html does not stop the build (Sproto Duel's duel-sim.server.js).
  assert.deepEqual(planClone(repo('stale-dist', { 'package.json': buildPkg, 'index.html': page, 'dist/duel-sim.server.js': '' })), { kind: 'build' });
  // No build script: a committed export wins over the repo root.
  assert.deepEqual(
    planClone(repo('export', { 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'index.html': page, 'build/web/index.html': page })),
    { kind: 'static', dir: 'build/web' },
  );
  // A plain static repo is served from its root.
  assert.deepEqual(planClone(repo('plain', { 'index.html': page })), { kind: 'static', dir: '.' });
  // Nothing to serve.
  assert.equal(planClone(repo('empty', { 'README.md': '' })), null);

  // Build output: Vite's default dist/, and HPOS10I's build/web/.
  const since = Date.now() - 1000;
  assert.equal(findBuildOutput(repo('out-dist', { 'dist/index.html': page }), since), join(root, 'out-dist', 'dist'));
  assert.equal(findBuildOutput(repo('out-web', { 'build/web/index.html': page }), since), join(root, 'out-web', 'build', 'web'));
  // A stale committed dist/ is skipped in favour of the fresh build/web/.
  const mixed = repo('out-mixed', { 'dist/index.html': page, 'build/web/index.html': page });
  utimesSync(join(mixed, 'dist/index.html'), new Date(0), new Date(0));
  assert.equal(findBuildOutput(mixed, since), join(mixed, 'build', 'web'));
  // A build that wrote no page.
  const stale = repo('out-stale', { 'dist/index.html': page });
  utimesSync(join(stale, 'dist/index.html'), new Date(0), new Date(0));
  assert.equal(findBuildOutput(stale, since), null);

  assert.equal(GAMES['sproto-shooter'].repo, 'crrreatorrr/sproto-shooter');
  assert.equal(GAMES['sproto-coop-battle'].repo, 'crrreatorrr/Sproto-Coop-Battle.');
  assert.equal(GAMES['sproto-arcade'].repo, 'crrreatorrr/Sproto-Arcade');
  assert.equal(GAMES.vcoin, undefined);
} finally {
  rmSync(root, { recursive: true, force: true });
}

const pin = JSON.parse(readFileSync(new URL('../packages/hub-sdk/sdk-pin.json', import.meta.url), 'utf8'));
assert.equal(pin.format, 'iife');
assert.equal(pin.globalName, 'HubSdk');
assert.equal(pin.packageVersion, '0.6.2');
assert.deepEqual(pin.sources, sdkSourcePin());
const iifeDir = mkdtempSync(join(tmpdir(), 'hub-sdk-iife-'));
try {
  const first = await buildBrowserIife(join(iifeDir, 'a.js'));
  const second = await buildBrowserIife(join(iifeDir, 'b.js'));
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.bytes, second.bytes);
  const text = readFileSync(join(iifeDir, 'a.js'), 'utf8');
  assert.match(text, /sproto-shooter/);
  assert.match(text, /sproto-coop-battle/);
  assert.match(text, /createHubSdk/);
  assert.doesNotMatch(text, /NAKAMA_HTTP_KEY|defaulthttpkey/);
  const vm = await import('node:vm');
  const sandbox = { console, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, indexedDB: undefined };
  vm.runInNewContext(text, sandbox, { filename: 'hub-sdk.iife.js' });
  assert.equal(typeof sandbox.HubSdk.createHubSdk, 'function');
  assert.equal(sandbox.HubSdk.isGameId('sproto-shooter'), true);
  assert.equal(sandbox.HubSdk.isGameId('sproto-coop-battle'), true);
  assert.equal(sandbox.HubSdk.RELIC_BY_GAME['sproto-shooter'], undefined);
  assert.equal(sandbox.HubSdk.RELIC_BY_GAME.sproto, 'tinubu_crown');
} finally {
  rmSync(iifeDir, { recursive: true, force: true });
}
console.log('fetch-game-web: ok');
