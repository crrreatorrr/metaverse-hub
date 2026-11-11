// Actual public ingress/status adapter. Simulation and result submission belong
// exclusively to the separately running PR19 coordinator/offline containers.
import { performance } from 'node:perf_hooks';
import { call, guest, openGame, psqlAsync } from '../../../server/test/dup/harness.ts';
import { prepareTrustedActor, reboundBatches, appendDigest, finishActor, observeActor, type TrustedActor } from '../../../server/test/dup/shooter_verification_e2e_fixtures';
import { ByteBudget, prepareReserved, sourceInputReservation, wireInputReservation } from './budget.ts';
import { BackgroundTraffic } from './background.ts';
import { sha256, positiveEligibilityProof, type Assignment, type Phase, type Plan } from './contracts.ts';
import { OperationFailure, InstrumentationFailure, type Binding, type CampaignAdapter, type Execution, type SubmissionProgress } from './runner.ts';
const object = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;
const delay = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new Error('aborted')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});
export interface ActorObservation {
  runBindingHash: string;
  submittedFrames: number;
  sourceFrames: number;
  appendAttempts: number;
  receivedWallMs: number | null;
  verifiedWallMs: number | null;
  finishAckWallMs: number | null;
  firstEligiblePendingWallMs: number | null;
  firstEligiblePendingToPaidMs: number | null;
  finishAckToPaidMs: number | null;
  rewardWallMs: number | null;
  paymentCensored: boolean;
  terminalOutcome: string | null;
}
export class PublicPipeline implements CampaignAdapter {
  readonly mode = 'bounded_v8_same_host' as const;
  readonly observations = new Map<string, ActorObservation>();
  private readonly actors = new Map<string, { actor: TrustedActor; wave: number }>();
  private readonly gates = new Map<number, { count: number; promise: Promise<void>; release: () => void; fail: () => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly background: BackgroundTraffic;
  private readonly budget: ByteBudget;
  private observing = false;
  private readonly observingComponents = new Set<string>();
  private readonly inputReleases = new Map<string, () => void>();
  private readonly activeExecutions = new Set<string>();
  private readonly runIds = new Set<string>();
  constructor(private plan: Plan, base: string, private sampleServer: (signal: AbortSignal) => Promise<void>) {
    this.background = new BackgroundTraffic(base, plan.seed);
    this.budget = new ByteBudget(plan.maxQueuedBytes);
  }
  async prepare(assignment: Assignment, wave: number, signal: AbortSignal): Promise<Binding> {
    const estimate = sourceInputReservation(assignment.frames, assignment.actions);
    const prepared = await prepareReserved(this.budget, estimate, async () => {
      if (signal.aborted) throw new Error('aborted');
      const login = await openGame((await guest()).token, 'sproto-shooter');
      if (signal.aborted) throw new Error('aborted');
      const actor = await prepareTrustedActor(assignment.caseId, login, { ageMs: 1200000 });
      if (signal.aborted) throw new Error('aborted');
      if (actor.trace.definition.frames !== assignment.frames || actor.trace.definition.fixtureSha256 !== assignment.caseSha256 || actor.trace.definition.legacyInputEnvelopeSha256 !== assignment.inputSha256) throw new Error('prepared trace differs from assignment');
      if (Buffer.byteLength(actor.trace.frames) + Buffer.byteLength(JSON.stringify(actor.trace.actions)) > estimate) throw new Error('source input exceeds reservation');
      return { actor, login };
    });
    try {
      if (signal.aborted) throw new Error('aborted');
      const { actor, login } = prepared.value;
      const binding = { accountBindingHash: sha256(login.hub.userId), sessionBindingHash: sha256(login.sessionId), runBindingHash: sha256(actor.runId) };
      this.inputReleases.set(binding.runBindingHash, prepared.release); this.runIds.add(actor.runId);
      this.actors.set(binding.runBindingHash, { actor, wave }); return binding;
    } catch (error) { prepared.release(); throw error; }
  }
  async execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal, progress: (value: SubmissionProgress) => void): Promise<Execution> {
    const prepared = this.actors.get(binding.runBindingHash);
    if (!prepared) throw new Error('unknown actual actor');
    const { actor, wave } = prepared;
    this.activeExecutions.add(binding.runBindingHash);
    let releaseWire = () => {};
    try {
    const wireBound = wireInputReservation(assignment.frames, assignment.actions);
    releaseWire = this.budget.reserve(wireBound);
    const start = performance.now(), batches = reboundBatches(actor);
    // Accept the full single-batch corpus before any terminal can stop tails.
    if (batches.length !== 1) throw new Error('fixture requires pre-worker multi-batch barrier');
    const original = batches[0], n = assignment.behavior === 'abandon' ? Math.min(120, original.n) : original.n;
    const batch = n === original.n ? original : { ...original, n, frames: original.frames.slice(0, n * 16), actions: original.actions.filter(a => a[0] < n) };
    if (Buffer.byteLength(JSON.stringify(batch)) > wireBound) throw new Error('actual append exceeds wire reservation');
    const observation: ActorObservation = { runBindingHash: binding.runBindingHash, submittedFrames: n, sourceFrames: assignment.frames, appendAttempts: 0, receivedWallMs: null, verifiedWallMs: null, finishAckWallMs: null, firstEligiblePendingWallMs: null, firstEligiblePendingToPaidMs: null, finishAckToPaidMs: null, rewardWallMs: null, paymentCensored: false, terminalOutcome: null };
    this.observations.set(binding.runBindingHash, observation);
    const submission: SubmissionProgress = { submittedFrames: n, submittedInputSha256: appendDigest(batch), submittedHashMeaning: 'v2_canonical_append_body_sha256', acceptedTick: 0, verifiedTick: 0, durablyVerified: false, payable: false, everObservedEligible: false, observedPaid: false };
    progress(submission);
    // Lost-response storm discards successful acknowledgments then repeats the
    // exact frozen canonical body (same run/sequence/digest), never a new run.
    const attempts = phase.kind === 'retry_storm' ? this.plan.requestRetryLimit + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      observation.appendAttempts++;
      const ack = object((await call('shooter.run.append', batch, actor.login.gameToken, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) })).body);
      if (signal.aborted) throw new Error('aborted');
      if (ack.state !== 'received' || ack.digest !== appendDigest(batch) || Number(ack.acceptedTick) !== n) throw new Error('actual append acknowledgment mismatch');
      submission.acceptedTick = n; progress({ ...submission });
    }
    observation.receivedWallMs = performance.now() - start;
    await this.finishBarrier(wave, signal);
    await finishActor(actor, batch.sequence, n);
    if (signal.aborted) throw new Error('aborted');
    observation.finishAckWallMs = performance.now() - start;
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const status = await observeActor(actor), verified = object(status.verified), terminal = status.terminal ? object(status.terminal) : null, payment = object(status.payment);
      if (signal.aborted) throw new Error('aborted');
      submission.verifiedTick = Number(verified.tick);
      const durable = submission.verifiedTick === n;
      submission.durablyVerified = durable;
      submission.everObservedEligible ||= positiveEligibilityProof(durable, terminal?.outcome, payment.state);
      submission.payable = positiveEligibilityProof(durable, terminal?.outcome, payment.state);
      submission.observedPaid ||= durable && terminal?.outcome === 'clear' && payment.state === 'paid';
      progress({ ...submission });
      if (durable && observation.verifiedWallMs === null) observation.verifiedWallMs = performance.now() - start;
      if (terminal) observation.terminalOutcome = String(terminal.outcome);
      if (payment.state === 'paid') {
        if (!durable || terminal?.outcome !== 'clear' || Number(payment.tickets) !== 20) throw new Error('paid public status lacks full verified fixed20 receipt');
        observation.rewardWallMs = performance.now() - start;
        observation.finishAckToPaidMs = observation.rewardWallMs - observation.finishAckWallMs;
        observation.firstEligiblePendingToPaidMs = observation.firstEligiblePendingWallMs === null ? null : observation.rewardWallMs - observation.firstEligiblePendingWallMs;
        return { status: 'paid', rawReason: null, durablyVerified: true, payable: true, paid: true };
      }
      if (durable && payment.state === 'authorization_denied') return { status: 'authorization_denied', rawReason: String(payment.reason ?? 'unspecified'), durablyVerified: true, payable: false, paid: false };
      if (durable && terminal && payment.state === 'ineligible') return { status: assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: String(terminal.outcome), durablyVerified: true, payable: false, paid: false };
      if (status.state === 'invalid' || status.state === 'quarantined') return { status: 'operational_failure', rawReason: 'run_unresolved_invalid_or_quarantined', durablyVerified: durable, payable: false, paid: false };
      // A fixed measured payment observation window censors eligible pending
      // latency. It does not extend a worker replay budget or declare a valid
      // run permanently failed. This window is part of the benchmark manifest.
      if (durable && payment.state === 'pending' && observation.firstEligiblePendingWallMs === null) observation.firstEligiblePendingWallMs = performance.now() - start;
      if (durable && payment.state === 'pending' && observation.firstEligiblePendingWallMs !== null && performance.now() - start - observation.firstEligiblePendingWallMs >= 120000) {
        observation.paymentCensored = true;
        return { status: 'payment_pending', rawReason: String(payment.reason ?? 'observation_window'), durablyVerified: true, payable: true, paid: false };
      }
      await delay(500, signal);
    }
    } finally { this.activeExecutions.delete(binding.runBindingHash); releaseWire(); this.inputReleases.get(binding.runBindingHash)?.(); this.inputReleases.delete(binding.runBindingHash); this.actors.delete(binding.runBindingHash); }
  }
  private async finishBarrier(wave: number, signal: AbortSignal): Promise<void> {
    let gate = this.gates.get(wave);
    if (!gate) {
      let release!: () => void, fail!: () => void;
      const promise = new Promise<void>((resolve, reject) => { release = resolve; fail = () => reject(new OperationFailure('finish_barrier_timeout')); });
      const timer = setTimeout(() => fail(), 10000);
      gate = { count: 0, promise, release, fail, timer }; this.gates.set(wave, gate);
    }
    gate.count++;
    if (gate.count === 20) { clearTimeout(gate.timer); gate.release(); }
    const abort = () => { clearTimeout(gate!.timer); gate!.fail(); };
    signal.addEventListener('abort', abort, { once: true });
    try { if (signal.aborted) abort(); await gate.promise; }
    finally { signal.removeEventListener('abort', abort); }
  }
  async startBackground(signal: AbortSignal): Promise<void> { await this.background.start(this.plan.background.hubUsers, this.plan.background.freePvpMatches, signal); }
  async stopBackground(): Promise<void> { for (const gate of this.gates.values()) clearTimeout(gate.timer); for (const [key, release] of this.inputReleases) if (!this.activeExecutions.has(key)) { release(); this.inputReleases.delete(key); } this.actors.clear(); await this.background.stop(); }
  async observe(signal: AbortSignal): Promise<void> {
    if (this.observing) throw new InstrumentationFailure('previous_pipeline_observation_active');
    this.observing = true;
    const component = async (name: string, operation: () => Promise<void>) => {
      this.observingComponents.add(name);
      try { await operation(); }
      catch (error) { if (error instanceof OperationFailure || error instanceof InstrumentationFailure) throw error; throw new InstrumentationFailure(`${name}_observer_exception`); }
      finally { this.observingComponents.delete(name); }
    };
    try {
      const outcomes = await Promise.allSettled([component('server', () => this.sampleServer(signal)), component('background', () => this.background.observe(signal))]);
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    } finally { this.observing = false; }
  }
  observationContext() { return { pendingComponents: [...this.observingComponents], background: this.background.observationContext() }; }
  async checkpointSizes(): Promise<Record<string, unknown>[]> {
    const ids = [...this.runIds];
    if (!ids.length) return [];
    if (ids.length > 120 || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('bounded actual run IDs required');
    const sqlIds = ids.map(id => `'${id}'`).join(',');
    const text = await psqlAsync(`BEGIN; SET LOCAL statement_timeout='2s'; SELECT COALESCE(jsonb_agg(jsonb_build_object('runBindingHash',encode(sha256(convert_to(run_id,'UTF8')),'hex'),'canonicalJsonBytes',checkpoint_bytes,'jsonbDatumBytes',CASE WHEN checkpoint_json IS NULL THEN 0 ELSE pg_column_size(checkpoint_json) END)),'[]'::jsonb)::text FROM (SELECT run_id,checkpoint_bytes,checkpoint_json FROM game.shooter_verification_run WHERE run_id IN (${sqlIds}) ORDER BY run_id LIMIT 120) r; COMMIT;`);
    return JSON.parse(text) as Record<string, unknown>[];
  }
  matchMetrics() { return this.background.matchObservations; }
  matchEnds() { return this.background.matchEnds; }
  inputBudget() { return this.budget.observation(); }
  backgroundCoverage() { return this.background.coverage; }
  backgroundTransitions() { return this.background.controlTransitions; }
  backgroundRejections() { return this.background.rejectionCounts; }
}
