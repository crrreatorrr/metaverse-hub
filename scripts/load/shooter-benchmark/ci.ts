// Explicit disposable CI controller. No target/remote endpoint is accepted.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { psql, guest, waitReady } from '../../../server/test/dup/harness.ts';
import { makePlan, sha256, quantiles, type Corpus } from './contracts.ts';
import { hostObservation, latencyObservations } from './observers.ts';
import { observeContainer, observeContainerLimits, cpuDelta, type CgroupSample } from './container-observer.ts';
import { LegacyPipeline } from './legacy.ts';
import { PublicPipeline } from './pipeline.ts';
import { runPlan, InstrumentationFailure, SutUnavailable, CoordinatorMetricsUnavailable } from './runner.ts';
import { countPlannedCoordinatorUnavailable } from './control.ts';
import { checkpointChanges, metricReadColumns } from './evidence-codec.ts';
import { beginClientMeasurement, type ClientProbe } from './client-gate.ts';
import { clientOverlap, clientWorkloadCompletion } from './client-validation.ts';
import { LEGACY_SEGMENT_FRAMES } from './budget.ts';
import { inputCoverage, shortInputCoverage } from './coverage.ts';
import { FIXTURE_MAX_RUNS, FIXTURE_RESERVED_BYTES, FIXTURE_CP_RESERVED_BYTES, assertFixtureCohortFits, assertFixtureRemainingCapacity, type FixtureCapacity } from './fixture-config.ts';
import { createWorkerLifecycle } from './worker-lifecycle.mjs';
import { validateResult, ResultValidationFailure } from './result-validation.ts';
import { collectResultStages } from './result-stage-collector.mjs';
import { decideGate, validateMachineSpeed, type MachineSpeed } from './machine-speed.ts';
const exec = promisify(execFile);
let controllerStage = 'startup';
let hardExitRequired = false;
function retainClientCleanup(value: unknown): void {
  const state = value && typeof value === 'object' ? (value as { state?: unknown }).state : null;
  if (state !== 'closed') process.exitCode = 1;
  if (state !== 'closed' && state !== 'forced') hardExitRequired = true;
}
let failureFacts: Record<string, unknown> = {};
const resultTraceEnabled = process.env.SHOOTER_BENCHMARK_RESULT_TRACE === '1';
let resultTraceContainer: string | null = null;
let resultTraceManifest: Record<string, unknown> | null = null;
let resultTraceCapture: Promise<Record<string, unknown>> | null = null;
async function loadResultTraceManifest(): Promise<void> {
  if (!resultTraceEnabled) return;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark' || !process.env.RUNNER_TEMP) throw new InstrumentationFailure('result_stage_fixture_required');
  const bytes = await readFile(join(process.env.RUNNER_TEMP, 'shooter-result-stage-manifest.json'));
  if (bytes.length > 8192) throw new InstrumentationFailure('result_stage_manifest_invalid');
  const raw = JSON.parse(bytes.toString('utf8'));
  const paths = ['server/modules/src/games/shooter_verification_internal.ts', 'server/modules/src/games/shooter_verification_commit.ts'];
  const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!raw || raw.version !== 1 || raw.kind !== 'ci_result_stage_instrumentation' || !hash(raw.instrumenterSha256) || raw.instrumenterSha256 !== sha256(await readFile('scripts/load/shooter-benchmark/instrument-result-stages.mjs')) || !Array.isArray(raw.sources) || raw.sources.length !== 2) throw new InstrumentationFailure('result_stage_manifest_invalid');
  const sources = [];
  for (const path of paths) {
    const entries = raw.sources.filter((entry: { path?: unknown }) => entry?.path === path);
    if (entries.length !== 1 || !hash(entries[0].originalSha256) || !hash(entries[0].instrumentedSha256) || sha256(await readFile(path)) !== entries[0].instrumentedSha256) throw new InstrumentationFailure('result_stage_source_not_instrumented');
    sources.push({ path, originalSha256: entries[0].originalSha256, instrumentedSha256: entries[0].instrumentedSha256 });
  }
  resultTraceManifest = { version: 1, kind: 'ci_result_stage_instrumentation', instrumenterSha256: raw.instrumenterSha256, sources };
}
function captureResultStages(): Promise<Record<string, unknown>> {
  resultTraceCapture ??= (async () => {
    if (!resultTraceEnabled) return { state: 'disabled' };
    if (!resultTraceContainer) return { state: 'unavailable', reason: 'nakama_identity_unavailable', instrumentation: resultTraceManifest };
    try {
      const trace = await collectResultStages(resultTraceContainer);
      return { state: trace.state === 'observed' && trace.counts.acceptedRecords > 0 ? 'observed' : 'unavailable', instrumentation: resultTraceManifest, scope: 'post_measurement_server_wall_events_do_not_reopen_actor_outcomes', trace };
    } catch { return { state: 'unavailable', reason: 'bounded_stage_collector_failed', instrumentation: resultTraceManifest }; }
  })();
  return resultTraceCapture;
}

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
    UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=2,max_account_leased=1,max_jobs=128,max_account_jobs=16,max_attempts_retained=512,max_account_attempts_retained=64,max_checkpoint_bytes=${FIXTURE_CP_RESERVED_BYTES},max_account_checkpoint_bytes=67108864,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
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
  if (snapshot.state !== 'observed') { if (endpoint === 'metrics') throw new CoordinatorMetricsUnavailable(snapshot.asOf); throw new SutUnavailable('coordinator_health_read_unavailable'); }
  return snapshot[endpoint];
}
async function finalQuotaCounters(): Promise<Record<string, unknown>> {
  const sql = `BEGIN; SET LOCAL statement_timeout='2s'; SELECT jsonb_build_object(
    'capturedServerAt',clock_timestamp(),
    'admission',(SELECT jsonb_build_object('retainedRuns',retained_runs,'reservedBytes',reserved_bytes,'reservedBatches',reserved_batches,'maxRuns',max_global_runs,'maxBytes',max_global_bytes,'maxBatches',max_global_batches) FROM game.shooter_verification_admission WHERE singleton),
    'scheduler',(SELECT jsonb_build_object('retainedJobs',retained_jobs,'retainedAttempts',retained_attempts,'reservedCheckpointBytes',reserved_checkpoint_bytes,'maxJobs',max_jobs,'maxAttempts',max_attempts_retained,'maxCheckpointBytes',max_checkpoint_bytes,'maxLeased',max_leased) FROM game.shooter_verification_scheduler WHERE singleton),
    'gateway',(SELECT jsonb_build_object('retainedRequests',retained_requests,'reservedReceiptBytes',reserved_receipt_bytes,'maxRequests',max_requests,'maxPrincipalRequests',max_principal_requests,'maxReceiptBytes',max_receipt_bytes,'maxPrincipalReceiptBytes',max_principal_receipt_bytes) FROM game.shooter_verification_gateway WHERE singleton),
    'principals',(SELECT jsonb_build_object('count',count(*),'maximumRetainedRequests',COALESCE(max(retained_requests),0),'maximumReservedReceiptBytes',COALESCE(max(reserved_receipt_bytes),0)) FROM game.shooter_verification_principal),
    'jobStates',(SELECT COALESCE(jsonb_object_agg(state,n),'{}'::jsonb) FROM (SELECT state,count(*) n FROM game.shooter_verification_job GROUP BY state) counts),
    'dueJobs',(SELECT count(*) FROM game.shooter_verification_job WHERE state IN ('ready','retry_wait') AND next_attempt_at<=clock_timestamp()),
    'runStates',(SELECT COALESCE(jsonb_object_agg(lifecycle,n),'{}'::jsonb) FROM (SELECT lifecycle,count(*) n FROM game.shooter_verification_run GROUP BY lifecycle) counts),
    'paymentStates',(SELECT COALESCE(jsonb_object_agg(payment_state,n),'{}'::jsonb) FROM (SELECT payment_state,count(*) n FROM game.shooter_verification_run GROUP BY payment_state) counts),
    'acceptedVerifiedLagTicks',(SELECT COALESCE(sum(accepted_tick-verified_tick),0) FROM game.shooter_verification_run)
  )::text; COMMIT;`;
  try {
    const { stdout } = await exec('docker', ['compose', ...composeFiles, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql], { timeout: 3000, maxBuffer: 65536, encoding: 'utf8' });
    return { state: 'observed', capturedClientAt: new Date().toISOString(), scope: 'post_measurement_snapshot_may_include_later_commits_not_reopened_actor_facts', values: JSON.parse(stdout.trim()) };
  } catch { return { state: 'unavailable', rawReason: 'bounded_post_measurement_quota_read_failed' }; }
}
const metricsFile = (id: string, signal?: AbortSignal) => observerFile(id, 'metrics', signal);
// Written by machine-speed-ci.ts before the stack boots. Without it no time-limit miss is excused.
async function loadMachineSpeed(): Promise<MachineSpeed | null> {
  const path = process.env.SHOOTER_MACHINE_SPEED_FILE;
  if (!path) return null;
  try { return validateMachineSpeed(JSON.parse(await readFile(path, 'utf8'))); } catch { return null; }
}
// GitHub Actions has no neutral job state, so an inconclusive run exits 0 with a warning annotation
// and says so in the job summary.
function reportGate(gate: ReturnType<typeof decideGate>, machine: MachineSpeed | null): void {
  const where = machine ? `${machine.cpuModel}, speed score ${machine.score}` : 'machine speed not measured';
  const line = gate.verdict === 'passed' ? `Benchmark passed (${where}).`
    : gate.verdict === 'inconclusive_slow_machine' ? `Inconclusive: missed only a time limit (${gate.timingMisses.join(', ')}) on a slow machine (${where}). Not a pass; re-run to land on a faster machine.`
    : `Benchmark failed: ${gate.failures.join(', ')}${gate.timingMisses.length ? `; time limits missed: ${gate.timingMisses.join(', ')}` : ''} (${where}).`;
  if (gate.verdict === 'inconclusive_slow_machine') console.log(`::warning title=Shooter benchmark inconclusive::${line}`);
  else console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Shooter benchmark: ${gate.verdict}\n\n${line}\n\n`);
  if (gate.verdict === 'failed') process.exitCode = 1;
}
async function run(profile: 'burst' | 'lifecycle' | 'sustained' = 'burst', mode: 'bounded_v8_same_host' | 'legacy_full_goja' | 'legacy_segmented_goja' = 'bounded_v8_same_host', clientProbe?: ClientProbe): Promise<void> {
  controllerStage = 'load_plan';
  const root = directory();
  await loadResultTraceManifest();
  const corpusBytes = await readFile('server/test/fixtures/shooter-integration-corpus.json');
  const plan = makePlan(JSON.parse(corpusBytes.toString('utf8')) as Corpus, corpusBytes, 'ci-twenty-independent-v1', mode);
  // Separate finite CI profiles retain full hard traces. None establishes
  // intended-host capacity or authorizes a deployment/operating choice.
  plan.phases = [{ kind: 'background_baseline', waves: 0, arrivalIntervalMs: 3000 }, ...(profile === 'lifecycle' ? [{ kind: 'cold_burst' as const, waves: 1, arrivalIntervalMs: 0 }, { kind: 'warm_burst' as const, waves: 1, arrivalIntervalMs: 0 }] : profile === 'sustained' ? [{ kind: 'sustained' as const, waves: 3, arrivalIntervalMs: 30000 }] : [{ kind: mode === 'bounded_v8_same_host' && !clientProbe ? 'retry_storm' as const : 'finish_burst' as const, waves: 1, arrivalIntervalMs: 0 }]), { kind: 'drain', waves: 0, arrivalIntervalMs: 5000 }];
  assertFixtureCohortFits(plan.actorsPerWave, plan.phases.reduce((sum, phase) => sum + phase.waves, 0));
  controllerStage = 'fixture_capacity_preflight';
  const fixtureCapacity = JSON.parse(psql(`SELECT jsonb_build_object('maxRuns',a.max_global_runs,'retainedRuns',a.retained_runs,'maxInputBytes',a.max_global_bytes,'reservedInputBytes',a.reserved_bytes,'maxCheckpointBytes',s.max_checkpoint_bytes,'reservedCheckpointBytes',s.reserved_checkpoint_bytes)::text FROM game.shooter_verification_admission a CROSS JOIN game.shooter_verification_scheduler s WHERE a.singleton AND s.singleton`)) as FixtureCapacity;
  const plannedV2Runs = mode === 'bounded_v8_same_host' ? plan.phases.reduce((sum, phase) => sum + 20 * phase.waves, 0) + (clientProbe ? 1 : 0) : 0;
  assertFixtureRemainingCapacity(fixtureCapacity, plannedV2Runs);
  controllerStage = 'actual_stack_identity';
  const ids = new Map<string, string>();
  for (const service of ['nakama', 'postgres', 'coordinator', 'replay', 'metrics-observer']) {
    const id = await compose(['ps', '-q', service]);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('missing actual container identity'); ids.set(service, id);
  }
  resultTraceContainer = ids.get('nakama')!;
  const originalIds = JSON.parse(await readFile(join(root, 'stack-identities.json'), 'utf8'));
  if (originalIds.nakama !== ids.get('nakama') || originalIds.postgres !== ids.get('postgres')) throw new Error('worker startup replaced the measured Hub/database');
  const readyDeadline = Date.now() + 5000;
  for (;;) { try { const initial = await metricsFile(ids.get('metrics-observer')!); if (!initial.gatewayDiagnostics) throw new InstrumentationFailure('gateway_diagnostics_not_active'); break; } catch { if (Date.now() >= readyDeadline) throw new InstrumentationFailure('metrics_collector_not_ready'); await new Promise(resolve => setTimeout(resolve, 100)); } }
  const roleLimits = await Promise.all([...ids].map(([service, id]) => observeContainerLimits(role(service), id)));
  const samples: CgroupSample[] = [], queueSamples: Record<string, unknown>[] = [], checkpointSamples: { observedAt: string; sizes: Record<string, unknown>[] }[] = [];
  const diagnosticAvailability = { metricsObserved: 0, metricsUnavailable: 0, healthObserved: 0, healthUnavailable: 0 };
  let latestGatewayDiagnostics: unknown = null, latestHealth: Record<string, unknown> | null = null;
  const healthTransitions: Record<string, unknown>[] = [];
  let previousHealthState: string | null = null;
  const retainDiagnosticFacts = () => ({ availability: { ...diagnosticAvailability }, latestGatewayDiagnostics: structuredClone(latestGatewayDiagnostics), latestHealth: structuredClone(latestHealth), healthTransitions: structuredClone(healthTransitions), scope: 'latest_bounded_RPC_ring_only; health_changes_retain_original_cached_source_timestamps' });
  const controlledOfflineIntervals: { startedMonoMs: number; startedWallMs: number; finishedMonoMs: number | null; finishedWallMs: number | null; completed: boolean }[] = [];
  const lifecycle = profile === 'lifecycle' ? createWorkerLifecycle({ composeArgs: composeFiles, onControlledOffline: event => {
    if (event.kind === 'started') controlledOfflineIntervals.push({ startedMonoMs: event.observedMonoMs, startedWallMs: Date.now(), finishedMonoMs: null, finishedWallMs: null, completed: false });
    else { const interval = controlledOfflineIntervals.at(-1); if (interval && interval.finishedMonoMs === null) { interval.finishedMonoMs = event.observedMonoMs; interval.finishedWallMs = Date.now(); interval.completed = event.completed === true; } }
  }, readHealth: signal => observerFile(ids.get('metrics-observer')!, 'health', signal), readMetrics: signal => metricsFile(ids.get('metrics-observer')!, signal) }) : undefined;
  const sampleServer = async (signal: AbortSignal) => {
    const [observed, diagnosticResponses, checkpoints] = await Promise.all([
      Promise.all([...ids].map(([service, id]) => observeContainer(role(service), id))),
      Promise.allSettled([metricsFile(ids.get('metrics-observer')!, signal), observerFile(ids.get('metrics-observer')!, 'health', signal)]),
      pipeline.checkpointSizes(),
    ]);
    if (signal.aborted) throw new Error('aborted');
    const [metricsResponse, healthResponse] = diagnosticResponses;
    if (healthResponse.status === 'fulfilled') {
      diagnosticAvailability.healthObserved++;
      latestHealth = { observedAt: new Date().toISOString(), ...healthResponse.value };
      const state = Object.fromEntries(['ready','busy','blocked','draining','gatewayObservationCurrent','journalPhase'].map(key => [key, healthResponse.value[key]]));
      const encoded = JSON.stringify(state);
      if (encoded !== previousHealthState) { healthTransitions.push(structuredClone(latestHealth)); previousHealthState = encoded; }
      if (healthTransitions.length > 10000) throw new InstrumentationFailure('health_transition_bound');
    } else diagnosticAvailability.healthUnavailable++;
    if (metricsResponse.status === 'fulfilled' && metricsResponse.value.gatewayDiagnostics) { diagnosticAvailability.metricsObserved++; latestGatewayDiagnostics = metricsResponse.value.gatewayDiagnostics; }
    else diagnosticAvailability.metricsUnavailable++;
    failureFacts.coordinatorDiagnostics = retainDiagnosticFacts();
    if (metricsResponse.status === 'rejected') throw metricsResponse.reason;
    checkpointSamples.push({ observedAt: new Date().toISOString(), sizes: checkpoints });
    samples.push(...observed);
    if (samples.length > 10000) throw new Error('server sample bound exceeded');
    if (signal.aborted) throw new Error('aborted');
    const value = metricsResponse.value;
    if (!Number.isFinite(value.uptimeMs) || !value.counters) throw new Error('invalid actual coordinator metrics');
    // Keep only the reviewed safe aggregate DTO, never arbitrary RPC bodies.
    queueSamples.push({ observedAt: new Date().toISOString(), uptimeMs: value.uptimeMs, counters: value.counters, gateway: value.gateway, lastExecution: value.lastExecution, gatewaySampleAgeMs: value.gatewaySampleAgeMs, lastExecutionSampleAgeMs: value.lastExecutionSampleAgeMs });
  };
  const clientState: { measurement: ReturnType<typeof beginClientMeasurement> | null } = { measurement: null };
  const firstExecute = clientProbe ? async (signal: AbortSignal) => { clientState.measurement ??= beginClientMeasurement(clientProbe, signal); await clientState.measurement.ready; } : undefined;
  const pipeline: PublicPipeline | LegacyPipeline = mode === 'bounded_v8_same_host' ? new PublicPipeline(plan, 'http://127.0.0.1:7350', sampleServer, lifecycle, firstExecute) : new LegacyPipeline(plan, 'http://127.0.0.1:7350', mode === 'legacy_segmented_goja', sampleServer);
  controllerStage = 'actual_run_plan';
  const result = await runPlan(plan, pipeline);
  const plannedCoordinatorUnavailable = countPlannedCoordinatorUnavailable(result.observations, controlledOfflineIntervals);
  const unexpectedObserverFailures = result.observerFailures - plannedCoordinatorUnavailable;
  failureFacts = { plannedActors: result.summary.plannedActors, harnessStatus: result.harnessStatus, actors: result.actors.map(actor => ({ actor: actor.actor, wave: actor.wave, caseId: actor.caseId, sourceFrames: actor.sourceFrames, sourceInputSha256: actor.sourceInputSha256, accountBindingHash: actor.accountBindingHash, sessionBindingHash: actor.sessionBindingHash, runBindingHash: actor.runBindingHash, status: actor.status, rawReason: actor.rawReason && /^[a-z0-9_:.|-]{1,80}$/.test(actor.rawReason) ? actor.rawReason : actor.rawReason === null ? null : 'redacted', submittedFrames: actor.submittedFrames, acceptedTick: actor.acceptedTick, verifiedTick: actor.verifiedTick, observedPaid: actor.observedPaid, paid: actor.paid })), observerAttempts: result.observations.length, observerFailures: result.observerFailures, plannedCoordinatorUnavailable, controlledOfflineIntervals, measurementAvailability: { serverSamples: samples.length, coordinatorSamples: queueSamples.length, checkpointSamples: checkpointSamples.length, matchMetrics: pipeline.matchMetrics().length, metricReads: pipeline.backgroundMetricReads().length }, fixtureCapacity, phaseKindsObserved: result.phaseLifecycles.map(row => ({ phase: row.phase, kind: row.evidence.kind })), fixturePreparation: result.preparationEvidence, harnessFailures: result.harnessFailures, coordinationFailures: result.coordinationFailures };
  controllerStage = 'freeze_actual_facts';
  const actorLatency = structuredClone([...pipeline.observations.values()]);
  failureFacts.coordinatorDiagnostics = retainDiagnosticFacts();
  failureFacts.latestSafeCoordinatorAggregate = structuredClone(queueSamples.at(-1) ?? null);
  failureFacts.finalQuotaCounters = await finalQuotaCounters();
  let clientPopulation: Record<string, unknown> | null = null, clientFrames: unknown = null, clientShutdown: Record<string, unknown> | null = null;
  let clientMeasurementFailure: string | null = null;
  if (clientProbe) {
    controllerStage = 'client_population_finish';
    const measurement = clientState.measurement;
    if (measurement) {
      let closeTimer: ReturnType<typeof setTimeout>;
      try {
        const observed = await Promise.race([measurement.result, new Promise<never>((_, reject) => { closeTimer = setTimeout(() => reject(new Error('bounded_client_finish')), 15000); })]).finally(() => clearTimeout(closeTimer!));
        if (observed.state === 'observed') { clientPopulation = structuredClone(observed.population); clientFrames = clientPopulation.rawFrameRecords ?? null; delete clientPopulation.rawFrameRecords; }
        else clientMeasurementFailure = observed.rawReason;
      } catch { clientMeasurementFailure = 'client_population_finish_deadline'; }
    } else clientMeasurementFailure = 'client_never_dispatched';
    try { clientShutdown = await clientProbe.close(); retainClientCleanup(clientShutdown); } catch { retainClientCleanup(null); clientMeasurementFailure = 'client_owned_cleanup_failed'; }
  }
  const overlap = clientProbe && clientPopulation ? clientOverlap(clientPopulation, result.actors, actorLatency) : null;
  const clientGate = clientState.measurement?.evidence() ?? null;
  const clientComplete = !clientProbe || !!(overlap?.complete && clientGate?.reason === 'observed_positive_native_recording' && clientShutdown?.state === 'closed' && !clientMeasurementFailure);
  const clientWorkload = clientProbe ? clientPopulation ? clientWorkloadCompletion(clientPopulation) : { complete: false, reason: 'client_population_unavailable', accountedActors: 0 } : null;
  const clientWorkloadComplete = !clientProbe || clientWorkload?.complete === true;
  failureFacts.client = clientProbe ? { observed: clientPopulation !== null, gate: clientGate, complete: clientComplete, failure: clientMeasurementFailure, workload: clientWorkload, shutdownState: clientShutdown?.state ?? null } : null;

  controllerStage = 'source_and_runtime_provenance';
  const images = await Promise.all([...ids].map(async ([role, id]) => ({ role, digest: (await exec('docker', ['inspect', '--format', '{{.Image}}', id], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim() })));
  const workerNode = (await exec('docker', ['exec', ids.get('coordinator')!, 'node', '-p', 'process.version'], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim();
  const git = async (args: string[]) => (await exec('git', args, { timeout: 5000, maxBuffer: 65536, encoding: 'utf8' })).stdout.trim();
  const configuration = psql("SELECT jsonb_build_object('admission',(SELECT to_jsonb(c) FROM game.shooter_verification_admission c),'scheduler',(SELECT to_jsonb(c) FROM game.shooter_verification_scheduler c),'gateway',(SELECT to_jsonb(c) FROM game.shooter_verification_gateway c),'payment',(SELECT to_jsonb(c) FROM game.shooter_verification_payment_config c))::text");
  const cpuByRole = [...new Set(samples.map(s => s.role))].map(role => { const rows = samples.filter(s => s.role === role); return { role, ...cpuDelta(rows[0], rows[rows.length - 1], profile === 'lifecycle' && (role === 'coordinator' || role === 'verifier')) }; });
  const backgroundMetricAvailability = pipeline.backgroundCoverage().reduce((counts, sample) => ({ attempted: counts.attempted + sample.attemptedMetrics, observed: counts.observed + sample.successfulMetrics, confirmedEndedDuringRead: counts.confirmedEndedDuringRead + sample.confirmedEndMetricMisses, authoritativeEndCensoredReads: counts.authoritativeEndCensoredReads + sample.endCensoredMetricReads }), { attempted: 0, observed: 0, confirmedEndedDuringRead: 0, authoritativeEndCensoredReads: 0 });
  const currentPin = JSON.parse(await readFile('server/modules/vendor/shooter-sim.pin.json', 'utf8'));
  const legacy = mode !== 'bounded_v8_same_host';
  const paidDelay = { ...quantiles(actorLatency.flatMap(o => o.rewardWallMs === null ? [] : [o.rewardWallMs]), 'ms', legacy ? 'actual_v1_submit_paid_receipt' : 'actual_owner_paid_status'), origin: legacy ? 'first_actual_v1_submit_attempt' : 'first_actual_append_attempt', denominators: { eligible: result.summary.eligible, observedPaid: result.summary.observedPaid, successfulPaid: result.summary.paid, eligibleUnpaid: result.summary.eligibleUnpaid, eligibleCensored: result.summary.eligibleCensored } };
  const backgroundInputProof = inputCoverage(pipeline.matchMetrics(), result.startedMonoMs, result.elapsedMs, plan.background.freePvpMatches);
  const shortBackgroundInputProof = shortInputCoverage(pipeline.matchMetrics(), plan.background.freePvpMatches);
  const workloadFailures = result.actors.filter(a => ['operational_failure', 'timeout', 'censored', 'unsupported', 'not_started'].includes(a.status)).length;
  const clientRows = clientPopulation && Array.isArray(clientPopulation.actors) ? clientPopulation.actors : [];
  const clientFrame = clientRows[0]?.clientFrames;
  const clientFrameMeasurement = clientProbe ? { value: clientFrame?.value ?? null, unit: 'ms', observer: 'one_actual_dom_native_raf_active_recording', clockDomain: 'browser_raf_timestamp', sampleCount: clientFrame?.value ? Number(clientFrame.sampleCount) : 0,
    unavailableReason: clientFrame?.value ? null : 'No valid native client frame sample observed; inspect separate client population outcome.' } : null;
  controllerStage = 'encode_checkpoint_size_metadata';
  const compactCheckpointSizes = checkpointChanges(checkpointSamples);
  controllerStage = 'encode_metric_read_metadata';
  const compactMetricReads = metricReadColumns(pipeline.backgroundMetricReads());
  controllerStage = 'build_safe_report';
  failureFacts.resultStageDiagnostics = await captureResultStages();
  const resultStageDiagnosticsComplete = !resultTraceEnabled || (failureFacts.resultStageDiagnostics as { state?: unknown }).state === 'observed';
  const waves = plan.phases.reduce((sum, phase) => sum + phase.waves, 0);
  const machine = await loadMachineSpeed();
  const gate = decideGate({
    legacy, clientComplete, clientWorkloadComplete, resultStageDiagnosticsComplete,
    harnessStatus: result.harnessStatus, harnessFailureReasons: result.harnessFailures.map(row => row.rawReason),
    expectedActors: 20 * waves, boundActors: result.actors.length,
    failedObservations: result.observations.filter(row => !row.ok && row.category !== 'censored').map(row => `${row.category}:${row.rawReason}`),
    plannedCoordinatorUnavailable,
    backgroundProofComplete: legacy ? shortBackgroundInputProof.complete : backgroundInputProof.complete,
    fullSourceActorsVerified: Number(result.summary.fullSourceActorsVerified), expectedFullSourceActors: 19 * waves,
    paid: Number(result.summary.paid), expectedPaid: 7 * waves,
    workloadFailureStatuses: result.actors.filter(a => ['operational_failure', 'timeout', 'censored', 'unsupported', 'not_started'].includes(a.status)).map(a => a.status),
  }, machine);
  const report = { schemaVersion: 1, benchmarkId: `ci-${process.env.GITHUB_RUN_ID}`, authority: 'ci_advisory', profile: plan.profile, mode: plan.mode,
    scope: clientProbe ? 'one_additional_actual_dom_client_during20_whole_protocol_actors_one_shared_background_not_capacity_profile' : legacy ? 'one_twenty_actor_existing_legacy_public_rpc_baseline_not_parity_or_capacity_profile' : profile === 'lifecycle' ? 'two_independent_twenty_actor_cold_warm_process_waves_not_capacity_profile' : profile === 'sustained' ? 'three_independent_twenty_actor_waves_at_declared_30s_arrivals_not_capacity_profile' : 'one_twenty_actor_real_pipeline_retry_burst_not_capacity_profile', approvalReference: null, productionCapacityConclusion: null,
    machine, gate,
    provenance: { gameGitSha: legacy ? currentPin.commit : plan.source.corpusCommit, inputBuilderArtifactSha256: plan.source.artifactSha256, clientSourceCommit: clientPopulation?.clientSourceCommit ?? null, clientBrowserVersion: clientPopulation?.actualBrowserVersion ?? null, legacyExecutable: legacy ? currentPin : null, legacySegmentFrames: mode === 'legacy_segmented_goja' ? LEGACY_SEGMENT_FRAMES : null, prior4096SegmentCiEvidence: mode === 'legacy_segmented_goja' ? { runId: 43007158079, head: '31489b032a73db1398f78228f4a19f949a41e49a', submittedFrames: 57863, verifiedFrames: 16903, cpuBudgetTimeouts: 10, paid: 3, capacityConclusion: null } : null, images, runtimes: { loadGeneratorNode: process.version, coordinatorNode: workerNode, postgres: psql('SHOW server_version'), nakama: { value: null, unavailableReason: 'runtime version not yet observed; exact image digest recorded' }, goja: legacy ? { value: currentPin.goja, source: 'checked_in_exact_executable_pin', observedProcessVersion: null } : { value: null, unavailableReason: 'legacy adapter not executed in this V8 lane' } }, hubGitSha: await git(['rev-parse', 'HEAD']), dirty: Boolean(await git(['status', '--porcelain', '--untracked-files=no'])), artifactSha256: legacy ? currentPin.sha256 : plan.source.artifactSha256, corpusSourceCommit: plan.source.corpusCommit, corpusManifestSha256: plan.source.corpusSha256, assignmentSha256: result.assignmentSha256, configurationSha256: sha256(configuration), configuration: JSON.parse(configuration), fixturePreflight: { capacity: fixtureCapacity, plannedAdditionalV2Runs: plannedV2Runs }, roleLimits },
    hosts: [await hostObservation()], schedule: plan, actors: result.actors,
    clientPopulation, clientMeasurement: clientProbe ? { populationRoles: { wholeProtocolActors: 20, additionalDomPrefix: 1, hubUsers: 20, freePvpMatches: 10 }, readinessGate: clientGate, overlap, shutdown: clientShutdown, rawReason: clientMeasurementFailure, complete: clientComplete, workload: clientWorkload, browserCpu: 'Separate clientPopulation scoped observation or explicit unknown; never inferred from wall/GPU/frame pauses', placement: 'colocated advisory CI host; not intended-client hardware or server-capacity evidence' } : null,
    summary: { ...result.summary, protocolHarnessStatus: result.harnessStatus, harnessStatus: clientComplete && resultStageDiagnosticsComplete ? result.harnessStatus : 'failed', workloadStatus: !clientComplete || !clientWorkloadComplete || !resultStageDiagnosticsComplete ? 'degraded' : result.summary.pending ? 'incomplete' : workloadFailures || unexpectedObserverFailures ? 'degraded' : 'complete', workloadFailures, observationFailures: result.observerFailures, plannedCoordinatorUnavailable, unexpectedObserverFailures, backgroundInputProof, shortBackgroundInputProof, backgroundCriterion: legacy ? 'short_actual_both_seat_growth_all10_no90s_replacement_claim' : 'long_early_late_and_replacement_growth_all10', backgroundMetricAvailability },
    measurements: { ...latencyObservations([], []), ...(clientFrameMeasurement ? { clientFrame: clientFrameMeasurement } : {}), cpu: { value: { evidence: 'serverCgroupSamples', deltas: cpuByRole }, unit: 'cpu_seconds_delta', observer: 'container_cgroup_v2', clockDomain: 'kernel_cgroup_counter', unavailableReason: samples.some(s => s.cpuUsageMicros !== null) ? null : 'cgroup counters unavailable', sampleCount: samples.filter(s => s.cpuUsageMicros !== null).length }, wall: { value: result.elapsedMs, unit: 'ms', observer: 'load_generator', clockDomain: 'monotonic_elapsed', unavailableReason: null, sampleCount: 1 }, queue: { value: { evidence: 'safeCoordinatorSamples', approximate: true }, unit: 'jobs', observer: 'scoped_gateway_ops', clockDomain: 'server_sampled', unavailableReason: queueSamples.length ? null : 'no gateway samples', sampleCount: queueSamples.length }, memory: { value: { evidence: 'serverCgroupSamples' }, unit: 'bytes', observer: 'container_cgroup_v2', clockDomain: null, unavailableReason: samples.some(s => s.memoryCurrentBytes !== null) ? null : 'cgroup memory unavailable', sampleCount: samples.filter(s => s.memoryCurrentBytes !== null).length }, checkpointBytes: { value: { evidence: 'checkpointSizes', definitions: { canonicalJsonBytes: legacy ? 'UTF8 legacy checkpoint text bytes' : '0054 UTF8 checkpoint_json text byte accounting', jsonbDatumBytes: legacy ? 'Postgres pg_column_size of legacy checkpoint text datum, excludes relation/page overhead' : 'Postgres pg_column_size of jsonb datum, excludes relation/page overhead' } }, unit: 'bytes', observer: 'trusted_ci_readonly_sql_metadata', clockDomain: 'postgres_statement_sample', unavailableReason: checkpointSamples.length ? null : 'no checkpoint size samples', sampleCount: checkpointSamples.length }, rewardDelay: paidDelay, finishAckToPaid: quantiles(actorLatency.flatMap(o => o.finishAckToPaidMs === null ? [] : [o.finishAckToPaidMs]), 'ms', 'local_finish_ack_to_first_paid_observation'), firstObservedEligibleToPaid: quantiles(actorLatency.flatMap(o => o.firstEligiblePendingToPaidMs === null ? [] : [o.firstEligiblePendingToPaidMs]), 'ms', 'first_observed_eligible_pending_to_paid'), matchTick: { value: { evidence: 'actualMatchQuantiles', aggregation: 'per_match_only_not_p95_of_p95', availability: backgroundMetricAvailability }, unit: 'ms', observer: 'actual_shooter_metrics_rpc', clockDomain: 'server_tick', unavailableReason: pipeline.matchMetrics().length ? null : 'no actual matches observed', sampleCount: pipeline.matchMetrics().length } },
    evidence: { resultStageDiagnostics: failureFacts.resultStageDiagnostics, coordinatorDiagnostics: retainDiagnosticFacts(), serverCgroupSamples: samples, safeCoordinatorSamples: queueSamples, actualMatchQuantiles: pipeline.matchMetrics(), actualMatchEnds: pipeline.matchEnds(), materializedInputBudget: pipeline.inputBudget(), backgroundCoverage: pipeline.backgroundCoverage(), backgroundRejections: pipeline.backgroundRejections(), backgroundTransitions: pipeline.backgroundTransitions(), backgroundParticipants: pipeline.backgroundParticipants(), backgroundMetricReads: compactMetricReads, backgroundMetricEndCensors: pipeline.backgroundMetricEndCensors(), checkpointSizes: compactCheckpointSizes, actorLatency: actorLatency, legacyReceiptsAndTiming: legacy ? actorLatency : null, periodicObserverSamples: result.observations, arrivals: result.arrivals, phaseLifecycles: result.phaseLifecycles, fixturePreparation: result.preparationEvidence, controlledOfflineIntervals: { clockDomain: 'same_CI_host_wall_clock_for_cached_aggregate_source_time', intervals: controlledOfflineIntervals }, finalQuotaCounters: failureFacts.finalQuotaCounters, harnessFailures: result.harnessFailures, coordinationFailures: result.coordinationFailures },
  };
  controllerStage = 'validate_safe_report';
  validateResult(report);
  controllerStage = 'write_safe_report';
  const reportText = JSON.stringify(report) + '\n';
  const frameText = clientProbe ? JSON.stringify({ clockDomain: 'browser_raf_timestamp', scope: 'one_disjoint_actual_dom_prefix', records: clientFrames }) + '\n' : '';
  if (Buffer.byteLength(reportText) + Buffer.byteLength(frameText) > 8 * 1024 * 1024) throw new ResultValidationFailure('combined client report bytes exceed8MiB');
  if (clientProbe) await writeFile(join(root, 'client-frame-intervals.json'), frameText, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, clientProbe ? 'client-benchmark-report.json' : 'benchmark-report.json'), reportText, { flag: 'wx', mode: 0o600 });
  console.log(`CI advisory actual pipeline: ${result.actors.length} accepted-prefix actors, ${result.summary.fullSourceActorsVerified} full-source actors, ${workloadFailures} operational failures; no production capacity conclusion`);
  reportGate(gate, machine);
}
try { if (process.argv[2] === 'prepare') await prepare(); else if (process.argv[2] === 'run') await run(); else if (process.argv[2] === 'run-lifecycle') await run('lifecycle'); else if (process.argv[2] === 'run-sustained') await run('sustained'); else if (process.argv[2] === 'run-legacy-full') await run('burst', 'legacy_full_goja'); else if (process.argv[2] === 'run-legacy-segmented') await run('burst', 'legacy_segmented_goja'); else if (process.argv[2] === 'run-client') { const { prepareSingleDomClient } = await import('./client-browser.mjs'); controllerStage = 'client_prepare'; const probe = await prepareSingleDomClient({ root: directory() }); try { await run('burst', 'bounded_v8_same_host', probe); } finally { try { retainClientCleanup(await probe.close()); } catch { retainClientCleanup(null); throw new InstrumentationFailure('client_owned_cleanup_exception'); } } } else throw new Error('explicit prepare/run required'); }
catch (error) {
  if (error instanceof Error && error.message === 'single_dom_prepare_failed') {
    const detail = error as Error & { stage?: unknown; cleanup?: { state?: unknown } };
    const stages = ['source_check','authenticate_account','open_original_session','validate_profile','launch_browser','connect_browser','sdk_title_bootstrap'];
    const prepareStage = typeof detail.stage === 'string' && stages.includes(detail.stage) ? detail.stage : 'unknown';
    const cleanupState = ['closed','forced','unconfirmed'].includes(String(detail.cleanup?.state)) ? detail.cleanup?.state : 'unconfirmed';
    failureFacts.clientPrepare = { prepareStage, cleanupState }; retainClientCleanup({ state: cleanupState });
  }
  const reason = error instanceof InstrumentationFailure || error instanceof SutUnavailable || error instanceof ResultValidationFailure ? error.reason : 'unclassified_ci_controller_exception';
  failureFacts.resultStageDiagnostics ??= await captureResultStages();
  try {
    const text = JSON.stringify({ schemaVersion: 1, authority: 'ci_advisory', harnessStatus: 'failed', productionCapacityConclusion: null, stage: controllerStage, reason, facts: failureFacts });
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('failure diagnostic bound');
    await writeFile(join(directory(), 'benchmark-failure.json'), text + '\n', { flag: 'wx', mode: 0o600 });
  } catch { /* no raw exception or credential-bearing log fallback */ }
  console.error(`bounded ephemeral benchmark controller failed at ${controllerStage}: ${reason}; inspect safe report only`); process.exitCode = 1;
}

// Persist safe artifacts before terminating an unconfirmed owned browser.
if (hardExitRequired) process.exit(1);
