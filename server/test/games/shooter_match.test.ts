// H3-S free authoritative Shooter 1v1. The Nakama load in scripts/load/shooter-bots.ts
// repeats the live socket path. Practice never reaches this match. Guests may
// take one seat. No Ticket delta.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRegistrations, loadModule, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FP = 'f5949631';
const LOADOUT = '9eb7cd63';
const CAMPAIGN = '3c657fb5';
const COMMIT = '5ccaf82a04c8e4233b257b71194ad82d8fd5f022';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OP = { HELLO: 1, WELCOME: 2, REJECT: 3, READY: 4, PHASE: 5, INPUT: 6, SNAPSHOT: 7, RESULT: 8, RESYNC: 9 };

interface PvpApi {
  encodeInput(wish: { [key: string]: unknown }): Uint8Array;
  replayJSON(text: string): string;
  createDirector(options?: { seed?: number; matchId?: string }): {
    sim: { players: { yaw: number }[] } | null;
    handle(sender: { userId: string; sessionId: string }, op: number, data: string, now: number): { ok: boolean };
  };
  CONTENT_FINGERPRINT: string;
}

interface Wire {
  outcome?: string;
  winner?: number | null;
  reason?: string;
  tick?: number;
  stateHash?: string | null;
  ticketsMinted?: number;
  stakes?: boolean;
  seed?: number;
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
}

interface LiveState {
  phase: string;
  seed: number;
  seated: number;
  tick: number;
  guest: Record<string, number>;
  generation: Record<string, number>;
  sids: Record<string, string>;
  result: { outcome: string; reason: string; winner: number | null; ticketsMinted: number; stakes: boolean } | null;
  serverSeq: number;
  resultSent: boolean;
}

function load() {
  return loadModule({ env: { HUB_FAULT_INJECT: '1' } });
}

function game(userId: string, sessionId: string, sid = SID, scope = 'game', gameId = 'sproto-shooter') {
  return { userId, sessionId, username: 'ada', vars: { scope, game: gameId, sid } };
}

function apiOf(mod: LoadedModule): PvpApi {
  return mod.global.SprotoShooterPvp as PvpApi;
}

function packet(api: PvpApi, wish: { [key: string]: unknown }): string {
  const bytes = api.encodeInput(wish);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    if (byte > 127) throw new Error(`harness utf8 would corrupt byte ${byte}`);
    out += String.fromCharCode(byte);
  }
  return out;
}

function wish(seq: number, frame: number, extra: { [key: string]: unknown } = {}) {
  return { seq, frame, yaw: 0, pitch: 0, moveX: 0, moveZ: 0, fire: false, zoom: false, sprint: false, jump: false, dash: false, reload: false, slot: 0, ...extra };
}

function ledgerCount(mod: LoadedModule): number {
  return mod.nk.sqlCalls.filter((call) => /earn_tickets|tickets_ledger|wallet|leaderboard|ranked_score/i.test(call.sql)).length;
}

function hello(m: MatchDriver, p: Presence, extra: Record<string, unknown> = {}): void {
  m.loop([{ sender: p, opCode: OP.HELLO, data: { accountId: p.userId, protocol: 1, sim: 1, content: FP, ...extra } }]);
}

function ready(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.READY, data: { accountId: p.userId } }]);
}

function open(seed = '7'): { mod: LoadedModule; m: MatchDriver; a: Presence; b: Presence; ledger: number } {
  const mod = load();
  const ledger = ledgerCount(mod);
  const m = mod.startMatch('sproto_shooter_free', { seed, seedSource: 'server', private: '1' });
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.accept, true);
  return { mod, m, a, b, ledger };
}

