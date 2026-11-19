// Sproto Arcade 2P co-op relay (protocol v1): rooms, start barrier, input relay, hash checks,
// grace and seat drop, and the server-settled clear reward.
import assert from 'node:assert/strict';
import { loadModule, presence, type Presence } from '../unit/harness';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const P = (n: number): Presence => presence(uid(n), `p${n}`, `sess-${n}`);
const GAME = (n: number) => ({ userId: uid(n), vars: { scope: 'game', game: 'sproto-arcade', sid: sid(n) } });
const OP = { HELLO: 1, LOBBY: 2, START: 3, READY: 4, GO: 5, INPUT: 10, HASH: 11, DESYNC: 12, SNAPSHOT: 13, RESULT: 14, OUTCOME: 15, PEER: 16, SEAT_DROP: 17, PING: 18, CANCEL: 19 };

function setup() {
  const mod = loadModule();
  const earns: unknown[][] = [];
  const events: unknown[][] = [];
  mod.nk.onSql(/game\.earn_tickets/, (args) => {
    earns.push(args);
    return [{ result: JSON.stringify({ balance: 20, capped: false }) }];
  });
  mod.nk.onSql(/game\.apply_event/, (args) => {
    events.push(args);
    return [{ result: JSON.stringify({ granted: 'breakwater_coin' }) }];
  });
  return { mod, earns, events };
}

