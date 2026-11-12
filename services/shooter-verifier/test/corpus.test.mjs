import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ReplayPool } from '../src/process-pool.mjs';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { APPROVED } from '../src/approved.mjs';
import { replayText } from '../src/replay.mjs';
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const digest = (v) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const dir = process.env.SHOOTER_CORPUS_DIR;
if (dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 12, 'full frozen corpus, including both24k traces, required');
  for (const file of files) test(`full pinned replay in OS process and direct approved artifact: ${file}`, async () => {
    const f = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    const segment = f.log.segments[0];
    const batch = { protocol: 2, runId: f.issuance.runId, sequence: 0, tick0: 0, n: segment.n, frames: segment.frames, actions: segment.actions || [] };
    const claim = { jobId: 'job-corpus', runId: f.issuance.runId, accountId: f.issuance.accountId, sessionId: f.issuance.sessionId,
      inputSha256: digest(batch), fence: 1, initialRevision: 0, expectedRevision: 0, tick0: 0, tickEnd: segment.n, continuationTick: 0 };
    const r = { operation: 'begin', manifest: APPROVED, issuance: f.issuance, checkpoint: null, batch: null, accepted: null, maxWorkFrames: 4096, claim };
    const artifact = loadApprovedArtifact(), pool = new ReplayPool();
    let heartbeats = 0;
    const heartbeat = setInterval(() => heartbeats++, 5);
    async function compare() {
      const text = JSON.stringify(r), actual = await pool.execute(text), expected = replayText(text, artifact);
      assert.deepEqual(actual, expected);
      assert.equal(actual.kind, 'replayed', actual.reason);
      assert.notEqual(actual.publicResult.status, 'invalid', actual.publicResult.reason);
      assert.ok(actual.privateCheckpoint, actual.publicResult.reason);
      if (r.operation === 'step') assert.ok(actual.publicResult.verifiedInputTick > r.claim.continuationTick, 'bounded work makes progress');
      r.checkpoint = actual.privateCheckpoint;
      r.claim = { ...r.claim, continuationTick: actual.publicResult.verifiedInputTick, expectedRevision: r.claim.expectedRevision + 1 };
      return actual;
    }
    try {
      await compare(); r.operation = 'accept'; r.batch = JSON.stringify(batch);
      r.accepted = { runId: batch.runId, sequence: 0, tick0: 0, n: batch.n, sha256: claim.inputSha256,
        binding: f.log.binding, acceptedBeforeTerminal: true };
      await compare(); r.operation = 'step'; r.batch = null; r.accepted = null;
      let result;
      do { result = await compare(); } while (result.privateCheckpoint.pending);
      assert.equal(result.publicResult.verifiedInputTick, segment.n);
      assert.equal(result.publicResult.acceptedInputTick, segment.n);
      assert.equal(result.publicResult.verifiedBatches, 1);
      assert.equal(result.publicResult.verifiedFramesTextBytes, segment.n * 16);
      assert.equal(result.publicResult.ticketsMinted, 0);
      assert.ok(heartbeats > 0, 'coordinator event loop remains responsive');
      if (file === 'obama-success-7.json') assert.equal(segment.n, 24000);
      if (['sahil-success-7.json', 'sahil-fail-7.json', 'sahil-assisted-9.json'].includes(file)) {
        assert.equal(result.publicResult.terminal.outcome, f.expected.outcome);
        assert.equal(result.publicResult.terminal.simTick, f.expected.tick);
      }
      console.log(JSON.stringify({ fixture: file, frames: segment.n, heartbeats, verified: result.publicResult.verifiedInputTick,
        terminal: result.publicResult.terminal?.outcome || null }));
    } finally { clearInterval(heartbeat); pool.close(); }
  });
} else {
  test('corpus is supplied by the required parity Actions job', { skip: true }, () => {});
}
