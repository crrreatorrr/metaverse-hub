// Which cloned game repos are built, and which are served as committed static files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAMES, findBuildOutput, planClone } from './fetch-game-web.mjs';

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
  assert.equal(GAMES['sproto-shooter'].entry, 'ring');
  assert.equal(GAMES['sproto-shooter'].artifact, undefined);
  assert.equal(GAMES['sproto-shooter'].pages, undefined);
  assert.equal(GAMES['sproto-coop-battle'].repo, 'crrreatorrr/Sproto-Coop-Battle.');
  assert.equal(GAMES['sproto-coop-battle'].entry, 'cabinet');
  assert.equal(GAMES['sproto-coop-battle'].pages, undefined);
  assert.equal(GAMES['sproto-fighter'].entry, 'cabinet');
  assert.equal(GAMES['sproto-arcade'].entry, 'cabinet');
  assert.equal(GAMES['hpos10i'].entry, 'ring');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('fetch-game-web: ok');
