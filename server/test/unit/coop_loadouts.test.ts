import assert from 'node:assert/strict';
import { loadModule, presence, type Presence } from './harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP = { HELLO: 1, READY: 3, SEATS: 12, REJECT: 13, RELEASE: 16 };
const progressKey = (userId: string) => `coop_verified_progress/weapons/${userId}`;
const game = (p: Presence) => ({ ...p, vars: { scope: 'game', game: 'sproto-coop-battle', sid: SID } });

interface Pick { classId: string; weapon: string }
interface Seat { accountId: string; device: string; slot: number; generation: number; classId: string; weapon: number; weaponTier: number; hp: number }

const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
const ada = presence(A, 'ada');
const bea = presence(B, 'bea');
const { protocol, fingerprint } = mod.call<{ protocol: number; fingerprint: string }>('coop.version', game(ada), {});
const room = mod.call<{ matchId: string; error?: string }>('coop.room_create', game(ada), {});
assert.ok(room.matchId, room.error);
const match = mod.driver(room.matchId);
assert.equal(match.join([ada], game(ada))[0]?.accept, true);
assert.equal(match.join([bea], game(bea))[0]?.accept, true);

// Ada earned tier three on the server. Bea has no stored banked progress.
mod.nk.storage.set(progressKey(A), { value: { tier: 3, clears: 3 }, version: 'earned-3', permissionRead: 0, permissionWrite: 0 });
const sim = mod.global.Sim as { WEAPONS: { id: string }[] };
function hello(sender: Presence, devices: string[], loadouts?: Record<string, Pick>): void {
  assert.equal(match.loop([{ sender, opCode: OP.HELLO, data: { t: 'hello', protocol, fingerprint, devices, loadouts } }]), true);
}
function seat(accountId: string, device: string): Seat {
  const latest = match.dispatcher.sent<{ seats: Seat[] }>(OP.SEATS).at(-1);
  const entry = latest?.body.seats.find(s => s.accountId === accountId && s.device === device);
  assert.ok(entry, `${accountId} has ${device}`);
  return entry;
}
function equipped(accountId: string, device: string, classId: string, weapon: string, tier: number): void {
  const current = seat(accountId, device);
  assert.equal(current.classId, classId);
  assert.equal(sim.WEAPONS[current.weapon]?.id, weapon);
  assert.equal(current.weaponTier, tier);
}
function rejected(reason: string): void {
  assert.equal(match.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, reason);
}

hello(ada, ['k1', 'k2'], { k1: { classId: 'mage', weapon: 'frost-staff' }, k2: { classId: 'healer', weapon: 'mercy-scepter' } });
hello(bea, ['gp0'], { gp0: { classId: 'ranged', weapon: 'shortbow' } });
equipped(A, 'k1', 'mage', 'frost-staff', 3);
equipped(A, 'k2', 'healer', 'mercy-scepter', 3);
equipped(B, 'gp0', 'ranged', 'shortbow', 1);

const original = seat(A, 'k1');
hello(ada, ['k1', 'k2'], { k1: { classId: 'mage', weapon: 'ember-wand' } });
equipped(A, 'k1', 'mage', 'ember-wand', 3);
assert.equal(seat(A, 'k1').slot, original.slot, 'changing weapon keeps the seat');
assert.equal(seat(A, 'k1').generation, original.generation);
assert.equal(seat(A, 'k1').hp, original.hp);
equipped(A, 'k2', 'healer', 'mercy-scepter', 3);

hello(bea, ['gp0'], { k2: { classId: 'fighter', weapon: 'katana' } });
rejected('loadout');
hello(bea, ['gp0'], { gp0: { classId: 'ranged', weapon: 'longbow' } });
rejected('weapon_locked');
equipped(B, 'gp0', 'ranged', 'shortbow', 1);
equipped(A, 'k2', 'healer', 'mercy-scepter', 3);

match.loop([ada, bea].map(sender => ({ sender, opCode: OP.READY, data: { t: 'ready' } })));
assert.equal((match.state as { phase: string }).phase, 'playing');
hello(bea, ['gp0'], { gp0: { classId: 'mage', weapon: 'apprentice-wand' } });
rejected('rejected');
const live = (mod.global.CoopMatch as { liveSession(id: string): { state: { boss: unknown; mode: string; players: { classId: string; weapon: number }[] } } | null }).liveSession(room.matchId);
assert.ok(live);
const ranged = live.state.players[seat(B, 'gp0').slot];
assert.equal(ranged?.classId, 'ranged');
assert.equal(sim.WEAPONS[ranged!.weapon]?.id, 'shortbow');

// Begin from the end of the boss death animation. The server callback still
// advances the real sim and processes the resulting stage clear normally.
live.state.boss = { bi: 0, phase: 1, hp: 0, maxHp: 100, x: 10, y: 10, st: 'dead', t: 200, w: 40 };
match.loop();
assert.equal(live.state.mode, 'clear');
const earned = mod.nk.storage.get(progressKey(B));
assert.equal(earned?.value.tier, 2, 'verified stage one clear earns one tier');
assert.equal(earned.permissionRead, 0);
assert.equal(earned.permissionWrite, 0);
assert.equal(mod.nk.storage.get(progressKey(A))?.version, 'earned-3', 'a lower clear preserves a higher tier');
match.loop();
assert.equal(mod.nk.storage.get(progressKey(B))?.version, earned.version, 'replaying the clear window does not write again');

const dropped = seat(A, 'k2');
match.loop([{ sender: ada, opCode: OP.RELEASE, data: { t: 'release', device: 'k2' } }]);
hello(bea, ['gp0', 'gp1']);
equipped(B, 'gp1', 'healer', 'mending-rod', 2);
assert.equal(seat(B, 'gp1').slot, dropped.slot);
assert.equal(seat(B, 'gp1').hp, dropped.hp, 'the live seat changes weapon without refilling health');

console.log('coop banked loadouts and weapon progression ok');
