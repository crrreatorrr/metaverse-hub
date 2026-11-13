// Guards for the #108 review of the free Shooter 1v1 (protocol 2). Each case
// runs on its own so one failure does not hide the others.
import assert from 'node:assert/strict';
import { loadModule, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const FP = 'dc00f234';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SYSTEM = '00000000-0000-0000-0000-000000000000';
const OP = { HELLO: 1, WELCOME: 2, REJECT: 3, READY: 4, PHASE: 5, INPUT: 6, SNAPSHOT: 7, RESULT: 8, RESYNC: 9, PING: 10, PONG: 11 };
const DAY = 24 * 60 * 60 * 1000;

interface Wire { reason?: string; outcome?: string; serverMs?: number; tick?: number; accountId?: string }
interface State {
  phase: string;
  tick: number;
  dropped: number;
  replay: { status: string; stored: boolean };
  result: { reason: string } | null;
}

interface Api { encodeInput(wish: { [key: string]: unknown }): Uint8Array }

function load(env: Record<string, string> = {}): LoadedModule {
  return loadModule({
    env: { HUB_FAULT_INJECT: '1', ...env },
    clock: 1_800_000_000_000,
    jsonState: true,
    sql: [[/FROM game\.server_flags/, (args: unknown[]) => (
      String(args[0] || '') === 'shooter_pvp'
        ? [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 100 }) }]
        : []
    )]],
  });
}

function game(userId: string, sessionId: string, sid = SID) {
  return { userId, sessionId, username: 'ada', vars: { scope: 'game', game: 'sproto-shooter', sid } };
}

function stateOf(m: MatchDriver): State {
  return m.state as State;
}

function api(mod: LoadedModule): Api {
  return (mod.global.__sprotoShooterPvp as () => Api)();
}

function packet(mod: LoadedModule, seq: number, frame: number): Uint8Array {
  return Uint8Array.from(api(mod).encodeInput({ seq, frame, yaw: 0, pitch: 0, moveX: 0, moveZ: 0, slot: 0 }));
}

function hello(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.HELLO, data: { accountId: p.userId, protocol: 2, sim: 2, content: FP } }]);
}

/** A private room hosted by A with B admitted (what shooter.room_join does). */
function room(mod: LoadedModule): { m: MatchDriver; a: Presence; b: Presence } {
  const m = mod.startMatch('sproto_shooter_free', { spawnSeed: '7', seedSource: 'server', private: '1', host: A });
  m.signal(`admit:${B}`);
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.accept, true);
  return { m, a, b };
}

function live(mod: LoadedModule): { m: MatchDriver; a: Presence; b: Presence } {
  const r = room(mod);
  hello(r.m, r.a);
  hello(r.m, r.b);
  r.m.loop([{ sender: r.a, opCode: OP.READY, data: { accountId: A } }]);
  r.m.loop([{ sender: r.b, opCode: OP.READY, data: { accountId: B } }]);
  assert.equal(stateOf(r.m).phase, 'live');
  return r;
}

function replayRows(mod: LoadedModule): string[] {
  return [...mod.nk.storage.keys()].filter((key) => key.startsWith('sproto_shooter_replay/'));
}

const failures: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

check('2 terminate is final: grace loops do not step, send or store a partial record', () => {
  const mod = load({ SHOOTER_PVP_REPLAY: '1' });
  const { m } = live(mod);
  m.ticks(5);
  m.dispatcher.clear();
  m.terminate(60, 30);
  const results = m.dispatcher.sent<Wire>(OP.RESULT);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.body.reason, 'server_shutdown');
  const after = m.dispatcher.broadcasts.filter((row) => row.opCode !== OP.RESULT);
  assert.equal(after.length, 0, `grace loops sent ${after.map((row) => row.opCode).join(',')}`);
  assert.equal(stateOf(m).phase, 'done');
  assert.equal(m.match.ended, true);
  assert.equal(replayRows(mod).length, 0, 'no record for a match terminated before its RESULT');
});

