import { performance } from 'node:perf_hooks';
import { boundOwnerStatus } from './browser-accounting.mjs';

export const DRAIN_POLL_MS = 1000;
export const DRAIN_OBSERVATION_LIMIT = 32;
export function createDrainObservations() {
  return { rateLimitedCount: 0, sampleLimit: DRAIN_OBSERVATION_LIMIT, truncated: false, samples: [] };
}
export function recordDrainRateLimit(observations) {
  observations.rateLimitedCount++;
  if (observations.samples.length < DRAIN_OBSERVATION_LIMIT) observations.samples.push({
    observedMonoMs: performance.now(), serviceState: 'pending_retryable', reason: 'rate_limited',
  });
  else observations.truncated = true;
}
function deadline() { return new Error('deadline'); }
function withinSignal(read, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(deadline());return; }
    const abort = () => { signal.removeEventListener('abort', abort);reject(deadline()); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw deadline();return read(signal); }).then(
      value => { signal.removeEventListener('abort', abort);resolve(value); },
      error => { signal.removeEventListener('abort', abort);reject(error); },
    );
  });
}
function backoff(signal, milliseconds = DRAIN_POLL_MS) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(deadline());return; }
    const abort = () => { clearTimeout(timer);signal.removeEventListener('abort', abort);reject(deadline()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort);resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function waitDrainPoll({ signal, paymentDeadlineMonoMs = null }) {
  if (signal.aborted) throw deadline();
  if (paymentDeadlineMonoMs !== null && (typeof paymentDeadlineMonoMs !== 'number' || !Number.isFinite(paymentDeadlineMonoMs) || paymentDeadlineMonoMs < 0)) throw new Error('drain_payment_window_invalid');
  const remaining = paymentDeadlineMonoMs === null ? DRAIN_POLL_MS : paymentDeadlineMonoMs - performance.now();
  if (remaining <= 0) throw new Error('drain_payment_observation_window');
  await backoff(signal, Math.min(DRAIN_POLL_MS, Math.ceil(remaining)));
  if (signal.aborted) throw deadline();
  if (paymentDeadlineMonoMs !== null && performance.now() >= paymentDeadlineMonoMs) throw new Error('drain_payment_observation_window');
}
// Only frozen post-pause owner-status reads use this recovery. It neither
// changes the original signal/window nor retries denial or unknown transport.
export async function readDrainOwnerStatus({ read, runId, signal, observations, paymentDeadlineMonoMs = null }) {
  if (paymentDeadlineMonoMs !== null && (typeof paymentDeadlineMonoMs !== 'number' || !Number.isFinite(paymentDeadlineMonoMs) || paymentDeadlineMonoMs < 0)) throw new Error('drain_payment_window_invalid');
  let timer, scoped = signal;
  const paymentWindow = new AbortController();
  const assertOpen = () => {
    // The original overall measurement scope always wins simultaneous expiry.
    if (signal.aborted) throw deadline();
    if (paymentDeadlineMonoMs !== null && (paymentWindow.signal.aborted || performance.now() >= paymentDeadlineMonoMs)) throw new Error('drain_payment_observation_window');
  };
  try {
    assertOpen();
    if (paymentDeadlineMonoMs !== null) {
      timer = setTimeout(() => paymentWindow.abort(), Math.max(0, Math.ceil(paymentDeadlineMonoMs - performance.now())));
      scoped = AbortSignal.any([signal, paymentWindow.signal]);
    }
    for (;;) {
      try {
        assertOpen();
        const value = await withinSignal(read, scoped);
        assertOpen();
        return boundOwnerStatus(value, runId);
      } catch (error) {
        assertOpen();
        if (error?.message !== 'known_service_outcome' || error.outcome?.serviceState !== 'pending_retryable'
          || error.outcome?.rawReason !== 'rate_limited') throw error;
        recordDrainRateLimit(observations);
        await backoff(scoped);
      }
    }
  } catch (error) { assertOpen();throw error; }
  finally { clearTimeout(timer); }
}
