// H3-S free authoritative Shooter 1v1 on director v2 (protocol 2 / sim 2).
// The Nakama load in scripts/load/shooter-bots.ts repeats the live socket path.
// Practice never reaches this match. Guests may take one seat. No Ticket delta.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkRegistrations, loadModule, presence, type Broadcast, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PIN = JSON.parse(readFileSync(join(root, 'server/modules/vendor/shooter-pvp-sim.pin.json'), 'utf8')) as { commit: string; sha256: string };
const FP = '17d87c54';
const LOADOUT = '4cdfab55';
const CAMPAIGN = 'cea1f88b';
const COMMIT = PIN.commit;
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OP = { HELLO: 1, WELCOME: 2, REJECT: 3, READY: 4, PHASE: 5, INPUT: 6, SNAPSHOT: 7, RESULT: 8, RESYNC: 9, PING: 10, PONG: 11 };
const HEX64 = /^[0-9a-f]{64}$/;

interface PvpApi {
  encodeInput(wish: { [key: string]: unknown }): Uint8Array;
  replayJSON(input: string | object): string;
  createDirector(options?: { seed?: number; matchId?: string }): {
    sim: { players: { yaw: number }[] } | null;
    handle(sender: { userId: string; sessionId: string }, op: number, data: string, now: number): { ok: boolean };
  };
  createHostedDirector(options: { [key: string]: unknown }): { combatSeedDerived: boolean };
  CONTENT_FINGERPRINT: string;
}

interface Wire {
  outcome?: string;
  winner?: number | null;
  reason?: string;
  tick?: number;
  stateHash?: string | null;
  stateSha256?: string | null;
  ticketsMinted?: number;
  stakes?: boolean;
  seed?: number;
  spawnSeed?: number;
  combatSeed?: string;
  combatCommit?: string;
  seat?: number;
  accountId?: string;
  loadoutHash?: string;
  content?: string;
  phase?: string;
  serverSeq?: number;
  protocol?: number;
  sim?: number;
  lastSeq?: number;
  hash?: string;
  names?: (string | null)[];
  t?: number;
  you?: { seat: number; private: Record<string, unknown> };
}

interface Replay { status: string; verified: boolean; policy: string; mismatch: string[]; stored: boolean }

interface LiveState {
  phase: string;
  spawnSeed: number;
  combatCommit: string;
  seated: number;
  tick: number;
  guest: Record<string, number>;
  generation: Record<string, number>;
  sids: Record<string, string>;
  result: { outcome: string; reason: string; winner: number | null; ticketsMinted: number; stakes: boolean } | null;
  serverSeq: number;
  resultSent: boolean;
  replay: Replay;
  rateDrops: number;
  dropped: number;
}

interface StoredReplay {
  record: { v: number; combatSeed: string; spawnSeed: number; used: string[]; accounts: (string | null)[]; result: Wire | null; bundleSha256: string; sourceCommit: string };
  receipt: { verified: boolean; verdict: { policy: string } | null; stateSha256: string | null };
}

function pvpFlag(args: unknown[], state: 'on' | 'off'): Record<string, unknown>[] {
  if (String(args[0] || '') !== 'shooter_pvp') return [];
  return [{ result: JSON.stringify({ state, allowlist: [], percent: state === 'on' ? 100 : 0 }) }];
}

/** Fake wall clock (one tick per loop), state copied through JSON between callbacks, replay on.
 *  Free play in these tests turns shooter_pvp on in the fake. The committed row stays off. */
function load(pvp: 'on' | 'off' = 'on') {
  return loadModule({
    env: { HUB_FAULT_INJECT: '1', SHOOTER_PVP_REPLAY: '1' },
    clock: 1_800_000_000_000,
    jsonState: true,
    sql: [[/FROM game\.server_flags/, (args: unknown[]) => pvpFlag(args, pvp)]],
  });
}

function game(userId: string, sessionId: string, sid = SID, scope = 'game', gameId = 'sproto-shooter') {
  return { userId, sessionId, username: 'ada', vars: { scope, game: gameId, sid } };
}

function apiOf(mod: LoadedModule): PvpApi {
  const global = mod.global as { __sprotoShooterPvp?: () => PvpApi | null; SprotoShooterPvp?: PvpApi };
  const loaded = global.__sprotoShooterPvp ? global.__sprotoShooterPvp() : global.SprotoShooterPvp;
  if (!loaded) throw new Error('pvp sim missing');
  return loaded;
}

/** Binary INPUT, copied out of the module realm so the harness passes it as raw bytes. */
function packet(api: PvpApi, wish: { [key: string]: unknown }): Uint8Array {
  return Uint8Array.from(api.encodeInput(wish));
}

function wish(seq: number, frame: number, extra: { [key: string]: unknown } = {}) {
  return { seq, frame, yaw: 0, pitch: 0, moveX: 0, moveZ: 0, fire: false, zoom: false, sprint: false, jump: false, dash: false, reload: false, slot: 0, ...extra };
}

function ledgerCount(mod: LoadedModule): number {
  return mod.nk.sqlCalls.filter((call) => /earn_tickets|tickets_ledger|wallet|leaderboard|ranked_score/i.test(call.sql)).length;
}

function hello(m: MatchDriver, p: Presence, extra: Record<string, unknown> = {}): void {
  m.loop([{ sender: p, opCode: OP.HELLO, data: { accountId: p.userId, protocol: 2, sim: 2, content: FP, ...extra } }]);
}

function ready(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.READY, data: { accountId: p.userId } }]);
}

