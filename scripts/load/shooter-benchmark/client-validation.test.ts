import assert from 'node:assert/strict';
import { sha256, type ActorResult } from './contracts.ts';
import { clientOverlap, clientWorkloadCompletion } from './client-validation.ts';
const protocols: ActorResult[] = Array.from({ length: 20 }, (_, actor) => ({ actor, wave: 0, caseId: 'test_only', sourceFrames: 1, sourceInputSha256: sha256('source'), submittedFrames: 1, submittedInputSha256: sha256('submitted'), submittedHashMeaning: 'test_only', acceptedTick: 1, verifiedTick: 1,
  accountBindingHash: sha256(`account-${actor}`), sessionBindingHash: sha256(`session-${actor}`), runBindingHash: sha256(`run-${actor}`), status: 'verified_nonpayable', rawReason: 'test_only', attempted: true, durablyVerified: true, payable: false, everObservedEligible: false, observedPaid: false, paid: false }));
const client = { accountBindingHash: sha256('21st-account'), sessionBindingHash: sha256('21st-session'), runBindingHash: sha256('21st-run') };
const population = { actors: [client], startedMonoMs: 100, finishedMonoMs: 500, positiveRecordingObserved: { sampleMonoMs: [110, 250, 450] }, summary: { accountedActors: 1, startedActors: 1, positiveRecordedActors: 1, observedMovementActors: 1, observedFireActors: 1, explicitFinishAckActors: 1, harnessStatus: 'complete' } };
const timings = protocols.map(() => ({ firstRequestMonoMs: 200, completedMonoMs: 400 }));
const valid = clientOverlap(population, protocols, timings);
assert.equal(valid.complete, true);
assert.deepEqual(valid.observedConcurrency.map(row => row.activeProtocolActors), [0, 20, 0], 'positive samples remain distinct from an every-frame20-active claim');
assert.equal(clientOverlap({ ...population, actors: [{ ...client, accountBindingHash: protocols[0].accountBindingHash }] }, protocols, timings).complete, false);
assert.equal(clientOverlap({ ...population, positiveRecordingObserved: { sampleMonoMs: [110, 150] } }, protocols, timings).complete, false, 'UI completing before actual requests cannot prove overlap');
assert.equal(clientOverlap({ ...population, positiveRecordingObserved: { sampleMonoMs: [110, 550] } }, protocols, timings).clockValid, false);
assert.equal(clientOverlap(population, protocols, timings.map((row, i) => i ? row : { ...row, completedMonoMs: null })).protocolTimingValid, false);
console.log('disjoint21st native DOM population and sampled20-protocol overlap canaries passed');

const full = { ...client, status: 'verified_nonpayable', rawReason: 'incomplete',
  recordedFrames: 130, submittedFrames: 130, acceptedTick: 130, verifiedTick: 130, submittedInputSha256: sha256('actual captured append wires'),
  finalPausedProof: true, finalCoherentProof: true, finishRequested: true, finishAckObserved: true, serverClosed: true,
  paid: false, observedPaid: false, everObservedEligible: false, eligibilityState: 'observed_nonpayable', paymentObservation: 'ineligible', paymentCensored: false };
const completePopulation = { ...population, actors: [full] };
assert.deepEqual(clientWorkloadCompletion(completePopulation), { complete: true, reason: 'complete', accountedActors: 1 });
const paidClient = { ...full, status: 'paid', rawReason: null, paid: true, observedPaid: true, everObservedEligible: true, eligibilityState: 'observed_eligible', paymentObservation: 'paid' };
assert.equal(clientWorkloadCompletion({ ...completePopulation, actors: [paidClient] }).complete, true);
for (const mutation of [
  { verifiedTick: 120, status: 'service_unavailable', rawReason: 'rate_limited', finalCoherentProof: false },
  { recordedFrames: 0, submittedFrames: 0, acceptedTick: 0, verifiedTick: 0 },
  { recordedFrames: 129 }, { submittedFrames: 120 }, { acceptedTick: 120 }, { verifiedTick: 131 },
  { finalCoherentProof: false }, { finalPausedProof: false }, { finishRequested: false }, { finishAckObserved: false }, { serverClosed: false },
  { status: ['verified_nonpayable'] }, { rawReason: ['incomplete'] }, { status: 'censored' }, { status: 'authorization_denied', rawReason: 'session_expired' }, { status: 'payment_pending' }, { paymentCensored: true },
  { status: 'service_unavailable', rawReason: 'rate_limited' }, { submittedInputSha256: null }, { runBindingHash: 'stale-or-foreign-binding' },
  { paymentObservation: 'none' }, { eligibilityState: 'unknown' },
]) assert.equal(clientWorkloadCompletion({ ...completePopulation, actors: [{ ...full, ...mutation }] }).complete, false, JSON.stringify(mutation));
assert.equal(clientWorkloadCompletion({ ...completePopulation, actors: [{ ...paidClient, observedPaid: false }] }).complete, false);
assert.equal(clientWorkloadCompletion({ ...completePopulation, actors: [{ ...paidClient, paymentObservation: 'pending' }] }).complete, false);
assert.equal(clientWorkloadCompletion({ ...completePopulation, actors: [full, full], summary: { ...population.summary, accountedActors: 2 } }).complete, false, 'duplicate owner bindings cannot establish a completed population');
assert.equal(clientWorkloadCompletion({ ...completePopulation, summary: { ...population.summary, harnessStatus: 'interrupted' } }).complete, false);
assert.equal(clientWorkloadCompletion({}).complete, false);
assert.equal(clientOverlap(population, protocols, timings).complete, true, 'completion predicate does not redefine sampled overlap');
console.log('strict full-frozen-prefix client workload completion canaries passed; partial rate-limited535 is incomplete');
