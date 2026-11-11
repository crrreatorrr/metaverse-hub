// CI-only metadata instrumentation. Delegates requests unchanged and never
// reads a body, URL, credential, request ID or raw exception for diagnostics.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { GatewayClient } from '../../../services/shooter-verifier/src/gateway-client.mjs';
import { Metrics } from '../../../services/shooter-verifier/ops/safe-metrics.mjs';

export const OPERATIONS = Object.freeze(['claim','renew','retry','result','ops','receipt','pending','repair','maintenance','unknown']);
// Finite DTO literals from gateway client,0052/53/54/55/58; others stayunknown.
export const STATES = Object.freeze(['ready','leased','stale','refused','verified','terminal_verified','invalid_gameplay','pending_retryable','authorization_denied','invalid','observed','receipt_found','receipt_missing','receipt_conflict','pending_proofs','paid','ineligible','capped','maintained','unknown']);
export const REASONS = Object.freeze(['gateway_unavailable','gateway_disabled','gateway_capacity','rate_limited','unauthorized','bad_worker_checkpoint','malformed','oversized','request_conflict','bad_gateway_request','bad_gateway_response','request_oversized','response_oversized','response_stream_limit','stale_claim','stale_or_unbound_result','private_work_unavailable','session_expired','session_closed','revoked','cap_exhausted','ineligible','already_paid','observations_unavailable','maintenance_unavailable','terminal_proof_unavailable','bad_worker_result','terminal_regression','stale_lease','bad_retry_reason','result_commit_unavailable','attempts_exhausted','teleport','god_mode','debug','injected_inventory','execution_timeout','worker_crash','artifact_unavailable','checkpoint_export_failure','database_issue','bad_worker','workers_disabled','no_capacity_or_ready_work','worker_authorization','uncommitted_terminal','unknown_run','terminal_binding','verification_pending','verification_receipt_unavailable','unsupported_payment_policy','payments_disabled','unknown']);
export const DIAGNOSTIC_BYTES = 32768;
const RING_LIMIT = 128, ACTIVE_LIMIT = 8;
const enumValue = (value, allowed) => typeof value === 'string' && allowed.includes(value) ? value : value === undefined || value === null ? null : 'unknown';
const statusValue = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const data = (value, key) => { if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;const descriptor = Object.getOwnPropertyDescriptor(value, key);return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; };

