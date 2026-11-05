import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { RELIC_IDS } from '@metaverse/hub-sdk';
import { SOCKETS, PEDESTAL_COLORS } from '../src/realms/plaza/config';
import { RELICS, ownsFourLights } from '../src/core/relics';
import { FOUR_LIGHTS_RELIC_IDS } from '@metaverse/hub-sdk';
import { RELIC_GEMS } from '../src/m3/types';

assert.deepEqual(RELIC_GEMS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_gems');
assert.deepEqual(SOCKETS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_sockets');
const server = readFileSync(new URL('../../../server/modules/src/hub_match.ts', import.meta.url), 'utf8');
for (const id of RELIC_IDS) assert.ok(server.includes(id), `server_knows_all_relics: ${id}`);
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
const pedestal = readFileSync(new URL('../src/realms/plaza/plaza.ts', import.meta.url), 'utf8');
assert.ok(pedestal.includes('PEDESTAL_COLORS'), 'pedestal uses the shared colors');
assert.ok(ownsFourLights(new Set(FOUR_LIGHTS_RELIC_IDS)), 'four_relic_check_uses_four_lights');
assert.ok(!ownsFourLights(new Set(FOUR_LIGHTS_RELIC_IDS.slice(0, 3))), 'three lights cannot own reward');
const menu = readFileSync(new URL('../src/menu.ts', import.meta.url), 'utf8');
assert.ok(menu.includes('ownsFourLights(relics)'), 'menu fallback uses the four-light rule');
