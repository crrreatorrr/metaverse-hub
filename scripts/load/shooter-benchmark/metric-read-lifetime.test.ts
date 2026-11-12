import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createMetricReadLifetime } from './metric-read-lifetime.ts';

const match = 'a'.repeat(64), other = 'b'.repeat(64);
test('only exact pending authoritative RESULT cancels a read and freezes its proof', () => {
  const parent = new AbortController(), before = performance.now();
  const read = createMetricReadLifetime({ matchBindingHash: match, parentSignal: parent.signal });
  assert.equal(read.notifyResult(other), false);assert.equal(read.signal.aborted, false);
  assert.equal(read.notifyResult(match), true);assert.equal(read.signal.aborted, true);
  assert.equal(read.signal.reason, 'authoritative_result');
  const proof = read.finish();
  assert.equal(proof.closeReason, 'authoritative_result');assert.equal(proof.matchBindingHash, match);
  assert.ok(proof.startedMonoMs >= before && proof.closedMonoMs >= proof.startedMonoMs && proof.closedMonoMs <= performance.now());
  assert.equal(proof.resultObservedMonoMs, proof.closedMonoMs);assert.ok(Object.isFrozen(proof));
  parent.abort();assert.equal(read.notifyResult(match), false);assert.equal(read.finish(), proof);
});
test('missing RESULT leaves the live parent deadline authoritative; later RESULT cannot rewrite it', () => {
  const parent = new AbortController(), read = createMetricReadLifetime({ matchBindingHash: match, parentSignal: parent.signal });
  assert.equal(read.notifyResult(other), false);assert.equal(read.signal.aborted, false);
  parent.abort('a private parent reason must not escape');
  assert.equal(read.signal.aborted, true);assert.equal(read.signal.reason, 'parent_aborted');
  const proof = read.finish();assert.equal(proof.closeReason, 'parent_aborted');assert.equal(proof.resultObservedMonoMs, null);
  assert.equal(read.notifyResult(match), false);assert.equal(read.finish(), proof);
  assert.equal(JSON.stringify(proof).includes('private'), false);
});
test('an already closed parent refuses even an immediate same-match RESULT', () => {
  const parent = new AbortController();parent.abort();
  const read = createMetricReadLifetime({ matchBindingHash: match, parentSignal: parent.signal });
  assert.equal(read.signal.aborted, true);assert.equal(read.notifyResult(match), false);
  assert.equal(read.finish().closeReason, 'parent_aborted');assert.equal(read.finish().resultObservedMonoMs, null);
});
test('normal completion disposes the parent listener and cannot acquire late RESULT proof', () => {
  const parent = new AbortController(), read = createMetricReadLifetime({ matchBindingHash: match, parentSignal: parent.signal });
  const proof = read.finish();assert.equal(proof.closeReason, 'operation_complete');assert.equal(proof.resultObservedMonoMs, null);
  assert.equal(read.notifyResult(match), false);parent.abort();
  assert.equal(read.signal.aborted, false);assert.equal(read.finish(), proof);
});
test('RESULT proof is frozen before cancellation listeners run; disposal cannot overwrite it', () => {
  const parent = new AbortController(), read = createMetricReadLifetime({ matchBindingHash: match, parentSignal: parent.signal });
  let observed: ReturnType<typeof read.finish> | undefined;
  read.signal.addEventListener('abort', () => { observed = read.finish();parent.abort(); });
  assert.equal(read.notifyResult(match), true);assert.equal(observed, read.finish());
  assert.equal(observed?.closeReason, 'authoritative_result');
});
test('invalid identity or parent input fails before recording evidence', () => {
  assert.throws(() => createMetricReadLifetime({ matchBindingHash: 'not-a-hash', parentSignal: new AbortController().signal }), /metric_read_lifetime_binding/);
  assert.throws(() => createMetricReadLifetime({ matchBindingHash: match, parentSignal: null as unknown as AbortSignal }), /metric_read_lifetime_binding/);
});
