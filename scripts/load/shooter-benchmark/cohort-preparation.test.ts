import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { CohortPreparation, PREPARATION_CONCURRENCY } from './cohort-preparation.ts';
import { makePlan, sha256, type Corpus } from './contracts.ts';
import { runPlan, type CampaignAdapter } from './runner.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((one, two) => { resolve = one; reject = two; }); return { promise, resolve, reject }; }
async function until(check: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!check()) { assert.ok(performance.now() < deadline, 'test progress bound'); await immediate(); }
}
const items = Array.from({ length: 20 }, (_, actor) => ({ actor, privateInput: 'PRIVATE-NEVER-EMIT' }));

// Completion order deliberately differs from assignment order. Only two real
// operations may be active, while every output must retain its original slot.
const queue = new CohortPreparation(), slots = new Map<number, ReturnType<typeof deferred<number>>>();
let active = 0, maximum = 0;
const ordered = queue.prepare(items, async (_item, index) => {
  const slot = deferred<number>(); slots.set(index, slot); active++; maximum = Math.max(maximum, active);
  try { return await slot.promise; } finally { active--; }
}, { phase: 'finish_burst', wave: 0, signal: new AbortController().signal });
await until(() => slots.size === 2); assert.equal(active, 2);
for (let index = 1; index < 20; index++) {
  await until(() => slots.has(index)); slots.get(index)!.resolve(index); await immediate();
}
assert.equal(active, 1); slots.get(0)!.resolve(0);
assert.deepEqual(await ordered, items.map(item => item.actor));
const evidence = queue.close();
assert.equal(PREPARATION_CONCURRENCY, 2); assert.equal(maximum, 2); assert.equal(evidence.cohorts[0]!.maximumInFlight, 2);
assert.deepEqual(evidence.cohorts[0]!.counts, { started: 20, prepared: 20, failed: 0, censored: 0, notStarted: 0 });
assert.equal(evidence.cohorts[0]!.inFlightAtSettlement, 0);
assert.ok(evidence.cohorts[0]!.actors.every((row, index) => row.actor === index && row.startedMonoMs !== null && row.finishedMonoMs !== null && row.finishedMonoMs >= row.startedMonoMs));
assert.ok(Object.isFrozen(evidence) && Object.isFrozen(evidence.cohorts) && Object.isFrozen(evidence.cohorts[0]!.actors[0]));
assert.ok(!JSON.stringify(evidence).includes('PRIVATE'));
assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 262144);
assert.match(evidence.cohorts[0]!.processCpu.scope, /not_preparation_CPU_attribution/);
assert.match(evidence.cohorts[0]!.schedulingDelay.scope, /not_CPU_attribution/);
if (!evidence.cohorts[0]!.schedulingDelay.sampleCount) assert.ok(['no_samples','unavailable'].includes(evidence.cohorts[0]!.schedulingDelay.unavailableReason!));
await assert.rejects(queue.prepare(items, async item => item.actor, { phase: 'finish_burst', wave: 1, signal: new AbortController().signal }), /bounds/);

// A failure does not start the remaining18 actors. Already running work is
// explicitly censored, and late settlement cannot mutate the frozen evidence.
const failureQueue = new CohortPreparation(), failureSlots = new Map<number, ReturnType<typeof deferred<number>>>();
const failure = new Error('PRIVATE-FAILURE-MUST-NOT-ENTER-EVIDENCE');
const failed = failureQueue.prepare(items, (_item, index) => { const slot = deferred<number>(); failureSlots.set(index, slot); return slot.promise; },
  { phase: 'finish_burst', wave: 0, signal: new AbortController().signal });
const failureObserved = assert.rejects(failed, caught => caught === failure);
await until(() => failureSlots.size === 2); failureSlots.get(0)!.reject(failure); await failureObserved;
await assert.rejects(failureQueue.prepare(items, async item => item.actor, { phase: 'finish_burst', wave: 1, signal: new AbortController().signal }), /bounds/);
const failedEvidence = failureQueue.close(), frozenFailed = JSON.stringify(failedEvidence);
assert.deepEqual(failedEvidence.cohorts[0]!.counts, { started: 2, prepared: 0, failed: 1, censored: 1, notStarted: 18 });
assert.equal(failedEvidence.cohorts[0]!.actors[1]!.finishedMonoMs, null);
failureSlots.get(1)!.resolve(1); await immediate(); assert.equal(failureSlots.size, 2);
assert.equal(JSON.stringify(failureQueue.close()), frozenFailed); assert.ok(!frozenFailed.includes('PRIVATE'));