function open(spawnSeed = '7', names: [string, string] = ['ada', 'bea']): { mod: LoadedModule; m: MatchDriver; a: Presence; b: Presence; ledger: number } {
  const mod = load();
  const ledger = ledgerCount(mod);
  const m = mod.startMatch('sproto_shooter_free', { spawnSeed, seedSource: 'server', private: '1', host: A });
  m.signal(`admit:${B}`);
  const a = presence(A, names[0], 'sa');
  const b = presence(B, names[1], 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.accept, true);
  return { mod, m, a, b, ledger };
}

function live(): { mod: LoadedModule; m: MatchDriver; a: Presence; b: Presence; ledger: number } {
  const seated = open();
  hello(seated.m, seated.a);
  hello(seated.m, seated.b);
  ready(seated.m, seated.a);
  ready(seated.m, seated.b);
  return seated;
}

function stateOf(m: MatchDriver): LiveState {
  return m.state as LiveState;
}

function roundTrip(m: MatchDriver): void {
  m.match.state = JSON.parse(JSON.stringify(m.state));
}

function last<T>(rows: { body: T }[]): T {
  assert.ok(rows.length, 'expected a broadcast');
  return rows[rows.length - 1]!.body;
}

/** Match-wide RESULTs: sent to every present seat, not a rejoin copy. */
function matchResults(m: MatchDriver): { body: Wire; to: Presence[] | null }[] {
  return m.dispatcher.sent<Wire>(OP.RESULT).filter((row) => (row.to?.length ?? 0) > 1 || row.body.reason === 'server_shutdown');
}

function only(row: { to: Presence[] | null }, p: Presence): void {
  assert.ok(row.to, 'a routed message has a list');
  assert.equal(row.to!.length, 1, JSON.stringify(row.to));
  assert.equal(row.to![0]!.userId, p.userId);
  assert.equal(row.to![0]!.sessionId, p.sessionId);
}

function noEmptyLists(broadcasts: Broadcast[]): void {
  for (const b of broadcasts) assert.ok(b.presences && b.presences.length > 0, `op ${b.opCode} went out with ${JSON.stringify(b.presences)}`);
}

let timedRecord: StoredReplay['record'] | null = null;

/**
 * A whole hosted-director session (HELLO, READY, PING, firing INPUT with view claims, advance
 * on a 30 Hz clock until RESULT, then replayJSON of its record), as one script both Node and
 * goja run against the vendored bundle.
 */
const HOSTED_SESSION = `(function () {
  var api = SprotoShooterPvp;
  var d = api.createHostedDirector({ spawnSeed: 7, combatSeed: '5eed00c0ffee5eed00c0ffee5eed0042', matchId: 'goja-e2e', accounts: ['ada', 'bea'] });
  if (d.combatSeedDerived !== false) throw new Error('derived seed');
  var now = 1000;
  var out = { msgs: 0, snaps: 0, hashes: [], pongs: 0 };
  function count(r) {
    for (var i = 0; i < r.messages.length; i++) {
      var m = r.messages[i];
      out.msgs += 1;
      if (m.op === 7) { out.snaps += 1; if (m.body.hash) out.hashes.push(m.body.hash); }
      if (m.op === 11) out.pongs += 1;
    }
  }
  function hello(id) { return JSON.stringify({ accountId: id, protocol: 2, sim: 2, content: api.CONTENT_FINGERPRINT, interpMs: 100 }); }
  var sessions = { ada: 'sa', bea: 'sb' };
  count(d.handle({ userId: 'ada', sessionId: 'sa', username: 'Ada' }, 1, hello('ada'), now));
  count(d.handle({ userId: 'bea', sessionId: 'sb', username: 'Bea' }, 1, hello('bea'), now));
  count(d.handle({ userId: 'ada', sessionId: 'sa' }, 4, '{"accountId":"ada"}', now));
  count(d.handle({ userId: 'bea', sessionId: 'sb' }, 4, '{"accountId":"bea"}', now));
  var yaws = [d.sim.players[0].yaw, d.sim.players[1].yaw];
  var ids = ['ada', 'bea'];
  for (var i = 0; i < 600 && !d.result; i++) {
    now += 1000 / 30;
    var frame = d.sim.tick;
    for (var k = 0; k < 2; k++) {
      var bytes = api.encodeInput({ seq: i + 1, frame: frame, yaw: yaws[k], pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, slot: 0, viewTick: Math.max(0, frame - 3) });
      count(d.handle({ userId: ids[k], sessionId: sessions[ids[k]] }, 6, bytes, now));
    }
    if (i % 15 === 0) count(d.handle({ userId: 'ada', sessionId: 'sa' }, 10, JSON.stringify({ t: i }), now));
    count(d.advance(now));
  }
  var receipt = JSON.parse(api.replayJSON(d.replayRecord()));
  var r = d.result;
  return JSON.stringify({
    result: r ? { outcome: r.outcome, reason: r.reason, winner: r.winner, tick: r.tick, stateHash: r.stateHash, stateSha256: r.stateSha256 } : null,
    msgs: out.msgs, snaps: out.snaps, hashes: out.hashes, pongs: out.pongs,
    verified: receipt.verified, policy: receipt.verdict ? receipt.verdict.policy : null,
  });
})()`;

