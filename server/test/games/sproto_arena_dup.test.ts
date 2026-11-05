// Duplication and economy safety for Sproto Duel quick-match (matchmaking slice A).
// Accept-window endings, idempotent pair create, one queue row per user, rematch,
// and one sproto_wins post per decided match. Handshake coverage stays in
// sproto_arena.test.ts.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const SID_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const SID_C = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const OP = {
  START: 2, INPUT: 10, SNAPSHOT: 11, ROUND: 12, RESULT: 13, OUTCOME: 14, FORFEIT: 18,
  ACCEPT: 19, DECLINE: 20, ACCEPT_END: 22, REMATCH: 23, REMATCH_STATE: 24,
};
const TICK = 30;
const V = '2';
const QUEUE_N = 'sproto:queue:n';

const vars = (sid: string) => ({ scope: 'game', game: 'sproto', sid });

interface EndBody { status: string; bySeat: number | null; next: string }
interface RematchBody { phase: string; waitS?: number; seat?: number; matchId?: string; reason?: string; next?: string }
interface StartBody { seat: number; hostSeat: number }
interface OutcomeBody { status: string; winnerSeat: number | null; paid: Record<string, number> }
interface Economy {
  earns: unknown[][];
  wins: unknown[][];
  payRows: unknown[][];
}
interface Fight extends Economy {
  mod: LoadedModule;
  m: MatchDriver;
  id: string;
  pa: Presence;
  pb: Presence;
  host: Presence;
  guest: Presence;
  hostSeat: number;
}
interface StorageWrite {
  collection: string;
  key: string;
  userId: string;
  value: Record<string, unknown>;
  version?: string;
}

function spies(mod: LoadedModule): Economy {
  const earns: unknown[][] = [];
  const wins: unknown[][] = [];
  const payRows: unknown[][] = [];
  mod.nk.onSql('game.sproto_pvp_result', (args) => {
    payRows.push(args);
    return [{ paid: true }];
  });
  mod.nk.onSql('game.earn_tickets', (args) => {
    earns.push(args);
    return [{ result: JSON.stringify({ balance: 120, capped: false }) }];
  });
  mod.nk.onSql('game.win_record', (args) => {
    wins.push(args);
    return [{ result: JSON.stringify({ recorded: true, value: 1 }) }];
  });
  return { earns, wins, payRows };
}

function ledgerCalls(mod: LoadedModule): number {
  return mod.nk.sqlCalls.filter((call) => call.sql.includes('tickets_ledger')).length;
}

function assertQuiet(eco: Economy, mod: LoadedModule, ledgerAt: number, label: string): void {
  assert.equal(eco.payRows.length, 0, `${label}: no result row`);
  assert.equal(eco.earns.length, 0, `${label}: no payout`);
  assert.equal(ledgerCalls(mod) - ledgerAt, 0, `${label}: no ledger row`);
  assert.equal(eco.wins.length, 0, `${label}: no sproto_wins`);
}

function arenaIds(mod: LoadedModule): string[] {
  const ids: string[] = [];
  for (const [id, match] of mod.nk.matches) if (match.module === 'sproto_arena') ids.push(id);
  return ids;
}

function queuedCount(mod: LoadedModule): number {
  const n = mod.nk.localcache.get(QUEUE_N);
  return typeof n === 'number' ? n : 0;
}

function queueKeys(mod: LoadedModule, userId: string): string[] {
  const exact = `sproto_mm/queue/${userId}`;
  return [...mod.nk.storage.keys()].filter((key) => key === exact);
}

function queueSession(mod: LoadedModule, userId: string): string {
  const row = mod.nk.storage.get(`sproto_mm/queue/${userId}`);
  assert.ok(row, 'queue row');
  return String(row.value.sessionId || '');
}

interface StreamProbe {
  streamUserGet(userId: string, sessionId: string, stream: { mode: number; subject: string } | null): { userId: string; sessionId: string } | null;
}

