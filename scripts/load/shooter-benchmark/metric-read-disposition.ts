import type { MetricReadLifetimeEvidence } from './metric-read-lifetime.ts';
export class MetricReadParentAborted extends Error {
  constructor() { super('metric_read_parent_aborted'); }
}
// A resolved transport promise cannot override an earlier immutable RESULT or
// parent closure. This is shared by the observer and its deferred-response test.
export async function settleMetricRead<T>(operation: Promise<T>, lifetime: { finish(): MetricReadLifetimeEvidence }): Promise<
  { kind: 'end_censored'; proof: MetricReadLifetimeEvidence } | { kind: 'response'; proof: MetricReadLifetimeEvidence; value: T }
> {
  const transport = await operation.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  const proof = lifetime.finish();
  if (proof.closeReason === 'authoritative_result') return { kind: 'end_censored', proof };
  if (proof.closeReason === 'parent_aborted') throw new MetricReadParentAborted();
  if (!transport.ok) throw transport.error;
  return { kind: 'response', proof, value: transport.value };
}
