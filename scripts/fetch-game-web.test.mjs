// Which cloned game repos are built, and which are served as committed static files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planClone } from './fetch-game-web.mjs';

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
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('fetch-game-web: ok');
