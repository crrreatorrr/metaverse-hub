// Watcher + signer against a real Postgres and a fake chain. The service connects as a login
// that only has the hub_chain role, the same as production.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { getAddress, recoverAddress, type Address, type Hex } from 'viem';
import { freshDb, schemaSql, type TestDb } from '../../test/exchange/db.ts';
import { ChainDb } from '../src/db.ts';
import { SignerGuard } from '../src/guard.ts';
import type { ChainReader, ClaimLog, TransferLog } from '../src/reader.ts';
import { localSigner } from '../src/signer.ts';
import { voucherDigest } from '../src/voucher.ts';
import { Watcher } from '../src/watcher.ts';

const KEY = ('0x' + '42'.repeat(32)) as Hex;
const signer = localSigner(KEY);
const SAFE = getAddress('0x' + '5a'.repeat(20));
const CASHOUT = getAddress('0x' + 'c0'.repeat(20));
const PLAYER = getAddress('0x' + '11'.repeat(20));
const UNIT = 10n ** 8n;
const tx = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;

class FakeChain implements ChainReader {
  id = 11155111;
  head = 25n;
  headTime = new Date();
  transferLogs: TransferLog[] = [];
  claimLogs: ClaimLog[] = [];
  claimedIds = new Set<bigint>();
  signers = new Map<string, Address>([[CASHOUT, signer.address]]);
  async chainId() { return this.id; }
  async finalized() { return { number: this.head, time: this.headTime }; }
  async blockTime() { return this.headTime; }
  async transfers(_t: Address, _to: Address, a: bigint, b: bigint) {
    return this.transferLogs.filter((l) => l.blockNumber >= a && l.blockNumber <= b);
  }
  async claims(cashouts: Address[], a: bigint, b: bigint) {
    return this.claimLogs.filter((l) => cashouts.includes(l.address) && l.blockNumber >= a && l.blockNumber <= b);
  }
  async isClaimed(_c: Address, id: bigint) { return this.claimedIds.has(id); }
  async cashoutSigner(c: Address) { return this.signers.get(c) ?? getAddress('0x' + '00'.repeat(20)); }
}

let db: TestDb;
let owner: pg.Pool;
let chainDb: ChainDb;
const alerts: string[] = [];

async function ownerJson(sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  return Object.values((await owner.query(sql, params)).rows[0])[0] as Record<string, unknown>;
}

function watcher(chain: FakeChain, guard: SignerGuard) {
  return new Watcher({
    chain: 'eth', db: chainDb, reader: chain, signer, guard, maxBlockRange: 7n, startBlock: 1n,
    log: () => {}, onAlert: async (kind) => { alerts.push(kind); },
  });
}

function newGuard() {
  return new SignerGuard(join(mkdtempSync(join(tmpdir(), 'w-')), 's.json'), 1000, 100, 31 * 86_400);
}

before(async () => {
  db = await freshDb(schemaSql());
  owner = db.pool;
  const login = 'chain_' + randomUUID().slice(0, 8);
  await owner.query(`CREATE ROLE ${login} LOGIN IN ROLE hub_chain`);
  chainDb = new ChainDb(new pg.Pool({ connectionString: db.url.replace('postgres@', `${login}@`), max: 2 }));
  await owner.query('SELECT game.economy_config_set($1::jsonb, $2)', [JSON.stringify({
    economy: { account_daily_verse: 50 },
    chains: { eth: { chain_id: 11155111, token_decimals: 8, deposit_address: SAFE, cashout_address: CASHOUT,
      deposits_enabled: true, vouchers_enabled: true, global_daily_verse: 500, hourly_release: false } },
  }), 'test']);
});

after(async () => {
  await chainDb.close();
  await db.drop();
});

