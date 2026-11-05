// Sproto Duel's sproto_arena match (server/modules/src/games/sproto_arena.ts):
// join/start, version and scope gates, the host-only relay, the referee
// (verified / disputed / forfeit / quick quit / stall), pair and daily caps,
// private rooms, matchmaker routing and the registration shape.
import assert from 'node:assert/strict';
import { checkRegistrations, loadModule, plain, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const SID_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const OP = { HELLO: 1, START: 2, INPUT: 10, SNAPSHOT: 11, ROUND: 12, RESULT: 13, OUTCOME: 14, CANCEL: 15, PEER: 16, PING: 17, FORFEIT: 18 };
const TICK = 30;
const V = '1';

const vars = (sid: string) => ({ scope: 'game', game: 'sproto', sid });

interface Arena {
  mod: LoadedModule;
  m: MatchDriver;
  pa: Presence;
  pb: Presence;
  host: Presence;
  guest: Presence;
  hostSeat: number;
  earns: unknown[][];
  wins: unknown[][];
  payRows: unknown[][];
}

/** A quick-match pair through the matchmaker, both joined and HELLO'd, START sent. */
function sessionVars(sid: string, ranked?: string): Record<string, string> {
  const v: Record<string, string> = { scope: 'game', game: 'sproto', sid };
  if (ranked !== undefined) v.ranked = ranked;
  return v;
}

function start(opts: { paid?: boolean; ranked?: string } = {}): Arena {
  const mod = loadModule();
  const earns: unknown[][] = [];
  const wins: unknown[][] = [];
  const payRows: unknown[][] = [];
  mod.nk.onSql('game.sproto_pvp_result', (args) => {
    payRows.push(args);
    return [{ paid: opts.paid !== false }];
  });
  mod.nk.onSql('game.earn_tickets', (args) => {
    earns.push(args);
    return [{ result: JSON.stringify({ balance: 120, capped: false }) }];
  });
  mod.nk.onSql('game.win_record', (args) => {
    wins.push(args);
    return [{ result: JSON.stringify({ recorded: true }) }];
  });
  const pa = presence(A, 'alice'), pb = presence(B, 'bob');
  const id = mod.matchmake([
    { presence: pa, properties: { game: 'sproto', v: V } },
    { presence: pb, properties: { game: 'sproto', v: V } },
  ]);
  assert.ok(id, 'sproto pair creates a match');
  assert.equal(mod.nk.matches.get(id!)?.module, 'sproto_arena');
  const m = mod.driver(id!);
  assert.deepEqual(m.join([pa], { vars: sessionVars(SID_A, opts.ranked) }).map((v) => v.accept), [true]);
  assert.deepEqual(m.join([pb], { vars: sessionVars(SID_B, opts.ranked) }).map((v) => v.accept), [true]);
  m.loop([{ sender: pa, opCode: OP.HELLO, data: { v: V, staff: 'duel_staff_nobu' } }, { sender: pb, opCode: OP.HELLO, data: { v: V, staff: 'nope' } }]);
  const starts = m.dispatcher.sent<{ seat: number; hostSeat: number; names: string[]; staffs: string[] }>(OP.START);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts.map((s) => s.body.seat).sort(), [0, 1]);
  const hostSeat = starts[0]!.body.hostSeat;
  assert.deepEqual(plain(starts[0]!.body.names), ['alice', 'bob']);
  assert.deepEqual(plain(starts[0]!.body.staffs), ['duel_staff_nobu', 'duel_staff_sproto']);
  for (const s of starts) assert.equal(s.to?.length, 1, 'START is per player');
  const host = hostSeat === 0 ? pa : pb, guest = hostSeat === 0 ? pb : pa;
  m.dispatcher.clear();
  return { mod, m, pa, pb, host, guest, hostSeat, earns, wins, payRows };
}

/** Run `seconds` of play with both sides streaming (no stall). */
function play(a: Arena, seconds: number): void {
  for (let i = 0; i < seconds * TICK; i++) {
    a.m.loop([
      { sender: a.guest, opCode: OP.INPUT, data: '{"t":1,"f":[]}' },
      { sender: a.host, opCode: OP.SNAPSHOT, data: '{"v":1}' },
    ]);
  }
}

const outcome = (a: Arena) => a.m.dispatcher.sent<{ status: string; winnerSeat: number | null; reason: string; paid: Record<string, number> }>(OP.OUTCOME);

