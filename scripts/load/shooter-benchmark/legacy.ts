// Actual existing v1 Nakama RPCs. No new production engine/fallback selector.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { guest, openGame, psqlAsync, type GameLogin } from '../../../server/test/dup/harness.ts';
import { buildCanonicalFixtureIssuance, loadFrozenTrace, type FrozenTrace } from '../../../server/test/dup/shooter_verification_e2e_fixtures';
import { LEGACY_SEGMENT_FRAMES, ByteBudget, prepareReserved, sourceInputReservation, wireInputReservation } from './budget.ts';
import { legacyFailureClass, validLegacyPaidReceipt } from './legacy-policy.ts';
import { BackgroundTraffic } from './background.ts';
import { sha256, type Assignment, type Phase, type Plan } from './contracts.ts';
import { benchmarkRpc as call, BenchmarkRpcFailure } from './rpc.ts';
import type { ActorObservation } from './pipeline.ts';
import { OperationFailure, InstrumentationFailure, type Binding, type CampaignAdapter, type Execution, type SubmissionProgress } from './runner.ts';
interface LegacyActor { login: GameLogin; runId: string; issuance: Record<string, unknown>; trace: FrozenTrace }
export interface LegacyObservation extends ActorObservation { runBindingHash: string; wallMs: number; requestedFrames: number; checkpointTicks: number[]; rawReasons: string[]; receiptObservedPaid: boolean; fullSourceSubmitted: boolean; eligibilityObserved: 'eligible' | 'ineligible' | 'unknown'; paidTiming: null | { receiptClearMs: number | null; receiptScore: number | null; cumulativeVerifiedTick: number; cumulativeFrameMs: number; currentChunkFrames: number; semantics: string }; }
const currentPin = JSON.parse(readFileSync('server/modules/vendor/shooter-sim.pin.json', 'utf8')) as { protocol: number; contentFingerprint: string; sha256: string };
const object = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export class LegacyPipeline implements CampaignAdapter {
  readonly observations = new Map<string, LegacyObservation>();
  private readonly runIds = new Set<string>();
  readonly unsupportedPhases = ['retry_storm'] as const;
  readonly mode: 'legacy_full_goja' | 'legacy_segmented_goja';
  private actors = new Map<string, LegacyActor>();
  private background: BackgroundTraffic;
  private readonly budget: ByteBudget;
  private readonly activeExecutions = new Set<string>();
  private readonly inputReleases = new Map<string, () => void>();
  constructor(private plan: Plan, base: string, segmented: boolean, private sampleServer: (signal: AbortSignal) => Promise<void>) {
    this.mode = segmented ? 'legacy_segmented_goja' : 'legacy_full_goja';
    this.background = new BackgroundTraffic(base, plan.seed); this.budget = new ByteBudget(plan.maxQueuedBytes);
  }
  async prepare(assignment: Assignment, _wave: number, signal: AbortSignal): Promise<Binding> {
    const estimate = sourceInputReservation(assignment.frames, assignment.actions);
    const prepared = await prepareReserved(this.budget, estimate, async () => {
      if (signal.aborted) throw new Error('aborted');
      const login = await openGame((await guest()).token, 'sproto-shooter');
      if (signal.aborted) throw new Error('aborted');
      const trace = loadFrozenTrace(assignment.caseId), runId = randomUUID();
      if (trace.definition.frames !== assignment.frames || trace.definition.fixtureSha256 !== assignment.caseSha256 || trace.definition.legacyInputEnvelopeSha256 !== assignment.inputSha256) throw new InstrumentationFailure('legacy_assignment_source_mismatch');
      if (Buffer.byteLength(trace.frames) + Buffer.byteLength(JSON.stringify(trace.actions)) > estimate) throw new InstrumentationFailure('legacy_source_exceeds_reservation');
      const day = await psqlAsync("SELECT to_char((clock_timestamp() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD')");
      const issuance = buildCanonicalFixtureIssuance({ accountId: login.hub.userId, sessionId: login.sessionId, runId, day, canonicalBoss: trace.definition.boss, seed: trace.definition.seed });
      const ack = object(JSON.parse(await psqlAsync(`SELECT game.issue_shooter_run('${login.hub.userId}','${login.sessionId}','benchmark:${runId}','${runId}',${literal(day)},${literal(trace.definition.boss)},${trace.definition.seed},${literal(JSON.stringify(issuance))})::text`)));
      if (ack.ok !== true) throw new InstrumentationFailure('legacy_fixture_issuance_failed');
      assert.deepEqual(ack.issuance, issuance, 'actual legacy issuer preserves bound issuance');
      return { login, trace, runId, issuance };
    });
    try {
      if (signal.aborted) throw new Error('aborted');
      const actor = prepared.value;
      const binding = { accountBindingHash: sha256(actor.login.hub.userId), sessionBindingHash: sha256(actor.login.sessionId), runBindingHash: sha256(actor.runId) };
      this.inputReleases.set(binding.runBindingHash, prepared.release); this.actors.set(binding.runBindingHash, actor); this.runIds.add(actor.runId); return binding;
    } catch (error) { prepared.release(); throw error; }
  }
  async execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal, progress: (update: SubmissionProgress) => void): Promise<Execution> {
    if (phase.kind === 'retry_storm') { this.inputReleases.get(binding.runBindingHash)?.(); this.inputReleases.delete(binding.runBindingHash); this.actors.delete(binding.runBindingHash); return { status: 'unsupported', rawReason: 'legacy_retry_storm_not_yet_implemented', durablyVerified: false, payable: false, paid: false }; }
    const actor = this.actors.get(binding.runBindingHash); if (!actor) throw new Error('unknown legacy actor');
    this.activeExecutions.add(binding.runBindingHash);
    const start = performance.now(), target = assignment.behavior === 'abandon' ? Math.min(120, actor.trace.definition.frames) : actor.trace.definition.frames;
    const segmentFrames = this.mode === 'legacy_full_goja' ? target : LEGACY_SEGMENT_FRAMES;
    const observation: LegacyObservation = { runBindingHash: binding.runBindingHash, wallMs: 0, requestedFrames: 0, checkpointTicks: [], rawReasons: [], receiptObservedPaid: false, fullSourceSubmitted: false, eligibilityObserved: 'unknown', paidTiming: null, sourceFrames: assignment.frames, scheduledDispatchMonoMs: start, startedMonoMs: start, firstRequestMonoMs: null, completedMonoMs: null, submittedFrames: 0, appendAttempts: 0, receivedWallMs: null, uploadWorkWallMs: null, verifiedWallMs: null, finishAckWallMs: null, firstEligiblePendingWallMs: null, firstEligiblePendingToPaidMs: null, finishAckToPaidMs: null, rewardWallMs: null, paymentCensored: false, terminalOutcome: null, uploadFailureReason: null, synchronizedFinish: null };
    this.observations.set(binding.runBindingHash, observation);
    const submitted: object[] = [], wireReleases: (() => void)[] = [];
    try {
    let tick = 0, from: string | null = null, lastReason = 'unspecified';
    const state: SubmissionProgress = { submittedFrames: 0, submittedInputSha256: null, submittedHashMeaning: null, acceptedTick: 0, verifiedTick: 0, durablyVerified: false, payable: false, everObservedEligible: false, observedPaid: false };
    while (tick < target) {
      const n = Math.min(segmentFrames, target - tick);
      let segmentActions = 0;
      for (const action of actor.trace.actions) if (action[0] >= tick && action[0] < tick + n) segmentActions++;
      const wireBound = wireInputReservation(n, segmentActions);
      wireReleases.push(this.budget.reserve(wireBound));
      const log = { v: 1, binding: { accountId: actor.login.hub.userId, sessionId: actor.login.sessionId, day: actor.issuance.day, runId: actor.runId }, segments: [{ i: 0, from, tick0: tick, n, frames: actor.trace.frames.slice(tick * 16, (tick + n) * 16), actions: actor.trace.actions.filter(a => a[0] >= tick && a[0] < tick + n).map(a => [a[0] - tick, a[1]]) }] };
      if (Buffer.byteLength(JSON.stringify({ runId: actor.runId, log })) > wireBound) throw new InstrumentationFailure('legacy_request_exceeds_wire_reservation');
      submitted.push(log); state.submittedFrames = tick + n; state.submittedInputSha256 = sha256(JSON.stringify(submitted)); state.submittedHashMeaning = 'sha256_of_ordered_actual_v1_log_envelopes'; state.durablyVerified = state.verifiedTick === state.submittedFrames; progress({ ...state });
      observation.requestedFrames += n; observation.submittedFrames = state.submittedFrames; observation.appendAttempts++; observation.fullSourceSubmitted = state.submittedFrames === actor.trace.definition.frames;
      observation.firstRequestMonoMs ??= performance.now();
      let response;
      try { response = await call('shooter.run.submit', { runId: actor.runId, log }, actor.login.gameToken, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }); }
      catch (error) { observation.wallMs = performance.now() - start; if (error instanceof BenchmarkRpcFailure && !['rpc_transport_failure','rpc_response_read_failure'].includes(error.reason)) throw new InstrumentationFailure('legacy_' + error.reason); throw new OperationFailure('legacy_rpc_transport_timeout_or_failure'); }
      const body = object(response.body);
      const responseReason = body.reason ?? body.error;
      lastReason = typeof responseReason === 'string' && /^[a-z0-9_:.|-]{1,80}$/.test(responseReason) ? responseReason : `rpc_http_${response.status}`;
      observation.rawReasons.push(lastReason); observation.wallMs = performance.now() - start;
      if (body.paid === true && !validLegacyPaidReceipt(response.status, body, { runId: actor.runId, boss: actor.trace.definition.boss, day: actor.issuance.day, protocol: currentPin.protocol, fingerprint: currentPin.contentFingerprint })) throw new InstrumentationFailure('legacy_invalid_paid_receipt');
      observation.receiptObservedPaid ||= body.paid === true;
      if (body.paid === true) {
        observation.eligibilityObserved = 'eligible'; observation.rewardWallMs = performance.now() - start; observation.verifiedWallMs = observation.rewardWallMs;
        observation.paidTiming = { receiptClearMs: typeof body.clearMs === 'number' ? body.clearMs : null, receiptScore: typeof body.score === 'number' ? body.score : null, cumulativeVerifiedTick: tick + n, cumulativeFrameMs: Math.round((tick + n) * 1000 / 60), currentChunkFrames: n, semantics: this.mode === 'legacy_segmented_goja' ? 'Existing v1 receipt.frames counts the current chunk; clearMs/score may exclude prior verified chunks. Not ranking-equivalent to full-log or v2 first-terminal timing.' : 'Existing full-log v1 clearMs uses all frames in the submitted log; not assumed equal to v2 first-terminal timing.' };
        state.acceptedTick = tick + n; state.verifiedTick = tick + n; state.durablyVerified = true; state.everObservedEligible = true; state.observedPaid = true; state.payable = true; progress({ ...state });
      }
      if (response.status >= 400 || body.ok !== true) {
        const failure = legacyFailureClass(response.status, lastReason);
        if (failure === 'instrumentation_failure') throw new InstrumentationFailure(`legacy_unexpected_${lastReason}`.slice(0, 80));
        return { status: failure === 'timeout' ? 'timeout' : failure === 'authorization_denied' ? 'authorization_denied' : 'operational_failure', rawReason: lastReason, durablyVerified: false, payable: false, paid: false };
      }
      if (typeof body.checkpointHash === 'string') {
        if (!/^[a-f0-9]{8}$/.test(body.checkpointHash) || body.checkpointTick !== tick + n) throw new InstrumentationFailure('legacy_checkpoint_chain_mismatch');
        from = body.checkpointHash; tick += n; observation.checkpointTicks.push(tick);
        state.acceptedTick = tick; state.verifiedTick = tick; state.durablyVerified = true; progress({ ...state }); continue;
      }
      if (body.paid !== true && !['player_down', 'assisted', 'boss_fled', 'fled'].includes(lastReason)) throw new Error('legacy verdict unavailable; cannot infer gameplay ineligibility');
      if (body.paid !== true) { observation.eligibilityObserved = 'ineligible'; observation.terminalOutcome = lastReason; }
      state.acceptedTick = tick + n; state.verifiedTick = tick + n; state.durablyVerified = true; progress({ ...state });
      if (tick + n !== target) return { status: 'unsupported', rawReason: 'legacy_terminal_before_complete_source', durablyVerified: true, payable: false, paid: false };
      tick += n; state.acceptedTick = tick; state.verifiedTick = tick; state.durablyVerified = true; state.payable = body.paid === true; state.everObservedEligible = body.paid === true; progress({ ...state });
      return { status: body.paid === true ? 'paid' : assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: lastReason, durablyVerified: true, payable: body.paid === true, paid: body.paid === true };
    }
    return { status: assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: lastReason, durablyVerified: true, payable: false, paid: false };
    } finally { observation.completedMonoMs = performance.now(); this.activeExecutions.delete(binding.runBindingHash); for (const release of wireReleases) release(); this.inputReleases.get(binding.runBindingHash)?.(); this.inputReleases.delete(binding.runBindingHash); this.actors.delete(binding.runBindingHash); }
  }
  async startBackground(signal: AbortSignal): Promise<void> { await this.background.start(this.plan.background.hubUsers, this.plan.background.freePvpMatches, signal); }
  async stopBackground(): Promise<void> { for (const [key, release] of this.inputReleases) if (!this.activeExecutions.has(key)) { release(); this.inputReleases.delete(key); } this.actors.clear(); await this.background.stop(); }
  async observe(signal: AbortSignal): Promise<void> {
    const outcomes = await Promise.allSettled([this.sampleServer(signal), this.background.observe(signal)]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  }
  observationContext() { return { background: this.background.observationContext() }; }
  async checkpointSizes(): Promise<Record<string, unknown>[]> {
    const ids = [...this.runIds]; if (!ids.length) return [];
    if (ids.length > 120 || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new InstrumentationFailure('legacy_checkpoint_metadata_bound');
    const sqlIds = ids.map(literal).join(',');
    return JSON.parse(await psqlAsync(`BEGIN; SET LOCAL statement_timeout='2s'; SELECT COALESCE(jsonb_agg(jsonb_build_object('runBindingHash',encode(sha256(convert_to(run_id,'UTF8')),'hex'),'canonicalJsonBytes',CASE WHEN checkpoint_json IS NULL THEN 0 ELSE octet_length(checkpoint_json::text) END,'jsonbDatumBytes',CASE WHEN checkpoint_json IS NULL THEN 0 ELSE pg_column_size(checkpoint_json) END)),'[]'::jsonb)::text FROM game.shooter_run WHERE run_id IN (${sqlIds}); COMMIT;`));
  }
  matchMetrics() { return this.background.matchObservations; }
  matchEnds() { return this.background.matchEnds; }
  inputBudget() { return this.budget.observation(); }
  backgroundCoverage() { return this.background.coverage; }
  backgroundTransitions() { return this.background.controlTransitions; }
  backgroundRejections() { return this.background.rejectionCounts; }
  backgroundParticipants() { return this.background.participantEvidence(); }
  backgroundMetricReads() { return this.background.metricReads; }
}
