// Exchange schema tests against a real Postgres (no Nakama needed).
// Run: npm run test:exchange   (EXCHANGE_TEST_DB points at a Postgres superuser URL)
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type pg from 'pg';
import { freshDb, schemaSql, type TestDb } from './db.ts';

const UNIT = 10n ** 8n;
const ADDR = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const TX = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const SIG = '0x' + 'ab'.repeat(65);
const CASHOUT = ADDR(0xc0ffee);

let sql = '';
let db: TestDb;
let q: (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const r = await q(text, params);
  return r.rows[0] as T;
}

async function json(text: string, params: unknown[] = []): Promise<Record<string, unknown>> {
  const row = await one<Record<string, unknown>>(text, params);
  return Object.values(row)[0] as Record<string, unknown>;
}

function reqHash(body: unknown): string {
  return createHash('sha256').update('wallet.withdraw\n' + JSON.stringify(body)).digest('hex');
}

async function configure(patch: unknown): Promise<void> {
  await q('SELECT game.economy_config_set($1::jsonb, $2)', [JSON.stringify(patch), 'test']);
}

async function openCashout(account = 50, global = 1000): Promise<void> {
  await configure({
    economy: { account_daily_verse: account },
    chains: {
      eth: {
        token_decimals: 8,
        deposit_address: ADDR(0x5afe),
        cashout_address: CASHOUT,
        vouchers_enabled: true,
        deposits_enabled: true,
        global_daily_verse: global,
        hourly_release: false,
      },
    },
  });
}

async function giveVerse(user: string, amount: number): Promise<void> {
  await q(
    `INSERT INTO game.verse_wallet (user_id, balance) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = game.verse_wallet.balance + EXCLUDED.balance`,
    [user, amount],
  );
}

async function link(user: string, address: string, opts: { aged?: boolean } = {}): Promise<Record<string, unknown>> {
  const n = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [user, 'eth', address, 'hub.test', 'https://hub.test']);
  const res = await json('SELECT game.wallet_link_apply($1, $2, $3)', [user, n.nonce, address]);
  if (opts.aged) {
    await q("UPDATE game.wallet_link SET linked_at = now() - interval '73 hours' WHERE user_id = $1", [user]);
  }
  return res;
}

async function withdraw(user: string, amount: number, key = randomUUID()): Promise<Record<string, unknown>> {
  return json('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', amount, key, reqHash({ amount, chain: 'eth' })]);
}

async function balance(user: string): Promise<number> {
  const r = await one<{ balance: string } | undefined>('SELECT balance FROM game.verse_wallet WHERE user_id = $1', [user]);
  return r ? Number(r.balance) : 0;
}

before(async () => {
  sql = schemaSql();
});

