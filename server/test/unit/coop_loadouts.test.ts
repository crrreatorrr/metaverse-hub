import assert from 'node:assert/strict';
import { loadModule, presence, type Presence } from './harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP = { HELLO: 1, READY: 3, SEATS: 12, REJECT: 13, RELEASE: 16 };
const progressOwner = '00000000-0000-0000-0000-000000000000';
const progressKey = (userId: string) => `coop_verified_progress/${userId}/${progressOwner}`;
const game = (p: Presence) => ({ ...p, vars: { scope: 'game', game: 'sproto-coop-battle', sid: SID } });

interface Pick { classId: string; weapon: string; fighter?: string }
interface Seat { accountId: string; device: string; slot: number; generation: number; classId: string; weapon: number; weaponTier: number; hp: number; human: number; ctrl: string; fighter: number }

const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
const ada = presence(A, 'ada');
const bea = presence(B, 'bea');

// Guard the namespace before any legitimate row or profile exists. Storage permissions
// alone cannot prevent a client from creating its own first authoritative record.
function rejectProgressStorage(): void {
  for (const [hook, field] of [['registerBeforeWriteStorageObjects', 'objects'], ['registerBeforeDeleteStorageObjects', 'objectIds']]) {
    for (const key of ['weapons', A, 'other']) {
      const forged = { collection: 'coop_verified_progress', key, userId: A,
        value: JSON.stringify({ clears: 4095, tier: 13 }), permissionRead: 0, permissionWrite: 0 };
      assert.throws(() => mod.before(hook!, game(ada), { [field!]: [forged] }),
        (error: unknown) => (error as { message?: string; code?: number }).message === 'coop_progress_server_only'
          && (error as { code?: number }).code === 7);
      // One forbidden entry rejects the entire mixed request, regardless of position.
      const save = { collection: 'save', key: 'game' };
      for (const entries of [[save, forged], [forged, save]]) {
        assert.throws(() => mod.before(hook!, game(ada), { [field!]: entries }));
      }
    }
    const allowed = { [field!]: [{ collection: 'save', key: 'game' }] };
    assert.deepEqual(mod.before(hook!, game(ada), allowed), allowed);
  }
}
assert.equal(mod.nk.storage.has(progressKey(A)), false);
rejectProgressStorage();
assert.equal(mod.nk.storage.has(progressKey(A)), false, 'rejected first writes create no progress');

// A pre-existing client-owned record must never become authoritative, even
// when its permissions imitate a server write. Leave it untouched.
const forgedKey = `coop_verified_progress/weapons/${B}`;
mod.nk.storage.set(forgedKey, { value: { tier: 13, clears: 4095 }, version: 'forged', permissionRead: 0, permissionWrite: 0 });
mod.nk.storage.set(`coop_verified_progress/${B}/${B}`, { value: { tier: 13, clears: 4095 }, version: 'forged-new-key', permissionRead: 0, permissionWrite: 0 });
const { protocol, fingerprint } = mod.call<{ protocol: number; fingerprint: string }>('coop.version', game(ada), {});
const room = mod.call<{ matchId: string; error?: string }>('coop.room_create', game(ada), {});
assert.ok(room.matchId, room.error);
const match = mod.driver(room.matchId);
assert.equal(match.join([ada], game(ada))[0]?.accept, true);
assert.equal(match.join([bea], game(bea))[0]?.accept, true);