// Registration shape, matchmaker routing and the migration.
{
  const mod = loadModule();
  const { issues } = checkRegistrations(mod.source);
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2));
  assert.ok(mod.registered.matches.has('sproto_arena'));
  assert.ok(mod.registered.rpcs.has('sproto.room_create') && mod.registered.rpcs.has('sproto.room_join'));
  const HubGames = mod.global.HubGames as { list(): string[]; matchmakingAllowed(scope: string, game: string, target: string): boolean };
  assert.ok(HubGames.list().includes('sproto') && HubGames.list().includes('sproto-fighter'));
  assert.equal(HubGames.matchmakingAllowed('game', 'sproto', 'sproto'), true);
  assert.equal(HubGames.matchmakingAllowed('hub', '', 'sproto'), false, 'Sproto Duel matchmakes on its game session only');
  // Fighter still routes to its own match.
  const fighter = mod.matchmake([
    { presence: presence(A), properties: { game: 'sproto-fighter', wager: '0', sim: 'abc' } },
    { presence: presence(B), properties: { game: 'sproto-fighter', wager: '0', sim: 'abc' } },
  ]);
  assert.equal(mod.nk.matches.get(fighter!)?.module, 'sproto_duel');
  // Mismatched versions or the same user never pair.
  assert.equal(mod.matchmake([{ presence: presence(A), properties: { game: 'sproto', v: '1' } }, { presence: presence(B), properties: { game: 'sproto', v: '0' } }]), undefined);
  assert.equal(mod.matchmake([{ presence: presence(A), properties: { game: 'sproto', v: '1' } }, { presence: presence(A, 'a2', 's2'), properties: { game: 'sproto', v: '1' } }]), undefined);
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const mig = HubSchema.all().find((x) => x.id === '0020_sproto_pvp');
  assert.ok(mig, 'migration 0020 registered');
  assert.ok(mig!.statements.some((s) => /sproto_pvp_result/.test(s)) && mig!.statements.some((s) => /srv_pvp_win/.test(s)));
  // Label (Contract C7).
  const id = mod.matchmake([{ presence: presence(A), properties: { game: 'sproto', v: V } }, { presence: presence(B), properties: { game: 'sproto', v: V } }]);
  assert.deepEqual(JSON.parse(mod.nk.matches.get(id!)!.label), { game: 'sproto', kind: 'sproto_arena', v: V, open: false, code: '' }, 'a matchmade pair is never open');
}

// Scope gate and version cancel.
{
  const mod = loadModule();
  const id = mod.matchmake([{ presence: presence(A), properties: { game: 'sproto', v: V } }, { presence: presence(B), properties: { game: 'sproto', v: V } }]);
  const m = mod.driver(id!);
  assert.equal(m.joinAttempt(presence(A), { vars: { scope: 'hub', sid: SID_A } }).rejectMessage, 'wrong_scope');
  assert.equal(m.joinAttempt(presence(A), { vars: null }).rejectMessage, 'wrong_scope');
  assert.equal(m.joinAttempt(presence(C), { vars: vars(SID_A) }).rejectMessage, 'match_full', 'a stranger cannot take a seat');
  m.join([presence(A, 'alice')], { vars: vars(SID_A) });
  m.join([presence(B, 'bob')], { vars: vars(SID_B) });
  m.loop([{ sender: presence(A, 'alice'), opCode: OP.HELLO, data: { v: '0', staff: 'x' } }]);
  const cancels = m.dispatcher.sent<{ reason: string; seat: number }>(OP.CANCEL);
  assert.equal(cancels[0]?.body.reason, 'version_mismatch');
  assert.equal(m.dispatcher.sent(OP.START).length, 0);
  assert.equal(m.ticks(2 * TICK + 1), false, 'match ends after the linger');
}

// Join timeout: one player never shows up.
{
  const mod = loadModule();
  const id = mod.matchmake([{ presence: presence(A), properties: { game: 'sproto', v: V } }, { presence: presence(B), properties: { game: 'sproto', v: V } }]);
  const m = mod.driver(id!);
  m.join([presence(A)], { vars: vars(SID_A) });
  m.ticks(31 * TICK);
  assert.equal(m.dispatcher.sent<{ reason: string }>(OP.CANCEL)[0]?.body.reason, 'join_timeout');
}

