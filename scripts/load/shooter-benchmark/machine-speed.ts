// Runner-speed policy for the advisory Shooter benchmarks.
//
// GitHub assigns each job a machine with a different CPU, and the same fixed work takes up to about
// twice as long on the slowest ones. The run limits (900 s per run, 5 s per observer sample) stay as
// they are. A run that misses only a time limit, on a machine measured as slow, is reported as
// inconclusive instead of failed. Every other failure stays a failure, on any machine.

/** Pinned calibration bundle: never changes, so scores stay comparable across PRs. */
export const CALIBRATION_BUNDLE_SHA256 = '735b6da58d5fbd61c69862596a3a45c9062c5a15fc11575549803b8076c01e2b';
/** Fixed replays from the Shooter corpus, chosen for long, varied work (about 4.5 s on a fast Node). */
export const CALIBRATION_REPLAYS = ['sahil-success-7.json', 'sahil-assisted-9.json', 'obama-success-11.json'] as const;
export const CALIBRATION_REPETITIONS = 2;
/**
 * Calibration CPU time on the reference machine: AMD EPYC 9V45, a GitHub ubuntu-latest runner, measured
 * at 5682 ms in PR #188's CI (run 43471547420). AMD EPYC 7763 measured 1.68-1.70 times that.
 */
export const REFERENCE_CALIBRATION_CPU_MS = 5700;
/** A machine whose calibration takes this many times the reference or longer is slow. */
export const SLOW_MACHINE_SCORE = 1.3;
/** A PR whose Shooter verifier takes this many times main's on the same machine fails. */
export const MAX_VERIFIER_SLOWDOWN = 1.2;

export type MachineClass = 'reference_speed' | 'slow';
export interface MachineSpeed {
  version: 1;
  cpuModel: string;
  calibrationBundleSha256: string;
  calibrationCpuMs: number;
  referenceCalibrationCpuMs: number;
  score: number;
  slowMachineScore: number;
  machineClass: MachineClass;
  verifierComparison: VerifierComparison;
}
export interface VerifierComparison {
  baseBundleSha256: string;
  headBundleSha256: string;
  state: 'same_bundle' | 'compared';
  baseCpuMs: number | null;
  headCpuMs: number | null;
  ratio: number | null;
  maxRatio: number;
  slower: boolean;
}

export function scoreMachine(calibrationCpuMs: number): { score: number; machineClass: MachineClass } {
  if (!Number.isFinite(calibrationCpuMs) || calibrationCpuMs <= 0) throw new Error('machine_speed_invalid_calibration');
  const score = Math.round((calibrationCpuMs / REFERENCE_CALIBRATION_CPU_MS) * 1000) / 1000;
  return { score, machineClass: score >= SLOW_MACHINE_SCORE ? 'slow' : 'reference_speed' };
}

export function compareVerifiers(baseBundleSha256: string, headBundleSha256: string, baseCpuMs: number | null, headCpuMs: number | null): VerifierComparison {
  if (baseBundleSha256 === headBundleSha256) return { baseBundleSha256, headBundleSha256, state: 'same_bundle', baseCpuMs: null, headCpuMs: null, ratio: null, maxRatio: MAX_VERIFIER_SLOWDOWN, slower: false };
  if (baseCpuMs === null || headCpuMs === null || !(baseCpuMs > 0) || !(headCpuMs > 0)) throw new Error('machine_speed_invalid_comparison');
  const ratio = Math.round((headCpuMs / baseCpuMs) * 1000) / 1000;
  return { baseBundleSha256, headBundleSha256, state: 'compared', baseCpuMs, headCpuMs, ratio, maxRatio: MAX_VERIFIER_SLOWDOWN, slower: ratio > MAX_VERIFIER_SLOWDOWN };
}

export function validateMachineSpeed(value: unknown): MachineSpeed {
  const fail = (): never => { throw new Error('machine_speed_file_invalid'); };
  if (!value || typeof value !== 'object') fail();
  const speed = value as MachineSpeed;
  const comparison = speed.verifierComparison;
  if (speed.version !== 1 || typeof speed.cpuModel !== 'string' || speed.cpuModel.length > 200 || speed.calibrationBundleSha256 !== CALIBRATION_BUNDLE_SHA256
    || speed.referenceCalibrationCpuMs !== REFERENCE_CALIBRATION_CPU_MS || speed.slowMachineScore !== SLOW_MACHINE_SCORE
    || !comparison || typeof comparison !== 'object') fail();
  const expected = scoreMachine(speed.calibrationCpuMs);
  if (speed.score !== expected.score || speed.machineClass !== expected.machineClass) fail();
  const recomputed = compareVerifiers(comparison.baseBundleSha256, comparison.headBundleSha256, comparison.baseCpuMs, comparison.headCpuMs);
  if (JSON.stringify(recomputed) !== JSON.stringify(comparison)) fail();
  return speed;
}

