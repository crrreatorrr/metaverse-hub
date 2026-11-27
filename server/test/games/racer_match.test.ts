// Sproto Racer online races (games/racer_match.ts, games/racer_protocol.ts, vendor/racer-sim.js).
// The vendored match host runs for real here: players join, say HELLO, ready up, send inputs,
// drop and come back, and the race runs to its result. The game's own tests cover the host and
// the client that corrects itself against it; these cover what the hub adds around the host.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkRegistrations, loadModule, plain, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = readFileSync(join(root, 'server/modules/vendor/racer-sim.js'), 'utf8');
const PIN = JSON.parse(readFileSync(join(root, 'server/modules/vendor/racer-sim.pin.json'), 'utf8')) as {
  kind: string; repo: string; commit: string; bundleBytes: number; game: string; netVersion: string; simVersion: string; bundleSha256: string; smokeHash240: string;
};

const GAME = 'sproto-racer';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP = { HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 5, RESULT: 7, LOBBY: 9, PING: 10, PONG: 11, INPUTS: 14, KEYFRAME: 17, SEAT: 18, ERROR: 19 };
const RATE = 60;

const session = (userId: string, game = GAME) => ({ userId, vars: { scope: 'game', game, sid: SID } });
const server = {};
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const flagRow = (state: string) => (args: unknown[]) => (String(args[0]) === 'racer_online' ? [{ result: JSON.stringify({ state, allowlist: [], percent: 0 }) }] : []);

function load(flag: 'on' | 'off'): LoadedModule {
  // jsonState: Nakama hands the state back as plain data on every callback, so nothing live may sit in it.
  return loadModule({ clock: 1_700_000_000_000, jsonState: true, sql: [[/FROM game\.server_flags/, flagRow(flag)]] });
}

interface Sent { opCode: number; text: string | null; bytes: Uint8Array | null; buffer: ArrayBuffer | null; to: Presence[] }

/** Records every broadcast as the handler made it, and checks what Nakama 3.41 would reject. */
function tap(m: MatchDriver): Sent[] {
  const sent: Sent[] = [];
  const inner = m.dispatcher.broadcastMessage.bind(m.dispatcher);
  m.dispatcher.broadcastMessage = (opCode, data, presences, sender, reliable) => {
    const binary = Object.prototype.toString.call(data) === '[object ArrayBuffer]';
    assert.ok(typeof data === 'string' || binary, 'data is a string or an ArrayBuffer, never a typed array');
    assert.ok(Array.isArray(presences) && presences.length > 0, 'every message names who it goes to');
    const buffer = binary ? (data as ArrayBuffer) : null;
    sent.push({ opCode, text: binary ? null : (data as string), bytes: buffer ? new Uint8Array(buffer.slice(0)) : null, buffer, to: Array.from(presences, (p) => ({ ...p })) });
    inner(opCode, data, presences, sender, reliable);
  };
  return sent;
}

const json = <T = Record<string, unknown>>(sent: Sent[], opCode: number, userId?: string) =>
  sent.filter((s) => s.opCode === opCode && s.text !== null && (!userId || s.to.some((p) => p.userId === userId))).map((s) => JSON.parse(s.text!) as T);
const users = (s: Sent) => s.to.map((p) => p.userId).sort();

interface RacerState { broken: string; privateRoom: boolean; code: string; courseId: string; phase: string; players: number; open: boolean; label: string; ended: boolean; endReason: string; maxHumans: number }
const stateOf = (m: MatchDriver) => m.state as RacerState;
const labelOf = (m: MatchDriver) => JSON.parse(m.match.label) as Record<string, unknown>;

