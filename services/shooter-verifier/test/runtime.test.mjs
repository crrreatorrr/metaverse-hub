import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ReplayPool } from '../src/process-pool.mjs';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { APPROVED } from '../src/approved.mjs';
import { replayText, INPUT_BYTES } from '../src/replay.mjs';
const issuance = () => {
  const a = loadApprovedArtifact();
  return JSON.parse(new vm.Script(`JSON.stringify(SprotoShooterSim.buildIssuance({accountId:'account',sessionId:'session',day:'2026-11-07',runId:'run-test',canonicalBoss:'sahil',seed:7}).issuance)`).runInContext(a.context));
};
export function request(issued = issuance(), operation = 'begin', checkpoint = null) {
  return { operation, manifest: APPROVED, issuance: issued, checkpoint, batch: null, accepted: null, maxWorkFrames: 4096,
    claim: { jobId: 'job-test', runId: issued.runId, accountId: issued.accountId, sessionId: issued.sessionId,
      inputSha256: 'a'.repeat(64), fence: 1, initialRevision: 0, expectedRevision: 0, tick0: 0, tickEnd: 1, continuationTick: 0 } };
}
test('approved artifact checks source, exact bytes, versions and economy; refuses unknown manifest', () => {
  const a = loadApprovedArtifact();
  const r = request();
  assert.equal(replayText(JSON.stringify(r), a).kind, 'replayed');
  for (const key of Object.keys(APPROVED)) {
    const bad = structuredClone(r); bad.manifest[key] = 'unknown';
    assert.equal(replayText(JSON.stringify(bad), a).reason, 'artifact_unavailable');
  }
  assert.equal(replayText(JSON.stringify({ ...r, url: 'https://example.com/evil.js' }), a).reason, 'bad_worker_request');
  assert.equal(replayText('{', a).reason, 'bad_worker_request');
  assert.equal(replayText('x'.repeat(INPUT_BYTES + 1), a).reason, 'request_oversized');
  const wrong = structuredClone(r); wrong.claim.runId = 'other';
  assert.equal(replayText(JSON.stringify(wrong), a).reason, 'bad_worker_binding');
});
test('actual warm bounded OS process returns full private checkpoint and public redaction', async () => {
  const pool = new ReplayPool();
  try {
    const r = request(), result = await pool.execute(JSON.stringify(r));
    assert.equal(result.kind, 'replayed'); assert.equal(result.privateCheckpoint.v, 2);
    assert.deepEqual(result.binding, r.claim);
    assert.ok(result.privateCheckpoint.snapshot.state.players);
    assert.equal(result.publicResult.ticketsMinted, 0);
    assert.equal(result.publicResult.privateCheckpoint, undefined);
    assert.equal(result.publicResult.snapshot, undefined);
    assert.equal(JSON.stringify(result.publicResult).includes('account'), false);
    const next = request(r.issuance, 'step', result.privateCheckpoint);
    const resumed = await pool.execute(JSON.stringify(next));
    assert.equal(resumed.publicResult.reason, 'idle');
    assert.deepEqual(resumed.privateCheckpoint, result.privateCheckpoint);
  } finally { pool.close(); }
});
test('queue, malformed inputs, crash and close remain operational, finite and credential-free', async () => {
  assert.throws(() => new ReplayPool({ size: 5 }), /bad_pool_limits/);
  const pool = new ReplayPool({ queue: 0 });
  try {
    const first = pool.execute(JSON.stringify(request()));
    assert.equal((await pool.execute('{}')).reason, 'queue_full');
    assert.equal((await first).kind, 'replayed');
    assert.equal((await pool.execute('{}')).reason, 'bad_worker_request');
    assert.equal((await pool.execute('x'.repeat(INPUT_BYTES + 1))).reason, 'request_oversized');
    pool.slots[0].child.kill('SIGKILL');
    await once(pool.slots[0].child, 'exit');
    assert.equal((await pool.execute('{}')).reason, 'worker_unavailable');
  } finally { pool.close(); }
  assert.equal((await pool.execute('{}')).reason, 'pool_closed');
});
test('stopped worker is killed at fixed wall deadline; no timeout becomes gameplay invalid', async () => {
  const pool = new ReplayPool({ wallMs: 100 });
  try {
    const child = pool.slots[0].child;
    while (!pool.slots[0].ready && !pool.slots[0].dead) await once(child, 'message');
    child.kill('SIGSTOP');
    const result = await pool.execute(JSON.stringify(request()));
    assert.equal(result.kind, 'pending_retryable'); assert.equal(result.reason, 'execution_timeout');
  } finally { pool.close(); }
});
test('hard V8 heap limit terminates an allocating child; CPU limit exists independently', async () => {
  const child = spawn('/usr/bin/prlimit', ['--cpu=2:2', '--', process.execPath, '--max-old-space-size=32', '-e',
    'const a=[];for(;;)a.push(new Array(10000).fill(42))'], { env: {}, stdio: 'ignore' });
  const killer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const [code, signal] = await once(child, 'exit'); clearTimeout(killer);
  assert.equal(code, null); assert.equal(signal, 'SIGABRT');
  const started = Date.now();
  const cpu = spawn('/usr/bin/prlimit', ['--cpu=1:1', '--', process.execPath, '-e', 'for(;;){}'], { env: {}, stdio: 'ignore' });
  const cpuKiller = setTimeout(() => cpu.kill('SIGKILL'), 10000);
  const [cpuCode, cpuSignal] = await once(cpu, 'exit'); clearTimeout(cpuKiller);
  assert.equal(cpuCode, null); assert.equal(cpuSignal, 'SIGKILL');
  assert.ok(Date.now() - started < 5000, 'CPU hard limit, not fallback wall killer');
});
test('container image includes only code and approved bundle, no network/credential configuration', () => {
  const compose = readFileSync(new URL('../compose.test.yml', import.meta.url), 'utf8');
  for (const control of ['network_mode: none', 'read_only: true', 'pids_limit: 32', 'mem_limit: 512m', 'cap_drop: [ALL]']) assert.ok(compose.includes(control));
});
