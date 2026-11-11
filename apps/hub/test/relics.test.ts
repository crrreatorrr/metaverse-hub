import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Group } from 'three';
import { RELIC_IDS } from '@metaverse/hub-sdk';
import { SOCKETS, PEDESTAL_COLORS } from '../src/realms/plaza/config';
import { buildPedestal } from '../src/realms/plaza/plaza';
import { RELICS, ownsFourLights } from '../src/core/relics';
import { FOUR_LIGHTS_RELIC_IDS } from '@metaverse/hub-sdk';
import { RELIC_GEMS } from '../src/m3/types';
import { HELD_BADGE, HELD_PET_IDS, HELD_RELIC_IDS, grantBadge, isHeld } from '../src/v2/store-info';

assert.deepEqual(RELIC_GEMS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_gems');
assert.deepEqual(SOCKETS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_sockets');
const server = readFileSync(new URL('../../../server/modules/src/hub_match.ts', import.meta.url), 'utf8');
for (const id of RELIC_IDS) assert.ok(server.includes(id), `server_knows_all_relics: ${id}`);
// The Coop and Shooter Relics orbit and socket like the rest but are not Four Lights.
for (const id of ['marina_anchor', 'dragon_scale'] as const) {
  assert.ok(RELICS.some((relic) => relic.id === id), `${id} is shown`);
  assert.ok(RELIC_GEMS.some((gem) => gem.id === id), `${id} orbits`);
  assert.equal((FOUR_LIGHTS_RELIC_IDS as readonly string[]).includes(id), false, `${id} is not a Four Lights Relic`);
}
assert.equal(new Set(RELIC_GEMS.map((gem) => `${gem.radius}:${gem.height}`)).size, RELIC_GEMS.length, 'orbits do not overlap');
assert.ok(!ownsFourLights(new Set(['tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale'])), 'later Relics never open the Hall');
const { markers } = buildPedestal(new Group());
assert.equal(markers.length, RELIC_IDS.length, 'one pedestal marker per Relic');
assert.equal(new Set(markers.map((marker) => marker.position.toArray().join(','))).size, RELIC_IDS.length, 'pedestal markers have distinct positions');
console.log('Relic ids ok');

// Shared engine code must never reach into a particular realm.
const core = new URL('../src/core/', import.meta.url);
assert.ok(existsSync(new URL('engine.ts', core)), 'shared engine exists');
assert.ok(existsSync(new URL('shell.ts', core)), 'shared shell exists');
for (const file of readdirSync(core, { recursive: true })) {
  if (typeof file !== 'string' || !file.endsWith('.ts')) continue;
  const source = readFileSync(new URL(file, core), 'utf8');
  assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"][^'"]*realms\//, `core_has_no_realm_imports: ${file}`);
}

assert.deepEqual(PEDESTAL_COLORS, RELICS.map(relic => relic.color), 'pedestal_colors_match_relics');
assert.ok(ownsFourLights(new Set(FOUR_LIGHTS_RELIC_IDS)), 'four_relic_check_uses_four_lights');
assert.ok(!ownsFourLights(new Set(FOUR_LIGHTS_RELIC_IDS.slice(0, 3))), 'three lights cannot own reward');
const menu = readFileSync(new URL('../src/menu.ts', import.meta.url), 'utf8');
assert.ok(menu.includes('ownsFourLights(relics)'), 'menu fallback uses the four-light rule');

// A3 and B3: a grant the server holds shows the pending badge, never "Locked". The client's held
// lists must match the rules that still have grant_hold after every migration.
{
  const schema = readFileSync(new URL('../../../server/modules/src/schema.ts', import.meta.url), 'utf8');
  for (const id of [...HELD_RELIC_IDS, ...HELD_PET_IDS]) {
    assert.equal(grantBadge(id, false), HELD_BADGE, `${id} shows the pending badge`);
    assert.equal(grantBadge(id, true), 'Owned', `${id} owned`);
    assert.ok(isHeld(id));
    assert.ok(schema.includes(`'${id}'`), `${id} is a server rule`);
  }
  // 0033 held these six; 0060_relic_unhold released them, so none may be listed as held here.
  const at = schema.indexOf('id: "0060_relic_unhold"');
  assert.ok(at > 0, '0060_relic_unhold is registered');
  const released = schema.slice(at, schema.indexOf('$chk$`', at));
  for (const id of ['genesis_shard', 'tidebreaker_belt', 'pet_honk_sproto', 'pet_spiral_sproto', 'pet_moon_sproto', 'pet_sproto_pup']) {
    assert.ok(released.includes(`'${id}'`), `0060 releases ${id}`);
    assert.equal(isHeld(id), false, `${id} is no longer shown as pending`);
    assert.equal(grantBadge(id, false), 'Locked');
  }
  assert.equal(schema.slice(at).includes("grant_hold = true"), false, 'no later migration holds a grant again');
  assert.equal(grantBadge('cones_tip', false), 'Locked');
  assert.equal(grantBadge('pet_nobu', true, 'Model soon'), 'Model soon');
  assert.equal(HELD_BADGE, 'Not awarded yet');
}
console.log('held badges ok');
