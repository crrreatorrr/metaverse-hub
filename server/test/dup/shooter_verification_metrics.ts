// PR19 observations/repair use real authenticated Nakama RPCs and PostgreSQL.
// The original frozen replay fixtures are executed only in GitHub Actions.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestDigest } from '../../../services/shooter-verifier/src/gateway-client.mjs';
import { fixture, isolate, enable, payment, receipt } from './shooter_verification_settlement.ts';
import { guest, openGame, call, psql, psqlAsync, num, sleep, arm, disarm, installFaultHooks, dropFaultHooks, compose, waitReady, canonical, type Guest } from './harness.ts';
import { fileChecksum } from './migrations.ts';

type Obj = Record<string, unknown>;
type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Worker = Fixture['worker'];
type Principal = Pick<Worker, 'workerId' | 'keyId' | 'token' | 'hash'> & { login: Guest };
const ID = '0058_shooter_verification_observations';
const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const obj = (v: unknown) => v as Obj;
async function principal(scopes = ['claim', 'renew', 'retry', 'result']): Promise<Principal> {
  const login = await guest(), workerId = `ops-${randomUUID()}`, keyId = 'one', token = randomBytes(32).toString('base64url');
  const tokenHash = hash(`shooter-worker-token-v1\n${token}`);
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${login.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${login.userId}','${workerId}','${keyId}','${tokenHash}',ARRAY[${scopes.map(q).join(',')}],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '20 minutes')`);
  return { login, workerId, keyId, token, hash: tokenHash };
}
function envelope(w: Principal, body: unknown = {}, requestId = randomUUID()): Obj {
  return { workerId: w.workerId, keyId: w.keyId, token: w.token, requestId, body };
}
async function rpc(w: Principal, op: string, body: unknown = {}): Promise<Obj> {
  return obj((await call(`shooter.internal.${op}`, envelope(w, body), w.login.token)).body);
}
function proof(f: Fixture): { resultRequestId: string; requestSha256: string } {
  return { resultRequestId: f.last.requestId, requestSha256: psql(`SELECT request_sha256 FROM game.shooter_verification_gateway_receipt WHERE worker_id='${f.worker.workerId}' AND request_id='${f.last.requestId}'`) };
}
function proofBody(f: Fixture): Obj { const p = proof(f); return { operation: 'result', requestId: p.resultRequestId, requestSha256: p.requestSha256 }; }
function references(v: Obj): Obj[] {
  assert.ok(Array.isArray(v.references));
  return (v.references as Obj[]).map(r => {
    assert.deepEqual(Object.keys(r).sort(), ['createdAt', 'requestSha256', 'resultRequestId']);
    assert.match(String(r.createdAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    return { resultRequestId: r.resultRequestId, requestSha256: r.requestSha256 };
  });
}
function credits(f: Fixture): number { return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${f.login.hub.userId}' AND reason='srv_shooter_boss_clear'`); }
function durable(): string {
  // Rate windows are allowed to change; observations must not allocate jobs,
  // requests, receipt reservations, input evidence or alter durable checkpoints.
  return psql(`SELECT jsonb_build_object(
    'runs',(SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY run_id),'')) FROM game.shooter_verification_run x),
    'jobs',(SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY job_id),'')) FROM game.shooter_verification_job x),
    'receipts',(SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY worker_id,request_id),'')) FROM game.shooter_verification_gateway_receipt x),
    'scheduler',(SELECT to_jsonb(x) FROM game.shooter_verification_scheduler x),
    'reservations',(SELECT jsonb_agg(jsonb_build_array(worker_id,key_id,retained_requests,reserved_receipt_bytes) ORDER BY worker_id,key_id) FROM game.shooter_verification_principal),
    'pointer',(SELECT md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY worker_id,run_id,terminal_revision),'')) FROM game.shooter_verification_payment_work x))::text`);
}
function assertNoPrivate(v: unknown): void {
  const text = JSON.stringify(v);
  for (const forbidden of ['privateCheckpoint', 'checkpoint_json', 'privateHash', 'issuance', 'frames', 'actions', 'token_sha256']) {
    assert.ok(!text.includes(`"${forbidden}"`), `observation must not contain ${forbidden}`);
  }
}
function rotate(w: Principal): void {
  const previous = w.keyId; w.keyId = `rotated-${randomUUID()}`; w.token = randomBytes(32).toString('base64url'); w.hash = hash(`shooter-worker-token-v1\n${w.token}`);
  psql(`UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp() WHERE worker_id='${w.workerId}' AND key_id='${previous}';
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${w.login.userId}','${w.workerId}','${w.keyId}','${w.hash}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 second',clock_timestamp()+interval '20 minutes')`);
}
function rows(f: Fixture): string {
  return psql(`SELECT jsonb_build_object('run',(SELECT to_jsonb(x) FROM game.shooter_verification_run x WHERE run_id='${f.run}'),
    'jobs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY job_id) FROM game.shooter_verification_job x WHERE run_id='${f.run}'),
    'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY job_id,fencing_token) FROM game.shooter_verification_attempt x WHERE job_id IN(SELECT job_id FROM game.shooter_verification_job WHERE run_id='${f.run}')),
    'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM game.shooter_verification_gateway_receipt x WHERE worker_id='${f.worker.workerId}'))::text`);
}

export async function runShooterVerificationMetrics(test: TestFn): Promise<void> {
  await test('shooter-metrics', 'worker observations require exact identity, scope and current keys and consume bounded admission before parsing', async () => {
    isolate(); const w = await principal();
    psql('UPDATE game.shooter_verification_gateway SET enabled=false');
    assert.equal((await rpc(w, 'ops')).reason, 'gateway_disabled'); isolate();
    const outsider = await guest();
    for (const mode of ['ops', 'receipt', 'pending', 'repair', 'maintenance']) {
      assert.equal(obj((await call(`shooter.internal.${mode}`, envelope(w), outsider.token)).body).state, 'authorization_denied', mode);
      assert.equal(obj((await call(`shooter.internal.${mode}`, { ...envelope(w), token: 'x'.repeat(43) }, w.login.token)).body).state, 'authorization_denied', mode);
      assert.equal(obj((await call(`shooter.internal.${mode}`, { ...envelope(w), extra: true }, w.login.token)).body).state, 'authorization_denied', mode);
    }
    const claimOnly = await principal(['claim']);
    assert.equal((await rpc(claimOnly, 'ops')).state, 'observed');
    assert.equal((await rpc(claimOnly, 'pending')).state, 'authorization_denied');
    const resultOnly = await principal(['result']);
    assert.equal((await rpc(resultOnly, 'ops')).state, 'authorization_denied');
    assert.equal((await rpc(resultOnly, 'pending')).state, 'pending_proofs');
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()-interval '1 second' WHERE worker_id='${w.workerId}'`);
    assert.equal((await rpc(w, 'ops')).state, 'authorization_denied');
    psql(`UPDATE game.shooter_verification_gateway SET account_attempts_per_minute=2;DELETE FROM game.shooter_verification_gateway_rate WHERE account_id='${resultOnly.login.userId}'`);
    assert.equal((await rpc(resultOnly, 'pending')).state, 'pending_proofs');
    assert.equal((await rpc(resultOnly, 'ops')).state, 'authorization_denied');
    assert.equal(obj((await call('shooter.internal.ops', { oversized: 'x'.repeat(8000) }, resultOnly.login.token)).body).reason, 'rate_limited');
    assert.equal(num(`SELECT attempts FROM game.shooter_verification_gateway_rate WHERE account_id='${resultOnly.login.userId}'`), 2);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id IN('${w.workerId}','${claimOnly.workerId}','${resultOnly.workerId}')`), 0);
  });

  await test('shooter-metrics', 'own receipt reads bind operation and exact Node Goja PostgreSQL digest without allocating retained history', async () => {
    isolate(); const f = await fixture(), p = proof(f), before = durable();
    // Goja produced the stored request digest during the real result RPC. Node
    // hashes the canonical request; PostgreSQL hashes the identical UTF8 bytes.
    assert.equal(p.requestSha256, requestDigest('result', f.last.body));
    const sql = `SELECT encode(sha256(convert_to(${q('result\n' + canonical(f.last.body))},'UTF8')),'hex')`;
    const pg = execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', '-'], {
      cwd: resolve(new URL('../../..', import.meta.url).pathname), input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    }).trim();
    assert.equal(pg, p.requestSha256);
    for (let i = 0; i < 3; i++) {
      const found = await rpc(f.worker, 'receipt', proofBody(f)); assert.equal(found.state, 'receipt_found');
      assert.deepEqual(found.acknowledgment, f.last.acknowledgment); assertNoPrivate(found);
    }
    assert.equal((await rpc(f.worker, 'receipt', { ...proofBody(f), operation: 'claim' })).state, 'receipt_conflict');
    assert.equal((await rpc(f.worker, 'receipt', { ...proofBody(f), requestSha256: '0'.repeat(64) })).state, 'receipt_conflict');
    assert.equal((await rpc(f.worker, 'receipt', { ...proofBody(f), requestId: randomUUID() })).state, 'receipt_missing');
    const other = await principal(); const afterOther = durable();
    assert.equal((await rpc(other, 'receipt', proofBody(f))).state, 'receipt_missing');
    assert.equal(durable(), afterOther, 'wrong-worker lookup does not create receipts');
    // Only adding the independent principal can change the original snapshot.
    assert.notEqual(afterOther, before);
    const old = { ...f.worker }; rotate(f.worker);
    assert.equal((await rpc(old, 'receipt', proofBody(f))).state, 'authorization_denied');
    const afterRotation = durable();
    assert.deepEqual((await rpc(f.worker, 'receipt', proofBody(f))).acknowledgment, f.last.acknowledgment);
    assert.equal(durable(), afterRotation);
  });

  await test('shooter-metrics', 'idle worker discovers only its own pending terminal proof with no jobs or retained observation receipts', async () => {
    isolate(); const f = await fixture(), other = await principal(), before = durable();
    assert.equal(num("SELECT count(*) FROM game.shooter_verification_job WHERE state IN('ready','leased','retry_wait')"), 0);
    const metrics = await rpc(f.worker, 'ops'); assert.equal(metrics.state, 'observed');
    assert.equal(metrics.eligible, false); assert.equal(metrics.queueDepth, 0); assert.ok(Number(metrics.paymentPending) >= 1);
    assert.equal(metrics.approximate, true); assert.equal(metrics.onlineMatchLatencyObserved, false);
    assert.equal(metrics.onlineMatchLatencyMs, null); assert.equal(metrics.writerReady, true); assert.equal(metrics.settlementReady, true);
    assertNoPrivate(metrics); assert.ok(!JSON.stringify(metrics).includes(f.run));
    const pending = await rpc(f.worker, 'pending'); assert.equal(pending.state, 'pending_proofs');
    assert.deepEqual(references(pending), [proof(f)]); assert.equal(pending.truncated, false); assertNoPrivate(pending);
    assert.deepEqual(references(await rpc(other, 'pending')), []);
    for (let i = 0; i < 3; i++) await rpc(f.worker, 'ops');
    assert.equal(durable(), before, 'idle discovery does not allocate jobs/receipts or rewrite proof');
  });

  await test('shooter-metrics', 'bounded aggregate sees an unplanned accepted suffix without leasing it or exposing account and checkpoint identifiers', async () => {
    isolate(); const f = await fixture('broccoli-success-7', { tail: 10, stopAfterTerminal: true });
    assert.equal(num(`SELECT accepted_tick-verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 10);
    const before = durable(), observed = await rpc(f.worker, 'ops');
    assert.equal(observed.state, 'observed'); assert.equal(observed.eligible, true); assert.equal(observed.queueDepth, 1);
    assert.equal(observed.acceptedVerifiedLagTicks, 10); assert.equal(observed.queueTruncated, false); assert.equal(observed.lagTruncated, false);
    assert.ok(Number(observed.oldestQueueAgeMs) >= 0); assertNoPrivate(observed);
    assert.ok(!JSON.stringify(observed).includes(f.run)); assert.ok(!JSON.stringify(observed).includes(f.login.hub.userId));
    assert.equal(durable(), before);
  });

  await test('shooter-metrics', 'read authorization expires at the actual database clock after waiting for a principal lock', async () => {
    isolate(); const w = await principal();
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()+interval '1 second' WHERE worker_id='${w.workerId}'`);
    const holder = psqlAsync(`SET application_name='metrics-key-expiry';BEGIN;SELECT 1 FROM game.shooter_verification_principal WHERE worker_id='${w.workerId}' FOR UPDATE;SELECT pg_sleep(2);COMMIT`);
    const deadline = Date.now() + 5000;
    while (num("SELECT count(*) FROM pg_stat_activity WHERE application_name='metrics-key-expiry' AND wait_event='PgSleep'") === 0) {
      assert.ok(Date.now() < deadline); await sleep(20);
    }
    const denied = await rpc(w, 'ops'); await holder;
    assert.equal(denied.state, 'authorization_denied');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${w.workerId}'`), 0);
  });

  await test('shooter-metrics', 'idle scoped maintenance closes expired empty admission without a claim and late key expiry rolls every derived change back', async () => {
    isolate(); enable(); const login = await openGame((await guest()).token, 'sproto-shooter'), w = await principal();
    psql(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${login.hub.userId}')`);
    const issued = obj((await call('shooter.run.issue', { key: randomUUID(), canonicalBoss: 'sahil' }, login.gameToken)).body);
    assert.equal(issued.state, 'issued', JSON.stringify(issued)); const run = String(issued.runId);
    psql(`UPDATE game.shooter_verification_run SET issued_at=now()-interval '46 minutes',upload_deadline=now()-interval '1 minute' WHERE run_id='${run}'`);
    const before = psql(`SELECT to_jsonb(x)::text FROM game.shooter_verification_run x WHERE run_id='${run}'`);
    const retained = num('SELECT retained_runs FROM game.shooter_verification_admission');
    psql(`UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp() WHERE worker_id='${w.workerId}'`);
    assert.equal((await rpc(w, 'maintenance')).state, 'authorization_denied');
    assert.equal(psql(`SELECT to_jsonb(x)::text FROM game.shooter_verification_run x WHERE run_id='${run}'`), before);
    rotate(w);
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()+interval '1 second' WHERE worker_id='${w.workerId}' AND key_id='${w.keyId}';
      CREATE FUNCTION game.metrics_maintenance_late_key_fixture() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.run_id='${run}' THEN PERFORM pg_sleep(2);END IF;RETURN NEW;END;$f$;
      CREATE TRIGGER metrics_maintenance_late_key_fixture BEFORE UPDATE ON game.shooter_verification_run FOR EACH ROW EXECUTE FUNCTION game.metrics_maintenance_late_key_fixture()`);
    try {
      assert.equal((await rpc(w, 'maintenance')).state, 'authorization_denied');
      assert.equal(psql(`SELECT to_jsonb(x)::text FROM game.shooter_verification_run x WHERE run_id='${run}'`), before);
    } finally { psql('DROP TRIGGER metrics_maintenance_late_key_fixture ON game.shooter_verification_run;DROP FUNCTION game.metrics_maintenance_late_key_fixture()'); }
    rotate(w); const maintained = await rpc(w, 'maintenance'); assert.equal(maintained.state, 'maintained'); assert.ok(Number(maintained.touched) >= 1);
    assert.deepEqual(Object.keys(maintained).sort(), ['state', 'touched']);
    assert.equal(psql(`SELECT terminal_outcome FROM game.shooter_verification_run WHERE run_id='${run}'`), 'incomplete');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_run WHERE user_id='${login.hub.userId}' AND lifecycle IN('open','sealed','quarantined')`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${run}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${run}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${w.workerId}'`), 0);
    assert.equal(num('SELECT retained_runs FROM game.shooter_verification_admission'), retained, 'release active slot without erasing historical reservation');
  });

  await test('shooter-metrics', 'crash after terminal commit repairs without queued jobs or CP body after disabled and failed wallet attempts then rotated concurrent repairs pay exactly once', async () => {
    isolate(); const f = await fixture('broccoli-success-7', { beforeSubmit: w => arm(w.login.userId, 'shooter.worker.after_commit', 'raise') });
    disarm(f.worker.login.userId); assert.equal(f.last.returned.state, 'pending_retryable'); assert.equal(f.last.acknowledgment.state, 'terminal_verified');
    assert.equal(credits(f), 0); assert.equal(receipt(f), null);
    const immutable = psql(`SELECT md5(checkpoint_json::text)||':'||revision||':'||verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
    const jobs = psql(`SELECT md5(string_agg(to_jsonb(x)::text,'' ORDER BY job_id)) FROM game.shooter_verification_job x WHERE run_id='${f.run}'`);
    assert.deepEqual(references(await rpc(f.worker, 'pending')), [proof(f)]);
    assert.equal((await rpc(f.worker, 'repair', proof(f))).paid, false); assert.equal(payment(f).paid, undefined);
    installFaultHooks();
    try {
      enable(); arm(f.login.hub.userId, 'earn.after_wallet', 'raise');
      const failed = await rpc(f.worker, 'repair', proof(f)); assert.equal(failed.state, 'pending_retryable'); assert.notEqual(failed.paid, true);
      assert.equal(credits(f), 0); assert.equal(receipt(f), null);
      assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'pending');
    } finally { disarm(f.login.hub.userId); dropFaultHooks(); }
    rotate(f.worker); const p = proof(f);
    const repaired = await Promise.all([rpc(f.worker, 'repair', p), rpc(f.worker, 'repair', p)]);
    for (const ack of repaired) { assert.equal(ack.paid, true); assert.equal(ack.state, 'paid'); assertNoPrivate(ack); }
    assert.equal(credits(f), 1); assert.equal(receipt(f)?.tickets, 20); assert.equal(payment(f).paid, true);
    assert.deepEqual(references(await rpc(f.worker, 'pending')), []);
    for (let i = 0; i < 3; i++) assert.equal((await rpc(f.worker, 'repair', p)).paid, true);
    assert.equal(credits(f), 1);
    assert.equal(psql(`SELECT md5(checkpoint_json::text)||':'||revision||':'||verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), immutable);
    assert.equal(psql(`SELECT md5(string_agg(to_jsonb(x)::text,'' ORDER BY job_id)) FROM game.shooter_verification_job x WHERE run_id='${f.run}'`), jobs);
    assert.equal(num("SELECT count(*) FROM game.shooter_verification_job WHERE state IN('ready','leased','retry_wait')"), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${f.worker.workerId}' AND operation NOT IN('claim','result')`), 0);
  });

  await test('shooter-metrics', 'wrong worker, digest and extra selectors cannot repair and original session expiry is durably denied without grace', async () => {
    isolate(); const f = await fixture(), other = await principal(); enable(); const before = rows(f);
    assert.equal((await rpc(other, 'repair', proof(f))).paid, false);
    assert.equal((await rpc(f.worker, 'repair', { ...proof(f), requestSha256: '0'.repeat(64) })).state, 'receipt_conflict');
    assert.equal((await rpc(f.worker, 'repair', { ...proof(f), runId: f.run, amount: 20 })).state, 'authorization_denied');
    assert.equal(rows(f), before); assert.equal(credits(f), 0);
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${f.login.sessionId}'`);
    const denied = await rpc(f.worker, 'repair', proof(f)); assert.equal(denied.state, 'authorization_denied'); assert.equal(denied.reason, 'session_expired');
    const permanent = payment(f); assert.equal(permanent.reason, 'session_expired'); assert.equal(credits(f), 0);
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()+interval '1 hour' WHERE session_id='${f.login.sessionId}'`);
    rotate(f.worker); await rpc(f.worker, 'repair', proof(f)); assert.deepEqual(payment(f), permanent);
    assert.deepEqual(references(await rpc(f.worker, 'pending')), []); assert.equal(credits(f), 0); assert.equal(receipt(f), null);
  });

  await test('shooter-metrics', 'bounded own-worker cursor passes32 failing wallets to repair the33rd real terminal proof without losing earlier pending evidence', async () => {
    isolate(); const w = await principal(), fixtures: Fixture[] = [];
    // Each trace is a complete real approved replay, not a fabricated terminal
    // or a synthetic payout target. All results belong to one logical worker.
    // Reuse only the service principal, never a player, issuance or checkpoint.
    // Every slice still reads its immutable stored ACK; the helper verifies its
    // strict cursor and final actual DB state without a redundant poll process.
    const principalsBefore = num('SELECT count(*) FROM game.shooter_verification_principal');
    for (let i = 0; i < 33; i++) fixtures.push(await fixture('broccoli-success-7', { worker: w, progressEvidence: 'stored-ack' }));
    assert.equal(new Set(fixtures.map(f => f.login.hub.userId)).size, 33, 'all33 actual game accounts remain distinct');
    assert.equal(num('SELECT count(*) FROM game.shooter_verification_principal'), principalsBefore, 'bulk setup allocates no unused service principals');
    const other = await principal(), first = await rpc(w, 'pending'); assert.equal(first.truncated, true); assert.equal(references(first).length, 4);
    const cursor = obj(first.nextCursor);
    assert.deepEqual(references(await rpc(other, 'pending', cursor)), []);
    for (const malformed of [{ afterCreatedAt: null, afterRequestId: 'x' }, { afterCreatedAt: 'yesterday', afterRequestId: 'x' },
      { afterCreatedAt: '2026-11-11T00:00:00Z' }, { ...cursor, workerId: w.workerId }]) {
      assert.equal((await rpc(w, 'pending', malformed)).state, 'authorization_denied');
    }
    installFaultHooks(); const seen = new Set<string>();
    try {
      for (const f of fixtures.slice(0, 32)) arm(f.login.hub.userId, 'earn.after_wallet', 'raise');
      enable(); let next: Obj = {}, pages = 0;
      while (true) {
        const page = await rpc(w, 'pending', next); assert.equal(page.state, 'pending_proofs');
        const refs = references(page); assert.ok(refs.length <= 4); if (!refs.length) break;
        for (const p of refs) {
          assert.ok(!seen.has(String(p.resultRequestId)), 'keyset never repeats attempted proof in one sweep'); seen.add(String(p.resultRequestId));
          const target = fixtures.find(f => f.last.requestId === p.resultRequestId); assert.ok(target, 'cursor never exposes another worker');
          const repaired = await rpc(w, 'repair', p);
          if (target === fixtures[32]) assert.equal(repaired.paid, true);
          else { assert.equal(repaired.state, 'pending_retryable'); assert.notEqual(repaired.paid, true); }
        }
        next = obj(page.nextCursor); assert.deepEqual(Object.keys(next).sort(), ['afterCreatedAt', 'afterRequestId']);
        assert.ok(++pages <= 9, 'finite4-proof pages reach all33');
      }
      assert.equal(seen.size, 33); assert.equal(credits(fixtures[32]!), 1); assert.equal(receipt(fixtures[32]!)?.tickets, 20);
      for (const f of fixtures.slice(0, 32)) { assert.equal(credits(f), 0); assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'pending'); }
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_payment_work WHERE worker_id='${w.workerId}' AND ready`), 32);
      assert.equal(references(await rpc(w, 'pending')).length, 4, 'next sweep retains every failed wallet proof');
    } finally { for (const f of fixtures.slice(0, 32)) disarm(f.login.hub.userId); dropFaultHooks(); }
  });

  await test('shooter-metrics', 'real migration backfills preexisting immutable pending proofs and repeated boot preserves all proof and financial history', async () => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'historical fixture restricted to disposable Actions DB');
    assert.equal(process.env.HUB_OBSERVATIONS_FIXTURE, 'pending-backfill');
    isolate(); const f = await fixture(), before = rows(f), p = proof(f);
    const ledger = psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations WHERE id<>${q(ID)} ORDER BY id`);
    assert.equal(psql(`SELECT max(id) FROM game.schema_migrations WHERE id>='0058'`), ID, 'never remove history beneath later migrations');
    compose(['stop', 'nakama']);
    try {
      // Trusted historical reconstruction: remove ONLY the unshipped0058
      // schema/ledger, preserving every predecessor, CP and immutable receipt.
      psql(`DROP TRIGGER shooter_verification_index_payment_proof ON game.shooter_verification_gateway_receipt;
        DROP TRIGGER shooter_verification_refresh_payment_work ON game.shooter_verification_run;
        DROP TABLE game.shooter_verification_payment_work;
        DROP FUNCTION game.shooter_verification_index_payment_proof();DROP FUNCTION game.shooter_verification_refresh_payment_work();
        DROP FUNCTION game.shooter_verification_pending_proofs(uuid,text,text,text,timestamptz,text);
        DROP FUNCTION game.shooter_verification_worker_maintenance(uuid,text,text,text);
        DROP FUNCTION game.shooter_verification_worker_receipt(uuid,text,text,text,text,text,text);
        DROP FUNCTION game.shooter_verification_worker_metrics(uuid,text,text,text);
        DROP FUNCTION game.shooter_verification_read_authorize(uuid,text,text,text,text);
        DROP INDEX game.shooter_verification_receipt_proof_reference;
        DROP INDEX game.shooter_verification_ops_pending;DROP INDEX game.shooter_verification_ops_payment;DROP INDEX game.shooter_verification_ops_quarantined;
        DELETE FROM game.schema_migrations WHERE id=${q(ID)};`);
    } finally { compose(['up', '-d', 'nakama']); await waitReady(); }
    assert.equal(rows(f), before); assert.deepEqual(references(await rpc(f.worker, 'pending')), [p]);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_payment_work WHERE worker_id='${f.worker.workerId}' AND run_id='${f.run}'`), 1);
    assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id=${q(ID)}`), fileChecksum(ID));
    assert.equal(psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations WHERE id<>${q(ID)} ORDER BY id`), ledger);
    const after = durable(); compose(['restart', 'nakama']); await waitReady(); assert.equal(durable(), after);
    enable(); assert.equal((await rpc(f.worker, 'repair', p)).paid, true); assert.equal(credits(f), 1); assert.equal(receipt(f)?.tickets, 20);
  });
  await test('shooter-metrics', 'truncated blocked queue is explicitly unknown and an actual claim progresses the later approved healthy replay', async () => {
    isolate(); const f = await fixture('broccoli-success-7', { tail: 10, stopAfterTerminal: true });
    const prefix = `metrics-blocked-${randomUUID()}-`;
    const owners = [];
    for (let i = 0; i < 5; i++) owners.push(await openGame((await guest()).token, 'sproto-shooter'));
    const ownerRows = owners.map((o, i) => `(${i},'${o.hub.userId}'::uuid,'${o.sessionId}'::uuid)`).join(',');
    const ids = `WITH owners(n,user_id,session_id) AS(VALUES${ownerRows}),ids AS(SELECT '${prefix}'||i AS run_id,user_id,session_id FROM generate_series(1,1000)i JOIN owners ON n=(i-1)%5)`;
    const retainedBefore = num('SELECT retained_runs FROM game.shooter_verification_admission');
    const bytesBefore = num('SELECT reserved_bytes FROM game.shooter_verification_admission');
    const batchesBefore = num('SELECT reserved_batches FROM game.shooter_verification_admission');
    // Trusted metadata-only fixture for the scheduler/observation sampling
    // boundary. These1000 runs are already quarantined and never simulated or
    // submitted as payment evidence. The later healthy trace remains the full
    // approved fixture with its genuine checkpoint and accepted suffix.
    // The real admission trigger reserves64MiB/4096batches per retained run.
    // Five actual accounts keep each819200-batch reservation below its hard
    // one-million bound. This final fixture retains those finite reservations;
    // no accounting/evidence reset is used to accommodate the test.
    // These are explicit trusted CI settings for a truncation regression, not
    // a capacity measurement or operating-limit recommendation. Keep this case
    // last, and this category after every other v2 fixture in the full suite.
    psql(`UPDATE game.shooter_verification_admission SET max_global_runs=10000,max_global_batches=10000000,max_account_runs=4096,max_account_bytes=1099511627776,max_account_batches=1000000;
      ${ids} INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
      SELECT x.run_id,x.user_id,x.session_id,x.run_id,old.day,old.canonical_boss,old.seed,
        (old.issuance_json::jsonb||jsonb_build_object('runId',x.run_id,'accountId',x.user_id,'sessionId',x.session_id))::text
      FROM game.shooter_run old CROSS JOIN ids x WHERE old.run_id='${f.run}';
      ${ids} INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline,
        lifecycle,accepted_sequence,accepted_tick,accepted_bytes,accepted_batches)
      SELECT x.run_id,x.user_id,x.session_id,r.simulator_protocol,r.checkpoint_schema,r.economy_policy,r.artifact_sha256,r.source_commit,r.content_fingerprint,
        now()-interval '40 minutes',now()+interval '5 minutes','expired',0,1,16,1
      FROM game.shooter_verification_run r CROSS JOIN ids x WHERE r.run_id='${f.run}';
      INSERT INTO game.shooter_verification_batch(run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,authorized_lease_until)
      SELECT '${prefix}'||i,0,0,1,'AAAAAAAAAAAAAAAA',16,'[]',0,repeat('d',64),jsonb_build_object('state','received','runId','${prefix}'||i),now()+interval '1 minute' FROM generate_series(1,1000)i;
      INSERT INTO game.shooter_verification_job(job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state)
      SELECT gen_random_uuid(),'${prefix}'||i,0,0,0,1,0,repeat('d',64),3,'quarantined' FROM generate_series(1,1000)i;
      DO $bound$ BEGIN BEGIN UPDATE game.shooter_verification_scheduler SET max_leased=10001;RAISE EXCEPTION 'missing finite lease cap';
        EXCEPTION WHEN check_violation THEN NULL;END;END;$bound$;`);
    assert.equal(num('SELECT retained_runs FROM game.shooter_verification_admission'), retainedBefore + 1000);
    assert.equal(num('SELECT reserved_bytes FROM game.shooter_verification_admission'), bytesBefore + 1000 * 67108864);
    assert.equal(num('SELECT reserved_batches FROM game.shooter_verification_admission'), batchesBefore + 1000 * 4096);
    for (const o of owners) {
      assert.equal(num(`SELECT retained_runs FROM game.shooter_verification_admission_account WHERE user_id='${o.hub.userId}'`), 200);
      assert.equal(num(`SELECT reserved_batches FROM game.shooter_verification_admission_account WHERE user_id='${o.hub.userId}'`), 200 * 4096);
    }
    const before = durable(), observed = await rpc(f.worker, 'ops'); assert.equal(observed.state, 'observed');
    assert.equal(observed.queueDepth, 1000); assert.equal(observed.queueTruncated, true); assert.equal(observed.eligible, false);
    assert.equal(observed.eligibilityUnknown, true); assert.equal(durable(), before, 'unknown hint is still nonmutating');
    const claimed = await rpc(f.worker, 'claim'); assert.equal(claimed.state, 'leased'); const work = obj(claimed.work);
    assert.equal(obj(work.claim).runId, f.run, 'authoritative scheduler can see past blocked sample');
    const replayed = obj(JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../../../services/shooter-verifier/test/restore-continuation.mjs', import.meta.url))], {
      input: JSON.stringify(work), encoding: 'utf8', timeout: 20000, maxBuffer: 20 * 1024 * 1024, env: { NODE_ENV: 'test' },
    })));
    assert.equal(replayed.kind, 'replayed');
    const committed = await rpc(f.worker, 'result', { manifest: work.manifest, result: replayed });
    assert.equal(committed.state, 'terminal_verified'); assert.equal(committed.verifiedTick, f.tick);
    assert.equal(num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), f.tick);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id LIKE '${prefix}%' AND frames IS NOT NULL`), 1000);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id LIKE '${prefix}%' AND state='quarantined'`), 1000);
    assert.equal(credits(f), 0); assert.equal(receipt(f), null);
  });

}