/** Notifications stream (mode 0). A socket drop is leaving this set. */
function openSockets(mod: LoadedModule): { connect(p: Presence): void; drop(p: Presence): void } {
  const live = new Set<string>();
  const id = (userId: string, sessionId: string) => `${userId}/${sessionId}`;
  (mod.nk as unknown as StreamProbe).streamUserGet = (userId, sessionId, stream) => {
    if (!stream || stream.mode !== 0 || stream.subject !== userId) return null;
    return live.has(id(userId, sessionId)) ? { userId, sessionId } : null;
  };
  return {
    connect(p) { live.add(id(p.userId, p.sessionId)); },
    drop(p) { live.delete(id(p.userId, p.sessionId)); },
  };
}

function queueAdd(mod: LoadedModule, p: Presence, sid: string): void {
  mod.rtBefore('MatchmakerAdd', {
    userId: p.userId,
    username: p.username,
    sessionId: p.sessionId,
    vars: vars(sid),
  }, {
    matchmakerAdd: {
      minCount: 2,
      maxCount: 2,
      query: '+properties.game:sproto +properties.v:2',
      stringProperties: { game: 'sproto', v: V },
    },
  });
}

function pairProps(p: Presence, ticket?: string): { presence: Presence; properties: Record<string, string>; ticket?: string } {
  return ticket
    ? { presence: p, properties: { game: 'sproto', v: V }, ticket }
    : { presence: p, properties: { game: 'sproto', v: V } };
}

function matchmake(mod: LoadedModule, entries: { presence: Presence; properties: Record<string, string>; ticket?: string }[]): string | undefined {
  return mod.matchmake(entries);
}

function seated(): Economy & { mod: LoadedModule; m: MatchDriver; id: string; pa: Presence; pb: Presence } {
  const mod = loadModule();
  const eco = spies(mod);
  const pa = presence(A, 'alice', 'seat-a');
  const pb = presence(B, 'bob', 'seat-b');
  const id = matchmake(mod, [pairProps(pa), pairProps(pb)]);
  assert.ok(id, 'pair creates one match');
  const m = mod.driver(id);
  assert.equal(m.join([pa], { vars: vars(SID_A) })[0]?.accept, true);
  assert.equal(m.join([pb], { vars: vars(SID_B) })[0]?.accept, true);
  return { mod, m, id, pa, pb, ...eco };
}

function ends(m: MatchDriver): { body: EndBody; to: Presence[] | null }[] {
  return m.dispatcher.sent<EndBody>(OP.ACCEPT_END);
}

function toUser(list: { body: EndBody; to: Presence[] | null }[], userId: string): EndBody | undefined {
  return list.find((row) => row.to?.[0]?.userId === userId)?.body;
}

function fight(): Fight {
  const mod = loadModule();
  const eco = spies(mod);
  mod.nk.accounts.set(A, { user: { userId: A, username: 'guest-alice' } });
  mod.nk.accounts.set(B, { user: { userId: B, username: 'bob' }, email: 'bob@example.com' });
  const pa = presence(A, 'guest-alice', 'fight-a');
  const pb = presence(B, 'bob', 'fight-b');
  const id = matchmake(mod, [pairProps(pa), pairProps(pb)]);
  assert.ok(id);
  const m = mod.driver(id);
  assert.equal(m.join([pa], { vars: vars(SID_A) })[0]?.accept, true);
  assert.equal(m.join([pb], { vars: vars(SID_B) })[0]?.accept, true);
  m.loop([
    { sender: pa, opCode: OP.ACCEPT, data: { v: V, staff: 'duel_staff_nobu' } },
    { sender: pb, opCode: OP.ACCEPT, data: { v: V, staff: 'duel_staff_sproto' } },
  ]);
  const starts = m.dispatcher.sent<StartBody>(OP.START);
  assert.equal(starts.length, 2, 'both seats ACCEPT before START');
  const hostSeat = starts[0]!.body.hostSeat;
  const host = hostSeat === 0 ? pa : pb;
  const guest = hostSeat === 0 ? pb : pa;
  m.dispatcher.clear();
  return { mod, m, id, pa, pb, host, guest, hostSeat, ...eco };
}