// The vendored file, its pin and the constants the module checks at run time all name one build.
{
  assert.equal(PIN.kind, 'sproto-racer-sim-pin');
  assert.equal(PIN.repo, 'crrreatorrr/Sproto-Racer');
  assert.equal(PIN.game, GAME);
  assert.match(PIN.commit, /^[0-9a-f]{40}$/);
  assert.equal(sha256(BUNDLE), PIN.bundleSha256, 'vendor/racer-sim.js is the pinned file');
  assert.equal(Buffer.byteLength(BUNDLE, 'utf8'), PIN.bundleBytes);
  const header = /^var RACER_SIM_VERSION = '([0-9a-f]{16})';\n/.exec(BUNDLE);
  assert.ok(header, 'generated header');
  assert.equal(header[1], PIN.simVersion);
  assert.equal(sha256(BUNDLE.slice(header[0].length)).slice(0, 16), PIN.simVersion, 'the version is the hash of the code it names');

  const mod = load('on');
  const proto = mod.global.RacerProto as Record<string, unknown> & { verifyRuntime(): string | null; courseIds(): string[] };
  assert.equal(proto.SIM_VERSION, PIN.simVersion);
  assert.equal(proto.NET_VERSION, PIN.netVersion);
  assert.equal(proto.BUNDLE_SHA256, PIN.bundleSha256);
  assert.equal(proto.COMMIT, PIN.commit);
  assert.equal(proto.verifyRuntime(), null);
  assert.deepEqual(plain(proto.courseIds()), ['track01', 'track02', 'track03', 'track04', 'track05', 'track06']);

  // The game's own smoke race: 240 ticks of one kart, to the same state hash the game built the pin from.
  const sim = mod.global.RacerSim as { createMatch(o: object): { step(i: object): unknown }; stateHash(w: unknown): string };
  const world = sim.createMatch({ courseId: 'track01', seed: 42 });
  for (let i = 0; i < 240; i += 1) world.step({ 0: { throttle: 1, steer: 0.15, driftHeld: i > 190, driftPressed: i === 191 } });
  assert.equal(sim.stateHash(world), PIN.smokeHash240);

  // What goes to broadcastMessage: a string as it is, or a buffer of its own holding exactly the view's bytes.
  const payloadOf = proto.payloadOf as (data: Uint8Array | string) => string | ArrayBuffer;
  const scratch = new Uint8Array([1, 2, 3, 4, 5]);
  const copied = payloadOf(scratch.subarray(1, 3)) as ArrayBuffer;
  scratch.fill(9);
  assert.deepEqual([...new Uint8Array(copied)], [2, 3]);
  assert.equal(payloadOf('{"a":1}'), '{"a":1}');

  assert.ok(mod.registered.matches.has('sproto_racer'));
  for (const id of ['racer.version', 'racer.room_create', 'racer.room_join', 'racer.online_count', 'racer.metrics']) assert.ok(mod.registered.rpcs.has(id), id);
  assert.deepEqual(checkRegistrations(mod.source).issues, []);
  // The game id keeps its one registration, now with the quick-race queue.
  const games = mod.global.HubGames as { list(): string[]; matchmakingAllowed(scope: string, game: string, target: string): boolean };
  assert.equal(plain(games.list()).filter((id) => id === GAME).length, 1);
  assert.equal(games.matchmakingAllowed('game', GAME, GAME), true);
  assert.equal(games.matchmakingAllowed('game', 'sproto-shooter', GAME), false);
  assert.equal(games.matchmakingAllowed('hub', '', GAME), false);
}

// With no row in game.server_flags (or the row off) nothing new opens.
{
  const mod = load('off');
  assert.equal(mod.call<{ enabled?: boolean }>('racer.version', session(A)).enabled, false);
  assert.equal(mod.call<{ error?: string }>('racer.room_create', session(A), { version: PIN.netVersion, simVersion: PIN.simVersion }).error, 'online_off');
  const ticket = { matchmakerAdd: { minCount: 2, maxCount: 6, query: '*', stringProperties: { game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, mode: 'race' } } };
  assert.throws(() => mod.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket), /online_off/);
  const props = { game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, mode: 'race' };
  assert.equal(mod.matchmake([{ presence: presence(A), properties: props }, { presence: presence(B), properties: props }]), undefined);
  assert.equal([...mod.nk.matches.values()].filter((m) => m.module === 'sproto_racer').length, 0);
  // Another game's ticket is none of this file's business.
  const noteAdd = (mod.global.RacerMatch as { noteAdd(ctx: unknown, logger: unknown, nk: unknown, env: unknown): void }).noteAdd;
  assert.doesNotThrow(() => noteAdd(mod.ctx(session(A, 'sproto-shooter')), mod.logger, mod.nk, { matchmakerAdd: { stringProperties: { game: 'sproto-shooter' } } }));
}

const on = load('on');
const manifest = plain((on.global.RacerSim as { contentManifest(): { cars: { id: string }[]; drivers: string[] } }).contentManifest());
const CAR = manifest.cars[0]!.id;
const DRIVER = manifest.drivers[0]!;
const hello = (extra: Record<string, unknown> = {}) => ({ v: PIN.netVersion, sim: PIN.simVersion, car: CAR, driver: DRIVER, ...extra });

// The RPCs answer only a sproto-racer game session; racer.metrics only the http key.
{
  for (const id of ['racer.version', 'racer.room_create', 'racer.room_join', 'racer.online_count']) {
    assert.equal(on.call<{ error?: string }>(id, { userId: A, vars: { scope: 'hub' } }, {}).error, 'wrong_scope', id);
    assert.equal(on.call<{ error?: string }>(id, session(A, 'sproto-shooter'), {}).error, 'wrong_scope', id);
  }
  assert.equal(on.call<{ error?: string }>('racer.metrics', session(A), { matchId: 'x' }).error, 'unauthorized');
  const v = on.call<Record<string, unknown>>('racer.version', session(A));
  assert.equal(v.enabled, true);
  assert.equal(v.simVersion, PIN.simVersion);
  assert.equal(v.version, PIN.netVersion);
  assert.equal(v.match, 'sproto_racer');
  assert.equal(v.tickRate, 60);
  assert.equal(v.maxSeats, 6);
  assert.equal(on.call<{ error?: string }>('racer.room_create', session(A), { simVersion: 'feedfacefeedface' }).error, 'sim_version_mismatch');
  assert.equal(on.call<{ error?: string }>('racer.room_create', session(A), { version: '2' }).error, 'version_mismatch');
  assert.equal(on.call<{ error?: string }>('racer.room_create', session(A), { courseId: 'track99' }).error, 'invalid_course');
  assert.equal(on.call<{ error?: string }>('racer.room_create', session(A), { mode: 'trial' }).error, 'bad_mode');
  assert.equal(on.call<{ error?: string }>('racer.room_create', session(A), '[1]').error, 'bad_json');
}

