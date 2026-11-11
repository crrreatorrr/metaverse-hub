// Expected workload responses are explicit. Malformed known input, broken
// server-checkpoint chaining or an artifact mismatch invalidate the adapter.
export function legacyFailureClass(status: number, reason: string): 'timeout' | 'authorization_denied' | 'limited' | 'unavailable' | 'instrumentation_failure' {
  if (reason === 'cpu_budget') return 'timeout';
  if (['session_expired', 'session_closed', 'revoked', 'unauthorized'].includes(reason)) return 'authorization_denied';
  if (['cap_exhausted', 'rate_limited'].includes(reason) || status === 429) return 'limited';
  if (status >= 500 && status <= 599) return 'unavailable';
  return 'instrumentation_failure';
}
export function validLegacyPaidReceipt(status: number, body: Record<string, unknown>, expected: { runId: string; boss: string; day: unknown; protocol: number; fingerprint: string }): boolean {
  return status >= 200 && status < 300 && body.ok === true && body.paid === true
    && body.tickets === 20 && body.ticketsMinted === 0 && body.canonicalCount === 1
    && body.runId === expected.runId && body.canonicalBoss === expected.boss && body.day === expected.day
    && body.protocol === expected.protocol && body.fingerprint === expected.fingerprint;
}
