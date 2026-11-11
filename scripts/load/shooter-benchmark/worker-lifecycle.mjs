// Disposable Actions control plane only. Never reads a checkpoint or creates a
// principal, alters a lease/fence, resets data, or sends a normal SIGKILL.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { APPROVED } from '../../../services/shooter-verifier/src/approved.mjs';
const exec = promisify(execFile);
const COMPOSE = ['-f', 'server/docker-compose.yml', '-f', 'services/shooter-verifier/ops/compose.ci.yml', '-f', 'scripts/load/shooter-benchmark/compose.ci.yml', '--profile', 'shooter-verification'];
const CREDENTIAL = '/run/secrets/shooter-worker.json';
const JOURNAL = '/var/lib/shooter-journal';
const SOCKET = '/var/run/docker.sock';
const STARTUP_MS = 5000, OBSERVE_MS = 5000, COORDINATOR_DRAIN_MS = 40000, DAEMON_DRAIN_MS = 25000;
const hash = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class WorkerLifecycleFailure extends Error {
  constructor(reason) { super(reason); this.name = 'WorkerLifecycleFailure'; this.reason = reason; }
}
const fail = reason => { throw new WorkerLifecycleFailure(reason); };
function remaining(deadline, cap = 2000) {
  const value = Math.floor(deadline - performance.now());
  if (value <= 0) fail('worker_lifecycle_deadline');
  return Math.min(value, cap);
}
function live(signal) { if (signal?.aborted) fail('worker_lifecycle_aborted'); }
async function pause(signal, deadline) {
  live(signal); const ms = Math.min(50, remaining(deadline));
  await new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new WorkerLifecycleFailure('worker_lifecycle_aborted')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
async function docker(args, signal, deadline, cap = 2000) {
  live(signal);
  try {
    const value = await exec('docker', args, { signal, timeout: remaining(deadline, cap), killSignal: 'SIGTERM', maxBuffer: 65536, encoding: 'utf8' });
    live(signal); return value.stdout.trim();
  } catch { fail(signal?.aborted ? 'worker_lifecycle_aborted' : 'worker_lifecycle_docker_observation_failed'); }
}
async function boundedRead(callback, signal, deadline) {
  live(signal); const timeout = remaining(deadline);
  const local = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  let timer;
  try { return await Promise.race([callback(local), new Promise((_, reject) => { timer = setTimeout(() => reject(new WorkerLifecycleFailure('worker_lifecycle_observation_timeout')), timeout); })]); }
  catch { fail(signal?.aborted ? 'worker_lifecycle_aborted' : 'worker_lifecycle_observation_failed'); }
  finally { clearTimeout(timer); }
}
// Only HEAD metadata is requested from the local daemon. No archive or private
// file body is downloaded, including while the coordinator is stopped.
async function pathMetadata(container, path, signal, deadline) {
  live(signal);
  return new Promise((resolve, reject) => {
    const timeout = remaining(deadline);
    const request = http.request({ socketPath: SOCKET, agent: false, method: 'HEAD', path: `/containers/${container}/archive?path=${encodeURIComponent(path)}`, timeout, maxHeaderSize: 8192 }, response => {
      response.resume();
      if (response.statusCode === 404) { resolve(null); return; }
      const encoded = response.headers['x-docker-container-path-stat'];
      if (response.statusCode !== 200 || typeof encoded !== 'string' || encoded.length > 4096) { reject(new WorkerLifecycleFailure('worker_lifecycle_path_metadata_failed')); return; }
      try {
        const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        if (!object(value) || !integer(value.size) || !integer(value.mode)) throw new Error();
        resolve({ size: value.size, mode: value.mode, link: typeof value.linkTarget === 'string' && value.linkTarget.length > 0 });
      } catch { reject(new WorkerLifecycleFailure('worker_lifecycle_path_metadata_failed')); }
    });
    const abort = () => request.destroy();
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', () => reject(new WorkerLifecycleFailure(signal?.aborted ? 'worker_lifecycle_aborted' : 'worker_lifecycle_path_metadata_failed')));
    request.once('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
    request.end();
  });
}
const INSPECT = '{"id":{{json .Id}},"image":{{json .Image}},"pid":{{json .State.Pid}},"running":{{json .State.Running}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}},"startedAt":{{json .State.StartedAt}},"resources":{"memory":{{json .HostConfig.Memory}},"memorySwap":{{json .HostConfig.MemorySwap}},"pids":{{json .HostConfig.PidsLimit}},"cpus":{{json .HostConfig.NanoCpus}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"network":{{json .HostConfig.NetworkMode}},"caps":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"ulimits":{{json .HostConfig.Ulimits}}}}';
function resourceContract(role, value, nakama) {
  const r = value.resources, replay = role === 'replay';
  if (!object(r) || r.memory !== (replay ? 512 : 384) * 1024 * 1024 || r.memorySwap !== r.memory || r.pids !== (replay ? 32 : 24)
    || r.cpus !== (replay ? 2 : 1) * 1e9 || r.readonly !== true || r.network !== (replay ? 'none' : `container:${nakama}`)
    || !Array.isArray(r.caps) || r.caps.length !== 1 || r.caps[0] !== 'ALL'
    || !Array.isArray(r.security) || !r.security.some(s => s === 'no-new-privileges' || s === 'no-new-privileges:true')
    || !Array.isArray(r.ulimits) || !r.ulimits.some(s => s.Name === 'core' && s.Soft === 0 && s.Hard === 0)) fail('worker_lifecycle_resource_contract_changed');
}
function safeDaemon(value) {
  if (!object(value) || !object(value.health) || !object(value.metrics)) fail('worker_lifecycle_daemon_observation_failed');
  const h = value.health, m = value.metrics, age = Date.now() - h.asOf;
  if (h.kind !== 'health' || h.ready !== true || h.draining !== false || typeof h.instanceId !== 'string' || !/^[0-9a-f-]{36}$/.test(h.instanceId)
    || !Number.isFinite(age) || age < 0 || age >= 15000 || !object(h.manifest) || Object.keys(h.manifest).length !== Object.keys(APPROVED).length
    || Object.entries(APPROVED).some(([key, entry]) => h.manifest[key] !== entry)
    || m.instanceId !== h.instanceId || m.busy !== false || !['requests', 'completed', 'processStarts', 'restarts', 'operationalFailures'].every(key => integer(m[key]))) fail('worker_lifecycle_daemon_not_quiescent');
  return { daemonInstanceId: h.instanceId, requests: m.requests, completed: m.completed, processStarts: m.processStarts, restarts: m.restarts, operationalFailures: m.operationalFailures };
}
function coordinatorContract(health, metrics, startedAt) {
  const age = Date.now() - health?.asOf, uptimeBound = Date.now() - Date.parse(startedAt) + 1000;
  if (!object(health) || health.ready !== true || health.busy !== false || health.blocked !== false || health.draining !== false || health.journalPhase !== null
    || health.gatewayObservationCurrent !== true || health.asOf < Date.parse(startedAt) || !Number.isFinite(age) || age < 0 || age >= 15000 || !object(metrics)
    || !Number.isFinite(metrics.uptimeMs) || metrics.uptimeMs < 0 || metrics.uptimeMs > uptimeBound
    || !Number.isFinite(metrics.gatewaySampleAgeMs) || metrics.gatewaySampleAgeMs < 0 || metrics.gatewaySampleAgeMs >= 15000 || !object(metrics.gateway)
    || metrics.gateway.queueDepth !== 0 || metrics.gateway.queueTruncated !== false || metrics.gateway.acceptedVerifiedLagTicks !== 0
    || metrics.gateway.eligibilityUnknown !== false || metrics.gateway.eligible !== false) fail('worker_lifecycle_coordinator_not_quiescent');
  return { pendingPaymentProofsApproximate: integer(metrics.gateway.paymentPending) ? metrics.gateway.paymentPending : null, pendingPaymentProofsTruncated: metrics.gateway.paymentTruncated === true };
}
// Natural recycling is a supported16-completed-call policy, not a new cold phase.
// These counters establish an exact fraction only in a failure-free pool epoch.
export function replayReuseEvidence(before, after) {
  if (!object(before) || !object(after) || before.daemonInstanceId !== after.daemonInstanceId
    || !['completed', 'processStarts', 'requests', 'restarts', 'operationalFailures'].every(key => integer(before[key]) && integer(after[key]))
    || typeof before.workerInstance !== 'string' || typeof after.workerInstance !== 'string'
    || after.completed < before.completed || after.requests < before.requests || after.processStarts < before.processStarts
    || before.requests !== before.completed || after.requests !== after.completed || before.operationalFailures !== 0 || after.operationalFailures !== 0
    || before.restarts !== before.processStarts - 1 || after.restarts !== after.processStarts - 1) fail('worker_lifecycle_unobserved_pool_epoch');
  const operations = after.completed - before.completed, naturalRecycles = after.processStarts - before.processStarts;
  if ((naturalRecycles === 0) !== (before.workerInstance === after.workerInstance)) fail('worker_lifecycle_unobserved_child_identity');
  if (naturalRecycles !== Math.floor(after.completed / 16) - Math.floor(before.completed / 16)) fail('worker_lifecycle_unexplained_child_restart');
  const coldFirstOperations = operations ? Math.floor((after.completed - 1) / 16) - Math.floor((before.completed - 1) / 16) : 0;
  return { operations, coldFirstOperations, reusedOperations: operations - coldFirstOperations, reusedFraction: operations ? (operations - coldFirstOperations) / operations : null,
    naturalRecycles, initialChildPreviouslyUsed: before.completed % 16 !== 0, firstOperation: operations ? (before.completed % 16 ? 'observed_reused_child' : 'first_operation_in_child') : 'not_observed', osPageCache: 'unknown' };
}
export function createWorkerLifecycle({ composeArgs, readHealth, readMetrics, credentialPath = CREDENTIAL, journalDirectory = JOURNAL } = {}) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark'
    || (process.env.NAKAMA_URL || 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350'
    || process.env.DOCKER_HOST && process.env.DOCKER_HOST !== `unix://${SOCKET}`
    || !Array.isArray(composeArgs) || JSON.stringify(composeArgs) !== JSON.stringify(COMPOSE)
    || typeof readHealth !== 'function' || typeof readMetrics !== 'function' || credentialPath !== CREDENTIAL || journalDirectory !== JOURNAL) fail('worker_lifecycle_unsupported_profile');
  let identities, serverEpoch, credentialDigest, configurationDigest, last, active;
  const compose = (args, signal, deadline) => docker(['compose', ...COMPOSE, ...args], signal, deadline);
  async function ids(signal, deadline) {
    const result = {};
    for (const role of ['nakama', 'postgres', 'coordinator', 'replay']) {
      result[role] = await compose(['ps', '-a', '-q', role], signal, deadline);
      if (!/^[0-9a-f]{64}$/.test(result[role])) fail('worker_lifecycle_container_identity_unavailable');
    }
    if (identities && Object.keys(result).some(role => result[role] !== identities[role])) fail('worker_lifecycle_container_was_replaced');
    identities ||= result; return result;
  }
  async function journalAbsent(signal, deadline) {
    for (const name of ['current.json', 'current.next']) if (await pathMetadata(identities.coordinator, `${JOURNAL}/${name}`, signal, deadline)) fail('worker_lifecycle_private_journal_pending');
    const dir = await pathMetadata(identities.coordinator, JOURNAL, signal, deadline);
    if (!dir || dir.link || (dir.mode & 0o777) !== 0o700) fail('worker_lifecycle_private_journal_permissions');
  }
  async function inspect(role, signal, deadline) {
    let value;try { value = JSON.parse(await docker(['inspect', '--format', INSPECT, identities[role]], signal, deadline)); } catch { fail('worker_lifecycle_container_observation_failed'); }
    if (value.id !== identities[role] || value.running !== true || value.oomKilled !== false || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) fail('worker_lifecycle_container_not_running');
    resourceContract(role, value, identities.nakama); return value;
  }
  async function snapshot(signal, deadline) {
    const context = await docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'], signal, deadline);
    if (context !== `unix://${SOCKET}`) fail('worker_lifecycle_remote_docker_unsupported');
    await ids(signal, deadline);
    const servers = (await docker(['inspect', '--format', '{"id":{{json .Id}},"running":{{json .State.Running}},"pid":{{json .State.Pid}},"startedAt":{{json .State.StartedAt}}}', identities.nakama, identities.postgres], signal, deadline)).split('\n');
    let epochs;try { epochs = servers.map(line => JSON.parse(line)); } catch { fail('worker_lifecycle_server_observation_failed'); }
    if (epochs.length !== 2 || epochs.some((entry, index) => entry.id !== identities[index ? 'postgres' : 'nakama'] || entry.running !== true || !Number.isSafeInteger(entry.pid) || entry.pid <= 0 || !Number.isFinite(Date.parse(entry.startedAt)))) fail('worker_lifecycle_server_observation_failed');
    const currentEpoch = hash(JSON.stringify(epochs));
    if (serverEpoch && currentEpoch !== serverEpoch) fail('worker_lifecycle_hub_or_database_restarted');serverEpoch ||= currentEpoch;
    const coordinator = await inspect('coordinator', signal, deadline), replay = await inspect('replay', signal, deadline);
    const digest = (await docker(['exec', identities.coordinator, 'sha256sum', CREDENTIAL], signal, deadline)).split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/.test(digest)) fail('worker_lifecycle_credential_observation_failed');
    if (credentialDigest && digest !== credentialDigest) fail('worker_lifecycle_credentials_changed'); credentialDigest ||= digest;
    await journalAbsent(signal, deadline);
    const names = await docker(['exec', identities.coordinator, 'find', JOURNAL, '-mindepth', '1', '-maxdepth', '1', '-printf', '%f\\0'], signal, deadline);
    if (names !== 'coordinator.lock\0') fail('worker_lifecycle_unknown_journal_evidence');
    const script = "import{UnixReplayClient}from'/app/services/shooter-verifier/ops/unix-client.mjs';let metrics;const health=await new UnixReplayClient({timeoutMs:1000,onMetrics:v=>{metrics=v}}).health();process.stdout.write(JSON.stringify({health,metrics}));";
    let raw;try { raw = JSON.parse(await docker(['exec', identities.replay, 'node', '--input-type=module', '-e', script], signal, deadline)); } catch { fail('worker_lifecycle_daemon_observation_failed'); }
    const daemon = safeDaemon(raw);
    const top = await docker(['top', identities.replay, '-eo', 'pid,args'], signal, deadline);
    const workers = top.split('\n').flatMap(line => { const match = line.trim().match(/^(\d+)\s+(.*)$/);return match && match[2].split(/\s+/).includes('/app/services/shooter-verifier/src/worker.mjs') ? [match[1]] : []; });
    if (workers.length !== 1) fail('worker_lifecycle_child_identity_unavailable');
    let stat;try { stat = await readFile(`/proc/${workers[0]}/stat`, 'utf8'); } catch { fail('worker_lifecycle_child_identity_unavailable'); }
    if (stat.length > 4096) fail('worker_lifecycle_child_identity_unavailable');
    const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    if (!/^[0-9]{1,20}$/.test(ticks || '')) fail('worker_lifecycle_child_identity_unavailable');
    const [health, metrics] = await Promise.all([boundedRead(readHealth, signal, deadline), boundedRead(readMetrics, signal, deadline)]);
    live(signal);
    const payment = coordinatorContract(health, metrics, coordinator.startedAt);
    const config = hash(JSON.stringify({ coordinator: { image: coordinator.image, resources: coordinator.resources }, replay: { image: replay.image, resources: replay.resources } }));
    if (configurationDigest && config !== configurationDigest) fail('worker_lifecycle_configuration_changed'); configurationDigest ||= config;
    return { ...daemon, ...payment, coordinatorInstance: hash(`${identities.coordinator}:${coordinator.pid}:${coordinator.startedAt}`), workerInstance: hash(`${identities.replay}:${workers[0]}:${ticks}`), workerStartTicks: ticks, workerStartClock: 'host_boot_clock_ticks', configurationSha256: config };
  }
  async function settled(signal, deadline) {
    let error;
    const permanent = new Set(['worker_lifecycle_credentials_changed', 'worker_lifecycle_configuration_changed', 'worker_lifecycle_container_was_replaced', 'worker_lifecycle_remote_docker_unsupported', 'worker_lifecycle_unknown_journal_evidence', 'worker_lifecycle_private_journal_permissions', 'worker_lifecycle_resource_contract_changed', 'worker_lifecycle_hub_or_database_restarted']);
    while (performance.now() < deadline) {
      try { return await snapshot(signal, deadline); }
      catch (caught) { error = caught;live(signal);if (permanent.has(caught.reason)) throw caught; }
      if (deadline - performance.now() <= 1) break;
      try { await pause(signal, deadline); } catch (caught) { live(signal);if (caught.reason !== 'worker_lifecycle_deadline') throw caught;break; }
    }
    throw error instanceof WorkerLifecycleFailure ? error : new WorkerLifecycleFailure('worker_lifecycle_not_quiescent');
  }
  async function stop(role, budget, signal) {
    const started = performance.now(), deadline = started + budget;
    await docker(['kill', '--signal', 'TERM', identities[role]], signal, deadline);
    const code = await docker(['wait', identities[role]], signal, deadline, remaining(deadline, budget));
    if (code !== '0' || performance.now() - started > budget) fail('worker_lifecycle_unclean_drain');
    return performance.now() - started;
  }
  return {
    async prepareCold(signal) {
      if (active) fail('worker_lifecycle_previous_phase_not_observed');
      const before = await settled(signal, performance.now() + OBSERVE_MS);
      const coordinatorDrainMs = await stop('coordinator', COORDINATOR_DRAIN_MS, signal);
      await journalAbsent(signal, performance.now() + 2000);
      const daemonDrainMs = await stop('replay', DAEMON_DRAIN_MS, signal);
      const started = performance.now(), deadline = started + STARTUP_MS;
      await docker(['start', identities.replay], signal, deadline);
      await docker(['start', identities.coordinator], signal, deadline);
      const after = await settled(signal, deadline);
      if (after.daemonInstanceId === before.daemonInstanceId || after.workerInstance === before.workerInstance || after.coordinatorInstance === before.coordinatorInstance
        || after.requests !== 0 || after.completed !== 0 || after.processStarts !== 1 || after.restarts !== 0) fail('worker_lifecycle_cold_start_not_observed');
      last = after;active = { kind: 'cold', before: after };
      return { kind: 'cold_process_start', startupWallMs: performance.now() - started, startupWallClock: 'load_generator_monotonic', startupWallDefinition: 'start_existing_worker_services_to_observed_quiescent_readiness', coordinatorDrainMs, daemonDrainMs, daemonInstanceId: after.daemonInstanceId,
        workerInstance: after.workerInstance, workerStartTicks: after.workerStartTicks, workerStartClock: after.workerStartClock, sameContainers: true, sameCredentials: true,
        journalEmpty: true, serverPaymentProofsRetained: true, pendingPaymentProofsApproximate: after.pendingPaymentProofsApproximate, pendingPaymentProofsTruncated: after.pendingPaymentProofsTruncated,
        firstOperation: 'not_yet_observed', osPageCache: 'unknown', configurationSha256: after.configurationSha256 };
    },
    async assertWarm(signal) {
      if (!last || active || last.completed === 0) fail('worker_lifecycle_warm_without_observed_predecessor');
      const before = await settled(signal, performance.now() + OBSERVE_MS);
      if (before.daemonInstanceId !== last.daemonInstanceId || before.coordinatorInstance !== last.coordinatorInstance || before.workerInstance !== last.workerInstance
        || before.completed !== last.completed || before.processStarts !== last.processStarts) fail('worker_lifecycle_unobserved_interphase_change');
      active = { kind: 'warm', before };
      return { kind: 'warm_observed_start', daemonInstanceId: before.daemonInstanceId, workerInstance: before.workerInstance, workerStartTicks: before.workerStartTicks,
        firstOperation: before.completed % 16 ? 'observed_reused_child' : 'fresh_after_supported_natural_recycle', sameCredentials: true, journalEmpty: true, osPageCache: 'unknown' };
    },
    async observe(signal) {
      const after = await settled(signal, performance.now() + OBSERVE_MS);
      if (!active) { last = after;return { kind: 'worker_process_observation', daemonInstanceId: after.daemonInstanceId, workerInstance: after.workerInstance, completed: after.completed, processStarts: after.processStarts, osPageCache: 'unknown' }; }
      if (active.before.coordinatorInstance !== after.coordinatorInstance) fail('worker_lifecycle_unobserved_coordinator_restart');
      const evidence = replayReuseEvidence(active.before, after);
      const result = { kind: 'observed_worker_process_usage', phase: active.kind, ...evidence, startWorkerInstance: active.before.workerInstance, endWorkerInstance: after.workerInstance,
        daemonInstanceId: after.daemonInstanceId, workerStartTicks: after.workerStartTicks, serverPaymentProofsRetained: true, pendingPaymentProofsApproximate: after.pendingPaymentProofsApproximate, pendingPaymentProofsTruncated: after.pendingPaymentProofsTruncated };
      last = after;active = null;return result;
    },
  };
}
