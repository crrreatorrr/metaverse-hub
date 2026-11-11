// Credential-free observer process in its own CI resource cgroup. It shares
// Nakama's network namespace solely to read the unpublished loopback aggregate.
import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const boolean = value => typeof value === 'boolean' ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
