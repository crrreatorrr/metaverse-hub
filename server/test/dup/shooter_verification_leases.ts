import assert from 'node:assert/strict';
import { guest, openGame, call, psql, psqlAsync, num, sleep, type GameLogin } from './harness.ts';
import { readFileSync } from 'node:fs';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
type Claim = { jobId: string; runId: string; accountId: string; sessionId: string; fence: number; initialRevision: number; expectedRevision: number; inputSha256: string; tick0: number; tickEnd: number; continuationTick: number };
type Result = { state: string; reason?: string; claim?: Claim; leaseUntil?: string; attemptDeadline?: string; quarantined?: boolean };
const PIN = JSON.parse(readFileSync(new URL('../../modules/vendor/shooter-sim.pin.json', import.meta.url), 'utf8')) as { sha256: string; commit: string; fingerprint: string };
const ADMISSION = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000`;
const CONFIG = `UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,
 max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,
 max_checkpoint_bytes=1073741824,max_account_checkpoint_bytes=67108864,lease_seconds=2,attempt_seconds=4,
 attempt_limit=3,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096`;
function json(sql: string): Result { return JSON.parse(psql(sql)) as Result; }
function claim(owner: string): Result { return json(`SELECT game.shooter_verification_claim('${owner}')::text`); }
function renew(c: Claim, owner: string): Result { return json(`SELECT game.shooter_verification_renew('${c.jobId}','${owner}',${c.fence},${c.expectedRevision})::text`); }
function retry(c: Claim, owner: string, reason = 'worker_crash'): Result { return json(`SELECT game.shooter_verification_retry('${c.jobId}','${owner}',${c.fence},${c.expectedRevision},'${reason}')::text`); }
function fence(c: Claim, owner: string): number { return num(`SELECT game.shooter_verification_fence_live('${c.jobId}','${owner}',${c.fence},${c.expectedRevision})::integer`); }
// Finish fixture chains by quarantining, never deleting immutable input/evidence.
function isolate(): void {
  psql(`UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL WHERE state IN ('ready','leased','retry_wait');
    UPDATE game.shooter_verification_run SET lifecycle='quarantined' WHERE lifecycle IN ('open','sealed','expired','terminal'); ${CONFIG}; ${ADMISSION}`);
}
async function fixture(n = 1, reuse?: GameLogin): Promise<{ run: string; user: string; login: GameLogin }> {
  const login = reuse || await (async () => { const g = await guest(); return openGame(g.token, 'sproto-shooter'); })();
  const user = login.hub.userId; const run = crypto.randomUUID();
  psql(`INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES('${run}','${user}','${login.sessionId}','lease:${run}',current_date,'sahil',7,'{}');
    INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES('${run}','${user}','${login.sessionId}',1,2,1,'${PIN.sha256}','${PIN.commit}','${PIN.fingerprint}',now()-interval '2 minutes',now()+interval '43 minutes');`);
  const result = await call('shooter.run.append', { protocol: 2, runId: run, sequence: 0, tick0: 0, n, frames: Buffer.alloc(n * 12).toString('base64'), actions: [] }, login.gameToken);
  assert.equal((result.body as { state: string }).state, 'received', JSON.stringify(result));
  return { run, user, login };
}

export async function runShooterVerificationLeases(test: TestFn): Promise<void> {
  await test('shooter-leases', 'scheduler defaults off and has no public claim or completion RPC', async () => {
    assert.equal(psql('SELECT claims_enabled::text FROM game.shooter_verification_scheduler'), 'false');
    assert.equal(claim('worker').reason, 'workers_disabled');
    assert.equal(claim("bad worker").reason, 'bad_worker');
    const source = readFileSync(new URL('../../modules/src/main.ts', import.meta.url), 'utf8');
    assert.ok(!/registerRpc\([^\n]*(?:shooter.*claim|shooter.*renew|shooter.*complete)/i.test(source));
  });

  await test('shooter-leases', 'concurrent claims yield one immutable chain bound to original batch and predecessor', async () => {
    isolate(); const f = await fixture(5000);
    const results = await Promise.all(['worker-a', 'worker-b'].map((o) => psqlAsync(`SELECT game.shooter_verification_claim('${o}')::text`).then((s) => JSON.parse(s) as Result)));
    assert.equal(results.filter((r) => r.state === 'leased').length, 1);
    const c = results.find((r) => r.claim)!.claim!;
    assert.equal(c.runId, f.run); assert.equal(c.tick0, 0); assert.equal(c.tickEnd, 4096); assert.equal(c.continuationTick, 0);
    assert.equal(c.initialRevision, 0); assert.equal(c.expectedRevision, 0);
    assert.equal(c.inputSha256, psql(`SELECT request_sha256 FROM game.shooter_verification_batch WHERE run_id='${f.run}'`));
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${f.run}'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt WHERE job_id='${c.jobId}'`), 1);
    assert.equal(num(`SELECT reserved_checkpoint_bytes FROM game.shooter_verification_scheduler_account WHERE user_id='${f.user}'`), 16777216);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${f.run}'`), 0);
    // Immutable input range, initial revision, and attempt claims cannot be rewritten.
    psql(`DO $t$ BEGIN
      BEGIN UPDATE game.shooter_verification_job SET tick_end=5000 WHERE job_id='${c.jobId}'; RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'shooter_verification_job_binding_immutable' THEN RAISE; END IF; END;
      BEGIN DELETE FROM game.shooter_verification_attempt WHERE job_id='${c.jobId}'; RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'shooter_verification_attempt_immutable' THEN RAISE; END IF; END;
    END; $t$`);
  });

  await test('shooter-leases', 'expiry fences stale success and failure before reclaim with durable backoff', async () => {
    isolate(); const f = await fixture(); const old = claim('old').claim!;
    assert.equal(fence(old, 'old'), 1);
    await sleep(2200);
    assert.equal(fence(old, 'old'), 0, 'future completion predicate refuses old success');
    assert.equal(retry(old, 'old').state, 'stale', 'old failure cannot mutate state');
    assert.equal(renew(old, 'old').state, 'stale');
    assert.equal(claim('new').state, 'pending_retryable', 'reclaim first durably records expiry/backoff');
    assert.equal(psql(`SELECT state FROM game.shooter_verification_job WHERE job_id='${old.jobId}'`), 'retry_wait');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${old.jobId}' AND state='lease_expired'`), 1);
    assert.equal(claim('new').state, 'pending_retryable');
    await sleep(1100); const fresh = claim('new').claim!;
    assert.equal(fresh.runId, f.run); assert.equal(fresh.jobId, old.jobId); assert.equal(fresh.fence, old.fence + 1);
    assert.equal(fence(old, 'old'), 0); assert.equal(fence(fresh, 'new'), 1);
    const before = psql(`SELECT state||':'||fencing_token FROM game.shooter_verification_job WHERE job_id='${fresh.jobId}'`);
    assert.equal(retry(old, 'old').state, 'stale');
    assert.equal(psql(`SELECT state||':'||fencing_token FROM game.shooter_verification_job WHERE job_id='${fresh.jobId}'`), before);
  });

  await test('shooter-leases', 'renewal cannot extend the absolute attempt deadline indefinitely', async () => {
    isolate(); await fixture(); const first = claim('renew'); const c = first.claim!;
    await sleep(1000); const second = renew(c, 'renew');
    assert.equal(second.state, 'leased'); assert.equal(second.attemptDeadline, first.attemptDeadline);
    await sleep(1000); const third = renew(c, 'renew');
    assert.equal(third.state, 'leased'); assert.equal(third.attemptDeadline, first.attemptDeadline);
    assert.ok(Date.parse(third.leaseUntil!) <= Date.parse(first.attemptDeadline!));
    await sleep(2200); assert.equal(renew(c, 'renew').state, 'stale');
  });

  await test('shooter-leases', 'bounded attempts exhaust to operational quarantine without gameplay invalidity', async () => {
    isolate(); psql('UPDATE game.shooter_verification_scheduler SET attempt_limit=2'); const f = await fixture();
    const one = claim('retry').claim!; assert.equal(retry(one, 'retry', 'invalid_gameplay').reason, 'bad_retry_reason');
    assert.equal(retry(one, 'retry').quarantined, false); await sleep(1100);
    const two = claim('retry').claim!; assert.equal(two.jobId, one.jobId); assert.equal(two.fence, 2);
    const exhausted = retry(two, 'retry', 'execution_timeout'); assert.equal(exhausted.quarantined, true); assert.equal(exhausted.reason, 'attempts_exhausted');
    assert.equal(psql(`SELECT lifecycle||':'||payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'quarantined:none');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${one.jobId}'`), 2);
    assert.equal(claim('retry').state, 'pending_retryable');
  });

  await test('shooter-leases', 'least-recently considered accounts remain fair and global/account concurrency is bounded', async () => {
    isolate(); psql('UPDATE game.shooter_verification_scheduler SET max_leased=2,lease_seconds=10,attempt_seconds=20');
    const a = await fixture();
    let old = a;
    for (let i = 0; i < 8; i++) {
      psql(`UPDATE game.shooter_verification_run SET lifecycle='expired' WHERE run_id='${old.run}'`);
      old = await fixture(1, a.login);
    }
    const b = await fixture(); const c = await fixture();
    const first = claim('fair-a').claim!; assert.equal(first.runId, a.run);
    const second = claim('fair-b').claim!; assert.equal(second.runId, b.run);
    assert.equal(claim('saturated').state, 'pending_retryable');
    assert.equal(retry(first, 'fair-a').state, 'pending_retryable');
    const third = claim('fair-c').claim!; assert.equal(third.runId, c.run);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE state='leased' AND lease_until>clock_timestamp()`), 2);
  });

  await test('shooter-leases', 'retained job attempt and checkpoint capacity refuses work without losing accepted input', async () => {
    for (const field of ['jobs', 'attempts', 'checkpoint']) {
      isolate(); const f = await fixture();
      const before = psql(`SELECT accepted_tick||':'||accepted_bytes FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
      if (field === 'jobs') psql('UPDATE game.shooter_verification_scheduler SET max_jobs=GREATEST(1,retained_jobs)');
      if (field === 'attempts') psql('UPDATE game.shooter_verification_scheduler SET max_attempts_retained=GREATEST(1,retained_attempts)');
      if (field === 'checkpoint') psql('UPDATE game.shooter_verification_scheduler SET max_checkpoint_bytes=GREATEST(16777216,reserved_checkpoint_bytes)');
      assert.equal(claim(`cap-${field}`).state, 'pending_retryable');
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${f.run}'`), 0);
      assert.equal(psql(`SELECT accepted_tick||':'||accepted_bytes FROM game.shooter_verification_run WHERE run_id='${f.run}'`), before);
    }
  });

  await test('shooter-leases', 'predecessor mismatch quarantines rather than running another authoritative chain', async () => {
    isolate(); const f = await fixture(10); const one = claim('predecessor').claim!; retry(one, 'predecessor');
    psql(`UPDATE game.shooter_verification_run SET revision=1 WHERE run_id='${f.run}'`);
    await sleep(1100); assert.equal(claim('predecessor-new').state, 'pending_retryable');
    assert.equal(psql(`SELECT lifecycle FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'quarantined');
    assert.equal(psql(`SELECT last_error FROM game.shooter_verification_job WHERE job_id='${one.jobId}'`), 'predecessor_mismatch');
  });

  await test('shooter-leases', 'a renewal waiting on a row lock cannot revive an expired attempt', async () => {
    isolate(); await fixture(); const c = claim('locked').claim!;
    const hold = psqlAsync(`SET application_name='shooter-lease-expiry'; BEGIN;
      SELECT 1 FROM game.shooter_verification_job WHERE job_id='${c.jobId}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;`);
    const deadline = Date.now() + 5000;
    while (num("SELECT count(*) FROM pg_stat_activity WHERE application_name='shooter-lease-expiry' AND wait_event='PgSleep'") === 0) {
      assert.ok(Date.now() < deadline, 'lock holder started'); await sleep(20);
    }
    const result = await psqlAsync(`SELECT game.shooter_verification_renew('${c.jobId}','locked',${c.fence},${c.expectedRevision})::text`);
    await hold;
    assert.equal((JSON.parse(result) as Result).state, 'stale');
    assert.equal(fence(c, 'locked'), 0);
  });

}
