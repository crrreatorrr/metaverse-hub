// Ephemeral actual background/server observation for the public browser profile.
// This owns no browser input, credentials, replay result or payment authority.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackgroundTraffic } from './background.ts';
import { observeContainer, observeContainerLimits, cpuDelta, type CgroupSample, type ServerRole } from './container-observer.ts';
import { inputCoverage, shortInputCoverage } from './coverage.ts';
import { InstrumentationFailure, SutUnavailable } from './runner.ts';
const exec = promisify(execFile);
const composeFiles = ['-f', 'server/docker-compose.yml', '-f', 'services/shooter-verifier/ops/compose.ci.yml', '-f', 'scripts/load/shooter-benchmark/compose.ci.yml', '--profile', 'shooter-verification'];
const delay = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done();
});
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new InstrumentationFailure('browser_background_observer_deadline')), ms); })]); }
  finally { clearTimeout(timer!); }
}
export async function startBrowserBackground(root: string) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark'
    || !/^\/tmp\/shooter-benchmark-[a-zA-Z0-9_-]+$/.test(root)
    || (process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350') throw new InstrumentationFailure('browser_background_disposable_profile_required');
  const ids = new Map<string, string>(), role = (name: string): ServerRole => name === 'replay' ? 'verifier' : name === 'metrics-observer' ? 'observer' : name as ServerRole;
  for (const service of ['nakama', 'postgres', 'coordinator', 'replay', 'metrics-observer']) {
    const id = (await exec('docker', ['compose', ...composeFiles, 'ps', '-q', service], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new InstrumentationFailure('browser_background_stack_identity_missing'); ids.set(service, id);
  }
  const original = JSON.parse(await readFile(join(root, 'stack-identities.json'), 'utf8'));
  if (original.nakama !== ids.get('nakama') || original.postgres !== ids.get('postgres')) throw new InstrumentationFailure('browser_background_stack_identity_changed');
  const roleLimits = await Promise.all([...ids].map(([service, id]) => observeContainerLimits(role(service), id)));
  const images = await Promise.all([...ids].map(async ([service, id]) => ({ role: service, digest: (await exec('docker', ['inspect', '--format', '{{.Image}}', id], { timeout: 5000, maxBuffer: 1024, encoding: 'utf8' })).stdout.trim() })));
  const global = new AbortController(), observationStop = new AbortController();
  let expired = false, closed = false;
  const timer = setTimeout(() => { expired = true; global.abort(); }, 900000);
  const start = performance.now(), background = new BackgroundTraffic('http://127.0.0.1:7350', `browser-${process.env.GITHUB_RUN_ID}`);
  const samples: CgroupSample[] = [], metrics: Record<string, unknown>[] = [];
  const observations: { elapsedMs: number; category: 'observed' | 'sut_unavailable' | 'instrumentation_failure' | 'censored'; reason: string | null; context: Record<string, unknown> }[] = [];
  const pendingComponents = new Set<string>();
  const sampleSignal = AbortSignal.any([global.signal, observationStop.signal]);
  async function server(signal: AbortSignal): Promise<void> {
    const [rows, output] = await Promise.all([
      Promise.all([...ids].map(([service, id]) => observeContainer(role(service), id))),
      exec('docker', ['exec', ids.get('metrics-observer')!, 'cat', '/tmp/metrics.json'], { signal, timeout: 2000, maxBuffer: 65536, encoding: 'utf8' }),
    ]);
    const snapshot = JSON.parse(output.stdout);
    if (!Number.isFinite(snapshot.asOf) || snapshot.asOf > Date.now() || Date.now() - snapshot.asOf > 5000) throw new InstrumentationFailure('browser_coordinator_metrics_stale');
    if (snapshot.state !== 'observed') throw new SutUnavailable('browser_coordinator_metrics_unavailable');
    if (signal.aborted || closed) return;
    if (samples.length + rows.length > 10000 || metrics.length >= 2000) throw new InstrumentationFailure('browser_server_samples_bound');
    samples.push(...rows); metrics.push({ observedAt: new Date().toISOString(), ...snapshot.metrics });
  }
  const observing = (async () => {
    while (!sampleSignal.aborted) {
      const sampleStartedMonoMs = performance.now();
      const one = AbortSignal.any([sampleSignal, AbortSignal.timeout(5000)]);
      let category: typeof observations[number]['category'] = 'observed', reason: string | null = null;
      try {
        // Parallel reads cannot leave sequential slots outside the5s budget.
        const component = async (name: string, read: () => Promise<void>) => { pendingComponents.add(name); try { await read(); } finally { pendingComponents.delete(name); } };
        const replies = await bounded(Promise.allSettled([component('server', () => server(one)), component('background', () => background.observe(one))]), 5000);
        for (const reply of replies) if (reply.status === 'rejected') throw reply.reason;
      } catch (error) {
        category = sampleSignal.aborted ? 'censored' : error instanceof SutUnavailable ? 'sut_unavailable' : 'instrumentation_failure';
        reason = sampleSignal.aborted ? 'measurement_window_closed' : one.aborted ? 'observer_sample_deadline' : error instanceof SutUnavailable || error instanceof InstrumentationFailure ? error.reason : 'browser_background_read_exception';
      }
      if (!closed) observations.push({ elapsedMs: performance.now() - start, category, reason, context: { pendingComponents: [...pendingComponents], sampleStartedMonoMs, finishedMonoMs: performance.now(), readElapsedMs: performance.now() - sampleStartedMonoMs, readBudgetMs: 5000, background: background.observationContext() } });
      if (observations.length >= 2000) { global.abort(); break; }
      await delay(1000, sampleSignal);
    }
  })();
  try { await background.start(20, 10, global.signal); }
  catch { global.abort(); observationStop.abort(); clearTimeout(timer); await bounded(observing, 5000).catch(() => {}); await bounded(background.stop(), 5000).catch(() => {}); throw new InstrumentationFailure('browser_actual_background_start_failed'); }
  let finished: Promise<Record<string, unknown>> | null = null;
  return {
    signal: global.signal,
    finish(): Promise<Record<string, unknown>> {
      if (finished) return finished;
      finished = (async () => {
        observationStop.abort(); global.abort(); clearTimeout(timer);
        let cleanupFailed = false;
        const cleanup = await Promise.allSettled([bounded(observing, 5000), bounded(background.stop(), 5000)]);
        cleanupFailed = cleanup.some(reply => reply.status === 'rejected');
        closed = true;
        const elapsedMs = performance.now() - start;
        const count = (category: typeof observations[number]['category']) => observations.filter(o => o.category === category).length;
        const failures = count('instrumentation_failure'), unavailable = count('sut_unavailable');
        const cpu = [...new Set(samples.map(s => s.role))].map(name => { const rows = samples.filter(s => s.role === name); return { role: name, ...cpuDelta(rows[0], rows[rows.length - 1]) }; });
        const availability = background.coverage.reduce((n, row) => ({ attempted: n.attempted + row.attemptedMetrics, observed: n.observed + row.successfulMetrics, confirmedEndedDuringRead: n.confirmedEndedDuringRead + row.confirmedEndMetricMisses }), { attempted: 0, observed: 0, confirmedEndedDuringRead: 0 });
        const shortTrafficProof = shortInputCoverage(background.matchObservations, 10);
        const missingMetrics = availability.attempted - availability.observed - availability.confirmedEndedDuringRead;
        return structuredClone({ summary: { harnessStatus: expired || cleanupFailed || failures ? 'failed' : 'complete', workloadStatus: unavailable || missingMetrics || !shortTrafficProof.complete ? 'degraded' : 'complete', elapsedMs, observerAttempts: observations.length, observerSuccessful: count('observed'), observerUnavailable: unavailable, observerInstrumentationFailures: failures, observerCensored: count('censored'), cleanupFailed, overallDeadlineExpired: expired, backgroundMetricAvailability: { ...availability, unobservedAttempts: missingMetrics }, shortTrafficProof,
          inputProof: { ...inputCoverage(background.matchObservations, start, elapsedMs, 10), requirement: 'Short public-prefix profile records growth and normal ends; does not claim sustained replacement-round coverage when no90s end occurs.' } },
          provenance: { images, roleLimits },
          measurements: { cpu: { deltas: cpu, observer: 'actual_container_cgroup_v2', sampleCount: samples.length }, queue: { observer: 'safe_actual_coordinator_aggregate', sampleCount: metrics.length }, matchTick: { observer: 'actual_shooter_metrics_rpc', aggregation: 'per_match_quantiles_not_p95_of_p95', sampleCount: background.matchObservations.length, availability }, sqlWall: { value: null, reason: 'No per-query instrumentation installed; gateway opsDbWallMs remains separately sampled.' }, gc: { value: null, reason: 'Runtime GC instrumentation unavailable.' } },
          evidence: { serverCgroupSamples: samples, safeCoordinatorSamples: metrics, actualMatchQuantiles: background.matchObservations, actualMatchEnds: background.matchEnds, backgroundTransitions: background.controlTransitions, backgroundParticipants: background.participantEvidence(), backgroundMetricReads: background.metricReads, backgroundCoverage: background.coverage, backgroundRejections: background.rejectionCounts, periodicObserverSamples: observations } });
      })();
      return finished;
    },
  };
}