// Registration, pin, guest/practice policy, and no economy surface.
{
  const mod = load();
  const ledger = ledgerCount(mod);
  const { issues } = checkRegistrations(mod.source);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.ok(mod.registered.matches.has('sproto_shooter_free'));
  assert.equal(mod.registered.matches.has('sproto_arena'), true);
  for (const id of ['shooter.version', 'shooter.room_create', 'shooter.room_join', 'shooter.queue_cancel', 'shooter.resume', 'shooter.metrics']) {
    assert.ok(mod.registered.rpcs.has(id), id);
  }
  const version = mod.call<Wire & { match: string; guests: string; practice: string; stake: number; budgetMs: number; campaignFingerprint: string; bundleSha256: string; commit: string; error?: string }>(
    'shooter.version',
    game(A, 'sa'),
    {},
  );
  assert.equal(version.error, undefined, JSON.stringify(version));
  assert.equal(version.protocol, 2);
  assert.equal(version.sim, 2);
  assert.equal(version.content, FP);
  assert.equal(version.loadoutHash, LOADOUT);
  assert.equal(version.campaignFingerprint, CAMPAIGN);
  assert.equal(version.commit, COMMIT);
  assert.equal(version.bundleSha256, PIN.sha256);
  assert.equal(version.match, 'sproto_shooter_free');
  assert.equal(version.stake, 0);
  assert.equal(version.ticketsMinted, 0);
  assert.equal(version.stakes, false);
  assert.equal(version.guests, 'one_seat');
  assert.equal(version.practice, 'offline');
  assert.equal(version.budgetMs, 10);
  assert.equal((mod.call<{ error?: string }>('shooter.version', { userId: A, vars: { scope: 'hub' } }, {})).error, 'wrong_scope');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { mode: 'practice' })).error, 'practice_offline');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { winner: 0 })).error, 'rejected');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { seed: 7 })).error, 'rejected');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { stake: 10 })).error, 'rejected');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { v: 1 })).error, 'version_mismatch');
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { mode: 'wager' })).error, 'stakes_disabled');
  const created = mod.call<{ matchId: string; code: string; stake: number; ticketsMinted: number; error?: string }>('shooter.room_create', game(A, 'sa'), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  assert.equal(created.stake, 0);
  assert.equal(created.ticketsMinted, 0);
  assert.equal(created.code.length, 12);
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), {})).error, 'already_in_match');
  const joined = mod.call<{ matchId: string; stake: number; error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code.toLowerCase(), v: 2, sim: 2, content: FP });
  assert.equal(joined.matchId, created.matchId);
  assert.equal(joined.stake, 0);
  assert.equal((mod.call<{ error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code, v: 1 })).error, 'version_mismatch');
  assert.equal((mod.call<{ error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code, content: 'f5949631' })).error, 'version_mismatch');
  assert.equal((mod.call<{ error?: string }>('shooter.room_join', game(C, 'sc'), { code: 'not-a-code' })).error, 'room_not_found');
  assert.equal((mod.call<{ matchId: string }>('shooter.resume', game(A, 'sa'), {})).matchId, created.matchId);
  const listed = (mod.global.HubGames as { list(): string[] }).list();
  assert.equal(listed.filter((id) => id === 'sproto-shooter').length, 1);
  const HubGames = mod.global.HubGames as { matchmakingAllowed(scope: string, game: string, target: string): boolean };
  assert.equal(HubGames.matchmakingAllowed('game', 'sproto-shooter', 'sproto-shooter'), true);
  assert.equal(HubGames.matchmakingAllowed('hub', '', 'sproto-shooter'), false);
  const campaign = JSON.parse(readFileSync(join(root, 'server/modules/vendor/shooter-sim.pin.json'), 'utf8')) as { fingerprint: string; sha256: string };
  assert.equal(campaign.fingerprint, CAMPAIGN);
  assert.equal(campaign.sha256, '3abc106f49e93c013bc8a0729d3d79ffe6e9c292d93cfe33923d87b747d40c5b');
  const source = ['shooter_match.ts', 'shooter_matchmaking.ts', 'shooter_protocol.ts'].map((name) => readFileSync(join(root, 'server/modules/src/games', name), 'utf8')).join('\n');
  assert.equal(/nk\.sql|earn_tickets|walletUpdate|leaderboardRecord|sproto_arena|sproto_duel|claimWinner|claim_winner/.test(source), false);
  // Hosts must use the hosted constructor, and nothing synthesizes a HELLO from a RESYNC.
  assert.equal(/createDirector\(/.test(source), false);
  assert.equal(/\.(exportState|importState)\(|restoreDirector\(/.test(source), false, 'the director stays live; no freeze/thaw per callback');
  assert.equal(ledgerCount(mod), ledger);
  const label = JSON.parse(mod.nk.matches.get(created.matchId)!.label) as { kind: string; stake: number; mode: string; protocol: number; sim: number; content: string };
  assert.equal(label.kind, 'sproto_shooter_free');
  assert.equal(label.mode, 'free');
  assert.equal(label.stake, 0);
  assert.equal(label.protocol, 2);
  assert.equal(label.sim, 2);
  assert.equal(label.content, FP);
  assert.equal(/seed/i.test(mod.nk.matches.get(created.matchId)!.label), false);
  const api = apiOf(mod);
  assert.throws(() => api.createHostedDirector({ spawnSeed: 7, matchId: 'm' }), /combatSeed/);
}

// WELCOME names use HubMatch.cleanName (the #92 rule), with "player" when nothing is left.
{
  const mod = load();
  const displayName = (mod.global.ShooterMatch as { displayName(raw: unknown): string }).displayName;
  assert.equal(displayName('ada\u202e<b>'), 'adab');
  assert.equal(displayName('<>'), 'player');
  assert.equal(displayName(undefined), 'player');
  assert.equal(displayName('x'.repeat(40)).length, 24);
}

// One guest seat, one signed-in seat, server seeds, cleaned names, hostile and oversized traffic.
{
  const mod = load();
  const ledger = ledgerCount(mod);
  mod.nk.accounts.set(B, { email: 'bea@example.com', user: { userId: B, username: 'bea' } });
  const m = mod.startMatch('sproto_shooter_free', { spawnSeed: '7', seedSource: 'server', private: '1', host: A });
  m.signal(`admit:${B}`);
  const guest = presence(A, 'guest<img src=x onerror=alert(1)>', 'sa');
  const named = presence(B, 'bea', 'sb');
  assert.equal(m.join([guest], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([named], game(B, 'sb'))[0]?.accept, true);
  assert.equal(m.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'not_admitted');
  m.signal(`admit:${C}`);
  assert.equal(m.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'match_full');
  assert.equal(m.joinAttempt(presence(A, 'guest', 'sa-other'), game(A, 'sa-other', SID2)).rejectMessage, 'wrong_sender');
  hello(m, guest, { seed: 99, winner: 0 });
  const hostile = m.dispatcher.sent<Wire>(OP.REJECT).at(-1)!;
  assert.equal(hostile.body.reason, 'client_result');
  only(hostile, guest);
  m.dispatcher.clear();
  hello(m, guest, { seed: 99 });
  const welcomeRow = m.dispatcher.sent<Wire>(OP.WELCOME).at(-1)!;
  only(welcomeRow, guest);
  const welcome = welcomeRow.body;
  assert.equal(welcome.accountId, A);
  assert.equal(welcome.seat, 0);
  assert.equal(welcome.spawnSeed, 7);
  assert.equal(welcome.seed, undefined);
  assert.equal(welcome.combatSeed, undefined, 'the combat seed is never in WELCOME');
  assert.match(welcome.combatCommit || '', HEX64);
  assert.equal(welcome.combatCommit, stateOf(m).combatCommit);
  assert.equal(welcome.loadoutHash, LOADOUT);
  assert.equal(welcome.content, FP);
  assert.equal(welcome.protocol, 2);
  assert.equal(welcome.ticketsMinted, 0);
  assert.equal(welcome.stakes, false);
  assert.match(welcome.names?.[0] ?? '', /^guestimg[0-9A-Za-z _.-]*$/, 'the name is cleaned before the director');
  assert.equal(stateOf(m).guest[A], 1);
  assert.equal(stateOf(m).guest[B], 0);
  assert.equal(stateOf(m).generation[A], 1);
  assert.equal(stateOf(m).seated, 1);
  hello(m, guest);
  assert.equal(stateOf(m).seated, 1, 'a guest is not given the other seat');
  const huge = { accountId: B, protocol: 2, sim: 2, content: FP, pad: 'x'.repeat(3000) };
  m.loop([{ sender: named, opCode: OP.HELLO, data: huge }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'malformed');
  m.loop([{ sender: named, opCode: OP.HELLO, data: { accountId: B, protocol: 1, sim: 1, content: 'f5949631' } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'version');
  m.dispatcher.clear();
  hello(m, named);
  // A new seat is announced to both seats, each with its own WELCOME.
  const welcomes = m.dispatcher.sent<Wire>(OP.WELCOME);
  assert.equal(welcomes.length, 2);
  for (const row of welcomes) only(row, row.body.accountId === A ? guest : named);
  assert.equal(welcomes.find((row) => row.body.accountId === B)!.body.seat, 1);
  m.loop([{ sender: named, opCode: OP.READY, data: { accountId: named.userId, earnTickets: 20 } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'client_result');
  m.loop([{ sender: named, opCode: OP.RESULT, data: { winner: 1, outcome: 'ko' } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'client_result');
  assert.equal(stateOf(m).result, null);
  m.loop([{ sender: named, opCode: OP.SNAPSHOT, data: { winner: 1, hp: 1 } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'malformed');
  assert.equal(stateOf(m).phase, 'lobby');
  noEmptyLists(m.dispatcher.broadcasts);
  assert.equal(ledgerCount(mod), ledger);
}

// Routing: private snapshots to their owner only, REJECT/PONG to the sender,
// per-sender caps, HELLO-only rebind, RESULT once, the combat seed stays secret,
// rejoin after done, and the replay record.
{
  const seated = live();
  const { mod, m, a, b } = seated;
  const matchId = m.match.matchId;
  assert.equal(stateOf(m).phase, 'live');
  assert.equal(stateOf(m).spawnSeed, 7);
  m.ticks(12);
  const snaps = m.dispatcher.sent<Wire>(OP.SNAPSHOT);
  assert.ok(snaps.length >= 4, `snapshots ${snaps.length}`);
  for (const row of snaps) {
    assert.ok(row.to && row.to.length === 1, 'a snapshot carries one seat\'s private state');
    const owner = row.to![0]!;
    assert.equal(row.body.you?.seat, owner.userId === A ? 0 : 1, 'private state only to its owner');
    assert.ok(row.body.you?.private, 'private block present');
    assert.equal(row.body.ticketsMinted, 0);
    assert.equal(row.body.stakes, false);
  }
  assert.ok(snaps.some((row) => row.to![0]!.userId === A) && snaps.some((row) => row.to![0]!.userId === B));
  assert.ok(snaps.some((row) => typeof row.body.hash === 'string'), '1 Hz public hash');
  assert.ok(snaps.every((row) => typeof row.body.serverSeq === 'number'));
  const phaseRow = m.dispatcher.sent<Wire>(OP.PHASE).find((row) => row.body.phase === 'live')!;
  assert.equal(phaseRow.to?.length, 2, 'PHASE goes to the whole match');
  assert.equal(phaseRow.body.combatSeed, undefined);
  const commit = phaseRow.body.combatCommit!;
  assert.match(commit, HEX64);
  const api = apiOf(mod);
  const cursor = () => stateOf(m).tick;

  m.dispatcher.clear();
  m.loop([{ sender: b, opCode: OP.PING, data: { t: 1234.5 } }]);
  const pong = m.dispatcher.sent<Wire>(OP.PONG);
  assert.equal(pong.length, 1);
  only(pong[0]!, b);
  assert.equal(pong[0]!.body.t, 1234.5);

  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(3, cursor())) }]);
  m.dispatcher.clear();
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(2, cursor())) }]);
  const seqReject = m.dispatcher.sent<Wire>(OP.REJECT).at(-1)!;
  assert.equal(seqReject.body.reason, 'sequence');
  only(seqReject, a);
  m.loop([{ sender: a, opCode: OP.INPUT, data: 'short' }]);
  const shortReject = m.dispatcher.sent<Wire>(OP.REJECT).at(-1)!;
  assert.equal(shortReject.body.reason, 'malformed');
  only(shortReject, a);
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(4, cursor() + 20)) }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'frame');
  // Gaps are allowed in protocol 2.
  m.dispatcher.clear();
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(10, cursor() + 1)) }]);
  assert.equal(m.dispatcher.sent<Wire>(OP.REJECT).length, 0);

  // Per-sender cap: a flood from one seat does not eat the other seat's budget.
  roundTrip(m);
  m.dispatcher.clear();
  const drops = stateOf(m).rateDrops;
  const flood = [];
  for (let i = 0; i < 60; i += 1) flood.push({ sender: a, opCode: OP.PING, data: { t: i } });
  flood.push({ sender: b, opCode: OP.PING, data: { t: 99 } });
  m.loop(flood);
  assert.equal(stateOf(m).rateDrops - drops, 60 - 56);
  // The director's PING rate and the hub's per-sender cap both say "rate": one REJECT per loop.
  assert.equal(m.dispatcher.sent<Wire>(OP.REJECT).filter((row) => row.body.reason === 'rate').length, 1);
  for (const row of m.dispatcher.sent<Wire>(OP.REJECT)) only(row, a);
  const bPong = m.dispatcher.sent<Wire>(OP.PONG).filter((row) => row.to![0]!.userId === B);
  assert.equal(bPong.length, 1, 'the other seat is still answered');
  assert.equal(bPong[0]!.body.t, 99);
  assert.equal(stateOf(m).phase, 'live');

  // Reconnect on a new socket: only HELLO rebinds. RESYNC from the new session is wrong_sender.
  m.leave([a]);
  const again = presence(A, 'ada', 'sa2');
  assert.equal(m.join([again], game(A, 'sa2'))[0]?.accept, true);
  assert.equal(stateOf(m).generation[A], 1);
  assert.equal(stateOf(m).sids[A], SID);
  m.dispatcher.clear();
  m.loop([{ sender: again, opCode: OP.RESYNC, data: { accountId: A } }]);
  const resync = m.dispatcher.sent<Wire>(OP.REJECT).at(-1)!;
  assert.equal(resync.body.reason, 'wrong_sender');
  only(resync, again);
  assert.equal(m.dispatcher.sent<Wire>(OP.WELCOME).length, 0, 'RESYNC is not turned into HELLO');
  m.loop([{ sender: again, opCode: OP.INPUT, data: packet(api, wish(11, cursor() + 1)) }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'wrong_sender');
  m.dispatcher.clear();
  hello(m, again);
  const rebound = m.dispatcher.sent<Wire>(OP.WELCOME);
  assert.equal(rebound.length, 1, 'a rebind answers only the rebinding seat');
  only(rebound[0]!, again);
  for (const row of m.dispatcher.sent<Wire>(OP.SNAPSHOT).filter((r) => r.to![0]!.userId === A)) only(row, again);
  // The replaced socket is not the seat's presence any more: its traffic is dropped unanswered.
  const droppedBefore = stateOf(m).dropped;
  m.dispatcher.clear();
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(12, cursor() + 1)) }]);
  assert.equal(m.dispatcher.broadcasts.filter((row) => row.opCode === OP.REJECT).length, 0);
  assert.equal(stateOf(m).dropped, droppedBefore + 1);
  m.loop([{ sender: again, opCode: OP.INPUT, data: packet(api, wish(12, cursor() + 1)) }]);
  assert.equal(stateOf(m).phase, 'live');
  assert.equal(stateOf(m).result, null);

  // Seat 1 stalls: forfeit, winner seat 0. RESULT goes out once, to the whole match.
  m.dispatcher.clear();
  m.signal('advance:10000');
  m.loop([{ sender: again, opCode: OP.INPUT, data: packet(api, wish(13, cursor() + 1)) }]);
  const results = matchResults(m);
  assert.equal(results.length, 1);
  const forfeited = results[0]!.body;
  assert.equal(results[0]!.to?.length, 2);
  assert.equal(forfeited.outcome, 'forfeit');
  assert.equal(forfeited.reason, 'stall');
  assert.equal(forfeited.winner, 0);
  assert.equal(forfeited.ticketsMinted, 0);
  assert.equal(forfeited.stakes, false);
  const seed = forfeited.combatSeed!;
  assert.match(seed, /^[0-9a-f]{64}$/, '256-bit combat seed from the CSPRNG');
  assert.equal(createHash('sha256').update(seed).digest('hex'), commit, 'RESULT reveals the committed seed');
  assert.equal(stateOf(m).replay.status, 'pending', 'the replay never runs on the RESULT loop');
  m.ticks(3);
  assert.equal(matchResults(m).length, 1, 'RESULT once');

  // The combat seed is in no label, metric, signal, log line, match state, or message before RESULT.
  const before = m.dispatcher.broadcasts.length;
  const metrics = m.signal('metrics') || '';
  assert.equal(metrics.includes(seed), false);
  assert.equal(m.match.label.includes(seed), false);
  assert.equal(m.dispatcher.labels.some((label) => label.includes(seed)), false);
  assert.equal(mod.logger.lines.some((line) => line.message.includes(seed)), false);
  assert.equal(JSON.stringify(m.state).includes(seed), false, 'never in Nakama match state');
  assert.equal(before > 0, true);

  // Deferred replay: verified, write-once, server-only.
  const replay = stateOf(m).replay;
  assert.equal(replay.status, 'done');
  assert.equal(replay.verified, true, JSON.stringify(replay));
  assert.ok(['review', 'settle_director'].includes(replay.policy), replay.policy);
  assert.equal(replay.stored, true);
  const key = `sproto_shooter_replay/${matchId}/00000000-0000-0000-0000-000000000000`;
  const row = mod.nk.storage.get(key)!;
  assert.ok(row, 'replay record stored');
  assert.equal(row.permissionRead, 0);
  assert.equal(row.permissionWrite, 0);
  const stored = row.value as unknown as StoredReplay;
  assert.equal(stored.record.combatSeed, seed);
  assert.equal(stored.record.v, 2);
  assert.equal(stored.record.bundleSha256, PIN.sha256);
  assert.equal(stored.record.sourceCommit, COMMIT);
  assert.deepEqual([...stored.record.accounts], [A, B]);
  assert.equal(stored.receipt.verified, true);
  const version = row.version;
  const summary = JSON.parse(metrics) as { replay: Replay; combatCommit: string };
  assert.equal(summary.replay.status, 'done');
  assert.equal(summary.replay.verified, true);
  assert.equal(summary.combatCommit, commit);

  // Rejoin after done: WELCOME, the final snapshot and a RESULT copy to that session only.
  m.leave([again]);
  const back = presence(A, 'ada', 'sa3');
  assert.equal(m.join([back], game(A, 'sa3'))[0]?.accept, true);
  assert.equal(m.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'ended');
  assert.equal(m.joinAttempt(presence(A, 'ada', 'sa4'), game(A, 'sa4', SID2)).rejectMessage, 'wrong_sender');
  m.dispatcher.clear();
  hello(m, back);
  const copy = m.dispatcher.sent<Wire>(OP.RESULT);
  assert.equal(copy.length, 1);
  only(copy[0]!, back);
  assert.equal(copy[0]!.body.reason, 'stall');
  only(m.dispatcher.sent<Wire>(OP.WELCOME).at(-1)!, back);
  only(m.dispatcher.sent<Wire>(OP.SNAPSHOT).at(-1)!, back);
  assert.equal(m.dispatcher.sent<Wire>(OP.WELCOME).length, 1);
  // Both accounts may queue again while the finished match lingers.
  assert.equal((mod.call<{ error?: string }>('shooter.resume', game(A, 'sa3'), {})).error, 'match_missing');
  m.terminate();
  assert.equal(matchResults(m).length, 0, 'no shutdown RESULT after the director\'s');
  assert.equal(mod.nk.storage.get(key)!.version, version, 'write-once');
  noEmptyLists(m.dispatcher.broadcasts);
  assert.equal(ledgerCount(mod), seated.ledger);
}