/** Create a code room on `level`, seat players 1 and 2, HELLO, READY, GO. */
function started(level = 1) {
  const env = setup();
  const room = env.mod.call<{ match_id: string; code: string }>('arcade.coop_create', GAME(1), { level, pilot: 'sproto' });
  assert.match(room.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  const joined = env.mod.call<{ match_id: string }>('arcade.coop_join', GAME(2), { code: room.code.toLowerCase() });
  assert.equal(joined.match_id, room.match_id, 'codes are case-insensitive');
  const m = env.mod.driver(room.match_id);
  assert.equal(m.join([P(1)], GAME(1))[0]!.accept, true);
  assert.equal(m.join([P(2)], GAME(2))[0]!.accept, true);
  m.dispatcher.clear();
  m.loop([{ sender: P(1), opCode: OP.HELLO, data: { v: 1, pilot: 'sproto', level } }]);
  assert.equal(m.dispatcher.sent(OP.START).length, 0, 'no START until both seats said HELLO');
  m.loop([{ sender: P(2), opCode: OP.HELLO, data: { v: 1, pilot: 'goldie', level } }]);
  const starts = m.dispatcher.sent<{ levelIndex: number; pilots: string[]; seed: number; seat: number; names: string[] }>(OP.START);
  assert.equal(starts.length, 2);
  assert.equal(starts[0]!.body.seed, starts[1]!.body.seed, 'one seed for both');
  assert.ok(Number.isInteger(starts[0]!.body.seed) && starts[0]!.body.seed >= 0 && starts[0]!.body.seed <= 0xffffffff);
  assert.deepEqual(starts.map((s) => s.body.seat).sort(), [0, 1]);
  assert.deepEqual(starts[0]!.body.pilots, ['sproto', 'goldie']);
  assert.equal(starts[0]!.body.levelIndex, level - 1);
  m.loop([{ sender: P(1), opCode: OP.READY, data: {} }]);
  assert.equal(m.dispatcher.sent(OP.GO).length, 0, 'no GO until both seats are READY');
  m.loop([{ sender: P(2), opCode: OP.READY, data: {} }]);
  assert.equal(m.dispatcher.sent(OP.GO).length, 1);
  m.dispatcher.clear();
  return { ...env, m, room };
}

/** Both seats send `ticks` frames, `active` of them non-zero, in chunks of 2. */
function play(m: ReturnType<typeof started>['m'], ticks: number, activeSeat1 = ticks, activeSeat2 = ticks) {
  for (let from = 0; from < ticks; from += 2) {
    const frames = (active: number) => [from, from + 1].map((t) => (t < active ? 5 : 0));
    m.loop([
      { sender: P(1), opCode: OP.INPUT, data: { seat: 1, from, frames: frames(activeSeat1) } },
      { sender: P(2), opCode: OP.INPUT, data: { seat: 0, from, frames: frames(activeSeat2) } },
    ]);
  }
}

// Rooms: create / join / full / not_found / wrong scope / quick.
{
  const { mod } = setup();
  assert.equal(mod.call<{ error: string }>('arcade.coop_create', { userId: uid(1), vars: { scope: 'hub' } }, { level: 1 }).error, 'wrong_scope');
  assert.equal(mod.call<{ error: string }>('arcade.coop_create', GAME(1), { level: 15 }).error, 'bad_level');
  assert.equal(mod.call<{ error: string }>('arcade.coop_join', GAME(2), { code: 'ZZZZZ' }).error, 'not_found');
  const room = mod.call<{ match_id: string; code: string }>('arcade.coop_create', GAME(1), { level: 3, pilot: 'sproto' });
  const m = mod.driver(room.match_id);
  m.join([P(1)], GAME(1));
  m.join([P(2)], GAME(2));
  assert.equal(mod.call<{ error: string }>('arcade.coop_join', GAME(3), { code: room.code }).error, 'full');
  assert.equal(m.joinAttempt(P(3), GAME(3)).rejectMessage, 'full');
  assert.equal(m.joinAttempt(P(4), { userId: uid(4), vars: { scope: 'game', game: 'nobu', sid: sid(4) } }).rejectMessage, 'wrong_scope');

  const q1 = mod.call<{ match_id: string }>('arcade.coop_quick', GAME(5), { level: 2, pilot: 'sproto' });
  const qm = mod.driver(q1.match_id);
  qm.join([P(5)], GAME(5));
  const q2 = mod.call<{ match_id: string }>('arcade.coop_quick', GAME(6), { level: 2, pilot: 'sproto' });
  assert.equal(q2.match_id, q1.match_id, 'quick finds the open room on that level');
  const q3 = mod.call<{ match_id: string }>('arcade.coop_quick', GAME(7), { level: 4, pilot: 'sproto' });
  assert.notEqual(q3.match_id, q1.match_id, 'another level gets its own room');
}

// HELLO with another protocol version is refused.
{
  const { mod } = setup();
  const room = mod.call<{ match_id: string }>('arcade.coop_create', GAME(1), { level: 1 });
  const m = mod.driver(room.match_id);
  m.join([P(1)], GAME(1));
  m.dispatcher.clear();
  m.loop([{ sender: P(1), opCode: OP.HELLO, data: { v: 2, pilot: 'sproto', level: 1 } }]);
  assert.equal(m.dispatcher.sent<{ reason: string }>(OP.CANCEL)[0]!.body.reason, 'version_mismatch');
}

// Relay: the seat comes from the presence, frames go to the other seat only; PING echoes.
{
  const { m } = started();
  m.loop([{ sender: P(1), opCode: OP.INPUT, data: { seat: 1, from: 0, frames: [3, 0] } }]);
  const relayed = m.dispatcher.sent<{ seat: number; from: number; frames: number[] }>(OP.INPUT);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0]!.body.seat, 0, 'the client-claimed seat is ignored');
  assert.deepEqual(relayed[0]!.body.frames, [3, 0]);
  assert.equal(relayed[0]!.to!.length, 1);
  assert.equal(relayed[0]!.to![0]!.userId, uid(2));
  m.dispatcher.clear();
  m.loop([{ sender: P(1), opCode: OP.INPUT, data: { from: 2, frames: [1024] } }]);
  m.loop([{ sender: P(1), opCode: OP.INPUT, data: { from: -1, frames: [1] } }]);
  assert.equal(m.dispatcher.sent(OP.INPUT).length, 0, 'out-of-range frames and ticks are dropped');
  m.loop([{ sender: P(2), opCode: OP.PING, data: { c: 42 } }]);
  const pong = m.dispatcher.sent<{ c: number; s: number }>(OP.PING);
  assert.equal(pong[0]!.body.c, 42);
  assert.equal(pong[0]!.to![0]!.userId, uid(2));
}

