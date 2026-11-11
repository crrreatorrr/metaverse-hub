import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guest, openGame, call, psql, psqlAsync, num, sleep, arm, faulted, installFaultHooks, dropFaultHooks, type GameLogin, type RpcResult } from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
const PIN = JSON.parse(readFileSync(new URL('../../modules/vendor/shooter-sim.pin.json', import.meta.url), 'utf8')) as { sha256: string; commit: string; fingerprint: string };
const CONFIGURE = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,
  max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,
  max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000`;
function body(result: RpcResult): Record<string, unknown> { return result.body as Record<string, unknown>; }

async function fixture(bind = true): Promise<{ login: GameLogin; run: string; metadata: string }> {
  const account = await guest();
  const login = await openGame(account.token, 'sproto-shooter');
  const run = crypto.randomUUID();
  psql(`INSERT INTO game.shooter_run (run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES ('${run}','${account.userId}','${login.sessionId}','fixture:${run}',(now() AT TIME ZONE 'UTC')::date,'sahil',7,'{}')`);
  // Trusted fixture issuance, not an implemented public v2 issuer or client state.
  const metadata = `INSERT INTO game.shooter_verification_run
    (run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES ('${run}','${account.userId}','${login.sessionId}',1,1,1,'${PIN.sha256}','${PIN.commit}','${PIN.fingerprint}',now()-interval '1 minute',now()+interval '44 minutes')`;
  if (bind) psql(metadata);
  return { login, run, metadata };
}

function input(run: string, sequence = 0, tick0 = sequence, n = 1) {
  return { protocol: 2, runId: run, sequence, tick0, n, frames: Buffer.alloc(n * 12).toString('base64'), actions: [] as number[][] };
}

function noPayment(user: string): void {
  assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE user_id='${user}'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${user}'`), 0);
}