function play(f: Fight, seconds: number): void {
  for (let i = 0; i < seconds * TICK; i++) {
    f.m.loop([
      { sender: f.guest, opCode: OP.INPUT, data: '{"t":1,"f":[]}' },
      { sender: f.host, opCode: OP.SNAPSHOT, data: '{"v":1}' },
    ]);
  }
}

function outcome(f: Fight): { body: OutcomeBody }[] {
  return f.m.dispatcher.sent<OutcomeBody>(OP.OUTCOME);
}

function assertOneBoardRow(f: Fight, userId: string): void {
  assert.equal(f.wins.length, 1, 'one sproto_wins post');
  assert.equal(f.wins[0]?.[0], f.id);
  assert.equal(f.wins[0]?.[1], userId);
  assert.equal(f.wins[0]?.[2], 'sproto_wins');
  assert.equal(f.wins[0]?.length, 3, 'the board row carries no ticket amount');
}

function replayResult(f: Fight, body: { winnerSeat: number; wins: number[]; rounds: number }): void {
  const wins = f.wins.length;
  const earns = f.earns.length;
  f.m.loop([
    { sender: f.pa, opCode: OP.RESULT, data: body },
    { sender: f.pb, opCode: OP.RESULT, data: body },
  ]);
  assert.equal(f.wins.length, wins, 'replaying RESULT does not post sproto_wins again');
  assert.equal(f.earns.length, earns, 'replaying RESULT does not mint');
}

const passed: string[] = [];
const failed: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

check('(a) decline ends with no economy write', () => {
  const s = seated();
  const ledgerAt = ledgerCalls(s.mod);
  s.m.loop([{ sender: s.pb, opCode: OP.DECLINE, data: {} }]);
  const sent = ends(s.m);
  const decliner = toUser(sent, B);
  const other = toUser(sent, A);
  assert.equal(decliner?.status, 'declined');
  assert.equal(decliner?.bySeat, 1);
  assert.equal(decliner?.next, 'lobby');
  assert.equal(other?.status, 'declined');
  assert.equal(other?.bySeat, 1);
  assert.equal(other?.next, 'queue');
  assert.equal(s.m.dispatcher.sent(OP.OUTCOME).length, 0);
  assertQuiet(s, s.mod, ledgerAt, 'decline');
  assert.deepEqual(arenaIds(s.mod), [s.id]);
});

check('(a) leave ends with no economy write', () => {
  const s = seated();
  const ledgerAt = ledgerCalls(s.mod);
  s.m.leave([s.pa]);
  const sent = ends(s.m);
  assert.equal(toUser(sent, A), undefined, 'the leaver has already dropped');
  const stayer = toUser(sent, B);
  assert.equal(stayer?.status, 'declined');
  assert.equal(stayer?.bySeat, 0);
  assert.equal(stayer?.next, 'queue');
  assert.equal(s.m.joinAttempt(s.pa, { vars: vars(SID_A) }).rejectMessage, 'declined');
  assert.equal(s.m.dispatcher.sent(OP.OUTCOME).length, 0);
  assertQuiet(s, s.mod, ledgerAt, 'leave');
  assert.deepEqual(arenaIds(s.mod), [s.id]);
});

