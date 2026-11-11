import assert from 'node:assert/strict';
import { boundOwnerStatus, clientStartOutcome, browserActorCounts, recordPaymentFacts, serviceOutcome, successfulPaid } from './browser-accounting.mjs';
const runId = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const fresh = () => ({ status: 'not_started', runBindingHash: null as string | null, recordedFrames: null as number | null,
  observedMovementFrames: 0, acceptedTick: null as number | null, verifiedTick: null as number | null,
  observedPaid: false, paid: false, everObservedEligible: false, eligibilityState: 'unknown', paymentObservation: 'not_observed',
  eligibilityEvidence: null as string | null, paymentCensored: false, finalPausedProof: false, finalCoherentProof: false,
  finishAckObserved: false, milestones: {} as Record<string, number>, clientFrames: {} });
const paid = { protocol: 2, runId, state: 'terminal', received: { tick: 120 }, verified: { tick: 120 }, terminal: { outcome: 'clear' }, payment: { state: 'paid', tickets: 20 } };
const wrong = fresh();
assert.throws(() => recordPaymentFacts(wrong, { ...paid, runId: other }, runId, 1), /binding_mismatch/);
assert.equal(wrong.observedPaid, false); assert.equal(wrong.acceptedTick, null); assert.equal(wrong.verifiedTick, null);
assert.throws(() => boundOwnerStatus({ ...paid, protocol: 1 }, runId), /binding_mismatch/);
assert.throws(() => boundOwnerStatus({ ...paid, runId: undefined }, runId), /binding_mismatch/);
assert.throws(() => boundOwnerStatus({ ...paid, state: 'surprise' }, runId), /state_invalid/);
for (const tick of [-1, 162001, 120.5, Number.MAX_SAFE_INTEGER + 1]) {
  const malformed = fresh();
  assert.throws(() => recordPaymentFacts(malformed, { ...paid, received: { tick }, verified: { tick } }, runId, 1), /cursor_invalid/);
  assert.equal(malformed.observedPaid, false);
}
for (const state of ['unknown', { payload: 'unmetered' }]) {
  const malformed = fresh();
  assert.throws(() => recordPaymentFacts(malformed, { ...paid, payment: { state } }, runId, 1), /payment_state_invalid/);
  assert.equal(malformed.paymentObservation, 'not_observed');
}
const captureFailed = fresh();
assert.throws(() => {
  // This is the production ordering: bound receipt facts immediately after
  // status, before any capture/DOM readback that can fail independently.
  recordPaymentFacts(captureFailed, paid, runId, 2);
  throw new Error('capture_readback_failed');
}, /capture_readback_failed/);
assert.equal(captureFailed.observedPaid, true); assert.equal(captureFailed.acceptedTick, 120); assert.equal(captureFailed.verifiedTick, 120);
assert.equal(clientStartOutcome('network_unavailable'), null);
assert.equal(clientStartOutcome('network_unavailable', { requestFailed: true })?.rawReason, 'network_request_failed');
assert.equal(clientStartOutcome('unsupported_manifest')?.status, 'unsupported');
assert.equal(clientStartOutcome('not_game_session')?.status, 'authorization_denied');
const denied = fresh();
recordPaymentFacts(denied, { ...paid, payment: { state: 'authorization_denied', reason: 'session_expired' } }, runId, 2);
assert.equal(denied.everObservedEligible, false); assert.equal(denied.eligibilityState, 'unknown');
for (const failure of ['instrumentation_failure', 'censored', 'operational_failure']) {
  const row = fresh(); recordPaymentFacts(row, paid, runId, 3);
  Object.assign(row, { paid: true, finalPausedProof: true, finalCoherentProof: true, finishAckObserved: true,
    recordedFrames: 120, submittedFrames: 120, acceptedTick: 120, verifiedTick: 120 });
  row.status = failure; row.paymentCensored = true;
  assert.equal(row.observedPaid, true); assert.equal(row.milestones.paidObservedMs, 3); assert.equal(successfulPaid(row), false);
  const summary = browserActorCounts([row]); assert.equal(summary.observedPaid, 1); assert.equal(summary.paid, 0);
  assert.equal(summary.eligibleUnpaid, 0); assert.equal(summary.eligibleCensored, 0);
}
const complete = fresh(); recordPaymentFacts(complete, paid, runId, 4);
Object.assign(complete, { status: 'paid', finalPausedProof: true, finalCoherentProof: true, finishAckObserved: true, recordedFrames: 120, submittedFrames: 120, acceptedTick: 120, verifiedTick: 120 });
assert.equal(successfulPaid(complete), true);
const rows = Array.from({ length: 20 }, fresh); rows[0] = complete; rows[1] = denied; rows[1].status = 'authorization_denied';
rows[2].status = 'rejected'; rows[3].status = 'censored';
const counts = browserActorCounts(rows);
assert.equal(counts.accountedActors, 20); assert.equal(counts.recordedCountUnknownActors, 19);
assert.equal(counts.eligibilityUnknownActors, 19); assert.equal(counts.observedPaid, 1); assert.equal(counts.paid, 1);
assert.deepEqual(serviceOutcome({ protocol: 2, state: 'invalid', reason: 'run_closed' }), { status: 'rejected', rawReason: 'run_closed', serviceState: 'invalid' });
assert.equal(serviceOutcome({ state: 'pending_retryable', reason: 'global_capacity' })?.status, 'service_unavailable');
assert.equal(serviceOutcome({ state: 'authorization_denied', reason: 'session_expired' })?.status, 'authorization_denied');
for (const state of ['surprise', 'toString', '__proto__']) assert.equal(serviceOutcome({ state, reason: 'unknown' }), null);
assert.equal(serviceOutcome({ state: 'invalid', reason: 'raw https://token.invalid/?secret' }), null);
console.log('Bound owner status, receipt facts versus throughput, denominator and service-classification canaries passed');
