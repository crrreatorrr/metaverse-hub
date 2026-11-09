// H4-S Shooter escrow. The flag stays off, so a stake in the free queue is still
// refused. With both flags on, the match holds 10 Tickets a seat before it goes
// live and closes that hold once from the director result. No client settle,
// winner, or refund RPC.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const FP = '17d87c54';
const OP = { HELLO: 1, READY: 4, RESULT: 8 };

interface Plan {
  op: string;
  reason: string;
  winnerSeat: number | null;
}

interface WagerApi {
  STAKE: number;
  POT: number;
  EXPIRE_AGE: string;
  SWEEP_EVERY_MS: number;
  plan(outcome: string, reason: string, winner: number | null, policy: string, verified: boolean): Plan;
  maybeSweep(nk: unknown, logger: unknown, nowMs: number): boolean;
  ruleText(): string;
  enabled(nk: unknown, userId: string, logger: unknown): boolean;
}

function game(userId: string, sessionId: string) {
  return { userId, sessionId, username: 'ada', vars: { scope: 'game', game: 'sproto-shooter', sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } };
}

function flags(args: unknown[]): Record<string, unknown>[] {
  const key = String(args[0] || '');
  if (key !== 'shooter_pvp' && key !== 'shooter_pvp_wager') return [];
  return [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 100 }) }];
}

function load(wager = false): LoadedModule {
  return loadModule({
    env: { HUB_FAULT_INJECT: '1', SHOOTER_PVP_REPLAY: '1' },
    clock: 1_800_000_000_000,
    jsonState: true,
    sql: wager ? [[/FROM game\.server_flags/, flags]] : [],
  });
}

function signIn(mod: LoadedModule, ...ids: string[]): void {
  for (const id of ids) mod.nk.accounts.set(id, { email: `${id.slice(0, 8)}@example.com`, user: { userId: id, username: 'player' } });
}

function sqls(mod: LoadedModule, name: string): { sql: string; args: unknown[] }[] {
  const prefix = `SELECT game.${name}`;
  return mod.nk.sqlCalls.filter((call) => call.sql.startsWith(prefix));
}

function hello(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.HELLO, data: { accountId: p.userId, protocol: 2, sim: 2, content: FP } }]);
}

function ready(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.READY, data: { accountId: p.userId } }]);
}

function wagerApi(mod: LoadedModule): WagerApi {
  return mod.global.ShooterWagers as WagerApi;
}

// The launch flag is off. Nothing in the free path calls the escrow.
{
  const mod = load();
  const api = wagerApi(mod);
  assert.equal(api.STAKE, 10);
  assert.equal(api.POT, 20);
  assert.equal(api.EXPIRE_AGE, '1200 seconds');
  assert.equal(api.enabled(mod.nk, A, mod.logger), false);
  const version = mod.call<{ wagerEnabled: boolean; stake: number; ticketsMinted: number }>('shooter.version', game(A, 'sa'), {});
  assert.equal(version.wagerEnabled, false);
  assert.equal(version.stake, 0);
  assert.equal(version.ticketsMinted, 0);
  const boot = sqls(mod, 'shooter_wager_expire');
  assert.equal(boot.length, 1);
  assert.match(boot[0]!.sql, /interval '0'/);
  assert.ok(mod.registered.matches.has('shooter_wager_sweep'));
  for (const id of mod.registered.rpcs.keys()) {
    assert.equal(/settle|refund|winner|wager/i.test(id), false, id);
  }
  const props = { game: 'sproto-shooter', mode: 'free', protocol: '2', sim: '2', content: FP };
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, stake: '10' } } }), /stakes_disabled/);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(A, 'sa'), { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { ...props, mode: 'wager', stake: '10' } } }), /stakes_disabled/);
  const created = mod.call<{ error?: string }>('shooter.room_create', game(A, 'sa'), { mode: 'wager' });
  assert.equal(created.error, 'stakes_disabled');
}

