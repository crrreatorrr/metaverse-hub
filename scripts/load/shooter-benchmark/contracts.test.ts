import assert from 'node:assert/strict';
import { makePlan, sha256, summarizeActors, quantiles, unobserved, validatePlan, type Corpus, type ActorResult } from './contracts.ts';
import { runPlan, type CampaignAdapter } from './runner.ts';

// Synthetic metadata tests exercise accounting/scheduling; this is deliberately
// not replay evidence and cannot substitute for the actual20-actor CI lane.
const ids = ['sahil-success-7', 'sahil-success-11', 'sahil-fail-7', 'sahil-assisted-9', 'obama-success-7', 'obama-success-11', 'broccoli-success-7', 'broccoli-success-11', 'glowie-success-7', 'glowie-success-11', 'tinubu-success-7', 'tinubu-success-11'];
const corpus: Corpus = { corpusSourceCommit: 'a'.repeat(40), approvedManifest: { sha256: 'b'.repeat(64) }, cases: ids.map(id => ({ id, boss: id.split('-')[0], seed: Number(id.split('-').at(-1)), actions: 0, frames: id === 'sahil-success-7' ? 9634 : id === 'obama-success-7' ? 24000 : 100, fixtureSha256: sha256(id), legacyInputEnvelopeSha256: sha256(`input:${id}`) })) };
const bytes = Buffer.from(JSON.stringify(corpus));
const plan = makePlan(corpus, bytes, 'test-seed');
assert.deepEqual(plan, makePlan(corpus, bytes, 'test-seed'));
assert.equal(new Set(plan.assignments.map(a => a.caseId)).size, 12);
assert.equal(plan.assignments.length, 20);
assert.throws(() => makePlan({ ...corpus, cases: corpus.cases.slice(1) }, bytes, 'seed'), /12 corpus/);
assert.throws(() => makePlan({ ...corpus, cases: corpus.cases.map(c => c.id === 'obama-success-7' ? { ...c, frames: 23999 } : c) }, bytes, 'seed'), /Obama24000/);
assert.throws(() => validatePlan({ ...plan, legacyReplayBudgetMs: 16000 } as unknown as typeof plan), /15 seconds/);
assert.throws(() => validatePlan({ ...plan, mode: 'bounded_v8_remote' }), /separately authorized/);
const actor = (i: number): ActorResult => ({ actor: i, wave: 0, accountBindingHash: sha256(`account${i}`), sessionBindingHash: sha256(`session${i}`), runBindingHash: sha256(`run${i}`), caseId: ids[0], sourceInputSha256: sha256('input'), sourceFrames: 9634, submittedFrames: 9634, submittedInputSha256: sha256('submitted'), submittedHashMeaning: 'test_only', acceptedTick: 9634, verifiedTick: 0, attempted: true, durablyVerified: false, payable: false, everObservedEligible: false, observedPaid: false, paid: false, status: 'timeout', rawReason: 'cpu_budget' });
const actors = Array.from({ length: 20 }, (_, i) => actor(i));
assert.equal(summarizeActors(actors).paid, 0);
assert.throws(() => summarizeActors([actors[0], { ...actors[1], runBindingHash: actors[0].runBindingHash }]), /reused/);
assert.throws(() => summarizeActors([{ ...actors[0], paid: true }]), /paid actor/);
assert.equal(unobserved('ms', 'gc', 'not installed').value, null);
assert.throws(() => unobserved('ms', 'gc', ''), /reason/);
assert.deepEqual(quantiles([1, 2, 3, 4], 'ms', 'test').value, { p50: 2, p95: 4, p99: 4, max: 4, method: 'nearest_rank' });
let active = 0, peak = 0, backgroundStopped = false;
const adapter: CampaignAdapter = {
  mode: plan.mode,
  async prepare(_assignment, wave) { const i = wave * 20 + _assignment.actor; return { accountBindingHash: sha256(`a${i}`), sessionBindingHash: sha256(`s${i}`), runBindingHash: sha256(`r${i}`) }; },
  async execute() { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 20)); active--; return { status: 'timeout', rawReason: 'test_timeout_not_throughput', durablyVerified: false, payable: false, everObservedEligible: false, observedPaid: false, paid: false }; },
  async startBackground() {}, async stopBackground() { backgroundStopped = true; }, async observe() {},
};
const result = await runPlan({ ...plan, phases: [{ kind: 'sustained', waves: 2, arrivalIntervalMs: 1 }] }, adapter);
assert.equal(result.actors.length, 40);
assert.equal(result.harnessStatus, 'complete');
assert.equal(result.summary.paid, 0);
assert.ok(peak > 20, 'sustained arrival must overlap unresolved prior wave');
assert.equal(backgroundStopped, true);
const beforeDeadline = performance.now();
const interrupted = await runPlan({ ...plan, maxDurationMs: 15, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, { ...adapter, async execute() { return new Promise(() => undefined); } });
assert.ok(performance.now() - beforeDeadline < 1000, 'hard deadline survives an adapter ignoring its signal');
assert.equal(interrupted.actors.length, 20);
assert.equal(interrupted.summary.censored, 20);
assert.equal(interrupted.harnessStatus, 'interrupted');
assert.ok(result.observations.length >= 1, 'observes initial/startup interval');
assert.equal(result.arrivals.length, 2);
assert.ok(result.arrivals.every(a => a.actualElapsedMs >= a.plannedElapsedMs));

const prefix = { ...actors[0], sourceFrames: 5049, submittedFrames: 120, acceptedTick: 120, verifiedTick: 120, submittedInputSha256: sha256('actual120framebody'), status: 'abandoned' as const, durablyVerified: true };
assert.equal(summarizeActors([prefix]).verifiedFrames, 120);
assert.equal(summarizeActors([prefix]).sourceFrames, 5049);
assert.equal(summarizeActors([prefix]).fullSourceActorsVerified, 0);
assert.throws(() => summarizeActors([{ ...prefix, verifiedTick: 5049 }]), /cursor accounting/);
assert.throws(() => summarizeActors([{ ...actors[0], status: 'paid', paid: true, payable: true, everObservedEligible: true, durablyVerified: true, submittedFrames: 0, submittedInputSha256: null, submittedHashMeaning: null, acceptedTick: 0, verifiedTick: 0 }]), /positive verified input/, 'zero work cannot become a durable/paid benchmark success');
assert.throws(() => validatePlan({ ...plan, maxQueuedBytes: 1 }), /body budget/);
const { SutUnavailable } = await import('./runner.ts');
const unavailable = await runPlan({ ...plan, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, { ...adapter, async observe() { throw new SutUnavailable('http_503'); } });
assert.equal(unavailable.harnessStatus, 'complete');
assert.equal(unavailable.summary.observerUnavailable, 1);
assert.equal(unavailable.summary.observerSuccessful, 0);
const broken = await runPlan({ ...plan, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, { ...adapter, async execute() { throw new Error('instrumentation bug'); } });
assert.equal(broken.harnessStatus, 'failed');
const lateCallbacks: Parameters<CampaignAdapter['execute']>[4][] = [];
const eligibleCensored = await runPlan({ ...plan, maxDurationMs: 15, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, { ...adapter, async execute(_binding, _assignment, _phase, _signal, progress) {
  progress({ submittedFrames: 1, submittedInputSha256: sha256('actual-prefix'), submittedHashMeaning: 'test_only', acceptedTick: 1, verifiedTick: 1, durablyVerified: true, payable: true, everObservedEligible: true, observedPaid: false });
  lateCallbacks.push(progress); return new Promise(() => undefined);
} });
assert.equal(eligibleCensored.summary.eligible, 20);
assert.equal(eligibleCensored.summary.eligibleUnpaid, 20);
assert.equal(eligibleCensored.summary.eligibleCensored, 20);
assert.equal(eligibleCensored.summary.verifiedFrames, 20);
const closed = JSON.stringify(eligibleCensored);
for (const progress of lateCallbacks) progress({ submittedFrames: 2, submittedInputSha256: sha256('late-prefix'), submittedHashMeaning: 'test_only', acceptedTick: 2, verifiedTick: 2, durablyVerified: true, payable: true, everObservedEligible: true, observedPaid: false });
assert.equal(JSON.stringify(eligibleCensored), closed, 'late adapter facts cannot change a closed report');
const { ByteBudget } = await import('./budget.ts');
const budget = new ByteBudget(64), releaseA = budget.reserve(32), releaseB = budget.reserve(32);
assert.throws(() => budget.reserve(1), /budget exceeded/);
releaseA(); releaseA(); releaseB();
assert.equal(budget.observation().currentBytes, 0);
assert.equal(budget.observation().peakBytes, 64);
const partiallyLaunched = await runPlan({ ...plan, maxDurationMs: 15, phases: [{ kind: 'sustained', waves: 2, arrivalIntervalMs: 100 }] }, { ...adapter, async execute() { return new Promise(() => undefined); } });
assert.equal(partiallyLaunched.summary.accountedActors, 40);
assert.equal(partiallyLaunched.summary.attempted, 20);
assert.equal(partiallyLaunched.summary.unstartedActors, 20);
assert.equal(partiallyLaunched.summary.unboundActors, 0);
assert.equal(partiallyLaunched.summary.censored, 20);
assert.equal(partiallyLaunched.harnessStatus, 'interrupted');
const { positiveEligibilityProof } = await import('./contracts.ts');
assert.equal(positiveEligibilityProof(true, 'clear', 'authorization_denied'), false);
assert.equal(positiveEligibilityProof(true, 'clear', 'pending'), true);
assert.equal(positiveEligibilityProof(true, 'fail', 'pending'), false);
assert.equal(positiveEligibilityProof(false, 'clear', 'paid'), false);
const paidUnsupported = { ...prefix, status: 'unsupported' as const, everObservedEligible: true, observedPaid: true, payable: false, paid: false };
assert.equal(summarizeActors([paidUnsupported]).observedPaid, 1);
assert.equal(summarizeActors([paidUnsupported]).paid, 0);
assert.equal(summarizeActors([paidUnsupported]).eligibleUnpaid, 0);
assert.equal(summarizeActors([paidUnsupported]).fullSourceActorsVerified, 0);
const { prepareReserved } = await import('./budget.ts');
const preparationBudget = new ByteBudget(64);
let materializations = 0, finishPreparation!: () => void;
const preparationWait = new Promise<void>(resolve => { finishPreparation = resolve; });
const preparing = prepareReserved(preparationBudget, 48, async () => { materializations++; await preparationWait; return 'actual input'; });
await assert.rejects(prepareReserved(preparationBudget, 48, async () => { materializations++; return 'must not materialize'; }), /budget exceeded/);
assert.equal(materializations, 1, 'reservation overflow prevents concurrent input materialization');
assert.equal(preparationBudget.observation().currentBytes, 48);
finishPreparation(); const owned = await preparing; owned.release();
assert.equal(preparationBudget.observation().currentBytes, 0);

const { phaseInputReservation } = await import('./budget.ts');
const cohortBytes = phaseInputReservation(plan.assignments, 1);
assert.ok(cohortBytes > 1024 * 1024);
assert.throws(() => validatePlan({ ...plan, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }], maxQueuedBytes: 1024 * 1024 }), /fully prepared phase/);
await assert.rejects(runPlan(plan, adapter), /instrumentation failed/);
assert.throws(() => summarizeActors([{ ...actors[0], durablyVerified: true, submittedFrames: 0, submittedInputSha256: null, submittedHashMeaning: null, acceptedTick: 0, verifiedTick: 0 }]), /durable status/);
console.log('benchmark contract tests passed; synthetic accounting tests only, no capacity evidence');

const lifecycleCalls: string[] = [];
const lifecycleResult = await runPlan({ ...plan, phases: [{ kind: 'cold_burst', waves: 1, arrivalIntervalMs: 0 }, { kind: 'warm_burst', waves: 1, arrivalIntervalMs: 0 }] }, {
  ...adapter,
  async phaseLifecycle(phase) { lifecycleCalls.push('before:' + phase.kind); return { observed: 'test_only_start' }; },
  async phaseLifecycleComplete(phase) { lifecycleCalls.push('after:' + phase.kind); return { observed: 'test_only_actual_usage' }; },
});
assert.deepEqual(lifecycleCalls, ['before:cold_burst', 'after:cold_burst', 'before:warm_burst', 'after:warm_burst']);
assert.equal(lifecycleResult.phaseLifecycles.length, 4);
assert.equal(lifecycleResult.actors.length, 40);

const { assertFixtureCohortFits, FIXTURE_RESERVED_BYTES } = await import('./fixture-config.ts');
assert.equal(FIXTURE_RESERVED_BYTES, 4294967296);
assert.doesNotThrow(() => assertFixtureCohortFits(20, 3));
assert.throws(() => assertFixtureCohortFits(20, 3, 64, 2147483648), /durable admission reservation/);
assert.throws(() => assertFixtureCohortFits(20, 4), /durable admission reservation/);

const closingObservation = await runPlan({ ...plan, maxDurationMs: 15, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, {
  ...adapter, async observe() { return new Promise(() => undefined); }, async execute() { return new Promise(() => undefined); },
});
assert.equal(closingObservation.summary.observerAttempts, 1);
assert.equal(closingObservation.summary.observerCensored, 1);
assert.equal(closingObservation.summary.observerSuccessful, 0);
assert.equal(closingObservation.summary.observerUnavailable, 0);
assert.equal(closingObservation.summary.observerInstrumentationFailures, 0);
assert.equal(closingObservation.observations[0].rawReason, 'measurement_window_closed');
assert.equal(closingObservation.harnessStatus, 'interrupted');

const { FIXTURE_CP_RESERVED_BYTES } = await import('./fixture-config.ts');
assert.equal(FIXTURE_CP_RESERVED_BYTES, 1073741824);
assert.doesNotThrow(() => assertFixtureCohortFits(20, 2));
assert.throws(() => assertFixtureCohortFits(20, 2, 64, FIXTURE_RESERVED_BYTES, 536870912), /durable admission reservation/);
assert.throws(() => assertFixtureCohortFits(20, 3, 64, FIXTURE_RESERVED_BYTES, 536870912), /durable admission reservation/);

const { assertFixtureRemainingCapacity } = await import('./fixture-config.ts');
const fixtureCapacity = { maxRuns: 64, retainedRuns: 20, maxInputBytes: FIXTURE_RESERVED_BYTES, reservedInputBytes: 20 * 67108864, maxCheckpointBytes: FIXTURE_CP_RESERVED_BYTES, reservedCheckpointBytes: 20 * 16777216 };
assert.doesNotThrow(() => assertFixtureRemainingCapacity(fixtureCapacity, 40));
assert.throws(() => assertFixtureRemainingCapacity({ ...fixtureCapacity, reservedCheckpointBytes: 31 * 16777216 }, 40), /remaining durable reservation/);
assert.throws(() => assertFixtureRemainingCapacity({ ...fixtureCapacity, reservedInputBytes: 31 * 67108864 }, 40), /remaining durable reservation/);
