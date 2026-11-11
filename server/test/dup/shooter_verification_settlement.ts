import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { guest, openGame, call, psql, psqlAsync, num, sleep, arm, disarm, installFaultHooks, dropFaultHooks, type GameLogin } from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
type Obj = Record<string, unknown>;
const SHA = '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9';
const SOURCE = '05f7a0a245af921fc65a99588564175c19658e38';
const MANIFEST = { artifact: 'shooter-sim', sourceCommit: SOURCE, sha256: SHA, protocol: 1, contentFingerprint: 'cea1f88b', uploadProtocol: 2, replayApiVersion: 2, checkpointSchema: 2, economyPolicy: 1 };
const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`, import.meta.url), 'utf8'), ctx);
function obj(v: unknown): Obj { return v as Obj; }
function sql(v: string): string { return v.replace(/'/g, "''"); }
function sim(expression: string, value: unknown): Obj {
  ctx.__input = JSON.stringify(value);
  try { return obj(JSON.parse(vm.runInContext(`JSON.stringify((function(v){${expression}})(JSON.parse(__input)))`, ctx) as string)); }
  finally { delete ctx.__input; }
}
let corpusDirectory: string | null = null;
function frozen(name: string): Obj {
  if (!corpusDirectory) {
    corpusDirectory = process.env.SHOOTER_CORPUS || join(tmpdir(), `shooter-payments-corpus-${SOURCE}`);
    if (!process.env.SHOOTER_CORPUS && !existsSync(join(corpusDirectory, 'tests/fixtures/replay-corpus'))) {
      execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/crrreatorrr/sproto-shooter.git', corpusDirectory], { stdio: 'inherit' });
      execFileSync('git', ['-C', corpusDirectory, 'sparse-checkout', 'set', 'tests/fixtures/replay-corpus'], { stdio: 'inherit' });
      execFileSync('git', ['-C', corpusDirectory, 'fetch', '--depth', '1', 'origin', SOURCE], { stdio: 'inherit' });
      execFileSync('git', ['-C', corpusDirectory, 'checkout', '--detach', SOURCE], { stdio: 'inherit' });
    }
    if (!process.env.SHOOTER_CORPUS) corpusDirectory = join(corpusDirectory, 'tests/fixtures/replay-corpus');
  }
  return obj(JSON.parse(readFileSync(join(corpusDirectory, `${name}.json`), 'utf8')));
}
const CONFIG = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1099511627776,max_account_checkpoint_bytes=1073741824,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
 UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=1000000,account_attempts_per_minute=100000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400;
 UPDATE game.shooter_verification_payment_config SET payments_enabled=false`;
