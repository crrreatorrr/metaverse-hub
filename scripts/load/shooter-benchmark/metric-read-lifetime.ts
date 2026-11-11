import { performance } from 'node:perf_hooks';

export interface MetricReadLifetimeEvidence {
  readonly matchBindingHash: string;
  readonly startedMonoMs: number;
  readonly resultObservedMonoMs: number | null;
  readonly closedMonoMs: number;
  readonly closeReason: 'operation_complete' | 'parent_aborted' | 'authoritative_result';
}

// The caller notifies only an actual authoritative RESULT received for a match.
// A missing response, replacement slot or inferred end is never RESULT proof.
export function createMetricReadLifetime({ matchBindingHash, parentSignal }: {
  matchBindingHash: string;
  parentSignal: AbortSignal;
}) {
  if (typeof matchBindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(matchBindingHash) || !(parentSignal instanceof AbortSignal)) throw new Error('metric_read_lifetime_binding');
  const controller = new AbortController(), startedMonoMs = performance.now();
  let evidence: MetricReadLifetimeEvidence | null = null;
  const close = (closeReason: MetricReadLifetimeEvidence['closeReason']): MetricReadLifetimeEvidence => {
    if (evidence) return evidence;
    const closedMonoMs = performance.now();
    evidence = Object.freeze({ matchBindingHash, startedMonoMs, resultObservedMonoMs: closeReason === 'authoritative_result' ? closedMonoMs : null, closedMonoMs, closeReason });
    parentSignal.removeEventListener('abort', parentAbort);
    // Freeze evidence before cancellation dispatches synchronous read listeners.
    if (closeReason !== 'operation_complete') controller.abort(closeReason);
    return evidence;
  };
  const parentAbort = () => { close('parent_aborted'); };
  parentSignal.addEventListener('abort', parentAbort, { once: true });
  if (parentSignal.aborted) parentAbort();
  return {
    signal: controller.signal,
    notifyResult(hash: string): boolean {
      if (evidence || hash !== matchBindingHash) return false;
      if (parentSignal.aborted) { parentAbort(); return false; }
      close('authoritative_result');
      return true;
    },
    finish(): MetricReadLifetimeEvidence {
      return close(parentSignal.aborted ? 'parent_aborted' : 'operation_complete');
    },
  };
}
