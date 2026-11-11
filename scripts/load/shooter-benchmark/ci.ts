// Explicit disposable CI controller. No target/remote endpoint is accepted.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { psql, guest, waitReady } from '../../../server/test/dup/harness.ts';
import { makePlan, sha256, quantiles, type Corpus } from './contracts.ts';
import { hostObservation, latencyObservations } from './observers.ts';
import { observeContainer, observeContainerLimits, cpuDelta, type CgroupSample } from './container-observer.ts';
import { LegacyPipeline } from './legacy.ts';
import { PublicPipeline } from './pipeline.ts';
import { runPlan, InstrumentationFailure, SutUnavailable } from './runner.ts';
import { inputCoverage } from './coverage.ts';
import { FIXTURE_MAX_RUNS, FIXTURE_RESERVED_BYTES, assertFixtureCohortFits } from './fixture-config.ts';
import { createWorkerLifecycle } from './worker-lifecycle.mjs';
import { validateResult } from './result-validation.ts';
const exec = promisify(execFile);
const composeFiles = ['-f', 'server/docker-compose.yml', '-f', 'services/shooter-verifier/ops/compose.ci.yml', '-f', 'scripts/load/shooter-benchmark/compose.ci.yml', '--profile', 'shooter-verification'];
function directory(): string {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark') throw new Error('ephemeral benchmark fixture profile required');
  if ((process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350') throw new Error('CI benchmark permits literal loopback only');
  const value = process.env.SHOOTER_OPS_CI_DIRECTORY;
  if (!value || !isAbsolute(value) || !/^\/tmp\/shooter-benchmark-[a-zA-Z0-9_-]+$/.test(value)) throw new Error('dedicated disposable directory required');
  return value;
}
async function prepare(): Promise<void> {
  const root = directory(); await waitReady();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await Promise.all(['socket', 'journal'].map(name => mkdir(join(root, name), { recursive: true, mode: 0o700 })));
  const account = await guest(), workerId = `benchmark-${randomUUID()}`, keyId = 'ci', token = randomBytes(32).toString('base64url');
  const hash = sha256(`shooter-worker-token-v1\n${token}`);
  // Explicit finite fixture settings, recorded in the report. These values are
  // not a deployment recommendation and do not alter replay execution budgets.
  psql(`UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=${FIXTURE_MAX_RUNS},max_account_runs=1,max_global_bytes=${FIXTURE_RESERVED_BYTES},max_account_bytes=67108864,max_global_batches=262144,max_account_batches=4096,global_appends_per_minute=1000,account_appends_per_minute=100;
    UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=2,max_account_leased=1,max_jobs=128,max_account_jobs=16,max_attempts_retained=512,max_account_attempts_retained=64,max_checkpoint_bytes=536870912,max_account_checkpoint_bytes=67108864,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
    UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=10000,account_attempts_per_minute=10000,max_requests=512,max_principal_requests=512,max_receipt_bytes=33554432,max_principal_receipt_bytes=33554432;
    UPDATE game.shooter_verification_payment_config SET payments_enabled=true;
    INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${account.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at) VALUES('${account.userId}','${workerId}','${keyId}','${hash}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '90 minutes');
    UPDATE game.server_flags SET state='on',allowlist='{}',percent=0,updated_at=clock_timestamp() WHERE key='shooter_pvp'`);
  await writeFile(join(root, 'stack-identities.json'), JSON.stringify({ nakama: await compose(['ps', '-q', 'nakama']), postgres: await compose(['ps', '-q', 'postgres']) }), { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'shooter-worker.json'), JSON.stringify({ url: 'http://127.0.0.1:7350', workerId, keyId, token, accountToken: account.token }), { flag: 'wx', mode: 0o600 });
}
async function compose(args: string[]): Promise<string> {
  const { stdout } = await exec('docker', ['compose', ...composeFiles, ...args], { timeout: 10000, maxBuffer: 65536, encoding: 'utf8' }); return stdout.trim();
}
function role(service: string): import('./container-observer.ts').ServerRole {
  if (service === 'replay') return 'verifier';
  if (service === 'metrics-observer') return 'observer';
  if (service === 'nakama' || service === 'postgres' || service === 'coordinator') return service;
  throw new InstrumentationFailure('unknown_container_role');
}
async function observerFile(id: string, endpoint: 'metrics' | 'health', signal?: AbortSignal): Promise<Record<string, unknown>> {
  let stdout: string;
  try { stdout = (await exec('docker', ['exec', id, 'cat', `/tmp/${endpoint}.json`], { signal, timeout: 2000, maxBuffer: 65536, encoding: 'utf8' })).stdout; }
  catch { throw new InstrumentationFailure('metrics_collector_file_unavailable'); }
  const snapshot = JSON.parse(stdout);
  if (!Number.isFinite(snapshot.asOf) || Date.now() - snapshot.asOf > 5000 || Date.now() < snapshot.asOf) throw new InstrumentationFailure('metrics_collector_stale_or_clock_changed');
  if (snapshot.state !== 'observed') throw new SutUnavailable('coordinator_metrics_read_unavailable');
  return snapshot[endpoint];
}
const metricsFile = (id: string, signal?: AbortSignal) => observerFile(id, 'metrics', signal);
async function run(profile: 'burst' | 'lifecycle' | 'sustained' = 'burst', mode: 'bounded_v8_same_host' | 'legacy_full_goja' | 'legacy_segmented_goja' = 'bounded_v8_same_host'): Promise<void> {
  const root = directory();
  const corpusBytes = await readFile('server/test/fixtures/shooter-integration-corpus.json');
  const plan = makePlan(JSON.parse(corpusBytes.toString('utf8')) as Corpus, corpusBytes, 'ci-twenty-independent-v1', mode);
  // Separate finite CI profiles retain full hard traces. None establishes
  // intended-host capacity or authorizes a deployment/operating choice.
  plan.phases = [{ kind: 'background_baseline', waves: 0, arrivalIntervalMs: 3000 }, ...(profile === 'lifecycle' ? [{ kind: 'cold_burst' as const, waves: 1, arrivalIntervalMs: 0 }, { kind: 'warm_burst' as const, waves: 1, arrivalIntervalMs: 0 }] : profile === 'sustained' ? [{ kind: 'sustained' as const, waves: 3, arrivalIntervalMs: 30000 }] : [{ kind: mode === 'bounded_v8_same_host' ? 'retry_storm' as const : 'finish_burst' as const, waves: 1, arrivalIntervalMs: 0 }]), { kind: 'drain', waves: 0, arrivalIntervalMs: 5000 }];
  assertFixtureCohortFits(plan.actorsPerWave, plan.phases.reduce((sum, phase) => sum + phase.waves, 0));
  const ids = new Map<string, string>();
  for (const service of ['nakama', 'postgres', 'coordinator', 'replay', 'metrics-observer']) {
    const id = await compose(['ps', '-q', service]);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('missing actual container identity'); ids.set(service, id);
  }
  const originalIds = JSON.parse(await readFile(join(root, 'stack-identities.json'), 'utf8'));
  if (originalIds.nakama !== ids.get('nakama') || originalIds.postgres !== ids.get('postgres')) throw new Error('worker startup replaced the measured Hub/database');
  const readyDeadline = Date.now() + 5000;
  for (;;) { try { await metricsFile(ids.get('metrics-observer')!); break; } catch { if (Date.now() >= readyDeadline) throw new InstrumentationFailure('metrics_collector_not_ready'); await new Promise(resolve => setTimeout(resolve, 100)); } }
  const roleLimits = await Promise.all([...ids].map(([service, id]) => observeContainerLimits(role(service), id)));
  const samples: CgroupSample[] = [], queueSamples: Record<string, unknown>[] = [], checkpointSamples: { observedAt: string; sizes: Record<string, unknown>[] }[] = [];
  const lifecycle = profile === 'lifecycle' ? createWorkerLifecycle({ composeArgs: composeFiles, readHealth: signal => observerFile(ids.get('metrics-observer')!, 'health', signal), readMetrics: signal => metricsFile(ids.get('metrics-observer')!, signal) }) : undefined;
  const sampleServer = async (signal: AbortSignal) => {
    const [observed, metricsResponse, checkpoints] = await Promise.all([
      Promise.all([...ids].map(([service, id]) => observeContainer(role(service), id))),
      metricsFile(ids.get('metrics-observer')!),
      pipeline.checkpointSizes(),
    ]);
    if (signal.aborted) throw new Error('aborted');
    checkpointSamples.push({ observedAt: new Date().toISOString(), sizes: checkpoints });
    samples.push(...observed);
    if (samples.length > 10000) throw new Error('server sample bound exceeded');
    if (signal.aborted) throw new Error('aborted');
    const value = metricsResponse;
    if (!Number.isFinite(value.uptimeMs) || !value.counters) throw new Error('invalid actual coordinator metrics');
    // Keep only the reviewed safe aggregate DTO, never arbitrary RPC bodies.
    queueSamples.push({ observedAt: new Date().toISOString(), uptimeMs: value.uptimeMs, counters: value.counters, gateway: value.gateway, lastExecution: value.lastExecution, gatewaySampleAgeMs: value.gatewaySampleAgeMs, lastExecutionSampleAgeMs: value.lastExecutionSampleAgeMs });
  };
  const pipeline: PublicPipeline | LegacyPipeline = mode === 'bounded_v8_same_host' ? new PublicPipeline(plan, 'http://127.0.0.1:7350', sampleServer, lifecycle) : new LegacyPipeline(plan, 'http://127.0.0.1:7350', mode === 'legacy_segmented_goja', sampleServer);
  const result = await runPlan(plan, pipeline);
  const images = await Promise.all([...ids].map(async ([role, id]) => ({ role, digest: (await exec('docker', ['inspect', '--format', '{{.Image}}', id], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim() })));
  const workerNode = (await exec('docker', ['exec', ids.get('coordinator')!, 'node', '-p', 'process.version'], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim();
  const git = async (args: string[]) => (await exec('git', args, { timeout: 5000, maxBuffer: 65536, encoding: 'utf8' })).stdout.trim();
  const configuration = psql("SELECT jsonb_build_object('admission',(SELECT to_jsonb(c) FROM game.shooter_verification_admission c),'scheduler',(SELECT to_jsonb(c) FROM game.shooter_verification_scheduler c),'gateway',(SELECT to_jsonb(c) FROM game.shooter_verification_gateway c),'payment',(SELECT to_jsonb(c) FROM game.shooter_verification_payment_config c))::text");
  const cpuByRole = [...new Set(samples.map(s => s.role))].map(role => { const rows = samples.filter(s => s.role === role); return { role, ...cpuDelta(rows[0], rows[rows.length - 1]) }; });
  const backgroundMetricAvailability = pipeline.backgroundCoverage().reduce((counts, sample) => ({ attempted: counts.attempted + sample.attemptedMetrics, observed: counts.observed + sample.successfulMetrics, confirmedEndedDuringRead: counts.confirmedEndedDuringRead + sample.confirmedEndMetricMisses }), { attempted: 0, observed: 0, confirmedEndedDuringRead: 0 });
  const currentPin = JSON.parse(await readFile('server/modules/vendor/shooter-sim.pin.json', 'utf8'));
  const legacy = mode !== 'bounded_v8_same_host';
  const paidDelay = { ...quantiles([...pipeline.observations.values()].flatMap(o => o.rewardWallMs === null ? [] : [o.rewardWallMs]), 'ms', legacy ? 'actual_v1_submit_paid_receipt' : 'actual_owner_paid_status'), origin: legacy ? 'first_actual_v1_submit_attempt' : 'first_actual_append_attempt', denominators: { eligible: result.summary.eligible, observedPaid: result.summary.paid, eligibleUnpaid: result.summary.eligibleUnpaid, eligibleCensored: result.summary.eligibleCensored } };
  const backgroundInputProof = inputCoverage(pipeline.matchMetrics(), result.startedMonoMs, result.elapsedMs, plan.background.freePvpMatches);
  const workloadFailures = result.actors.filter(a => ['operational_failure', 'timeout', 'censored', 'unsupported', 'not_started'].includes(a.status)).length;
  const report = { schemaVersion: 1, benchmarkId: `ci-${process.env.GITHUB_RUN_ID}`, authority: 'ci_advisory', profile: plan.profile, mode: plan.mode,
    scope: legacy ? 'one_twenty_actor_existing_legacy_public_rpc_baseline_not_parity_or_capacity_profile' : profile === 'lifecycle' ? 'two_independent_twenty_actor_cold_warm_process_waves_not_capacity_profile' : profile === 'sustained' ? 'three_independent_twenty_actor_waves_at_declared_30s_arrivals_not_capacity_profile' : 'one_twenty_actor_real_pipeline_retry_burst_not_capacity_profile', approvalReference: null, productionCapacityConclusion: null,
    provenance: { gameGitSha: legacy ? currentPin.commit : plan.source.corpusCommit, inputBuilderArtifactSha256: plan.source.artifactSha256, legacyExecutable: legacy ? currentPin : null, images, runtimes: { loadGeneratorNode: process.version, coordinatorNode: workerNode, postgres: psql('SHOW server_version'), nakama: { value: null, unavailableReason: 'runtime version not yet observed; exact image digest recorded' }, goja: legacy ? { value: currentPin.goja, source: 'checked_in_exact_executable_pin', observedProcessVersion: null } : { value: null, unavailableReason: 'legacy adapter not executed in this V8 lane' } }, hubGitSha: await git(['rev-parse', 'HEAD']), dirty: Boolean(await git(['status', '--porcelain', '--untracked-files=no'])), artifactSha256: legacy ? currentPin.sha256 : plan.source.artifactSha256, corpusSourceCommit: plan.source.corpusCommit, corpusManifestSha256: plan.source.corpusSha256, assignmentSha256: result.assignmentSha256, configurationSha256: sha256(configuration), configuration: JSON.parse(configuration), roleLimits },
    hosts: [await hostObservation()], schedule: plan, actors: result.actors,
    summary: { ...result.summary, harnessStatus: result.harnessStatus, workloadStatus: result.summary.pending ? 'incomplete' : workloadFailures || result.observerFailures ? 'degraded' : 'complete', workloadFailures, observationFailures: result.observerFailures, backgroundInputProof, backgroundMetricAvailability },
    measurements: { ...latencyObservations([], []), cpu: { value: { evidence: 'serverCgroupSamples', deltas: cpuByRole }, unit: 'cpu_seconds_delta', observer: 'container_cgroup_v2', clockDomain: 'kernel_cgroup_counter', unavailableReason: samples.some(s => s.cpuUsageMicros !== null) ? null : 'cgroup counters unavailable', sampleCount: samples.filter(s => s.cpuUsageMicros !== null).length }, wall: { value: result.elapsedMs, unit: 'ms', observer: 'load_generator', clockDomain: 'monotonic_elapsed', unavailableReason: null, sampleCount: 1 }, queue: { value: { evidence: 'safeCoordinatorSamples', approximate: true }, unit: 'jobs', observer: 'scoped_gateway_ops', clockDomain: 'server_sampled', unavailableReason: queueSamples.length ? null : 'no gateway samples', sampleCount: queueSamples.length }, memory: { value: { evidence: 'serverCgroupSamples' }, unit: 'bytes', observer: 'container_cgroup_v2', clockDomain: null, unavailableReason: samples.some(s => s.memoryCurrentBytes !== null) ? null : 'cgroup memory unavailable', sampleCount: samples.filter(s => s.memoryCurrentBytes !== null).length }, checkpointBytes: { value: { evidence: 'checkpointSizes', definitions: { canonicalJsonBytes: legacy ? 'UTF8 legacy checkpoint text bytes' : '0054 UTF8 checkpoint_json text byte accounting', jsonbDatumBytes: legacy ? 'Postgres pg_column_size of legacy checkpoint text datum, excludes relation/page overhead' : 'Postgres pg_column_size of jsonb datum, excludes relation/page overhead' } }, unit: 'bytes', observer: 'trusted_ci_readonly_sql_metadata', clockDomain: 'postgres_statement_sample', unavailableReason: checkpointSamples.length ? null : 'no checkpoint size samples', sampleCount: checkpointSamples.length }, rewardDelay: paidDelay, finishAckToPaid: quantiles([...pipeline.observations.values()].flatMap(o => o.finishAckToPaidMs === null ? [] : [o.finishAckToPaidMs]), 'ms', 'local_finish_ack_to_first_paid_observation'), firstObservedEligibleToPaid: quantiles([...pipeline.observations.values()].flatMap(o => o.firstEligiblePendingToPaidMs === null ? [] : [o.firstEligiblePendingToPaidMs]), 'ms', 'first_observed_eligible_pending_to_paid'), matchTick: { value: { evidence: 'actualMatchQuantiles', aggregation: 'per_match_only_not_p95_of_p95', availability: backgroundMetricAvailability }, unit: 'ms', observer: 'actual_shooter_metrics_rpc', clockDomain: 'server_tick', unavailableReason: pipeline.matchMetrics().length ? null : 'no actual matches observed', sampleCount: pipeline.matchMetrics().length } },
    evidence: { serverCgroupSamples: samples, safeCoordinatorSamples: queueSamples, actualMatchQuantiles: pipeline.matchMetrics(), actualMatchEnds: pipeline.matchEnds(), materializedInputBudget: pipeline.inputBudget(), backgroundCoverage: pipeline.backgroundCoverage(), backgroundRejections: pipeline.backgroundRejections(), backgroundTransitions: pipeline.backgroundTransitions(), backgroundMetricReads: pipeline.backgroundMetricReads(), checkpointSizes: checkpointSamples, actorLatency: [...pipeline.observations.values()], legacyReceiptsAndTiming: legacy ? [...pipeline.observations.values()] : null, periodicObserverSamples: result.observations, arrivals: result.arrivals, phaseLifecycles: result.phaseLifecycles },
  };
  validateResult(report);
  await writeFile(join(root, 'benchmark-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`CI advisory actual pipeline: ${result.actors.length} accepted-prefix actors, ${result.summary.fullSourceActorsVerified} full-source actors, ${workloadFailures} operational failures; no production capacity conclusion`);
  const waves = plan.phases.reduce((sum, phase) => sum + phase.waves, 0);
  if (result.harnessStatus !== 'complete' || result.actors.length !== 20 * waves || result.observerFailures || !backgroundInputProof.complete || (!legacy && (result.summary.fullSourceActorsVerified !== 19 * waves || result.summary.paid !== 7 * waves || workloadFailures))) process.exitCode = 1;
}
try { if (process.argv[2] === 'prepare') await prepare(); else if (process.argv[2] === 'run') await run(); else if (process.argv[2] === 'run-lifecycle') await run('lifecycle'); else if (process.argv[2] === 'run-sustained') await run('sustained'); else if (process.argv[2] === 'run-legacy-full') await run('burst', 'legacy_full_goja'); else if (process.argv[2] === 'run-legacy-segmented') await run('burst', 'legacy_segmented_goja'); else throw new Error('explicit prepare/run required'); }
catch (error) { const reason = error instanceof InstrumentationFailure || error instanceof SutUnavailable ? error.reason : 'unclassified_ci_controller_exception'; console.error(`bounded ephemeral benchmark controller failed: ${reason}; inspect safe report only`); process.exitCode = 1; }
