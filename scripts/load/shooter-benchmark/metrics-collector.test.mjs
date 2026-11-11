import assert from 'node:assert/strict';
import { safeMetrics,safeHealth,safeGatewayDiagnostics } from './metrics-collector.mjs';
import { OPERATIONS,STATES,REASONS } from './gateway-observer.mjs';
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
const active = { sequence: 1, operation: 'result', startedWallMs: 12, startedMonoMs: 1.25,
  httpStatus: 200, fetchPhase: 'headers_received', headersMonoMs: 2.5, requestAborted: false };
const recent = { ...active, finishedWallMs: 15, finishedMonoMs: 4.25, wallMs: 3,
  transportOutcome: 'returned', state: 'pending_retryable', kind: null, reason: 'gateway_unavailable' };
const diagnostics = { version: 1, observer: 'ci_gateway_metadata_v1', asOf: 20, startedAt: 10,
  attempts: 2, completed: 1, inFlight: 1, activeOverflow: 0, counterSaturated: false, truncated: false, droppedEvents: 0,
  byOperation: OPERATIONS.map(operation => ({ operation, started: 0, returned: 0, threw: 0, requestAborted: 0, http4xx: 0, http5xx: 0 })),
  active: [{ ...active }], recent: [{ ...recent }] };
assert.deepEqual(safeGatewayDiagnostics(diagnostics), diagnostics);
assert.deepEqual(safeMetrics({ uptimeMs: 1, counters: {}, gatewayDiagnostics: diagnostics }).gatewayDiagnostics, diagnostics);
assert.equal(Object.hasOwn(value, 'gatewayDiagnostics'), false, 'missing preload never invents diagnostics');
const copy = () => structuredClone(diagnostics);
const privateFields = copy();
for (const item of [privateFields, ...privateFields.byOperation, ...privateFields.active, ...privateFields.recent]) {
  item.token = 'must-not-copy'; item.url = 'must-not-copy'; item.privateCheckpoint = { rawInputs: 'must-not-copy' };
}
assert.deepEqual(safeGatewayDiagnostics(privateFields), diagnostics, 'only the closed metadata DTO crosses the collector boundary');
for (const operation of OPERATIONS) { const fixture = copy();fixture.active[0].operation = operation;assert.equal(safeGatewayDiagnostics(fixture).active[0].operation, operation); }
for (const state of STATES) { const fixture = copy();fixture.recent[0].state = state;fixture.recent[0].kind = state;assert.equal(safeGatewayDiagnostics(fixture).recent[0].state, state); }
for (const reason of REASONS) { const fixture = copy();fixture.recent[0].reason = reason;assert.equal(safeGatewayDiagnostics(fixture).recent[0].reason, reason); }
for (const mutate of [
  row => { row.attempts = Number.MAX_SAFE_INTEGER + 1; }, row => { row.inFlight = -1; },
  row => { row.active[0].startedMonoMs = Infinity; }, row => { row.active[0].httpStatus = '200'; },
  row => { row.active[0].requestAborted = 'false'; }, row => { row.active[0].fetchPhase = 'must-not-copy'; },
  row => { row.recent[0].state = { token: 'must-not-copy' }; }, row => { row.recent[0].kind = 'toString'; },
  row => { row.recent[0].reason = '__proto__'; }, row => { row.recent[0].transportOutcome = 'must-not-copy'; },
  row => { row.byOperation[0].returned = .5; }, row => { row.byOperation[1].operation = row.byOperation[0].operation; },
  row => { row.counterSaturated = null; }, row => { row.version = 2; }, row => { row.observer = 'must-not-copy'; },
]) { const fixture = copy();mutate(fixture);assert.throws(() => safeGatewayDiagnostics(fixture), /gateway_diagnostics_shape/); }
const maximumActive = copy();maximumActive.active = Array.from({ length: 8 }, () => ({ ...active }));
assert.equal(safeGatewayDiagnostics(maximumActive).active.length, 8);
maximumActive.active.push({ ...active });assert.throws(() => safeGatewayDiagnostics(maximumActive), /shape/);
const tooManyRecent = copy();tooManyRecent.recent = Array.from({ length: 129 }, () => ({ ...recent }));
assert.throws(() => safeGatewayDiagnostics(tooManyRecent), /shape/);
const tooManyBytes = copy();tooManyBytes.recent = Array.from({ length: 128 }, () => ({ ...recent,
  sequence: Number.MAX_SAFE_INTEGER, startedWallMs: Number.MAX_VALUE, startedMonoMs: Number.MAX_VALUE,
  headersMonoMs: Number.MAX_VALUE, finishedWallMs: Number.MAX_VALUE, finishedMonoMs: Number.MAX_VALUE, wallMs: Number.MAX_VALUE,
  state: 'authorization_denied', kind: 'terminal_verified', reason: 'verification_receipt_unavailable' }));
assert.throws(() => safeGatewayDiagnostics(tooManyBytes), /gateway_diagnostics_bound/);
assert.throws(() => safeMetrics({ uptimeMs: 1, counters: {}, gatewayDiagnostics: null }), /shape/);
console.log('credential-free collector projection canaries passed');
