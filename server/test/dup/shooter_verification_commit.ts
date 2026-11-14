import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { guest, openGame, call, psql, psqlAsync, num, sleep, arm, type GameLogin } from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
type ObjectValue = Record<string, unknown>;
type Claim = { jobId: string; runId: string; accountId: string; sessionId: string; inputSha256: string; fence: number; initialRevision: number; expectedRevision: number; tick0: number; tickEnd: number; continuationTick: number };
type Work = { claim: Claim; manifest: ObjectValue; issuance: ObjectValue; checkpoint: ObjectValue | null; batch: ObjectValue; accepted: ObjectValue; maxWorkFrames: number };
const SHA = '7ba57e4214ce5b9b69dd00b78fd9cd36c6d08049bb0495cb9cf94faee0077f2e';
const MANIFEST = { artifact: 'shooter-sim', sourceCommit: '1fd01820e5f9f62fd549db09408261b7b6674c79', sha256: SHA, protocol: 1, contentFingerprint: '73c6eb0f', uploadProtocol: 2, replayApiVersion: 2, checkpointSchema: 2, economyPolicy: 1 };
const context = vm.createContext({ console });
const artifactBytes = readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`, import.meta.url));
assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), SHA);
vm.runInContext(artifactBytes.toString('utf8'), context);
function inSim(expression: string, input: unknown): unknown {
  context.__value = JSON.stringify(input);
  try { return JSON.parse(vm.runInContext(`JSON.stringify((function(v) { ${expression} })(JSON.parse(__value)))`, context) as string) as unknown; }
  finally { delete context.__value; }
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => `${JSON.stringify(k)}:${stable(value)}`).join(',')}}`;
  return JSON.stringify(v);
}
function sql(v: string): string { return v.replace(/'/g, "''"); }
function obj(v: unknown): ObjectValue { return v as ObjectValue; }
function reply(v: { body: unknown }): ObjectValue { return obj(v.body); }
const CONFIG = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1099511627776,max_account_checkpoint_bytes=1073741824,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
 UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=100000,account_attempts_per_minute=10000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400`;
function isolate(): void {
  psql(`UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL WHERE state IN ('ready','leased','retry_wait');
    UPDATE game.shooter_verification_run SET lifecycle='invalid' WHERE lifecycle IN ('open','sealed','expired','terminal','quarantined'); ${CONFIG}`);
}
async function fixture(n = 10, wire?: { frames: string; actions: number[][] }) {
  const account = await guest(); const login = await openGame(account.token, 'sproto-shooter'); const run = crypto.randomUUID();
  const issuance = obj(inSim('return SprotoShooterSim.buildIssuance(v).issuance;', { accountId: account.userId, sessionId: login.sessionId, runId: run, day: psql("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text"), canonicalBoss: 'sahil', seed: 7 }));
  psql(`INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES('${run}','${account.userId}','${login.sessionId}','commit:${run}',current_date,'sahil',7,'${sql(JSON.stringify(issuance))}');
    INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES('${run}','${account.userId}','${login.sessionId}',1,2,1,'${SHA}','${MANIFEST.sourceCommit}','73c6eb0f',now()-interval '3 minutes',now()+interval '42 minutes')`);
  await append(login, run, 0, 0, n, wire);
  return { login, run };
}
async function append(login: GameLogin, run: string, sequence: number, tick0: number, n: number, wire?: { frames: string; actions: number[][] }) {
  const result = reply(await call('shooter.run.append', { protocol: 2, runId: run, sequence, tick0, n, frames: wire ? wire.frames : Buffer.alloc(n * 12).toString('base64'), actions: wire ? wire.actions : [] }, login.gameToken));
  assert.equal(result.state, 'received', JSON.stringify(result)); return result;
}
async function worker() {
  const login = await guest(); const workerId = `commit-${crypto.randomUUID()}`; const token = randomBytes(32).toString('base64url'); const keyId = 'one';
  const hash = createHash('sha256').update(`shooter-worker-token-v1\n${token}`).digest('hex');
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${login.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${login.userId}','${workerId}','${keyId}','${hash}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes')`);
  return { login, workerId, token, keyId };
}
type Worker = Awaited<ReturnType<typeof worker>>;
async function rpc(w: Worker, op: string, body: unknown, requestId = crypto.randomUUID()) {
  return reply(await call(`shooter.internal.${op}`, { workerId: w.workerId, keyId: w.keyId, token: w.token, requestId, body }, w.login.token));
}
async function claim(w: Worker): Promise<Work> {
  const result = await rpc(w, 'claim', {}); assert.equal(result.state, 'leased', JSON.stringify(result)); return result.work as Work;
}
function replay(work: Work, count = work.maxWorkFrames): ObjectValue {
  return obj(inSim(`
    var api=SprotoShooterSim, m=v.work.manifest, ctx={issuance:v.work.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},maxWorkFrames:v.count};
    var cp=v.work.checkpoint;
    if(!cp) cp=api.beginIncrementalReplay(ctx).privateCheckpoint;
    if(!cp.pending) cp=api.acceptReplayBatch(JSON.stringify(v.work.batch),cp,Object.assign({},ctx,{accepted:v.work.accepted})).privateCheckpoint;
    var out=api.stepReplaySlice(cp,ctx);
    return {kind:'replayed',binding:v.work.claim,privateCheckpoint:out.privateCheckpoint,publicResult:JSON.parse(api.publicReplayJSON(out))};`, { work, count }));
}
function body(result: ObjectValue) { return { manifest: MANIFEST, result }; }
async function submit(w: Worker, result: ObjectValue, rid?: string) { return rpc(w, 'result', body(result), rid); }
function history(run: string): string {
  return psql(`SELECT revision||':'||verified_tick||':'||simulation_tick||':'||verified_sequence||':'||verified_bytes||':'||verified_actions FROM game.shooter_verification_run WHERE run_id='${run}'`);
}
function noPayment(run: string): void { assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`), 0); }
function rehash(cp: ObjectValue): void {
  const { privateHash: _old, ...rest } = cp;
  const encoded = stable(rest); let h = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) h = Math.imul(h ^ encoded.charCodeAt(i), 0x01000193);
  cp.privateHash = (h >>> 0).toString(16).padStart(8, '0');
}
export async function runShooterVerificationCommit(test: TestFn): Promise<void> {
  await test('shooter-commit', 'real checkpoint commits positive progress once and identical cross-id retries return stable acknowledgment', async () => {
    isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const result = replay(work); const rid = crypto.randomUUID();
    const unchangedCP = structuredClone(obj(result.privateCheckpoint));
    const originalHash = unchangedCP.privateHash; const originalSnapshotHash = obj(unchangedCP.snapshot).privateHash;
    rehash(obj(unchangedCP.snapshot)); assert.equal(obj(unchangedCP.snapshot).privateHash, originalSnapshotHash);
    rehash(unchangedCP); assert.equal(unchangedCP.privateHash, originalHash, 'adversarial rehash helper preserves exact source UTF16 key ordering');
    const [one, two] = await Promise.all([submit(w, result, rid), submit(w, result, rid)]);
    assert.equal(one.state, 'verified', JSON.stringify(one)); assert.deepEqual(two, one); assert.deepEqual(await submit(w, result), one);
    const outsider = await worker(); assert.equal((await submit(outsider, result)).state, 'authorization_denied', 'another scoped worker cannot recover an attempt it never owned');
    assert.equal(history(f.run), '1:10:10:0:160:0');
    assert.equal(psql(`SELECT state FROM game.shooter_verification_job WHERE job_id='${work.claim.jobId}'`), 'completed');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${work.claim.jobId}'`), 1);
    noPayment(f.run);
  });

  await test('shooter-commit', 'partial first-batch progress keeps one immutable logical range and advances its fenced continuation', async () => {
    isolate(); const f = await fixture(20, { frames: Buffer.alloc(240).toString('base64'), actions: [[0, 1], [19, 1]] });
    await append(f.login, f.run, 1, 20, 5, { frames: Buffer.alloc(60).toString('base64'), actions: [[0, 1]] });
    const w = await worker(); const first = await claim(w);
    const result = replay(first, 1); const ack = await submit(w, result);
    assert.equal(ack.jobComplete, false, JSON.stringify(ack)); assert.equal(history(f.run), '1:1:1:-1:16:1');
    assert.equal(obj(obj(result.privateCheckpoint).accounting).actions, 2);
    assert.equal(obj(obj(result.privateCheckpoint).accounting).verifiedActions, 1);
    assert.equal(psql(`SELECT accepted_tick||':'||accepted_actions FROM game.shooter_verification_run WHERE run_id='${f.run}'`), '25:3', 'Hub accepted history can be ahead of the source prefix');
    assert.equal(psql(`SELECT tick0||':'||tick_end||':'||initial_revision||':'||expected_revision||':'||continuation_tick FROM game.shooter_verification_job WHERE job_id='${first.claim.jobId}'`), '0:20:0:1:1');
    await sleep(1100); const second = await claim(w); assert.equal(second.claim.jobId, first.claim.jobId); assert.equal(second.claim.fence, 2); assert.equal(second.claim.expectedRevision, 1);
    const before = history(f.run);
    assert.equal((await submit(w, { ...result, publicResult: { ...obj(result.publicResult), reason: 'conflicting_branch' } })).state, 'authorization_denied');
    assert.equal(history(f.run), before);
    const final = await submit(w, replay(second)); assert.equal(final.jobComplete, true); assert.equal(history(f.run), '2:20:20:0:320:2');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${f.run}'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${first.claim.jobId}'`), 2);
    const tail = await claim(w); await submit(w, replay(tail));
    assert.equal(history(f.run), '3:25:25:1:400:3', 'new-batch accepted and verified action prefixes increment exactly once');
    assert.equal(num(`SELECT accepted_actions FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 3); noPayment(f.run);
  });

  await test('shooter-commit', 'changed artifact input digest checkpoint schema state hash and accounting never mutate predecessor', async () => {
    isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const original = replay(work); const before = history(f.run);
    const mutations: ((r: ObjectValue) => void)[] = [
      (r) => { obj(r.binding).inputSha256 = '0'.repeat(64); },
      (r) => { obj(r.privateCheckpoint).v = 99; },
      (r) => { const cp = obj(r.privateCheckpoint); obj(obj(cp.snapshot).state).version = 99; rehash(obj(cp.snapshot)); rehash(cp); },
      (r) => { obj(r.privateCheckpoint).privateHash = '00000000'; },
      (r) => { const cp = obj(r.privateCheckpoint); obj(obj(obj(cp.snapshot).state).tuning).godMode = true; rehash(obj(cp.snapshot)); rehash(cp); },
      (r) => { const cp = obj(r.privateCheckpoint); const s = obj(obj(cp.snapshot).state); obj(obj(s.players)[String(s.localPlayerId)]).dead = 'yes'; rehash(obj(cp.snapshot)); rehash(cp); },
      (r) => { const cp = obj(r.privateCheckpoint); obj(obj(cp.snapshot).state).oversizedString = 'a'.repeat(16385); rehash(obj(cp.snapshot)); rehash(cp); },
      (r) => { const cp = obj(r.privateCheckpoint); obj(cp.accounting).verifiedFrames = 9; rehash(cp); },
      (r) => { const cp = obj(r.privateCheckpoint); obj(cp.issuance).seed = 8; rehash(cp); },
    ];
    for (const change of mutations) {
      const r = structuredClone(original); change(r); const ack = await submit(w, r);
      assert.notEqual(ack.state, 'verified', JSON.stringify(ack)); assert.equal(history(f.run), before);
    }
    const changedManifest = { ...MANIFEST, sha256: '0'.repeat(64) };
    assert.notEqual((await rpc(w, 'result', { manifest: changedManifest, result: original })).state, 'verified');
    assert.equal(history(f.run), before); assert.equal((await submit(w, original)).state, 'verified'); noPayment(f.run);
  });

  await test('shooter-commit', 'stale success and stale invalid close cannot overwrite a newer checkpoint', async () => {
    isolate(); const f = await fixture(20); const w = await worker(); const old = await claim(w); const success = replay(old, 1);
    await submit(w, success); await sleep(1100); const fresh = await claim(w); await submit(w, replay(fresh)); const before = history(f.run);
    const invalid = { kind: 'replayed', binding: old.claim, privateCheckpoint: null, publicResult: { version: 2, status: 'invalid', reason: 'teleport', retryable: false, eligible: false, ranked: false, ticketsMinted: 0 } };
    assert.equal((await submit(w, invalid)).state, 'authorization_denied');
    const conflict = structuredClone(success); obj(conflict.publicResult).reason = 'changed'; assert.equal((await submit(w, conflict)).state, 'authorization_denied');
    assert.equal(history(f.run), before); assert.equal(psql(`SELECT lifecycle FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'open'); noPayment(f.run);
  });

  await test('shooter-commit', 'first terminal freezes simulation while accepted suffix input remains durably resolvable', async () => {
    isolate(); const f = await fixture(4000); await append(f.login, f.run, 1, 4000, 1000); const w = await worker();
    const first = await claim(w); const result = replay(first); const cp = obj(result.privateCheckpoint); assert.notEqual(cp.firstTerminal, null, 'full idle Sahil failure fixture retains actual terminal');
    const contradictory = structuredClone(result);
    const badCP = obj(contradictory.privateCheckpoint); obj(badCP.firstTerminal).outcome = 'clear'; obj(badCP.firstTerminal).eligible = true; rehash(badCP);
    obj(contradictory.publicResult).terminal = Object.fromEntries(Object.entries(obj(badCP.firstTerminal)).filter(([key]) => key !== 'parts'));
    obj(contradictory.publicResult).eligible = true;
    assert.equal((await submit(w, contradictory)).state, 'pending_retryable', 'contradictory rehashed terminal is operational worker failure');
    const ack = await submit(w, result); assert.equal(ack.state, 'terminal_verified', JSON.stringify(ack));
    assert.equal(ack.terminalRevision, 1);
    const frozen = psql(`SELECT terminal_tick||':'||terminal_result::text FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
    assert.equal(psql(`SELECT terminal_accepted_sequence||':'||terminal_accepted_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), '1:5000');
    const newAppend = reply(await call('shooter.run.append', { protocol: 2, runId: f.run, sequence: 2, tick0: 5000, n: 1, frames: Buffer.alloc(12).toString('base64'), actions: [] }, f.login.gameToken));
    assert.equal(newAppend.reason, 'run_closed');
    const tail = await claim(w); assert.equal(tail.accepted.acceptedBeforeTerminal, true);
    const tailResult = replay(tail); const changedState = structuredClone(tailResult);
    const changedCP = obj(changedState.privateCheckpoint); obj(obj(changedCP.snapshot).state).events = []; rehash(obj(changedCP.snapshot)); rehash(changedCP);
    // Events do not enter the terminal stateHash; freeze still covers the full snapshot state.
    if (stable(obj(obj(changedCP.snapshot).state).events) === stable(obj(obj(obj(tailResult.privateCheckpoint).snapshot).state).events)) obj(obj(changedCP.snapshot).state).events = [{ type: 'forged_after_terminal' }];
    rehash(obj(changedCP.snapshot)); rehash(changedCP);
    assert.equal((await submit(w, changedState)).state, 'pending_retryable');
    const final = await submit(w, tailResult); assert.equal(final.verifiedTick, 5000); assert.equal(final.state, 'terminal_verified');
    assert.equal(psql(`SELECT terminal_tick||':'||terminal_result::text FROM game.shooter_verification_run WHERE run_id='${f.run}'`), frozen);
    assert.equal(num(`SELECT verified_sequence FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 1); noPayment(f.run);
  });

  await test('shooter-commit', 'full frozen 9634-frame clear commits real positive terminal and pending payment without paying', async () => {
    isolate();
    const trace = JSON.parse(readFileSync(new URL('../games/fixtures/sahil-success.json', import.meta.url), 'utf8')) as { log: { segments: { n: number; frames: string; actions: number[][] }[] } };
    const segment = trace.log.segments[0]!; assert.equal(trace.log.segments.length, 1); assert.equal(segment.n, 9634);
    const f = await fixture(segment.n, segment); const w = await worker();
    let final: ObjectValue = {};
    for (let i = 0; i < 3; i++) {
      const work = await claim(w); final = await submit(w, replay(work));
      assert.equal(final.jobComplete, true, JSON.stringify(final));
    }
    assert.equal(final.state, 'terminal_verified'); assert.equal(final.verifiedTick, 9634); assert.equal(final.simulationTick, 9634); assert.equal(final.terminalRevision, 3);
    assert.equal(psql(`SELECT terminal_outcome||':'||(terminal_result->>'eligible')||':'||payment_state||':'||terminal_revision FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 'clear:true:pending:3');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${f.run}' AND state='completed'`), 3);
    assert.equal(num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`), 9634);
    noPayment(f.run); assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${f.login.hub.userId}'`), 0);
  });

  await test('shooter-commit', 'original session expiry permits explanation-only verification and expired attempt cannot be revived', async () => {
    isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const result = replay(work);
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${f.login.sessionId}'`);
    assert.equal((await submit(w, result)).state, 'verified'); noPayment(f.run);
    const status = reply(await call('shooter.run.status', { runId: f.run }, f.login.hub.token)); assert.equal(status.authorization, 'session_expired');
    isolate(); const expired = await fixture(); const ew = await claim(w); const er = replay(ew);
    psql(`UPDATE game.shooter_verification_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id='${ew.claim.jobId}'`);
    assert.equal((await submit(w, er)).state, 'authorization_denied'); assert.equal(history(expired.run), '0:0:0:-1:0:0');
  });

  await test('shooter-commit', 'operational and zero-progress result retries retain stable cross-id acknowledgments without advancing', async () => {
    for (const mode of ['null', 'export', 'zero']) {
      isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w);
      let result: ObjectValue;
      if (mode !== 'zero') {
        result = { kind: 'replayed', binding: work.claim, privateCheckpoint: null, publicResult: { version: 2, status: 'pending_retryable', reason: mode === 'export' ? 'checkpoint_export_failure' : 'execution_timeout', retryable: true, eligible: false, ranked: false, ticketsMinted: 0 } };
      } else {
        result = obj(inSim(`var m=v.manifest,ctx={issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},accepted:v.accepted};
          var cp=SprotoShooterSim.beginIncrementalReplay(ctx).privateCheckpoint;var r=SprotoShooterSim.acceptReplayBatch(JSON.stringify(v.batch),cp,ctx);
          return {kind:'replayed',binding:v.claim,privateCheckpoint:r.privateCheckpoint,publicResult:JSON.parse(SprotoShooterSim.publicReplayJSON(r))};`, work));
      }
      const one = await submit(w, result); assert.equal(one.state, 'pending_retryable', JSON.stringify(one));
      assert.deepEqual(await submit(w, result), one, 'new request ID cannot create a new operational attempt');
      assert.equal(history(f.run), '0:0:0:-1:0:0');
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${work.claim.jobId}'`), 1);
      const other = await worker(); assert.equal((await submit(other, result)).state, 'authorization_denied');
    }
  });

  await test('shooter-commit', 'result blocked across lease expiry rolls back checkpoint revision and immutable acknowledgment', async () => {
    isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const result = replay(work);
    psql(`UPDATE game.shooter_verification_job SET lease_until=clock_timestamp()+interval '1 second' WHERE job_id='${work.claim.jobId}'`);
    const holding = psqlAsync(`SET application_name='shooter-commit-expiry'; BEGIN; SELECT 1 FROM game.shooter_verification_job WHERE job_id='${work.claim.jobId}' FOR UPDATE; SELECT pg_sleep(2); COMMIT;`);
    const deadline = Date.now() + 5000;
    while (num("SELECT count(*) FROM pg_stat_activity WHERE application_name='shooter-commit-expiry' AND wait_event='PgSleep'") === 0) { assert.ok(Date.now() < deadline); await sleep(20); }
    const ack = await submit(w, result); await holding; assert.equal(ack.state, 'authorization_denied'); assert.equal(history(f.run), '0:0:0:-1:0:0');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${work.claim.jobId}'`), 0);
  });

  await test('shooter-commit', 'injected failures before commit and after durable commit recover without duplicate advancement', async () => {
    for (const point of ['before_commit', 'after_commit']) {
      isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const result = replay(work); const requestId = crypto.randomUUID();
      arm(w.login.userId, `shooter.worker.${point}`, 'raise');
      const lost = await submit(w, result, requestId); assert.equal(lost.state, 'pending_retryable'); assert.equal(lost.reason, 'gateway_unavailable');
      assert.equal(history(f.run), point === 'before_commit' ? '0:0:0:-1:0:0' : '1:10:10:0:160:0');
      const ack = await submit(w, result, requestId); assert.equal(ack.state, 'verified'); assert.deepEqual(await submit(w, result, requestId), ack);
      assert.equal(history(f.run), '1:10:10:0:160:0');
      assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${work.claim.jobId}'`), 1);
      noPayment(f.run);
    }
  });

  await test('shooter-commit', 'service key expiry during result lock wait rolls back a complete checkpoint and request receipt', async () => {
    isolate(); const f = await fixture(); const w = await worker(); const work = await claim(w); const result = replay(work); const requestId = crypto.randomUUID();
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()+interval '2 seconds' WHERE worker_id='${w.workerId}'`);
    const holding = psqlAsync(`SET application_name='shooter-result-key-expiry'; BEGIN; SELECT 1 FROM game.shooter_verification_job WHERE job_id='${work.claim.jobId}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;`);
    const deadline = Date.now() + 5000;
    while (num("SELECT count(*) FROM pg_stat_activity WHERE application_name='shooter-result-key-expiry' AND wait_event='PgSleep'") === 0) { assert.ok(Date.now() < deadline); await sleep(20); }
    const request = submit(w, result, requestId);
    while (num("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%SELECT game.shooter_verification_internal(%' AND wait_event_type='Lock'") === 0) { assert.ok(Date.now() < deadline, 'authorized result reached the downstream lock'); await sleep(20); }
    const ack = await request; await holding; assert.equal(ack.state, 'authorization_denied');
    assert.equal(history(f.run), '0:0:0:-1:0:0');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${work.claim.jobId}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${w.workerId}' AND request_id='${requestId}'`), 0);
    noPayment(f.run);
  });

}
