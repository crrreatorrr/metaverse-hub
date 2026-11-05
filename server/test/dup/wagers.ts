/**
 * Fighter wager escrow (migration 0032). Hold is
 * game.sproto_wager_hold(match, a, b, stake, pair_limit, daily_cap).
 * The match id is the idempotency key: a second hold or settle for that id
 * does not move Tickets again. Guests are refused before the economy lock.
 * Qualifying wins are not required.
 *
 * The client-visible CANCEL path is server/test/unit/wager_guest.test.ts.
 */
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { call, guest, num, psql, sleep, sqlId, ticketBalance, type Guest } from './harness.ts';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSE = path.join(ROOT, 'server/docker-compose.yml');

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const GAME = 'sproto-fighter';
const STAKE = 10;
const PAIR_LIMIT = 5;
const DAILY_CAP = 200;
const PASSWORD = 'correct-horse-1';

interface WagerResult {
  error?: string;
  user?: string;
  wagerId?: string;
  status?: string;
  stake?: number;
  repeat?: boolean;
  payout?: number;
  winner?: string;
}

interface Purse {
  balance: number;
  ledger: number;
}

function matchKey(): string {
  return `m${crypto.randomUUID().replace(/-/g, '')}`;
}

function assertMatchKey(matchId: string): void {
  if (!/^m[0-9a-f]{32}$/.test(matchId)) throw new Error(`bad match id ${matchId}`);
}

function jsonLine(raw: string): WagerResult {
  const line = raw.split('\n').map((item) => item.trim()).filter((item) => item.startsWith('{')).at(-1);
  if (!line) throw new Error(`no jsonb from psql: ${raw}`);
  return JSON.parse(line) as WagerResult;
}

function hold(matchId: string, a: string, b: string, stake = STAKE, pair = PAIR_LIMIT, cap = DAILY_CAP): WagerResult {
  assertMatchKey(matchId);
  const raw = psql(
    `SELECT game.sproto_wager_hold('${matchId}', '${sqlId(a)}'::uuid, '${sqlId(b)}'::uuid, ${stake}::bigint, ${pair}::int, ${cap}::bigint)::text`,
  );
  return jsonLine(raw);
}

/** Same call, but give up if it waits on an economy advisory lock. */
function holdWithoutWaiting(matchId: string, a: string, b: string): WagerResult {
  assertMatchKey(matchId);
  const raw = psql(
    `SET lock_timeout = '400ms'; SELECT game.sproto_wager_hold('${matchId}', '${sqlId(a)}'::uuid, '${sqlId(b)}'::uuid, ${STAKE}::bigint, ${PAIR_LIMIT}::int, ${DAILY_CAP}::bigint)::text`,
  );
  return jsonLine(raw);
}

function settle(matchId: string, winner: string, reason = 'verified'): WagerResult {
  assertMatchKey(matchId);
  if (reason !== 'verified') throw new Error(`bad settle reason ${reason}`);
  const raw = psql(
    `SELECT game.sproto_wager_settle('${matchId}', '${sqlId(winner)}'::uuid, '${reason}')::text`,
  );
  return jsonLine(raw);
}

function refund(matchId: string): WagerResult {
  assertMatchKey(matchId);
  const raw = psql(
    `SET lock_timeout = '400ms'; SELECT game.sproto_wager_refund('${matchId}', 'wager_guest')::text`,
  );
  return jsonLine(raw);
}