check('3 the clock follows wall time (catch-up under a slow loop), monotonic and step-capped', () => {
  const mod = load();
  const { m, a } = live(mod);
  const start = stateOf(m).tick;
  // Loops arrive every 100 ms instead of every 33 ms: the sim must keep up with real time.
  for (let i = 0; i < 30; i += 1) {
    mod.clock!.now += 100 - 1000 / 30;
    m.loop([]);
  }
  assert.ok(stateOf(m).tick - start >= 80, `sim advanced ${stateOf(m).tick - start} ticks in 3 s of wall time`);
  const ping = (t: number): number => {
    m.dispatcher.clear();
    m.loop([{ sender: a, opCode: OP.PING, data: { t } }]);
    return m.dispatcher.sent<Wire>(OP.PONG)[0]!.body.serverMs!;
  };
  const first = ping(1);
  mod.clock!.now -= 5000;
  const back = ping(2);
  assert.ok(back >= first, 'never goes backwards');
  mod.clock!.now += 60_000;
  const jump = ping(3);
  assert.ok(jump - back <= 250 + 1, `a wall-clock jump moves the match clock ${jump - back} ms`);
});

check('4 replay is off by default for free play, skipped without a sim, and swept after retention', () => {
  const off = load();
  const done = live(off);
  done.m.signal('advance:10400');
  done.m.ticks(3);
  assert.equal(stateOf(done.m).result?.reason, 'both_stall');
  assert.equal(stateOf(done.m).replay.status, 'off');
  assert.equal(replayRows(off).length, 0);

  const on = load({ SHOOTER_PVP_REPLAY: '1' });
  const lobby = room(on);
  hello(lobby.m, lobby.a);
  lobby.m.signal('advance:30000');
  lobby.m.ticks(3);
  assert.equal(stateOf(lobby.m).result?.reason, 'ready_timeout');
  assert.equal(stateOf(lobby.m).replay.status, 'skipped', 'a lobby cancel has no sim to replay');
  assert.equal(replayRows(on).length, 0);

  (on.nk.storageWrite as (rows: unknown[]) => unknown)([{
    collection: 'sproto_shooter_replay', key: 'old-match', userId: SYSTEM,
    value: { storedAt: on.clock!.now - 40 * DAY }, permissionRead: 0, permissionWrite: 0,
  }]);
  const played = live(on);
  played.m.signal('advance:10400');
  played.m.ticks(3);
  assert.equal(stateOf(played.m).replay.stored, true);
  const rows = replayRows(on);
  assert.equal(rows.some((key) => key.includes('old-match')), false, 'records past retention are swept');
  assert.equal(rows.length, 1);
});

check('5 private rooms admit only the host and code holders', () => {
  const mod = load();
  const created = mod.call<{ matchId: string; code: string; error?: string }>('shooter.room_create', game(A, 'sa'), {});
  assert.equal(created.error, undefined);
  const m = mod.driver(created.matchId);
  const label = JSON.parse(m.match.label) as { private?: boolean };
  assert.equal(label.private, true, 'the label says private');
  // C found the match id (ListMatches) but never used the code.
  assert.equal(m.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'not_admitted');
  assert.equal(m.joinAttempt(presence(A, 'ada', 'sa'), game(A, 'sa')).accept, true, 'the host is admitted');
  const joined = mod.call<{ matchId: string; error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code });
  assert.equal(joined.matchId, created.matchId);
  assert.equal(m.joinAttempt(presence(B, 'bea', 'sb'), game(B, 'sb')).accept, true, 'the code holder is admitted');
});

check('6 at most one REJECT per sender and reason per loop', () => {
  const mod = load();
  const { m, a } = live(mod);
  m.dispatcher.clear();
  const junk = [1, 2, 3, 4, 5].map(() => ({ sender: a, opCode: OP.INPUT, data: 'short' }));
  m.loop(junk);
  assert.equal(m.dispatcher.sent<Wire>(OP.REJECT).filter((row) => row.body.reason === 'malformed').length, 1);
  m.dispatcher.clear();
  const tick = stateOf(m).tick;
  m.loop([
    { sender: a, opCode: OP.INPUT, data: packet(mod, 9, tick + 1) },
    { sender: a, opCode: OP.INPUT, data: packet(mod, 3, tick + 1) },
    { sender: a, opCode: OP.INPUT, data: packet(mod, 4, tick + 1) },
    { sender: a, opCode: OP.INPUT, data: packet(mod, 5, tick + 1) },
  ]);
  assert.equal(m.dispatcher.sent<Wire>(OP.REJECT).filter((row) => row.body.reason === 'sequence').length, 1);
});

