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

export function countPlannedCoordinatorUnavailable(
  observations: readonly { category: string; rawReason: string | null; sourceSampleWallMs: number | null }[],
  intervals: readonly { startedWallMs: number; finishedWallMs: number | null; completed: boolean }[],
): number {
  return observations.filter(row => row.category === 'sut_unavailable' && row.rawReason === 'coordinator_metrics_read_unavailable'
    && row.sourceSampleWallMs !== null && Number.isFinite(row.sourceSampleWallMs)
    && intervals.some(interval => interval.completed && Number.isFinite(interval.startedWallMs) && interval.finishedWallMs !== null
      && Number.isFinite(interval.finishedWallMs) && interval.finishedWallMs >= interval.startedWallMs
      && row.sourceSampleWallMs! >= interval.startedWallMs && row.sourceSampleWallMs! <= interval.finishedWallMs)).length;
}