// A full clear on level 1: 20 Tickets and the Coin for each account, once, through the single-player calls.
{
  const { m, earns, events } = started(1);
  play(m, 120);
  m.loop([
    { sender: P(1), opCode: OP.HASH, data: { tick: 60, hash: 'abc' } },
    { sender: P(2), opCode: OP.HASH, data: { tick: 60, hash: 'abc' } },
  ]);
  assert.equal(m.dispatcher.sent(OP.DESYNC).length, 0);
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 1, tick: 120, god: false } }]);
  assert.equal(earns.length, 0, 'nothing is paid until both seats report');
  m.loop([{ sender: P(2), opCode: OP.RESULT, data: { status: 'clear', level: 1, tick: 120, god: false } }]);
  const outcomes = m.dispatcher.sent<{ status: string; rewards: { tickets: number; relics: string[] } }>(OP.OUTCOME);
  assert.equal(outcomes.length, 2);
  for (const o of outcomes) assert.deepEqual(o.body, { status: 'clear', rewards: { tickets: 20, relics: ['breakwater_coin'] } });
  assert.equal(earns.length, 2);
  for (const args of earns) {
    assert.equal(args[2], 'sproto-arcade');
    assert.equal(args[3], 20);
    assert.equal(args[4], 'arcade_clear', 'the single-player reason and ledger');
    assert.match(String(args[5]), /^arcade-coop:[0-9a-f]{16}:L1:clear$/, 'idempotency key scoped to the match');
  }
  assert.deepEqual(earns.map((a) => a[1]).sort(), [sid(1), sid(2)], 'each account through its own game session');
  assert.equal(events.length, 2);
  for (const args of events) {
    assert.equal(args[3], 'arcade.boss_defeated');
    assert.equal(args[4], JSON.stringify({ boss: 'bront' }));
  }
  // A repeated RESULT pays nothing more.
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 1, tick: 120, god: false } }]);
  assert.equal(earns.length, 2);
}

// Level 5: Tickets, no Relic. God mode, a missing god field, disagreement or a wipe pay nothing.
for (const [label, r1, r2, tickets] of [
  ['level 5 clear', { status: 'clear', level: 5, god: false }, { status: 'clear', level: 5, god: false }, 20],
  ['god mode', { status: 'clear', level: 5, god: true }, { status: 'clear', level: 5, god: false }, 0],
  ['god left out', { status: 'clear', level: 5 }, { status: 'clear', level: 5, god: false }, 0],
  ['disagree', { status: 'clear', level: 5, god: false }, { status: 'wipe', level: 5, god: false }, 0],
  ['wipe', { status: 'wipe', level: 5, god: false }, { status: 'wipe', level: 5, god: false }, 0],
  ['wrong level', { status: 'clear', level: 6, god: false }, { status: 'clear', level: 6, god: false }, 0],
] as const) {
  const { m, earns, events } = started(5);
  play(m, 60);
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { tick: 60, ...r1 } }]);
  m.loop([{ sender: P(2), opCode: OP.RESULT, data: { tick: 60, ...r2 } }]);
  const outcomes = m.dispatcher.sent<{ status: string; reason?: string; rewards: { tickets: number; relics: string[] } }>(OP.OUTCOME);
  assert.equal(outcomes.length, 2, label);
  for (const o of outcomes) assert.equal(o.body.rewards.tickets, tickets, label);
  assert.equal(events.length, 0, `${label}: no Relic off level 1`);
  assert.equal(earns.length, tickets ? 2 : 0, label);
}

// AFK: a seat with too few non-zero frames is not paid; its partner is.
{
  const { m, earns } = started(2);
  play(m, 100, 100, 30);
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 2, tick: 100, god: false } }]);
  m.loop([{ sender: P(2), opCode: OP.RESULT, data: { status: 'clear', level: 2, tick: 100, god: false } }]);
  const outcomes = m.dispatcher.sent<{ reason?: string; rewards: { tickets: number } }>(OP.OUTCOME);
  const forUser = (n: number) => outcomes.find((o) => o.to![0]!.userId === uid(n))!.body;
  assert.equal(forUser(1).rewards.tickets, 20);
  assert.equal(forUser(2).rewards.tickets, 0);
  assert.equal(forUser(2).reason, 'afk');
  assert.equal(earns.length, 1);
}

// Hash checks: a mismatch sends DESYNC, seat 0's snapshot reaches seat 1, three desyncs end the run unpaid.
{
  const { m, earns } = started(3);
  play(m, 60);
  m.loop([
    { sender: P(1), opCode: OP.HASH, data: { tick: 60, hash: 'aaa' } },
    { sender: P(2), opCode: OP.HASH, data: { tick: 60, hash: 'bbb' } },
  ]);
  assert.deepEqual(m.dispatcher.sent<{ tick: number; count: number }>(OP.DESYNC)[0]!.body, { tick: 60, count: 1 });
  m.dispatcher.clear();
  m.loop([{ sender: P(2), opCode: OP.SNAPSHOT, data: { tick: 60, state: { x: 1 } } }]);
  assert.equal(m.dispatcher.sent(OP.SNAPSHOT).length, 0, 'only seat 0 sends snapshots');
  m.loop([{ sender: P(1), opCode: OP.SNAPSHOT, data: { tick: 60, state: { x: 1 } } }]);
  const snap = m.dispatcher.sent<{ tick: number; state: { x: number } }>(OP.SNAPSHOT);
  assert.equal(snap[0]!.to![0]!.userId, uid(2));
  assert.deepEqual(snap[0]!.body, { tick: 60, state: { x: 1 } });
  for (const t of [120, 180]) {
    m.loop([
      { sender: P(1), opCode: OP.HASH, data: { tick: t, hash: 1 } },
      { sender: P(2), opCode: OP.HASH, data: { tick: t, hash: 2 } },
    ]);
  }
  const out = m.dispatcher.sent<{ status: string; reason: string }>(OP.OUTCOME);
  assert.equal(out[0]!.body.reason, 'desync');
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 3, tick: 200, god: false } }]);
  m.loop([{ sender: P(2), opCode: OP.RESULT, data: { status: 'clear', level: 3, tick: 200, god: false } }]);
  assert.equal(earns.length, 0, 'a run ended by desyncs pays nothing');
}