// A private room, start to finish.
{
  const made = on.call<{ matchId: string; code: string; maxSeats: number; error?: string }>('racer.room_create', session(A), {
    game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, courseId: 'track01', mode: 'race', maxSeats: 2,
  });
  assert.equal(made.error, undefined, JSON.stringify(made));
  assert.match(made.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.equal(made.maxSeats, 2);
  const m = on.driver(made.matchId);
  const sent = tap(m);
  assert.equal(m.match.tickRate, 60);
  assert.equal(stateOf(m).broken, '');
  assert.equal(stateOf(m).courseId, 'track01');
  const label = labelOf(m);
  assert.equal(label.kind, 'sproto_racer');
  assert.equal(label.game, GAME);
  assert.equal(label.open, false, 'a private room is never found by quick match');
  assert.equal(label.private, true);
  assert.equal(label.simVersion, PIN.simVersion);
  assert.equal(label.version, PIN.netVersion);
  assert.doesNotMatch(m.match.label, new RegExp(made.code), 'the label does not carry the code');
  assert.ok(on.nk.storage.has(`sproto_racer/code:${made.code}/00000000-0000-0000-0000-000000000000`));

  const a1 = presence(A, 'alice', '11111111-1111-4111-8111-111111111111');
  const b1 = presence(B, 'bob <b>', '22222222-2222-4222-8222-222222222222');
  const c1 = presence(C, 'carol', '33333333-3333-4333-8333-333333333333');

  // Who gets in.
  assert.deepEqual(m.joinAttempt(a1, { vars: { scope: 'hub' } }), { accept: false, rejectMessage: 'wrong_scope' });
  assert.deepEqual(m.joinAttempt(a1, session(A, 'sproto-shooter')), { accept: false, rejectMessage: 'wrong_scope' });
  assert.deepEqual(m.joinAttempt(b1, session(B)), { accept: false, rejectMessage: 'not_admitted' });
  assert.equal(on.call<{ error?: string }>('racer.room_join', session(B), { code: 'ZZZZZZ' }).error, 'room_not_found');
  assert.equal(on.call<{ error?: string }>('racer.room_join', session(B), { code: 'nope' }).error, 'room_not_found');
  assert.equal(on.call<{ error?: string }>('racer.room_join', session(B), { code: made.code, simVersion: 'feedfacefeedface' }).error, 'sim_version_mismatch');
  const found = on.call<{ matchId?: string; error?: string }>('racer.room_join', session(B), { game: GAME, code: made.code.toLowerCase(), version: PIN.netVersion, simVersion: PIN.simVersion });
  assert.equal(found.matchId, made.matchId, JSON.stringify(found));
  assert.deepEqual(m.join([a1], session(A)), [{ accept: true, rejectMessage: undefined }]);
  assert.deepEqual(m.joinAttempt(b1, session(B), { simVersion: 'feedfacefeedface' }), { accept: false, rejectMessage: 'sim_version_mismatch' });
  assert.deepEqual(m.join([b1], session(B)), [{ accept: true, rejectMessage: undefined }]);
  assert.equal(on.call<{ matchId?: string }>('racer.room_join', session(C), { code: made.code }).matchId, made.matchId);
  assert.deepEqual(m.joinAttempt(c1, session(C)), { accept: false, rejectMessage: 'match_full' });
  assert.equal(stateOf(m).players, 2);
  assert.equal(labelOf(m).players, 2);

  // HELLO: a wrong build is told so, alone. The name the others see is the hub account's, cleaned.
  m.loop([{ sender: b1, opCode: OP.HELLO, data: hello({ sim: 'feedfacefeedface' }) }]);
  const refused = sent.filter((s) => s.opCode === OP.ERROR);
  assert.equal(refused.length, 1);
  assert.deepEqual(users(refused[0]!), [B]);
  assert.equal(JSON.parse(refused[0]!.text!).error, 'sim_version_mismatch');
  // A HELLO the hub cannot read is not passed on with the client's name in it: the host is handed nothing.
  sent.length = 0;
  m.loop([{ sender: b1, opCode: OP.HELLO, data: hello({ name: 'admin', pad: 'x'.repeat(3000) }) }]);
  m.loop([{ sender: b1, opCode: OP.HELLO, data: new Uint8Array([0xff, 0xfe, 1, 2]) }]);
  m.loop([{ sender: b1, opCode: OP.HELLO, data: '["admin"]' }]);
  assert.deepEqual(sent.filter((s) => s.opCode === OP.ERROR).map((s) => [users(s).join(), JSON.parse(s.text!).error]), [[B, 'bad_hello'], [B, 'bad_hello'], [B, 'bad_hello']]);
  assert.equal(sent.filter((s) => s.opCode === OP.WELCOME || s.opCode === OP.LOBBY).length, 0, 'nobody entered the lobby that way');
  sent.length = 0;
  m.loop([
    { sender: a1, opCode: OP.HELLO, data: hello({ name: 'admin <script>' }) },
    { sender: b1, opCode: OP.HELLO, data: hello() },
  ]);
  const welcomeA = json<{ v: string; sim: string; phase: string; tickRate: number; you: number; room: { courseId: string; laps: number; seatCount: number; maxHumans: number } }>(sent, OP.WELCOME, A)[0]!;
  assert.equal(welcomeA.v, PIN.netVersion);
  assert.equal(welcomeA.sim, PIN.simVersion);
  assert.equal(welcomeA.phase, 'lobby');
  assert.equal(welcomeA.tickRate, 60);
  assert.deepEqual(welcomeA.room, { courseId: 'track01', laps: 3, seatCount: 6, maxHumans: 2 });
  assert.equal(sent.filter((s) => s.opCode === OP.WELCOME).every((s) => s.to.length === 1), true, 'WELCOME goes to one player');
  const lobby = json<{ phase: string; players: { name: string; ready: boolean }[] }>(sent, OP.LOBBY).at(-1)!;
  assert.deepEqual(lobby.players.map((p) => p.name), ['alice', 'bob b']);
  assert.deepEqual(users(sent.filter((s) => s.opCode === OP.LOBBY).at(-1)!), [A, B], 'the lobby list goes to everyone here');

  // PING is answered to the sender. A message from a socket that is not the account's own is dropped.
  sent.length = 0;
  m.loop([{ sender: a1, opCode: OP.PING, data: new Uint8Array([1, 2, 3, 4]) }]);
  const pong = sent.filter((s) => s.opCode === OP.PONG);
  assert.equal(pong.length, 1);
  assert.deepEqual(users(pong[0]!), [A]);
  assert.deepEqual([...pong[0]!.bytes!.slice(0, 4)], [1, 2, 3, 4]);
  sent.length = 0;
  m.loop([{ sender: presence(A, 'alice', '99999999-9999-4999-8999-999999999999'), opCode: OP.PING, data: new Uint8Array([1, 2, 3, 4]) }]);
  assert.equal(sent.filter((s) => s.opCode === OP.PONG).length, 0);

  // Both ready: the race is set up and nobody new gets in.
  sent.length = 0;
  m.loop([{ sender: a1, opCode: OP.READY, data: { ready: true } }, { sender: b1, opCode: OP.READY, data: { ready: true } }]);
  interface Start { serverTick: number; you: number; race: { courseId: string; laps: number; seed: number; startTick: number; seats: { kind: string; name: string; car: string; driver: string }[] } }
  const startA = json<Start>(sent, OP.START, A)[0]!;
  const startB = json<Start>(sent, OP.START, B)[0]!;
  assert.equal(startA.you, 0);
  assert.equal(startB.you, 1);
  assert.equal(startA.race.courseId, 'track01');
  assert.equal(startA.race.laps, 3);
  assert.ok(Number.isInteger(startA.race.seed) && startA.race.seed > 0, 'the server picked the seed');
  assert.deepEqual(startA.race.seats.map((s) => s.kind), ['remote', 'remote', 'ai', 'ai', 'ai', 'ai']);
  assert.deepEqual(startA.race.seats.map((s) => s.name), ['alice', 'bob b', 'CPU', 'CPU', 'CPU', 'CPU']);
  assert.deepEqual(plain(startA.race), plain(startB.race), 'both players are sent the same race');
  assert.equal(stateOf(m).phase, 'starting');
  assert.equal(labelOf(m).open, false);
  assert.deepEqual(m.joinAttempt(c1, session(C)), { accept: false, rejectMessage: 'race_started' });
  assert.equal(on.call<{ error?: string }>('racer.room_join', session(C), { code: made.code }).error, 'room_not_found', 'the code stops admitting new accounts');

  // Drive: both players hold the throttle, each input stamped two ticks ahead as a client would.
  const api = (on.global.RacerSim as { api(): { controlsToIntentFrame(tick: number, c: object): object; encodeIntentFrame(f: object, out: Uint8Array, at: number): void } }).api();
  // The bundle only writes into a Uint8Array of its own realm, so the packet is built there and copied out.
  const RealmBytes = vm.runInContext('Uint8Array', on.global as vm.Context) as Uint8ArrayConstructor;
  const input = (seat: number, tick: number) => {
    const bytes = new RealmBytes(14);
    bytes[0] = seat;
    bytes[1] = 1;
    api.encodeIntentFrame(api.controlsToIntentFrame(tick, { throttle: 1, steer: 0 }), bytes, 2);
    return new Uint8Array(bytes);
  };
  let afterStart = 0;
  const drive = (who: [Presence, number][]) => {
    afterStart += 1;
    const tick = startA.serverTick + afterStart - startA.race.startTick + 2;
    return m.loop(tick < 0 ? [] : who.map(([p, seat]) => ({ sender: p, opCode: OP.INPUT, data: input(seat, tick) })));
  };
  sent.length = 0;
  for (let i = 0; i < 600; i += 1) assert.ok(drive([[a1, 0], [b1, 1]]));
  assert.equal(stateOf(m).phase, 'race');
  const batches = sent.filter((s) => s.opCode === OP.INPUTS);
  // 480 race ticks in batches of two, minus one at the start of the window.
  assert.ok(batches.length >= 230 && batches.length <= 245, `relayed input batches: ${batches.length}`);
  assert.ok(batches.every((s) => s.bytes !== null && users(s).join() === [A, B].join()), 'each batch is binary and goes to both players in one call');
  assert.equal(sent.filter((s) => s.opCode === OP.ERROR).length, 0);
  // The host reuses its buffers; what the hub handed to Nakama must not change afterwards.
  for (const s of batches) assert.deepEqual(new Uint8Array(s.buffer!), s.bytes);
  const mid = on.call<{ phase: string; raceTick: number; loopMs: { count: number }; dropped: number; host: Record<string, number> }>('racer.metrics', server, { matchId: made.matchId });
  assert.equal(mid.phase, 'race');
  assert.ok(mid.raceTick > 470, `race tick ${mid.raceTick}`);
  assert.ok(mid.host.inputFrames! > 950, `input frames taken: ${mid.host.inputFrames}`);
  assert.equal(mid.host.rejectedMalformed, 0);
  assert.equal(mid.host.rejectedSeat, 0);
  assert.equal(mid.host.rejectedWindow, 0);
  assert.equal(mid.host.rejectedRate, 0);
  assert.equal(mid.dropped, 1, 'only the message from the stale socket was dropped');
  assert.ok(mid.loopMs.count > 600);
  assert.equal(on.call<{ error?: string }>('racer.metrics', server, { matchId: 'nope' }).error, 'match_missing');

  // Bob's connection drops: the AI takes his kart at once, and the seat stays his.
  sent.length = 0;
  m.leave([b1]);
  const handover = sent.filter((s) => s.opCode === OP.SEAT);
  assert.equal(handover.length, 1);
  assert.deepEqual(users(handover[0]!), [A]);
  assert.deepEqual([...handover[0]!.bytes!.slice(0, 2)], [1, 0], 'seat 1 is driven by the AI');
  assert.equal(stateOf(m).players, 1);
  for (let i = 0; i < 120; i += 1) assert.ok(drive([[a1, 0]]));
  assert.deepEqual(m.joinAttempt(c1, session(C)), { accept: false, rejectMessage: 'race_started' });

  // He comes back on a new socket: WELCOME, the full state in chunks under the socket limit, and
  // the wheel again on his first input.
  const b2 = presence(B, 'bob <b>', '44444444-4444-4444-8444-444444444444');
  sent.length = 0;
  assert.deepEqual(m.join([b2], session(B)), [{ accept: true, rejectMessage: undefined }]);
  assert.ok(drive([[a1, 0]]));
  afterStart += 1;
  assert.ok(m.loop([{ sender: b2, opCode: OP.HELLO, data: hello() }]));
  const back = json<{ phase: string; you: number; race: { seats: unknown[] } }>(sent, OP.WELCOME, B)[0]!;
  assert.equal(back.phase, 'race');
  assert.equal(back.you, 1);
  assert.equal(back.race.seats.length, 6);
  const chunks = sent.filter((s) => s.opCode === OP.KEYFRAME);
  assert.ok(chunks.length >= 1, 'the full state was sent');
  assert.ok(chunks.every((s) => users(s).join() === B && s.bytes!.length <= 4096), 'to him alone, in chunks of at most 4096 bytes');
  sent.length = 0;
  for (let i = 0; i < 10; i += 1) assert.ok(drive([[a1, 0], [b2, 1]]));
  const retake = sent.filter((s) => s.opCode === OP.SEAT);
  assert.equal(retake.length, 1);
  assert.deepEqual([...retake[0]!.bytes!.slice(0, 2)], [1, 1], 'seat 1 is his again');
  assert.deepEqual(users(retake[0]!), [A, B]);

  // A second socket of the same account takes over; the first is kicked and its late leave changes nothing.
  const a2 = presence(A, 'alice', '55555555-5555-4555-8555-555555555555');
  sent.length = 0;
  assert.deepEqual(m.join([a2], session(A)), [{ accept: true, rejectMessage: undefined }]);
  assert.equal(m.dispatcher.kicks.length, 1);
  assert.equal(m.dispatcher.kicks[0]![0]!.sessionId, a1.sessionId);
  m.leave([a1]);
  assert.equal(sent.filter((s) => s.opCode === OP.SEAT).length, 0, 'her kart stays hers');
  assert.equal(stateOf(m).players, 2);
  for (let i = 0; i < 5; i += 1) assert.ok(drive([[a2, 0], [b2, 1]]));
  assert.ok(sent.filter((s) => s.opCode === OP.INPUTS).every((s) => s.to.some((p) => p.sessionId === a2.sessionId) && !s.to.some((p) => p.sessionId === a1.sessionId)));

  // To the flag. Nobody steers, so the AI wins and the race ends 25 s after the first kart is home.
  sent.length = 0;
  let loops = 0;
  while (stateOf(m).phase !== 'finished' && loops < 30000) {
    assert.ok(drive([[a2, 0], [b2, 1]]));
    loops += 1;
  }
  assert.equal(stateOf(m).phase, 'finished', `still racing after ${loops} loops`);
  const results = sent.filter((s) => s.opCode === OP.RESULT);
  assert.equal(results.length, 1);
  assert.deepEqual(users(results[0]!), [A, B]);
  const result = JSON.parse(results[0]!.text!) as { tick: number; hash: string; standings: { place: number; seat: number; human: boolean; name: string; finishUs: number | null }[] };
  assert.match(result.hash, /^[0-9a-f]{16}$/);
  assert.equal(result.standings.length, 6);
  assert.deepEqual(result.standings.map((s) => s.place), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.standings[0]!.human, false);
  assert.ok(result.standings[0]!.finishUs! > 0);
  assert.deepEqual(result.standings.filter((s) => s.human).map((s) => s.name).sort(), ['alice', 'bob b']);
  assert.ok(on.logger.lines.some((l) => l.level === 'info' && l.message.includes(`sproto_racer finished ${made.matchId}`) && l.message.includes(result.hash)));
  // No Ticket, score or Relic statement ran for any of it.
  assert.equal(on.nk.sqlCalls.filter((c) => !/server_flags/.test(c.sql) && /ticket|ledger|score|relic|wallet/i.test(c.sql)).length, 0);

  // The finished race lingers, so a player who reconnects still gets in; then the match closes without an error.
  assert.equal(on.call<{ hard: number; kinds: { racer: number } }>('maint.live', server, {}).kinds.racer, 1);
  // RESULT went out once. A player who was away at that moment gets it again with the welcome back, alone.
  sent.length = 0;
  m.leave([b2]);
  const b3 = presence(B, 'bob <b>', '66666666-6666-4666-8666-666666666666');
  assert.deepEqual(m.join([b3], session(B)), [{ accept: true, rejectMessage: undefined }]);
  assert.ok(m.loop([{ sender: b3, opCode: OP.HELLO, data: hello() }]));
  assert.equal(json<{ phase: string }>(sent, OP.WELCOME, B)[0]!.phase, 'finished');
  const again = sent.filter((s) => s.opCode === OP.RESULT);
  assert.equal(again.length, 1);
  assert.deepEqual(users(again[0]!), [B]);
  assert.equal(again[0]!.text, results[0]!.text);
  sent.length = 0;
  assert.ok(m.ticks(20 * RATE - 1));
  assert.equal(stateOf(m).ended, false);
  assert.ok(m.ticks(1));
  assert.equal(stateOf(m).ended, true);
  assert.equal(stateOf(m).endReason, 'finished');
  assert.equal(m.loop([]), false, 'the match is over');
  assert.equal(sent.filter((s) => s.opCode === OP.ERROR).length, 0);
  assert.equal(on.nk.storage.has(`sproto_racer/code:${made.code}/00000000-0000-0000-0000-000000000000`), false, 'the code is free again');
  assert.deepEqual(m.joinAttempt(a2, session(A)), { accept: false, rejectMessage: 'ended' });
}

// Quick race: tickets, a public lobby, and the start it forces.
{
  const props = { game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, mode: 'race' };
  const ticket = (stringProperties: Record<string, string>) => ({ matchmakerAdd: { minCount: 2, maxCount: 6, query: '*', stringProperties } });
  const queued = on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket(props));
  assert.deepEqual(plain(queued), ticket(props), 'a good ticket passes unchanged');
  assert.throws(() => on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket({ ...props, simVersion: 'feedfacefeedface' })), /sim_version_mismatch/);
  assert.throws(() => on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket({ ...props, version: '2' })), /version_mismatch/);
  assert.throws(() => on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket({ ...props, mode: 'trial' })), /bad_mode/);
  assert.throws(() => on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, ticket({ ...props, courseId: 'track99' })), /invalid_course/);
  assert.throws(() => on.rtBefore('MatchmakerAdd', { ...session(A, 'sproto-shooter'), sessionId: 's-a' }, ticket(props)), /wrong_game/);
  // The game asks for groups of up to twelve; a group this server could not seat is never formed.
  const wide = on.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, { matchmakerAdd: { minCount: 1, maxCount: 12, query: '*', stringProperties: props } });
  assert.deepEqual([(wide.matchmakerAdd as { minCount: number }).minCount, (wide.matchmakerAdd as { maxCount: number }).maxCount], [2, 6]);

  assert.equal(on.matchmake([{ presence: presence(A), properties: props }]), undefined, 'one ticket is not a race');
  assert.equal(on.matchmake([{ presence: presence(A), properties: props }, { presence: presence(B), properties: { ...props, simVersion: 'feedfacefeedface' } }]), undefined);
  const both = { ...props, courseId: 'track03' };
  const id = on.matchmake([{ presence: presence(A), properties: both }, { presence: presence(B), properties: both }]);
  assert.ok(id, 'a matched pair gets a room');
  const m = on.driver(id);
  const sent = tap(m);
  assert.equal(stateOf(m).courseId, 'track03', 'the circuit they both asked for');
  assert.equal(stateOf(m).privateRoom, false);
  assert.equal(labelOf(m).open, true);
  assert.equal(labelOf(m).players, 0);
  assert.equal(labelOf(m).maxSeats, 6);
  // The game's quick-match search finds it.
  const query = `+label.kind:sproto_racer +label.open:T +label.version:${PIN.netVersion} +label.simVersion:${PIN.simVersion} +label.mode:race +label.players:<6`;
  const listed = (on.nk.matchList as (limit: number, auth: boolean, label: null, min: null, max: null, query: string) => { matchId: string }[])(10, true, null, null, null, query);
  assert.deepEqual(listed.map((row) => row.matchId), [id]);

  const a = presence(A, 'alice', '11111111-1111-4111-8111-111111111111');
  const b = presence(B, 'bob', '22222222-2222-4222-8222-222222222222');
  const c = presence(C, 'carol', '33333333-3333-4333-8333-333333333333');
  assert.equal(m.join([a], session(A))[0]!.accept, true, 'no code needed');
  assert.equal(labelOf(m).players, 1);
  assert.equal(on.call<{ count: number; rooms: number }>('racer.online_count', session(A)).count, 1);
  // A join that was accepted holds its place until it arrives or ten seconds pass.
  assert.equal(m.joinAttempt(b, session(B)).accept, true);
  assert.equal(m.joinAttempt(c, session(C)).accept, true);
  m.ticks(1);
  m.loop([{ sender: a, opCode: OP.HELLO, data: hello() }]);
  assert.equal(stateOf(m).phase, 'lobby');
  // The room was made for two. One of them being ready does not start it without the other.
  m.loop([{ sender: a, opCode: OP.READY, data: { ready: true } }]);
  assert.equal(stateOf(m).phase, 'lobby');
  // The other never arrives. 45 s after the first player was in, the race starts anyway.
  assert.ok(m.ticks(44 * RATE));
  assert.equal(stateOf(m).phase, 'lobby');
  assert.ok(m.ticks(2 * RATE));
  assert.equal(stateOf(m).phase, 'starting');
  assert.equal(json<{ you: number }>(sent, OP.START, A)[0]!.you, 0);
  assert.equal(labelOf(m).open, false);
  assert.equal(m.joinAttempt(b, session(B)).rejectMessage, 'race_started');

  // Everyone leaves the race: it runs on for 30 s in case they come back, then closes.
  m.leave([a]);
  assert.ok(m.ticks(30 * RATE));
  assert.equal(stateOf(m).ended, false);
  assert.ok(m.ticks(1));
  assert.equal(stateOf(m).ended, true);
  assert.equal(stateOf(m).endReason, 'abandoned');
  assert.equal(m.loop([]), false);
}

