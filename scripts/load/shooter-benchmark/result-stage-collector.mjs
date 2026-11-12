// Disposable CI diagnostics only. Raw Docker output never leaves the bounded
// line buffers; only the closed marker DTO is retained or returned.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PREFIX, STAGES } from './result-stage-schema.mjs';

export const LIMITS = Object.freeze({ lineBytes: 16384, lines: 8192, scanBytes: 16777216, records: 1024, outputBytes: 262144, timeoutMs: 3000 });
const REASONS = ['complete','not_enabled','invalid_container','spawn_failure','docker_failure','collection_timeout','scan_bound','line_bound'];
const enabled = () => process.env.GITHUB_ACTIONS === 'true' && process.env.HUB_SHOOTER_FIXTURE === 'benchmark' && process.env.SHOOTER_BENCHMARK_RESULT_TRACE === '1';

export function createResultStageParser() {
  const streams = new Map(['stdout','stderr'].map(key => [key, { buffer: Buffer.alloc(LIMITS.lineBytes), size: 0, oversized: false }]));
  const records = [];
  const counts = { scannedBytes: 0, lines: 0, oversizedLines: 0, rejectedLines: 0, acceptedRecords: 0, droppedRecords: 0 };
  let scanLimited = false, lineLimited = false;
  function line(stream) {
    counts.lines++;
    if (stream.oversized) counts.oversizedLines++;
    else if (stream.size === 0) counts.rejectedLines++;
    else {
      let outer;
      try { outer = JSON.parse(stream.buffer.subarray(0, stream.size).toString('utf8')); } catch { /* No raw error retained. */ }
      const message = outer && typeof outer === 'object' && !Array.isArray(outer) && Object.hasOwn(outer, 'msg') ? outer.msg : null;
      const parts = typeof message === 'string' ? message.split('|') : [];
      if (parts.length === 5 && parts[0] === PREFIX && /^[0-9a-f]{64}$/.test(parts[1]) && STAGES.includes(parts[2])
        && /^(0|[1-9][0-9]{0,15})$/.test(parts[3]) && /^(0|[1-9][0-9]{0,15})$/.test(parts[4])
        && Number.isSafeInteger(Number(parts[3])) && Number.isSafeInteger(Number(parts[4]))) {
        const startedWallMs = Number(parts[3]), observedWallMs = Number(parts[4]);
        records.push({ traceTag: parts[1], stage: parts[2], startedWallMs, observedWallMs,
          elapsedMs: observedWallMs >= startedWallMs ? observedWallMs - startedWallMs : null,
          clockReason: observedWallMs >= startedWallMs ? null : 'server_wall_clock_rollback' });
        counts.acceptedRecords++;
        if (records.length > LIMITS.records) { records.shift(); counts.droppedRecords++; }
      } else counts.rejectedLines++;
    }
    stream.size = 0; stream.oversized = false;
    if (counts.lines >= LIMITS.lines) lineLimited = true;
  }
  function push(chunk, source = 'stdout') {
    if (scanLimited || lineLimited) return false;
    const stream = streams.get(source);
    if (!stream || !Buffer.isBuffer(chunk)) throw new Error('result_stage_chunk_shape');
    const remaining = LIMITS.scanBytes - counts.scannedBytes;
    const length = Math.min(chunk.length, remaining);
    let at = 0;
    while (at < length) {
      const newline = chunk.indexOf(10, at), stop = newline === -1 || newline >= length ? length : newline, size = stop - at;
      if (!stream.oversized) {
        if (stream.size + size > LIMITS.lineBytes) { stream.size = 0; stream.oversized = true; }
        else { chunk.copy(stream.buffer, stream.size, at, stop); stream.size += size; }
      }
      at = stop;
      if (at < length) { line(stream); at++; if (lineLimited) break; }
    }
    counts.scannedBytes += at;
    if (lineLimited) return false;
    if (length < chunk.length || counts.scannedBytes >= LIMITS.scanBytes) { scanLimited = true; return false; }
    return true;
  }
  function finish(reason = 'complete') {
    if (!REASONS.includes(reason)) throw new Error('result_stage_reason_shape');
    // A scan-limit prefix is never promoted to a complete line.
    for (const stream of streams.values()) {
      if (!scanLimited && !lineLimited && (stream.size || stream.oversized)) line(stream);
      stream.size = 0; stream.oversized = false;
    }
    if (scanLimited) reason = 'scan_bound';
    if (lineLimited) reason = 'line_bound';
    const project = () => ({ version: 1, observer: 'ci_result_stage_v1', state: reason === 'complete' ? 'observed' : 'unavailable', reason,
      clockDomain: 'nakama_goja_Date_now_server_wall_only', scope: 'last4096Dockerloglines_only; earlier_history_omission_unknown; synthetic_trace_only; no_CPU_or_client_clock_alignment_or_HTTP_flush_proof',
      tailLinesRequested: 4096, truncated: scanLimited || lineLimited || counts.droppedRecords > 0 || counts.oversizedLines > 0, counts: { ...counts }, records: records.map(row => ({ ...row })) });
    let result = project();
    while (Buffer.byteLength(JSON.stringify(result)) > LIMITS.outputBytes && records.length) { records.shift(); counts.droppedRecords++; result = project(); }
    return result;
  }
  return { push, finish };
}

export async function collectResultStages(containerId, { spawnImpl = spawn } = {}) {
  const parser = createResultStageParser();
  if (!enabled()) return parser.finish('not_enabled');
  if (typeof containerId !== 'string' || !/^[0-9a-f]{64}$/.test(containerId)) return parser.finish('invalid_container');
  return new Promise(resolve => {
    let child, timer, settled = false;
    const finish = (reason, stop = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (child) {
        child.stdout?.removeAllListeners('data'); child.stderr?.removeAllListeners('data');
        if (stop) { try { child.kill('SIGKILL'); } catch { /* Never expose raw errors. */ } }
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.();
      }
      resolve(parser.finish(reason));
    };
    timer = setTimeout(() => finish('collection_timeout', true), LIMITS.timeoutMs);
    try {
      child = spawnImpl('docker', ['logs', '--tail', '4096', containerId], { stdio: ['ignore','pipe','pipe'], shell: false });
      const consume = source => chunk => { try { if (!parser.push(chunk, source)) finish('scan_bound', true); } catch { finish('docker_failure', true); } };
      child.stdout.on('data', consume('stdout')); child.stderr.on('data', consume('stderr'));
      child.stdout.on('error', () => finish('docker_failure', true)); child.stderr.on('error', () => finish('docker_failure', true));
      child.once('error', () => finish('spawn_failure', true));
      child.once('close', code => finish(code === 0 ? 'complete' : 'docker_failure'));
    } catch { finish('spawn_failure', true); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectResultStages(process.argv[2]).then(value => { process.stdout.write(JSON.stringify(value) + '\n'); })
    .catch(() => { process.stdout.write(JSON.stringify(createResultStageParser().finish('docker_failure')) + '\n'); process.exitCode = 1; });
}
