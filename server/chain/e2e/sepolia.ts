// End-to-end run of the $BITCOIN <-> Verse exchange on Sepolia: real contracts, real chain
// service process (watcher + signer + /verify), real Postgres with the Nakama module's schema.
//
// The hub side calls the same SQL functions, with the same arguments, as the Nakama wallet RPCs
// in server/modules/src/wallet.ts (wallet.nonce, wallet.link via POST /verify, wallet.withdraw,
// store.intent, wallet.status). Nakama itself is not started.
//
//   EXCHANGE_TEST_DB      Postgres superuser URL; a throwaway database is created and dropped
//   SEPOLIA_RPC_URL       Sepolia RPC
//   SEPOLIA_DEPLOYER_KEY  funds the player and the float, and is the deposit address (treasury)
//   SEPOLIA_SIGNER_KEY    voucher signer key (SIGNER=local); must be the cashout's signer
//   E2E_TOKEN, E2E_CASHOUT  default to the deployment recorded in contracts/README.md
//   E2E_KEEP_DB=1         keep the database for inspection
//
// Run: npm run e2e:sepolia   (takes ~30-45 minutes: every step waits for Sepolia finality)
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicClient, createWalletClient, getAddress, http, parseAbi, parseEther,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { freshDb, schemaSql } from '../../test/exchange/db.ts';
import { CASHOUT_ABI } from '../src/voucher.ts';

const CHAIN_ID = 11155111;
const TOKEN = getAddress(process.env.E2E_TOKEN ?? '0x6FC7448C65B150ea5E44D38DE4c5C06C3a971f89');
const CASHOUT = getAddress(process.env.E2E_CASHOUT ?? '0x2438f28692b0e21255a659219FD2FD24559B5c97');
const UNIT = 10n ** 8n;
const ERC20 = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}
const hexKey = (v: string) => (v.startsWith('0x') ? v : '0x' + v) as Hex;

const rpcUrl = need('SEPOLIA_RPC_URL');
const treasury = privateKeyToAccount(hexKey(need('SEPOLIA_DEPLOYER_KEY')));
const signerKey = hexKey(need('SEPOLIA_SIGNER_KEY'));
const signerAddr = privateKeyToAccount(signerKey).address;
const player = privateKeyToAccount(('0x' + randomBytes(32).toString('hex')) as Hex);
const stranger = privateKeyToAccount(('0x' + randomBytes(32).toString('hex')) as Hex);

const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 5 }) });
const treasuryWallet = createWalletClient({ account: treasury, chain: sepolia, transport: http(rpcUrl) });
const playerWallet = createWalletClient({ account: player, chain: sepolia, transport: http(rpcUrl) });

const t0 = Date.now();
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), token: TOKEN, cashout: CASHOUT, player: player.address, treasury: treasury.address, signer: signerAddr, txs: {} as Record<string, string>, steps: [] as string[] };
const txs = report.txs as Record<string, string>;
function step(line: string): void {
  const s = `[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${line}`;
  console.log(s);
  (report.steps as string[]).push(s);
}