function live(): { mod: LoadedModule; m: MatchDriver; a: Presence; b: Presence } {
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
  const version = mod.call<Wire & { match: string; guests: string; practice: string; stake: number; budgetMs: number; campaignFingerprint: string; error?: string }>(
    'shooter.version',
    game(A, 'sa'),
    {},
  );
  assert.equal(version.error, undefined, JSON.stringify(version));
  assert.equal(version.protocol, 1);
  assert.equal(version.sim, 1);
  assert.equal(version.content, FP);
  assert.equal(version.loadoutHash, LOADOUT);
  assert.equal(version.campaignFingerprint, CAMPAIGN);
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
  const created = mod.call<{ matchId: string; code: string; stake: number; ticketsMinted: number; error?: string }>('shooter.room_create', game(A, 'sa'), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  assert.equal(created.stake, 0);
  assert.equal(created.ticketsMinted, 0);
  assert.equal(created.code.length, 12);
  assert.equal((mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), {})).error, 'already_in_match');
  const joined = mod.call<{ matchId: string; stake: number; error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code.toLowerCase(), v: 1, sim: 1, content: FP });
  assert.equal(joined.matchId, created.matchId);
  assert.equal(joined.stake, 0);
  assert.equal((mod.call<{ error?: string }>('shooter.room_join', game(B, 'sb'), { code: created.code, v: 0 })).error, 'version_mismatch');
  assert.equal((mod.call<{ error?: string }>('shooter.room_join', game(C, 'sc'), { code: 'not-a-code' })).error, 'room_not_found');
  assert.equal((mod.call<{ matchId: string }>('shooter.resume', game(A, 'sa'), {})).matchId, created.matchId);
  const listed = (mod.global.HubGames as { list(): string[] }).list();
  assert.equal(listed.filter((id) => id === 'sproto-shooter').length, 1);
  const HubGames = mod.global.HubGames as { matchmakingAllowed(scope: string, game: string, target: string): boolean };
  assert.equal(HubGames.matchmakingAllowed('game', 'sproto-shooter', 'sproto-shooter'), true);
  assert.equal(HubGames.matchmakingAllowed('hub', '', 'sproto-shooter'), false);
  const campaign = JSON.parse(readFileSync(join(root, 'server/modules/vendor/shooter-sim.pin.json'), 'utf8')) as { fingerprint: string; sha256: string };
  assert.equal(campaign.fingerprint, CAMPAIGN);
  assert.equal(campaign.sha256, 'aad5daf5b63c6b71309635bd98e48d8019c8fa2ba5f4736c2a8bb3d241e9576d');
  const source = ['shooter_match.ts', 'shooter_matchmaking.ts', 'shooter_protocol.ts'].map((name) => readFileSync(join(root, 'server/modules/src/games', name), 'utf8')).join('\n');
  assert.equal(/nk\.sql|earn_tickets|walletUpdate|leaderboardRecord|sproto_arena|sproto_duel|claimWinner|claim_winner/.test(source), false);
  assert.equal(ledgerCount(mod), ledger);
  const label = JSON.parse(mod.nk.matches.get(created.matchId)!.label) as { kind: string; stake: number; mode: string };
  assert.equal(label.kind, 'sproto_shooter_free');
  assert.equal(label.mode, 'free');
  assert.equal(label.stake, 0);
}

