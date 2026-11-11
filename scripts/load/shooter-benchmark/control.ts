// Background lifecycle work belongs to the run lifetime, never a short sampler.
// At most one round is active; stopping wakes the cadence without extending any
// public RPC, replay or overall run deadline.
export async function runLifetimeControl(signal: AbortSignal, intervalMs: number, round: () => Promise<boolean>): Promise<void> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 1000) throw new Error('bounded control cadence required');
  while (!signal.aborted) {
    if (!await round() || signal.aborted) break;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, intervalMs); signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
}