check('7 messages from a session that is not the current presence are dropped', () => {
  const mod = load();
  const { m, a } = live(mod);
  m.leave([a]);
  const again = presence(A, 'ada', 'sa2');
  assert.equal(m.join([again], game(A, 'sa2'))[0]?.accept, true);
  const dropped = stateOf(m).dropped;
  m.dispatcher.clear();
  m.loop([{ sender: a, opCode: OP.PING, data: { t: 1 } }]);
  m.loop([{ sender: presence(C, 'cy', 'sc'), opCode: OP.PING, data: { t: 1 } }]);
  assert.equal(m.dispatcher.broadcasts.filter((row) => row.opCode === OP.PONG || row.opCode === OP.REJECT).length, 0);
  assert.equal(stateOf(m).dropped - dropped, 2);
});

check('8 bytesOf fails closed on anything but an ArrayBuffer', () => {
  const mod = load();
  const proto = mod.global.ShooterProto as { bytesOf(nk: unknown, data: unknown): Uint8Array };
  assert.equal(proto.bytesOf(mod.nk, 'x'.repeat(18)).length, 0);
  assert.equal(proto.bytesOf(mod.nk, { length: 18 }).length, 0);
  assert.equal(proto.bytesOf(mod.nk, null).length, 0);
  assert.equal(proto.bytesOf(mod.nk, new ArrayBuffer(18)).length, 18);
});

check('9 done is sticky: an expired empty lobby does not reopen', () => {
  const mod = load();
  const m = mod.startMatch('sproto_shooter_free', { spawnSeed: '3', seedSource: 'server', private: '1', host: A });
  const a = presence(A, 'ada', 'sa');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  m.signal('advance:30000');
  m.ticks(3);
  assert.equal(stateOf(m).phase, 'done');
  m.dispatcher.clear();
  // A late HELLO during the linger must not seat anyone or reopen the lobby.
  hello(m, a);
  m.ticks(2);
  assert.equal(stateOf(m).phase, 'done');
  assert.equal(m.dispatcher.sent(OP.WELCOME).length, 0);
  assert.equal(m.joinAttempt(presence(B, 'bea', 'sb'), game(B, 'sb')).rejectMessage, 'ended');
  assert.equal(mod.call<{ error?: string }>('shooter.resume', game(A, 'sa'), {}).error, 'match_missing');
});

check('10 a director exception ends the match cleanly', () => {
  const mod = load();
  const { m } = live(mod);
  m.signal('fault:throw');
  m.dispatcher.clear();
  assert.equal(m.loop([]), false, 'the loop returns null');
  const results = m.dispatcher.sent<Wire>(OP.RESULT);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.body.reason, 'server_shutdown');
  assert.equal(mod.call<{ error?: string }>('shooter.resume', game(A, 'sa'), {}).error, 'match_missing');
});

check('14 shooter.metrics is for the match\'s own seats or the server', () => {
  const mod = load();
  const { m } = live(mod);
  const id = m.match.matchId;
  const stranger = mod.call<{ error?: string; phase?: string }>('shooter.metrics', game(C, 'sc'), { matchId: id });
  assert.ok(stranger.error, 'another game session cannot read the stats');
  const reset = mod.call<{ error?: string }>('shooter.metrics', game(C, 'sc'), { matchId: id, reset: true });
  assert.ok(reset.error, 'or reset them');
  assert.equal(mod.call<{ phase?: string }>('shooter.metrics', game(A, 'sa'), { matchId: id }).phase, 'live');
  assert.equal(mod.call<{ phase?: string }>('shooter.metrics', { userId: '', vars: null }, { matchId: id }).phase, 'live', 'server (http key) context');
});

check('15 a queued player cannot open or join a room, and room codes come from the CSPRNG', () => {
  const mod = load();
  const props = { game: 'sproto-shooter', mode: 'free', protocol: '2', sim: '2', content: FP };
  mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } });
  assert.equal(mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), {}).error, 'already_queued');
  const created = mod.call<{ code: string; error?: string }>('shooter.room_create', game(B, 'sb'), {});
  assert.equal(created.error, undefined);
  assert.equal(mod.call<{ error?: string }>('shooter.room_join', game(A, 'sa'), { code: created.code }).error, 'already_queued');

  const fixed = load();
  fixed.nk.uuidv4 = () => '00000000-0000-4000-8000-000000000001';
  assert.equal(fixed.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), {}).error, undefined);
  assert.equal(fixed.call<{ error?: string }>('shooter.room_create', game(C, 'sc'), {}).error, 'room_code_busy', 'codes derive from nk.uuidv4');
});

if (failures.length) {
  console.error(`${failures.length} shooter review guard(s) failed: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('shooter_review tests ok');
