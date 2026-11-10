// Client entry for a Fighter wager: the sproto_duel match, not an HTTP RPC.
// A guest on either seat is CANCEL wager_guest. The match must not call
// game.sproto_wager_hold (that function is what takes the economy lock and
// debits). Cancel still asks for a refund; with no escrow row that write is
// a no-op, covered against Postgres in server/test/dup/wagers.ts.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type MatchDriver } from './harness';

const SIM_FALLBACK = 'rivet';
const OP_HELLO = 1;
const OP_START = 2;
const OP_CANCEL = 7;

const mod = loadModule();
const sim = String(mod.global.SPROTO_SIM_VERSION ?? '');
assert.match(sim, /^[0-9a-f]+$/, 'SPROTO_SIM_VERSION missing from the built module');

function account(userId: string, email: string | null): void {
  const record: Record<string, unknown> = { user: { userId, username: userId.slice(0, 8) } };
  if (email) record.email = email;
  mod.nk.accounts.set(userId, record);
  mod.nk.localcache.delete(`guest:${userId}`);
}

function wagerMatch(seatA: string, seatB: string): MatchDriver {
  return mod.startMatch('sproto_duel', {
    players: JSON.stringify([seatA, seatB]),
    names: JSON.stringify({ [seatA]: 'seat-a', [seatB]: 'seat-b' }),
    wager: '1',
    sim,
  });
}

function helloBoth(match: MatchDriver, seatA: string, seatB: string): void {
  const a = presence(seatA, 'seat-a');
  const b = presence(seatB, 'seat-b');
  match.join([a, b]);
  mod.nk.sqlCalls.length = 0;
  match.loop([
    { sender: a, opCode: OP_HELLO, data: { fighter: SIM_FALLBACK, stage: 'ranch', sim } },
    { sender: b, opCode: OP_HELLO, data: { fighter: 'vela', stage: 'ranch', sim } },
  ]);
}

function assertGuestCancel(seatA: string, seatB: string, guestSeat: 0 | 1): void {
  const match = wagerMatch(seatA, seatB);
  helloBoth(match, seatA, seatB);
  const state = plain(match.state) as { phase: string; outcome: { status: string; reason: string; seat: number | null } };
  assert.equal(state.phase, 'done');
  assert.deepEqual(state.outcome, { status: 'cancelled', reason: 'wager_guest', seat: guestSeat });
  const cancel = match.dispatcher.sent<{ status: string; reason: string; seat: number | null }>(OP_CANCEL);
  assert.equal(cancel.length, 1);
  assert.deepEqual(cancel[0]!.body, { status: 'cancelled', reason: 'wager_guest', seat: guestSeat });
  assert.equal(match.dispatcher.sent(OP_START).length, 0, 'a guest wager must not start');
  const sql = mod.nk.sqlCalls.map((call) => call.sql);
  assert.deepEqual(sql, ['SELECT game.sproto_wager_refund($1, $2)::text AS r']);
  assert.deepEqual(plain(mod.nk.sqlCalls[0]!.args), [match.match.matchId, 'wager_guest']);
  assert.ok(!sql.some((query) => query.includes('sproto_wager_hold') || query.includes('sproto_wager_lock') || query.includes('$7')));
}

// Seat A is the guest. Seat B has an email, so the reported seat is 0.
{
  const seatA = '11111111-1111-4111-8111-111111111111';
  const seatB = '22222222-2222-4222-8222-222222222222';
  account(seatA, null);
  account(seatB, 'b@example.com');
  assertGuestCancel(seatA, seatB, 0);
}

// Seat B is the guest. Seat A has an email, so the reported seat is 1.
{
  const seatA = '33333333-3333-4333-8333-333333333333';
  const seatB = '44444444-4444-4444-8444-444444444444';
  account(seatA, 'a@example.com');
  account(seatB, null);
  assertGuestCancel(seatA, seatB, 1);
}

// Two signed-in players: the match calls the 6-arg hold and starts when it is held.
// Wins are not an argument. SQL coverage that 0 wins opens is in dup/wagers.ts.
{
  const seatA = '55555555-5555-4555-8555-555555555555';
  const seatB = '66666666-6666-4666-8666-666666666666';
  account(seatA, 'a2@example.com');
  account(seatB, 'b2@example.com');
  // This fixture exercises enabled wagers; default-off coverage lives in duel_wager_flag.test.ts.
  mod.nk.onSql('FROM game.server_flags', (args) => args[0] === 'sproto_duel_wager'
    ? [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 0 }) }]
    : []);
  mod.nk.onSql('sproto_wager_hold', () => [{ r: JSON.stringify({ wagerId: 'w1', status: 'held', stake: 10 }) }]);
  const match = wagerMatch(seatA, seatB);
  helloBoth(match, seatA, seatB);
  const state = plain(match.state) as { phase: string };
  assert.equal(state.phase, 'playing');
  assert.equal(match.dispatcher.sent(OP_CANCEL).length, 0);
  assert.equal(match.dispatcher.sent(OP_START).length, 2);
  const hold = mod.nk.sqlCalls.find((call) => call.sql.includes('sproto_wager_hold'));
  assert.ok(hold, 'signed-in pair must call sproto_wager_hold');
  assert.equal(hold!.sql, 'SELECT game.sproto_wager_hold($1, $2::uuid, $3::uuid, $4, $5, $6)::text AS r');
  assert.equal(hold!.args.length, 6);
  assert.deepEqual(plain(hold!.args.slice(1)), [seatA, seatB, 10, 5, 200]);
  assert.ok(!mod.nk.sqlCalls.some((call) => call.sql.includes('$7')));
}

console.log('wager guest match tests ok');
