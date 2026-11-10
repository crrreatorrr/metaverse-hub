import assert from 'node:assert/strict';
import { loadModule, plain, presence } from './harness';

const mod = loadModule();
mod.nk.sqlCalls.length = 0;
const userId = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const ctx = { userId, vars: { scope: 'hub' } };
let conesTip = false;
mod.nk.onSql(/FROM game.relic_claim WHERE user_id/, args => [{ result: JSON.stringify(args[0] === userId && conesTip ? ['cones_tip'] : []) }]);
mod.nk.onSql(/AT TIME ZONE/, () => [{ result: '2026-11-10T00:00:00Z' }]);
const equip = (pet: string | null, seq: number, extra = {}) => mod.call<{ ok?: boolean; reason?: string; error?: string; slots?: { pet: string | null } }>('loadout.set_hub', ctx, { pet, seq, ...extra });
assert.equal(equip('pet_nobu', 1).reason, 'not_owned');
assert.equal(equip('pet_starter', 1).ok, true);
const owned = mod.nk.storage.get(`pets/owned/${userId}`)!;
assert.deepEqual(plain(owned.value.ids), ['pet_starter']);
assert.equal(owned.permissionRead, 1);
assert.equal(owned.permissionWrite, 0);
const loadout = mod.nk.storage.get(`loadout/hub/${userId}`)!;
assert.equal(loadout.permissionWrite, 0);
assert.equal(loadout.permissionRead, 1);
assert.equal(equip('pet_starter', 1).ok, true, 'same seq replay is idempotent');
assert.equal(equip(null, 1).reason, 'stale_seq');
assert.equal(equip(null, 2).ok, true);
assert.equal(equip('pet_nobu', 3, { userId: other }).error, 'bad_json');
assert.equal(equip('pet_nobu', 3, { owned: ['pet_nobu'] }).error, 'bad_json');
assert.equal(mod.nk.storage.has(`loadout/hub/${other}`), false);
assert.equal(mod.call<{ error: string }>('loadout.set_hub', { userId: other, vars: { scope: 'game' } }, { pet: 'pet_starter', seq: 1 }).error, 'not_hub_session');
assert.equal(mod.call<{ error: string }>('loadout.set_hub', {}, { pet: null, seq: 1 }).error, 'unauthorized');
conesTip = true;
assert.equal(equip('pet_nobu', 3).ok, true);
assert.deepEqual(plain(mod.nk.storage.get(`pets/owned/${userId}`)!.value.ids), ['pet_nobu', 'pet_starter']);

// Reload / realm join hydrates the equipped pet without waiting for a client profile message.
const m = mod.startMatch('hub', { realm: 'plaza', shard: '8' });
const sender = presence(userId, 'owner', 's1');
m.join([sender], ctx);
const snapshot = m.dispatcher.sent<{ roster: { pt: string }[] }>(2)[0]!.body;
assert.equal(snapshot.roster[0]!.pt, 'pet_nobu');
m.dispatcher.clear();
m.loop([{ sender, opCode: 5, data: { pet: 'pet_speed_sproto', character: 'wizard', staff: 'shooter' } }]);
assert.equal(m.dispatcher.sent<{ upd: { pt: string }[] }>(4)[0]!.body.upd[0]!.pt, 'pet_nobu', 'forged presence must use the equipped pet');
assert.notEqual(m.dispatcher.sent<{ upd: { st: string }[] }>(4)[0]!.body.upd[0]!.st, 'shooter', 'forged profile cannot equip a staff without its relic');
assert.equal(equip(null, 4).ok, true);
for (let i = 0; i < 20; i++) m.loop([]);
m.dispatcher.clear();
m.loop([{ sender, opCode: 5, data: { pet: 'pet_nobu' } }]);
assert.equal(m.dispatcher.sent<{ upd: { pt: string }[] }>(4)[0]!.body.upd[0]!.pt, '');
assert.equal(mod.nk.sqlCalls.some(call => /UPDATE.*wallet|INSERT INTO game.item_ledger/i.test(call.sql)), false);
console.log('follower pet RPC and presence tests ok');

for (const [hook, field] of [['registerBeforeWriteStorageObjects', 'objects'], ['registerBeforeDeleteStorageObjects', 'objectIds']]) {
  for (const entry of [{ collection: 'pets', key: 'owned' }, { collection: 'loadout', key: 'hub' }]) {
    assert.throws(() => mod.before(hook!, ctx, { [field!]: [entry] }), /pet_storage_rpc_only|object Object/);
  }
  const allowed = { [field!]: [{ collection: 'save', key: 'game' }] };
  assert.deepEqual(mod.before(hook!, ctx, allowed), allowed);
}

const catalog = mod.call<{ buyingEnabled: boolean; pets: { id: string; relic: string; ticketsPrice: number }[] }>('pets.catalog', ctx, {});
assert.equal(catalog.buyingEnabled, false);
assert.equal(catalog.pets.length, 9);
assert.equal(catalog.pets.find(pet => pet.id === 'pet_nobu')!.relic, 'cones_tip');
assert.ok(catalog.pets.every(pet => pet.ticketsPrice === 0));
