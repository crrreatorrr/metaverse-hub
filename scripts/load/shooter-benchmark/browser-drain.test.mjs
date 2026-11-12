import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { outcomeError } from './browser-accounting.mjs';
import { createDrainObservations, recordDrainRateLimit, readDrainOwnerStatus, waitDrainPoll, DRAIN_POLL_MS, DRAIN_OBSERVATION_LIMIT } from './browser-drain.mjs';
const runId = '11111111-1111-4111-8111-111111111111';
const status = { protocol: 2, runId, state: 'terminal', received: { tick: 130 }, verified: { tick: 130 } };
test('known drain rate limit retries to an unchanged bound owner status and retains bounded evidence', async () => {
  const parent = new AbortController(), observations = createDrainObservations();let calls = 0;
  const value = await readDrainOwnerStatus({ signal: parent.signal, runId, observations, read: async signal => {
    assert.equal(signal, parent.signal);
    if (++calls < 3) throw outcomeError({ state: 'pending_retryable', reason: 'rate_limited' });return status;
  } });
  assert.equal(value, status);assert.equal(calls, 3);assert.equal(DRAIN_POLL_MS, 1000);
  assert.equal(observations.rateLimitedCount, 2);assert.equal(observations.samples.length, 2);
  assert.ok(observations.samples.every(row => Number.isFinite(row.observedMonoMs) && row.serviceState === 'pending_retryable' && row.reason === 'rate_limited'));
});
test('denial, unknown failures and other retryable responses are never silently retried', async () => {
  for (const error of [outcomeError({ state: 'authorization_denied', reason: 'session_expired' }), outcomeError({ state: 'pending_retryable', reason: 'http_429' }), new Error('PRIVATE-UNKNOWN')]) {
    let calls = 0;const observations = createDrainObservations();
    await assert.rejects(readDrainOwnerStatus({ runId, signal: new AbortController().signal, observations, read: async () => { calls++;throw error; } }), caught => caught === error);
    assert.equal(calls, 1);assert.equal(observations.rateLimitedCount, 0);
  }
  await assert.rejects(readDrainOwnerStatus({ runId, signal: new AbortController().signal, observations: createDrainObservations(), read: async () => ({ ...status, runId: '22222222-2222-4222-8222-222222222222' }) }), /binding_mismatch/);
});
test('the original signal stops retry backoff without losing the observed rate limit', async () => {
  const parent = new AbortController(), observations = createDrainObservations();let calls = 0;
  const work = readDrainOwnerStatus({ runId, signal: parent.signal, observations, read: async () => { calls++;throw outcomeError({ state: 'pending_retryable', reason: 'rate_limited' }); } });
  const timer = setTimeout(() => parent.abort(), 10);
  try { await assert.rejects(work, /deadline/); } finally { clearTimeout(timer); }
  assert.equal(calls, 1);assert.equal(observations.rateLimitedCount, 1);assert.equal(observations.samples.length, 1);
});
test('closed signal issues no request; a pending read cannot outlive it or manufacture late evidence', async () => {
  const closed = new AbortController();closed.abort();let calls = 0;
  await assert.rejects(readDrainOwnerStatus({ runId, signal: closed.signal, observations: createDrainObservations(), read: async () => { calls++;return status; } }), /deadline/);assert.equal(calls, 0);
  const parent = new AbortController(), observations = createDrainObservations();let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const work = readDrainOwnerStatus({ runId, signal: parent.signal, observations, read: () => { entered();return pending; } });
  await started;parent.abort();await assert.rejects(work, /deadline/);release(status);
  assert.equal(observations.rateLimitedCount, 0);
});
test('drain evidence retains total count while bounding stored samples and safe fields', () => {
  const observations = createDrainObservations();
  for (let i = 0; i < 40; i++) recordDrainRateLimit(observations);
  assert.equal(observations.rateLimitedCount, 40);assert.equal(observations.samples.length, DRAIN_OBSERVATION_LIMIT);assert.equal(observations.truncated, true);
  assert.ok(observations.samples.every(row => Object.keys(row).sort().join(',') === 'observedMonoMs,reason,serviceState'));
});
test('the existing absolute payment window bounds continuous rate-limit backoff without resetting it', async () => {
  const observations = createDrainObservations(), parent = new AbortController();let calls = 0;
  const paymentDeadlineMonoMs = performance.now() + 25;
  await assert.rejects(readDrainOwnerStatus({ runId, signal: parent.signal, observations, paymentDeadlineMonoMs,
    read: async () => { calls++;throw outcomeError({ state: 'pending_retryable', reason: 'rate_limited' }); },
  }), /drain_payment_observation_window/);
  assert.equal(calls, 1);assert.equal(parent.signal.aborted, false);assert.equal(observations.rateLimitedCount, 1);
  await assert.rejects(readDrainOwnerStatus({ runId, signal: parent.signal, observations, paymentDeadlineMonoMs, read: async () => { calls++;return status; } }), /drain_payment_observation_window/);
  assert.equal(calls, 1, 'reusing the expired absolute deadline cannot open another window');
});
test('payment window also bounds a pending read; original scope abort remains a general deadline', async () => {
  const parent = new AbortController(), observations = createDrainObservations();
  await assert.rejects(readDrainOwnerStatus({ runId, signal: parent.signal, observations, paymentDeadlineMonoMs: performance.now() + 20, read: () => new Promise(() => {}) }), /drain_payment_observation_window/);
  parent.abort();
  await assert.rejects(readDrainOwnerStatus({ runId, signal: parent.signal, observations, paymentDeadlineMonoMs: 0, read: async () => status }), error => error.message === 'deadline');
  assert.equal(observations.rateLimitedCount, 0);
});
test('ordinary post-pause poll sleep is clipped by the same absolute payment window', async () => {
  const parent = new AbortController();
  await assert.rejects(waitDrainPoll({ signal: parent.signal, paymentDeadlineMonoMs: performance.now() + 20 }), /drain_payment_observation_window/);
  parent.abort();
  await assert.rejects(waitDrainPoll({ signal: parent.signal, paymentDeadlineMonoMs: 0 }), error => error.message === 'deadline');
});
