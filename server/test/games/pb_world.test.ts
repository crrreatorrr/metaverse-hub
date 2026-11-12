// The People's Bitcoin worlds: pb_world match shell over vendor/pb-sim.js and
// the pb.worlds RPC. Opcodes: peoples-bitcoin src/net/protocol.ts.
import assert from 'node:assert/strict';
import { checkRegistrations, loadModule, plain, presence } from '../unit/harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SID_A = '33333333-3333-4333-8333-333333333333';
const SID_B = '44444444-4444-4444-8444-444444444444';
const OP = { HELLO: 1, INTENTS: 2, CHAT: 3, TRADE: 4, WELCOME: 101, SNAPSHOT: 102, DELTA: 103, CHAT_OUT: 104, TRADE_OUT: 105, KICK: 107 };

const mod = loadModule();
const sim = (mod.global.PbSim as { version: string }).version;
assert.equal(typeof sim, 'string');
assert.equal(mod.global.PB_SIM_VERSION, sim);

// Registrations sit in InitModule.
{
  const { issues } = checkRegistrations(mod.source);
  assert.deepEqual(issues, []);
  assert.ok(mod.registered.matches.has('pb_world'));
  assert.ok(mod.registered.rpcs.has('pb.worlds'));
}

// Economy SQL answers for the fake nk.
let earned = 0;
mod.nk.onSql('game.earn_tickets', (args) => {
  earned += Number((args as unknown[])[3]);
  return [{ result: JSON.stringify({ balance: earned }) }];
});
mod.nk.onSql("json_build_object('balance'", () => [{ result: JSON.stringify({ balance: 50, sessionCapLeft: 200, dailyCapLeft: 1000 }) }]);
mod.nk.onSql('game.spend_tickets', () => [{ result: JSON.stringify({ balance: 40 }) }]);

// pb.worlds creates worlds 1..2, reuses them, and registers them.
const first = mod.call<{ worlds: { world: number; matchId: string; players: number; max: number; sim: string }[] }>('pb.worlds', { userId: A, vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
assert.equal(first.worlds.length, 2);
assert.deepEqual(first.worlds.map((w) => w.world), [1, 2]);
assert.equal(first.worlds[0].max, 100);
assert.equal(first.worlds[0].sim, sim);
const again = mod.call<typeof first>('pb.worlds', { userId: A, vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
assert.deepEqual(again.worlds.map((w) => w.matchId), first.worlds.map((w) => w.matchId));
assert.throws(() => mod.call('pb.worlds', {}), /unauthenticated/);

// Label is the contract JSON.
const world1 = mod.driver(first.worlds[0].matchId);
assert.deepEqual(plain(JSON.parse(world1.match.label)), { game: 'peoples-bitcoin', kind: 'pb_world', world: 1, players: 0, max: 100, open: true, sim });

// Join x2: only game sessions of this game get in.
const pa = presence(A, 'Alice');
const pb = presence(B, 'Bob');
assert.equal(world1.joinAttempt(presence(A), { vars: null }).accept, false);
assert.equal(world1.joinAttempt(presence(A), { vars: { scope: 'game', game: 'nobu', sid: SID_A } }).accept, false);
world1.join([pa], { vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
world1.join([pb], { vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_B } });
world1.loop([
  { sender: pa, opCode: OP.HELLO, data: { proto: 1, sim } },
  { sender: pb, opCode: OP.HELLO, data: { proto: 1, sim } },
]);
assert.equal(world1.dispatcher.sent(OP.WELCOME).length, 2);
assert.ok(mod.nk.storage.has(`pb_online/status/${A}`), 'online row written');

// Loop x10 with a walk and chat: deltas flow, chat reaches Bob.
world1.loop([
  { sender: pa, opCode: OP.INTENTS, data: { seq: 1, intents: [{ type: 'walk', x: 27, y: 34 }] } },
  { sender: pa, opCode: OP.CHAT, data: { ch: 'public', text: 'hello world' } },
]);
world1.ticks(10);
type Body = { text?: string; reason?: string };
const toBob = world1.dispatcher.sent<Body>(OP.CHAT_OUT).filter((b) => (b.to ?? []).some((p) => p.userId === B));
assert.ok(toBob.some((b) => b.body.text === 'hello world'), 'public chat reached Bob');
assert.ok(world1.dispatcher.sent(OP.SNAPSHOT).length >= 2);
assert.ok(world1.dispatcher.sent(OP.DELTA).length > 0);
assert.match(world1.match.label, /"players":2/);

// Trade request reaches Bob.
world1.loop([{ sender: pa, opCode: OP.TRADE, data: { op: 'request', to: `p:${B}` } }]);
world1.ticks(1);
assert.ok(world1.dispatcher.sent<Body>(OP.CHAT_OUT).some((b) => (b.body.text ?? '').includes('wishes to trade')));

// Leave: after the grace period the character is saved with server-only permissions.
world1.leave([pa]);
world1.ticks(3 * 20);
const saved = mod.nk.storage.get(`pb_character/main/${A}`);
assert.ok(saved, 'character saved');
assert.equal(saved!.permissionRead, 0);
assert.equal(saved!.permissionWrite, 0);
assert.ok(!mod.nk.storage.has(`pb_online/status/${A}`), 'online row cleared');

// OCC: a newer write elsewhere supersedes this world's copy of Bob.
mod.nk.storage.set(`pb_character/main/${B}`, { value: { save: {} }, version: 'elsewhere', permissionRead: 0, permissionWrite: 0 });
world1.ticks(3 * 100);
const kicks = world1.dispatcher.sent<Body>(OP.KICK).map((b) => b.body.reason);
assert.ok(kicks.includes('superseded'), `kicks: ${kicks.join(',')}`);
assert.equal(mod.nk.storage.get(`pb_character/main/${B}`)!.version, 'elsewhere');

// Rejoining world 1 loads the saved character.
world1.join([presence(A, 'Alice', 's-again')], { vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
world1.loop([]);
assert.match(world1.match.label, /"players":1/);

// Signals: unknown and PM to someone offline.
assert.equal(world1.signal(JSON.stringify({ t: 'pm', to: B, from: 'x', fromName: 'X', fromWorld: 2, text: 'hi' })), 'offline');

// Terminate saves and kicks everyone.
world1.terminate(5);
assert.ok(world1.dispatcher.sent<Body>(OP.KICK).some((b) => b.body.reason === 'shutdown'));

// Nakama 3.41 freezes the global after InitModule. The sim loads on the first world, so its
// bundled zod must not write globalThis (it threw "Cannot add property __zod_globalConfig").
// Goja throws on that write; node:vm runs the bundle sloppy and drops it, so check the source too.
{
  const frozen = loadModule();
  assert.doesNotMatch(frozen.source, /globalThis\)?\.__zod_/, 'pb-sim zod globals are rewritten to a local holder');
  Object.freeze(frozen.global);
  const listed = frozen.call<typeof first>('pb.worlds', { userId: A, vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
  assert.equal(listed.worlds.length, 2);
  const w = frozen.driver(listed.worlds[0].matchId);
  w.join([presence(A, 'Alice')], { vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
  w.loop([{ sender: presence(A, 'Alice'), opCode: OP.HELLO, data: { proto: 1, sim } }]);
  assert.equal(w.dispatcher.sent(OP.WELCOME).length, 1);
  assert.equal(Object.keys(frozen.global).some((k) => k.startsWith('__zod_')), false, 'zod globals stay inside the sim');
}

console.log('pb_world ok');