// Draw when both stall, time ends a played match, ready timeout, shutdown keeps a result.
{
  const both = live();
  // 10 s past the 300 ms lead-in.
  both.m.signal('advance:10400');
  both.m.loop([]);
  const draw = last<Wire>(both.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(draw.outcome, 'draw');
  assert.equal(draw.reason, 'both_stall');
  assert.equal(draw.winner, null);
  assert.equal(draw.ticketsMinted, 0);
  both.m.terminate();
  assert.equal(stateOf(both.m).result?.reason, 'both_stall');
  assert.equal(matchResults(both.m).length, 1);
  assert.equal(ledgerCount(both.mod), both.ledger);

  // A full 90 s match on the tick clock (now = start + tick x 1000/30), both seats sending.
  const clock = live();
  const api = apiOf(clock.mod);
  let seq = 0;
  for (let i = 0; i < 2760 && stateOf(clock.m).phase !== 'done'; i += 1) {
    const frame = stateOf(clock.m).tick;
    seq += 1;
    clock.m.loop([
      { sender: clock.a, opCode: OP.INPUT, data: packet(api, wish(seq, frame, { moveX: 0.5 })) },
      { sender: clock.b, opCode: OP.INPUT, data: packet(api, wish(seq, frame, { moveX: -0.5 })) },
    ]);
  }
  const timed = last<Wire>(clock.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(timed.outcome, 'draw');
  assert.equal(timed.reason, 'time');
  assert.equal(timed.winner, null);
  assert.equal(timed.tick, 2700);
  assert.equal(timed.ticketsMinted, 0);
  assert.equal(matchResults(clock.m).length, 1);
  clock.m.loop([]);
  const replay = stateOf(clock.m).replay;
  assert.equal(replay.verified, true, JSON.stringify(replay));
  assert.equal(replay.policy, 'settle', 'a sim-ended match is provable from the log');
  const stored = clock.mod.nk.storage.get(`sproto_shooter_replay/${clock.m.match.matchId}/00000000-0000-0000-0000-000000000000`)!.value as unknown as StoredReplay;
  assert.equal(stored.record.used.length, 90);
  timedRecord = stored.record;
  const metrics = JSON.parse(clock.m.signal('metrics') || '{}') as { seats: { late: number; neutral: number }[]; p95: number };
  assert.equal(metrics.seats.length, 2);

  const waiting = open();
  hello(waiting.m, waiting.a);
  waiting.m.signal('advance:30000');
  waiting.m.loop([]);
  const cancel = last<Wire>(waiting.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(cancel.outcome, 'cancel');
  assert.equal(cancel.reason, 'ready_timeout');
  assert.equal(cancel.winner, null);
  assert.equal(cancel.ticketsMinted, 0);

  const empty = load().startMatch('sproto_shooter_free', { spawnSeed: '3', seedSource: 'server', private: '1', host: A });
  empty.signal('advance:30000');
  empty.loop([]);
  assert.equal(stateOf(empty).result?.reason, 'ready_timeout');
  assert.equal(stateOf(empty).result?.ticketsMinted, 0);
  assert.equal(empty.dispatcher.sent(OP.RESULT).length, 0, 'the hub sends no RESULT of its own');
  assert.equal(empty.ticks(11 * 30), false, 'the empty match closes after the linger');

  const down = open();
  down.m.terminate();
  const shutdowns = down.m.dispatcher.sent<Wire>(OP.RESULT);
  assert.equal(shutdowns.length, 1);
  const shutdown = shutdowns[0]!.body;
  assert.equal(shutdown.outcome, 'cancel');
  assert.equal(shutdown.reason, 'server_shutdown');
  assert.equal(shutdown.winner, null);
  assert.equal(shutdown.ticketsMinted, 0);
  assert.equal(ledgerCount(down.mod), down.ledger);
}

// Both sockets dropping is a draw. Metrics stay inside the handler budget. Queue is scoped.
{
  const dropped = live();
  dropped.m.leave([dropped.a, dropped.b]);
  dropped.m.signal('advance:10400');
  dropped.m.loop([]);
  assert.equal(stateOf(dropped.m).result?.outcome, 'draw');
  assert.equal(stateOf(dropped.m).result?.reason, 'both_stall');
  assert.equal(stateOf(dropped.m).result?.winner, null);
  assert.equal(stateOf(dropped.m).result?.ticketsMinted, 0);
  assert.equal(dropped.m.dispatcher.broadcasts.filter((row) => row.opCode === OP.RESULT && row.presences !== null && row.presences.length === 0).length, 0);
  noEmptyLists(dropped.m.dispatcher.broadcasts);
  assert.equal(ledgerCount(dropped.mod), dropped.ledger);
  const paced = live();
  paced.m.signal('reset-metrics');
  for (let i = 0; i < 40; i += 1) paced.m.loop([]);
  const metrics = JSON.parse(paced.m.signal('metrics') || '{}') as { p95: number; n: number; stake: number; ticketsMinted: number; budgetMs: number };
  assert.equal(metrics.stake, 0);
  assert.equal(metrics.ticketsMinted, 0);
  assert.equal(metrics.budgetMs, 10);
  assert.ok(metrics.n >= 40, `n ${metrics.n}`);
  assert.ok(metrics.p95 < 25, `p95 ${metrics.p95}`);
  assert.equal(ledgerCount(paced.mod), paced.ledger);

  const mod = load();
  const ledger = ledgerCount(mod);
  const props = { game: 'sproto-shooter', mode: 'free', protocol: '2', sim: '2', content: FP };
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } });
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } }), /already_queued/);
  mod.rtBefore('MatchmakerRemove', game(A, 'sa'), { matchmakerRemove: { ticket: 't1' } });
  assert.equal((mod.call<{ queued: boolean }>('shooter.queue_cancel', game(A, 'sa'), {})).queued, false);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, mode: 'practice' } } }), /practice_offline/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, stake: '10' } } }), /stakes_disabled/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, content: 'deadbeef' } } }), /version_mismatch/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, protocol: '1', sim: '1', content: 'f5949631' } } }), /version_mismatch/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', { userId: A, sessionId: 'sa', vars: { scope: 'hub' } }, { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } }), /wrong_scope/);
  const id = mod.matchmake([
    { presence: a, properties: props },
    { presence: b, properties: props },
  ]);
  assert.ok(id);
  assert.equal(mod.nk.matches.get(id!)?.module, 'sproto_shooter_free');
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: b, properties: props }]), id);
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: presence(A, 'ada', 'other'), properties: props }]), undefined);

  const dark = load('off');
  assert.throws(() => dark.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } }), /pvp_off/);
  assert.equal((dark.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), {})).error, 'pvp_off');
  assert.equal((dark.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { v: 1 })).error, 'version_mismatch');
  assert.equal((dark.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { mode: 'wager' })).error, 'stakes_disabled');
  assert.equal(dark.matchmake([{ presence: a, properties: props }, { presence: b, properties: props }]), undefined);
  const kept = dark.startMatch('sproto_shooter_free', { spawnSeed: '7', seedSource: 'server', private: '1', host: A });
  kept.signal(`admit:${B}`);
  assert.equal(kept.join([a], game(A, 'sa'))[0]?.accept, true);
  hello(kept, a);
  ready(kept, a);
  assert.equal(kept.loop([]), true, 'a match already open keeps running while the flag is off');
  const queued = mod.driver(id!);
  assert.equal((JSON.parse(queued.match.label) as { private: boolean }).private, false);
  assert.equal(queued.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'not_in_roster');
  assert.ok((queued.state as LiveState).spawnSeed > 0);
  assert.equal(/combatSeed/.test(JSON.stringify(queued.state)), false);
  // A matchmade pair pins seat order: B says HELLO first and still gets seat 1.
  assert.equal(queued.join([b], game(B, 'sb'))[0]?.accept, true);
  assert.equal(queued.join([a], game(A, 'sa'))[0]?.accept, true);
  hello(queued, b);
  assert.equal(last<Wire>(queued.dispatcher.sent<Wire>(OP.WELCOME)).seat, 1);
  assert.equal(ledgerCount(mod), ledger);
}