/** What the gate saw at the end of a run. Built by ci.ts from the run result. */
export interface GateFacts {
  legacy: boolean;
  clientComplete: boolean;
  clientWorkloadComplete: boolean;
  resultStageDiagnosticsComplete: boolean;
  harnessStatus: 'complete' | 'failed' | 'interrupted';
  harnessFailureReasons: string[];
  expectedActors: number;
  boundActors: number;
  /** Failed observer samples, as `${category}:${rawReason}`. Censored samples are not failures. */
  failedObservations: string[];
  plannedCoordinatorUnavailable: number;
  backgroundProofComplete: boolean;
  fullSourceActorsVerified: number;
  expectedFullSourceActors: number;
  paid: number;
  expectedPaid: number;
  /** Status of every actor counted as a workload failure. */
  workloadFailureStatuses: string[];
  /** Every bound actor: its status, and whether its case pays when it runs to the end. */
  actors: { status: string; expectedToPay: boolean }[];
}
export type Verdict = 'passed' | 'failed' | 'inconclusive_slow_machine';
export interface GateDecision { verdict: Verdict; failures: string[]; timingMisses: string[] }

const HARNESS_DEADLINE = 'harness_deadline_or_shutdown';
const SAMPLE_DEADLINE = 'instrumentation_failure:observer_sample_deadline';
const CUT_OFF = ['censored', 'not_started', 'payment_pending'];
/** How a case that doesn't pay finishes in a passing run: verified without pay, or abandoned. */
const FINISHED_UNPAID = ['verified_nonpayable', 'abandoned'];

export function decideGate(facts: GateFacts, machine: MachineSpeed | null): GateDecision {
  const failures: string[] = [], timingMisses: string[] = [];
  if (!facts.clientComplete) failures.push('client_incomplete');
  if (!facts.clientWorkloadComplete) failures.push('client_workload_incomplete');
  if (!facts.resultStageDiagnosticsComplete) failures.push('result_stage_diagnostics_incomplete');
  if (!facts.backgroundProofComplete) failures.push('background_input_proof_incomplete');

  // Observer samples: the 5 s per-sample deadline is a time limit; anything else is a real failure.
  const sutUnavailable = facts.failedObservations.filter(row => row.startsWith('sut_unavailable:')).length;
  if (sutUnavailable > facts.plannedCoordinatorUnavailable) failures.push('observer_sut_unavailable');
  const instrumentation = facts.failedObservations.filter(row => row.startsWith('instrumentation_failure:'));
  if (instrumentation.some(row => row !== SAMPLE_DEADLINE)) failures.push('observer_instrumentation_failure');
  if (instrumentation.length) timingMisses.push('observer_sample_deadline');

  // The 900 s run limit aborts the harness and censors the actors still in flight. The runner then
  // reports 'interrupted', or 'failed' when unbound actors remain; either way every recorded reason
  // is the deadline. A run aborted without any recorded reason is still 'interrupted'.
  const reasons = facts.harnessFailureReasons;
  const deadlineHit = facts.harnessStatus !== 'complete' && reasons.every(reason => reason === HARNESS_DEADLINE)
    && (reasons.length > 0 || facts.harnessStatus === 'interrupted');
  if (deadlineHit) timingMisses.push('run_deadline');
  else if (reasons.length) failures.push('harness_failed');
  else if (facts.harnessStatus === 'interrupted') failures.push('harness_interrupted');
  // 'failed' with no reason comes from observer instrumentation failures or unbound actors, which
  // are classified on their own.
  else if (facts.harnessStatus === 'failed' && !instrumentation.length && facts.boundActors === facts.expectedActors) failures.push('harness_failed');

  if (!deadlineHit) {
    if (facts.boundActors !== facts.expectedActors) failures.push('actors_unbound');
    if (!facts.legacy) {
      if (facts.fullSourceActorsVerified !== facts.expectedFullSourceActors) failures.push('full_source_actors_short');
      if (facts.paid !== facts.expectedPaid) failures.push('paid_actors_short');
      if (facts.workloadFailureStatuses.length) failures.push('workload_failures');
    }
  } else {
    // The deadline excuses only the work it cut off: unbound actors and those it censored, never
    // started or left waiting for payment. Every actor that finished must have finished the way its
    // case does in a passing run, and no shortfall may be larger than the work cut off.
    const cut = facts.actors.filter(actor => CUT_OFF.includes(actor.status));
    const unbound = facts.expectedActors - facts.boundActors;
    if (!facts.legacy) {
      const wrong = facts.actors.filter(actor => !CUT_OFF.includes(actor.status)
        && (actor.expectedToPay ? actor.status !== 'paid' : !FINISHED_UNPAID.includes(actor.status)));
      if (wrong.length) failures.push('actor_failed_before_deadline');
      if (facts.expectedFullSourceActors - facts.fullSourceActorsVerified > cut.length + unbound) failures.push('full_source_actors_short');
      if (facts.expectedPaid - facts.paid > cut.filter(actor => actor.expectedToPay).length + unbound) failures.push('paid_actors_short');
    }
  }

  if (failures.length) return { verdict: 'failed', failures, timingMisses };
  if (!timingMisses.length) return { verdict: 'passed', failures, timingMisses };
  if (machine?.machineClass === 'slow') return { verdict: 'inconclusive_slow_machine', failures, timingMisses };
  return { verdict: 'failed', failures: ['time_limit_missed_on_reference_speed_machine'], timingMisses };
}
