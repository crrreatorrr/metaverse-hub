import assert from 'node:assert/strict';
import { checkpointChanges, restoreCheckpointSamples, metricReadColumns, restoreMetricReads } from './evidence-codec.ts';
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const samples = [
  { observedAt: '2026-01-01T00:00:00.000Z', sizes: [{ runBindingHash: b, canonicalJsonBytes: 0, jsonbDatumBytes: 0 }, { runBindingHash: a, canonicalJsonBytes: 0, jsonbDatumBytes: 0 }] },
  { observedAt: '2026-01-01T00:00:01.000Z', sizes: [{ runBindingHash: a, canonicalJsonBytes: 0, jsonbDatumBytes: 0 }, { runBindingHash: b, canonicalJsonBytes: 0, jsonbDatumBytes: 0 }] },
  { observedAt: '2026-01-01T00:00:02.000Z', sizes: [{ runBindingHash: a, canonicalJsonBytes: 120, jsonbDatumBytes: 80 }] },
];
const encoded = checkpointChanges(samples);
assert.equal(encoded.samples[1].changes.length, 0);
assert.deepEqual(restoreCheckpointSamples(encoded), samples.map(sample => ({ ...sample, sizes: [...sample.sizes].sort((x, y) => x.runBindingHash.localeCompare(y.runBindingHash)) })));
assert.deepEqual(encoded.samples[2].removedRunBindingHashes, [b]);
const reads = [{ slot: 0, matchBindingHash: a, startedMonoMs: 1, finishedMonoMs: 5001, elapsedMs: 5000, stage: 'rpc_pending', outcome: 'sample_signal_aborted', httpStatus: null, signalDefinition: 'parent_sampler_shared_5s_readonly_observation_budget' }];
assert.deepEqual(restoreMetricReads(metricReadColumns(reads)), reads);
assert.throws(() => metricReadColumns([{ ...reads[0], token: 'must-never-hide-in-columns' }]), /shape/);
assert.throws(() => checkpointChanges([{ observedAt: '2026-01-01T00:00:03.000Z', sizes: [{ runBindingHash: a, canonicalJsonBytes: 0, jsonbDatumBytes: 0, token: 'private' }] }]), /shape/);
console.log('lossless metadata delta/column encodings retain every timestamp, failure, count and transition');

assert.throws(() => metricReadColumns([{ ...reads[0], stage: ['rpc_pending'] }]), /shape/);
assert.throws(() => metricReadColumns([{ ...reads[0], outcome: ['sample_signal_aborted'] }]), /shape/);
assert.throws(() => metricReadColumns([{ ...reads[0], stage: { toString: () => 'rpc_pending', token: 'private' } }]), /shape/);
assert.throws(() => checkpointChanges([{ ...samples[0], observedAt: 42 } as unknown as typeof samples[0]]), /shape/);
assert.throws(() => checkpointChanges([['private'] as unknown as typeof samples[0]]), /shape/);
const allOutcomes = ['pending','transport_exception','response_received','confirmed_match_end','observed','measurement_window_closed','sample_signal_aborted'].map((outcome, i) => ({ ...reads[0], outcome, startedMonoMs: i, finishedMonoMs: i + 5, elapsedMs: 5, httpStatus: outcome === 'response_received' ? 503 : null }));
assert.deepEqual(restoreMetricReads(metricReadColumns(allOutcomes)), allOutcomes, 'all error, unavailable and censored read evidence roundtrips');
