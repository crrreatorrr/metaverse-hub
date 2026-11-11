// Readonly client readiness coordinates this CI profile's offered load. It does
// not create commands, alter a simulation or extend the common900s deadline.
export interface ClientProbe {
  start(signal: AbortSignal, onRecordingStarted?: (proof: { observedMonoMs: number; recordedFrames: number; runBindingHash: string }) => void): Promise<Record<string, unknown>>;
  close(): Promise<{ state: string }>;
}
export function beginClientMeasurement(probe: ClientProbe, signal: AbortSignal) {
  const scheduledMonoMs = performance.now();
  let release!: () => void, closed = false;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const evidence: { scheduledMonoMs: number; releasedMonoMs: number | null; readinessBudgetMs: 90000; reason: string | null; positiveRecording: { observedMonoMs: number; recordedFrames: number; runBindingHash: string } | null } = { scheduledMonoMs, releasedMonoMs: null, readinessBudgetMs: 90000, reason: null, positiveRecording: null };
  const finish = (reason: string) => {
    if (closed) return;
    closed = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
    evidence.releasedMonoMs = performance.now(); evidence.reason = reason; release();
  };
  const abort = () => finish('global_measurement_abort');
  const timer = setTimeout(() => finish('client_readiness_deadline'), 90000);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const result = Promise.resolve().then(() => probe.start(signal, proof => {
    if (closed || signal.aborted) return;
    if (!Number.isFinite(proof.observedMonoMs) || proof.observedMonoMs < scheduledMonoMs || proof.observedMonoMs > performance.now()
      || !Number.isSafeInteger(proof.recordedFrames) || proof.recordedFrames < 1 || !/^[a-f0-9]{64}$/.test(proof.runBindingHash)) return;
    evidence.positiveRecording = { ...proof }; finish('observed_positive_native_recording');
  })).then(population => { finish('client_settled_before_ready'); return { state: 'observed' as const, population }; }, () => {
    finish('client_failed_before_ready'); return { state: 'failed' as const, rawReason: 'client_probe_operation_failed' };
  });
  return { ready, result, evidence: () => structuredClone(evidence) };
}
