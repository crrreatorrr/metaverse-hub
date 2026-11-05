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
