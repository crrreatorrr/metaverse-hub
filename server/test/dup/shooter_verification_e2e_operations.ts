// Disposable Actions fixture controls for actual production worker containers.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guest, psql, sleep } from './harness';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const digest = (v: string): string => createHash('sha256').update(v).digest('hex');
export function ops(args: string[]): string {
  return execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', '-f', 'services/shooter-verifier/ops/compose.ci.yml', '--profile', 'shooter-verification', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024,
  }).trim();
}
const CONFIG = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=16,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1099511627776,max_account_checkpoint_bytes=1073741824,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
 UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=1000000,account_attempts_per_minute=100000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400;
 UPDATE game.shooter_verification_payment_config SET payments_enabled=true`;

export async function prepareOperations(): Promise<string> {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.HUB_SHOOTER_FIXTURE, 'integration');
  const account = await guest(), workerId = 'e2e-' + randomUUID(), token = randomBytes(32).toString('base64url'), keyId = 'one';
  // Mask before any assertion or process can report an incidental credential.
  console.log('::add-mask::' + account.token); console.log('::add-mask::' + token);
  psql(`${CONFIG}; INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${account.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${account.userId}','${workerId}','${keyId}','${digest('shooter-worker-token-v1\n' + token)}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`);
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'shooter-e2e-'));
  mkdirSync(join(directory, 'socket'), { mode: 0o700 }); mkdirSync(join(directory, 'journal'), { mode: 0o700 });
  writeFileSync(join(directory, 'shooter-worker.json'), JSON.stringify({ url: 'http://127.0.0.1:7350', accountToken: account.token, workerId, keyId, token }), { mode: 0o600 });
  execFileSync('sudo', ['chown', '-R', '1000:1000', directory]);
  process.env.SHOOTER_OPS_CI_DIRECTORY = directory;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'SHOOTER_OPS_CI_DIRECTORY=' + directory + '\n');
  return workerId;
}
export async function waitUntil(check: () => boolean | Promise<boolean>, milliseconds: number, label: string): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!await check()) { assert.ok(Date.now() < deadline, label); await sleep(250); }
}