// Vendored golden: seed 7, double KO at tick 65, same hash in goja when Go is present;
// the 90 s replay record verifies in goja too.
{
  const mod = load();
  const api = apiOf(mod);
  const director = api.createDirector({ seed: 7, matchId: 'golden' });
  const helloBody = (id: string) => JSON.stringify({ accountId: id, protocol: 2, sim: 2, content: FP });
  director.handle({ userId: 'a', sessionId: 'sa' }, OP.HELLO, helloBody('a'), 0);
  director.handle({ userId: 'b', sessionId: 'sb' }, OP.HELLO, helloBody('b'), 0);
  director.handle({ userId: 'a', sessionId: 'sa' }, OP.READY, JSON.stringify({ accountId: 'a' }), 0);
  director.handle({ userId: 'b', sessionId: 'sb' }, OP.READY, JSON.stringify({ accountId: 'b' }), 0);
  const yaws = [director.sim!.players[0]!.yaw, director.sim!.players[1]!.yaw];
  const inputs = [];
  for (let i = 0; i < 180; i += 1) {
    inputs.push(yaws.map((yaw) => ({
      yaw, pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, sprint: false, jump: false, dash: false, reload: false, slot: 0,
    })));
  }
  const receipt = JSON.parse(api.replayJSON(JSON.stringify({ seed: 7, inputs }))) as Wire & { ok?: boolean };
  assert.equal(receipt.outcome, 'draw');
  assert.equal(receipt.reason, 'double_ko');
  assert.equal(receipt.winner, null);
  assert.equal(receipt.tick, 65);
  assert.equal(receipt.stateHash, '6545ca0a');
  assert.equal(receipt.ticketsMinted, 0);
  assert.ok(timedRecord, 'the 90 s match stored its record');
  const recordText = JSON.stringify(timedRecord);
  const nodeReplay = JSON.parse(api.replayJSON(recordText)) as Wire & { verified: boolean };
  assert.equal(nodeReplay.verified, true);
  const sandbox: Record<string, unknown> = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'server/modules/vendor/shooter-pvp-sim.js'), 'utf8'), sandbox);
  const nodeSessionText = vm.runInContext(HOSTED_SESSION, sandbox) as string;
  const nodeSession = JSON.parse(nodeSessionText) as { result: Wire | null; verified: boolean; policy: string; snaps: number; pongs: number };
  assert.ok(nodeSession.result, 'the hosted session reached RESULT');
  assert.equal(nodeSession.verified, true);
  assert.ok(nodeSession.snaps > 100 && nodeSession.pongs > 0);
  const bundlePath = join(root, 'server/modules/vendor/shooter-pvp-sim.js');
  const dir = mkdtempSync(join(tmpdir(), 'shooter-pvp-goja-'));
  writeFileSync(join(dir, 'go.mod'), `module shooter-pvp-goja

go 1.26.0

require github.com/dop251/goja v0.0.0-20261107161106-d6eaa50db8bc
`);
  writeFileSync(join(dir, 'main.go'), `package main

import (
  "fmt"
  "io"
  "os"

  "github.com/dop251/goja"
)

func main() {
  src, err := os.ReadFile(os.Args[1])
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  input, err := io.ReadAll(os.Stdin)
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  vm := goja.New()
  if _, err = vm.RunString(string(src)); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  if len(os.Args) > 2 && os.Args[2] == "script" {
    v, err := vm.RunString(string(input))
    if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
    fmt.Print(v.String())
    return
  }
  fn, ok := goja.AssertFunction(vm.Get("SprotoShooterPvp").ToObject(vm).Get("replayJSON"))
  if !ok { fmt.Fprintln(os.Stderr, "replayJSON missing"); os.Exit(1) }
  out, err := fn(goja.Undefined(), vm.ToValue(string(input)))
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  fmt.Print(out.String())
}
`);
  const tidy = spawnSync('go', ['mod', 'tidy'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
  });
  if (tidy.error && (tidy.error as NodeJS.ErrnoException).code === 'ENOENT') {
    if (process.env.SHOOTER_REQUIRE_GOJA === '1') throw new Error('go is not installed');
    console.log('shooter pvp goja skipped: go is not installed');
  } else {
    const tidyDetail = tidy.stderr || tidy.stdout || 'go mod tidy failed';
    if (tidy.status !== 0) {
      if (process.env.SHOOTER_REQUIRE_GOJA === '1') throw new Error(tidyDetail);
      console.log(`shooter pvp goja skipped: ${tidyDetail.split('\n')[0]}`);
    } else {
    const gojaRun = (input: string, mode = 'replay'): string => {
      const res = spawnSync('go', ['run', '.', bundlePath, mode], {
        cwd: dir,
        input,
        encoding: 'utf8',
        timeout: 180000,
        env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
      });
      if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'goja failed');
      return res.stdout;
    };
    const goja = (input: string): Wire & { verified?: boolean } => JSON.parse(gojaRun(input)) as Wire & { verified?: boolean };
    const gojaReceipt = goja(JSON.stringify({ seed: 7, inputs }));
    assert.equal(gojaReceipt.stateHash, '6545ca0a');
    assert.equal(gojaReceipt.tick, 65);
    assert.equal(gojaReceipt.reason, 'double_ko');
    assert.equal(gojaReceipt.ticketsMinted, 0);
    const gojaReplay = goja(recordText);
    assert.equal(gojaReplay.verified, true);
    assert.equal(gojaReplay.stateSha256, nodeReplay.stateSha256);
    const gojaSession = gojaRun(HOSTED_SESSION, 'script');
    assert.equal(gojaSession, nodeSessionText, 'a hosted-director session is identical in goja');
    console.log(`shooter pvp goja parity stateHash ${gojaReceipt.stateHash}, replay v2 verified ${gojaReplay.stateHash}, hosted session ${nodeSession.result!.outcome}/${nodeSession.result!.reason} at ${nodeSession.result!.tick}`);
    }
  }
  console.log(`shooter free pin ${COMMIT} fingerprint ${FP}`);
}

console.log('shooter_match tests ok');