// A last checked tick that disagreed blocks the clear even without three desyncs.
{
  const { m, earns } = started(4);
  play(m, 60);
  m.loop([
    { sender: P(1), opCode: OP.HASH, data: { tick: 60, hash: 'x' } },
    { sender: P(2), opCode: OP.HASH, data: { tick: 60, hash: 'y' } },
  ]);
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 4, tick: 60, god: false } }]);
  m.loop([{ sender: P(2), opCode: OP.RESULT, data: { status: 'clear', level: 4, tick: 60, god: false } }]);
  assert.equal(m.dispatcher.sent<{ reason: string }>(OP.OUTCOME)[0]!.body.reason, 'desync');
  assert.equal(earns.length, 0);
}

// Grace: PEER on leave, rejoin within 15 s restores the seat; past it SEAT_DROP at last input + 10,
// and the seat still present settles alone.
{
  const { m, earns } = started(6);
  play(m, 40);
  m.leave([P(2)]);
  assert.deepEqual(m.dispatcher.sent<{ seat: number; present: boolean; graceS: number }>(OP.PEER).at(-1)!.body, { seat: 1, present: false, graceS: 15 });
  m.ticks(30);
  const back = { ...P(2), sessionId: 'sess-2b' };
  assert.equal(m.join([back], GAME(2))[0]!.accept, true);
  assert.equal(m.dispatcher.sent<{ present: boolean }>(OP.PEER).at(-1)!.body.present, true);
  assert.equal(m.dispatcher.sent<{ seat: number }>(OP.START).at(-1)!.body.seat, 1, 'the rejoiner gets its START again');
  m.leave([back]);
  m.dispatcher.clear();
  m.ticks(15 * 30);
  const drop = m.dispatcher.sent<{ seat: number; tick: number }>(OP.SEAT_DROP);
  assert.equal(drop.length, 1);
  assert.deepEqual(drop[0]!.body, { seat: 1, tick: 39 + 10 });
  assert.equal(drop[0]!.to![0]!.userId, uid(1));
  play(m, 80, 80, 0);
  m.loop([{ sender: P(1), opCode: OP.RESULT, data: { status: 'clear', level: 6, tick: 80, god: false } }]);
  assert.equal(m.dispatcher.sent<{ rewards: { tickets: number } }>(OP.OUTCOME)[0]!.body.rewards.tickets, 20);
  assert.equal(earns.length, 1, 'only the seat still present is paid');
  assert.equal(m.joinAttempt({ ...P(2), sessionId: 'sess-2c' }, GAME(2)).accept, false, 'a dropped seat cannot come back');
}

// Lobby: a leave frees the seat; an idle lobby is cancelled.
{
  const { mod } = setup();
  const room = mod.call<{ match_id: string; code: string }>('arcade.coop_create', GAME(1), { level: 1 });
  const m = mod.driver(room.match_id);
  m.join([P(1)], GAME(1));
  m.join([P(2)], GAME(2));
  m.leave([P(2)]);
  assert.equal(m.join([P(3)], GAME(3))[0]!.accept, true, 'a freed lobby seat takes a new player');
  m.dispatcher.clear();
  m.ticks(600 * 30);
  assert.equal(m.dispatcher.sent<{ reason: string }>(OP.CANCEL)[0]!.body.reason, 'lobby_timeout');
  assert.equal(mod.call<{ error: string }>('arcade.coop_join', GAME(4), { code: room.code }).error, 'not_found', 'the code is released');
}

console.log('arcade coop tests ok');
