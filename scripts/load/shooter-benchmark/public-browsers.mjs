// Actual production Game/SDK in20 independent contexts. Public random issuance,
// real DOM controls and a deliberately bounded prefix; not full-corpus capacity.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { initActualRewardPage } from '../../shooter-verification/real-browser-helper.mjs';
import { boundOwnerStatus, browserActorCounts, recordPaymentFacts, successfulPaid, safeReason, clientStartOutcome, serviceOutcome, outcomeError } from './browser-accounting.mjs';
import { installBrowserFrameObserver, stopBrowserFrameObserver } from './browser-observer.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const MAX_FRAME_SAMPLES = 4096;
function assert(value, reason) { if (!value) throw new Error(reason); }
const bounded = (promise, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(new Error('deadline'));
  if (signal.aborted) { promise.catch(() => {}); reject(new Error('deadline')); return; }
  signal.addEventListener('abort', abort, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
const pause = (ms, signal) => bounded(new Promise(resolve => setTimeout(resolve, ms)), signal);
function quantiles(values) {
  if (!values.length) return { value: null, sampleCount: 0, unavailableReason: 'no observed browser frame intervals' };
  const sorted = [...values].sort((a, b) => a - b), q = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { value: { p50: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1), method: 'nearest_rank' }, sampleCount: sorted.length, unavailableReason: null };
}
function captureSummary(rows, runId, decodeFrames) {
  const source = rows.filter(row => row.body.runId === runId).sort((a, b) => a.body.sequence - b.body.sequence);
  let frames = 0, moving = 0, firing = 0;
  for (let i = 0; i < source.length; i++) {
    const body = source[i].body;
    assert(body.protocol === 2 && body.sequence === i && body.tick0 === frames && Number.isSafeInteger(body.n) && body.n > 0, 'browser_capture_noncontiguous');
    const decoded = decodeFrames(body.frames, body.n, body.actions);
    assert(decoded.commands?.length === body.n, 'browser_capture_decode_failed');
    moving += decoded.commands.filter(command => command.moveZ !== 0 || command.moveX !== 0).length;
    firing += decoded.commands.filter(command => command.held.fire).length;
    frames += body.n;
  }
  return { submittedFrames: frames, submittedInputSha256: source.length ? hash(source.map(row => row.wire).join('\n')) : null,
    submittedHashMeaning: 'sha256 of newline-joined actual unique canonical append wires in sequence order',
    uniqueBatches: source.length, wireBytes: source.reduce((n, row) => n + Buffer.byteLength(row.wire), 0),
    attempts: source.reduce((n, row) => n + row.attempts, 0), observedMovementFrames: moving, observedFireFrames: firing };
}
// Observe known service outcomes without making helper.start's active-only
// wait turn a genuine denial into an unexplained browser timeout.
async function startMeasuredRun(handle, boss, signal) {
  let failure = null, requestFailed = false;
  const reads = [];
  const onResponse = response => {
    let path;
    try { path = new URL(response.url()).pathname; } catch { return; }
    if (!['/v2/rpc/shooter.run.issue', '/v2/rpc/shooter.run.status'].includes(path) || reads.length >= 16) return;
    const read = (async () => {
      if (response.status() === 429 || response.status() === 503) {
        failure = { state: 'pending_retryable', reason: `http_${response.status()}` }; return;
      }
      const bytes = await bounded(response.body(), AbortSignal.any([signal, AbortSignal.timeout(10000)]));
      if (bytes.length > 65536) return;
      let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { return; }
      if (!value.received && serviceOutcome(value)) failure = value;
    })().catch(() => {});
    reads.push(read);
  };
  const onRequestFailed = request => {
    let path; try { path = new URL(request.url()).pathname; } catch { return; }
    if (['/v2/rpc/shooter.run.issue', '/v2/rpc/shooter.run.status'].includes(path)) requestFailed = true;
  };
  handle.page.on('requestfailed', onRequestFailed);
  handle.page.on('response', onResponse);
  try {
    await bounded(handle.page.locator('[data-go="rewarded"]').click(), signal);
    await bounded(handle.page.locator('[data-reward-boss]').selectOption(boss), signal);
    await bounded(handle.page.locator('[data-reward-start]').click(), signal);
    await bounded(handle.page.waitForFunction(() => {
      const flow = window.__game.rewardedCampaign;
      return flow.active || !flow.startBusy;
    }), signal);
    const result = await bounded(handle.page.evaluate(() => ({ snapshot: window.__game.rewardedCampaign.snapshot(),
      errorCode: window.__game.rewardedCampaign.current?.errorCode || null })), signal);
    if (result.snapshot.active) return result.snapshot;
    await bounded(Promise.all(reads), signal);
    if (failure) throw outcomeError(failure);
    const local = clientStartOutcome(result.errorCode, { requestFailed });
    if (local) throw outcomeError({ state: local.serviceState, reason: local.rawReason });
    throw new Error('unknown_browser_start_outcome');
  } finally { handle.page.off('response', onResponse); handle.page.off('requestfailed', onRequestFailed); }
}

// Freeze gameplay through native browser release and actual reward status DOM.
// No Game/input/state/clock mutation. Back requests the normal final-tail finish.
async function stopPrefix(handle, signal) {
  await bounded(handle.page.keyboard.up('KeyW'), signal);
  await bounded(handle.page.mouse.up(), signal);
  await bounded(handle.page.evaluate(() => document.exitPointerLock()), signal);
  await bounded(handle.page.waitForFunction(() => document.pointerLockElement === null), signal);
  if (!await bounded(handle.page.locator('[data-reward-panel]').count(), signal)) {
    await bounded(handle.page.locator('[data-reward-status]').click(), signal);
  }
  await bounded(handle.page.waitForFunction(() => window.__game.rewardedCampaign.snapshot().paused), signal);
  const frozen = await bounded(handle.readSnapshot(), signal);
  assert(frozen.active && frozen.paused && !frozen.recording, 'browser_final_pause_not_observed');
  await bounded(handle.page.locator('[data-reward-action="back"]').click(), signal);
  return frozen;
}
export async function runPublicBrowserCohort({ browser, url, actors, readOwnerStatus, decodeFrames, signal,
  maxDurationMs = 900000, prefixTicks = 120, maxRecordingMs = 30000, paymentObservationMs = 120000,
  viewport = { width: 640, height: 480 } }) {
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.HUB_SHOOTER_FIXTURE === 'benchmark', 'explicit_disposable_browser_benchmark_required');
  const target = new URL(url);
  assert(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname) && !target.username && !target.password && !target.hash && !target.search, 'local_production_page_required');
  assert(Number.isSafeInteger(maxDurationMs) && maxDurationMs > 0 && maxDurationMs <= 900000
    && Number.isSafeInteger(prefixTicks) && prefixTicks > 0 && prefixTicks <= 3600
    && Number.isSafeInteger(maxRecordingMs) && maxRecordingMs > 0 && maxRecordingMs <= maxDurationMs
    && Number.isSafeInteger(paymentObservationMs) && paymentObservationMs > 0 && paymentObservationMs <= 120000, 'bounded_browser_profile_required');
  assert(Array.isArray(actors) && actors.length === 20 && typeof readOwnerStatus === 'function' && typeof decodeFrames === 'function', 'twenty_actual_browser_actors_required');
  for (const field of ['accountBindingHash', 'sessionBindingHash']) assert(actors.every(a => SHA.test(a[field])) && new Set(actors.map(a => a[field])).size === 20, 'independent_actual_browser_bindings_required');
  for (const actor of actors) assert(actor.session && actor.accountBindingHash === hash(actor.session.playerId) && actor.sessionBindingHash === hash(actor.session.sid), 'browser_session_binding_mismatch');
  assert(browser.contexts().length === 0, 'dedicated_benchmark_browser_required');
  const scope = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(maxDurationMs)]), start = performance.now();
  const actualBrowserVersion = browser.version(), results = new Array(20), rawFrameRecords = [], runIds = new Set();
  await Promise.all(actors.map(async (actor, i) => {
    const row = { actor: i, accountBindingHash: actor.accountBindingHash, sessionBindingHash: actor.sessionBindingHash,
      runBindingHash: null, boss: actor.boss, seed: null, stage: 'boot', status: 'not_started', rawReason: null, stopReason: null,
      recordedFrames: null, recordedInputSha256: null, recordedHashUnavailableReason: 'Game record byte observer not installed; submitted wire is separately observed',
      submittedFrames: null, submittedInputSha256: null, acceptedTick: null, verifiedTick: null, liveCursorResamples: 0,
      finalPausedProof: false, finalCoherentProof: false, finishRequested: false, finishAckObserved: false, serverClosed: false,
      everObservedEligible: false, eligibilityState: 'unknown', eligibilityEvidence: null, paymentObservation: 'not_observed', observedPaid: false, paid: false, paymentCensored: false,
      milestones: {}, controlObservations: { total: 0, visible: 0, focused: 0, pointerLocked: 0, inputEnabled: 0 }, clientFrames: { value: null, sampleCount: 0, unavailableReason: 'not observed' } };
    results[i] = row;
    let handle = null, observerInstalled = false, runId = null, frozenTick = null;
    const mark = name => { row.milestones[name] ??= performance.now() - start; };
    function observe(snapshot, status, rows, strict) {
      boundOwnerStatus(status, runId);
      const capture = captureSummary(rows, runId, decodeFrames);
      const received = status.received?.tick, verified = status.verified?.tick;
      assert(Number.isSafeInteger(received) && Number.isSafeInteger(verified) && verified >= 0 && verified <= received, 'browser_owner_cursor_invalid');
      const recorded = strict ? frozenTick : snapshot.recordedTick;
      const coherent = received <= capture.submittedFrames && capture.submittedFrames <= recorded;
      if (strict) assert(coherent, 'browser_final_cursor_mismatch');
      else if (!coherent) row.liveCursorResamples++;
      // Live status/capture/DOM samples have different observation times. Only
      // the explicitly frozen final count supplies a strict common upper bound.
      Object.assign(row, capture, { recordedFrames: recorded, acceptedTick: received, verifiedTick: verified });
      if (received > 0) mark('firstAcceptedObservedMs');
      if (verified > 0) mark('firstVerifiedObservedMs');
      if (Number.isSafeInteger(status.issuanceAck?.issuance?.seed)) row.seed = status.issuanceAck.issuance.seed;
      if (status.terminal) mark('terminalObservedMs');
      if (status.sealAck) {
        if (strict) assert(status.sealAck.lastTick === frozenTick && status.sealAck.lastSequence === capture.uniqueBatches - 1, 'browser_finish_ack_mismatch');
        row.finishAckObserved = true; mark('finishAckObservedMs');
      }
      row.serverClosed = status.state !== 'open';
      return coherent;
    }
    try {
      mark('actorStartedMs');
      const creation = initActualRewardPage({ browser, url, session: actor.session, contextOptions: { viewport }, timeoutMs: 90000 });
      creation.then(value => { if (scope.aborted) void value.close().catch(() => {}); }, () => {});
      handle = await bounded(creation, scope);
      await bounded(handle.page.evaluate(installBrowserFrameObserver, { maxSamples: MAX_FRAME_SAMPLES }), scope); observerInstalled = true;
      const flow = await startMeasuredRun(handle, actor.boss, scope);
      assert(typeof flow.runId === 'string' && !runIds.has(flow.runId), 'browser_run_binding_not_independent'); runIds.add(flow.runId); runId = flow.runId;
      row.runBindingHash = hash(runId); mark('issuedObservedMs');
      row.stage = 'dom_controls';
      if (flow.phase === 'playing' && flow.recording) {
        // Native gesture/keyboard edges after install; install intentionally
        // clears held title inputs. Never fabricate commands from these inputs.
        const box = await bounded(handle.page.locator('#view canvas').boundingBox(), scope);
        assert(box, 'browser_canvas_missing');
        const locked = await bounded(handle.page.evaluate(() => document.pointerLockElement !== null), scope);
        if (!locked) await bounded(handle.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2), scope);
        await bounded(handle.page.waitForFunction(() => document.pointerLockElement !== null && window.__game.input.locked), scope);
        await bounded(handle.page.keyboard.down('KeyW'), scope);
        await bounded(handle.page.mouse.down(), scope); mark('domControlsStartedMs');
      }
      row.stage = 'recording';
      const activeStart = performance.now();
      for (;;) {
        const status = await bounded(readOwnerStatus(i, runId, scope), scope);
        recordPaymentFacts(row, status, runId, performance.now() - start);
        const rows = handle.capturedAppends();
        const observed = await bounded(handle.page.evaluate(() => ({ snapshot: window.__game.rewardedCampaign.snapshot(),
          visible: document.visibilityState === 'visible', focused: document.hasFocus(),
          pointerLocked: document.pointerLockElement !== null, inputEnabled: window.__game.input.enabled })), scope);
        row.controlObservations.total++;
        for (const key of ['visible', 'focused', 'pointerLocked', 'inputEnabled']) if (observed[key]) row.controlObservations[key]++;
        const snapshot = observed.snapshot;
        observe(snapshot, status, rows, false);
        if (snapshot.phase === 'ended') { row.stopReason = 'legitimate_local_terminal'; break; }
        if (!snapshot.active || ['error', 'paused', 'cancelled', 'unranked'].includes(snapshot.phase)) { row.stopReason = 'rewarded_recording_stopped'; break; }
        if (snapshot.recordedTick >= prefixTicks) { row.stopReason = 'planned_public_prefix_ticks'; break; }
        if (performance.now() - activeStart >= maxRecordingMs) { row.stopReason = 'planned_public_prefix_wall_limit'; break; }
        await pause(500, scope);
      }
      row.stage = 'planned_dom_stop';
      const frozen = await stopPrefix(handle, scope); frozenTick = frozen.recordedTick;
      row.stage = 'finish_and_verify';
      row.recordedFrames = frozenTick; row.finalPausedProof = true; row.finishRequested = true; mark('finalPausedObservedMs');
      // The count was sampled while paused BEFORE Back; UI may prune a resolved
      // run afterwards, so never replace this immutable count with a later0.
      for (;;) {
        const status = await bounded(readOwnerStatus(i, runId, scope), scope);
        recordPaymentFacts(row, status, runId, performance.now() - start);
        // Flush prior CDP request notifications before reading capture.
        await bounded(handle.readSnapshot(), scope);
        const rows = handle.capturedAppends();
        observe(frozen, status, rows, true);
        const complete = row.acceptedTick === frozenTick && row.verifiedTick === frozenTick && row.submittedFrames === frozenTick;
        if (complete) row.finalCoherentProof = true;
        if (complete && status.terminal && row.serverClosed) {
          if (row.observedPaid) { row.status = 'paid'; break; }
          if (status.payment?.state === 'ineligible') { row.status = 'verified_nonpayable'; row.rawReason = safeReason(status.terminal.outcome, 'unknown_terminal_outcome'); break; }
          if (status.payment?.state === 'authorization_denied') { row.status = 'authorization_denied'; row.rawReason = safeReason(status.payment.reason, 'authorization_denied'); break; }
        }
        if (status.state === 'invalid') { row.status = 'rejected'; row.rawReason = safeReason(status.reason, 'server_invalid'); break; }
        if (status.state === 'quarantined') { row.status = 'operational_failure'; row.rawReason = safeReason(status.reason, 'server_quarantined'); break; }
        if (row.everObservedEligible && performance.now() - start - row.milestones.firstEligibleObservedMs >= paymentObservationMs) {
          row.status = 'payment_pending'; row.paymentCensored = true; row.rawReason = 'payment_observation_window'; break;
        }
        await pause(500, scope);
      }
    } catch (error) {
      const known = error?.message === 'known_service_outcome' && serviceOutcome({ state: error.outcome?.serviceState, reason: error.outcome?.rawReason });
      if (known) { row.status = known.status; row.rawReason = known.rawReason; }
      else { row.status = scope.aborted ? 'censored' : error?.message === 'owner_status_unavailable' ? 'operational_failure' : 'instrumentation_failure';
      row.rawReason = scope.aborted ? 'overall_browser_deadline' : error?.name === 'TimeoutError' ? 'browser_operation_deadline' : error?.message === 'owner_status_unavailable' ? 'owner_status_unavailable' : 'unclassified_browser_operation'; }
    }
    finally {
      if (handle) {
        // Bounded readback/close after the measurement deadline does not extend
        // recording/payment windows. Preserve already-observed censored data.
        const cleanup = AbortSignal.timeout(5000);
        try {
          if (observerInstalled) {
            const frame = await bounded(handle.page.evaluate(stopBrowserFrameObserver), cleanup);
            row.clientFrames = { ...quantiles(frame.samples), metric: frame.metric, clockDomain: frame.clockDomain,
              truncated: frame.truncated, quantileScope: frame.truncated ? 'first4096 active-recording intervals; later intervals counted but not retained' : 'all observed active-recording intervals', observedFrames: frame.observedFrames, scopedWallMs: frame.scopedWallMs,
              gameWindow: { value: frame.gameWindow, observedAt: frame.gameWindowObservedAt, lookbackSeconds: frame.gameWindowLookbackSeconds, maximumFrames: frame.gameWindowMaximumFrames } };
            rawFrameRecords.push({ actor: i, runBindingHash: row.runBindingHash, frameIntervalsMs: frame.samples });
          }
          const d = await bounded(handle.safeDiagnostics(), cleanup);
          row.diagnostics = { boot: d.boot, capture: d.capture, consoleErrors: d.consoleErrors, pageErrors: d.pageErrors,
            viewport: d.game.viewport, visibility: d.game.visibility, crash: d.game.crash };
          if (d.capture.error || d.game.crash.total) { row.status = 'instrumentation_failure'; row.rawReason = d.capture.error ? 'browser_capture_failed' : 'browser_game_crashed'; }
        } catch { row.readbackUnavailableReason = 'bounded_postmeasurement_readback_failed'; }
        await bounded(handle.close().catch(() => {}), AbortSignal.timeout(5000)).catch(() => {});
        row.paid = successfulPaid(row);
      }
    }
  }));
  if (scope.aborted) await bounded(browser.close(), AbortSignal.timeout(5000)).catch(() => {});
  return { authority: 'ci_advisory', profile: 'twenty_public_browser_bounded_prefix', productionCapacityConclusion: null,
    actualBrowserVersion, viewport, maxDurationMs, prefixTicks, maxRecordingMs, paymentObservationMs, elapsedMs: performance.now() - start,
    limits: 'Public-prefix DOM profile; not full9634/full24000 traces, sustained capacity, browser attestation or human control feel. Recorded-byte hash remains unknown; only actual submitted wire is hashed.',
    evidenceLimits: { contexts: 20, perContextAppendCaptureBytes: 4194304, maximumUniqueBatchesPerContext: 256, maximumFrameSamplesPerContext: MAX_FRAME_SAMPLES, totalReportAndFrameArtifactBytes: 8388608 },
    actors: results, summary: { ...browserActorCounts(results),
      harnessStatus: results.some(r => r.status === 'instrumentation_failure') ? 'failed' : scope.aborted ? 'interrupted' : 'complete' }, rawFrameRecords };
}
