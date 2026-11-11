// Trusted ephemeral-CI observer. This code stays outside the offline verifier;
// it receives only allowlisted container IDs and never reads container Env/logs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export type ServerRole = 'nakama' | 'postgres' | 'coordinator' | 'verifier' | 'observer';
export interface CgroupSample {
  role: ServerRole;
  observedAt: string;
  cpuUsageMicros: number | null;
  cpuUserMicros: number | null;
  cpuSystemMicros: number | null;
  throttledMicros: number | null;
  memoryCurrentBytes: number | null;
  memoryPeakBytes: number | null;
  oomKills: number | null;
  pidCurrent: number | null;
  pidsDenied: number | null;
  unavailableReason: string | null;
}
// Fixed script, no interpolated request/body/path. Missing cgroup-v2 files are
// reported unavailable rather than turning host-visible memory into a quota.
const READ_CGROUP = `for f in cpu.stat memory.current memory.peak memory.events pids.current pids.events; do
  printf '\\nBENCH_FILE %s\\n' "$f"
  cat "/sys/fs/cgroup/$f" 2>/dev/null || true
done`;
export function parseCgroup(role: ServerRole, text: string, observedAt: string): CgroupSample {
  if (Buffer.byteLength(text) > 16384) throw new Error('cgroup observation exceeds bound');
  const files = new Map<string, string>();
  let name: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('BENCH_FILE ')) { name = line.slice(11); files.set(name, ''); }
    else if (name) files.set(name, `${files.get(name)}${line}\n`);
  }
  const numeric = (value: string | undefined): number | null => {
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim()); return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const fields = (file: string): Map<string, string> => new Map((files.get(file) ?? '').trim().split('\n').map(line => { const [key, value] = line.trim().split(/\s+/); return [key, value]; }));
  const cpu = fields('cpu.stat'), memory = fields('memory.events'), pids = fields('pids.events');
  const result: CgroupSample = { role, observedAt,
    cpuUsageMicros: numeric(cpu.get('usage_usec')), cpuUserMicros: numeric(cpu.get('user_usec')), cpuSystemMicros: numeric(cpu.get('system_usec')), throttledMicros: numeric(cpu.get('throttled_usec')),
    memoryCurrentBytes: numeric(files.get('memory.current')), memoryPeakBytes: numeric(files.get('memory.peak')), oomKills: numeric(memory.get('oom_kill')), pidCurrent: numeric(files.get('pids.current')), pidsDenied: numeric(pids.get('max')),
    unavailableReason: null,
  };
  if (result.cpuUsageMicros === null || result.memoryCurrentBytes === null) result.unavailableReason = 'cgroup_v2_counter_unavailable';
  return result;
}
export async function observeContainer(role: ServerRole, containerId: string): Promise<CgroupSample> {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('container observer restricted to ephemeral Actions lane');
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('full container ID required');
  const observedAt = new Date().toISOString();
  try {
    const { stdout } = await exec('docker', ['exec', containerId, 'sh', '-c', READ_CGROUP], { timeout: 5000, maxBuffer: 16384, encoding: 'utf8' });
    return parseCgroup(role, stdout, observedAt);
  } catch {
    return { role, observedAt, cpuUsageMicros: null, cpuUserMicros: null, cpuSystemMicros: null, throttledMicros: null, memoryCurrentBytes: null, memoryPeakBytes: null, oomKills: null, pidCurrent: null, pidsDenied: null, unavailableReason: 'bounded_container_observer_failed' };
  }
}
export function cpuDelta(before: CgroupSample, after: CgroupSample, knownEpochChange = false): { cpuSeconds: number | null; wallSeconds: number; unavailableReason: string | null } {
  const wallSeconds = (Date.parse(after.observedAt) - Date.parse(before.observedAt)) / 1000;
  if (before.role !== after.role || !Number.isFinite(wallSeconds) || wallSeconds < 0) throw new Error('incomparable server samples');
  if (knownEpochChange) return { cpuSeconds: null, wallSeconds, unavailableReason: 'controlled restart changes cgroup counter epoch; raw samples retained without cross-epoch subtraction' };
  if (before.cpuUsageMicros === null || after.cpuUsageMicros === null) return { cpuSeconds: null, wallSeconds, unavailableReason: 'CPU counter unavailable' };
  if (after.cpuUsageMicros < before.cpuUsageMicros) return { cpuSeconds: null, wallSeconds, unavailableReason: 'counter reset or container restart' };
  return { cpuSeconds: (after.cpuUsageMicros - before.cpuUsageMicros) / 1000000, wallSeconds, unavailableReason: null };
}
export interface ContainerLimits {
  role: ServerRole;
  cpuMax: string | null;
  cpuset: string | null;
  memoryMax: string | null;
  pidsMax: string | null;
  unavailableReason: string | null;
}
export function parseLimits(role: ServerRole, text: string): ContainerLimits {
  if (Buffer.byteLength(text) > 4096) throw new Error('container limit observation exceeds bound');
  const entries = new Map(text.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim()]; }));
  const safe = (key: string, pattern: RegExp) => { const value = entries.get(key); return value && pattern.test(value) ? value : null; };
  const limits: ContainerLimits = { role, cpuMax: safe('cpu.max', /^(max|\d+) \d+$/), cpuset: safe('cpuset.cpus.effective', /^[0-9,-]+$/), memoryMax: safe('memory.max', /^(max|\d+)$/), pidsMax: safe('pids.max', /^(max|\d+)$/), unavailableReason: null };
  if (!limits.cpuMax || !limits.memoryMax || !limits.pidsMax) limits.unavailableReason = 'per_role_cgroup_v2_limits_unavailable';
  return limits;
}
export async function observeContainerLimits(role: ServerRole, containerId: string): Promise<ContainerLimits> {
  if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{64}$/.test(containerId)) throw new Error('ephemeral full container ID required');
  try {
    const script = `for f in cpu.max cpuset.cpus.effective memory.max pids.max; do printf '%s=' "$f"; cat "/sys/fs/cgroup/$f" 2>/dev/null || printf '\\n'; done`;
    const { stdout } = await exec('docker', ['exec', containerId, 'sh', '-c', script], { timeout: 5000, maxBuffer: 4096, encoding: 'utf8' });
    return parseLimits(role, stdout);
  } catch { return { role, cpuMax: null, cpuset: null, memoryMax: null, pidsMax: null, unavailableReason: 'bounded_container_limit_observer_failed' }; }
}
