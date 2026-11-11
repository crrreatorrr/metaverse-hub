import assert from 'node:assert/strict';
import { sha256, type ActorResult } from './contracts.ts';
import { clientOverlap } from './client-validation.ts';
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
