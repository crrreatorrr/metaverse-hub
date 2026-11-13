import assert from 'node:assert/strict';
import {
  CALIBRATION_BUNDLE_SHA256, MAX_VERIFIER_SLOWDOWN, REFERENCE_CALIBRATION_CPU_MS, SLOW_MACHINE_SCORE,
  compareVerifiers, decideGate, scoreMachine, validateMachineSpeed, type GateFacts, type MachineSpeed,
} from './machine-speed.ts';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
function machine(calibrationCpuMs: number): MachineSpeed {
  const { score, machineClass } = scoreMachine(calibrationCpuMs);
  return { version: 1, cpuModel: 'test cpu', calibrationBundleSha256: CALIBRATION_BUNDLE_SHA256, calibrationCpuMs,
    referenceCalibrationCpuMs: REFERENCE_CALIBRATION_CPU_MS, score, slowMachineScore: SLOW_MACHINE_SCORE, machineClass,
    verifierComparison: compareVerifiers(A, A, null, null) };
}
const fast = machine(REFERENCE_CALIBRATION_CPU_MS), slow = machine(REFERENCE_CALIBRATION_CPU_MS * 1.8);

// Scoring.
assert.equal(fast.score, 1); assert.equal(fast.machineClass, 'reference_speed');
assert.equal(scoreMachine(REFERENCE_CALIBRATION_CPU_MS * SLOW_MACHINE_SCORE).machineClass, 'slow', 'the threshold itself is slow');
assert.equal(slow.machineClass, 'slow');
assert.throws(() => scoreMachine(0)); assert.throws(() => scoreMachine(Number.NaN));

// Verifier comparison.
assert.equal(compareVerifiers(A, A, null, null).state, 'same_bundle');
assert.equal(compareVerifiers(A, B, 1000, 1150).slower, false);
assert.equal(compareVerifiers(A, B, 1000, 1000 * MAX_VERIFIER_SLOWDOWN + 50).slower, true);
assert.throws(() => compareVerifiers(A, B, null, 1000));

// The speed file is recomputed, not trusted.
assert.deepEqual(validateMachineSpeed(JSON.parse(JSON.stringify(slow))), slow);
assert.throws(() => validateMachineSpeed({ ...slow, machineClass: 'reference_speed' }), /invalid/);
assert.throws(() => validateMachineSpeed({ ...fast, score: 2 }), /invalid/);
assert.throws(() => validateMachineSpeed({ ...fast, calibrationBundleSha256: B }), /invalid/);
assert.throws(() => validateMachineSpeed({ ...fast, verifierComparison: { ...compareVerifiers(A, B, 1000, 1500), slower: false } }), /invalid/);

// Gate.
const actors = (paid: number, unpaid: number, extra: { status: string; expectedToPay: boolean }[] = []) => [
  ...Array.from({ length: paid }, () => ({ status: 'paid', expectedToPay: true })),
  ...Array.from({ length: unpaid }, () => ({ status: 'verified_nonpayable', expectedToPay: false })),
  ...extra,
];
const censored = (n: number, expectedToPay = false) => Array.from({ length: n }, () => ({ status: 'censored', expectedToPay }));
const ok: GateFacts = {
  legacy: false, clientComplete: true, clientWorkloadComplete: true, resultStageDiagnosticsComplete: true,
  harnessStatus: 'complete', harnessFailureReasons: [], expectedActors: 20, boundActors: 20,
  failedObservations: [], plannedCoordinatorUnavailable: 0, backgroundProofComplete: true,
  fullSourceActorsVerified: 19, expectedFullSourceActors: 19, paid: 7, expectedPaid: 7, workloadFailureStatuses: [],
  actors: actors(7, 12, [{ status: 'abandoned', expectedToPay: false }]),
};
for (const speed of [fast, slow, null]) assert.equal(decideGate(ok, speed).verdict, 'passed');

// The 5 s observer sample deadline (the 20-player test's failure on Intel runners).
const sampleDeadline: GateFacts = { ...ok, harnessStatus: 'failed', failedObservations: ['instrumentation_failure:observer_sample_deadline', 'instrumentation_failure:observer_sample_deadline'] };
assert.equal(decideGate(sampleDeadline, slow).verdict, 'inconclusive_slow_machine');
assert.deepEqual(decideGate(sampleDeadline, slow).timingMisses, ['observer_sample_deadline']);
assert.equal(decideGate(sampleDeadline, fast).verdict, 'failed', 'a fast machine gets no excuse');
assert.equal(decideGate(sampleDeadline, null).verdict, 'failed', 'an unmeasured machine gets no excuse');

// The 900 s run deadline (the 15-minute test's failure on EPYC 7763 runners): six actors censored.
const runDeadline: GateFacts = { ...ok, expectedActors: 60, boundActors: 60, harnessStatus: 'interrupted', harnessFailureReasons: ['harness_deadline_or_shutdown'],
  fullSourceActorsVerified: 51, expectedFullSourceActors: 57, paid: 21, expectedPaid: 21, workloadFailureStatuses: Array(6).fill('censored'),
  actors: actors(21, 30, [...Array.from({ length: 3 }, () => ({ status: 'abandoned', expectedToPay: false })), ...censored(6)]) };