// Relay: guest INPUT only to the host, host SNAPSHOT only to the guest; the other directions are dropped.
{
  const a = start();
  a.m.loop([
    { sender: a.guest, opCode: OP.INPUT, data: '{"t":5,"f":[5,0,0,0,0,0,0,4]}' },
    { sender: a.host, opCode: OP.INPUT, data: '{"t":5,"f":[]}' },
    { sender: a.host, opCode: OP.SNAPSHOT, data: '{"v":1,"t":9}' },
    { sender: a.guest, opCode: OP.SNAPSHOT, data: '{"v":1,"t":9}' },
    { sender: a.guest, opCode: OP.PING, data: { c: 1234 } },
  ]);
  const inputs = a.m.dispatcher.broadcasts.filter((b) => b.opCode === OP.INPUT);
  const snaps = a.m.dispatcher.broadcasts.filter((b) => b.opCode === OP.SNAPSHOT);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]!.presences?.[0]?.userId, a.host.userId);
  assert.equal(inputs[0]!.data, '{"t":5,"f":[5,0,0,0,0,0,0,4]}', 'relayed unparsed');
  assert.equal(inputs[0]!.sender?.userId, a.guest.userId);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]!.presences?.[0]?.userId, a.guest.userId);
  const ping = a.m.dispatcher.sent<{ c: number; s: number }>(OP.PING);
  assert.equal(ping[0]?.body.c, 1234);
  assert.equal(ping[0]?.to?.[0]?.userId, a.guest.userId);
  // Oversized messages and floods are dropped.
  a.m.dispatcher.clear();
  a.m.loop([{ sender: a.guest, opCode: OP.INPUT, data: 'x'.repeat(3000) }]);
  a.m.loop(Array.from({ length: 8 }, () => ({ sender: a.guest, opCode: OP.INPUT, data: '{}' })));
  assert.equal(a.m.dispatcher.broadcasts.filter((b) => b.opCode === OP.INPUT).length, 4, 'MAX_MSGS_PER_TICK');
}

// ranked "1" only: verified, the winner paid exactly once (deterministic key), the board updated.
{
  const a = start({ ranked: '1' });
  const winner = a.hostSeat;
  const wins = winner === 0 ? [2, 0] : [0, 2];
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: winner, reason: 'ko', wins: winner === 0 ? [1, 0] : [0, 1] } }]);
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 2, winnerSeat: winner, reason: 'time', wins } }]);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: winner, wins, rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: winner, wins, rounds: 2 } },
  ]);
  const out = outcome(a);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.body.status, 'verified');
  assert.equal(out[0]!.body.winnerSeat, winner);
  assert.deepEqual(plain(out[0]!.body.paid), { [a.host.userId]: 20 });
  assert.equal(a.earns.length, 1);
  const args = a.earns[0]!;
  assert.equal(args[0], a.host.userId);
  assert.equal(args[1], a.host.userId === A ? SID_A : SID_B, 'the winner\'s own game session');
  assert.equal(args[2], 'sproto');
  assert.equal(args[3], 20);
  assert.equal(args[4], 'srv_pvp_win');
  assert.match(String(args[5]), /^sproto:pvp:[0-9a-f-]{36}:[0-9a-f]{8}$/);
  assert.ok(String(args[5]).length <= 80);
  assert.equal(a.wins.length, 1, 'sproto_wins recorded');
  // A repeat RESULT after the outcome pays nothing more.
  a.m.loop([{ sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: winner, wins, rounds: 2 } }]);
  assert.equal(a.earns.length, 1);
  assert.equal(outcome(a).length, 1);
}

// Results differ → disputed, no payout and no board.
{
  const a = start();
  play(a, 16);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] } }]);
  play(a, 3);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 2, winnerSeat: 0, reason: 'ko', wins: [2, 0] } }]);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: 1, wins: [0, 2], rounds: 2 } },
  ]);
  assert.equal(outcome(a)[0]?.body.status, 'disputed');
  assert.equal(a.earns.length + a.wins.length + a.payRows.length, 0);
}

// Agreeing but implausible (rounds that never happened, or too quick) → disputed.
{
  const a = start();
  play(a, 20);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
  ]);
  assert.equal(outcome(a)[0]?.body.reason, 'implausible');
  assert.equal(a.earns.length, 0);
}