// Money plan: pay a verified KO or a consistent forfeit, and refund everything else.
{
  const plan = wagerApi(load()).plan;
  const money = (outcome: string, reason: string, winner: number | null, policy: string, verified: boolean) => plain(plan(outcome, reason, winner, policy, verified));
  assert.deepEqual(money('ko', 'ko', 1, 'settle', true), { op: 'settle', reason: 'ko', winnerSeat: 1 });
  assert.deepEqual(money('time', 'time', 0, 'settle', true), { op: 'settle', reason: 'time', winnerSeat: 0 });
  assert.deepEqual(money('forfeit', 'stall', 0, 'settle_director', true), { op: 'settle', reason: 'forfeit', winnerSeat: 0 });
  assert.deepEqual(money('forfeit', 'stall', 1, 'review', true), { op: 'refund', reason: 'replay_review', winnerSeat: null });
  assert.deepEqual(money('forfeit', 'stall', 0, 'settle_director', false), { op: 'refund', reason: 'replay_refuse', winnerSeat: null });
  assert.deepEqual(money('ko', 'ko', 0, 'settle', false), { op: 'refund', reason: 'replay_refuse', winnerSeat: null });
  assert.deepEqual(money('draw', 'double_ko', null, 'settle', true), { op: 'refund', reason: 'draw', winnerSeat: null });
  assert.deepEqual(money('draw', 'both_stall', null, 'refund', true), { op: 'refund', reason: 'both_absent', winnerSeat: null });
  assert.deepEqual(money('draw', 'time', null, 'refuse', false), { op: 'refund', reason: 'draw', winnerSeat: null });
  assert.deepEqual(money('cancel', 'ready_timeout', null, 'refund', true), { op: 'refund', reason: 'ready_timeout', winnerSeat: null });
  assert.deepEqual(money('cancel', 'server_shutdown', null, '', false), { op: 'refund', reason: 'server_shutdown', winnerSeat: null });
  assert.deepEqual(money('cancel', 'no_combat_seed', null, 'refund', true), { op: 'refund', reason: 'version_mismatch', winnerSeat: null });
  assert.deepEqual(money('', '', null, '', false), { op: 'refund', reason: 'server_shutdown', winnerSeat: null });
}

// Boot and the sweep match. The first periodic call only stamps.
{
  const mod = load();
  const api = wagerApi(mod);
  const before = sqls(mod, 'shooter_wager_expire').length;
  const t0 = 1_000_000;
  assert.equal(api.maybeSweep(mod.nk, mod.logger, t0), false);
  assert.equal(sqls(mod, 'shooter_wager_expire').length, before);
  assert.equal(api.maybeSweep(mod.nk, mod.logger, t0 + api.SWEEP_EVERY_MS + 1), true);
  const swept = sqls(mod, 'shooter_wager_expire');
  assert.equal(swept.length, before + 1);
  assert.match(swept.at(-1)!.sql, /interval '1200 seconds'/);
  assert.equal(api.maybeSweep(mod.nk, mod.logger, t0 + api.SWEEP_EVERY_MS + 2), false);
  const sweep = [...mod.nk.matches.values()].find((match) => match.module === 'shooter_wager_sweep');
  assert.ok(sweep, 'sweep match is up at boot');
  const driver = mod.driver(sweep!.matchId);
  assert.equal(driver.joinAttempt(presence(A, 'ada', 'sa'), game(A, 'sa')).accept, false);
  assert.equal(driver.loop([]), true, 'the sweeper does not exit');
}

// Flag off: a wager=1 create does not hold, even after both players ready.
{
  const mod = load();
  signIn(mod, A, B);
  const m = mod.startMatch('sproto_shooter_free', {
    spawnSeed: '7', seedSource: 'server', private: '0', wager: '1', roster: JSON.stringify([A, B]),
  });
  const state = m.state as { wager: boolean };
  assert.equal(state.wager, false);
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.accept, true);
  hello(m, a);
  hello(m, b);
  ready(m, a);
  ready(m, b);
  assert.equal(sqls(mod, 'shooter_wager_hold').length, 0);
}

// Flag on, guest seat: refused before the hold.
{
  const mod = load(true);
  signIn(mod, A);
  const m = mod.startMatch('sproto_shooter_free', {
    spawnSeed: '7', seedSource: 'server', private: '0', wager: '1', roster: JSON.stringify([A, B]),
  });
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.rejectMessage, 'wager_guest');
  assert.equal(sqls(mod, 'shooter_wager_hold').length, 0);
}