// A matched group's places are kept for them, and the room starts once they are all in and ready.
{
  const props = { game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, mode: 'race' };
  const six = [0, 1, 2, 3, 4, 5].map((i) => presence(`00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`, `racer${i}`, `77777777-7777-4777-8777-0000000000${String(i).padStart(2, '0')}`));
  const id = on.matchmake(six.map((p) => ({ presence: p, properties: props })));
  assert.ok(id);
  const m = on.driver(id);
  const sent = tap(m);
  const outsider = presence(C, 'carol', '33333333-3333-4333-8333-333333333333');
  assert.equal(labelOf(m).open, false, 'every place is spoken for, so the search does not offer the room');
  assert.deepEqual(m.joinAttempt(outsider, session(C)), { accept: false, rejectMessage: 'match_full' });
  for (const p of six) assert.equal(m.join([p], session(p.userId))[0]!.accept, true);
  m.loop(six.map((p) => ({ sender: p, opCode: OP.HELLO, data: hello() })));
  m.loop(six.slice(0, 5).map((p) => ({ sender: p, opCode: OP.READY, data: { ready: true } })));
  assert.equal(stateOf(m).phase, 'lobby', 'five of six ready is not everyone');
  m.loop([{ sender: six[5]!, opCode: OP.READY, data: { ready: true } }]);
  assert.equal(stateOf(m).phase, 'starting');
  assert.deepEqual(json<{ race: { seats: { kind: string }[] } }>(sent, OP.START)[0]!.race.seats.map((s) => s.kind), ['remote', 'remote', 'remote', 'remote', 'remote', 'remote']);

  // Six players and nobody drives: no kart ever finishes, so the host never ends the race. The hub does, after 15 minutes.
  sent.length = 0;
  assert.ok(m.ticks(119 + 15 * 60 * RATE));
  assert.equal(stateOf(m).phase, 'race');
  assert.equal(stateOf(m).ended, false);
  assert.ok(m.ticks(1));
  assert.equal(stateOf(m).ended, true);
  assert.equal(stateOf(m).endReason, 'race_timeout');
  const told = sent.filter((s) => s.opCode === OP.ERROR);
  assert.equal(told.length, 1);
  assert.equal(told[0]!.to.length, 6);
  assert.equal(JSON.parse(told[0]!.text!).error, 'race_timeout');
  assert.equal(m.loop([]), false);

  // A matched account that does not turn up loses its place after 15 s.
  const pair = on.matchmake(six.slice(0, 2).map((p) => ({ presence: p, properties: props })));
  const held = on.driver(pair!);
  const five = [0, 1, 2, 3, 4].map((i) => presence(`00000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`, `late${i}`, `88888888-8888-4888-8888-0000000000${String(i).padStart(2, '0')}`));
  // Four others fill the room up to its two kept places; a fifth is turned away until the hold runs out.
  for (const p of five.slice(0, 4)) assert.equal(held.join([p], session(p.userId))[0]!.accept, true);
  assert.equal(held.joinAttempt(five[4]!, session(five[4]!.userId)).rejectMessage, 'match_full');
  assert.equal(labelOf(held).open, false);
  held.ticks(15 * RATE + 2);
  assert.equal(labelOf(held).open, true);
  assert.equal(held.joinAttempt(five[4]!, session(five[4]!.userId)).accept, true);
}