// One guest seat, one signed-in seat, server seed, hostile and oversized traffic.
{
  const mod = load();
  const ledger = ledgerCount(mod);
  mod.nk.accounts.set(B, { email: 'bea@example.com', user: { userId: B, username: 'bea' } });
  const m = mod.startMatch('sproto_shooter_free', { seed: '7', seedSource: 'server', private: '1' });
  const guest = presence(A, 'guest', 'sa');
  const named = presence(B, 'bea', 'sb');
  assert.equal(m.join([guest], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([named], game(B, 'sb'))[0]?.accept, true);
  assert.equal(m.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'match_full');
  assert.equal(m.joinAttempt(presence(A, 'guest', 'sa-other'), game(A, 'sa-other', SID2)).rejectMessage, 'wrong_sender');
  hello(m, guest, { seed: 99, winner: 0 });
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'client_result');
  m.dispatcher.clear();
  hello(m, guest, { seed: 99 });
  const welcome = last<Wire>(m.dispatcher.sent<Wire>(OP.WELCOME));
  assert.equal(welcome.accountId, A);
  assert.equal(welcome.seat, 0);
  assert.equal(welcome.seed, 7);
  assert.equal(welcome.loadoutHash, LOADOUT);
  assert.equal(welcome.content, FP);
  assert.equal(welcome.ticketsMinted, 0);
  assert.equal(welcome.stakes, false);
  assert.equal(stateOf(m).guest[A], 1);
  assert.equal(stateOf(m).guest[B], 0);
  assert.equal(stateOf(m).generation[A], 1);
  assert.equal(stateOf(m).seated, 1);
  hello(m, guest);
  assert.equal(stateOf(m).seated, 1, 'a guest is not given the other seat');
  const huge = { accountId: B, protocol: 1, sim: 1, content: FP, pad: 'x'.repeat(3000) };
  m.loop([{ sender: named, opCode: OP.HELLO, data: huge }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'malformed');
  m.dispatcher.clear();
  hello(m, named);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.WELCOME)).seat, 1);
  m.loop([{ sender: named, opCode: OP.READY, data: { accountId: named.userId, earnTickets: 20 } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'client_result');
  m.loop([{ sender: named, opCode: OP.RESULT, data: { winner: 1, outcome: 'ko' } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'client_result');
  assert.equal(stateOf(m).result, null);
  m.loop([{ sender: named, opCode: OP.SNAPSHOT, data: { winner: 1, hp: 1 } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'malformed');
  assert.equal(stateOf(m).phase, 'lobby');
  assert.equal(ledgerCount(mod), ledger);
}

// Live input rules, authoritative snapshots, reconnect, stall, draw, shutdown.
{
  const seated = live();
  const { mod, m, a, b } = seated;
  assert.equal(stateOf(m).phase, 'live');
  assert.equal(stateOf(m).seed, 7);
  const snap = last<Wire>(m.dispatcher.sent<Wire>(OP.SNAPSHOT));
  assert.equal(snap.phase, 'live');
  assert.equal(snap.ticketsMinted, 0);
  assert.equal(snap.stakes, false);
  assert.equal(snap.serverSeq, 1);
  assert.match(snap.hash || '', /^[0-9a-f]{8}$/);
  const api = apiOf(mod);
  const frameNow = () => stateOf(m).tick;
  m.dispatcher.clear();
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(2, frameNow())) }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'sequence');
  m.loop([{ sender: a, opCode: OP.INPUT, data: 'short' }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'malformed');
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(1, frameNow() + 5)) }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'frame');
  const burstFrame = frameNow();
  const burst = [1, 2, 3, 4, 5].map((seq) => ({ sender: a, opCode: OP.INPUT, data: packet(api, wish(seq, burstFrame)) }));
  m.loop(burst);
  const rejects = m.dispatcher.sent<Wire>(OP.REJECT).map((row) => row.body.reason);
  assert.ok(rejects.includes('rate'), JSON.stringify(rejects));
  roundTrip(m);
  m.loop([{ sender: b, opCode: OP.INPUT, data: packet(api, wish(1, frameNow())) }]);
  assert.equal(m.dispatcher.sent<Wire>(OP.REJECT).filter((row) => row.body.accountId === B).length, 0);
  assert.equal(stateOf(m).phase, 'live');
  m.leave([a]);
  const again = presence(A, 'ada', 'sa2');
  assert.equal(m.join([again], game(A, 'sa2'))[0]?.accept, true);
  assert.equal(stateOf(m).generation[A], 1);
  assert.equal(stateOf(m).sids[A], SID);
  m.dispatcher.clear();
  m.loop([{ sender: again, opCode: OP.RESYNC, data: { accountId: A } }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.WELCOME)).accountId, A);
  assert.ok(m.dispatcher.sent<Wire>(OP.SNAPSHOT).length >= 1);
  m.loop([{ sender: a, opCode: OP.INPUT, data: packet(api, wish(5, stateOf(m).tick)) }]);
  assert.equal(last<Wire>(m.dispatcher.sent<Wire>(OP.REJECT)).reason, 'wrong_sender');
  const resumed = m.signal('advance:200');
  assert.equal(JSON.parse(resumed || '{}').ticketsMinted, 0);
  m.loop([]);
  m.loop([{ sender: again, opCode: OP.INPUT, data: packet(api, wish(5, stateOf(m).tick)) }]);
  assert.equal(stateOf(m).phase, 'live', JSON.stringify(m.dispatcher.sent<Wire>(OP.REJECT).map((row) => row.body)));
  assert.equal(stateOf(m).result, null);
  m.dispatcher.clear();
  m.signal('advance:10000');
  m.loop([{ sender: again, opCode: OP.INPUT, data: packet(api, wish(6, stateOf(m).tick)) }]);
  const forfeited = last<Wire>(m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(forfeited.outcome, 'forfeit');
  assert.equal(forfeited.reason, 'stall');
  assert.equal(forfeited.winner, 0);
  assert.equal(forfeited.ticketsMinted, 0);
  assert.equal(forfeited.stakes, false);
  assert.equal(ledgerCount(mod), seated.ledger);
}

