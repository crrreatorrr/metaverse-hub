// Actual production Game/SDK in20 independent contexts. No seed/state/network
// override. Caller supplies legitimate server-authenticated session DTOs and a
// scoped owner-status reader; credentials never enter returned measurements.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { initActualRewardPage } from '../../shooter-verification/real-browser-helper.mjs';
import { installBrowserFrameObserver, stopBrowserFrameObserver } from './browser-observer.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const bounded = (promise, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(new Error('deadline'));
  if (signal.aborted) { promise.catch(() => {}); reject(new Error('deadline')); return; }
  signal.addEventListener('abort', abort, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SHA = /^[a-f0-9]{64}$/;
function assert(value, reason) { if (!value) throw new Error(reason); }
function quantiles(values) {
  if (!values.length) return { value: null, sampleCount: 0, unavailableReason: 'no observed browser frame intervals' };
  const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { value: { p50: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1), method: 'nearest_rank' }, sampleCount: sorted.length, unavailableReason: null };
}
function captureSummary(rows, runId) {
  const source = rows.filter(row => row.body.runId === runId).sort((a, b) => a.body.sequence - b.body.sequence);
  let frames = 0;
  for (let i = 0; i < source.length; i++) {
    const body = source[i].body;
    assert(body.protocol === 2 && body.sequence === i && body.tick0 === frames && Number.isSafeInteger(body.n) && body.n > 0, 'noncontiguous actual browser append');
    assert(typeof body.frames === 'string' && body.frames.length === body.n * 16, 'actual browser frame encoding mismatch');
    frames += body.n;
  }
  return { submittedFrames: frames, submittedInputSha256: source.length ? hash(source.map(row => row.wire).join('\n')) : null,
    submittedHashMeaning: 'sha256 of newline-joined actual unique canonical append wires in sequence order',
    uniqueBatches: source.length, wireBytes: source.reduce((n, row) => n + Buffer.byteLength(row.wire), 0), attempts: source.reduce((n, row) => n + row.attempts, 0) };
}
export async function runPublicBrowserCohort({ browser, url, actors, readOwnerStatus, signal, maxDurationMs = 900000, viewport = { width: 640, height: 480 } }) {
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.HUB_SHOOTER_FIXTURE === 'benchmark', 'explicit disposable browser benchmark required');
  const target = new URL(url);
  assert(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && !target.username && !target.password && !target.hash && !target.search, 'local production-page origin required');
  assert(Number.isSafeInteger(maxDurationMs) && maxDurationMs > 0 && maxDurationMs <= 900000, 'bounded browser scenario required');
  assert(Array.isArray(actors) && actors.length === 20, 'twenty actual browser identities required');
  for (const field of ['accountBindingHash', 'sessionBindingHash']) assert(actors.every(a => SHA.test(a[field])) && new Set(actors.map(a => a[field])).size === 20, 'independent actual browser bindings required');
  assert(typeof readOwnerStatus === 'function', 'scoped actual owner-status reader required');
  for (const actor of actors) assert(actor.session && actor.accountBindingHash === hash(actor.session.playerId) && actor.sessionBindingHash === hash(actor.session.sid), 'browser identity hashes must bind legitimate session DTOs');
  const scope = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(maxDurationMs)]), start = performance.now();
  assert(browser.contexts().length === 0, 'dedicated benchmark browser required');
  const actualBrowserVersion = browser.version();
  const handles = new Array(20), results = new Array(20), rawFrameRecords = [], runIds = new Set();
  let accountingOpen = true;
  await Promise.all(actors.map(async (actor, i) => {
    const row = { actor: i, accountBindingHash: actor.accountBindingHash, sessionBindingHash: actor.sessionBindingHash, runBindingHash: null, boss: actor.boss, seed: null,
      status: 'not_started', rawReason: null, recordedFrames: 0, recordedInputSha256: null, recordedHashUnavailableReason: 'not yet recorded', submittedFrames: 0, submittedInputSha256: null, acceptedTick: 0, verifiedTick: 0,
      everObservedEligible: false, paid: false, firstEligibleObservedMs: null, endToEndPaidMs: null, clientFrames: { value: null, sampleCount: 0, unavailableReason: 'not observed' } };
    results[i] = row;
    try {
      if (scope.aborted) throw new Error('deadline');
      const handle = await bounded(initActualRewardPage({ browser, url, session: actor.session, contextOptions: { viewport }, timeoutMs: 90000 }), scope);
      handles[i] = handle;
      if (scope.aborted || !accountingOpen) throw new Error('deadline');
      await bounded(handle.page.evaluate(installBrowserFrameObserver, { maxSamples: 60000 }), scope);
      const flow = await bounded(handle.start({ boss: actor.boss }), scope);
      assert(typeof flow.runId === 'string' && !runIds.has(flow.runId), 'independent server-selected browser run required'); runIds.add(flow.runId);
      row.runBindingHash = hash(flow.runId);
      // Real DOM controls only. Captured wire remains the actual producer; the
      // load generator never fabricates a trace from these controls afterwards.
      await bounded(handle.page.keyboard.down('KeyW'), scope);
      await bounded(handle.page.mouse.move(viewport.width / 2, viewport.height / 2), scope);
      await bounded(handle.page.mouse.down(), scope);
      for (;;) {
        if (scope.aborted) { row.status = 'censored'; row.rawReason = 'overall_browser_deadline'; break; }
        const snapshot = await bounded(handle.readSnapshot(), scope), status = await bounded(readOwnerStatus(i, flow.runId, scope), scope);
        if (scope.aborted || !accountingOpen) { row.status = 'censored'; row.rawReason = 'overall_browser_deadline'; break; }
        const capture = captureSummary(handle.capturedAppends(), flow.runId);
        Object.assign(row, capture, { recordedFrames: snapshot.recordedTick, acceptedTick: status.received?.tick ?? 0, verifiedTick: status.verified?.tick ?? 0 });
        assert(row.verifiedTick <= row.acceptedTick && row.acceptedTick <= row.submittedFrames && row.submittedFrames <= row.recordedFrames, 'actual browser cursor mismatch');
        row.recordedInputSha256 = null; row.recordedHashUnavailableReason = 'Game record byte observer not installed; submitted wire hash is separately observed';
        const issued = status.issuanceAck?.issuance;
        if (Number.isSafeInteger(issued?.seed)) row.seed = issued.seed;
        const payment = status.payment?.state;
        if (['paid', 'pending', 'authorization_denied'].includes(payment)) { row.everObservedEligible = true; row.firstEligibleObservedMs ??= performance.now() - start; }
        if (snapshot.sealed && row.recordedFrames > 0 && row.verifiedTick === row.recordedFrames && status.terminal) {
          if (payment === 'paid') { row.status = 'paid'; row.paid = true; row.endToEndPaidMs = performance.now() - start; break; }
          if (payment === 'ineligible') { row.status = 'verified_nonpayable'; row.rawReason = status.terminal.outcome; break; }
          if (payment === 'authorization_denied') { row.status = 'authorization_denied'; row.rawReason = status.payment.reason; break; }
        }
        await pause(500);
      }
      const frame = await bounded(handle.page.evaluate(stopBrowserFrameObserver), scope);
      row.clientFrames = { ...quantiles(frame.samples), metric: frame.metric, clockDomain: frame.clockDomain, truncated: frame.truncated, observedFrames: frame.observedFrames, scopedWallMs: frame.scopedWallMs,
        gameWindow: { value: frame.gameWindow, observedAt: frame.gameWindowObservedAt, lookbackSeconds: frame.gameWindowLookbackSeconds, maximumFrames: frame.gameWindowMaximumFrames } };
      if (frame.truncated) { row.status = 'instrumentation_failure'; row.rawReason = 'browser_frame_evidence_limit'; }
      rawFrameRecords.push({ actor: i, runBindingHash: row.runBindingHash, frameIntervalsMs: frame.samples });
      const diagnostics = await bounded(handle.safeDiagnostics(), scope);
      row.diagnostics = { boot: diagnostics.boot, capture: diagnostics.capture, consoleErrors: diagnostics.consoleErrors, pageErrors: diagnostics.pageErrors, viewport: diagnostics.game.viewport, visibility: diagnostics.game.visibility, crash: diagnostics.game.crash };
    } catch { row.status = scope.aborted ? 'censored' : 'instrumentation_failure'; row.rawReason = scope.aborted ? 'overall_browser_deadline' : 'unclassified_browser_operation'; }
    finally { if (handles[i]) await bounded(handles[i].close().catch(() => {}), AbortSignal.timeout(5000)).catch(() => {}); }
  }));
  accountingOpen = false;
  if (scope.aborted) await bounded(browser.close(), AbortSignal.timeout(5000)).catch(() => {});
  const eligible = results.filter(r => r.everObservedEligible), paid = results.filter(r => r.paid);
  return { authority: 'ci_advisory', profile: 'public_browser_real_time', productionCapacityConclusion: null,
    actualBrowserVersion, viewport, maxDurationMs, elapsedMs: performance.now() - start,
    evidenceLimits: { contexts: 20, perContextAppendCaptureBytes: 4194304, maximumFrameSamplesPerContext: 60000 },
    actors: results, summary: { accountedActors: results.length, eligible: eligible.length, paid: paid.length, eligibleUnpaid: eligible.filter(r => !r.paid).length,
      eligibleCensored: eligible.filter(r => r.status === 'censored').length, rawReasons: results.reduce((out, r) => { const key = `${r.status}:${r.rawReason ?? 'unspecified'}`; out[key] = (out[key] ?? 0) + 1; return out; }, {}),
      harnessStatus: results.some(r => r.status === 'instrumentation_failure') ? 'failed' : scope.aborted ? 'interrupted' : 'complete' }, rawFrameRecords };
}
