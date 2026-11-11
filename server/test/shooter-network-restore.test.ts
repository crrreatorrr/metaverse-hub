// Actual pg_dump -> fresh PostgreSQL -> second Nakama -> actual isolated worker.
// Backup/credentials/private CP are never written to artifacts or stdout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { arm, canonical, disarm, guest, num, openGame, psql, waitReady } from './dup/harness';
import { appendActor, finishActor, prepareTrustedActor } from './dup/shooter_verification_e2e_fixtures';
import { ops, prepareOperations, waitUntil } from './dup/shooter_verification_e2e_operations';
import { retainedOracle } from './dup/shooter_verification_e2e_oracle';

type Obj = Record<string, unknown>;
const PROJECT = 'shooter-e2e-restore';
const base = ['compose', '-p', PROJECT, '-f', 'server/docker-compose.yml', '-f', 'server/test/fixtures/shooter-restore.compose.yml'];
function restored(args: string[], directory: string): string {
  return execFileSync('docker', [...base, '-f', 'services/shooter-verifier/ops/compose.ci.yml', '--profile', 'shooter-verification', ...args], {
    encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024, env: { ...process.env, SHOOTER_OPS_CI_DIRECTORY: directory },
  }).trim();
}
function data(sql: string, restore = false): string {
  return execFileSync('docker', [...(restore ? base : ['compose', '-f', 'server/docker-compose.yml']), 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 22 * 1024 * 1024,
  }).trim();
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
async function publicStatus(token: string, runId: string, restore: boolean): Promise<Obj> {
  const response = await fetch(`http://127.0.0.1:${restore ? 17350 : 7350}/v2/rpc/shooter.run.status?unwrap=true`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200); return await response.json() as Obj;
}
function retainedHistory(runId: string, restore = false): string {
  // Every pre-backup row/ID/timestamp/ACK is byte-for-byte retained; result is a
  // hash so neither private checkpoint nor raw canonical input is printed.
  return digest(JSON.parse(data(`SELECT jsonb_build_object(
    'run',(SELECT to_jsonb(r) FROM game.shooter_verification_run r WHERE run_id='${runId}'),
    'legacyRun',(SELECT to_jsonb(r) FROM game.shooter_run r WHERE run_id='${runId}'),
    'admission',(SELECT to_jsonb(c) FROM game.shooter_verification_admission c),
    'accountAdmission',(SELECT to_jsonb(c) FROM game.shooter_verification_admission_account c WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id='${runId}')),
    'scheduler',(SELECT to_jsonb(c) FROM game.shooter_verification_scheduler c),
    'gateway',(SELECT to_jsonb(c) FROM game.shooter_verification_gateway c),
    'wallets',(SELECT jsonb_agg(to_jsonb(w) ORDER BY game_id) FROM game.tickets_balance w WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id='${runId}')),
    'ledger',(SELECT jsonb_agg(to_jsonb(e) ORDER BY event_id) FROM game.tickets_ledger e WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id='${runId}')),
    'batch',(SELECT jsonb_agg(to_jsonb(b) ORDER BY sequence) FROM game.shooter_verification_batch b WHERE run_id='${runId}'),
    'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY job_id) FROM game.shooter_verification_job j WHERE run_id='${runId}'),
    'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.job_id,a.fencing_token) FROM game.shooter_verification_attempt a JOIN game.shooter_verification_job j USING(job_id) WHERE j.run_id='${runId}'),
    'results',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.job_id,a.fencing_token) FROM game.shooter_verification_attempt_result a JOIN game.shooter_verification_job j USING(job_id) WHERE j.run_id='${runId}'))::text`, restore)));
}
await waitReady();
assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.HUB_SHOOTER_FIXTURE, 'integration');
assert.ok(process.env.RUNNER_TEMP?.startsWith('/'), 'explicit disposable Actions private directory required');
const workerId = await prepareOperations(), originalDirectory = process.env.SHOOTER_OPS_CI_DIRECTORY!;
const accountId = psql(`SELECT account_id FROM game.shooter_verification_worker WHERE worker_id='${workerId}'`);
const sleepName = `hf:${accountId}:shooter.worker.after_commit`.slice(0, 63);
const login = await openGame((await guest()).token, 'sproto-shooter');
console.log('::add-mask::' + login.hub.token); console.log('::add-mask::' + login.gameToken);
const actor = await prepareTrustedActor('sahil-success-7', login, { ageMs: 1200000 });
const batches = await appendActor(actor); await finishActor(actor, 0);
const expected = retainedOracle(actor, batches[0]!);
assert.equal(batches.length, 1);
let restoredDirectory = '', started = false;
try {
  assert.equal(execFileSync('docker', [...base, 'ps', '--all', '--quiet'], { encoding: 'utf8' }).trim(), '', 'refuse an existing restore project');
  arm(accountId, 'shooter.worker.after_commit', 'sleep');
  ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']); started = true;
  await waitUntil(() => num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${sleepName}' AND wait_event='PgSleep'`) === 1,
    60000, 'first real result is durable before backup');
  assert.equal(num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), 4096);
  ops(['kill', '-s', 'SIGKILL', 'coordinator']);
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${sleepName}'`); disarm(accountId);
  const before = retainedHistory(actor.runId);
  const migrations = data('SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM game.schema_migrations m');
  const proof = data(`SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY request_id),'[]')::text FROM game.shooter_verification_gateway_receipt g WHERE worker_id='${workerId}'`);
  const dump = execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', 'nakama', '-Fc', '--no-owner'], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  const backupSha = createHash('sha256').update(dump).digest('hex');
  restoredDirectory = mkdtempSync(join(process.env.RUNNER_TEMP!, 'shooter-e2e-restore-'));
  mkdirSync(join(restoredDirectory, 'socket'), { mode: 0o700 }); mkdirSync(join(restoredDirectory, 'journal'), { mode: 0o700 });
  execFileSync('sudo', ['cp', '--', join(originalDirectory, 'shooter-worker.json'), join(restoredDirectory, 'shooter-worker.json')]);
  execFileSync('sudo', ['chmod', '600', join(restoredDirectory, 'shooter-worker.json')]);
  execFileSync('sudo', ['chown', '-R', '1000:1000', restoredDirectory]);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'SHOOTER_RESTORE_PRIVATE_DIRECTORY=' + restoredDirectory + '\n');
  restored(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres'], restoredDirectory);
  execFileSync('docker', [...base, 'exec', '-T', 'postgres', 'pg_restore', '-U', 'postgres', '-d', 'nakama', '--clean', '--if-exists', '--no-owner', '--exit-on-error'], { input: dump, timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(retainedHistory(actor.runId, true), before, 'all private/history rows survive an actual binary dump/restore');
  assert.equal(data(`SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY request_id),'[]')::text FROM game.shooter_verification_gateway_receipt g WHERE worker_id='${workerId}'`, true), proof);
  restored(['up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '180', 'nakama'], restoredDirectory);
  assert.equal(data('SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM game.schema_migrations m', true), migrations,
    'restored Nakama repeat startup preserves applied migration IDs/checksums/timestamps');
  const status = await publicStatus(login.hub.token, actor.runId, true);
  assert.equal((status.verified as Obj).tick, 4096); assert.equal((status.received as Obj).tick, 9634);
  // The restored service authenticates the genuine original JWT and drains
  // through a fresh coordinator journal and actual network:none replay daemon.
  restored(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator'], restoredDirectory);
  ops(['start', 'coordinator']);
  for (const restore of [false, true]) {
    await waitUntil(() => Number(data(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`, restore)) === 9634,
      180000, 'both actual service branches complete the entire original9634 frame input');
    const cp = JSON.parse(data(`SELECT checkpoint_json::text FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`, restore));
    assert.equal(digest(cp), digest(expected), 'restored real service continuation agrees with independent retained05f full-state oracle');
    await waitUntil(async () => ((await publicStatus(login.hub.token, actor.runId, restore)).payment as Obj).state === 'paid',
      60000, 'normal separate settlement pays after restored authenticated continuation');
    assert.equal(Number(data(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}' AND tickets=20`, restore)), 1);
    assert.equal(Number(data(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear' AND delta=20`, restore)), 1);
    assert.equal(Number(data(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND delta<0`, restore)), 0);
    // Original stored gateway ACK rows remain unchanged after new continuation.
    const originalReceipts = JSON.parse(proof) as Obj[];
    for (const row of originalReceipts) assert.equal(digest(JSON.parse(data(`SELECT to_jsonb(g)::text FROM game.shooter_verification_gateway_receipt g WHERE worker_id='${workerId}' AND request_id='${String(row.request_id)}'`, restore))), digest(row), 'original ACK row identity/time/proof preserved');
  }
  const financial = (restore: boolean): string => data(`SELECT jsonb_build_object('tickets',(SELECT sum(delta) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear'),
    'receipt',(SELECT jsonb_build_object('runId',run_id,'tickets',tickets,'clearMs',clear_ms,'boss',canonical_boss,'day',day) FROM game.shooter_receipt WHERE run_id='${actor.runId}'),
    'balance',(SELECT balance FROM game.tickets_balance WHERE user_id='${login.hub.userId}' AND game_id='sproto-shooter'),
    'sessionCapUsed',(SELECT sum(tickets) FROM game.shooter_receipt WHERE session_id='${login.sessionId}'),
    'gameEarned',(SELECT sum(amount) FROM game.earn_window WHERE user_id='${login.hub.userId}' AND bucket='tickets:sproto-shooter'),
    'revision',(SELECT revision FROM game.shooter_verification_run WHERE run_id='${actor.runId}'))::text`, restore);
  assert.equal(financial(true), financial(false), 'same outcome/caps/amount/ranking/revision; newly authored ledger UUIDs/timestamps may differ across the two independently continued databases');
  console.log('PASS actual pg_dump/fresh-PostgreSQL/second-Nakama/authenticated-status/actual-coordinator/offline-replay full9634 continuation; retained CP parity; one20T ledger per branch; backupSHA256 ' + backupSha);
} finally {
  disarm(accountId);
  if (restoredDirectory) restored(['down', '--volumes'], restoredDirectory);
  if (started) ops(['stop', '-t', '40', 'coordinator', 'replay']);
}