function isolate(): void {
  psql(`UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL WHERE state IN ('ready','leased','retry_wait');
    UPDATE game.shooter_verification_run SET lifecycle='invalid' WHERE lifecycle IN ('open','sealed','expired','terminal','quarantined'); ${CONFIG}`);
}
function enable(): void { psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=true'); }
async function worker() {
  const login = await guest(); const workerId = `pay-${randomUUID()}`; const token = randomBytes(32).toString('base64url');
  const keyId = 'one', hash = createHash('sha256').update(`shooter-worker-token-v1\n${token}`).digest('hex');
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${login.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${login.userId}','${workerId}','${keyId}','${hash}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '20 minutes')`);
  return { login, workerId, token, keyId, hash };
}
type Worker = Awaited<ReturnType<typeof worker>>;
async function rpc(w: Worker, operation: string, body: unknown, rid = randomUUID()): Promise<Obj> {
  return obj((await call(`shooter.internal.${operation}`, { workerId: w.workerId, keyId: w.keyId, token: w.token, requestId: rid, body }, w.login.token)).body);
}
function replay(work: Obj): Obj {
  return sim(`var m=v.manifest,api=SprotoShooterSim,c={issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},maxWorkFrames:v.maxWorkFrames};
    var cp=v.checkpoint;if(!cp)cp=api.beginIncrementalReplay(c).privateCheckpoint;
    if(!cp.pending)cp=api.acceptReplayBatch(JSON.stringify(v.batch),cp,Object.assign({},c,{accepted:v.accepted})).privateCheckpoint;
    var out=api.stepReplaySlice(cp,c);return {kind:'replayed',binding:v.claim,privateCheckpoint:out.privateCheckpoint,publicResult:JSON.parse(api.publicReplayJSON(out))};`, work);
}
type Submission = { worker: Worker; requestId: string; body: Obj; acknowledgment: Obj; returned: Obj };
type Fixture = { login: GameLogin; run: string; tick: number; expected: Obj; worker: Worker; last: Submission; submissions: Submission[] };
type Options = { login?: GameLogin; tail?: number; day?: string; beforeSubmit?: (w: Worker, login: GameLogin) => void; stopAfterTerminal?: boolean };
async function fixture(name = 'broccoli-success-7', options: Options = {}): Promise<Fixture> {
  const sample = frozen(name), original = obj(sample.issuance);
  const login = options.login || await openGame((await guest()).token, 'sproto-shooter');
  const run = randomUUID(), w = await worker();
  const day = options.day || psql("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text");
  const issuance = obj(sim('return SprotoShooterSim.buildIssuance(v).issuance;', {
    accountId: login.hub.userId, sessionId: login.sessionId, runId: run, day, canonicalBoss: original.canonicalBoss, seed: original.seed,
  }));
  psql(`INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES('${run}','${login.hub.userId}','${login.sessionId}','pay:${run}','${day}','${String(original.canonicalBoss)}',${Number(original.seed)},'${sql(JSON.stringify(issuance))}');
    INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES('${run}','${login.hub.userId}','${login.sessionId}',1,2,1,'${SHA}','${SOURCE}','cea1f88b',now()-interval '20 minutes',now()+interval '25 minutes')`);
  const segment = (obj(sample.log).segments as Obj[])[0]!;
  assert.equal((obj(sample.log).segments as Obj[]).length, 1, 'use the complete stored original trace');
  const n = Number(segment.n), tail = options.tail || 0;
  for (const batch of [{ protocol: 2, runId: run, sequence: 0, tick0: 0, n, frames: segment.frames, actions: segment.actions },
    ...(tail ? [{ protocol: 2, runId: run, sequence: 1, tick0: n, n: tail, frames: Buffer.alloc(tail * 12).toString('base64'), actions: [] }] : [])]) {
    const received = obj((await call('shooter.run.append', batch, login.gameToken)).body);
    assert.equal(received.state, 'received', JSON.stringify(received));
  }
  const submissions: Submission[] = [];
  options.beforeSubmit?.(w, login);
  while (num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${run}'`) < n + tail) {
    const claimed = await rpc(w, 'claim', {}); assert.equal(claimed.state, 'leased', JSON.stringify(claimed));
    const work = obj(claimed.work); assert.equal(obj(work.claim).runId, run);
    const result = replay(work), body = { manifest: MANIFEST, result }, requestId = randomUUID();
    assert.ok(result.privateCheckpoint, JSON.stringify(result.publicResult));
    const returned = await rpc(w, 'result', body, requestId);
    const raw = psql(`SELECT acknowledgment::text FROM game.shooter_verification_gateway_receipt WHERE worker_id='${w.workerId}' AND request_id='${requestId}'`);
    assert.ok(raw, JSON.stringify(returned)); const acknowledgment = obj(JSON.parse(raw));
    assert.ok(['verified', 'terminal_verified'].includes(String(acknowledgment.state)), JSON.stringify(acknowledgment));
    submissions.push({ worker: w, requestId, body, acknowledgment, returned });
    if (options.stopAfterTerminal && acknowledgment.state === 'terminal_verified') break;
  }
  assert.ok(submissions.length); return { login, run, tick: n + tail, expected: obj(sample.expected), worker: w, last: submissions[submissions.length - 1]!, submissions };
}
async function retry(f: Fixture): Promise<Obj> {
  return rpc(f.worker, 'result', f.last.body, f.last.requestId);
}
function payment(f: Fixture): Obj {
  const raw = psql(`SELECT COALESCE(payment_ack,'{}')::text FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
  return obj(JSON.parse(raw));
}
function receipt(f: Fixture): Obj | null {
  const raw = psql(`SELECT response::text FROM game.shooter_receipt WHERE run_id='${f.run}'`); return raw ? obj(JSON.parse(raw)) : null;
}
function financialSnapshot(user: string): string {
  return psql(`SELECT jsonb_build_object(
    'balance',(SELECT jsonb_agg(to_jsonb(t) ORDER BY game_id) FROM game.tickets_balance t WHERE user_id='${user}'),
    'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM game.tickets_ledger t WHERE user_id='${user}'),
    'caps',(SELECT jsonb_agg(to_jsonb(t) ORDER BY bucket,day) FROM game.earn_window t WHERE user_id='${user}'),
    'receipt',(SELECT jsonb_agg(to_jsonb(t) ORDER BY run_id) FROM game.shooter_receipt t WHERE user_id='${user}'),
    'rank',(SELECT jsonb_agg(to_jsonb(t) ORDER BY board_id,variant) FROM game.ranked_score t WHERE user_id='${user}'),
    'idem',(SELECT jsonb_agg(to_jsonb(t) ORDER BY key) FROM game.idempotency t WHERE user_id='${user}'))::text`);
}
function credits(f: Fixture): number { return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${f.login.hub.userId}' AND reason='srv_shooter_boss_clear'`); }
async function ownerStatus(f: Fixture): Promise<Obj> { return obj((await call('shooter.run.status', { runId: f.run }, f.login.hub.token)).body); }
async function waitSleep(name: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`) === 0) {
    assert.ok(Date.now() < deadline, 'lock holder entered sleep'); await sleep(20);
  }
}
function seedCap(f: Fixture, scope: 'session' | 'daily', value: number): void {
  const user = f.login.hub.userId, reference = scope === 'session' ? f.login.sessionId : randomUUID();
  psql(`INSERT INTO game.tickets_balance(user_id,game_id,balance) VALUES('${user}','sproto-shooter',${value}) ON CONFLICT(user_id,game_id) DO UPDATE SET balance=EXCLUDED.balance;
    INSERT INTO game.tickets_ledger(event_id,user_id,game_id,delta,balance_after,reason,ref_id,kind)
    VALUES(gen_random_uuid(),'${user}','sproto-shooter',${value},${value},'seed_cap','${reference}','earn');
    INSERT INTO game.earn_window(user_id,bucket,day,amount) VALUES('${user}','tickets:sproto-shooter',(clock_timestamp() AT TIME ZONE 'UTC')::date,${value}) ON CONFLICT(user_id,bucket,day) DO UPDATE SET amount=EXCLUDED.amount;
    INSERT INTO game.idempotency(user_id,key,rpc,req_hash,response) VALUES('${user}','seed-cap','tickets.earn',decode(repeat('a',64),'hex'),'{"balance":${value}}')`);
}
export async function runShooterVerificationSettlement(test: TestFn): Promise<void> {
  await test('shooter-payments', 'deferred payment is default off and concurrent duplicate terminal results credit once without replay', async () => {
    isolate(); const f = await fixture(); assert.equal(credits(f), 0); assert.equal(receipt(f), null);
    const revision = num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
    const before = financialSnapshot(f.login.hub.userId); await retry(f); assert.equal(financialSnapshot(f.login.hub.userId), before);
    enable(); const [one, two] = await Promise.all([retry(f), retry(f)]);
    assert.deepEqual(one, f.last.acknowledgment); assert.deepEqual(two, one); assert.equal(one.paid, undefined, 'verification ack never becomes payout authority');
    assert.equal(credits(f), 1); assert.equal(receipt(f)?.tickets, 20); assert.equal(payment(f).paid, true);
    assert.equal(num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${f.run}'`), revision, 'payment never increments verification revision');
    const after = financialSnapshot(f.login.hub.userId); for (let i = 0; i < 5; i++) await retry(f);
    assert.equal(financialSnapshot(f.login.hub.userId), after);
    assert.deepEqual(obj((await ownerStatus(f)).payment), { state: 'paid', tickets: 20 });
  });
  await test('shooter-payments', 'full 9634-frame Sahil clear ranks cumulative terminal time and waits for every accepted tail', async () => {
    isolate(); const f = await fixture('sahil-success-7', { tail: 10, stopAfterTerminal: true });
    assert.equal(f.expected.frames, 9634); assert.equal(f.submissions.length, 3, 'all9634 originalframes span three4096plannedjobs');
    enable(); await retry(f); assert.equal(credits(f), 0); assert.equal(receipt(f), null, 'accepted suffix still unresolved');
    const work = obj((await rpc(f.worker, 'claim', {})).work); const result = replay(work);
    const tailAck = await rpc(f.worker, 'result', { manifest: MANIFEST, result }); assert.equal(tailAck.verifiedTick, 9644);
    assert.equal(receipt(f)?.clearMs, Math.round(9634 * 1000 / 60)); assert.equal(credits(f), 1);
    assert.equal(num(`SELECT value FROM game.ranked_score WHERE user_id='${f.login.hub.userId}' AND board_id='shooter_story_clear_ms_v1' AND variant='sahil'`), Math.round(9634 * 1000 / 60));
    assert.equal(num(`SELECT simulation_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 9634);
  });
  await test('shooter-payments', 'response failure after checkpoint or payment commit recovers stable acknowledgment and exactly one credit', async () => {
    for (const point of ['shooter.worker.after_commit', 'shooter.v2.after_payment_commit']) {
      isolate(); enable();
      const f = await fixture('broccoli-success-7', { beforeSubmit: (w) => arm(w.login.userId, point, 'raise') });
      assert.equal(f.last.returned.state, 'pending_retryable');
      assert.equal(credits(f), point.endsWith('after_payment_commit') ? 1 : 0);
      disarm(f.worker.login.userId); const recovered = await retry(f); assert.deepEqual(recovered, f.last.acknowledgment);
      assert.equal(credits(f), 1); assert.equal(receipt(f)?.tickets, 20);
    }
  });
  await test('shooter-payments', 'wallet fault rolls back every financial row while keeping terminal pending and later retry pays once', async () => {
    isolate(); const f = await fixture(); const before = financialSnapshot(f.login.hub.userId);
    installFaultHooks();
    try {
      enable(); arm(f.login.hub.userId, 'earn.after_wallet', 'raise');
      assert.deepEqual(await retry(f), f.last.acknowledgment); assert.equal(financialSnapshot(f.login.hub.userId), before);
      assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'pending');
      disarm(f.login.hub.userId); await retry(f); assert.equal(credits(f), 1);
    } finally { disarm(f.login.hub.userId); dropFaultHooks(); }
  });
  await test('shooter-payments', 'valid queued clear after original session expiry or close retains terminal and never receives grace or rebind', async () => {
    for (const reason of ['session_expired', 'session_closed']) {
      isolate(); enable(); const f = await fixture('broccoli-success-7', { beforeSubmit: (_w, login) => psql(reason === 'session_expired'
        ? `UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${login.sessionId}'`
        : `UPDATE game.game_session SET state='closed' WHERE session_id='${login.sessionId}'`) });
      assert.equal(f.last.acknowledgment.state, 'terminal_verified'); assert.equal(payment(f).reason, reason); assert.equal(credits(f), 0);
      const denied = payment(f), before = financialSnapshot(f.login.hub.userId);
      psql(`UPDATE game.game_session SET state='open',lease_until=clock_timestamp()+interval '1 hour' WHERE session_id='${f.login.sessionId}'`);
      await retry(f); assert.deepEqual(payment(f), denied, 'a prior denial cannot be revived'); assert.equal(financialSnapshot(f.login.hub.userId), before);
    }
  });
  await test('shooter-payments', 'economy session and wallet lock waits crossing original lease expiry deny at current database time without financial side effects', async () => {
    for (const row of ['economy', 'session', 'wallet']) {
      isolate(); const f = await fixture(); enable();
      if (row === 'wallet') psql(`INSERT INTO game.tickets_balance(user_id,game_id,balance) VALUES('${f.login.hub.userId}','sproto-shooter',0) ON CONFLICT DO NOTHING`);
      const before = financialSnapshot(f.login.hub.userId), name = `pay-expiry-${row}`;
      psql(`UPDATE game.game_session SET lease_until=clock_timestamp()+interval '1 second' WHERE session_id='${f.login.sessionId}'`);
      const lock = row === 'economy' ? `SELECT pg_advisory_xact_lock(hashtextextended('economy:${f.login.hub.userId}',0))`
        : row === 'session' ? `SELECT 1 FROM game.game_session WHERE session_id='${f.login.sessionId}' FOR UPDATE`
          : `SELECT 1 FROM game.tickets_balance WHERE user_id='${f.login.hub.userId}' AND game_id='sproto-shooter' FOR UPDATE`;
      const holder = psqlAsync(`SET application_name='${name}'; BEGIN; ${lock}; SELECT pg_sleep(2); COMMIT;`); await waitSleep(name);
      await retry(f); await holder; assert.equal(payment(f).reason, 'session_expired', row);
      assert.equal(financialSnapshot(f.login.hub.userId), before, row); assert.equal(credits(f), 0);
    }
  });
  await test('shooter-payments', 'service key expiry during wallet wait is operational and a current rotated key retries the committed result', async () => {
    isolate(); const f = await fixture(); enable();
    psql(`INSERT INTO game.tickets_balance(user_id,game_id,balance) VALUES('${f.login.hub.userId}','sproto-shooter',0) ON CONFLICT DO NOTHING;
      UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()+interval '1 second' WHERE worker_id='${f.worker.workerId}'`);
    const before = financialSnapshot(f.login.hub.userId);
    const holder = psqlAsync(`SET application_name='pay-key-expiry'; BEGIN; SELECT 1 FROM game.tickets_balance WHERE user_id='${f.login.hub.userId}' AND game_id='sproto-shooter' FOR UPDATE; SELECT pg_sleep(2); COMMIT;`);
    await waitSleep('pay-key-expiry'); await retry(f); await holder;
    assert.equal(financialSnapshot(f.login.hub.userId), before); assert.equal(credits(f), 0);
    assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'pending');
    f.worker.keyId = 'two'; f.worker.token = randomBytes(32).toString('base64url'); f.worker.hash = createHash('sha256').update(`shooter-worker-token-v1\n${f.worker.token}`).digest('hex');
    psql(`INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
      VALUES('${f.worker.login.userId}','${f.worker.workerId}','two','${f.worker.hash}',ARRAY['result'],clock_timestamp()-interval '1 second',clock_timestamp()+interval '10 minutes')`);
    assert.deepEqual(await retry(f), f.last.acknowledgment); assert.equal(credits(f), 1);
  });
  await test('shooter-payments', 'session close and payment serialize at the locked live predicate and a paid receipt survives later expiry and disablement', async () => {
    isolate(); const closed = await fixture(); enable();
    const closer = psqlAsync(`SET application_name='pay-close-first'; BEGIN; UPDATE game.game_session SET state='closed' WHERE session_id='${closed.login.sessionId}'; SELECT pg_sleep(1); COMMIT;`);
    await waitSleep('pay-close-first'); await retry(closed); await closer; assert.equal(payment(closed).reason, 'session_closed'); assert.equal(credits(closed), 0);
    isolate(); const paid = await fixture(); enable(); await retry(paid); const original = receipt(paid); assert.equal(original?.paid, true);
    psql(`UPDATE game.game_session SET state='closed',lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${paid.login.sessionId}'; UPDATE game.shooter_verification_payment_config SET payments_enabled=false`);
    const before = financialSnapshot(paid.login.hub.userId); await retry(paid); assert.deepEqual(receipt(paid), original); assert.equal(financialSnapshot(paid.login.hub.userId), before);
    assert.deepEqual(obj((await ownerStatus(paid)).payment), { state: 'paid', tickets: 20 });
  });
  await test('shooter-payments', 'session shared-day and canonical-boss caps preserve fixed20-or-zero policy across concurrent bosses', async () => {
    for (const scope of ['session', 'daily'] as const) {
      isolate(); const first = await fixture('broccoli-success-7'); seedCap(first, scope, scope === 'session' ? 180 : 980);
      const second = await fixture('sahil-success-7', { login: first.login }); enable();
      await Promise.all([retry(first), retry(second)]); assert.equal(credits(first), 1, scope);
      assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE user_id='${first.login.hub.userId}'`), 1);
      const denied = receipt(first) ? second : first; assert.equal(payment(denied).capReason, scope === 'session' ? 'session_ticket_cap' : 'daily_ticket_cap');
      assert.equal(payment(denied).reason, 'cap_exhausted'); assert.equal(payment(denied).tickets, 0);
    }
    isolate(); const first = await fixture(); enable(); await retry(first);
    const second = await fixture('broccoli-success-7', { login: first.login }); const before = financialSnapshot(first.login.hub.userId);
    await retry(second); assert.equal(payment(second).reason, 'already_paid'); assert.equal(financialSnapshot(first.login.hub.userId), before);
  });
  await test('shooter-payments', 'historical issuance UTC day and current settlement UTC bucket stay distinct while assisted and failed runs payzero', async () => {
    isolate(); const yesterday = psql("SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date-1)::text");
    // Trusted historical issuance fixture, not a claim to advance real wall time.
    const f = await fixture('broccoli-success-7', { day: yesterday }); enable(); await retry(f);
    assert.equal(receipt(f)?.day, yesterday);
    assert.equal(num(`SELECT amount FROM game.earn_window WHERE user_id='${f.login.hub.userId}' AND bucket='boss:sproto-shooter:broccoli' AND day='${yesterday}'`), 1);
    assert.equal(num(`SELECT amount FROM game.earn_window WHERE user_id='${f.login.hub.userId}' AND bucket='tickets:sproto-shooter' AND day=(clock_timestamp() AT TIME ZONE 'UTC')::date`), 20);
    for (const name of ['sahil-assisted-9', 'sahil-fail-7']) {
      isolate(); const denied = await fixture(name); const before = financialSnapshot(denied.login.hub.userId); enable(); await retry(denied);
      assert.equal(payment(denied).state, 'ineligible'); assert.equal(credits(denied), 0); assert.equal(financialSnapshot(denied.login.hub.userId), before);
    }
  });
}