// Flag on, signed-in pair: one hold when the second player readies, one refund on a draw, and a repeat loop does not close again.
{
  const mod = load(true);
  signIn(mod, A, B);
  mod.nk.onSql(/shooter_wager_hold/, () => [{ r: JSON.stringify({ status: 'held', wagerId: '11111111-1111-4111-8111-111111111111', stake: 10, pot: 20 }) }]);
  mod.nk.onSql(/shooter_wager_refund/, () => [{ r: JSON.stringify({ status: 'refunded', reason: 'both_absent', payout: 0, fee: 0, minted: 0 }) }]);
  mod.nk.onSql(/shooter_wager_settle/, () => [{ r: JSON.stringify({ status: 'settled', payout: 20 }) }]);
  const m = mod.startMatch('sproto_shooter_free', {
    spawnSeed: '7', seedSource: 'server', private: '0', wager: '1', roster: JSON.stringify([A, B]),
  });
  const state = m.state as { wager: boolean; ruleHash: string };
  assert.equal(state.wager, true);
  assert.match(state.ruleHash, /^[0-9a-f]{64}$/);
  assert.equal((JSON.parse(m.match.label) as { stake: number; mode: string }).stake, 10);
  assert.equal((JSON.parse(m.match.label) as { mode: string }).mode, 'wager');
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  assert.equal(m.join([a], game(A, 'sa'))[0]?.accept, true);
  assert.equal(m.join([b], game(B, 'sb'))[0]?.accept, true);
  hello(m, a);
  hello(m, b);
  ready(m, a);
  assert.equal(sqls(mod, 'shooter_wager_hold').length, 0, 'the first ready does not hold');
  ready(m, b);
  const holds = sqls(mod, 'shooter_wager_hold');
  assert.equal(holds.length, 1);
  assert.deepEqual(plain(holds[0]!.args.slice(1, 3)), [A, B]);
  m.leave([a, b]);
  m.signal('advance:10400');
  m.loop([]);
  m.loop([]);
  assert.equal(sqls(mod, 'shooter_wager_settle').length, 0, 'both absent is not a win');
  assert.equal(sqls(mod, 'shooter_wager_refund').length, 1);
  const refund = sqls(mod, 'shooter_wager_refund').at(-1)!;
  assert.equal(refund.args[1], 'both_absent');
  m.loop([]);
  assert.equal(sqls(mod, 'shooter_wager_refund').length, 1, 'a second loop does not close again');
  const result = (m.state as { result: { ticketsMinted: number } | null }).result;
  assert.equal(result?.ticketsMinted, 0);
}

// Insufficient hold cancels the match and does not settle.
{
  const mod = load(true);
  signIn(mod, A, B);
  mod.nk.onSql(/shooter_wager_hold/, () => [{ r: JSON.stringify({ error: 'insufficient_tickets', user: B }) }]);
  const m = mod.startMatch('sproto_shooter_free', {
    spawnSeed: '7', seedSource: 'server', private: '0', wager: '1', roster: JSON.stringify([A, B]),
  });
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  m.join([a], game(A, 'sa'));
  m.join([b], game(B, 'sb'));
  hello(m, a);
  hello(m, b);
  ready(m, a);
  ready(m, b);
  assert.equal(sqls(mod, 'shooter_wager_hold').length, 1);
  assert.equal(sqls(mod, 'shooter_wager_settle').length + sqls(mod, 'shooter_wager_refund').length, 0);
  const ended = m.state as { ended: boolean; endReason: string; wagerHeld: boolean };
  assert.equal(ended.wagerHeld, false);
  assert.equal(ended.ended, true);
  assert.equal(ended.endReason, 'insufficient_tickets');
  assert.equal(m.loop([]), true);
  assert.equal(sqls(mod, 'shooter_wager_refund').length, 0);
}

// Queue with the flag on creates a wager match. A free ticket is not paired with it.
{
  const mod = load(true);
  signIn(mod, A, B);
  const wager = { game: 'sproto-shooter', mode: 'wager', protocol: '2', sim: '2', content: FP, stake: '10' };
  const free = { game: 'sproto-shooter', mode: 'free', protocol: '2', sim: '2', content: FP };
  const a = presence(A, 'ada', 'sa');
  const b = presence(B, 'bea', 'sb');
  const id = mod.matchmake([
    { presence: a, properties: wager },
    { presence: b, properties: wager },
  ]);
  assert.ok(id);
  const label = JSON.parse(mod.nk.matches.get(id!)?.label || '{}') as { mode: string; stake: number };
  assert.equal(label.mode, 'wager');
  assert.equal(label.stake, 10);
  assert.equal(mod.matchmake([
    { presence: a, properties: wager },
    { presence: b, properties: free },
  ]), undefined);
}

console.log('shooter wager tests ok');
