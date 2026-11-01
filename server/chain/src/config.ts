// Environment for the chain service. Every value is read once at start.
export interface ChainServiceConfig {
  databaseUrl: string;
  rpcUrl: string;
  chain: 'eth';
  serviceKey: string;
  port: number;
  pollMs: number;
  maxBlockRange: bigint;
  startBlock: bigint | null;
  signer: SignerConfig;
  signerDailyMaxVerse: number;
  signerMaxVoucherVerse: number;
  signerMaxTtlSeconds: number;
  signerStateFile: string;
  alertWebhookUrl: string | null;
}

export type SignerConfig =
  | { kind: 'local'; privateKey: `0x${string}` }
  | { kind: 'aws-kms'; keyId: string; region: string }
  | { kind: 'none' };

function need(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing env ${key}`);
  return value;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`env ${key} must be a non-negative integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChainServiceConfig {
  const signerKind = env.SIGNER ?? 'none';
  let signer: SignerConfig;
  if (signerKind === 'local') {
    const key = need(env, 'SIGNER_PRIVATE_KEY');
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('SIGNER_PRIVATE_KEY must be 32 bytes hex');
    signer = { kind: 'local', privateKey: key as `0x${string}` };
  } else if (signerKind === 'aws-kms') {
    signer = { kind: 'aws-kms', keyId: need(env, 'KMS_KEY_ID'), region: need(env, 'AWS_REGION') };
  } else if (signerKind === 'none') {
    signer = { kind: 'none' };
  } else {
    throw new Error('SIGNER must be local, aws-kms or none');
  }
  const serviceKey = need(env, 'CHAIN_SERVICE_KEY');
  if (serviceKey.length < 16) throw new Error('CHAIN_SERVICE_KEY must be at least 16 characters');
  return {
    databaseUrl: need(env, 'DATABASE_URL'),
    rpcUrl: need(env, 'RPC_URL'),
    chain: 'eth',
    serviceKey,
    port: int(env, 'PORT', 8090),
    pollMs: int(env, 'POLL_MS', 15_000),
    maxBlockRange: BigInt(int(env, 'MAX_BLOCK_RANGE', 2_000)),
    startBlock: env.START_BLOCK ? BigInt(int(env, 'START_BLOCK', 0)) : null,
    signer,
    // The signer's own limits, kept outside the database so a compromised database cannot
    // get more signed than this per UTC day. Set the daily cap to the global lock.
    signerDailyMaxVerse: int(env, 'SIGNER_DAILY_MAX_VERSE', 0),
    signerMaxVoucherVerse: int(env, 'SIGNER_MAX_VOUCHER_VERSE', 0),
    signerMaxTtlSeconds: int(env, 'SIGNER_MAX_TTL_SECONDS', 31 * 86_400),
    signerStateFile: env.SIGNER_STATE_FILE ?? '/var/lib/chain-service/signer-state.json',
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || null,
  };
}