async function sleeping(name: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`) > 0) return;
    await sleep(20);
  }
  throw new Error('race connection did not reach its locked sleep');
}

function legacyCall(op: string, user: string, sid: string, run: string): string {
  if (op === 'close') return `SELECT game.close_shooter_run('${user}','${run}',repeat('c',64),'player_down')::text`;
  if (op === 'checkpoint') return `SELECT game.save_shooter_checkpoint('${user}','${run}',repeat('c',64),'{}','12345678',1)::text`;
  return `SELECT game.settle_shooter_clear('${user}','${sid}','${run}','sahil',(now() AT TIME ZONE 'UTC')::date,
    repeat('d',64),'12345678',1000,1,'${PIN.fingerprint}',repeat('e',64))::text`;
}

export async function runShooterVerificationIngest(test: TestFn): Promise<void> {
  psql(CONFIGURE);
  await test('shooter-ingest', 'v2 append stores one immutable received acknowledgment across concurrent retries', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 4 }, () => call('shooter.run.append', input(f.run), f.login.gameToken)));
    for (const result of results) {
      assert.equal(body(result).state, 'received', JSON.stringify(result));
      assert.deepEqual(result.body, results[0]!.body);
    }
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${f.run}'`), 1);
    assert.equal(psql(`SELECT accepted_bytes||':'||accepted_batches||':'||accepted_tick||':'||verified_tick||':'||revision FROM game.shooter_verification_run WHERE run_id='${f.run}'`), '16:1:1:0:0');
    assert.equal(num(`SELECT retained_bytes FROM game.shooter_verification_admission_account WHERE user_id='${f.login.hub.userId}'`), 16);
    const second = await call('shooter.run.append', input(f.run, 1), f.login.gameToken);
    assert.equal(body(second).acceptedTick, 2);
    assert.equal(num(`SELECT accepted_bytes FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 32);
    const old = await call('shooter.run.status', { runId: f.run, sequence: 0 }, f.login.hub.token);
    assert.deepEqual(body(old).receivedAck, results[0]!.body, 'status recovers the original receipt after later progress');
    noPayment(f.login.hub.userId);
  });

  await test('shooter-ingest', 'v2 conflicting races gaps overlaps and injected authority never overwrite history', async () => {
    const f = await fixture();
    const changed = input(f.run); changed.actions = [[0, 1]];
    const race = await Promise.all([call('shooter.run.append', input(f.run), f.login.gameToken), call('shooter.run.append', changed, f.login.gameToken)]);
    assert.deepEqual(race.map((r) => body(r).state).sort(), ['invalid', 'received']);
    assert.ok(race.some((r) => body(r).reason === 'sequence_conflict'));
    const before = psql(`SELECT accepted_sequence||':'||accepted_tick||':'||accepted_bytes FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
    for (const value of [input(f.run, 2, 1), input(f.run, 1, 0), { ...input(f.run, 1), checkpoint: {} }, { ...input(f.run, 1), reward: 20 }]) {
      assert.equal(body(await call('shooter.run.append', value, f.login.gameToken)).state, 'invalid');
    }
    assert.equal(psql(`SELECT accepted_sequence||':'||accepted_tick||':'||accepted_bytes FROM game.shooter_verification_run WHERE run_id='${f.run}'`), before);
    const outsider = await guest();
    const otherGame = await openGame(outsider.token, 'sproto-shooter');
    assert.equal(body(await call('shooter.run.append', input(f.run), otherGame.gameToken)).reason, 'unknown_run');
    assert.equal(body(await call('shooter.run.status', { runId: f.run }, outsider.token)).reason, 'unknown_run');
    noPayment(f.login.hub.userId);
  });

  await test('shooter-ingest', 'v2 owner status survives expiry and redacts private state without trusting paid metadata', async () => {
    const f = await fixture();
    const ack = body(await call('shooter.run.append', input(f.run), f.login.gameToken));
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${f.login.sessionId}';
      UPDATE game.shooter_verification_run SET checkpoint_json='{"secret":"PRIVATE_CHECKPOINT"}',checkpoint_sha256=repeat('a',64),
        terminal_tick=0,terminal_outcome='incomplete',terminal_result='{"checkpoint":"PRIVATE_TERMINAL"}',payment_state='paid',lifecycle='terminal' WHERE run_id='${f.run}'`);
    assert.equal(body(await call('shooter.run.append', input(f.run), f.login.gameToken)).state, 'authorization_denied');
    const status = body(await call('shooter.run.status', { runId: f.run, sequence: 0 }, f.login.hub.token));
    assert.equal(status.authorization, 'session_expired');
    assert.deepEqual(status.receivedAck, ack);
    assert.deepEqual(status.payment, { state: 'pending_retryable', reason: 'receipt_unavailable' });
    assert.ok(!JSON.stringify(status).includes('PRIVATE_'));
    noPayment(f.login.hub.userId);
  });

  await test('shooter-ingest', 'v2 reserves finite capacity while stop-new-runs still permits an issued run to drain', async () => {
    const f = await fixture();
    const reserved = num(`SELECT reserved_bytes FROM game.shooter_verification_admission`);
    assert.ok(reserved >= 67108864);
    psql(`UPDATE game.shooter_verification_admission SET max_global_runs=retained_runs`);
    await assert.rejects(() => fixture(), /shooter_verification_capacity/);
    assert.equal(num(`SELECT reserved_bytes FROM game.shooter_verification_admission`), reserved);
    psql(`${CONFIGURE}; UPDATE game.shooter_verification_admission SET new_runs_enabled=false`);
    await assert.rejects(() => fixture(), /shooter_verification_disabled/);
    assert.equal(body(await call('shooter.run.append', input(f.run), f.login.gameToken)).state, 'received');
    psql(CONFIGURE);
    noPayment(f.login.hub.userId);
  });

  await test('shooter-ingest', 'v2 durable rate denial and postcommit response loss cannot duplicate input or payment', async () => {
    const f = await fixture();
    psql(`UPDATE game.shooter_verification_admission SET account_appends_per_minute=1`);
    assert.equal(body(await call('shooter.run.append', input(f.run), f.login.gameToken)).state, 'received');
    assert.equal(body(await call('shooter.run.append', input(f.run, 1), f.login.gameToken)).reason, 'rate_limited');
    psql(CONFIGURE);
    const g = await fixture();
    installFaultHooks();
    try {
      arm(g.login.hub.userId, 'shooter.append.after_commit', 'raise');
      assert.ok(faulted(await call('shooter.run.append', input(g.run), g.login.gameToken)));
      const retry = body(await call('shooter.run.append', input(g.run), g.login.gameToken));
      assert.equal(retry.state, 'received');
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${g.run}'`), 1);
      assert.equal(num(`SELECT accepted_batches FROM game.shooter_verification_run WHERE run_id='${g.run}'`), 1);
      noPayment(g.login.hub.userId);
    } finally { dropFaultHooks(); }
  });

  await test('shooter-ingest', 'v2 append samples live-session time after waiting on locks', async () => {
    const f = await fixture();
    const name = 'dup_v2_append_lease';
    const blocked = psqlAsync(`SET application_name='${name}'; BEGIN;
      SELECT 1 FROM game.game_session WHERE session_id='${f.login.sessionId}' FOR UPDATE;
      UPDATE game.game_session SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE session_id='${f.login.sessionId}';
      SELECT pg_sleep(1.2); COMMIT;`);
    await sleeping(name);
    const response = await call('shooter.run.append', input(f.run), f.login.gameToken);
    await blocked;
    assert.equal(body(response).reason, 'session_expired');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${f.run}'`), 0);
    noPayment(f.login.hub.userId);
  });

  await test('shooter-ingest', 'v2 binding wins races against legacy settlement checkpoint and close', async () => {
    for (const op of ['settle', 'checkpoint', 'close']) {
      const f = await fixture(false);
      const name = `dup_v2_bind_${op}`;
      const binding = psqlAsync(`SET application_name='${name}'; BEGIN; ${f.metadata}; SELECT pg_sleep(1.2); COMMIT;`);
      await sleeping(name);
      const result = await psqlAsync(legacyCall(op, f.login.hub.userId, f.login.sessionId, f.run));
      await binding;
      assert.equal((JSON.parse(result) as { reason: string }).reason, 'wrong_protocol');
      const legacyRpc = await call('shooter.run.submit', { runId: f.run, log: {} }, f.login.gameToken);
      assert.equal(body(legacyRpc).reason, 'wrong_protocol');
      noPayment(f.login.hub.userId);
    }
  });

  await test('shooter-ingest', 'legacy progress wins races and cannot be silently upgraded to v2', async () => {
    for (const op of ['settle', 'checkpoint', 'close']) {
      const f = await fixture(false);
      const name = `dup_legacy_${op}`;
      const legacy = psqlAsync(`SET application_name='${name}'; BEGIN;
        SELECT pg_advisory_xact_lock(hashtextextended('economy:'||'${f.login.hub.userId}',0));
        SELECT pg_sleep(1.2); ${legacyCall(op, f.login.hub.userId, f.login.sessionId, f.run)}; COMMIT;`);
      await sleeping(name);
      await assert.rejects(() => psqlAsync(f.metadata), /shooter_verification_legacy_processed/);
      await legacy;
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 0);
      assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE user_id='${f.login.hub.userId}'`), op === 'settle' ? 1 : 0);
    }
  });
}