function purse(userId: string): Purse {
  return {
    balance: ticketBalance(userId, GAME),
    ledger: num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`),
  };
}

function assertPurse(userId: string, before: Purse, label: string): void {
  const after = purse(userId);
  assert.equal(after.balance, before.balance, `${label} changed the balance (${before.balance} -> ${after.balance})`);
  assert.equal(after.ledger, before.ledger, `${label} wrote a ledger row (${before.ledger} -> ${after.ledger})`);
}

function escrowRows(matchId: string): number {
  assertMatchKey(matchId);
  return num(`SELECT count(*) FROM game.sproto_wager WHERE match_id = '${matchId}'`);
}

function kindRows(matchId: string, kind: 'duel_stake' | 'duel_payout' | 'duel_refund'): number {
  assertMatchKey(matchId);
  return num(
    `SELECT count(*) FROM game.tickets_ledger WHERE kind = '${kind}' AND ref_id = (SELECT wager_id FROM game.sproto_wager WHERE match_id = '${matchId}')`,
  );
}

function escrowPot(a: string, b: string): number {
  return num(
    `SELECT COALESCE(sum(CASE WHEN status = 'held' THEN stake * 2 ELSE 0 END), 0)
     FROM game.sproto_wager
     WHERE (player_a = '${sqlId(a)}'::uuid AND player_b = '${sqlId(b)}'::uuid)
        OR (player_a = '${sqlId(b)}'::uuid AND player_b = '${sqlId(a)}'::uuid)`,
  );
}

function assertConserved(a: string, b: string, startA: number, startB: number): void {
  const total = ticketBalance(a, GAME) + ticketBalance(b, GAME) + escrowPot(a, b);
  assert.equal(total, startA + startB, `wallets plus escrow ${total}, started at ${startA + startB}`);
}

function assertLockFree(userId: string): void {
  const got = psql(
    `SELECT CASE WHEN pg_try_advisory_lock(hashtextextended('economy:' || '${sqlId(userId)}', 0)) THEN pg_advisory_unlock(hashtextextended('economy:' || '${sqlId(userId)}', 0)) ELSE false END`,
  );
  assert.equal(got, 't', `economy lock still held for ${userId}`);
}

function pvpWins(userId: string): number {
  return num(`SELECT count(*) FROM game.sproto_pvp_result WHERE winner = '${sqlId(userId)}'::uuid`);
}

function wagerNet(userId: string): number {
  return num(
    `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger
     WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'
       AND kind IN ('duel_stake', 'duel_payout', 'duel_refund')
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')`,
  );
}

async function claimed(): Promise<Guest> {
  const who = await guest();
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const res = await call('account.claim', {
    username: `u${tag}`,
    email: `u${tag}@example.com`,
    password: PASSWORD,
  }, who.token);
  assert.equal(res.body.claimed, true, JSON.stringify(res.body));
  assert.equal(psql(`SELECT game.user_is_guest('${sqlId(who.userId)}'::uuid)`), 'f');
  return who;
}

async function deviceGuest(): Promise<Guest> {
  const who = await guest();
  assert.equal(psql(`SELECT game.user_is_guest('${sqlId(who.userId)}'::uuid)`), 't');
  return who;
}

/**
 * 0031 sets fighter_win max_amount to 0, so tickets.earn cannot fund a purse.
 * Put Tickets in the wallet directly. One tickets.earn idempotency row per
 * positive ledger line keeps the suite audit's earn-key check intact.
 * These rows are not sproto_pvp_result wins.
 */
function fund(userId: string, amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) throw new Error(`bad credit ${amount}`);
  if (!/^w[a-z0-9-]{1,40}$/.test(label)) throw new Error(`bad fund label ${label}`);
  psql(
    `INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
     VALUES ('${sqlId(userId)}', '${label}', 'tickets.earn', decode('00', 'hex'), '{}'::jsonb);
     INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, kind)
     VALUES (
       gen_random_uuid(), '${sqlId(userId)}', '${GAME}', ${amount},
       COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'), 0) + ${amount},
       'fighter_win', 'earn'
     );
     INSERT INTO game.tickets_balance (user_id, game_id, balance)
     VALUES (
       '${sqlId(userId)}', '${GAME}',
       COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'), 0) + ${amount}
     )
     ON CONFLICT (user_id, game_id) DO UPDATE SET balance = game.tickets_balance.balance + ${amount}`,
  );
}