const abortQueue = new CohortPreparation(), controller = new AbortController(), abortSlots: ReturnType<typeof deferred<number>>[] = [];
const aborted = abortQueue.prepare(items, () => { const slot = deferred<number>(); abortSlots.push(slot); return slot.promise; }, { phase: 'sustained', wave: 0, signal: controller.signal });
const abortObserved = assert.rejects(aborted, /aborted/); await until(() => abortSlots.length === 2); controller.abort(); await abortObserved;
const abortedEvidence = abortQueue.close(), frozenAbort = JSON.stringify(abortedEvidence);
assert.deepEqual(abortedEvidence.cohorts[0]!.counts, { started: 2, prepared: 0, failed: 0, censored: 2, notStarted: 18 });
abortSlots.forEach(slot => slot.resolve(0)); await immediate(); assert.equal(abortSlots.length, 2); assert.equal(JSON.stringify(abortQueue.close()), frozenAbort);
const alreadyAborted = new CohortPreparation(); let starts = 0;
await assert.rejects(alreadyAborted.prepare(items, async () => ++starts, { phase: 'finish_burst', wave: 0, signal: controller.signal }), /aborted/);
assert.equal(starts, 0); assert.equal(alreadyAborted.close().cohorts[0]!.counts.notStarted, 20);
const bounded = new CohortPreparation();
await assert.rejects(bounded.prepare(items.slice(1), async item => item.actor, { phase: 'finish_burst', wave: 0, signal: new AbortController().signal }), /bounds/);
for (let wave = 0; wave < 6; wave++) await bounded.prepare(items, async item => item.actor, { phase: 'sustained', wave, signal: new AbortController().signal });
await assert.rejects(bounded.prepare(items, async item => item.actor, { phase: 'sustained', wave: 6, signal: new AbortController().signal }), /bounds/);
assert.equal(bounded.close().cohorts.length, 6);

// Exercise the actual runner barrier: no actor executes while the final fixture
// is pending; after it settles all20 executions can be in flight together.
const ids = ['sahil-success-7','sahil-success-11','sahil-fail-7','sahil-assisted-9','obama-success-7','obama-success-11','broccoli-success-7','broccoli-success-11','glowie-success-7','glowie-success-11','tinubu-success-7','tinubu-success-11'];
const corpus: Corpus = { corpusSourceCommit: 'a'.repeat(40), approvedManifest: { sha256: 'b'.repeat(64) }, cases: ids.map(id => ({ id, boss: id.split('-')[0]!, seed: Number(id.split('-').at(-1)), actions: 0, frames: id === 'sahil-success-7' ? 9634 : id === 'obama-success-7' ? 24000 : 100, fixtureSha256: sha256(id), legacyInputEnvelopeSha256: sha256('input:' + id) })) };
const plan = makePlan(corpus, Buffer.from(JSON.stringify(corpus)), 'preparation-order-test');
const lastFixture = deferred<void>(), executions = deferred<void>(); let prepared = 0, started = 0, executing = 0, maximumExecuting = 0;
const adapter: CampaignAdapter = {
  mode: plan.mode,
  async prepare(assignment) {
    if (assignment.actor === 19) await lastFixture.promise;
    prepared++;
    return { accountBindingHash: sha256('account:' + assignment.actor), sessionBindingHash: sha256('session:' + assignment.actor), runBindingHash: sha256('run:' + assignment.actor) };
  },
  async execute() {
    assert.equal(prepared, 20); started++; executing++; maximumExecuting = Math.max(maximumExecuting, executing);
    await executions.promise; executing--;
    return { status: 'timeout', rawReason: 'synthetic_test_only', durablyVerified: false, payable: false, observedPaid: false, paid: false };
  },
  async startBackground() {}, async stopBackground() {}, async observe() {},
};
const running = runPlan({ ...plan, maxDurationMs: 5000, phases: [{ kind: 'finish_burst', waves: 1, arrivalIntervalMs: 0 }] }, adapter);
await until(() => prepared === 19); assert.equal(started, 0);
lastFixture.resolve(); await until(() => started === 20); assert.equal(maximumExecuting, 20); executions.resolve();
const result = await running;
assert.equal(result.actors.length, 20); assert.equal(result.preparationEvidence.cohorts[0]!.counts.prepared, 20);
assert.equal(result.arrivals.length, 1);
assert.ok(result.arrivals[0]!.actualElapsedMs + result.startedMonoMs >= result.preparationEvidence.cohorts[0]!.settledMonoMs!);
console.log('bounded two-slot fixture preparation, failure/abort freeze and unchanged concurrent20 runner barrier canaries passed');
