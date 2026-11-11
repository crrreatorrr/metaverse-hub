// Credential-free observer process in its own CI resource cgroup. It shares
// Nakama's network namespace solely to read the unpublished loopback aggregate.
import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function safeMetrics(value) {
  if (!value || !Number.isFinite(value.uptimeMs) || !value.counters) throw new Error('metrics_shape');
  const counters = {};
  for (const key of ['claims','verified','terminal','invalid','retries','timeouts','rpcFailures','artifactMismatches','workerRestarts','journalRecoveries','paymentRepairs','paidObservations','paymentDenials','paymentRepairPending','paymentRepairFailures']) counters[key] = number(value.counters[key]);
  const pickNumbers = (source, keys) => source ? Object.fromEntries(keys.map(key => [key, number(source[key])])) : null;
  const gateway = pickNumbers(value.gateway, ['observedAt','queueDepth','oldestQueueAgeMs','acceptedVerifiedLagTicks','paymentPending','orphanPending','opsDbWallMs','authExpiresAt']);
  if (gateway) for (const key of ['eligible','queueTruncated','lagTruncated','paymentTruncated','orphanTruncated','canExecute','writerReady']) gateway[key] = value.gateway[key] === true;
  const lastExecution = pickNumbers(value.lastExecution, ['cpuUserMicros','cpuSystemMicros','wallMs','rssBytes','heapUsedBytes','finishedAt']);
  if (lastExecution) Object.assign(lastExecution, { gcMs: null, gcObserved: false });
  return { uptimeMs: number(value.uptimeMs), counters, gateway, lastExecution,
    gatewaySampleAgeMs: number(value.gatewaySampleAgeMs), lastExecutionSampleAgeMs: number(value.lastExecutionSampleAgeMs),
    workerRestartsObserved: value.workerRestartsObserved === true, workerRestartsLowerBound: number(value.workerRestartsLowerBound) };
}
async function readMetrics() {
  const response = await fetch('http://127.0.0.1:9476/metrics', { redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (!response.ok || !response.body) throw new Error('metrics_unavailable');
  const reader = response.body.getReader(), chunks = []; let bytes = 0, reads = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (++reads > 4096 || bytes > 65536) throw new Error('metrics_bound'); chunks.push(chunk.value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return safeMetrics(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
async function main() {
  let stopping = false; const stop = () => { stopping = true; }; process.on('SIGTERM', stop); process.on('SIGINT', stop);
  while (!stopping) {
    let snapshot;
    try { snapshot = { state: 'observed', asOf: Date.now(), metrics: await readMetrics() }; }
    catch { snapshot = { state: 'unavailable', asOf: Date.now(), reason: 'bounded_loopback_metrics_read_failed' }; }
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text) > 65536) throw new Error('metrics_file_bound');
    await writeFile('/tmp/metrics.next', text, { mode: 0o600 }); await rename('/tmp/metrics.next', '/tmp/metrics.json');
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('metrics_collector_failed'); process.exitCode = 1; });
