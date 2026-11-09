/**
 * Shooter escrow (migration 0046). Hold is
 * game.shooter_wager_hold(match, a, b, rule_hash). Stake is fixed at 10.
 * There is no pair cap and no daily winnings cap. The match id plus the
 * participant and rule hash is the idempotency key.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, compose, guest, num, psql, psqlAsync, psqlFile, sqlId, ticketBalance, waitReady, type Guest } from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AUDIT = path.join(ROOT, 'server/test/dup/shooter_wager_audit.sql');

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const GAME = 'sproto-shooter';
const FIGHTER = 'sproto-fighter';
const STAKE = 10;
const PASSWORD = 'correct-horse-1';

interface WagerResult {
  error?: string;
  user?: string;
  wagerId?: string;
  status?: string;
  stake?: number;
  pot?: number;
  payout?: number;
  fee?: number;
  minted?: number;
  repeat?: boolean;
  winner?: string | null;
  reason?: string;
  accountingDay?: string;
  ruleHash?: string;
  balances?: Record<string, number>;
  deltas?: Record<string, number>;
}

function matchKey(): string {
  return `m${crypto.randomUUID().replace(/-/g, '')}`;
}

function assertMatchKey(matchId: string): void {
  if (!/^m[0-9a-f]{32}$/.test(matchId)) throw new Error(`bad match id ${matchId}`);
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const RULE = hashOf('shooter-wager-rule-v1');
const OTHER_RULE = hashOf('shooter-wager-rule-v2');

function jsonLine(raw: string): WagerResult {
  const line = raw.split('\n').map((item) => item.trim()).filter((item) => item.startsWith('{')).at(-1);
  if (!line) throw new Error(`no jsonb from psql: ${raw}`);
  return JSON.parse(line) as WagerResult;
}

function hold(matchId: string, a: string, b: string, hash = RULE, at = ''): WagerResult {
  assertMatchKey(matchId);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('bad rule hash');
  const when = at ? `, ${at}` : '';
  const raw = psql(
    `SELECT game.shooter_wager_hold('${matchId}', '${sqlId(a)}'::uuid, '${sqlId(b)}'::uuid, '${hash}'${when})::text`,
  );
  return jsonLine(raw);
}

function settle(matchId: string, winner: string, reason = 'ko'): WagerResult {
  assertMatchKey(matchId);
  if (!/^(ko|time|forfeit)$/.test(reason)) throw new Error(`bad settle reason ${reason}`);
  return jsonLine(psql(
    `SELECT game.shooter_wager_settle('${matchId}', '${sqlId(winner)}'::uuid, '${reason}')::text`,
  ));
}

function refund(matchId: string, reason = 'draw'): WagerResult {
  assertMatchKey(matchId);
  if (!/^[a-z_]+$/.test(reason)) throw new Error(`bad refund reason ${reason}`);
  return jsonLine(psql(`SELECT game.shooter_wager_refund('${matchId}', '${reason}')::text`));
}

function kindRows(matchId: string, kind: 'shooter_stake' | 'shooter_payout' | 'shooter_refund'): number {
  assertMatchKey(matchId);
  return num(
    `SELECT count(*) FROM game.tickets_ledger WHERE kind = '${kind}' AND ref_id = (SELECT wager_id FROM game.shooter_wager WHERE match_id = '${matchId}')`,
  );
}

function escrowPot(a: string, b: string): number {
  return num(
    `SELECT COALESCE(sum(CASE WHEN status = 'held' THEN stake * 2 ELSE 0 END), 0)
     FROM game.shooter_wager
     WHERE (player_a = '${sqlId(a)}'::uuid AND player_b = '${sqlId(b)}'::uuid)
        OR (player_a = '${sqlId(b)}'::uuid AND player_b = '${sqlId(a)}'::uuid)`,
  );
}

function assertConserved(a: string, b: string, startA: number, startB: number): void {
  const total = ticketBalance(a, GAME) + ticketBalance(b, GAME) + escrowPot(a, b);
  assert.equal(total, startA + startB, `wallets plus escrow ${total}, started at ${startA + startB}`);
  assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
}

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
       'shooter_fund', 'earn'
     );
     INSERT INTO game.tickets_balance (user_id, game_id, balance)
     VALUES (
       '${sqlId(userId)}', '${GAME}',
       COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'), 0) + ${amount}
     )
     ON CONFLICT (user_id, game_id) DO UPDATE SET balance = game.tickets_balance.balance + ${amount}`,
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

async function pair(amount = 40): Promise<[Guest, Guest, string]> {
  const a = await claimed();
  const b = await claimed();
  const tag = a.userId.replace(/-/g, '').slice(0, 8);
  fund(a.userId, amount, `wa${tag}`);
  fund(b.userId, amount, `wb${tag}`);
  return [a, b, tag];
}

function dayOf(matchId: string): string {
  assertMatchKey(matchId);
  return psql(`SELECT accounting_day::text FROM game.shooter_wager WHERE match_id = '${matchId}'`);
}

export async function runShooterWagers(test: TestFn): Promise<void> {
  await test('shooter-wager', '0046 keeps the fixed 10 stake and leaves Fighter hold alone', async () => {
    const shooter = psql(
      `SELECT pg_get_function_identity_arguments(p.oid)
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'game' AND p.proname = 'shooter_wager_hold' ORDER BY 1`,
    );
    assert.equal(shooter, 'p_match_id text, p_a uuid, p_b uuid, p_rule_hash text, p_at timestamp with time zone');
    const fighter = psql(
      `SELECT pg_get_function_identity_arguments(p.oid)
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'game' AND p.proname = 'sproto_wager_hold' ORDER BY 1`,
    );
    assert.equal(fighter, 'p_match_id text, p_a uuid, p_b uuid, p_stake bigint, p_pair_limit integer, p_daily_cap bigint');
    assert.equal(num(`SELECT count(*) FROM game.server_flags WHERE key = 'shooter_pvp_wager' AND state = 'off'`), 1);
  });

  await test('shooter-wager', 'a guest is refused and a signed-in pair holds 10 each', async () => {
    const guestA = await guest();
    const [host] = await pair(20);
    assert.equal(psql(`SELECT game.user_is_guest('${sqlId(guestA.userId)}'::uuid)`), 't');
    fund(guestA.userId, 20, `wg${guestA.userId.replace(/-/g, '').slice(0, 8)}`);
    const beforeGuest = ticketBalance(guestA.userId, GAME);
    const beforeHost = ticketBalance(host.userId, GAME);
    const denied = hold(matchKey(), guestA.userId, host.userId);
    assert.equal(denied.error, 'wager_guest', JSON.stringify(denied));
    assert.equal(ticketBalance(guestA.userId, GAME), beforeGuest);
    assert.equal(ticketBalance(host.userId, GAME), beforeHost);
    const [a, b] = await pair(20);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    const opened = hold(id, a.userId, b.userId);
    assert.equal(opened.status, 'held', JSON.stringify(opened));
    assert.equal(opened.stake, STAKE);
    assert.equal(opened.pot, 20);
    assert.equal(opened.fee, 0);
    assert.equal(opened.minted, 0);
    assert.equal(ticketBalance(a.userId, GAME), startA - STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assert.equal(ticketBalance(a.userId, FIGHTER), 0);
    assert.equal(kindRows(id, 'shooter_stake'), 2);
    assertConserved(a.userId, b.userId, startA, startB);
  });

  await test('shooter-wager', 'the 10 Ticket balance is the only cap edge', async () => {
    const [exactA, exactB] = await pair(STAKE);
    const exactId = matchKey();
    const exact = hold(exactId, exactA.userId, exactB.userId);
    assert.equal(exact.status, 'held', JSON.stringify(exact));
    assert.equal(ticketBalance(exactA.userId, GAME), 0);
    assert.equal(ticketBalance(exactB.userId, GAME), 0);
    assert.equal(settle(exactId, exactA.userId, 'ko').payout, 20);

    const shortA = await claimed();
    const richB = await claimed();
    const tagA = shortA.userId.replace(/-/g, '').slice(0, 8);
    fund(shortA.userId, 9, `w9${tagA}`);
    fund(richB.userId, STAKE, `w1${richB.userId.replace(/-/g, '').slice(0, 8)}`);
    const beforeRich = ticketBalance(richB.userId, GAME);
    const beforeShort = ticketBalance(shortA.userId, GAME);
    const rows = num('SELECT count(*) FROM game.shooter_wager');
    const deniedA = hold(matchKey(), shortA.userId, richB.userId);
    assert.equal(deniedA.error, 'insufficient_tickets', JSON.stringify(deniedA));
    assert.equal(deniedA.user, shortA.userId);
    assert.equal(ticketBalance(shortA.userId, GAME), beforeShort);
    assert.equal(ticketBalance(richB.userId, GAME), beforeRich);
    assert.equal(num('SELECT count(*) FROM game.shooter_wager'), rows);

    const richA = await claimed();
    const shortB = await claimed();
    fund(richA.userId, STAKE, `w2${richA.userId.replace(/-/g, '').slice(0, 8)}`);
    fund(shortB.userId, 9, `w8${shortB.userId.replace(/-/g, '').slice(0, 8)}`);
    const startRich = ticketBalance(richA.userId, GAME);
    const startShort = ticketBalance(shortB.userId, GAME);
    const deniedB = hold(matchKey(), richA.userId, shortB.userId);
    assert.equal(deniedB.error, 'insufficient_tickets', JSON.stringify(deniedB));
    assert.equal(deniedB.user, shortB.userId);
    assert.equal(ticketBalance(richA.userId, GAME), startRich, 'the first debit rolled back');
    assert.equal(ticketBalance(shortB.userId, GAME), startShort);
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
  });

  await test('shooter-wager', 'one active hold per account, and a changed pair or rule is not a replay', async () => {
    const [a, b] = await pair(40);
    const c = await claimed();
    fund(c.userId, 20, `wc${c.userId.replace(/-/g, '').slice(0, 8)}`);
    const id = matchKey();
    const opened = hold(id, a.userId, b.userId);
    assert.equal(opened.status, 'held', JSON.stringify(opened));
    const startA = ticketBalance(a.userId, GAME);
    const startC = ticketBalance(c.userId, GAME);
    const second = hold(matchKey(), a.userId, c.userId);
    assert.equal(second.error, 'active_wager', JSON.stringify(second));
    assert.equal(ticketBalance(a.userId, GAME), startA);
    assert.equal(ticketBalance(c.userId, GAME), startC);
    const swapped = hold(id, b.userId, a.userId);
    assert.equal(swapped.error, 'participant_mismatch', JSON.stringify(swapped));
    const retuled = hold(id, a.userId, b.userId, OTHER_RULE);
    assert.equal(retuled.error, 'rule_mismatch', JSON.stringify(retuled));
    assert.equal(kindRows(id, 'shooter_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA);
  });

  await test('shooter-wager', '100 duplicate holds and settles pay once', async () => {
    const [a, b] = await pair(40);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    let first = '';
    for (let i = 0; i < 100; i += 1) {
      const opened = hold(id, a.userId, b.userId);
      assert.equal(opened.status, 'held', JSON.stringify(opened));
      if (!first) first = opened.wagerId || '';
      assert.equal(opened.wagerId, first);
    }
    assert.equal(kindRows(id, 'shooter_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA - STAKE);
    let paid: WagerResult | null = null;
    for (let i = 0; i < 100; i += 1) {
      const row = settle(id, a.userId, 'ko');
      assert.equal(row.status, 'settled', JSON.stringify(row));
      assert.equal(row.payout, 20);
      assert.equal(row.fee, 0);
      assert.equal(row.minted, 0);
      assert.equal(row.winner, a.userId);
      assert.deepEqual(row.deltas, { [a.userId]: 10, [b.userId]: -10 });
      if (!paid) {
        paid = row;
        assert.equal(row.repeat, undefined);
      } else {
        assert.equal(row.repeat, true, JSON.stringify(row));
        assert.equal(row.balances?.[a.userId], paid.balances?.[a.userId]);
        assert.equal(row.balances?.[b.userId], paid.balances?.[b.userId]);
      }
    }
    assert.equal(kindRows(id, 'shooter_payout'), 1);
    assert.equal(kindRows(id, 'shooter_stake'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA + STAKE);
    assert.equal(ticketBalance(b.userId, GAME), startB - STAKE);
    assert.equal(escrowPot(a.userId, b.userId), 0);
    assertConserved(a.userId, b.userId, startA, startB);
  });

  await test('shooter-wager', '100 duplicate refunds return each stake once', async () => {
    const [a, b] = await pair(20);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    assert.equal(hold(id, a.userId, b.userId).status, 'held');
    let first: WagerResult | null = null;
    for (let i = 0; i < 100; i += 1) {
      const row = refund(id, 'draw');
      assert.equal(row.status, 'refunded', JSON.stringify(row));
      assert.equal(row.payout, 0);
      assert.equal(row.minted, 0);
      assert.deepEqual(row.deltas, { [a.userId]: 0, [b.userId]: 0 });
      if (!first) first = row;
      else assert.equal(row.repeat, true);
    }
    assert.equal(kindRows(id, 'shooter_refund'), 2);
    assert.equal(kindRows(id, 'shooter_payout'), 0);
    assert.equal(ticketBalance(a.userId, GAME), startA);
    assert.equal(ticketBalance(b.userId, GAME), startB);
    assertConserved(a.userId, b.userId, startA, startB);
    const after = settle(id, a.userId, 'ko');
    assert.equal(after.repeat, true, JSON.stringify(after));
    assert.equal(after.status, 'refunded');
    assert.equal(kindRows(id, 'shooter_payout'), 0);
    assert.equal(ticketBalance(a.userId, GAME), startA);
  });

  await test('shooter-wager', '20 mixed races keep a single terminal receipt', async () => {
    const races: { id: string; a: Guest; b: Guest; startA: number; startB: number }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const [a, b] = await pair(20);
      const id = matchKey();
      assert.equal(hold(id, a.userId, b.userId).status, 'held');
      races.push({ id, a, b, startA: ticketBalance(a.userId, GAME) + STAKE, startB: ticketBalance(b.userId, GAME) + STAKE });
    }
    await Promise.all(races.map(async (race, index) => {
      const settleSql = `SELECT game.shooter_wager_settle('${race.id}', '${sqlId(race.a.userId)}'::uuid, 'ko')::text`;
      const refundSql = `SELECT game.shooter_wager_refund('${race.id}', 'draw')::text`;
      const other = index % 2 === 0 ? refundSql : settleSql;
      const [left, right] = await Promise.all([psqlAsync(settleSql), psqlAsync(other)]);
      const bodies = [jsonLine(left), jsonLine(right)];
      const terminals = bodies.filter((body) => body.repeat !== true);
      const repeats = bodies.filter((body) => body.repeat === true);
      assert.equal(terminals.length, 1, JSON.stringify(bodies));
      assert.equal(repeats.length, 1, JSON.stringify(bodies));
      assert.equal(repeats[0]!.status, terminals[0]!.status);
    }));
    for (const race of races) {
      const status = psql(`SELECT status FROM game.shooter_wager WHERE match_id = '${race.id}'`);
      assert.ok(status === 'settled' || status === 'refunded', status);
      if (status === 'settled') {
        assert.equal(kindRows(race.id, 'shooter_payout'), 1);
        assert.equal(kindRows(race.id, 'shooter_refund'), 0);
        assert.equal(ticketBalance(race.a.userId, GAME), race.startA + STAKE);
        assert.equal(ticketBalance(race.b.userId, GAME), race.startB - STAKE);
      } else {
        assert.equal(kindRows(race.id, 'shooter_payout'), 0);
        assert.equal(kindRows(race.id, 'shooter_refund'), 2);
        assert.equal(ticketBalance(race.a.userId, GAME), race.startA);
        assert.equal(ticketBalance(race.b.userId, GAME), race.startB);
      }
      assertConserved(race.a.userId, race.b.userId, race.startA, race.startB);
    }

    const shared = await claimed();
    fund(shared.userId, STAKE, `ws${shared.userId.replace(/-/g, '').slice(0, 8)}`);
    const rivals: Guest[] = [];
    for (let i = 0; i < 10; i += 1) {
      const rival = await claimed();
      fund(rival.userId, STAKE, `wr${rival.userId.replace(/-/g, '').slice(0, 8)}`);
      rivals.push(rival);
    }
    const ids = rivals.map(() => matchKey());
    const opened = await Promise.all(ids.map((id, index) => psqlAsync(
      `SELECT game.shooter_wager_hold('${id}', '${sqlId(shared.userId)}'::uuid, '${sqlId(rivals[index]!.userId)}'::uuid, '${RULE}')::text`,
    )));
    const bodies = opened.map((raw) => jsonLine(raw));
    const held = bodies.filter((body) => body.status === 'held');
    const busy = bodies.filter((body) => body.error === 'active_wager' || body.error === 'insufficient_tickets');
    assert.equal(held.length, 1, JSON.stringify(bodies));
    assert.equal(busy.length, 9, JSON.stringify(bodies));
    assert.equal(ticketBalance(shared.userId, GAME), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_wager_active WHERE user_id = '${sqlId(shared.userId)}'`), 1);
    const heldId = ids[bodies.findIndex((body) => body.status === 'held')]!;
    assert.equal(refund(heldId, 'draw').status, 'refunded');
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
  });

  await test('shooter-wager', 'the accounting day is the UTC day of the hold', async () => {
    const [beforeA, beforeB] = await pair(20);
    const [afterA, afterB] = await pair(20);
    const early = matchKey();
    const late = matchKey();
    const openedEarly = hold(early, beforeA.userId, beforeB.userId, RULE, "timestamptz '2026-11-08 23:59:59+00'");
    const openedLate = hold(late, afterA.userId, afterB.userId, RULE, "timestamptz '2026-11-09 00:00:00+00'");
    assert.equal(openedEarly.status, 'held', JSON.stringify(openedEarly));
    assert.equal(openedLate.status, 'held', JSON.stringify(openedLate));
    assert.equal(openedEarly.accountingDay, '2026-11-08');
    assert.equal(openedLate.accountingDay, '2026-11-09');
    assert.equal(dayOf(early), '2026-11-08');
    assert.equal(dayOf(late), '2026-11-09');
    assert.equal(settle(early, beforeA.userId, 'time').status, 'settled');
    assert.equal(dayOf(early), '2026-11-08', 'settlement does not move the accounting day');
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
  });

  await test('shooter-wager', 'a crash after commit returns the same receipt', async () => {
    const [a, b] = await pair(20);
    const id = matchKey();
    assert.equal(hold(id, a.userId, b.userId).status, 'held');
    const first = settle(id, b.userId, 'forfeit');
    assert.equal(first.repeat, undefined);
    assert.equal(first.winner, b.userId);
    assert.equal(first.payout, 20);
    const again = settle(id, a.userId, 'ko');
    assert.equal(again.repeat, true, JSON.stringify(again));
    assert.equal(again.winner, b.userId, 'the first receipt stands');
    assert.equal(again.reason, 'forfeit');
    assert.equal(again.payout, first.payout);
    assert.deepEqual(again.balances, first.balances);
    assert.equal(kindRows(id, 'shooter_payout'), 1);
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
  });

  await test('shooter-wager', 'the stale sweeper refunds an old hold once and leaves a fresh one', async () => {
    const [oldA, oldB] = await pair(20);
    const [freshA, freshB] = await pair(20);
    const oldId = matchKey();
    const freshId = matchKey();
    assert.equal(hold(oldId, oldA.userId, oldB.userId).status, 'held');
    assert.equal(hold(freshId, freshA.userId, freshB.userId).status, 'held');
    const freshStartA = ticketBalance(freshA.userId, GAME);
    psql(`UPDATE game.shooter_wager SET created_at = now() - interval '21 minutes' WHERE match_id = '${oldId}'`);
    assert.equal(num(`SELECT game.shooter_wager_expire(interval '1200 seconds')`), 1);
    assert.equal(psql(`SELECT status || ':' || reason FROM game.shooter_wager WHERE match_id = '${oldId}'`), 'refunded:expired');
    assert.equal(num(`SELECT game.shooter_wager_expire(interval '1200 seconds')`), 0);
    assert.equal(psql(`SELECT status FROM game.shooter_wager WHERE match_id = '${freshId}'`), 'held');
    assert.equal(ticketBalance(freshA.userId, GAME), freshStartA);
    assert.equal(kindRows(oldId, 'shooter_refund'), 2);
    const cleared = num(`SELECT game.shooter_wager_expire(interval '0')`);
    assert.ok(cleared >= 1, `expire 0 refunded ${cleared}`);
    assert.equal(psql(`SELECT status FROM game.shooter_wager WHERE match_id = '${freshId}'`), 'refunded');
    assert.equal(num(`SELECT game.shooter_wager_expire(interval '0')`), 0);
    assert.equal(kindRows(freshId, 'shooter_refund'), 2);
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
    psqlFile(AUDIT);
  });

  await test('shooter-wager', 'nakama restart refunds a held shooter wager once', async () => {
    const [a, b] = await pair(20);
    const startA = ticketBalance(a.userId, GAME);
    const startB = ticketBalance(b.userId, GAME);
    const id = matchKey();
    assert.equal(hold(id, a.userId, b.userId).status, 'held');
    compose(['restart', 'nakama'], 180_000);
    await waitReady();
    assert.equal(psql(`SELECT status || ':' || COALESCE(reason, '') FROM game.shooter_wager WHERE match_id = '${id}'`), 'refunded:expired');
    assert.equal(kindRows(id, 'shooter_refund'), 2);
    assert.equal(ticketBalance(a.userId, GAME), startA);
    assert.equal(ticketBalance(b.userId, GAME), startB);
    compose(['restart', 'nakama'], 180_000);
    await waitReady();
    assert.equal(kindRows(id, 'shooter_refund'), 2, 'a second boot does not refund again');
    assert.equal(ticketBalance(a.userId, GAME), startA);
    assert.equal(num('SELECT game.shooter_wager_drift()'), 0);
    psqlFile(AUDIT);
  });
}
