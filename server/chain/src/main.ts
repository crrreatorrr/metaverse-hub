// Chain service entry: the /verify endpoint plus the watcher/signer loop.
import { loadConfig } from './config.ts';
import { ChainDb } from './db.ts';
import { SignerGuard } from './guard.ts';
import { viemReader } from './reader.ts';
import { createSigner } from './signer.ts';
import { createVerifyServer } from './verify.ts';
import { Watcher } from './watcher.ts';

const config = loadConfig();
const db = ChainDb.connect(config.databaseUrl);

// Exactly one chain service may run per chain. Two signers would each keep their own
// on-disk daily budget, doubling what a compromised database could get signed. The lock is
// held by a dedicated connection for the life of the process.
const lockClient = await db.pool.connect();
const locked = await lockClient.query("SELECT pg_try_advisory_lock(hashtextextended('chain-service:' || $1, 0)) AS ok", [config.chain]);
if (!locked.rows[0]?.ok) {
  console.error(`another chain service already holds the ${config.chain} lock; refusing to start`);
  process.exit(1);
}
const reader = viemReader(config.rpcUrl);
const chainId = await reader.chainId();
const signer = await createSigner(config.signer, chainId);
const guard = signer
  ? new SignerGuard(config.signerStateFile, config.signerDailyMaxVerse, config.signerMaxVoucherVerse, config.signerMaxTtlSeconds)
  : null;
const log = (line: string) => console.log(new Date().toISOString(), line);

async function onAlert(kind: string, detail: object): Promise<void> {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: 'chain', chain: config.chain, kind, detail }),
    });
  } catch (e) {
    log(`alert webhook failed ${String(e)}`);
  }
}

let last = { at: '', ok: false, error: '' };
const watcher = new Watcher({
  chain: config.chain,
  db,
  reader,
  signer,
  guard,
  maxBlockRange: config.maxBlockRange,
  startBlock: config.startBlock,
  log,
  onAlert,
});

createVerifyServer(config.serviceKey, () => ({ ok: true, chainId, signer: signer?.address ?? null, halted: guard?.halted ?? null, last })).listen(
  config.port,
  () => log(`chain service on :${config.port}, chain ${chainId}, signer ${signer?.address ?? 'none'}`),
);

for (;;) {
  try {
    const r = await watcher.tick();
    last = { at: new Date().toISOString(), ok: true, error: '' };
    if (r.deposits || r.claims || r.refunds || r.signed) log(`tick ${JSON.stringify(r)}`);
  } catch (e) {
    last = { at: new Date().toISOString(), ok: false, error: String(e) };
    log(`tick failed ${String(e)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, config.pollMs));
}
