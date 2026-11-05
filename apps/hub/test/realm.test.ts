import { execFileSync } from 'node:child_process';
import { buildSandboxCollider } from '../src/realms/sandbox/collider';
import { createPlayerController, STAND_Y } from '../src/physics';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRealmArrival, loginReturnPath } from '../src/travel';
import { spawnFor, spawnForArrival, SANDBOX_GATE } from '../src/realms/plaza/layout';
import { chooseGuest, guestThisTab } from '../src/auth';

assert.equal(parseRealmArrival('#realm=sandbox'), 'sandbox', 'realm_arrival_parses');
assert.equal(parseRealmArrival('#realm=nope'), null);
assert.equal(parseRealmArrival(''), null);
assert.deepEqual(spawnForArrival('#from=nobu&realm=sandbox'), spawnFor('nobu'), 'game_return_ignores_realm_history');
assert.deepEqual(spawnForArrival('#realm=sandbox'), SANDBOX_GATE.arrival);
assert.deepEqual(spawnForArrival(''), spawnFor(null));
assert.equal(loginReturnPath({ pathname: '/realm/sandbox/', search: '?pet=test', hash: '#realm=plaza' }), '/realm/sandbox/?pet=test#realm=plaza', 'login_return_stays_on_page');
const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
chooseGuest();
assert.ok(guestThisTab(), 'guest_flag_survives_crossing');
assert.equal(loginReturnPath({ pathname: '/realm/sandbox/', search: '', hash: '' }), '/realm/sandbox/');
assert.ok(guestThisTab());
if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage');
const plazaHtml = readFileSync(new URL('../hub/index.html', import.meta.url), 'utf8');
const sandboxHtml = readFileSync(new URL('../realm/sandbox/index.html', import.meta.url), 'utf8');
const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(ids(sandboxHtml), ids(plazaHtml), 'both realm pages provide every shared DOM id');
console.log('realm navigation and page contract ok');

const collider = buildSandboxCollider();
const player = createPlayerController(collider.bvh);
for (let side = 0; side < 4; side++) {
  const yaw = side * Math.PI / 2;
  player.spawn(0, STAND_Y, 0, yaw);
  for (let i=0; i<900; i++) player.step(1/60, { forward: 1, strafe: 0, sprint: true, jump: false, yaw }, { walk: 7.8, sprint: 16 });
  assert.ok(Math.max(Math.abs(player.position.x), Math.abs(player.position.z)) < 140, 'sandbox edge wall keeps poses in server bounds');
  assert.ok(Math.max(Math.abs(player.position.x), Math.abs(player.position.z)) > 130);
}
collider.geometry.dispose();

// Exercise the actual build check on source fixtures without importing browser code.
function assetViolations(realm: string, source: string): string[] {
  const result = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { checkRealmSource } from './scripts/check-realm-assets.mjs'; console.log(JSON.stringify(checkRealmSource(process.argv[1], process.argv[2])));", realm, source],
    { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' });
  return JSON.parse(result) as string[];
}
assert.ok(assetViolations('sandbox', "const art = '/world/realms/other/floor.glb'").length > 0, 'realm_cannot_reference_other_realm');
assert.ok(assetViolations('plaza', "const art = 'world/realms/sandbox/floor.glb'").length > 0, 'plaza cannot reference realm art');
assert.deepEqual(assetViolations('sandbox', "const art = '/world/realms/sandbox/floor.glb'"), []);

// Palettes and art defaults live in one theme; the plaza keeps its scoped gold/green values.
const theme = readFileSync(new URL('../src/core/theme.css', import.meta.url), 'utf8');
assert.ok(theme.includes('--gold: #f5b942'), 'plaza retains the original global gold');
assert.ok(theme.includes('--gold-dk: #b07a0c'), 'pixel gold retains its original shade');
assert.ok(theme.includes('[data-realm="sandbox"]'), 'sandbox can override a few tokens');
for (const file of ['style.css', 'login.css']) {
  const css = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  assert.doesNotMatch(css, /--(?:ink|blue|navy|yellow)\s*:/, 'palette definitions are consolidated');
  assert.doesNotMatch(css, /url\(['"]?\/world\/ui\//, 'art URLs use theme variables');
}
