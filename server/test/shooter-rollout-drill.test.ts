// ONE disposable, sequential core rollout drill. No production/shadow policy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { arm, call, canonical, disarm, dropFaultHooks, guest, installFaultHooks, num, openGame, psql, sqlId, waitReady } from './dup/harness';
import { appendActor, appendDigest, finishActor, integrationManifest, observeActor, prepareTrustedActor, reboundBatches,
  type PublicBatch, type TrustedActor } from './dup/shooter_verification_e2e_fixtures';
import { ops, prepareOperations, waitUntil } from './dup/shooter_verification_e2e_operations';
import { retainedOracle } from './dup/shooter_verification_e2e_oracle';

type Obj = Record<string, unknown>;
type Phase = 'guard' | 'baseline_paid' | 'partial_accepted' | 'stop_new' | 'append_finish' | 'uncertain_restart'
  | 'payment_paused' | 'payment_resumed' | 'history_stable' | 'cleanup';
const phases: { phase: Phase; elapsedMs: number }[] = [];
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown): string => sha(canonical(value));
const obj = (value: unknown): Obj => value as Obj;
const began = performance.now();
let phase: Phase = 'guard', passed = false, cleanupFailed = false, databaseReady = false, hooks = false, workerStarted = false;
let workerId = '', workerAccount = '', sleepName = '';
const actors: { role: 'baseline' | 'live' | 'expired'; actor: TrustedActor; batches: readonly PublicBatch[]; history: string }[] = [];
let uncertainProof: { requestBindingHash: string; requestSha256: string; acknowledgmentSha256: string; journalRecoveries: number; recovered: boolean } | null = null;
const resultRows: { role: 'baseline' | 'live' | 'expired'; accountBindingHash: string; sessionBindingHash: string; runBindingHash: string;
  frames: number; frameTextBytes: number; verifiedTick: number; terminalSha256: string; historySha256: string; progressSha256: string; receiptSha256: string | null;
  paymentState: 'paid' | 'authorization_denied'; credits: number }[] = [];
function done(): void { phases.push({ phase, elapsedMs: performance.now() - began }); }
function health(route: 'health' | 'metrics' = 'health'): Obj {
  return obj(JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '-e',
    `fetch('http://127.0.0.1:9476/${route}').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`])));
}
function journalReference(): { phase: string; requestId: string; sha256: string } | null {
  // Production journal reader emits ONLY metadata, never the private body.
  return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '--input-type=module', '-e',
    "import{Journal}from'./services/shooter-verifier/ops/journal.mjs';import{requestDigest}from'./services/shooter-verifier/src/gateway-client.mjs';const r=new Journal().load();process.stdout.write(JSON.stringify(r?{phase:r.phase,requestId:r.requestId||null,sha256:r.body?requestDigest('result',r.body):null}:null))"])) as { phase: string; requestId: string; sha256: string } | null;
}
const credit = (actor: TrustedActor): number => num(`SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${sqlId(actor.login.hub.userId)}' AND game_id='sproto-shooter' AND reason='srv_shooter_boss_clear'`);
function receipt(actor: TrustedActor): string | null {
  const text = psql(`SELECT response::text FROM game.shooter_receipt WHERE run_id='${sqlId(actor.runId)}' AND user_id='${sqlId(actor.login.hub.userId)}'`);
  return text ? digest(JSON.parse(text)) : null;
}
function history(actor: TrustedActor): string {
  // Immutable accepted metadata/ACKs only; no frame/action/checkpoint payload.
  return sha(psql(`SELECT COALESCE(jsonb_agg(jsonb_build_array(sequence,tick0,frame_count,request_sha256,received_ack) ORDER BY sequence)::text,'[]') FROM game.shooter_verification_batch WHERE run_id='${sqlId(actor.runId)}'`));
}
function progress(actor: TrustedActor): string {
  return sha(psql(`SELECT jsonb_build_array(revision,accepted_sequence,accepted_tick,verified_sequence,verified_tick,
    verified_bytes,verified_actions,verified_batches,simulation_tick,terminal_revision,terminal_result,
    checkpoint_sha256,artifact_sha256,source_commit,content_fingerprint)::text FROM game.shooter_verification_run WHERE run_id='${sqlId(actor.runId)}'`));
}
function financialFingerprint(actor: TrustedActor): string {
  const user = sqlId(actor.login.hub.userId);
  // Read-only fixture observations, not implementations of financial functions.
  return sha(psql(`SELECT jsonb_build_object(
    'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM game.tickets_ledger x WHERE user_id='${user}'),
    'balance',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM game.tickets_balance x WHERE user_id='${user}'),
    'ranking',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM game.ranked_score x WHERE user_id='${user}'),
    'caps',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM game.earn_window x WHERE user_id='${user}'),
    'receipt',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM game.shooter_receipt x WHERE user_id='${user}')
  )::text`));
}
function admissionFingerprint(): string {
  return sha(psql(`SELECT jsonb_build_object('runs',(SELECT count(*) FROM game.shooter_run),
    'v2',(SELECT count(*) FROM game.shooter_verification_run),
    'reservation',(SELECT jsonb_build_array(retained_runs,retained_batches,retained_bytes,reserved_batches,reserved_bytes) FROM game.shooter_verification_admission WHERE singleton))::text`));
}
async function append(body: PublicBatch, actor: TrustedActor): Promise<Obj> {
  const reply = await call('shooter.run.append', body, actor.login.gameToken);
  assert.equal(reply.status, 200); const ack = obj(reply.body);
  assert.equal(ack.state, 'received'); assert.equal(ack.digest, appendDigest(body));
  assert.equal(ack.acceptedSequence, body.sequence); assert.equal(ack.acceptedTick, body.tick0 + body.n);
  return ack;
}
async function newActor(): Promise<TrustedActor> {
  const actor = await prepareTrustedActor('broccoli-success-7', await openGame((await guest()).token, 'sproto-shooter'), { ageMs: 1200000 });
  assert.equal(actor.trace.definition.frames, 2959); assert.equal(actor.trace.definition.framesTextBytes, 47344);
  return actor;
}
async function waitVerified(actor: TrustedActor): Promise<void> {
  await waitUntil(() => num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${sqlId(actor.runId)}'`) === 2959,
    60000, 'full unchanged trace resolves through actual offline worker');
  const expected = retainedOracle(actor, reboundBatches(actor)[0]!);
  assert.ok(expected.firstTerminal && typeof expected.firstTerminal === 'object' && !Array.isArray(expected.firstTerminal));
  assert.ok(Object.hasOwn(expected.firstTerminal, 'parts'));
  // SQL stores the FULL checkpoint firstTerminal, including parts. Only public
  // status/result projections remove parts; this compares the durable DB fact.
  const terminal = JSON.parse(psql(`SELECT terminal_result::text FROM game.shooter_verification_run WHERE run_id='${sqlId(actor.runId)}'`));
  assert.equal(digest(terminal), digest(expected.firstTerminal));
  assert.equal(obj(terminal).outcome, 'clear');
}