// Draw when both stall, time ends before a late stall, ready timeout, shutdown keeps a result.
{
  const both = live();
  both.m.signal('advance:10000');
  both.m.loop([]);
  const draw = last<Wire>(both.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(draw.outcome, 'draw');
  assert.equal(draw.reason, 'both_stall');
  assert.equal(draw.winner, null);
  assert.equal(draw.ticketsMinted, 0);
  both.m.terminate();
  assert.equal(stateOf(both.m).result?.reason, 'both_stall');
  assert.equal(ledgerCount(both.mod), both.ledger);

  const clock = live();
  clock.m.dispatcher.clear();
  clock.m.signal('advance:120000');
  clock.m.loop([]);
  const timed = last<Wire>(clock.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(timed.outcome, 'draw');
  assert.equal(timed.reason, 'time');
  assert.equal(timed.winner, null);
  assert.equal(timed.ticketsMinted, 0);
  assert.notEqual(timed.reason, 'both_stall');

  const waiting = open();
  hello(waiting.m, waiting.a);
  waiting.m.signal('advance:30000');
  waiting.m.loop([]);
  const cancel = last<Wire>(waiting.m.dispatcher.sent<Wire>(OP.RESULT));
  assert.equal(cancel.outcome, 'cancel');
  assert.equal(cancel.reason, 'ready_timeout');
  assert.equal(cancel.winner, null);
  assert.equal(cancel.ticketsMinted, 0);

  const empty = load().startMatch('sproto_shooter_free', { seed: '3', seedSource: 'server', private: '1', host: A });
  empty.signal('advance:30000');
  empty.loop([]);
  assert.equal(stateOf(empty).result?.reason, 'ready_timeout');
  assert.equal(stateOf(empty).result?.ticketsMinted, 0);

  const down = open();
  down.m.terminate();
  const shutdown = last<Wire>(down.m.dispatcher.sent<Wire>(OP.RESULT));
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
  dropped.m.signal('advance:10000');
  dropped.m.loop([]);
  assert.equal(stateOf(dropped.m).result?.outcome, 'draw');
  assert.equal(stateOf(dropped.m).result?.reason, 'both_stall');
  assert.equal(stateOf(dropped.m).result?.winner, null);
  assert.equal(stateOf(dropped.m).result?.ticketsMinted, 0);
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
  const props = { game: 'sproto-shooter', mode: 'free', protocol: '1', sim: '1', content: FP };
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } });
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } }), /already_queued/);
  mod.rtBefore('MatchmakerRemove', game(A, 'sa'), { matchmakerRemove: { ticket: 't1' } });
  assert.equal((mod.call<{ queued: boolean }>('shooter.queue_cancel', game(A, 'sa'), {})).queued, false);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, mode: 'practice' } } }), /practice_offline/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, stake: '10' } } }), /stakes_disabled/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, content: 'deadbeef' } } }), /version_mismatch/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', { userId: A, sessionId: 'sa', vars: { scope: 'hub' } }, { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: props } }), /wrong_scope/);
  const id = mod.matchmake([
    { presence: a, properties: props },
    { presence: b, properties: props },
  ]);
  assert.ok(id);
  assert.equal(mod.nk.matches.get(id!)?.module, 'sproto_shooter_free');
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: b, properties: props }]), id);
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: presence(A, 'ada', 'other'), properties: props }]), undefined);
  const queued = mod.driver(id!);
  assert.equal(queued.joinAttempt(presence(C, 'cy', 'sc'), game(C, 'sc')).rejectMessage, 'not_in_roster');
  assert.equal(ledgerCount(mod), ledger);
}

// Vendored golden: seed 7, double KO at tick 61, same hash in goja when Go is present.
{
  const mod = load();
  const api = apiOf(mod);
  const director = api.createDirector({ seed: 7, matchId: 'golden' });
  const helloBody = (id: string) => JSON.stringify({ accountId: id, protocol: 1, sim: 1, content: FP });
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
  assert.equal(receipt.tick, 61);
  assert.equal(receipt.stateHash, 'ce272de1');
  assert.equal(receipt.ticketsMinted, 0);
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
    const res = spawnSync('go', ['run', '.', bundlePath], {
      cwd: dir,
      input: JSON.stringify({ seed: 7, inputs }),
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
    });
    if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'goja failed');
    const gojaReceipt = JSON.parse(res.stdout) as Wire;
    assert.equal(gojaReceipt.stateHash, 'ce272de1');
    assert.equal(gojaReceipt.tick, 61);
    assert.equal(gojaReceipt.reason, 'double_ko');
    assert.equal(gojaReceipt.ticketsMinted, 0);
    console.log(`shooter pvp goja parity stateHash ${gojaReceipt.stateHash}`);
    }
  }
  console.log(`shooter free pin ${COMMIT} fingerprint ${FP}`);
}

console.log('shooter_match tests ok');