check('(a) accept timeout ends with no economy write', () => {
  const s = seated();
  const ledgerAt = ledgerCalls(s.mod);
  s.m.loop([{ sender: s.pa, opCode: OP.ACCEPT, data: { v: V, staff: 'duel_staff_nobu' } }]);
  assert.equal(s.m.ticks(299), true);
  assert.equal(ends(s.m).length, 0, 'the window is still open at 10s');
  assert.equal(s.m.ticks(1), true);
  const sent = ends(s.m);
  const acceptor = toUser(sent, A);
  const waiting = toUser(sent, B);
  assert.equal(acceptor?.status, 'accept_timeout');
  assert.equal(acceptor?.bySeat, null);
  assert.equal(acceptor?.next, 'queue');
  assert.equal(waiting?.status, 'accept_timeout');
  assert.equal(waiting?.bySeat, null);
  assert.equal(waiting?.next, 'lobby');
  s.m.ticks(5);
  assert.equal(ends(s.m).length, sent.length, 'the timeout posts once');
  assert.equal(s.m.dispatcher.sent(OP.OUTCOME).length, 0);
  assertQuiet(s, s.mod, ledgerAt, 'accept timeout');
  assert.deepEqual(arenaIds(s.mod), [s.id]);
});

check('(b) a second create for the same pair returns the same match', () => {
  const mod = loadModule();
  const pa = presence(A, 'alice', 'pair-a');
  const pb = presence(B, 'bob', 'pair-b');
  const first = matchmake(mod, [pairProps(pa), pairProps(pb)]);
  const reversed = matchmake(mod, [pairProps(pb), pairProps(pa)]);
  assert.ok(first);
  assert.equal(reversed, first);
  assert.deepEqual(arenaIds(mod), [first]);
});

check('(b) the same tickets create one match', () => {
  const mod = loadModule();
  const first = matchmake(mod, [
    pairProps(presence(A, 'alice', 'ticket-a1'), 'ta'),
    pairProps(presence(B, 'bob', 'ticket-b1'), 'tb'),
  ]);
  const again = matchmake(mod, [
    pairProps(presence(B, 'bob', 'ticket-b2'), 'tb'),
    pairProps(presence(A, 'alice', 'ticket-a2'), 'ta'),
  ]);
  assert.ok(first);
  assert.equal(again, first);
  assert.deepEqual(arenaIds(mod), [first]);
});

check('(c) a second tab is already queued and a joined seat is already in a match', () => {
  const mod = loadModule();
  const sockets = openSockets(mod);
  const tab1 = presence(A, 'alice', 'tab-1');
  const tab2 = presence(A, 'alice', 'tab-2');
  sockets.connect(tab1);
  sockets.connect(tab2);
  queueAdd(mod, tab1, SID_A);
  assert.throws(() => queueAdd(mod, tab2, SID_A), /already_queued/);
  assert.equal(queueKeys(mod, A).length, 1);
  assert.equal(queuedCount(mod), 1);
  assert.deepEqual(arenaIds(mod), []);

  const partner = presence(B, 'bob', 'tab-b');
  const id = matchmake(mod, [pairProps(tab1), pairProps(partner)]);
  assert.ok(id);
  assert.throws(() => queueAdd(mod, tab2, SID_A), /already_in_match/);
  assert.equal(matchmake(mod, [pairProps(tab1), pairProps(presence(C, 'cara', 'tab-c'))]), undefined);
  assert.deepEqual(arenaIds(mod), [id]);

  const room = mod.call<{ matchId: string }>('sproto.room_create', {
    userId: C, username: 'cara', sessionId: 'tab-c', vars: vars(SID_C),
  }, { v: V });
  const afterRoom = arenaIds(mod).slice().sort();
  const verdict = mod.driver(room.matchId).joinAttempt(tab1, { vars: vars(SID_A) });
  assert.equal(verdict.rejectMessage, 'already_in_match');
  assert.deepEqual(arenaIds(mod).slice().sort(), afterRoom);
  assert.equal(queueKeys(mod, A).length, 0, 'joining the first match did not leave a second queue row');
});

