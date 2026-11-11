// Actual Nakama/PostgreSQL + production coordinator + offline replay container.
// Browser and adversarial/restart stages are separate; this does not claim them.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { guest, openGame, psql, num, sleep, waitReady } from './dup/harness';
import { appendActor, appendDigest, finishActor, integrationCases, integrationManifest, observeActor, prepareTrustedActor, type PublicBatch, type TrustedActor } from './dup/shooter_verification_e2e_fixtures';

type Obj = Record<string, unknown>;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = String(integrationManifest.sha256);
const bytes = readFileSync(new URL(`../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`, import.meta.url));
const digest = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
assert.equal(digest(bytes), SHA);
const realm = vm.createContext({}); vm.runInContext(bytes.toString('utf8'), realm);
const obj = (value: unknown): Obj => value as Obj;
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  const v = value as Obj; return '{' + Object.keys(v).sort().map(key => JSON.stringify(key) + ':' + stable(v[key])).join(',') + '}';
}
function query(sql: string): string {
  return execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    cwd: ROOT, input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 22 * 1024 * 1024,
  }).trim();
}
function ops(args: string[]): string {
  return execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', '-f', 'services/shooter-verifier/ops/compose.ci.yml', '--profile', 'shooter-verification', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024,
  }).trim();
}
const CONFIG = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=16,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1099511627776,max_account_checkpoint_bytes=1073741824,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
 UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=1000000,account_attempts_per_minute=100000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400;
 UPDATE game.shooter_verification_payment_config SET payments_enabled=true`;

async function prepareOperations(): Promise<string> {
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
async function waitUntil(check: () => boolean | Promise<boolean>, milliseconds: number, label: string): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!await check()) { assert.ok(Date.now() < deadline, label); await sleep(250); }
}
function retainedOracle(actor: TrustedActor, batch: PublicBatch): Obj {
  realm.input = JSON.stringify({ issuance: actor.issuance, manifest: integrationManifest, batch, digest: appendDigest(batch) });
  try {
    return obj(JSON.parse(vm.runInContext(`JSON.stringify((function(v){
      var api=SprotoShooterSim,m=v.manifest,c={issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},maxWorkFrames:4096};
      var out=api.beginIncrementalReplay(c),cp=out.privateCheckpoint;
      if(!cp)throw new Error('oracle_begin');
      out=api.acceptReplayBatch(JSON.stringify(v.batch),cp,Object.assign({},c,{accepted:{runId:v.batch.runId,sequence:0,tick0:0,n:v.batch.n,sha256:v.digest,binding:{accountId:v.issuance.accountId,sessionId:v.issuance.sessionId,runId:v.issuance.runId,day:v.issuance.day},acceptedBeforeTerminal:true}}));
      cp=out.privateCheckpoint;if(!cp)throw new Error('oracle_accept');
      var slices=0;
      while(cp.pending){var before=cp.accounting.verifiedFrames;out=api.stepReplaySlice(cp,c);cp=out.privateCheckpoint;
        if(!cp||cp.accounting.verifiedFrames<=before||++slices>40)throw new Error('oracle_nonprogress');}
      return cp;
    })(JSON.parse(input)))`, realm) as string));
  } finally { delete realm.input; }
}

await waitReady();
const workerId = await prepareOperations();
let started = false;
try {
  // No finish, append, owner status or browser request will heal this run.
  const abandonedLogin = await openGame((await guest()).token, 'sproto-shooter');
  const abandoned = await prepareTrustedActor('sahil-success-7', abandonedLogin);
  psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${abandonedLogin.sessionId}'`);
  ops(['up', '-d', '--build', 'replay', 'coordinator']); started = true;
  await waitUntil(() => {
    try { return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '-e', "fetch('http://127.0.0.1:9476/ready').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))"])).ready === true; }
    catch { return false; }
  }, 60000, 'actual coordinator and offline daemon become ready');
  await waitUntil(() => psql(`SELECT lifecycle||':'||COALESCE(terminal_outcome,'') FROM game.shooter_verification_run WHERE run_id='${abandoned.runId}'`) === 'terminal:incomplete', 90000, 'idle coordinator maintenance must close an abandoned empty run without status healing');
  assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${abandoned.runId}'`), 0);
  console.log('PASS isolated-stack abandoned-empty DB-only closure, no owner status or queued work');

  let completed = 0;
  for (const definition of integrationCases) {
    const login = await openGame((await guest()).token, 'sproto-shooter');
    const actor = await prepareTrustedActor(definition.id, login, { ageMs: 1200000 });
    const batches = await appendActor(actor); assert.equal(batches.length, 1, 'the entire full stored trace is accepted atomically before terminal');
    await finishActor(actor, 0);
    const expected = retainedOracle(actor, batches[0]!);
    const terminal = expected.firstTerminal === null ? null : obj(expected.firstTerminal);
    const expectedOutcome = terminal ? terminal.outcome : 'incomplete';
    assert.equal(expectedOutcome, definition.legacyObservation.outcome, 'do not silently bless a changed outcome');
    const deadline = 30000 + Math.ceil(definition.frames / 4096) * 25000;
    await waitUntil(() => num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`) === definition.frames, deadline, 'full stored trace must resolve through the actual isolated coordinator');
    const actual = obj(JSON.parse(query(`SELECT checkpoint_json::text FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`)));
    assert.equal(digest(stable(actual)), digest(stable(expected)), 'full private checkpoint/state/RNG/IDs/parts/counters agree with retained05f; hashes only in failure output');
    const eligible = !!terminal && terminal.outcome === 'clear' && terminal.eligible === true;
    if (expectedOutcome === 'clear') assert.equal(eligible, true);
    await waitUntil(async () => {
      const status = await observeActor(actor), payment = obj(status.payment);
      return status.state === 'terminal' && payment.state === (eligible ? 'paid' : 'ineligible');
    }, 60000, 'authoritative payment or incomplete/zero closure settles separately');
    const credits = num(`SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear'`);
    assert.equal(credits, eligible ? 20 : 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), eligible ? 1 : 0);
    assert.equal(num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), definition.frames);
    assert.equal(num(`SELECT accepted_bytes FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), definition.framesTextBytes);
    completed += 1;
    console.log(`PASS isolated-stack ${definition.id} full ${definition.frames} frames; retained checkpoint parity; outcome ${String(expectedOutcome)}; tickets ${credits}`);
  }
  assert.equal(completed, 12);
  assert.ok(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${workerId}' AND acknowledgment ? 'work'`) === 0, 'private work was never duplicated into durable ACKs');
  console.log('13 actual isolated-stack cases passed; browser, restart/drain and broader adversarial stages are not claimed here');
} finally {
  if (started) ops(['stop', '-t', '40', 'coordinator', 'replay']);
}