async function send(label: string, p: Promise<Hex>): Promise<Hex> {
  const hash = await p;
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  assert.equal(r.status, 'success', `${label} reverted (${hash})`);
  txs[label] = hash;
  step(`${label}: ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  return hash;
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs = 45 * 60_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let lastLog = 0;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    if (Date.now() - lastLog > 120_000) {
      const fin = await pub.getBlock({ blockTag: 'finalized' });
      step(`  waiting for ${what} (finalized block ${fin.number})`);
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 6_000));
  }
}

async function main(): Promise<void> {
  // ---- Preconditions: the contracts are the ones this run expects ---------------------------
  assert.equal(await pub.getChainId(), CHAIN_ID, 'SEPOLIA_RPC_URL is not Sepolia');
  assert.equal(getAddress(await pub.readContract({ address: CASHOUT, abi: CASHOUT_ABI, functionName: 'token' })), TOKEN);
  assert.equal(getAddress(await pub.readContract({ address: CASHOUT, abi: CASHOUT_ABI, functionName: 'signer' })), signerAddr, 'SEPOLIA_SIGNER_KEY is not the cashout signer');
  assert.equal(await pub.readContract({ address: CASHOUT, abi: CASHOUT_ABI, functionName: 'unit' }), UNIT);
  assert.equal(await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'decimals' }), 8);
  step(`contracts ok: token ${TOKEN}, cashout ${CASHOUT}, signer ${signerAddr}`);
  step(`player ${player.address} (fresh key), treasury/deposit address ${treasury.address}`);

  // ---- Database with the module schema; the service logs in with only hub_chain -------------
  const db = await freshDb(schemaSql());
  const owner = db.pool;
  const login = 'chain_' + randomUUID().slice(0, 8);
  await owner.query(`CREATE ROLE ${login} LOGIN IN ROLE hub_chain`);
  report.database = db.url.replace(/^.*\//, '');
  const json = async (sql: string, params: unknown[]) => Object.values((await owner.query(sql, params)).rows[0])[0] as Record<string, unknown>;
  const configSet = (patch: unknown, why: string) => json('SELECT game.economy_config_set($1::jsonb, $2)', [JSON.stringify(patch), 'e2e-sepolia: ' + why]);

  await configSet({
    economy: { account_daily_verse: 20, link_hold: '0 seconds' },
    chains: { eth: { chain_id: CHAIN_ID, token_address: TOKEN, token_decimals: 8, deposit_address: treasury.address, cashout_address: CASHOUT, deposits_enabled: true, vouchers_enabled: true, global_daily_verse: 500, hourly_release: false } },
  }, 'Sepolia config; link hold 0 so the run does not wait 72 hours');
  step(`database ${report.database} configured (account lock 20 Verse/day, global 500, link hold 0)`);

  // ---- Chain service process -----------------------------------------------------------------
  const startBlock = await pub.getBlockNumber();
  const serviceKey = randomBytes(24).toString('hex');
  const port = 18090 + Math.floor(Math.random() * 500);
  const dir = mkdtempSync(join(tmpdir(), 'e2e-sepolia-'));
  const logFile = join(dir, 'chain-service.log');
  const logStream = createWriteStream(logFile);
  const service: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: db.url.replace('postgres@', `${login}@`),
      RPC_URL: rpcUrl,
      CHAIN_SERVICE_KEY: serviceKey,
      PORT: String(port),
      POLL_MS: '6000',
      START_BLOCK: startBlock.toString(),
      SIGNER: 'local',
      SIGNER_PRIVATE_KEY: signerKey,
      SIGNER_DAILY_MAX_VERSE: '100',
      SIGNER_MAX_VOUCHER_VERSE: '50',
      SIGNER_STATE_FILE: join(dir, 'signer-state.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.stdout!.pipe(logStream);
  service.stderr!.pipe(logStream);
  service.stdout!.on('data', (b: Buffer) => process.stdout.write(b.toString().replace(/^(?=.)/gm, '    svc| ')));
  service.stderr!.on('data', (b: Buffer) => process.stdout.write(b.toString().replace(/^(?=.)/gm, '    svc! ')));
  let exited: number | null = null;
  service.on('exit', (code) => { exited = code ?? -1; });
  report.serviceLog = logFile;
  const base = `http://127.0.0.1:${port}`;
  const health = await waitFor('chain service /health', async () => {
    if (exited !== null) throw new Error(`chain service exited with ${exited}; see ${logFile}`);
    try { return (await (await fetch(base + '/health')).json()) as { chainId: number; signer: string; halted: string | null }; } catch { return null; }
  }, 120_000);
  assert.equal(health.chainId, CHAIN_ID);
  assert.equal(getAddress(health.signer), signerAddr);
  step(`chain service up on :${port}, START_BLOCK ${startBlock}`);

  try {
    const user = randomUUID();
    const status = () => json('SELECT game.wallet_status($1)', [user]);
    const verse = async () => Number((await status()).verse);
    const verify = async (message: string, signature: Hex) => {
      const res = await fetch(base + '/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chain-service-key': serviceKey }, body: JSON.stringify({ message, signature }) });
      return { code: res.status, body: (await res.json()) as { address?: string } };
    };

    // ---- wallet.nonce + wallet.link (SIWE through POST /verify) ------------------------------
    const unauth = await fetch(base + '/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-chain-service-key': 'wrong' }, body: '{}' });
    assert.equal(unauth.status, 401, '/verify without the service key');
    const n = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [user, 'eth', player.address, 'hub.e2e', 'https://hub.e2e/hub/']);
    // A signature from another key recovers a different address and the link is refused.
    const forged = await verify(String(n.message), await stranger.signMessage({ message: String(n.message) }));
    const refused = await json('SELECT game.wallet_link_apply($1, $2, $3)', [user, n.nonce, forged.body.address ?? '0x' + '0'.repeat(40)]);
    assert.ok(refused.error, 'link with a stranger signature must fail');
    const n2 = await json('SELECT game.link_nonce_create($1, $2, $3, $4, $5)', [user, 'eth', player.address, 'hub.e2e', 'https://hub.e2e/hub/']);
    const good = await verify(String(n2.message), await player.signMessage({ message: String(n2.message) }));
    assert.equal(good.code, 200);
    assert.equal(good.body.address, player.address.toLowerCase());
    const linked = await json('SELECT game.wallet_link_apply($1, $2, $3)', [user, n2.nonce, good.body.address]);
    assert.ok(!linked.error, `link failed: ${JSON.stringify(linked)}`);
    step(`wallet linked via /verify (stranger signature refused: ${String(refused.error)})`);

    // ---- Funding: player gas + tokens, cashout float ------------------------------------------
    const floatBefore = await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [CASHOUT] });
    await send('fund player ETH', treasuryWallet.sendTransaction({ to: player.address, value: parseEther('0.003') }));
    await send('fund player 500 tBITCOIN', treasuryWallet.writeContract({ address: TOKEN, abi: ERC20, functionName: 'transfer', args: [player.address, 500n * UNIT] }));
    await send('refill float +20 tBITCOIN', treasuryWallet.writeContract({ address: TOKEN, abi: ERC20, functionName: 'transfer', args: [CASHOUT, 20n * UNIT] }));

    // ---- store.intent, then two deposits: 30 (plain) and 400 (pays the intent) ----------------
    const intent = await json('SELECT game.purchase_intent_create($1, $2, $3, $4)', [user, 'eth', 'pet_hopium_sproto', 400]);
    assert.ok(!intent.error, JSON.stringify(intent));
    assert.equal(intent.tokenAmount, (400n * UNIT).toString());
    assert.equal(getAddress(String(intent.depositAddress)), treasury.address);
    step(`purchase intent ${String(intent.intentId)}: 400 Verse = ${String(intent.tokenAmount)} base units to ${String(intent.depositAddress)}`);
    await send('deposit 30', playerWallet.writeContract({ address: TOKEN, abi: ERC20, functionName: 'transfer', args: [treasury.address, 30n * UNIT] }));
    await send('deposit 400 (intent)', playerWallet.writeContract({ address: TOKEN, abi: ERC20, functionName: 'transfer', args: [treasury.address, 400n * UNIT] }));

    await waitFor('both deposits credited after finality', async () => (await verse()) === 430);
    const s1 = await status();
    const deposits = s1.deposits as { tx: string; verse: number; status: string }[];
    assert.equal(deposits.length, 2);
    assert.ok(deposits.every((d) => d.status === 'credited'));
    const intents = s1.intents as { intentId: string; status: string }[];
    assert.equal(intents.find((i) => i.intentId === intent.intentId)?.status, 'paid', 'the 400 deposit pays the intent');
    step('deposits credited: 430 Verse; purchase intent paid');

    // ---- wallet.withdraw 12 -> signer -> claim on chain -> watcher records the claim ---------
    const reqHash = (amount: number) => createHash('sha256').update('wallet.withdraw\n' + JSON.stringify({ amount, chain: 'eth' })).digest('hex');
    const withdraw = (amount: number, key: string) => json('SELECT game.withdraw_verse($1, $2, $3, $4, $5)', [user, 'eth', amount, key, reqHash(amount)]);
    const k1 = randomUUID();
    const w1 = await withdraw(12, k1);
    assert.ok(!w1.error, JSON.stringify(w1));
    assert.deepEqual(await withdraw(12, k1), w1, 'idempotent retry returns the same voucher');
    assert.equal((await withdraw(13, k1)).error, 'idempotency_mismatch');
    assert.equal(await verse(), 418, 'one debit for the retried request');
    step(`withdraw 12 -> voucher ${String(w1.withdrawalId)}; retry with same key returned the same voucher`);

    type V = { id: string; amount: number; expiry: number; status: string; signature: Hex | null; claimTx: string | null };
    const voucher = async (id: unknown) => ((await status()).vouchers as V[]).find((v) => v.id === String(id))!;
    const v1 = await waitFor('voucher 1 signed', async () => { const v = await voucher(w1.withdrawalId); return v.status === 'signed' && v.signature ? v : null; }, 5 * 60_000);
    step(`voucher ${v1.id} signed by the chain service`);

    const claimArgs = [{ id: BigInt(v1.id), recipient: player.address, amount: BigInt(v1.amount), expiry: BigInt(v1.expiry) }, v1.signature!] as const;
    // Only the recipient can claim.
    await assert.rejects(pub.simulateContract({ account: stranger.address, address: CASHOUT, abi: CASHOUT_ABI, functionName: 'claim', args: claimArgs }), /NotRecipient|revert/);
    const balBefore = await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [player.address] });
    const claimTx = await send('claim voucher 1', playerWallet.writeContract({ address: CASHOUT, abi: CASHOUT_ABI, functionName: 'claim', args: claimArgs }));
    const balAfter = await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [player.address] });
    assert.equal(balAfter - balBefore, 12n * UNIT, 'player received exactly 12 tokens');
    await assert.rejects(pub.simulateContract({ account: player.address, address: CASHOUT, abi: CASHOUT_ABI, functionName: 'claim', args: claimArgs }), /AlreadyClaimed|revert/);
    step('claim paid exactly 12 tBITCOIN; a second claim of the same voucher reverts');

    // ---- Account lock, and a short-lived voucher that expires unclaimed -> refund -------------
    const over = await withdraw(10, randomUUID());
    assert.equal(over.error, 'account_limit', JSON.stringify(over));
    step(`withdraw 10 refused: account_limit (room ${String(over.accountRoom)})`);
    await configSet({ economy: { voucher_ttl: '2 minutes' } }, 'short TTL to exercise expiry refund');
    const w2 = await withdraw(5, randomUUID());
    assert.ok(!w2.error, JSON.stringify(w2));
    await configSet({ economy: { voucher_ttl: '30 days' } }, 'restore TTL');
    const v2 = await waitFor('voucher 2 signed', async () => { const v = await voucher(w2.withdrawalId); return v.status === 'signed' ? v : null; }, 5 * 60_000);
    assert.equal(await verse(), 413);
    step(`withdraw 5 -> voucher ${v2.id} signed, expiry ${new Date(v2.expiry * 1000).toISOString()}; not claimed`);

    await waitFor('voucher 1 recorded as claimed', async () => { const v = await voucher(w1.withdrawalId); return v.status === 'claimed' ? v : null; });
    const claimed = await voucher(w1.withdrawalId);
    assert.equal(claimed.claimTx?.toLowerCase(), claimTx.toLowerCase());
    step(`watcher recorded voucher ${v1.id} claimed in ${claimTx}`);

    await waitFor('voucher 2 refunded after expiry', async () => (await voucher(w2.withdrawalId)).status === 'refunded');
    await assert.rejects(
      pub.simulateContract({ account: player.address, address: CASHOUT, abi: CASHOUT_ABI, functionName: 'claim', args: [{ id: BigInt(v2.id), recipient: player.address, amount: 5n, expiry: BigInt(v2.expiry) }, v2.signature!] }),
      /Expired|revert/,
    );
    assert.equal(await verse(), 418, '5 Verse refunded');
    step(`voucher ${v2.id} refunded (5 Verse back; the chain refuses it as Expired)`);

    // ---- Final checks ---------------------------------------------------------------------------
    const floatAfter = await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [CASHOUT] });
    assert.equal(floatAfter, floatBefore + 20n * UNIT - 12n * UNIT, 'float moved by refill minus claim only');
    const alerts = (await owner.query('SELECT kind, detail FROM game.chain_alert ORDER BY seq')).rows;
    assert.deepEqual(alerts, [], `unexpected alerts ${JSON.stringify(alerts)}`);
    const h = (await (await fetch(base + '/health')).json()) as { halted: string | null; last: { ok: boolean } };
    assert.equal(h.halted, null);
    assert.equal(h.last.ok, true);
    const ledger = (await owner.query('SELECT delta, source FROM game.verse_ledger WHERE user_id = $1 ORDER BY seq', [user])).rows;
    report.ledger = ledger;
    report.final = { verse: await verse(), float: (floatAfter / UNIT).toString(), alerts: alerts.length, halted: h.halted };
    step(`PASS: verse 418, float ${floatAfter / UNIT} tBITCOIN, no alerts, signer not halted`);
    report.result = 'pass';
  } catch (e) {
    report.result = 'fail';
    report.error = String(e instanceof Error ? e.stack : e);
    throw e;
  } finally {
    service.kill('SIGTERM');
    report.finishedAt = new Date().toISOString();
    const out = process.env.E2E_REPORT ?? join(dir, 'report.json');
    writeFileSync(out, JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    console.log(`report: ${out}\nservice log: ${logFile}`);
    if (process.env.E2E_KEEP_DB !== '1') await db.drop();
    else await owner.end();
  }
}

await main();