check('(d) both rematch yes answers create one match with the same seats', () => {
  const f = fight();
  f.m.loop([{ sender: f.pb, opCode: OP.FORFEIT, data: {} }]);
  const wins = f.wins.length;
  const earns = f.earns.length;
  const before = arenaIds(f.mod);
  f.m.loop([
    { sender: f.pa, opCode: OP.REMATCH, data: { yes: true } },
    { sender: f.pb, opCode: OP.REMATCH, data: { yes: true } },
    { sender: f.pa, opCode: OP.REMATCH, data: { yes: true } },
    { sender: f.pb, opCode: OP.REMATCH, data: { yes: true } },
  ]);
  const created = arenaIds(f.mod).filter((id) => !before.includes(id));
  assert.equal(created.length, 1);
  const started = f.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).filter((row) => row.body.phase === 'started');
  assert.ok(started.length >= 1);
  assert.ok(started.every((row) => row.body.matchId === created[0]));
  const oldPlayers = plain((f.m.state as { players: string[] }).players);
  const neu = f.mod.driver(created[0]!);
  assert.deepEqual(plain((neu.state as { players: string[] }).players), oldPlayers);
  assert.equal(f.wins.length, wins, 'creating the rematch posts no board row');
  assert.equal(f.earns.length, earns, 'creating the rematch mints nothing');
});

check('(d) one seat repeating yes, or both racing, does not create two matches', () => {
  const f = fight();
  f.m.loop([{ sender: f.pb, opCode: OP.FORFEIT, data: {} }]);
  const before = arenaIds(f.mod).length;
  f.m.loop([
    { sender: f.pa, opCode: OP.REMATCH, data: { yes: true } },
    { sender: f.pa, opCode: OP.REMATCH, data: { yes: true } },
  ]);
  assert.equal(arenaIds(f.mod).length, before, 'one seat answering twice creates nothing');
  f.m.loop([{ sender: f.pb, opCode: OP.REMATCH, data: { yes: true } }]);
  assert.equal(arenaIds(f.mod).length, before + 1);
  f.m.loop([
    { sender: f.pa, opCode: OP.REMATCH, data: { yes: true } },
    { sender: f.pb, opCode: OP.REMATCH, data: { yes: true } },
  ]);
  assert.equal(arenaIds(f.mod).length, before + 1);
});

check('(d) a rematch decline or leave closes to the lobby with no new match', () => {
  const declined = fight();
  declined.m.loop([{ sender: declined.pb, opCode: OP.FORFEIT, data: {} }]);
  declined.m.loop([{ sender: declined.pa, opCode: OP.REMATCH, data: { yes: false } }]);
  const closed = declined.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body;
  assert.equal(closed?.phase, 'closed');
  assert.equal(closed?.reason, 'declined');
  assert.equal(closed?.next, 'lobby');
  assert.equal(arenaIds(declined.mod).length, 1);

  const left = fight();
  left.m.loop([{ sender: left.pb, opCode: OP.FORFEIT, data: {} }]);
  left.m.loop([{ sender: left.pa, opCode: OP.REMATCH, data: { yes: true } }]);
  left.m.leave([left.pb]);
  const bye = left.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body;
  assert.equal(bye?.phase, 'closed');
  assert.equal(bye?.reason, 'declined');
  assert.equal(bye?.next, 'lobby');
  assert.equal(arenaIds(left.mod).length, 1);
});

check('(d) a rematch timeout closes to the lobby with no new match', () => {
  const idle = fight();
  idle.m.loop([{ sender: idle.pb, opCode: OP.FORFEIT, data: {} }]);
  const openedAt = (idle.m.state as { rematchSince: number }).rematchSince;
  assert.equal(idle.m.ticks(openedAt + 15 * TICK - idle.m.match.tick), true);
  assert.equal(idle.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body.phase, 'open');
  assert.equal(idle.m.ticks(1), true);
  const timed = idle.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body;
  assert.equal(timed?.phase, 'closed');
  assert.equal(timed?.reason, 'rematch_timeout');
  assert.equal(timed?.next, 'lobby');
  assert.equal(arenaIds(idle.mod).length, 1);

  const offered = fight();
  offered.m.loop([{ sender: offered.pb, opCode: OP.FORFEIT, data: {} }]);
  offered.m.loop([{ sender: offered.pa, opCode: OP.REMATCH, data: { yes: true } }]);
  const offerAt = (offered.m.state as { rematchSince: number }).rematchSince;
  assert.equal(offerAt, offered.m.match.tick, 'the offer restarts the 15s clock');
  assert.equal(offered.m.ticks(15 * TICK), true);
  assert.notEqual(offered.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body.phase, 'closed');
  assert.equal(offered.m.ticks(1), true);
  const expired = offered.m.dispatcher.sent<RematchBody>(OP.REMATCH_STATE).at(-1)?.body;
  assert.equal(expired?.phase, 'closed');
  assert.equal(expired?.reason, 'rematch_timeout');
  assert.equal(expired?.next, 'lobby');
  assert.equal(arenaIds(offered.mod).length, 1);
});

