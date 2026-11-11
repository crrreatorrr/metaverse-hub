// Coordination uses only the existing run signal. Each actual uploader already
// has its fixed retry count and20s/RPC bound; no first-arrival10s deadline exists.
export interface FinishRelease { synchronized: boolean; reason: 'all_uploads_acknowledged' | 'uploader_failed'; }
export class FinishBarrier {
  private readonly waves = new Map<number, { arrivals: Set<string>; failures: Set<string>; promise: Promise<FinishRelease>; release(value: FinishRelease): void; outcome: FinishRelease | null }>();
  constructor(private readonly expected: number) { if (!Number.isSafeInteger(expected) || expected < 1 || expected > 20) throw new Error('bounded finish population required'); }
  private wave(wave: number) {
    if (!Number.isSafeInteger(wave) || wave < 0 || wave >= 6) throw new Error('bounded finish wave required');
    let row = this.waves.get(wave);
    if (!row) { let release!: (value: FinishRelease) => void; const promise = new Promise<FinishRelease>(resolve => { release = resolve; }); row = { arrivals: new Set(), failures: new Set(), promise, release, outcome: null }; this.waves.set(wave, row); }
    return row;
  }
  fail(wave: number, actor: string): void {
    const row = this.wave(wave); row.failures.add(actor);
    if (!row.outcome) { row.outcome = { synchronized: false, reason: 'uploader_failed' }; row.release(row.outcome); }
  }
  async arrive(wave: number, actor: string, signal: AbortSignal): Promise<FinishRelease> {
    const row = this.wave(wave);
    if (row.arrivals.has(actor) || row.arrivals.size >= this.expected) throw new Error('duplicate finish arrival');
    row.arrivals.add(actor);
    if (!row.outcome && row.arrivals.size === this.expected) { row.outcome = { synchronized: true, reason: 'all_uploads_acknowledged' }; row.release(row.outcome); }
    if (signal.aborted) throw new Error('finish synchronization aborted');
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('finish synchronization aborted')); };
      signal.addEventListener('abort', abort, { once: true });
      row.promise.then(value => { signal.removeEventListener('abort', abort); resolve({ ...value }); });
      if (signal.aborted) abort();
    });
  }
  failures() { return [...this.waves].filter(([, row]) => row.failures.size > 0).map(([wave, row]) => ({ wave, reason: 'wave_upload_synchronization_lost', acknowledgedActors: row.arrivals.size, expectedActors: this.expected, failedActorBindingHashes: [...row.failures] })); }
}
