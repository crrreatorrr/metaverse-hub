// Actual existing v1 Nakama RPCs. No new production engine/fallback selector.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { call, guest, openGame, psqlAsync, type GameLogin } from '../../../server/test/dup/harness.ts';
import { buildCanonicalFixtureIssuance, loadFrozenTrace, type FrozenTrace } from '../../../server/test/dup/shooter_verification_e2e_fixtures';
import { ByteBudget } from './budget.ts';
import { BackgroundTraffic } from './background.ts';
import { sha256, type Assignment, type Phase, type Plan } from './contracts.ts';
import { OperationFailure, type Binding, type CampaignAdapter, type Execution, type SubmissionProgress } from './runner.ts';
interface LegacyActor { login: GameLogin; runId: string; issuance: Record<string, unknown>; trace: FrozenTrace }
export interface LegacyObservation { runBindingHash: string; wallMs: number; requestedFrames: number; checkpointTicks: number[]; rawReasons: string[]; receiptObservedPaid: boolean; fullSourceSubmitted: boolean; eligibilityObserved: 'eligible' | 'ineligible' | 'unknown'; }
const object = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export class LegacyPipeline implements CampaignAdapter {
  readonly observations: LegacyObservation[] = [];
  readonly unsupportedPhases = ['retry_storm'] as const;
  readonly mode: 'legacy_full_goja' | 'legacy_segmented_goja';
  private actors = new Map<string, LegacyActor>();
  private background: BackgroundTraffic;
  private readonly budget: ByteBudget;
  private readonly inputReleases = new Map<string, () => void>();
  constructor(private plan: Plan, base: string, segmented: boolean, private sampleServer: (signal: AbortSignal) => Promise<void>) {
    this.mode = segmented ? 'legacy_segmented_goja' : 'legacy_full_goja';
    this.background = new BackgroundTraffic(base, plan.seed); this.budget = new ByteBudget(plan.maxQueuedBytes);
  }
  async prepare(assignment: Assignment, _wave: number, signal: AbortSignal): Promise<Binding> {
    if (signal.aborted) throw new Error('aborted');
    const login = await openGame((await guest()).token, 'sproto-shooter'), trace = loadFrozenTrace(assignment.caseId), runId = randomUUID();
    const day = await psqlAsync("SELECT to_char((clock_timestamp() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD')");
    const issuance = buildCanonicalFixtureIssuance({ accountId: login.hub.userId, sessionId: login.sessionId, runId, day, canonicalBoss: trace.definition.boss, seed: trace.definition.seed });
    // Fresh non-cohort account: no v2 row, no removal/bypass of sticky enrollment.
    const ack = object(JSON.parse(await psqlAsync(`SELECT game.issue_shooter_run('${login.hub.userId}','${login.sessionId}','benchmark:${runId}','${runId}',${literal(day)},${literal(trace.definition.boss)},${trace.definition.seed},${literal(JSON.stringify(issuance))})::text`)));
    if (ack.ok !== true) throw new OperationFailure('legacy_fixture_issuance_failed');
    assert.deepEqual(ack.issuance, issuance, 'actual legacy SQL issuer preserves canonical bound issuance');
    const binding = { accountBindingHash: sha256(login.hub.userId), sessionBindingHash: sha256(login.sessionId), runBindingHash: sha256(runId) };
    if (signal.aborted) throw new Error('aborted');
    this.inputReleases.set(binding.runBindingHash, this.budget.reserve(Buffer.byteLength(trace.frames) + Buffer.byteLength(JSON.stringify(trace.actions))));
    this.actors.set(binding.runBindingHash, { login, runId, issuance, trace }); return binding;
  }
  async execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal, progress: (update: SubmissionProgress) => void): Promise<Execution> {
    if (phase.kind === 'retry_storm') return { status: 'unsupported', rawReason: 'legacy_retry_storm_not_yet_implemented', durablyVerified: false, payable: false, paid: false };
    const actor = this.actors.get(binding.runBindingHash); if (!actor) throw new Error('unknown legacy actor');
    const start = performance.now(), target = assignment.behavior === 'abandon' ? Math.min(120, actor.trace.definition.frames) : actor.trace.definition.frames;
    const segmentFrames = this.mode === 'legacy_full_goja' ? target : 4096;
    const observation: LegacyObservation = { runBindingHash: binding.runBindingHash, wallMs: 0, requestedFrames: 0, checkpointTicks: [], rawReasons: [], receiptObservedPaid: false, fullSourceSubmitted: false, eligibilityObserved: 'unknown' };
    this.observations.push(observation);
    const submitted: object[] = [], wireReleases: (() => void)[] = [];
    try {
    let tick = 0, from: string | null = null, lastReason = 'unspecified';
    const state: SubmissionProgress = { submittedFrames: 0, submittedInputSha256: null, submittedHashMeaning: null, acceptedTick: 0, verifiedTick: 0, durablyVerified: false, payable: false, everObservedEligible: false };
    while (tick < target) {
      const n = Math.min(segmentFrames, target - tick);
      const log = { v: 1, binding: { accountId: actor.login.hub.userId, sessionId: actor.login.sessionId, day: actor.issuance.day, runId: actor.runId }, segments: [{ i: 0, from, tick0: tick, n, frames: actor.trace.frames.slice(tick * 16, (tick + n) * 16), actions: actor.trace.actions.filter(a => a[0] >= tick && a[0] < tick + n).map(a => [a[0] - tick, a[1]]) }] };
      wireReleases.push(this.budget.reserve(Buffer.byteLength(JSON.stringify(log))));
      submitted.push(log); state.submittedFrames = tick + n; state.submittedInputSha256 = sha256(JSON.stringify(submitted)); state.submittedHashMeaning = 'sha256_of_ordered_actual_v1_log_envelopes'; state.durablyVerified = state.verifiedTick === state.submittedFrames; progress({ ...state });
      observation.requestedFrames += n; observation.fullSourceSubmitted = state.submittedFrames === actor.trace.definition.frames;
      let response;
      try { response = await call('shooter.run.submit', { runId: actor.runId, log }, actor.login.gameToken, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }); }
      catch { observation.wallMs = performance.now() - start; throw new OperationFailure('legacy_rpc_transport_timeout_or_failure'); }
      const body = object(response.body);
      const responseReason = body.reason ?? body.error;
      lastReason = typeof responseReason === 'string' && /^[a-z0-9_:.|-]{1,80}$/.test(responseReason) ? responseReason : `rpc_http_${response.status}`;
      observation.rawReasons.push(lastReason); observation.wallMs = performance.now() - start;
      observation.receiptObservedPaid ||= body.paid === true;
      if (body.paid === true) observation.eligibilityObserved = 'eligible';
      if (response.status >= 400 || body.ok !== true) return { status: lastReason === 'cpu_budget' ? 'timeout' : 'operational_failure', rawReason: lastReason, durablyVerified: false, payable: false, paid: false };
      if (typeof body.checkpointHash === 'string') {
        if (!/^[a-f0-9]{8}$/.test(body.checkpointHash) || body.checkpointTick !== tick + n) throw new OperationFailure('legacy_checkpoint_chain_mismatch');
        from = body.checkpointHash; tick += n; observation.checkpointTicks.push(tick);
        state.acceptedTick = tick; state.verifiedTick = tick; state.durablyVerified = true; progress({ ...state }); continue;
      }
      if (tick + n !== target) return { status: 'unsupported', rawReason: 'legacy_terminal_before_complete_source', durablyVerified: false, payable: false, paid: false };
      if (body.paid !== true && !['player_down', 'assisted', 'boss_fled', 'fled'].includes(lastReason)) throw new Error('legacy verdict unavailable; cannot infer gameplay ineligibility');
      if (body.paid !== true) observation.eligibilityObserved = 'ineligible';
      tick += n; state.acceptedTick = tick; state.verifiedTick = tick; state.durablyVerified = true; state.payable = body.paid === true; state.everObservedEligible = body.paid === true; progress({ ...state });
      return { status: body.paid === true ? 'paid' : assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: lastReason, durablyVerified: true, payable: body.paid === true, paid: body.paid === true };
    }
    return { status: assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: lastReason, durablyVerified: true, payable: false, paid: false };
    } finally { for (const release of wireReleases) release(); this.inputReleases.get(binding.runBindingHash)?.(); this.inputReleases.delete(binding.runBindingHash); this.actors.delete(binding.runBindingHash); }
  }
  async startBackground(signal: AbortSignal): Promise<void> { await this.background.start(this.plan.background.hubUsers, this.plan.background.freePvpMatches, signal); }
  async stopBackground(): Promise<void> { for (const release of this.inputReleases.values()) release(); this.inputReleases.clear(); this.actors.clear(); await this.background.stop(); }
  async observe(signal: AbortSignal): Promise<void> { await Promise.all([this.sampleServer(signal), this.background.observe(signal)]); }
}