function psqlArgs(sql: string): string[] {
  return [
    'compose', '-f', COMPOSE, 'exec', '-T', 'postgres',
    'psql', '-U', 'postgres', '-d', 'nakama',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
    '-c', sql,
  ];
}

async function psqlAsync(sql: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', psqlArgs(sql), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return stdout.trim();
}

function holdEconomyLocks(userIds: string[]): ChildProcess {
  const locks = userIds
    .map((id) => `SELECT pg_advisory_xact_lock(hashtextextended('economy:' || '${sqlId(id)}', 0));`)
    .join('\n');
  const child = spawn('docker', [
    'compose', '-f', COMPOSE, 'exec', '-T', 'postgres',
    'psql', '-U', 'postgres', '-d', 'nakama',
    '-v', 'ON_ERROR_STOP=1', '-q',
  ], { cwd: ROOT });
  child.stdin.write(`SET application_name = 'wager-lock-hold';\nBEGIN;\n${locks}\nSELECT pg_sleep(20);\nCOMMIT;\n`);
  child.stdin.end();
  return child;
}

async function waitForHeldLocks(count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const held = num(
      `SELECT count(*) FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.application_name = 'wager-lock-hold' AND l.locktype = 'advisory' AND l.granted`,
    );
    if (held >= count) return;
    await sleep(50);
  }
  throw new Error('economy lock holder never acquired its locks');
}