// A lobby nobody is in closes after 30 s. A shutdown tells everyone and ends the match.
{
  const made = on.call<{ matchId: string; code: string }>('racer.room_create', session(B), {});
  const m = on.driver(made.matchId);
  assert.ok(on.call<Record<string, unknown>>('racer.metrics', server, { matchId: made.matchId }).courseId, 'the server picked a circuit');
  assert.ok(m.ticks(30 * RATE));
  assert.equal(m.ticks(3), false);
  assert.equal(stateOf(m).endReason, 'empty');
  assert.equal(on.nk.storage.has(`sproto_racer/code:${made.code}/00000000-0000-0000-0000-000000000000`), false);
  assert.equal(on.call<{ error?: string }>('racer.room_join', session(C), { code: made.code }).error, 'room_not_found');

  const again = on.call<{ matchId: string; code: string }>('racer.room_create', session(B), {});
  const t = on.driver(again.matchId);
  const sent = tap(t);
  const b = presence(B, 'bob', '22222222-2222-4222-8222-222222222222');
  assert.equal(t.join([b], session(B))[0]!.accept, true);
  t.loop([{ sender: b, opCode: OP.HELLO, data: hello() }]);
  sent.length = 0;
  t.terminate(30, 2);
  const told = sent.filter((s) => s.opCode === OP.ERROR);
  assert.equal(told.length, 1);
  assert.deepEqual(users(told[0]!), [B]);
  assert.equal(JSON.parse(told[0]!.text!).error, 'server_shutdown');
  assert.equal(on.nk.storage.has(`sproto_racer/code:${again.code}/00000000-0000-0000-0000-000000000000`), false);
}