test('deposit -> Verse, withdraw -> signed voucher -> claim, expiry -> refund, security halt', async () => {
  const chain = new FakeChain();
  const guard = newGuard();
  const w = watcher(chain, guard);
  const user = randomUUID();
  const n = await ownerJson('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [user, 'eth', PLAYER, 'hub.test', 'https://hub.test']);
  await ownerJson('SELECT game.wallet_link_apply($1, $2, $3)', [user, n.nonce, PLAYER]);
  await owner.query("UPDATE game.wallet_link SET linked_at = now() - interval '73 hours' WHERE user_id = $1", [user]);

  // A 30-token deposit in block 20 and a stranger's in block 21.
  chain.transferLogs.push({ txHash: tx(1), logIndex: 0, blockNumber: 20n, from: PLAYER, value: 30n * UNIT });
  chain.transferLogs.push({ txHash: tx(2), logIndex: 4, blockNumber: 21n, from: getAddress('0x' + '99'.repeat(20)), value: UNIT });
  let r = await w.tick();
  assert.equal(r.deposits, 2);
  const verse = async () => Number((await owner.query('SELECT balance FROM game.verse_wallet WHERE user_id = $1', [user])).rows[0]?.balance ?? 0);
  assert.equal(await verse(), 30);
  r = await w.tick();
  assert.equal(r.deposits, 0, 'cursor moved; nothing is credited twice');
  assert.equal(await verse(), 30);

  // Cash out 12 and 8: the signer signs both and each signature recovers to our key.
  const key = () => randomUUID();
  const hash = (amount: number) => createHash('sha256').update('wallet.withdraw\n' + JSON.stringify({ amount, chain: 'eth' })).digest('hex');
  const w1 = await ownerJson('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', 12, key(), hash(12)]);
  const w2 = await ownerJson('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', 8, key(), hash(8)]);
  r = await w.tick();
  assert.equal(r.signed, 2);
  const status = await ownerJson('SELECT game.wallet_status($1)', [user]);
  const vouchers = status.vouchers as { id: string; amount: number; expiry: number; signature: Hex; status: string }[];
  for (const v of vouchers) {
    assert.equal(v.status, 'signed');
    const digest = voucherDigest(11155111, CASHOUT, { id: BigInt(v.id), recipient: PLAYER, amount: BigInt(v.amount), expiry: BigInt(v.expiry) });
    assert.equal(await recoverAddress({ hash: digest, signature: v.signature }), signer.address);
  }

  // The player claims voucher 1 in block 30.
  chain.head = 40n;
  chain.claimLogs.push({ address: CASHOUT, txHash: tx(3), blockNumber: 30n, logIndex: 0, id: BigInt(String(w1.withdrawalId)), recipient: PLAYER, amount: 12n });
  chain.claimedIds.add(BigInt(String(w1.withdrawalId)));
  r = await w.tick();
  assert.equal(r.claims, 1);

  // 31 days later voucher 2 is past expiry and unclaimed on chain: refunded once.
  chain.head = 50n;
  chain.headTime = new Date(Date.now() + 31 * 86_400_000);
  r = await w.tick();
  assert.equal(r.refunds, 1);
  assert.equal(await verse(), 30 - 12);
  const rows = (await owner.query('SELECT voucher_id::text AS vid, status FROM game.withdrawal WHERE user_id = $1 ORDER BY id', [user])).rows;
  assert.deepEqual(rows.map((x) => [x.vid, x.status]), [[String(w1.withdrawalId), 'claimed'], [String(w2.withdrawalId), 'refunded']]);

  // A Claimed event that matches no voucher halts the signer. (The fake clock returns to now
  // so later vouchers are not already past the claims cursor's time.)
  chain.head = 60n;
  chain.headTime = new Date();
  chain.claimLogs.push({ address: CASHOUT, txHash: tx(4), blockNumber: 55n, logIndex: 0, id: 777n, recipient: PLAYER, amount: 1n });
  await w.tick();
  assert.ok(alerts.includes('unknown_claim'));
  assert.equal(guard.halted, 'unknown_claim');
  await ownerJson('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', 1, key(), hash(1)]);
  r = await w.tick();
  assert.equal(r.signed, 0, 'a halted signer signs nothing');
});

test('no signing for a cashout contract that does not use our key, or a mismatched chain', async () => {
  const chain = new FakeChain();
  chain.signers.set(CASHOUT, getAddress('0x' + 'ee'.repeat(20)));
  const guard = newGuard();
  const w = watcher(chain, guard);
  const user = randomUUID();
  const addr = getAddress('0x' + '22'.repeat(20));
  const n = await ownerJson('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [user, 'eth', addr, 'hub.test', 'https://hub.test']);
  await ownerJson('SELECT game.wallet_link_apply($1, $2, $3)', [user, n.nonce, addr]);
  await owner.query("UPDATE game.wallet_link SET linked_at = now() - interval '73 hours' WHERE user_id = $1", [user]);
  await owner.query('INSERT INTO game.verse_wallet (user_id, balance) VALUES ($1, 10)', [user]);
  const h = createHash('sha256').update('wallet.withdraw\n' + JSON.stringify({ amount: 5, chain: 'eth' })).digest('hex');
  await ownerJson('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', 5, randomUUID(), h]);
  const r = await w.tick();
  assert.equal(r.signed, 0);
  assert.ok(alerts.includes('cashout_signer_mismatch'));

  chain.id = 1;
  await assert.rejects(w.tick(), /RPC is chain 1/);
  assert.ok(alerts.includes('rpc_chain_mismatch'));
});

test('the hub_chain login cannot touch balances or config', async () => {
  for (const sql of ['SELECT * FROM game.verse_wallet', "SELECT game.economy_config_set('{}'::jsonb, 'x')", 'DELETE FROM game.withdrawal']) {
    await assert.rejects(chainDb.pool.query(sql), /permission denied/);
  }
});