// ranked "1" only: forfeit after the grace is paid (a round finished, past MIN_PLAY).
{
  const a = start({ ranked: '1' });
  play(a, 16);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 1 - a.hostSeat, reason: 'ko', wins: a.hostSeat === 0 ? [0, 1] : [1, 0] } }]);
  a.m.leave([a.guest]);
  const peer = a.m.dispatcher.sent<{ seat: number; present: boolean; graceS: number }>(OP.PEER);
  assert.equal(peer[0]?.body.present, false);
  assert.equal(peer[0]?.body.graceS, 10);
  assert.equal(peer[0]?.to?.[0]?.userId, a.host.userId);
  a.m.ticks(9 * TICK);
  assert.equal(outcome(a).length, 0, 'still inside the grace');
  a.m.ticks(2 * TICK);
  const out = outcome(a)[0]!.body;
  assert.equal(out.status, 'forfeit');
  assert.equal(out.winnerSeat, a.hostSeat);
  assert.deepEqual(plain(out.paid), { [a.host.userId]: 20 });
}

// Back within the grace: no forfeit, START re-sent, the opponent told.
{
  const a = start();
  play(a, 3);
  a.m.leave([a.guest]);
  a.m.ticks(5 * TICK);
  a.m.join([a.guest], { vars: vars(a.guest.userId === A ? SID_A : SID_B) });
  assert.equal(a.m.dispatcher.sent<{ present: boolean }>(OP.PEER).at(-1)?.body.present, true);
  assert.ok(a.m.dispatcher.sent<{ seat: number }>(OP.START).some((s) => s.to?.[0]?.userId === a.guest.userId));
  play(a, 8);
  assert.equal(outcome(a).length, 0);
}

// Quick quit (FORFEIT at once) → forfeit, unpaid, but the board still counts the win.
{
  const a = start();
  play(a, 2);
  a.m.loop([{ sender: a.guest, opCode: OP.FORFEIT, data: {} }]);
  const out = outcome(a)[0]!.body;
  assert.equal(out.status, 'forfeit');
  assert.equal(out.winnerSeat, a.hostSeat);
  assert.deepEqual(plain(out.paid), {});
  assert.equal(a.earns.length, 0);
  assert.equal(a.wins.length, 1);
}

// Stall: the guest stops sending input while the host streams → the host wins.
{
  const a = start();
  for (let i = 0; i < 11 * TICK; i++) a.m.loop([{ sender: a.host, opCode: OP.SNAPSHOT, data: '{}' }]);
  const out = outcome(a)[0]!.body;
  assert.equal(out.reason, 'guest_stalled');
  assert.equal(out.winnerSeat, a.hostSeat);
}

// ranked "1" only: pair / daily caps reached → verified but paid:false, no earn; the board still counts it.
{
  const a = start({ paid: false, ranked: '1' });
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] } }]);
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 2, winnerSeat: 0, reason: 'ko', wins: [2, 0] } }]);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
  ]);
  const out = outcome(a)[0]!.body;
  assert.equal(out.status, 'verified');
  assert.deepEqual(plain(out.paid), {});
  assert.equal(a.earns.length, 0);
  assert.equal(a.payRows.length, 1);
  assert.deepEqual(plain(a.payRows[0]!.slice(4)), [5, 10], 'pair and daily caps');
  assert.equal(a.wins.length, 1);
}

// Only the host's RESULT arrives and the guest is gone: after RESULT_WAIT the host wins by forfeit.
{
  const a = start();
  play(a, 16);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: a.hostSeat, reason: 'ko', wins: a.hostSeat === 0 ? [1, 0] : [0, 1] } }]);
  a.m.loop([{ sender: a.host, opCode: OP.RESULT, data: { winnerSeat: a.hostSeat, wins: a.hostSeat === 0 ? [2, 0] : [0, 2], rounds: 2 } }]);
  a.m.leave([a.guest]);
  a.m.ticks(6 * TICK);
  assert.equal(outcome(a)[0]?.body.reason, 'left_before_result');
}