describe('exchange schema', () => {
  before(async () => {
    db = await freshDb(sql);
    q = (text, params) => db.pool.query(text, params);
  });
  after(async () => {
    await db.drop();
  });

  test('ledger applies again without changes', async () => {
    await q(sql);
    const r = await one<{ n: string }>("SELECT count(*) AS n FROM game.schema_migrations WHERE id = '0004_crypto_exchange'");
    assert.equal(Number(r.n), 1);
  });

  test('everything is closed by default', async () => {
    const user = randomUUID();
    await giveVerse(user, 100);
    await link(user, ADDR(1), { aged: true });
    assert.equal((await withdraw(user, 1)).error, 'cashout_closed');
    await assert.rejects(q('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(1), 0, 1, ADDR(1), '100']), /deposit_chain_not_configured/);
    await q('DELETE FROM game.wallet_link WHERE user_id = $1', [user]);
  });

  test('config rejects unknown keys and logs every change', async () => {
    await assert.rejects(configure({ economy: { nope: 1 } }), /config_unknown_key/);
    await assert.rejects(configure({ chains: { sol: { chain_id: 1 } } }), /config_unknown_chain/);
    await assert.rejects(configure({ admin: true }), /config_unknown_key/);
    const before = await one<{ n: string }>('SELECT count(*) AS n FROM game.economy_config_log');
    await configure({ economy: { ref_usd_per_token: 0.1 } });
    const after = await one<{ n: string }>('SELECT count(*) AS n FROM game.economy_config_log');
    assert.equal(Number(after.n), Number(before.n) + 1);
    await assert.rejects(q('UPDATE game.economy_config_log SET set_by = $1', ['x']), /append_only/);
  });

  test('wallet link: signature, reuse, takeover and replacement', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const n = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [a, 'eth', ADDR(10), 'hub.test', 'https://hub.test']);
    assert.match(String(n.message), /Nonce: [0-9a-f]{64}/);
    assert.equal((await json('SELECT game.wallet_link_apply($1, $2, $3)', [b, n.nonce, ADDR(10)])).error, 'bad_nonce');
    assert.equal((await json('SELECT game.wallet_link_apply($1, $2, $3)', [a, n.nonce, ADDR(11)])).error, 'bad_signature');
    assert.equal((await json('SELECT game.wallet_link_apply($1, $2, $3)', [a, n.nonce, ADDR(10)])).error, 'bad_nonce', 'nonce is single use even after a bad signature');

    assert.equal((await link(a, ADDR(10))).changed, true);
    assert.equal((await link(b, ADDR(10))).error, 'address_taken');
    assert.equal((await link(a, ADDR(10))).changed, false);

    await q("UPDATE game.wallet_link SET linked_at = now() - interval '100 hours' WHERE user_id = $1", [a]);
    assert.equal((await link(a, ADDR(12))).changed, true);
    const row = await one<{ address: string; age: string }>(
      "SELECT address, extract(epoch FROM now() - linked_at) AS age FROM game.wallet_link WHERE user_id = $1",
      [a],
    );
    assert.equal(row.address, ADDR(12));
    assert.ok(Number(row.age) < 5, 'replacing a wallet restarts the hold');
    assert.equal((await link(b, ADDR(10))).changed, true, 'the replaced address is free again');

    const expired = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [a, 'eth', ADDR(13), 'hub.test', 'https://hub.test']);
    await q("UPDATE game.link_nonce SET expires_at = now() - interval '1 second' WHERE nonce = $1", [expired.nonce]);
    assert.equal((await json('SELECT game.wallet_link_apply($1, $2, $3)', [a, expired.nonce, ADDR(13)])).error, 'bad_nonce');
  });

  test('nonce creation is rate limited', async () => {
    const u = randomUUID();
    for (let i = 0; i < 10; i++) {
      await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [u, 'eth', ADDR(20), 'hub.test', 'https://hub.test']);
    }
    const r = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [u, 'eth', ADDR(20), 'hub.test', 'https://hub.test']);
    assert.equal(r.error, 'rate_limited');
  });

  test('withdraw: hold, balance, account lock, idempotency', async () => {
    await openCashout(50, 1000);
    const u = randomUUID();
    await giveVerse(u, 100);
    await link(u, ADDR(30));
    assert.equal((await withdraw(u, 5)).error, 'wallet_hold');
    await q("UPDATE game.wallet_link SET linked_at = now() - interval '73 hours' WHERE user_id = $1", [u]);
    assert.equal((await withdraw(u, 0)).error, 'bad_amount');
    assert.equal((await withdraw(u, 101)).error, 'insufficient_verse');

    const key = randomUUID();
    const first = await withdraw(u, 30, key);
    assert.equal(first.amount, 30);
    assert.equal(first.recipient, ADDR(30));
    assert.deepEqual(await withdraw(u, 30, key), first, 'same key returns the stored response');
    const mismatch = await json('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [u, 'eth', 31, key, reqHash({ amount: 31, chain: 'eth' })]);
    assert.equal(mismatch.error, 'idempotency_mismatch');
    assert.equal(await balance(u), 70);

    const over = await withdraw(u, 21);
    assert.equal(over.error, 'account_limit');
    assert.equal(over.accountRoom, 20);
    assert.equal((await withdraw(u, 20)).amount, 20);
    assert.equal((await withdraw(u, 1)).error, 'account_limit');
    assert.equal(await balance(u), 50);

    const w = await one<{ expiry: Date; created_at: Date; n: string }>(
      'SELECT max(expiry) AS expiry, max(created_at) AS created_at, count(*) AS n FROM game.withdrawal WHERE user_id = $1',
      [u],
    );
    assert.equal(Number(w.n), 2);
    const days = (w.expiry.getTime() - w.created_at.getTime()) / 86_400_000;
    assert.ok(days > 29.99 && days < 30.01, 'voucher expiry is 30 days');
  });

  test('withdraw: concurrent requests never pass the account lock', async () => {
    await openCashout(50, 100_000);
    const u = randomUUID();
    await giveVerse(u, 1000);
    await link(u, ADDR(40), { aged: true });
    const results = await Promise.all(Array.from({ length: 20 }, () => withdraw(u, 7)));
    const ok = results.filter((r) => r.amount === 7).length;
    assert.equal(ok, 7, '7 x 7 = 49 fits, the 8th would be 56');
    assert.equal(await balance(u), 1000 - 49);
  });

  test('withdraw: concurrent accounts never pass the global lock', async () => {
    await openCashout(50, 100_000);
    await q("DELETE FROM game.payout_window WHERE chain = 'eth'");
    await configure({ chains: { eth: { global_daily_verse: 100 } } });
    const users = Array.from({ length: 12 }, () => randomUUID());
    for (const [i, u] of users.entries()) {
      await giveVerse(u, 50);
      await link(u, ADDR(1000 + i), { aged: true });
    }
    const results = await Promise.all(users.map((u) => withdraw(u, 10)));
    assert.equal(results.filter((r) => r.amount === 10).length, 10);
    assert.equal(results.filter((r) => r.error === 'global_limit').length, 2);
    const used = await one<{ amount: string }>("SELECT amount FROM game.payout_window WHERE chain = 'eth' AND day = game.utc_day()");
    assert.equal(Number(used.amount), 100);
  });

  test('hourly release opens the global budget in slices', async () => {
    const r = await one<{ released: string; hour: string }>(
      "SELECT game.global_released(2400, true) AS released, extract(hour FROM now() AT TIME ZONE 'utc') AS hour",
    );
    assert.equal(Number(r.released), (Number(r.hour) + 1) * 100);
    const full = await one<{ released: string }>('SELECT game.global_released(2400, false) AS released');
    assert.equal(Number(full.released), 2400);
  });

  test('voucher signing only stores signatures for the exact pending fields', async () => {
    await openCashout(50, 100_000);
    const u = randomUUID();
    await giveVerse(u, 50);
    await link(u, ADDR(50), { aged: true });
    const w = await withdraw(u, 9);
    const pending = (await q('SELECT * FROM game.voucher_pending($1, $2)', ['eth', 1000])).rows.find((r) => String(r.id) === w.withdrawalId);
    assert.ok(pending);
    const args = [pending.id, pending.chain_id, pending.cashout_address, pending.recipient, pending.amount, pending.expiry];
    await assert.rejects(
      q('SELECT game.voucher_store_signature($1,$2,$3,$4,$5,$6,$7)', [args[0], args[1], args[2], args[3], 10, args[5], SIG]),
      /voucher_mismatch/,
    );
    await q('SELECT game.voucher_store_signature($1,$2,$3,$4,$5,$6,$7)', [...args, SIG]);
    const again = await json('SELECT game.voucher_store_signature($1,$2,$3,$4,$5,$6,$7)', [...args, SIG]);
    assert.equal(again.status, 'signed');
    const other = await json('SELECT game.voucher_store_signature($1,$2,$3,$4,$5,$6,$7)', [...args, '0x' + 'cd'.repeat(65)]);
    assert.equal(other.skipped, true);
    await assert.rejects(q("UPDATE game.withdrawal SET amount = 1000 WHERE id = $1", [pending.id]), /withdrawal_immutable/);
    await assert.rejects(q("UPDATE game.withdrawal SET signature = $2 WHERE id = $1", [pending.id, '0x' + 'cd'.repeat(65)]), /withdrawal_immutable/);
    await assert.rejects(q('DELETE FROM game.withdrawal WHERE id = $1', [pending.id]), /append_only/);
  });

  test('claims, unknown claims and expiry refunds', async () => {
    await openCashout(50, 100_000);
    const u = randomUUID();
    await giveVerse(u, 50);
    await link(u, ADDR(60), { aged: true });
    const paid = await withdraw(u, 10);
    const lapsed = await withdraw(u, 15);
    for (const r of (await q('SELECT * FROM game.voucher_pending($1, $2)', ['eth', 1000])).rows) {
      await q('SELECT game.voucher_store_signature($1,$2,$3,$4,$5,$6,$7)', [r.id, r.chain_id, r.cashout_address, r.recipient, r.amount, r.expiry, SIG]);
    }
    const claim = await json('SELECT game.claim_record($1,$2,$3,$4,$5,$6,$7)', ['eth', CASHOUT, paid.withdrawalId, ADDR(60), 10, TX(1), 100]);
    assert.equal(claim.status, 'claimed');
    const dup = await json('SELECT game.claim_record($1,$2,$3,$4,$5,$6,$7)', ['eth', CASHOUT, paid.withdrawalId, ADDR(60), 10, TX(1), 100]);
    assert.equal(dup.duplicate, true);
    for (const bad of [
      [CASHOUT, '99999999', ADDR(60), 10],
      [CASHOUT, lapsed.withdrawalId, ADDR(60), 16],
      [CASHOUT, lapsed.withdrawalId, ADDR(61), 15],
      [ADDR(0xbad), lapsed.withdrawalId, ADDR(60), 15],
      [CASHOUT, '340282366920938463463374607431768211456', ADDR(60), 15],
    ]) {
      const r = await json('SELECT game.claim_record($1,$2,$3,$4,$5,$6,$7)', ['eth', bad[0], bad[1], bad[2], bad[3], TX(2), 101]);
      assert.equal(r.alert, 'unknown_claim');
    }
    assert.equal(await balance(u), 25);

    // No refund while the claims stream has not passed the expiry.
    await q('SELECT game.cursor_set($1, $2, $3, $4)', ['eth', 'claims', 200, new Date()]);
    assert.equal(Number((await one<{ n: number }>('SELECT game.voucher_expire($1, $2) AS n', ['eth', 100])).n), 0);
    await q('SELECT game.cursor_set($1, $2, $3, $4)', ['eth', 'claims', 300, new Date(Date.now() + 31 * 86_400_000)]);
    assert.ok(Number((await one<{ n: number }>('SELECT game.voucher_expire($1, $2) AS n', ['eth', 1000])).n) >= 1);
    assert.equal(await balance(u), 40, 'only the unclaimed voucher is refunded');
    const states = await q('SELECT id::text, status FROM game.withdrawal WHERE user_id = $1 ORDER BY id', [u]);
    assert.deepEqual(states.rows.map((x) => x.status), ['claimed', 'refunded']);
    assert.equal(Number((await one<{ n: number }>('SELECT game.voucher_expire($1, $2) AS n', ['eth', 1000])).n), 0, 'refund happens once');
    assert.equal(await balance(u), 40);
    const room = await json('SELECT game.wallet_status($1)', [u]);
    assert.equal(room.accountRoom, 25, 'an expired voucher does not give daily room back');

    // A cursor never moves backwards.
    await q('SELECT game.cursor_set($1, $2, $3, $4)', ['eth', 'claims', 250, new Date()]);
    assert.equal(Number((await one<{ b: string }>("SELECT game.cursor_get('eth', 'claims') AS b")).b), 300);

    const late = await json('SELECT game.claim_record($1,$2,$3,$4,$5,$6,$7)', ['eth', CASHOUT, lapsed.withdrawalId, ADDR(60), 15, TX(3), 301]);
    assert.equal(late.alert, 'claim_after_refund');
    const alerts = await one<{ n: string }>("SELECT count(*) AS n FROM game.chain_alert WHERE kind IN ('unknown_claim', 'claim_after_refund')");
    assert.equal(Number(alerts.n), 6);
  });

  test('deposits: 1 Verse per whole token, dust, duplicates, unmatched, held', async () => {
    await openCashout();
    const u = randomUUID();
    await link(u, ADDR(70));
    const before = await balance(u);
    const d1 = await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(70), 0, 10, ADDR(70), (5n * UNIT + UNIT / 2n).toString()]);
    assert.equal(d1.verse, 5);
    const dup = await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(70), 0, 10, ADDR(70), (5n * UNIT).toString()]);
    assert.equal(dup.duplicate, true);
    const d2 = await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(71), 3, 11, ADDR(70), (UNIT / 2n).toString()]);
    assert.equal(d2.verse, 1, 'two half tokens make one Verse');
    assert.equal(await balance(u), before + 6);
    await assert.rejects(q('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(72), 0, 12, ADDR(70), '1.5']), /deposit_bad_amount/);

    const stranger = await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(73), 0, 13, ADDR(71), (3n * UNIT).toString()]);
    assert.equal(stranger.status, 'unmatched');
    const v = randomUUID();
    await link(v, ADDR(71));
    assert.equal(Number((await one<{ n: number }>("SELECT game.deposit_settle_pending('eth', 100) AS n")).n), 1);
    assert.equal(await balance(v), 3, 'a deposit from an address linked later is credited to that account');

    await configure({ chains: { eth: { deposits_enabled: false } } });
    const held = await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(74), 0, 14, ADDR(70), (2n * UNIT).toString()]);
    assert.equal(held.status, 'held');
    assert.equal(Number((await one<{ n: number }>("SELECT game.deposit_settle_pending('eth', 100) AS n")).n), 0);
    await configure({ chains: { eth: { deposits_enabled: true } } });
    assert.equal(Number((await one<{ n: number }>("SELECT game.deposit_settle_pending('eth', 100) AS n")).n), 1);
    assert.equal(await balance(u), before + 8);
    await assert.rejects(configure({ chains: { eth: { token_decimals: 18 } } }), /config_decimals_locked/);

    const ledger = await one<{ n: string }>("SELECT count(*) AS n FROM game.verse_ledger WHERE user_id = $1 AND source = 'deposit:eth'", [u]);
    assert.equal(Number(ledger.n), 3);
    const earned = await one<{ n: string }>('SELECT count(*) AS n FROM game.verse_earned WHERE user_id = $1', [u]);
    assert.equal(Number(earned.n), 0, 'bought Verse never reaches the scoreboard');
  });

  test('purchase intents are paid by a matching deposit', async () => {
    await openCashout();
    const u = randomUUID();
    await link(u, ADDR(80));
    const intent = await json('SELECT game.purchase_intent_create($1, $2, $3, $4)', [u, 'eth', 'pet_hopium_sproto', 400]);
    assert.equal(intent.tokenAmount, (400n * UNIT).toString());
    await json('SELECT game.deposit_record($1,$2,$3,$4,$5,$6)', ['eth', TX(80), 0, 20, ADDR(80), (400n * UNIT).toString()]);
    const status = await one<{ status: string }>('SELECT status FROM game.purchase_intent WHERE intent_id = $1', [intent.intentId]);
    assert.equal(status.status, 'paid');
    const noWallet = await json('SELECT game.purchase_intent_create($1, $2, $3, $4)', [randomUUID(), 'eth', 'x', 1]);
    assert.equal(noWallet.error, 'no_wallet');
  });

  test('hub_chain role reaches only the chain functions', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('SET ROLE hub_chain');
      await c.query("SELECT game.cursor_get('eth', 'deposits')");
      await c.query("SELECT game.cashout_watch_list('eth')");
      for (const stmt of [
        "SELECT game.withdraw_verse(gen_random_uuid(), 'eth', 1, 'k', '00')",
        "SELECT game.economy_config_set('{}'::jsonb, 'x')",
        "SELECT game.wallet_link_apply(gen_random_uuid(), 'n', '0x')",
        "SELECT game.exchange_tickets(gen_random_uuid(), gen_random_uuid(), 'sproto', 10, 'k', '00')",
        'SELECT * FROM game.verse_wallet',
        'UPDATE game.verse_wallet SET balance = 0',
      ]) {
        await assert.rejects(c.query(stmt), /permission denied/, stmt);
      }
    } finally {
      await c.query('RESET ROLE');
      c.release();
    }
  });

  test('wallet status shows the open voucher with its signature', async () => {
    await openCashout(50, 100_000);
    const u = randomUUID();
    await giveVerse(u, 20);
    await link(u, ADDR(90), { aged: true });
    await withdraw(u, 4);
    const s = await json('SELECT game.wallet_status($1)', [u]);
    assert.equal(s.verse, 16);
    assert.equal((s.wallet as { address: string }).address, ADDR(90));
    const vouchers = s.vouchers as { amount: number; status: string }[];
    assert.equal(vouchers.length, 1);
    assert.equal(vouchers[0].amount, 4);
    assert.equal(vouchers[0].status, 'issued');
    assert.equal((s.chain as { cashoutOpen: boolean }).cashoutOpen, true);
  });
});