async function run(): Promise<void> {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.HUB_SHOOTER_FIXTURE, 'integration');
  assert.equal(process.env.NAKAMA_URL, 'http://127.0.0.1:7350');
  assert.ok(process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP));
  assert.match(process.env.ROLLOUT_DRILL_COMMIT || '', /^[a-f0-9]{40}$/);
  await waitReady(); databaseReady = true;
  workerId = await prepareOperations();
  assert.match(workerId, /^e2e-[a-f0-9-]{36}$/);
  workerAccount = sqlId(psql(`SELECT account_id FROM game.shooter_verification_worker WHERE worker_id='${workerId}'`));
  sleepName = `hf:${workerAccount}:shooter.worker.after_commit`.slice(0, 63);
  installFaultHooks(); hooks = true; done();

  phase = 'baseline_paid';
  const baseline = await newActor(), baselineBatches = await appendActor(baseline);
  await finishActor(baseline, 0);
  ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']); workerStarted = true;
  await waitVerified(baseline);
  await waitUntil(() => credit(baseline) === 20 && receipt(baseline) !== null, 60000, 'baseline clear pays once');
  const baselineReceipt = receipt(baseline), baselineFinancial = financialFingerprint(baseline);
  actors.push({ role: 'baseline', actor: baseline, batches: baselineBatches, history: history(baseline) });
  ops(['stop', '-t', '40', 'coordinator']); done();

  phase = 'partial_accepted';
  for (const role of ['live', 'expired'] as const) {
    const actor = await newActor(), batches = reboundBatches(actor, 1024);
    assert.equal(batches.length, 3); await append(batches[0]!, actor);
    actors.push({ role, actor, batches, history: '' });
  }
  assert.equal(new Set(actors.map(row => row.actor.login.hub.userId)).size, 3);
  assert.equal(new Set(actors.map(row => row.actor.login.sessionId)).size, 3); done();

  phase = 'stop_new';
  psql('UPDATE game.shooter_verification_admission SET new_runs_enabled=false');
  const beforeRefusal = admissionFingerprint();
  for (const { actor } of actors.slice(1)) {
    const denied = obj((await call('shooter.run.issue', { key: actor.key + ':new', canonicalBoss: actor.trace.definition.boss }, actor.login.gameToken)).body);
    assert.equal(denied.state, 'pending_retryable'); assert.equal(denied.reason, 'verification_unavailable');
    assert.equal(denied.issuance, undefined);
    const historic = obj((await call('shooter.run.issue', { key: actor.key, canonicalBoss: actor.trace.definition.boss }, actor.login.gameToken)).body);
    assert.equal(digest(historic), digest(actor.issueAck));
  }
  assert.equal(admissionFingerprint(), beforeRefusal); done();

  phase = 'append_finish';
  for (const row of actors.slice(1)) {
    for (const body of row.batches.slice(1)) {
      if (row.role === 'live' && body.sequence === 1) {
        // Actual after-commit failure loses the response; status and exact retry
        // must recover the same durable ACK, not a guessed replacement history.
        arm(row.actor.login.hub.userId, 'shooter.append.after_commit', 'raise');
        const failed = await call('shooter.run.append', body, row.actor.login.gameToken);
        assert.ok(failed.status >= 500); disarm(row.actor.login.hub.userId);
        const reply = await call('shooter.run.status', { runId: row.actor.runId, sequence: body.sequence }, row.actor.login.hub.token);
        assert.equal(reply.status, 200);
        const status = obj(reply.body); assert.equal(status.protocol, 2); assert.equal(status.runId, row.actor.runId);
        const saved = status.receivedAck;
        assert.equal(obj(saved).sequence, body.sequence); assert.equal(obj(saved).runId, row.actor.runId);
        assert.equal(obj(saved).digest, appendDigest(body));
        assert.equal(digest(await append(body, row.actor)), digest(saved));
      } else await append(body, row.actor);
    }
    await finishActor(row.actor, 2); row.history = history(row.actor);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${sqlId(row.actor.runId)}'`), 3);
    assert.equal(num(`SELECT accepted_bytes FROM game.shooter_verification_run WHERE run_id='${sqlId(row.actor.runId)}'`), 47344);
  }
  done();

  phase = 'uncertain_restart';
  psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=false');
  const beforePayments = actors.slice(1).map(row => financialFingerprint(row.actor));
  arm(workerAccount, 'shooter.worker.after_commit', 'sleep'); ops(['start', 'coordinator']);
  await waitUntil(() => num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${sleepName}' AND wait_event='PgSleep'`) === 1,
    60000, 'real RESULT response held after durable commit');
  assert.equal(health().journalPhase, 'submitting');
  const reference = journalReference(); assert.ok(reference); assert.equal(reference.phase, 'submitting');
  assert.match(reference.requestId, /^[A-Za-z0-9_.:@|-]{1,80}$/); assert.match(reference.sha256, /^[a-f0-9]{64}$/);
  const proofSQL = `FROM game.shooter_verification_gateway_receipt WHERE worker_id='${workerId}' AND request_id='${reference.requestId}'`;
  const immutableAck = psql(`SELECT acknowledgment::text ${proofSQL}`);
  assert.ok(['verified', 'terminal_verified'].includes(String(obj(JSON.parse(immutableAck)).state)));
  assert.equal(psql(`SELECT request_sha256 ${proofSQL}`), reference.sha256);
  assert.equal(num(`SELECT count(*) ${proofSQL}`), 1);
  uncertainProof = { requestBindingHash: sha(reference.requestId), requestSha256: reference.sha256, acknowledgmentSha256: sha(immutableAck), journalRecoveries: 0, recovered: false };
  ops(['kill', '-s', 'SIGKILL', 'coordinator']);
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${sleepName}'`); disarm(workerAccount);
  ops(['start', 'coordinator']);
  await waitUntil(() => { try { return journalReference() === null; } catch { return false; } }, 60000, 'same identity recovers immutable proof and clears uncertain journal');
  assert.equal(psql(`SELECT acknowledgment::text ${proofSQL}`), immutableAck);
  assert.equal(psql(`SELECT request_sha256 ${proofSQL}`), reference.sha256);
  assert.equal(num(`SELECT count(*) ${proofSQL}`), 1);
  const recoveries = obj(health('metrics').counters).journalRecoveries;
  assert.equal(recoveries, 1); uncertainProof.journalRecoveries = 1; uncertainProof.recovered = true; done();

  phase = 'payment_paused';
  for (const [index, row] of actors.slice(1).entries()) {
    await waitVerified(row.actor);
    await waitUntil(async () => obj((await observeActor(row.actor)).payment).state === 'pending', 60000, 'eligible verified work remains pending while payment paused');
    assert.equal(credit(row.actor), 0); assert.equal(receipt(row.actor), null);
    assert.equal(financialFingerprint(row.actor), beforePayments[index]);
  }
  assert.equal(receipt(baseline), baselineReceipt); assert.equal(financialFingerprint(baseline), baselineFinancial); done();

  phase = 'payment_resumed';
  const live = actors.find(row => row.role === 'live')!.actor, expired = actors.find(row => row.role === 'expired')!.actor;
  psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${sqlId(expired.login.sessionId)}'`);
  psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=true');
  await waitUntil(() => credit(live) === 20 && receipt(live) !== null, 60000, 'original live session receives exactly20 via normal proof repair');
  await waitUntil(async () => obj((await observeActor(expired)).payment).state === 'authorization_denied', 60000, 'expired original session cannot inherit payment grace');
  assert.equal(obj((await observeActor(expired)).payment).reason, 'session_expired');
  assert.equal(credit(expired), 0); assert.equal(receipt(expired), null); done();

  phase = 'history_stable';
  const stableFinancial = actors.map(row => financialFingerprint(row.actor)), stableProgress = actors.map(row => progress(row.actor));
  ops(['stop', '-t', '40', 'coordinator']); ops(['start', 'coordinator']);
  await waitUntil(() => { try { return health().ready === true; } catch { return false; } }, 60000, 'second restart is ready');
  for (const [index, row] of actors.entries()) {
    assert.equal(history(row.actor), row.history); assert.equal(financialFingerprint(row.actor), stableFinancial[index]);
    assert.equal(progress(row.actor), stableProgress[index]);
    const user = sqlId(row.actor.login.hub.userId), expected = row.role === 'expired' ? 0 : 20;
    assert.equal(credit(row.actor), expected);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${user}' AND game_id='sproto-shooter' AND reason='srv_shooter_boss_clear' AND delta=20`), expected ? 1 : 0);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${user}' AND game_id='sproto-shooter' AND (delta<0 OR (reason='srv_shooter_boss_clear' AND delta<>20))`), 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${sqlId(row.actor.runId)}'`), expected ? 1 : 0);
    resultRows.push({ role: row.role, accountBindingHash: sha(user), sessionBindingHash: sha(row.actor.login.sessionId), runBindingHash: sha(row.actor.runId),
      frames: 2959, frameTextBytes: 47344, verifiedTick: num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${sqlId(row.actor.runId)}'`),
      terminalSha256: sha(psql(`SELECT terminal_result::text FROM game.shooter_verification_run WHERE run_id='${sqlId(row.actor.runId)}'`)),
      historySha256: row.history, progressSha256: stableProgress[index]!, receiptSha256: receipt(row.actor), paymentState: row.role === 'expired' ? 'authorization_denied' : 'paid', credits: expected });
  }
  assert.equal(receipt(baseline), baselineReceipt);
  assert.equal(psql('SELECT new_runs_enabled FROM game.shooter_verification_admission WHERE singleton'), 'f');
  done(); passed = true;
}