check('(e) a verified guest win posts one sproto_wins row and a replay does not mint', () => {
  const f = fight();
  const result = { winnerSeat: 0, wins: [2, 0], rounds: 2 };
  play(f, 10);
  f.m.loop([{ sender: f.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] } }]);
  play(f, 10);
  f.m.loop([{ sender: f.host, opCode: OP.ROUND, data: { round: 2, winnerSeat: 0, reason: 'time', wins: [2, 0] } }]);
  f.m.loop([
    { sender: f.host, opCode: OP.RESULT, data: result },
    { sender: f.guest, opCode: OP.RESULT, data: result },
    { sender: f.host, opCode: OP.RESULT, data: result },
    { sender: f.guest, opCode: OP.RESULT, data: result },
  ]);
  const out = outcome(f);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.body.status, 'verified');
  assert.equal(out[0]?.body.winnerSeat, 0);
  assertOneBoardRow(f, A);
  assert.equal(f.earns.length, 1, 'the paid win mints once');
  assert.equal(f.earns[0]?.[0], A);
  assert.equal(f.earns[0]?.[3], 20);
  assert.equal(f.earns[0]?.[4], 'srv_pvp_win');
  assert.equal(f.payRows.length, 1);
  replayResult(f, result);
  assert.equal(outcome(f).length, 1);
});

check('(e) a quick forfeit, including a guest winner, posts one row at 0 T', () => {
  const f = fight();
  f.m.loop([{ sender: f.pb, opCode: OP.FORFEIT, data: {} }]);
  const out = outcome(f);
  assert.equal(out[0]?.body.status, 'forfeit');
  assert.equal(out[0]?.body.winnerSeat, 0);
  assert.deepEqual(plain(out[0]?.body.paid), {});
  assertOneBoardRow(f, A);
  assert.equal(f.earns.length, 0, 'a quick forfeit mints nothing');
  assert.equal(f.payRows.length, 0, 'a quick forfeit writes no result row');
  f.m.loop([{ sender: f.pb, opCode: OP.FORFEIT, data: {} }]);
  f.m.loop([{ sender: f.pa, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [2, 0], rounds: 2 } }]);
  assert.equal(f.wins.length, 1);
  assert.equal(f.earns.length, 0);
});

check('(e) a forfeit after a round posts one row and a replay does not mint', () => {
  const f = fight();
  play(f, 16);
  f.m.loop([{ sender: f.host, opCode: OP.ROUND, data: { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] } }]);
  f.m.leave([f.pb]);
  assert.equal(f.m.ticks(9 * TICK), true);
  assert.equal(outcome(f).length, 0);
  assert.equal(f.m.ticks(2 * TICK), true);
  const out = outcome(f);
  assert.equal(out[0]?.body.status, 'forfeit');
  assert.equal(out[0]?.body.winnerSeat, 0);
  assertOneBoardRow(f, A);
  assert.equal(f.earns.length, 1);
  assert.equal(f.earns[0]?.[3], 20);
  assert.equal(f.earns[0]?.[4], 'srv_pvp_win');
  const earns = f.earns.length;
  const wins = f.wins.length;
  f.m.loop([{ sender: f.pa, opCode: OP.RESULT, data: { winnerSeat: 0, wins: [1, 0], rounds: 1 } }]);
  assert.equal(f.wins.length, wins);
  assert.equal(f.earns.length, earns, 'retrying the forfeit result does not mint');
});

