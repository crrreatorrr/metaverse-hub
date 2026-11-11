import assert from 'node:assert/strict';
import { makePlan, sha256, summarizeActors, quantiles, unobserved, validatePlan, type Corpus, type ActorResult } from './contracts.ts';
import { runPlan, type CampaignAdapter } from './runner.ts';

// Synthetic metadata tests exercise accounting/scheduling; this is deliberately
// not replay evidence and cannot substitute for the actual20-actor CI lane.
const ids = ['sahil-success-7', 'sahil-success-11', 'sahil-fail-7', 'sahil-assisted-9', 'obama-success-7', 'obama-success-11', 'broccoli-success-7', 'broccoli-success-11', 'glowie-success-7', 'glowie-success-11', 'tinubu-success-7', 'tinubu-success-11'];
const corpus: Corpus = { corpusSourceCommit: 'a'.repeat(40), approvedManifest: { sha256: 'b'.repeat(64) }, cases: ids.map(id => ({ id, boss: id.split('-')[0], seed: Number(id.split('-').at(-1)), frames: id === 'sahil-success-7' ? 9634 : id === 'obama-success-7' ? 24000 : 100, fixtureSha256: sha256(id), legacyInputEnvelopeSha256: sha256(`input:${id}`) })) };
const bytes = Buffer.from(JSON.stringify(corpus));
const plan = makePlan(corpus, bytes, 'test-seed');
assert.deepEqual(plan, makePlan(corpus, bytes, 'test-seed'));
assert.equal(new Set(plan.assignments.map(a => a.caseId)).size, 12);
assert.equal(plan.assignments.length, 20);
assert.throws(() => makePlan({ ...corpus, cases: corpus.cases.slice(1) }, bytes, 'seed'), /12 corpus/);
assert.throws(() => makePlan({ ...corpus, cases: corpus.cases.map(c => c.id === 'obama-success-7' ? { ...c, frames: 23999 } : c) }, bytes, 'seed'), /Obama24000/);
assert.throws(() => validatePlan({ ...plan, legacyReplayBudgetMs: 16000 } as unknown as typeof plan), /15 seconds/);
assert.throws(() => validatePlan({ ...plan, mode: 'bounded_v8_remote' }), /separately authorized/);
const actor = (i: number): ActorResult => ({ actor: i, wave: 0, accountBindingHash: sha256(`account${i}`), sessionBindingHash: sha256(`session${i}`), runBindingHash: sha256(`run${i}`), caseId: ids[0], sourceInputSha256: sha256('input'), sourceFrames: 9634, submittedFrames: 9634, submittedInputSha256: sha256('submitted'), submittedHashMeaning: 'test_only', acceptedTick: 9634, verifiedTick: 0, attempted: true, durablyVerified: false, payable: false, paid: false, status: 'timeout', rawReason: 'cpu_budget' });
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
  async execute() { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 20)); active--; return { status: 'timeout', rawReason: 'test_timeout_not_throughput', durablyVerified: false, payable: false, paid: false }; },
  async startBackground() {}, async stopBackground() { backgroundStopped = true; }, async observe() {},
};
const result = await runPlan({ ...plan, phases: [{ kind: 'sustained', waves: 2, arrivalIntervalMs: 1 }] }, adapter);
assert.equal(result.actors.length, 40);
assert.equal(result.harnessStatus, 'complete');
assert.equal(result.summary.paid, 0);
assert.ok(peak > 20, 'sustained arrival must overlap unresolved prior wave');
assert.equal(backgroundStopped, true);
const beforeDeadline = performance.now();
const interrupted = await runPlan({ ...plan, maxDurationMs: 15, phases: [{ kind: 'cold_burst', waves: 1, arrivalIntervalMs: 0 }] }, { ...adapter, async execute() { return new Promise(() => undefined); } });
assert.ok(performance.now() - beforeDeadline < 1000, 'hard deadline survives an adapter ignoring its signal');
assert.equal(interrupted.actors.length, 20);
assert.equal(interrupted.summary.censored, 20);
assert.equal(interrupted.harnessStatus, 'interrupted');
assert.ok(result.observations.length >= 1, 'observes initial/startup interval');
assert.equal(result.arrivals.length, 2);
assert.ok(result.arrivals.every(a => a.actualElapsedMs >= a.plannedElapsedMs));

console.log('benchmark contract tests passed; synthetic accounting tests only, no capacity evidence');
const prefix = { ...actors[0], sourceFrames: 5049, submittedFrames: 120, acceptedTick: 120, verifiedTick: 120, submittedInputSha256: sha256('actual120framebody'), status: 'abandoned' as const, durablyVerified: true };
assert.equal(summarizeActors([prefix]).verifiedFrames, 120);
assert.equal(summarizeActors([prefix]).sourceFrames, 5049);
assert.equal(summarizeActors([prefix]).fullSourceActorsVerified, 0);
assert.throws(() => summarizeActors([{ ...prefix, verifiedTick: 5049 }]), /cursor accounting/);
