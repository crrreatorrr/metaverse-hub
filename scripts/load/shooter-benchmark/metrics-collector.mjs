// Credential-free observer process in its own CI resource cgroup. It shares
// Nakama's network namespace solely to read the unpublished loopback aggregate.
import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const boolean = value => typeof value === 'boolean' ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
// Duplicated closed metadata schema from gateway-observer.mjs: this container
// deliberately has no coordinator/service modules or credentials to import.
const OPERATIONS = ['claim','renew','retry','result','ops','receipt','pending','repair','maintenance','unknown'];
const STATES = ['ready','leased','stale','refused','verified','terminal_verified','invalid_gameplay','pending_retryable','authorization_denied','invalid','observed','receipt_found','receipt_missing','receipt_conflict','pending_proofs','paid','ineligible','capped','maintained','unknown'];
const REASONS = ['gateway_unavailable','gateway_disabled','gateway_capacity','rate_limited','unauthorized','bad_worker_checkpoint','malformed','oversized','request_conflict','bad_gateway_request','bad_gateway_response','request_oversized','response_oversized','response_stream_limit','stale_claim','stale_or_unbound_result','private_work_unavailable','session_expired','session_closed','revoked','cap_exhausted','ineligible','already_paid','observations_unavailable','maintenance_unavailable','terminal_proof_unavailable','bad_worker_result','terminal_regression','stale_lease','bad_retry_reason','result_commit_unavailable','attempts_exhausted','teleport','god_mode','debug','injected_inventory','execution_timeout','worker_crash','artifact_unavailable','checkpoint_export_failure','database_issue','bad_worker','workers_disabled','no_capacity_or_ready_work','worker_authorization','uncommitted_terminal','unknown_run','terminal_binding','verification_pending','verification_receipt_unavailable','unsupported_payment_policy','payments_disabled','unknown'];
export function safeGatewayDiagnostics(value) {
  const fail = () => { throw new Error('gateway_diagnostics_shape'); };
  const object = source => source && typeof source === 'object' && !Array.isArray(source) ? source : fail();
  const count = source => Number.isSafeInteger(source) && source >= 0 ? source : fail();
  const time = source => typeof source === 'number' && Number.isFinite(source) && source >= 0 ? source : fail();
  const flag = source => typeof source === 'boolean' ? source : fail();
  const enumValue = (source, allowed) => typeof source === 'string' && allowed.includes(source) ? source : fail();
  const nullable = (source, project) => source === null ? null : project(source);
  const httpStatus = source => Number.isInteger(source) && source >= 100 && source <= 599 ? source : fail();
  const list = (source, limit, project) => Array.isArray(source) && source.length <= limit ? source.map(project) : fail();
  const active = source => {
    const row = object(source);
    return { sequence: count(row.sequence), operation: enumValue(row.operation, OPERATIONS), startedWallMs: time(row.startedWallMs),
      startedMonoMs: time(row.startedMonoMs), httpStatus: nullable(row.httpStatus, httpStatus),
      fetchPhase: enumValue(row.fetchPhase, ['not_called','awaiting_headers','headers_received','threw']),
      headersMonoMs: nullable(row.headersMonoMs, time), requestAborted: nullable(row.requestAborted, flag) };
  };
  const source = object(value);
  if (source.version !== 1 || source.observer !== 'ci_gateway_metadata_v1') fail();
  const byOperation = list(source.byOperation, OPERATIONS.length, input => {
    const row = object(input), result = { operation: enumValue(row.operation, OPERATIONS) };
    for (const key of ['started','returned','threw','requestAborted','http4xx','http5xx']) result[key] = count(row[key]);
    return result;
  });
  if (byOperation.length !== OPERATIONS.length || new Set(byOperation.map(row => row.operation)).size !== OPERATIONS.length) fail();
  const result = { version: 1, observer: 'ci_gateway_metadata_v1', asOf: time(source.asOf), startedAt: time(source.startedAt),
    attempts: count(source.attempts), completed: count(source.completed), inFlight: count(source.inFlight), activeOverflow: count(source.activeOverflow),
    counterSaturated: flag(source.counterSaturated), truncated: flag(source.truncated), droppedEvents: count(source.droppedEvents), byOperation,
    active: list(source.active, 8, active), recent: list(source.recent, 128, input => {
      const row = object(input);
      return { ...active(row), finishedWallMs: time(row.finishedWallMs), finishedMonoMs: time(row.finishedMonoMs), wallMs: time(row.wallMs),
        transportOutcome: enumValue(row.transportOutcome, ['returned','threw']), state: nullable(row.state, value => enumValue(value, STATES)),
        kind: nullable(row.kind, value => enumValue(value, STATES)), reason: nullable(row.reason, value => enumValue(value, REASONS)) };
    }) };
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new Error('gateway_diagnostics_bound');
  return result;
}
export function safeMetrics(value) {
  if (!value || !Number.isFinite(value.uptimeMs) || !value.counters) throw new Error('metrics_shape');
  const counters = {};
  for (const key of ['claims','verified','terminal','invalid','retries','timeouts','rpcFailures','artifactMismatches','workerRestarts','journalRecoveries','paymentRepairs','paidObservations','paymentDenials','paymentRepairPending','paymentRepairFailures']) counters[key] = number(value.counters[key]);
  const pickNumbers = (source, keys) => source ? Object.fromEntries(keys.map(key => [key, number(source[key])])) : null;
  const gateway = pickNumbers(value.gateway, ['observedAt','queueDepth','oldestQueueAgeMs','acceptedVerifiedLagTicks','paymentPending','orphanPending','opsDbWallMs','authExpiresAt']);
  if (gateway) gateway.eligibilityUnknown = boolean(value.gateway.eligibilityUnknown);
  if (gateway) for (const key of ['eligible','queueTruncated','lagTruncated','paymentTruncated','orphanTruncated','canExecute','writerReady']) gateway[key] = boolean(value.gateway[key]);
  const lastExecution = pickNumbers(value.lastExecution, ['cpuUserMicros','cpuSystemMicros','wallMs','rssBytes','heapUsedBytes','finishedAt']);
  if (lastExecution) Object.assign(lastExecution, { gcMs: null, gcObserved: false });
  return { uptimeMs: number(value.uptimeMs), counters, gateway, lastExecution,
    ...(Object.hasOwn(value, 'gatewayDiagnostics') ? { gatewayDiagnostics: safeGatewayDiagnostics(value.gatewayDiagnostics) } : {}),
    gatewaySampleAgeMs: number(value.gatewaySampleAgeMs), lastExecutionSampleAgeMs: number(value.lastExecutionSampleAgeMs),
    workerRestartsObserved: boolean(value.workerRestartsObserved), workerRestartsLowerBound: boolean(value.workerRestartsLowerBound) };
}
export function safeHealth(value) {
  if (!value || number(value.asOf) === null) throw new Error('health_shape');
  const result = { asOf: number(value.asOf) };
  for (const key of ['ready','busy','blocked','draining','gatewayObservationCurrent']) result[key] = boolean(value[key]);
  result.journalPhase = value.journalPhase === null ? null : ['claiming','replaying','submitting','retrying'].includes(value.journalPhase) ? value.journalPhase : 'unknown';
  return result;
}
async function readProjection(endpoint, project) {
  const response = await fetch(`http://127.0.0.1:9476/${endpoint}`, { redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (!response.ok || !response.body) throw new Error('metrics_unavailable');
  const reader = response.body.getReader(), chunks = []; let bytes = 0, reads = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (++reads > 4096 || bytes > 65536) throw new Error('metrics_bound'); chunks.push(chunk.value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return project(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
async function main() {
  let stopping = false; const stop = () => { stopping = true; }; process.on('SIGTERM', stop); process.on('SIGINT', stop);
  while (!stopping) {
    // Sequential reads keep one bounded HTTP request at a time in this same
    // observer process/cgroup. A private response is never persisted raw.
    for (const [endpoint, project] of [['metrics', safeMetrics], ['health', safeHealth]]) {
      if (stopping) break;
      let snapshot;
      try { snapshot = { state: 'observed', asOf: Date.now(), [endpoint]: await readProjection(endpoint, project) }; }
      catch { snapshot = { state: 'unavailable', asOf: Date.now(), reason: `bounded_loopback_${endpoint}_read_failed` }; }
      const text = JSON.stringify(snapshot);
      if (Buffer.byteLength(text) > 65536) throw new Error('metrics_file_bound');
      await writeFile(`/tmp/${endpoint}.next`, text, { mode: 0o600 }); await rename(`/tmp/${endpoint}.next`, `/tmp/${endpoint}.json`);
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('metrics_collector_failed'); process.exitCode = 1; });
