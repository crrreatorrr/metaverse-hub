import assert from 'node:assert/strict';
import { safeMetrics,safeHealth } from './metrics-collector.mjs';
const value = safeMetrics({ uptimeMs: 1, counters: { claims: 0, workerRestarts: null, token: 'must-not-copy' }, gateway: { observedAt: 4, eligible: true, queueDepth: 0, token: 'must-not-copy' }, lastExecution: { cpuUserMicros: 0, privateCheckpoint: 'must-not-copy' }, rawInputs: 'must-not-copy' });
assert.equal(value.counters.claims, 0);
assert.equal(value.counters.workerRestarts, null);
assert.equal(value.gateway.queueDepth, 0);
assert.equal(value.gateway.eligibilityUnknown, null);
assert.equal(value.gateway.queueTruncated, null);assert.equal(value.workerRestartsObserved, null);
for (const [input, expected] of [[true,true],[false,false],[undefined,null],['false',null],[0,null]]) {
  const projected = safeMetrics({ uptimeMs: 1, counters: {}, gateway: { eligibilityUnknown: input, queueTruncated: input }, workerRestartsObserved: input, workerRestartsLowerBound: input });
  assert.equal(projected.gateway.eligibilityUnknown, expected);assert.equal(projected.gateway.queueTruncated, expected);assert.equal(projected.workerRestartsObserved, expected);assert.equal(projected.workerRestartsLowerBound, expected);
}
assert.equal(value.lastExecution.gcMs, null);
assert.ok(!JSON.stringify(value).includes('must-not-copy'));
assert.throws(() => safeMetrics({ uptimeMs: NaN, counters: {} }), /shape/);
const health = safeHealth({ asOf: 42, ready: true, busy: false, blocked: false, draining: false, gatewayObservationCurrent: true, journalPhase: null, privateCheckpoint: 'must-not-copy', token: 'must-not-copy' });
assert.deepEqual(health, { asOf: 42, ready: true, busy: false, blocked: false, draining: false, gatewayObservationCurrent: true, journalPhase: null });
assert.equal(safeHealth({ asOf: 42 }).ready, null);assert.equal(safeHealth({ asOf: 42 }).journalPhase, 'unknown');
assert.equal(safeHealth({ asOf: 42, ready: 'false', journalPhase: 'must-not-copy' }).ready, null);
assert.equal(safeHealth({ asOf: 42, ready: 'false', journalPhase: 'must-not-copy' }).journalPhase, 'unknown');
assert.equal(safeHealth({ asOf: 42, journalPhase: 'submitting' }).journalPhase, 'submitting');
assert.ok(!JSON.stringify(health).includes('must-not-copy'));assert.throws(() => safeHealth({ asOf: NaN }), /shape/);
console.log('credential-free collector projection canaries passed');