try { await run(); }
catch { process.exitCode = 1; /* Fixed phase metadata below, never raw exception. */ }
finally {
  const failedPhase = passed ? null : phase; phase = 'cleanup';
  let reportWritten = false;
  try {
    if (databaseReady) psql('UPDATE game.shooter_verification_admission SET new_runs_enabled=false');
    if (hooks) {
      if (sleepName) psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${sleepName}'`);
      if (workerAccount) disarm(workerAccount);
      for (const row of actors) disarm(row.actor.login.hub.userId);
      dropFaultHooks();
    }
    if (workerStarted) ops(['stop', '-t', '40', 'coordinator', 'replay']);
    done();
  } catch { cleanupFailed = true; process.exitCode = 1; }
  const candidate = process.env.ROLLOUT_DRILL_COMMIT;
  const report = { version: 1, scope: 'ci_only_combined_core_rollout_drill', executed: databaseReady, passed: passed && !cleanupFailed,
    candidateCommit: typeof candidate === 'string' && /^[a-f0-9]{40}$/.test(candidate) ? candidate : null,
    retainedSourceCommit: integrationManifest.sourceCommit, retainedArtifactSha256: integrationManifest.sha256,
    elapsedMs: performance.now() - began, failedPhase, cleanupFailed, phases, actors: resultRows, uncertainProof,
    notProven: ['active_lease_renewal_while_claims_disabled', 'active_SIGTERM_drain_in_this_fixture', 'permanent_shadow_policy', 'external_operator_rollout', 'intended_host_capacity'] };
  try {
    assert.ok(process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP));
    const text = JSON.stringify(report) + '\n'; assert.ok(Buffer.byteLength(text) <= 131072);
    writeFileSync(join(process.env.RUNNER_TEMP, 'shooter-rollout-drill-report.json'), text, { mode: 0o600, flag: 'wx' });
    reportWritten = true;
  } catch { process.exitCode = 1; }
  console.log(passed && !cleanupFailed && reportWritten ? 'PASS isolated combined core rollout drill; remaining operator/shadow/host gates unproven' : 'FAIL isolated combined core rollout drill; inspect closed phase report');
}