// Room creation is limited per account, per node and during a deploy drain.
{
  const mod = load('on');
  const D = '00000000-0000-4000-8000-00000000000d';
  for (let i = 0; i < 5; i += 1) assert.equal(mod.call<{ error?: string }>('racer.room_create', session(D), {}).error, undefined);
  assert.equal(mod.call<{ error?: string }>('racer.room_create', session(D), {}).error, 'rate_limited');
  for (let i = 0; i < 7; i += 1) {
    const who = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
    assert.equal(mod.call<{ error?: string }>('racer.room_create', session(who), {}).error, undefined);
  }
  assert.equal(mod.call<{ error?: string }>('racer.room_create', session(A), {}).error, 'busy', 'twelve rooms is the node limit');
  const props = { game: GAME, version: PIN.netVersion, simVersion: PIN.simVersion, mode: 'race' };
  assert.equal(mod.matchmake([{ presence: presence(A), properties: props }, { presence: presence(B), properties: props }]), undefined);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, { matchmakerAdd: { stringProperties: props } }), /busy/, 'a ticket nobody could seat is refused when it is added');
  const slots = () => [...mod.nk.storage.keys()].filter((key) => key.startsWith('sproto_racer/slot:')).length;
  assert.equal(slots(), 12, 'each room holds one slot');
  // A room that closes gives its slot back.
  const first = [...mod.nk.matches.values()].find((row) => row.module === 'sproto_racer')!;
  assert.equal(mod.driver(first.matchId).ticks(30 * RATE + 3), false);
  assert.equal(slots(), 11);
  const E = '00000000-0000-4000-8000-00000000000e';
  const fresh = mod.call<{ matchId: string; error?: string }>('racer.room_create', session(E), {});
  assert.equal(fresh.error, undefined);
  assert.equal(mod.call<{ error?: string }>('racer.room_create', session(E), {}).error, 'busy');
  // A room that died without closing (a crash) still has its row. Once the row is ten seconds old
  // and its match is gone, the slot is taken over.
  const dead = mod.nk.matches.get(fresh.matchId)!;
  dead.ended = true;
  assert.equal(mod.call<{ error?: string }>('racer.room_create', session(E), {}).error, 'busy', 'not within ten seconds of the claim');
  mod.clock!.now += 11_000;
  assert.equal(mod.call<{ matchId?: string }>('racer.room_create', session(E), {}).matchId !== undefined, true);
  assert.equal(slots(), 12);
  assert.ok([...mod.nk.storage.entries()].every(([key, row]) => !key.startsWith('sproto_racer/slot:') || row.value.matchId !== dead.matchId));

  // The limit does not lean on the match listing, which shows a new room only after about a second.
  const lagged = load('on');
  lagged.nk.listLagMs = 60_000;
  for (let i = 0; i < 12; i += 1) {
    const who = `00000000-0000-4000-8000-0000000004${String(i).padStart(2, '0')}`;
    assert.equal(lagged.call<{ error?: string }>('racer.room_create', session(who), {}).error, undefined);
  }
  assert.equal(lagged.call<{ error?: string }>('racer.room_create', session(A), {}).error, 'busy');
  // Guessing codes: eight lookups in ten seconds, then none.
  for (let i = 0; i < 8; i += 1) assert.equal(mod.call<{ error?: string }>('racer.room_join', session(C), { code: 'ZZZZZZ' }).error, 'room_not_found');
  assert.equal(mod.call<{ error?: string }>('racer.room_join', session(C), { code: 'ZZZZZZ' }).error, 'rate_limited');

  const drained = load('on');
  const deadline = Math.floor(1_700_000_000_000 / 1000) + 600;
  assert.equal(drained.call<{ ok?: boolean }>('maint.begin', server, { reason: 'deploy', deadline }).ok, true);
  assert.equal(drained.call<{ error?: string }>('racer.room_create', session(A), {}).error, 'maintenance');
  assert.throws(() => drained.rtBefore('MatchmakerAdd', { ...session(A), sessionId: 's-a' }, { matchmakerAdd: { stringProperties: props } }), /maintenance/);
  assert.equal(drained.matchmake([{ presence: presence(A), properties: props }, { presence: presence(B), properties: props }]), undefined);
}

console.log('racer_match tests ok');