// Private rooms: create (code + matchId), join by code, label closes, unknown and version errors.
{
  const mod = loadModule();
  assert.throws(() => mod.call('sproto.room_create', { userId: A, vars: { scope: 'hub' } }, { v: V }), /wrong_scope/);
  assert.throws(() => mod.call('sproto.room_create', { userId: A, vars: vars(SID_A) }, { v: '0' }), /version_mismatch/);
  const room = mod.call<{ matchId: string; code: string }>('sproto.room_create', { userId: A, username: 'alice', vars: vars(SID_A) }, { v: V });
  assert.match(room.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  const m = mod.driver(room.matchId);
  m.join([presence(A, 'alice')], { vars: vars(SID_A) });
  assert.deepEqual(JSON.parse(m.match.label), { game: 'sproto', kind: 'sproto_arena', v: V, open: true, code: room.code });
  const joined = mod.call<{ matchId: string }>('sproto.room_join', { userId: B, vars: vars(SID_B) }, { code: room.code.toLowerCase(), v: V });
  assert.equal(joined.matchId, room.matchId);
  assert.throws(() => mod.call('sproto.room_join', { userId: B, vars: vars(SID_B) }, { code: room.code, v: '0' }), /version_mismatch/);
  assert.throws(() => mod.call('sproto.room_join', { userId: B, vars: vars(SID_B) }, { code: 'ZZZZZZ', v: V }), /room_not_found/);
  assert.throws(() => mod.call('sproto.room_join', { userId: B, vars: vars(SID_B) }, { code: 'bad', v: V }), /room_not_found/);
  assert.equal(m.join([presence(B, 'bob')], { vars: vars(SID_B) })[0]!.accept, true);
  assert.equal(JSON.parse(m.match.label).open, false, 'a full room is no longer listed');
  assert.equal(m.joinAttempt(presence(C), { vars: vars(SID_A) }).rejectMessage, 'match_full');
  m.loop([{ sender: presence(A, 'alice'), opCode: OP.HELLO, data: { v: V } }, { sender: presence(B, 'bob'), opCode: OP.HELLO, data: { v: V } }]);
  assert.equal(m.dispatcher.sent(OP.START).length, 2);
  // A room nobody joins expires.
  const lonely = mod.call<{ matchId: string }>('sproto.room_create', { userId: C, vars: vars(SID_A) }, { v: V });
  const lm = mod.driver(lonely.matchId);
  lm.join([presence(C)], { vars: vars(SID_A) });
  lm.ticks(301 * TICK);
  assert.equal(lm.dispatcher.sent<{ reason: string }>(OP.CANCEL)[0]?.body.reason, 'room_expired');
}

// Server shutdown mid-match.
{
  const a = start();
  play(a, 1);
  a.m.terminate(0);
  assert.equal(outcome(a)[0]?.body.status, 'server_shutdown');
}

/** Agreed 2-0 for seat 0, long enough to be a verified result. */
function agreeSeat0(a: Arena): void {
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] } }]);
  play(a, 10);
  a.m.loop([{ sender: a.host, opCode: OP.ROUND, data: { round: 2, winnerSeat: 0, reason: 'time', wins: [2, 0] } }]);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
  ]);
}

/** Missing, empty, "0", or any other value: 0 T, no cap row, the win recorded once. */
function expectUnpaid(a: Arena, label: string): void {
  const out = outcome(a);
  assert.equal(out[0]?.body.status, 'verified', label);
  assert.equal(out[0]?.body.winnerSeat, 0, label);
  assert.deepEqual(plain(out[0]!.body.paid), {}, `${label} pays 0 T`);
  assert.equal(a.payRows.length, 0, `${label} skips the sproto_pvp_result cap insert`);
  assert.equal(a.earns.length, 0, `${label} does not call earn`);
  assert.equal(a.wins.length, 1, `${label} records the win once`);
  a.m.loop([
    { sender: a.host, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
    { sender: a.guest, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } },
  ]);
  assert.equal(a.payRows.length, 0, label);
  assert.equal(a.earns.length, 0, label);
  assert.equal(a.wins.length, 1, `${label} replay does not record a second win or mint`);
}

// Pay only for ranked "1". Omitted, empty, "0", and any other value stay 0 T.
{
  const omitted = start();
  agreeSeat0(omitted);
  expectUnpaid(omitted, 'omitted ranked');
  for (const ranked of ['', '0', '2']) {
    const a = start({ ranked });
    agreeSeat0(a);
    expectUnpaid(a, `ranked ${JSON.stringify(ranked)}`);
  }
}

console.log('sproto_arena tests ok');
