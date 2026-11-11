import { readFile } from 'node:fs/promises';
import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { quantiles, unobserved, type Measurement } from './contracts.ts';

async function optionalFile(path: string): Promise<string | null> {
  try { return (await readFile(path, 'utf8')).trim(); } catch { return null; }
}
export async function hostObservation(): Promise<Record<string, unknown>> {
  const [cpuMax, cpuset, memoryMax, pidsMax, membership] = await Promise.all([
    optionalFile('/sys/fs/cgroup/cpu.max'), optionalFile('/sys/fs/cgroup/cpuset.cpus.effective'),
    optionalFile('/sys/fs/cgroup/memory.max'), optionalFile('/sys/fs/cgroup/pids.max'), optionalFile('/proc/self/cgroup'),
  ]);
  return { roles: ['load_generator'], region: null, regionEvidence: null,
    cpu: { model: cpus()[0]?.model ?? null, visibleVcpus: cpus().length },
    memory: { hostVisibleBytes: totalmem() },
    cgroup: { cpuMax, cpuset, memoryMax, pidsMax, membership, scope: 'load_generator_only_not_server' },
    os: { platform: platform(), kernel: release(), node: process.version },
    observationAvailability: { serverCpu: false, region: false, gc: false },
  };
}
// Container control/inspection remains in the trusted CI harness. Never pass its
// environment or mounted filesystem to the credential-free replay daemon.
export interface ServerSample {
  role: 'nakama' | 'postgres' | 'coordinator' | 'verifier';
  observedAt: string;
  cpuUserMicros: number | null;
  cpuSystemMicros: number | null;
  rssBytes: number | null;
  cgroupCpuUsageMicros: number | null;
  cgroupMemoryBytes: number | null;
  gcMs: number | null;
  unavailableReason: string | null;
}
export interface CoordinatorMetrics {
  uptimeMs: number;
  counters: Record<string, number>;
  lastExecution: { cpuUserMicros: number | null; cpuSystemMicros: number | null; wallMs: number | null; rssBytes: number | null; heapUsedBytes: number | null; gcMs: null; gcObserved: false } | null;
  gateway: { observedAt: number; queueDepth: number | null; queueTruncated: boolean; oldestQueueAgeMs: number | null; paymentPending: number | null; paymentTruncated: boolean; orphanPending: number | null; orphanTruncated: boolean; opsDbWallMs: number | null } | null;
}
export async function coordinatorSample(base: string, signal: AbortSignal): Promise<{ wallMs: number; metrics: CoordinatorMetrics }> {
  const url = new URL('/metrics', base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('metrics must remain unpublished loopback HTTP');
  const start = performance.now();
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error' });
  if (!response.ok) throw new Error(`metrics HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('metrics response has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65536) throw new Error('metrics response exceeds bound');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const metrics = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CoordinatorMetrics;
  if (!Number.isFinite(metrics.uptimeMs) || !metrics.counters || Object.values(metrics.counters).some(n => !Number.isFinite(n) || n < 0)) throw new Error('invalid safe metrics');
  return { wallMs: performance.now() - start, metrics };
}
export function latencyObservations(browserFrames: readonly number[], matchTicks: readonly number[]): Record<string, Measurement> {
  return {
    clientFrame: quantiles(browserFrames, 'ms', 'actual_game_browser_frame_observer'),
    matchTick: quantiles(matchTicks, 'ms', 'actual_shooter_metrics_rpc'),
    gc: unobserved('ms', 'runtime_gc', 'runtime GC observer not installed; wall pauses are not GC measurements'),
    sql: unobserved('ms', 'postgres_statement_observer', 'SQL statement durations not observed; RPC RTT is separate'),
  };
}
