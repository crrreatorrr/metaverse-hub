// Actual public ingress/status adapter. Simulation and result submission belong
// exclusively to the separately running PR19 coordinator/offline containers.
import { performance } from 'node:perf_hooks';
import { call, guest, openGame } from '../../../server/test/dup/harness.ts';
import { prepareTrustedActor, reboundBatches, appendDigest, finishActor, observeActor, type TrustedActor } from '../../../server/test/dup/shooter_verification_e2e_fixtures.ts';
import { BackgroundTraffic } from './background.ts';
import { sha256, type Assignment, type Phase, type Plan } from './contracts.ts';
import type { Binding, CampaignAdapter, Execution } from './runner.ts';
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
  rewardWallMs: number | null;
  paymentCensored: boolean;
  terminalOutcome: string | null;
}
export class PublicPipeline implements CampaignAdapter {
  readonly mode = 'bounded_v8_same_host' as const;
  readonly observations = new Map<string, ActorObservation>();
  private readonly actors = new Map<string, TrustedActor>();
  private readonly background: BackgroundTraffic;
  constructor(private plan: Plan, base: string, private sampleServer: (signal: AbortSignal) => Promise<void>) {
    this.background = new BackgroundTraffic(base, plan.seed);
  }
  async prepare(assignment: Assignment, _wave: number, signal: AbortSignal): Promise<Binding> {
    if (signal.aborted) throw new Error('aborted');
    const login = await openGame((await guest()).token, 'sproto-shooter');
    const actor = await prepareTrustedActor(assignment.caseId, login, { ageMs: 1200000 });
    if (actor.trace.definition.frames !== assignment.frames || actor.trace.definition.fixtureSha256 !== assignment.caseSha256 || actor.trace.definition.legacyInputEnvelopeSha256 !== assignment.inputSha256) throw new Error('prepared trace differs from assignment');
    const binding = { accountBindingHash: sha256(login.hub.userId), sessionBindingHash: sha256(login.sessionId), runBindingHash: sha256(actor.runId) };
    this.actors.set(binding.runBindingHash, actor);
    return binding;
  }
  async execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal): Promise<Execution> {
    const actor = this.actors.get(binding.runBindingHash);
    if (!actor) throw new Error('unknown actual actor');
    const start = performance.now(), batches = reboundBatches(actor);
    // All long traces fit one legal28800-frame batch, so the full accepted tail
    // is durable before workers can observe an early terminal. No source trim.
    if (batches.length !== 1) throw new Error('fixture batch contract changed; require pre-worker upload barrier');
    const original = batches[0], n = assignment.behavior === 'abandon' ? Math.min(120, original.n) : original.n;
    const batch = n === original.n ? original : { ...original, n, frames: original.frames.slice(0, n * 16), actions: original.actions.filter(a => a[0] < n) };
    const observation: ActorObservation = { runBindingHash: binding.runBindingHash, submittedFrames: n, sourceFrames: assignment.frames, appendAttempts: 0, receivedWallMs: null, verifiedWallMs: null, rewardWallMs: null, paymentCensored: false, terminalOutcome: null };
    this.observations.set(binding.runBindingHash, observation);
    // Lost-response storm discards successful acknowledgments then repeats the
    // exact frozen canonical body (same run/sequence/digest), never a new run.
    const attempts = phase.kind === 'retry_storm' ? this.plan.requestRetryLimit + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      observation.appendAttempts++;
      const ack = object((await call('shooter.run.append', batch, actor.login.gameToken, { signal })).body);
      if (ack.state !== 'received' || ack.digest !== appendDigest(batch)) throw new Error('actual append acknowledgment mismatch');
    }
    observation.receivedWallMs = performance.now() - start;
    await finishActor(actor, batch.sequence, n);
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const status = await observeActor(actor), verified = object(status.verified), terminal = status.terminal ? object(status.terminal) : null, payment = object(status.payment);
      const durable = Number(verified.tick) === n;
      if (durable && observation.verifiedWallMs === null) observation.verifiedWallMs = performance.now() - start;
      if (terminal) observation.terminalOutcome = String(terminal.outcome);
      if (payment.state === 'paid') {
        if (!durable || Number(payment.tickets) !== 20) throw new Error('paid public status lacks full verified fixed20 receipt');
        observation.rewardWallMs = performance.now() - start;
        return { status: 'paid', rawReason: null, durablyVerified: true, payable: true, paid: true };
      }
      if (durable && payment.state === 'authorization_denied') return { status: 'authorization_denied', rawReason: String(payment.reason ?? 'unspecified'), durablyVerified: true, payable: false, paid: false };
      if (durable && terminal && payment.state === 'ineligible') return { status: assignment.behavior === 'abandon' ? 'abandoned' : 'verified_nonpayable', rawReason: String(terminal.outcome), durablyVerified: true, payable: false, paid: false };
      if (status.state === 'invalid' || status.state === 'quarantined') return { status: 'operational_failure', rawReason: 'run_unresolved_invalid_or_quarantined', durablyVerified: durable, payable: false, paid: false };
      // A fixed measured payment observation window censors eligible pending
      // latency. It does not extend a worker replay budget or declare a valid
      // run permanently failed. This window is part of the benchmark manifest.
      if (durable && payment.state === 'pending' && performance.now() - start >= 120000) {
        observation.paymentCensored = true;
        return { status: 'payment_pending', rawReason: String(payment.reason ?? 'observation_window'), durablyVerified: true, payable: true, paid: false };
      }
      await delay(500, signal);
    }
  }
  async startBackground(signal: AbortSignal): Promise<void> { await this.background.start(this.plan.background.hubUsers, this.plan.background.freePvpMatches, signal); }
  async stopBackground(): Promise<void> { await this.background.stop(); }
  async observe(signal: AbortSignal): Promise<void> { await Promise.all([this.sampleServer(signal), this.background.observe(signal)]); }
  matchMetrics() { return this.background.matchObservations; }
}