export function installGatewayObserver({ gatewayPrototype = GatewayClient.prototype, metricsPrototype = Metrics.prototype, fetchTarget = globalThis } = {}) {
  const originalRequest = gatewayPrototype.request, originalSnapshot = metricsPrototype.snapshot, originalFetch = fetchTarget.fetch;
  if (typeof originalRequest !== 'function' || typeof originalSnapshot !== 'function' || typeof originalFetch !== 'function') throw new Error('benchmark_gateway_observer_configuration');
  const scope = new AsyncLocalStorage(), recent = [], active = new Map();
  const startedAt = Date.now();
  let attempts = 0, completed = 0, inFlight = 0, droppedEvents = 0, activeOverflow = 0, counterSaturated = false;
  const byOperation = OPERATIONS.map(operation => ({ operation, started: 0, returned: 0, threw: 0, requestAborted: 0, http4xx: 0, http5xx: 0 }));
  const increment = value => { if (value >= Number.MAX_SAFE_INTEGER) { counterSaturated = true;return value; }return value + 1; };
  const inFlightProjection = context => ({ sequence: context.sequence, operation: context.operation, startedWallMs: context.startedWallMs, startedMonoMs: context.startedMonoMs,
    httpStatus: context.httpStatus, fetchPhase: context.fetchPhase, headersMonoMs: context.headersMonoMs,
    requestAborted: context.signal ? context.signal.aborted === true : null });
  function snapshot() {
    const projection = () => ({ version: 1, observer: 'ci_gateway_metadata_v1', asOf: Date.now(), startedAt, attempts, completed,
      inFlight, activeOverflow, counterSaturated, truncated: droppedEvents > 0 || activeOverflow > 0, droppedEvents,
      byOperation: byOperation.map(row => ({ ...row })), active: [...active.values()].map(inFlightProjection), recent: recent.map(row => ({ ...row })) });
    let value = projection();
    while (Buffer.byteLength(JSON.stringify(value)) > DIAGNOSTIC_BYTES && recent.length) { recent.shift();droppedEvents = increment(droppedEvents);value = projection(); }
    return value;
  }
  async function observedFetch(...args) {
    const context = scope.getStore();
    if (!context) return originalFetch.apply(this, args);
    context.fetchPhase = 'awaiting_headers';
    try { const candidate = data(args[1], 'signal');if (candidate instanceof AbortSignal) context.signal = candidate; } catch { /* Metadata never changes request semantics. */ }
    try {
      const response = await originalFetch.apply(this, args);
      try { context.httpStatus = statusValue(response.status);context.headersMonoMs = performance.now();context.fetchPhase = 'headers_received'; } catch { /* No raw metadata error. */ }
      return response;
    } catch (error) { context.fetchPhase = 'threw';throw error; }
  }
  async function observedRequest(...args) {
    const operation = typeof args[0] === 'string' && OPERATIONS.includes(args[0]) ? args[0] : 'unknown';
    attempts = increment(attempts);inFlight = increment(inFlight);
    const context = { sequence: attempts, operation, startedWallMs: Date.now(), startedMonoMs: performance.now(), httpStatus: null, headersMonoMs: null, fetchPhase: 'not_called', signal: null };
    const counters = byOperation.find(row => row.operation === operation);counters.started = increment(counters.started);
    const tracked = active.size < ACTIVE_LIMIT;
    if (tracked) active.set(context.sequence, context);else activeOverflow = increment(activeOverflow);
    let returned, transportOutcome = 'threw';
    try {
      returned = await scope.run(context, () => originalRequest.apply(this, args));
      transportOutcome = 'returned';return returned;
    } finally {
      try {
      completed = increment(completed);inFlight = Math.max(0, inFlight - 1);if (tracked) active.delete(context.sequence);
      counters[transportOutcome] = increment(counters[transportOutcome]);
      const requestAborted = context.signal ? context.signal.aborted === true : null;
      if (requestAborted) counters.requestAborted = increment(counters.requestAborted);
      if (context.httpStatus >= 400 && context.httpStatus < 500) counters.http4xx = increment(counters.http4xx);
      if (context.httpStatus >= 500) counters.http5xx = increment(counters.http5xx);
      const finishedMonoMs = performance.now();
      recent.push({ ...inFlightProjection(context), finishedWallMs: Date.now(), finishedMonoMs, wallMs: finishedMonoMs - context.startedMonoMs,
        transportOutcome, state: enumValue(data(returned, 'state'), STATES), kind: enumValue(data(returned, 'kind'), STATES), reason: enumValue(data(returned, 'reason'), REASONS) });
      if (recent.length > RING_LIMIT) { recent.shift();droppedEvents = increment(droppedEvents); }
      snapshot(); // Enforce the serialized bound between observations too.
      } catch { /* Diagnostics cannot replace a returned value or thrown error. */ }
    }
  }
  function observedSnapshot(...args) { const value = originalSnapshot.apply(this, args);try { return { ...value, gatewayDiagnostics: snapshot() }; } catch { return value; } }
  gatewayPrototype.request = observedRequest;metricsPrototype.snapshot = observedSnapshot;fetchTarget.fetch = observedFetch;
  return { snapshot, restore() {
    if (gatewayPrototype.request === observedRequest) gatewayPrototype.request = originalRequest;
    if (metricsPrototype.snapshot === observedSnapshot) metricsPrototype.snapshot = originalSnapshot;
    if (fetchTarget.fetch === observedFetch) fetchTarget.fetch = originalFetch;
  } };
}

if (process.env.SHOOTER_BENCHMARK_GATEWAY_OBSERVER === '1') {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark') throw new Error('benchmark_gateway_observer_requires_disposable_ci');
  installGatewayObserver();
}