assert.equal(decideGate(runDeadline, slow).verdict, 'inconclusive_slow_machine');
assert.deepEqual(decideGate(runDeadline, slow).timingMisses, ['run_deadline']);
assert.equal(decideGate(runDeadline, fast).verdict, 'failed');
assert.equal(decideGate({ ...runDeadline, harnessStatus: 'failed', boundActors: 58 }, slow).verdict, 'inconclusive_slow_machine', 'unbound actors after the deadline are its consequence');
assert.equal(decideGate({ ...runDeadline, harnessFailureReasons: [] }, slow).verdict, 'inconclusive_slow_machine', 'an abort with no recorded reason is still the deadline');
assert.equal(decideGate({ ...runDeadline, paid: 19, fullSourceActorsVerified: 51,
  actors: actors(19, 30, [...Array.from({ length: 3 }, () => ({ status: 'abandoned', expectedToPay: false })), ...censored(2, true), ...censored(6)]) }, slow).verdict,
  'inconclusive_slow_machine', 'paying actors censored by the deadline explain the paid shortfall');
assert.equal(decideGate({ ...runDeadline, actors: actors(21, 30, [{ status: 'payment_pending', expectedToPay: true }, ...censored(8)]) }, slow).verdict,
  'inconclusive_slow_machine', 'payment cut off by the deadline is the deadline');

// Anything besides a time limit fails on every machine.
const real: [string, GateFacts][] = [
  ['browser client', { ...ok, clientComplete: false }],
  ['client workload', { ...ok, clientWorkloadComplete: false }],
  ['result stages', { ...ok, resultStageDiagnosticsComplete: false }],
  ['background proof', { ...ok, backgroundProofComplete: false }],
  ['other instrumentation failure', { ...sampleDeadline, failedObservations: ['instrumentation_failure:observer_sample_deadline', 'instrumentation_failure:pvp_metrics_error_response'] }],
  ['unplanned SUT outage', { ...ok, failedObservations: ['sut_unavailable:coordinator_down'] }],
  ['harness failure', { ...ok, harnessStatus: 'failed', harnessFailureReasons: ['wave_upload_synchronization_lost'] }],
  ['background stop', { ...runDeadline, harnessStatus: 'failed', harnessFailureReasons: ['harness_deadline_or_shutdown', 'background_stop_failed'] }],
  ['silent harness failure', { ...ok, harnessStatus: 'failed' }],
  ['operational failure', { ...ok, workloadFailureStatuses: ['operational_failure'] }],
  ['timeout actor', { ...runDeadline, workloadFailureStatuses: [...Array(6).fill('censored'), 'timeout'], actors: [...runDeadline.actors.slice(0, 53), { status: 'timeout', expectedToPay: false }, ...censored(6)] }],
  ['short paid', { ...ok, paid: 6 }],
  ['short verified', { ...ok, fullSourceActorsVerified: 18 }],
  ['unbound actors', { ...ok, harnessStatus: 'failed', boundActors: 19 }],
  ['client failure with a deadline', { ...sampleDeadline, clientComplete: false }],
  // Review findings: a deadline must not hide failures that happened before it.
  ['actor denied before the deadline', { ...ok, harnessStatus: 'interrupted', harnessFailureReasons: ['harness_deadline_or_shutdown'], paid: 6,
    actors: actors(6, 12, [{ status: 'authorization_denied', expectedToPay: true }, { status: 'abandoned', expectedToPay: false }]) }],
  ['payer finished unpaid before the deadline, others censored', { ...runDeadline, paid: 18, fullSourceActorsVerified: 51,
    actors: actors(18, 30, [...Array.from({ length: 3 }, () => ({ status: 'verified_nonpayable', expectedToPay: true })), ...Array.from({ length: 3 }, () => ({ status: 'abandoned', expectedToPay: false })), ...censored(6)]) }],
  ['paid shortfall larger than the payers cut off', { ...runDeadline, paid: 19 }],
  ['verified shortfall larger than the actors cut off', { ...runDeadline, fullSourceActorsVerified: 40 }],
  ['legacy actor instrumentation failure with an observer deadline', { ...ok, legacy: true, harnessStatus: 'failed', harnessFailureReasons: ['legacy_invalid_paid_receipt'],
    failedObservations: ['instrumentation_failure:observer_sample_deadline'], workloadFailureStatuses: ['operational_failure'] }],
];
for (const [name, facts] of real) {
  const decision = decideGate(facts, slow);
  assert.equal(decision.verdict, 'failed', name);
  assert.ok(decision.failures.length > 0, name);
}
planned: {
  const outage: GateFacts = { ...ok, failedObservations: ['sut_unavailable:coordinator_down'], plannedCoordinatorUnavailable: 1 };
  assert.equal(decideGate(outage, fast).verdict, 'passed', 'a planned coordinator outage is not a failure');
  break planned;
}
// Legacy lanes have no paid or full-source expectations.
assert.equal(decideGate({ ...ok, legacy: true, paid: 0, fullSourceActorsVerified: 0, workloadFailureStatuses: ['operational_failure'] }, fast).verdict, 'passed');
console.log('machine-speed policy: ok');
