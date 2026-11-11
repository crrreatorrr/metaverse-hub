import test from 'node:test';
import assert from 'node:assert/strict';
import { replayReuseEvidence,createWorkerLifecycle,WorkerLifecycleFailure } from './worker-lifecycle.mjs';
const sample = (completed, processStarts = Math.floor(completed / 16) + 1) => ({ daemonInstanceId: 'daemon', workerInstance: `worker-${processStarts}`, completed, requests: completed, processStarts, restarts: processStarts - 1, operationalFailures: 0 });
test('fresh startup distinguishes one cold first operation and actual later reuse', () => {
  const value = replayReuseEvidence(sample(0), sample(16));
  assert.equal(value.operations, 16);assert.equal(value.coldFirstOperations, 1);assert.equal(value.reusedOperations, 15);assert.equal(value.reusedFraction, 15 / 16);assert.equal(value.naturalRecycles, 1);assert.equal(value.firstOperation, 'first_operation_in_child');assert.equal(value.osPageCache, 'unknown');
});
test('supported natural recycling is counted without falsely labeling every warm operation reused', () => {
  const value = replayReuseEvidence(sample(8), sample(40));
  assert.equal(value.operations, 32);assert.equal(value.coldFirstOperations, 2);assert.equal(value.reusedOperations, 30);assert.equal(value.reusedFraction, 30 / 32);assert.equal(value.naturalRecycles, 2);assert.equal(value.initialChildPreviouslyUsed, true);
  assert.equal(replayReuseEvidence(sample(16), sample(17)).firstOperation, 'first_operation_in_child');
  assert.equal(replayReuseEvidence(sample(1), sample(15)).coldFirstOperations, 0);
});
test('idle phase does not manufacture first-operation or OS-cache evidence', () => {
  const value = replayReuseEvidence(sample(16), sample(16));assert.equal(value.operations, 0);assert.equal(value.firstOperation, 'not_observed');assert.equal(value.reusedFraction, null);assert.equal(value.osPageCache, 'unknown');
});
test('counter resets, failures, daemon replacement and unexplained child starts refuse reuse evidence', () => {
  for (const [before, after] of [[sample(16), sample(0)], [sample(0), { ...sample(1), daemonInstanceId: 'different' }], [sample(0), { ...sample(1), operationalFailures: 1 }], [sample(0), { ...sample(1), requests: 2 }], [sample(0), sample(1, 2)], [sample(0), { ...sample(1), completed: 1.5 }], [sample(0), { ...sample(1), workerInstance: 'unexplained' }], [sample(0), { ...sample(16), workerInstance: sample(0).workerInstance }]]) {
    assert.throws(() => replayReuseEvidence(before, after), WorkerLifecycleFailure);
  }
});
test('unsupported public topology or file selectors fail before any Docker operation', () => {
  assert.throws(() => createWorkerLifecycle({ composeArgs: [], readHealth: async () => ({}), readMetrics: async () => ({}) }), /worker_lifecycle_unsupported_profile/);
  assert.throws(() => createWorkerLifecycle({ composeArgs: ['https://public-engine.example/module'], readHealth: async () => ({}), readMetrics: async () => ({}) }), /worker_lifecycle_unsupported_profile/);
});