check('(f) a dropped socket re-queues immediately with one row and the same queued count', () => {
  const mod = loadModule();
  const sockets = openSockets(mod);
  const dropped = presence(A, 'alice', 'sock-old');
  const again = presence(A, 'alice', 'sock-new');
  sockets.connect(dropped);
  queueAdd(mod, dropped, SID_A);
  assert.equal(queuedCount(mod), 1);
  assert.equal(queueSession(mod, A), dropped.sessionId);
  sockets.drop(dropped);
  sockets.connect(again);
  queueAdd(mod, again, SID_A);
  assert.equal(queueKeys(mod, A).length, 1);
  assert.equal(queueSession(mod, A), again.sessionId);
  assert.equal(queuedCount(mod), 1, 'replacing a dead row does not count a second ticket');
  assert.deepEqual(arenaIds(mod), []);
  const partner = presence(B, 'bob', 'sock-b');
  const id = matchmake(mod, [pairProps(again), pairProps(partner)]);
  const repeat = matchmake(mod, [pairProps(again), pairProps(partner)]);
  assert.ok(id);
  assert.equal(repeat, id);
  assert.deepEqual(arenaIds(mod), [id]);
});

check('(g) two live sockets racing yield one queue row and no second match', () => {
  const mod = loadModule();
  const sockets = openSockets(mod);
  const first = presence(A, 'alice', 'live-1');
  const second = presence(A, 'alice', 'live-2');
  sockets.connect(first);
  sockets.connect(second);
  const store = mod.nk as unknown as { storageWrite(objects: StorageWrite[]): unknown };
  const orig = store.storageWrite.bind(store);
  let secondResult = 'not-run';
  store.storageWrite = (objects: StorageWrite[]) => {
    const creating = objects.some((row) => row.version === '*' && row.key === 'queue' && row.userId === A);
    if (creating && secondResult === 'not-run') {
      secondResult = 'running';
      queueAdd(mod, second, SID_A);
      secondResult = 'ok';
    }
    return orig(objects);
  };
  try {
    assert.throws(() => queueAdd(mod, first, SID_A), /already_queued/);
  } finally {
    store.storageWrite = orig;
  }
  assert.equal(secondResult, 'ok', 'one of the two racing adds succeeds');
  assert.equal(queueKeys(mod, A).length, 1);
  assert.equal(queueSession(mod, A), second.sessionId);
  assert.equal(queuedCount(mod), 1);
  assert.deepEqual(arenaIds(mod), []);
  const partner = presence(B, 'bob', 'live-b');
  const id = matchmake(mod, [pairProps(second), pairProps(partner)]);
  const repeat = matchmake(mod, [pairProps(partner), pairProps(second)]);
  assert.ok(id);
  assert.equal(repeat, id);
  assert.deepEqual(arenaIds(mod), [id]);
});

check('(g) re-adding from the same socket is idempotent', () => {
  const mod = loadModule();
  const sockets = openSockets(mod);
  const sock = presence(A, 'alice', 'same-sock');
  sockets.connect(sock);
  queueAdd(mod, sock, SID_A);
  const version = mod.nk.storage.get(`sproto_mm/queue/${A}`)?.version;
  assert.throws(() => queueAdd(mod, sock, SID_A), /already_queued/);
  sockets.drop(sock);
  assert.throws(() => queueAdd(mod, sock, SID_A), /already_queued/);
  assert.equal(queueKeys(mod, A).length, 1);
  assert.equal(queueSession(mod, A), sock.sessionId);
  assert.equal(queuedCount(mod), 1);
  assert.equal(mod.nk.storage.get(`sproto_mm/queue/${A}`)?.version, version);
  assert.deepEqual(arenaIds(mod), []);
});

if (failed.length) {
  throw new Error(`${failed.length} dup case(s) failed: ${failed.join(', ')}`);
}
console.log(`sproto_arena dup ok (${passed.length} cases)`);