// Ada earned tier three on the server. Bea has no stored banked progress.
mod.nk.storage.set(progressKey(A), { value: { tier: 3, clears: 3 }, version: 'earned-3', permissionRead: 0, permissionWrite: 0 });
const sim = mod.global.Sim as { WEAPONS: { id: string }[] };
function hello(sender: Presence, devices: string[], loadouts?: Record<string, Pick>, cpuLoadouts?: Record<number, Pick>, roomMatch = match): void {
  assert.equal(roomMatch.loop([{ sender, opCode: OP.HELLO, data: { t: 'hello', protocol, fingerprint, devices, loadouts, cpuLoadouts } }]), true);
}
function seat(accountId: string, device: string): Seat {
  const latest = match.dispatcher.sent<{ seats: Seat[] }>(OP.SEATS).at(-1);
  const entry = latest?.body.seats.find(s => s.accountId === accountId && s.device === device);
  assert.ok(entry, `${accountId} has ${device}`);
  return entry;
}
function cpu(slot: number, roomMatch = match): Seat {
  const entry = roomMatch.dispatcher.sent<{ seats: Seat[] }>(OP.SEATS).at(-1)?.body.seats[slot];
  assert.ok(entry);
  assert.equal(entry.human, 0);
  assert.equal(entry.ctrl, 'cpu');
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

assert.equal(cpu(3).classId, 'ranged');
const cpuMage = { fighter: 'sproto3106', classId: 'mage', weapon: 'frost-staff' };
hello(ada, ['k1', 'k2'], undefined, { 3: cpuMage });
assert.equal(cpu(3).fighter, 0);
assert.equal(cpu(3).classId, 'mage');
assert.equal(sim.WEAPONS[cpu(3).weapon]?.id, 'frost-staff');
hello(ada, ['k1', 'k2'], undefined, { 3: { classId: 'mage', weapon: 'nova-scepter' } });
rejected('weapon_locked');
hello(ada, ['k1', 'k2'], undefined, { 2: cpuMage });
rejected('occupied');
hello(bea, ['gp0'], undefined, { 3: { classId: 'fighter', weapon: 'katana' } });
rejected('owner');
assert.equal(sim.WEAPONS[cpu(3).weapon]?.id, 'frost-staff');

match.loop([ada, bea].map(sender => ({ sender, opCode: OP.READY, data: { t: 'ready' } })));
assert.equal((match.state as { phase: string }).phase, 'playing');
hello(bea, ['gp0'], { gp0: { classId: 'mage', weapon: 'apprentice-wand' } });
rejected('rejected');
hello(ada, ['k1', 'k2'], undefined, { 3: { classId: 'fighter', weapon: 'katana' } });
rejected('rejected');
type MatchPlayer = { classId: string; weapon: number; hp: number; lives: number; st: string; dead: boolean };
const authority = mod.global.CoopMatch as { liveSession(id: string): { state: { boss: unknown; mode: string; players: MatchPlayer[] } } | null };
const live = authority.liveSession(room.matchId);
assert.ok(live);
const ranged = live.state.players[seat(B, 'gp0').slot];
assert.equal(ranged?.classId, 'ranged');
assert.equal(sim.WEAPONS[ranged!.weapon]?.id, 'shortbow');
assert.equal(sim.WEAPONS[live.state.players[3]!.weapon]?.id, 'frost-staff', 'a CPU keeps its chosen weapon after start');

// Begin from the end of the boss death animation. The server callback still
// advances the real sim and processes the resulting stage clear normally.
live.state.boss = { bi: 0, phase: 1, hp: 0, maxHp: 100, x: 10, y: 10, st: 'dead', t: 200, w: 40 };
match.loop();
assert.equal(live.state.mode, 'clear');
const earned = mod.nk.storage.get(progressKey(B));
assert.equal(earned?.value.tier, 2, 'verified stage one clear earns one tier');
assert.equal(mod.nk.storage.get(forgedKey)?.version, 'forged', 'untrusted legacy records are not imported or deleted');
assert.equal(earned.permissionRead, 0);
assert.equal(earned.permissionWrite, 0);
rejectProgressStorage();
assert.equal(mod.nk.storage.get(progressKey(B))?.version, earned.version, 'client attempts leave earned progress unchanged');
assert.equal(mod.nk.storage.get(progressKey(A))?.version, 'earned-3', 'a lower clear preserves a higher tier');
match.loop();
assert.equal(mod.nk.storage.get(progressKey(B))?.version, earned.version, 'replaying the clear window does not write again');

const dropped = seat(A, 'k2');
match.loop([{ sender: ada, opCode: OP.RELEASE, data: { t: 'release', device: 'k2' } }]);
hello(bea, ['gp0', 'gp1']);
equipped(B, 'gp1', 'healer', 'mending-rod', 2);
assert.equal(seat(B, 'gp1').slot, dropped.slot);
assert.equal(seat(B, 'gp1').hp, dropped.hp, 'the live seat changes weapon without refilling health');

const firstSeat = seat(A, 'k1').slot;
match.loop([{ sender: ada, opCode: OP.RELEASE, data: { t: 'release', device: 'k1' } }]);
Object.assign(live.state.players[firstSeat]!, { hp: 0, lives: 0, st: 'dead', dead: true });
live.state.players[3]!.hp = 29;
hello(bea, ['gp0', 'gp1', 'gp2']);
equipped(B, 'gp2', 'mage', 'apprentice-wand', 2);
assert.equal(seat(B, 'gp2').slot, 3, 'a live drop-in takes a standing CPU before a defeated one');
assert.equal(seat(B, 'gp2').hp, 29);

// A departing lobby leader cannot leave weapons above the next leader's verified tier.
const cam = presence('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cam');
const dez = presence('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dez');
const nextRoom = mod.call<{ matchId: string }>('coop.room_create', game(cam), {});
assert.ok(nextRoom.matchId);
const nextMatch = mod.driver(nextRoom.matchId);
assert.equal(nextMatch.join([cam], game(cam))[0]?.accept, true);
assert.equal(nextMatch.join([dez], game(dez))[0]?.accept, true);
mod.nk.storage.set(progressKey(cam.userId), { value: { tier: 3, clears: 3 }, version: 'earned-3', permissionRead: 0, permissionWrite: 0 });
hello(cam, ['k1'], undefined, { 3: cpuMage }, nextMatch);
hello(dez, ['gp0'], undefined, undefined, nextMatch);
assert.equal(sim.WEAPONS[cpu(3, nextMatch).weapon]?.id, 'frost-staff');
nextMatch.loop([{ sender: cam, opCode: OP.RELEASE, data: { t: 'release', device: 'k1' } }]);
nextMatch.loop([{ sender: dez, opCode: OP.READY, data: { t: 'ready' } }]);
assert.equal((nextMatch.state as { phase: string }).phase, 'playing');
const nextLive = authority.liveSession(nextRoom.matchId);
assert.ok(nextLive);
assert.equal(nextLive.state.players[3]?.classId, 'mage');
assert.equal(sim.WEAPONS[nextLive.state.players[3]!.weapon]?.id, 'apprentice-wand');

console.log('coop banked loadouts and weapon progression ok');
