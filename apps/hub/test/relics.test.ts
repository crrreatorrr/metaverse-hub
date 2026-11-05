import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELIC_IDS } from '@metaverse/hub-sdk';
import { SOCKETS } from '../src/config';
import { RELIC_GEMS } from '../src/m3/types';

assert.deepEqual(RELIC_GEMS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_gems');
assert.deepEqual(SOCKETS.map(({ id }) => id), [...RELIC_IDS], 'relic_ids_all_have_sockets');
const server = readFileSync(new URL('../../../server/modules/src/hub_match.ts', import.meta.url), 'utf8');
for (const id of RELIC_IDS) assert.ok(server.includes(id), `server_knows_all_relics: ${id}`);
console.log('Relic ids ok');
