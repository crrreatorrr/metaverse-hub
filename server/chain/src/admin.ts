// Operator CLI.
//   admin show                     current limits, switches and chain config
//   admin set '<json patch>'       e.g. '{"economy":{"account_daily_verse":50},"chains":{"eth":{"vouchers_enabled":true}}}'
//   admin alerts [n]               latest chain alerts
//   signer-address                 Ethereum address of the configured signer key
//   signer-proof <chainId> <token> CASHOUT_SIGNER_PROOF for contracts/script/Deploy.s.sol
// `show`, `set` and `alerts` use ADMIN_DATABASE_URL (the Nakama database owner), not the
// hub_chain login. Every `set` is logged with OPERATOR as the author.
import pg from 'pg';
import { getAddress } from 'viem';
import { loadConfig } from './config.ts';
import { proofDigest } from './proof.ts';
import { createSigner } from './signer.ts';

const [cmd, ...args] = process.argv.slice(2);

async function adminDb(): Promise<pg.Client> {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('missing env ADMIN_DATABASE_URL');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function signerFor(chainId: number) {
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'unused', RPC_URL: process.env.RPC_URL ?? 'unused', CHAIN_SERVICE_KEY: process.env.CHAIN_SERVICE_KEY ?? 'unused-unused-unused' };
  const s = await createSigner(loadConfig(env).signer, chainId);
  if (!s) throw new Error('SIGNER is none');
  return s;
}

async function main(): Promise<void> {
  if (cmd === 'show') {
    const c = await adminDb();
    console.log(JSON.stringify((await c.query('SELECT game.economy_snapshot() AS v')).rows[0].v, null, 2));
    await c.end();
  } else if (cmd === 'set') {
    const by = process.env.OPERATOR;
    if (!by) throw new Error('set OPERATOR to your name; it is written to economy_config_log');
    const patch = JSON.parse(args[0] ?? '');
    const c = await adminDb();
    console.log(JSON.stringify((await c.query('SELECT game.economy_config_set($1::jsonb, $2) AS v', [JSON.stringify(patch), by])).rows[0].v, null, 2));
    await c.end();
  } else if (cmd === 'alerts') {
    const c = await adminDb();
    const rows = (await c.query('SELECT * FROM game.chain_alert ORDER BY seq DESC LIMIT $1', [Number(args[0] ?? 20)])).rows;
    for (const r of rows) console.log(r.at.toISOString(), r.kind, JSON.stringify(r.detail));
    await c.end();
  } else if (cmd === 'signer-address') {
    console.log((await signerFor(Number(process.env.CHAIN_ID ?? 11155111))).address);
  } else if (cmd === 'signer-proof') {
    const chainId = BigInt(args[0] ?? '');
    const token = getAddress(args[1] ?? '');
    const s = await signerFor(Number(chainId));
    console.log(await s.signDigest(proofDigest(chainId, token, s.address)));
  } else {
    console.error('usage: admin show | set <json> | alerts [n] | signer-address | signer-proof <chainId> <token>');
    process.exitCode = 2;
  }
}

await main();