function releaseLockHolder(): void {
  try {
    psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'wager-lock-hold'`);
  } catch {
    // The sleeper already exited.
  }
}

export async function runWagers(test: TestFn): Promise<void> {
  await test('wager', '0032 leaves a single 6-arg sproto_wager_hold', async () => {
    const raw = psql(
      `SELECT pg_get_function_identity_arguments(p.oid)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'game' AND p.proname = 'sproto_wager_hold'
       ORDER BY 1`,
    );
    const sigs = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    const seven = sigs.filter((sig) => sig.split(',').length === 7);
    assert.deepEqual(seven, [], `7-arg overload still present: ${sigs.join(' || ')}`);
    assert.deepEqual(sigs, [
      'p_match_id text, p_a uuid, p_b uuid, p_stake bigint, p_pair_limit integer, p_daily_cap bigint',
    ]);
  });

  await test('wager', 'guest in seat A or seat B returns wager_guest with no lock debit or escrow', async () => {
    const guestA = await deviceGuest();
    const guestB = await deviceGuest();
    const host = await claimed();
    const label = (who: Guest, name: string) => `w${name}${who.userId.replace(/-/g, '').slice(0, 8)}`;
    fund(guestA.userId, 40, label(guestA, 'ga'));
    fund(guestB.userId, 40, label(guestB, 'gb'));
    fund(host.userId, 40, label(host, 'hs'));
    const beforeGuestA = purse(guestA.userId);
    const beforeGuestB = purse(guestB.userId);
    const beforeHost = purse(host.userId);
    const holder = holdEconomyLocks([guestA.userId, guestB.userId, host.userId]);
    let holderErr = '';
    holder.stderr?.on('data', (chunk: Buffer) => {
      holderErr += chunk.toString();
    });
    try {
      await waitForHeldLocks(3);
      const seatA = matchKey();
      const seatB = matchKey();
      const fromA = holdWithoutWaiting(seatA, guestA.userId, host.userId);
      const fromB = holdWithoutWaiting(seatB, host.userId, guestB.userId);
      assert.equal(fromA.error, 'wager_guest', JSON.stringify(fromA));
      assert.equal(fromB.error, 'wager_guest', JSON.stringify(fromB));
      assert.equal(refund(seatA).status, 'none');
      assert.equal(refund(seatB).status, 'none');
      assert.equal(escrowRows(seatA), 0);
      assert.equal(escrowRows(seatB), 0);
    } catch (error) {
      const detail = holderErr.trim();
      if (detail) throw new Error(`${error instanceof Error ? error.message : String(error)}\nlock holder: ${detail}`);
      throw error;
    } finally {
      releaseLockHolder();
      holder.kill();
    }
    assertPurse(guestA.userId, beforeGuestA, 'guest seat A');
    assertPurse(guestB.userId, beforeGuestB, 'guest seat B');
    assertPurse(host.userId, beforeHost, 'signed-in opponent');
    assertLockFree(guestA.userId);
    assertLockFree(guestB.userId);
    assertLockFree(host.userId);
  });

  await test('wager', 'two signed-in players with no prior wins can open a wager', async () => {
    const a = await claimed();
    const b = await claimed();
    const tag = a.userId.replace(/-/g, '').slice(0, 8);
    fund(a.userId, 20, `woa${tag}`);
    fund(b.userId, 20, `wob${tag}`);
    assert.equal(pvpWins(a.userId), 0);
    assert.equal(pvpWins(b.userId), 0);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    const opened = hold(id, a.userId, b.userId);
    assert.equal(opened.error, undefined, JSON.stringify(opened));
    assert.equal(opened.status, 'held');
    assert.equal(escrowRows(id), 1);
    assert.equal(kindRows(id, 'duel_stake'), 2);
    assert.equal(kindRows(id, 'duel_payout'), 0);
    assert.equal(ticketBalance(a.userId, GAME), startA - STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assertConserved(a.userId, b.userId, startA, startB);
    assertLockFree(a.userId);
    assertLockFree(b.userId);
  });

  await test('wager', 'daily cap of 200 rejects the next hold whole', async () => {
    const winner = await claimed();
    const loser = await claimed();
    const tag = winner.userId.replace(/-/g, '').slice(0, 8);
    fund(winner.userId, 200, `wca${tag}`);
    fund(loser.userId, 200, `wcb${tag}`);
    const setup = matchKey();
    const opened = hold(setup, winner.userId, loser.userId, 200, PAIR_LIMIT, DAILY_CAP);
    assert.equal(opened.status, 'held', JSON.stringify(opened));
    const paid = settle(setup, winner.userId);
    assert.equal(paid.status, 'settled', JSON.stringify(paid));
    assert.equal(paid.payout, 400);
    assert.equal(wagerNet(winner.userId), 200);
    fund(loser.userId, 200, `wcc${tag}`);
    const beforeWinner = purse(winner.userId);
    const beforeLoser = purse(loser.userId);
    const rowsBefore = num(
      `SELECT count(*) FROM game.sproto_wager
       WHERE player_a = '${sqlId(winner.userId)}'::uuid OR player_b = '${sqlId(winner.userId)}'::uuid`,
    );
    const rejectedId = matchKey();
    const rejected = hold(rejectedId, winner.userId, loser.userId);
    assert.equal(rejected.error, 'daily_wager_cap', JSON.stringify(rejected));
    assert.equal(rejected.user, winner.userId);
    assert.equal(escrowRows(rejectedId), 0);
    assert.equal(
      num(`SELECT count(*) FROM game.sproto_wager WHERE player_a = '${sqlId(winner.userId)}'::uuid OR player_b = '${sqlId(winner.userId)}'::uuid`),
      rowsBefore,
    );
    assertPurse(winner.userId, beforeWinner, 'daily cap winner');
    assertPurse(loser.userId, beforeLoser, 'daily cap loser');
    assertLockFree(winner.userId);
    assertLockFree(loser.userId);
  });

  await test('wager', 'sixth wager for the same pair is pair_limit and leaves no debit', async () => {
    const a = await claimed();
    const b = await claimed();
    const tag = a.userId.replace(/-/g, '').slice(0, 8);
    fund(a.userId, 80, `wpa${tag}`);
    fund(b.userId, 80, `wpb${tag}`);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    for (let i = 0; i < PAIR_LIMIT; i += 1) {
      const opened = hold(matchKey(), a.userId, b.userId);
      assert.equal(opened.status, 'held', JSON.stringify(opened));
    }
    assert.equal(ticketBalance(a.userId, GAME), startA - STAKE * PAIR_LIMIT);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE * PAIR_LIMIT);
    const beforeA = purse(a.userId);
    const beforeB = purse(b.userId);
    const sixth = matchKey();
    const rejected = hold(sixth, b.userId, a.userId);
    assert.equal(rejected.error, 'pair_limit', JSON.stringify(rejected));
    assert.equal(escrowRows(sixth), 0);
    assert.equal(
      num(
        `SELECT count(*) FROM game.sproto_wager
         WHERE (player_a = '${sqlId(a.userId)}'::uuid AND player_b = '${sqlId(b.userId)}'::uuid)
            OR (player_a = '${sqlId(b.userId)}'::uuid AND player_b = '${sqlId(a.userId)}'::uuid)`,
      ),
      PAIR_LIMIT,
    );
    assertPurse(a.userId, beforeA, 'pair limit seat A');
    assertPurse(b.userId, beforeB, 'pair limit seat B');
    assertLockFree(a.userId);
    assertLockFree(b.userId);
    assertConserved(a.userId, b.userId, startA, startB);
  });

  await test('wager', 'replaying one hold and one settle pays once and conserves tickets', async () => {
    const a = await claimed();
    const b = await claimed();
    const tag = a.userId.replace(/-/g, '').slice(0, 8);
    fund(a.userId, 40, `wra${tag}`);
    fund(b.userId, 40, `wrb${tag}`);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    const first = hold(id, a.userId, b.userId);
    const replay = hold(id, a.userId, b.userId);
    assert.equal(first.status, 'held', JSON.stringify(first));
    assert.equal(replay.wagerId, first.wagerId);
    assert.equal(replay.status, 'held');
    assert.equal(escrowRows(id), 1);
    assert.equal(kindRows(id, 'duel_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA - STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assertConserved(a.userId, b.userId, startA, startB);
    const paid = settle(id, a.userId);
    const retried = settle(id, a.userId);
    assert.equal(paid.status, 'settled', JSON.stringify(paid));
    assert.equal(paid.payout, STAKE * 2);
    assert.equal(paid.repeat, undefined);
    assert.equal(retried.repeat, true, JSON.stringify(retried));
    assert.equal(retried.status, 'settled');
    assert.equal(kindRows(id, 'duel_payout'), 1);
    assert.equal(kindRows(id, 'duel_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA + STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assert.equal(escrowPot(a.userId, b.userId), 0);
    assertConserved(a.userId, b.userId, startA, startB);
    assertLockFree(a.userId);
    assertLockFree(b.userId);
  });

  await test('wager', 'two concurrent settles pay the escrow once', async () => {
    const a = await claimed();
    const b = await claimed();
    const tag = a.userId.replace(/-/g, '').slice(0, 8);
    fund(a.userId, 40, `wta${tag}`);
    fund(b.userId, 40, `wtb${tag}`);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    const opened = hold(id, a.userId, b.userId);
    assert.equal(opened.status, 'held', JSON.stringify(opened));
    const sql = `SELECT game.sproto_wager_settle('${id}', '${sqlId(a.userId)}'::uuid, 'verified')::text`;
    const [left, right] = await Promise.all([psqlAsync(sql), psqlAsync(sql)]);
    const bodies = [jsonLine(left), jsonLine(right)];
    const payouts = bodies.filter((body) => body.status === 'settled' && body.payout === STAKE * 2 && body.repeat !== true);
    const repeats = bodies.filter((body) => body.repeat === true && body.status === 'settled');
    assert.equal(payouts.length, 1, JSON.stringify(bodies));
    assert.equal(repeats.length, 1, JSON.stringify(bodies));
    assert.equal(kindRows(id, 'duel_payout'), 1);
    assert.equal(kindRows(id, 'duel_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA + STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assert.equal(escrowPot(a.userId, b.userId), 0);
    assertConserved(a.userId, b.userId, startA, startB);
  });
}
