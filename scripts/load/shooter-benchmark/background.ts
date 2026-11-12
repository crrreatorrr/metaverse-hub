// Real SDK/WebSocket background traffic, separate accounts from campaign actors.
// Trusted CI owns flag setup; this module performs no SQL, wallet or flag writes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRealtime, type HubRealtime, type MatchHandle, type MatchData } from '../../../packages/hub-sdk/src/index.ts';
import { guest, openGame, type GameLogin } from '../../../server/test/dup/harness.ts';
import { benchmarkRpc as call } from './rpc.ts';
import { sha256 } from './contracts.ts';
import { settleMetricRead, MetricReadParentAborted } from './metric-read-disposition.ts';
import { createMetricReadLifetime, type MetricReadLifetimeEvidence } from './metric-read-lifetime.ts';
import { oneShotCoverage } from './coverage.ts';
import { authoritativeFreeResult, FixedSlotParticipants, CreateRateBudget, assertOriginalCredential, allowOrdinaryCreateRetry,
  PVP_REPLACEMENT_LIMIT, PVP_INITIAL_LIMIT, BACKGROUND_PROFILE_MS, NORMAL_ROUND_MS, CREATE_RETRY_BUDGET_MS,
  CREATE_RETRY_DELAY_MS, ROOM_OPERATION_LIMIT } from './background-policy.ts';
import { runLifetimeControl } from './control.ts';
import { SutUnavailable, InstrumentationFailure } from './runner.ts';
type Encoder = (input: Record<string, unknown>) => Uint8Array;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('background response is not an object');
  return value as Record<string, unknown>;
}
interface Live { rt: HubRealtime; match: MatchHandle; timer?: ReturnType<typeof setInterval> }
interface Seat extends Live { account: string; mail: MatchData[]; seat: number; seq: number; sentTick: number }
interface Pair { round: number; slot: number; createdMonoMs: number; replacement: boolean; matchId: string; token: string; seats: Seat[]; timer?: ReturnType<typeof setInterval> }
export interface MatchQuantiles { slot: number; createdMonoMs: number; replacement: boolean; observedMonoMs: number; matchBindingHash: string; observedAt: string; n: number; p50: number; p95: number; max: number; tick: number; phase: string; endReason: string; outcome: string; seatInputs: { applied: number; held: number; neutral: number; late: number }[]; observer: 'shooter.metrics'; }
interface RoomOperation { slot: number; round: number; operation: 'room_create' | 'room_join'; attempt: number;
  startedMonoMs: number; finishedMonoMs: number; outcome: 'pending' | 'accepted' | 'rejected' | 'exception';
  httpStatus: number | null; reason: string | null; retryDelayMs: number; accountBindingHash: string; sessionBindingHash: string; }
async function openGameFromGuest(): Promise<GameLogin> { return openGame((await guest()).token, 'sproto-shooter'); }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined, signal: AbortSignal): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) { if (signal.aborted || Date.now() > deadline) throw new Error('background handshake deadline'); const value = read(); if (value !== undefined) return value; await wait(25); }
}
export class BackgroundTraffic {
  private live: Live[] = [];
  private pairs: Pair[] = [];
  private frames: ReturnType<typeof setInterval>[] = [];
  private stopping = false;
  private started = false;
  private observing = false;
  private readonly controlAbort = new AbortController();
  private controlTask: Promise<void> | null = null;
  private controlFailure: string | null = null;
  private readonly replacing = new Set<number>();
  private readonly reading = new Set<number>();
  private readonly matchResults = new Map<string, { outcome: string; reason: string; tick: number; observedMonoMs: number }>();
  private readonly pendingMetricReads = new Map<string, ReturnType<typeof createMetricReadLifetime>>();
  readonly metricEndCensors: Readonly<MetricReadLifetimeEvidence & { slot: number; authoritativeEventObservedMonoMs: number }>[] = [];
  readonly controlTransitions: { slot: number; startedMonoMs: number; finishedMonoMs: number; outcome: 'ready' | 'failed'; reason: string | null }[] = [];
  private lifetimeSignal: AbortSignal | null = null;
  private targetMatches = 0;
  private readonly encode: Encoder;
  private readonly pin: { protocol: number; sim: number; contentFingerprint: string };
  readonly matchObservations: MatchQuantiles[] = [];
  readonly matchEnds: { matchBindingHash: string; observedAt: string; reason: string; outcome: string; replacement: number }[] = [];
  readonly metricReads: Readonly<{ slot: number; matchBindingHash: string; startedMonoMs: number; finishedMonoMs: number; elapsedMs: number; stage: string; outcome: string; httpStatus: number | null; signalDefinition: string }>[] = [];
  readonly rejectionCounts: Record<string, number> = {};
  readonly coverage: { observedAt: string; phase: 'starting' | 'running'; targetMatches: number; activeSlots: number; attemptedMetrics: number; successfulMetrics: number; confirmedEndMetricMisses: number; observedEndingSlots: number; replacingSlots: number; replacements: number; endCensoredMetricReads: number; closure: 'sample_complete' | 'sample_deadline' | 'measurement_window_closed'; pendingMetricSlots: number[] }[] = [];
  private replacements = 0;
  private readonly replacementLimit = PVP_REPLACEMENT_LIMIT;
  private readonly participants = new FixedSlotParticipants<GameLogin>(value => ({ accountId: value.hub.userId, sessionId: value.sessionId }));
  private readonly createRate = new CreateRateBudget();
  private readonly roomOperations: RoomOperation[] = [];
  private readonly rounds: { slot: number; round: number; matchBindingHash: string; createObserved: boolean; joinObserved: boolean; readyObserved: boolean; createdMonoMs: number; readyMonoMs: number | null; leaveStartedMonoMs: number | null; leaveSettledMonoMs: number | null }[] = [];
  private readonly roundCounts = new Map<number, number>();
  constructor(private base: string, private seed: string) {
    const pin = JSON.parse(readFileSync('server/modules/vendor/shooter-pvp-sim.pin.json', 'utf8'));
    this.pin = pin;
    const sandbox: Record<string, unknown> = {}; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const artifact = readFileSync('server/modules/vendor/shooter-pvp-sim.js');
    if (sha256(artifact) !== pin.sha256) throw new Error('background PvP artifact hash mismatch');
    vm.runInContext(artifact.toString('utf8'), sandbox);
    this.encode = (sandbox.SprotoShooterPvp as { encodeInput: Encoder }).encodeInput;
  }
  private socket(token: string): HubRealtime { return createRealtime({ serverUrl: this.base, getToken: () => token, reconnect: false }); }
  async start(hubUsers: number, freePvpMatches: number, signal: AbortSignal): Promise<void> {
    if (!Number.isInteger(hubUsers) || hubUsers < 0 || hubUsers > 20 || !Number.isInteger(freePvpMatches) || freePvpMatches < 0 || freePvpMatches > 10) throw new Error('background bound exceeded');
    this.lifetimeSignal = AbortSignal.any([signal, this.controlAbort.signal]); this.targetMatches = freePvpMatches;
    for (let i = 0; i < hubUsers; i++) {
      if (signal.aborted) throw new Error('background startup aborted');
      const login = await guest();
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_start_cancelled');
      const rt = this.socket(login.token);
      const live: Live = { rt, match: undefined as unknown as MatchHandle }; this.live.push(live);
      await rt.connect();
      const placed = await rt.rpc<{ matchId: string }>('hub.join', {});
      live.match = await rt.joinMatch({ matchId: placed.matchId });
      // Stable traffic seed controls movement; account auth remains independent.
      const bits = parseInt(sha256(`${this.seed}:hub:${i}`).slice(0, 8), 16);
      let angle = (bits / 0xffffffff) * Math.PI * 2, tick = 0;
      const radius = 5 + bits % 30, moving = bits % 10 < 3;
      live.timer = setInterval(() => {
        if (this.stopping || signal.aborted) return;
        tick++; if (!moving && tick % 10) return; if (moving) angle += .02;
        live.match.send(1, [Math.round(Math.cos(angle) * radius * 100), 178, Math.round((30 + Math.sin(angle) * radius) * 100), Math.round(angle / (Math.PI * 2) * 256) & 255, moving ? 1 : 0]);
      }, 100);
    }
    for (let i = 0; i < freePvpMatches; i++) await this.pair(signal, i);
    this.started = true; this.controlTask = runLifetimeControl(this.lifetimeSignal, 250, () => this.maintainRound());
  }
  private async pair(signal: AbortSignal, slot: number, replacement = false): Promise<void> {
    if (this.stopping || signal.aborted) throw new Error('background stopped');
    let originals: readonly [GameLogin, GameLogin];
    try {
      originals = await this.participants.get(slot, () => openGameFromGuest());
      for (const login of originals) assertOriginalCredential(login.gameToken, { accountId: login.hub.userId, sessionId: login.sessionId }, Date.now());
    } catch (error) {
      const reason = error instanceof Error && /^background_[a-z_]{1,70}$/.test(error.message) ? error.message : 'background_participant_auth_failed';
      throw new InstrumentationFailure(reason);
    }
    const [a, b] = originals;
    if (this.stopping || signal.aborted) throw new Error('background stopped');
    const round = (this.roundCounts.get(slot) ?? 0) + 1; this.roundCounts.set(slot, round);
    const retryStart = performance.now(); let attempts = 0, created: Record<string, unknown>;
    for (;;) {
      if (this.roomOperations.length >= ROOM_OPERATION_LIMIT) throw new InstrumentationFailure('background_room_operation_bound');
      const event: RoomOperation = { slot, round, operation: 'room_create', attempt: ++attempts,
        startedMonoMs: performance.now(), finishedMonoMs: 0, outcome: 'pending', httpStatus: null, reason: null, retryDelayMs: 0,
        accountBindingHash: sha256(a.hub.userId), sessionBindingHash: sha256(a.sessionId) };
      this.roomOperations.push(event);
      try {
        try { this.createRate.note(event.accountBindingHash, performance.now()); }
        catch { throw new InstrumentationFailure('background_create_rate_budget_exhausted'); }
        const remaining = replacement ? CREATE_RETRY_BUDGET_MS - (performance.now() - retryStart) : 20000;
        if (remaining <= 0) throw new InstrumentationFailure('background_rematch_handshake_deadline');
        const reply = await call('shooter.room_create', {}, a.gameToken,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(remaining)))]) });
        created = reply.body; event.httpStatus = reply.status;
        const reason = typeof created.error === 'string' && /^[a-z0-9_]{1,80}$/.test(created.error) ? created.error : created.error ? 'unclassified_room_rejection' : null;
        event.reason = reason; event.outcome = reason ? 'rejected' : 'accepted';
        if (reason && replacement && allowOrdinaryCreateRetry(reason, attempts, performance.now() - retryStart)) {
          event.finishedMonoMs = performance.now();
          const delayStarted = performance.now(); await wait(CREATE_RETRY_DELAY_MS); event.retryDelayMs = performance.now() - delayStarted; continue;
        }
        if (reason) throw new SutUnavailable(`pvp_room_${reason}`);
        if (reply.status !== 200 || created.stake !== 0 || created.ticketsMinted !== 0 || created.stakes !== false || typeof created.matchId !== 'string' || typeof created.code !== 'string') {
          event.outcome = 'exception'; event.reason = 'room_create_response_invalid'; throw new InstrumentationFailure(event.reason);
        }
        break;
      } catch (error) {
        if (event.outcome === 'pending') { event.outcome = 'exception'; event.reason = error instanceof InstrumentationFailure || error instanceof SutUnavailable ? error.reason : 'room_create_operation_failed'; }
        throw error;
      } finally { if (!event.finishedMonoMs) event.finishedMonoMs = performance.now(); }
    }
    const matchId = created.matchId;
    if (typeof matchId !== 'string') throw new InstrumentationFailure('background_room_binding_invalid');
    if (this.rounds.length >= PVP_INITIAL_LIMIT + PVP_REPLACEMENT_LIMIT) throw new InstrumentationFailure('background_round_evidence_bound');
    const roundProof = { slot, round, matchBindingHash: sha256(matchId), createObserved: true, joinObserved: false, readyObserved: false,
      createdMonoMs: performance.now(), readyMonoMs: null as number | null, leaveStartedMonoMs: null as number | null, leaveSettledMonoMs: null as number | null };
    this.rounds.push(roundProof);
    const joinEvent: RoomOperation = { slot, round, operation: 'room_join', attempt: 1, startedMonoMs: performance.now(), finishedMonoMs: 0,
      outcome: 'pending', httpStatus: null, reason: null, retryDelayMs: 0, accountBindingHash: sha256(b.hub.userId), sessionBindingHash: sha256(b.sessionId) };
    if (this.roomOperations.length >= ROOM_OPERATION_LIMIT) throw new InstrumentationFailure('background_room_operation_bound');
    this.roomOperations.push(joinEvent);
    try {
      const reply = await call('shooter.room_join', { code: created.code, v: this.pin.protocol, sim: this.pin.sim, content: this.pin.contentFingerprint }, b.gameToken,
        { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
      joinEvent.httpStatus = reply.status;
      const reason = typeof reply.body.error === 'string' && /^[a-z0-9_]{1,80}$/.test(reply.body.error) ? reply.body.error : reply.body.error ? 'unclassified_room_rejection' : null;
      joinEvent.reason = reason; joinEvent.outcome = reason ? 'rejected' : 'accepted';
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
      if (reason) throw new SutUnavailable(`pvp_room_${reason}`);
      if (reply.status !== 200 || reply.body.matchId !== matchId || reply.body.stake !== 0 || reply.body.ticketsMinted !== 0 || reply.body.stakes !== false) {
        joinEvent.outcome = 'exception'; joinEvent.reason = 'room_join_response_invalid'; throw new InstrumentationFailure(joinEvent.reason);
      }
      roundProof.joinObserved = true;
    } catch (error) {
      if (joinEvent.outcome === 'pending') { joinEvent.outcome = 'exception'; joinEvent.reason = error instanceof InstrumentationFailure || error instanceof SutUnavailable ? error.reason : 'room_join_operation_failed'; }
      throw error;
    } finally { joinEvent.finishedMonoMs = performance.now(); }
    const seats: Seat[] = [];
    for (const login of [a, b]) {
      const rt = this.socket(login.gameToken), mail: MatchData[] = [];
      const seat: Seat = { rt, match: undefined as unknown as MatchHandle, account: login.hub.userId, mail, seat: -1, seq: 0, sentTick: -1 }; this.live.push(seat);
      await rt.connect();
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
      seat.match = await rt.joinMatch({ matchId });
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
      seat.match.onMessage(message => {
        if (this.stopping) return;
        mail.push(message); if (mail.length > 128) mail.shift();
        const resultProof = authoritativeFreeResult(matchId, message);
        if (resultProof) {
          if (!this.matchResults.has(matchId)) this.matchResults.set(matchId, { ...resultProof, observedMonoMs: performance.now() });
          this.pendingMetricReads.get(matchId)?.notifyResult(sha256(message.matchId));
        }
        if (message.opCode === 3) { const reason = message.json<{ reason?: string }>().reason; const key = typeof reason === 'string' && /^[a-z0-9_]{1,80}$/.test(reason) ? reason : 'unclassified_rejection'; this.rejectionCounts[key] = (this.rejectionCounts[key] ?? 0) + 1; }
      }); seats.push(seat);
    }
    for (const s of seats) s.match.send(1, { accountId: s.account, protocol: this.pin.protocol, sim: this.pin.sim, content: this.pin.contentFingerprint, interpMs: 100 });
    for (const s of seats) {
      const welcome = await until(() => s.mail.find(m => m.opCode === 2 && m.json<{ accountId?: string }>().accountId === s.account), signal);
      s.seat = welcome.json<{ seat: number }>().seat; s.match.send(4, { accountId: s.account });
    }
    await until(() => seats[0].mail.find(m => m.opCode === 5 && m.json<{ phase?: string }>().phase === 'live'), signal);
    roundProof.readyObserved = true; roundProof.readyMonoMs = performance.now();
    const pair: Pair = { round, slot, createdMonoMs: performance.now(), replacement, matchId, token: a.gameToken, seats }; this.pairs.push(pair);
    pair.timer = setInterval(() => {
      if (this.stopping || this.lifetimeSignal?.aborted) return;
      for (const s of seats) {
        if (this.matchResults.has(pair.matchId)) continue;
        const snapshot = [...s.mail].reverse().find(m => m.opCode === 7);
        const tick = snapshot?.json<{ tick: number }>().tick ?? 0;
        if (tick <= s.sentTick) continue; s.sentTick = tick;
        // Legal bounded circular movement avoids deliberately walking off the
        // arena; normal fire bursts and authoritative match outcomes remain.
        const raw = this.encode({ seq: ++s.seq, frame: tick + 3, yaw: 0, pitch: 0, moveX: Math.sin(tick / 30) * .35, moveZ: Math.cos(tick / 30) * .35, fire: tick % 12 < 3, zoom: false, slot: 0 });
        s.match.send(6, Uint8Array.from(raw));
      }
    }, 50);
    this.frames.push(pair.timer);
  }
  private async replaceConfirmedEnd(pair: Pair, signal: AbortSignal): Promise<boolean> {
    if (this.stopping || signal.aborted || this.lifetimeSignal?.aborted) return false;
    const end = this.matchResults.get(pair.matchId);
    if (!end) return false;
    this.matchEnds.push({ matchBindingHash: sha256(pair.matchId), observedAt: new Date().toISOString(), reason: end.reason ?? 'unspecified', outcome: end.outcome ?? 'unspecified', replacement: this.replacements });
    clearInterval(pair.timer);
    const proof = this.rounds.find(value => value.matchBindingHash === sha256(pair.matchId));
    if (proof) proof.leaveStartedMonoMs = performance.now();
    await Promise.all(pair.seats.map(async seat => {
      try { await seat.match.leave(); } catch { /* ordinary match may already be gone; SDK budget remains10s */ }
      finally { seat.rt.disconnect(); }
    }));
    if (proof) proof.leaveSettledMonoMs = performance.now();
    this.live = this.live.filter(value => !pair.seats.includes(value as Seat));
    this.frames = this.frames.filter(value => value !== pair.timer);
    this.pairs = this.pairs.filter(p => p !== pair);
    if (this.replacements >= this.replacementLimit) throw new InstrumentationFailure('background_replacement_budget_exhausted');
    this.replacements++;
    await this.pair(signal, pair.slot, true);
    return true;
  }
  private async maintainRound(): Promise<boolean> {
    const signal = this.lifetimeSignal!;
    if (this.stopping || signal.aborted) return false;
      const ended = this.pairs.filter(pair => this.matchResults.has(pair.matchId));
      await Promise.all(ended.map(async pair => {
        this.replacing.add(pair.slot); const startedMonoMs = performance.now();
        let outcome: 'ready' | 'failed' = 'ready', reason: string | null = null;
        try { await this.replaceConfirmedEnd(pair, signal); }
        catch (error) {
          if (!this.stopping && !signal.aborted) {
            outcome = 'failed'; reason = error instanceof InstrumentationFailure || error instanceof SutUnavailable ? error.reason : 'background_control_operation_failed';
            this.controlFailure = reason;
          }
        } finally {
          this.replacing.delete(pair.slot);
          if (!this.stopping && !signal.aborted) this.controlTransitions.push({ slot: pair.slot, startedMonoMs, finishedMonoMs: performance.now(), outcome, reason });
        }
      }));
    return !this.controlFailure && !this.stopping && !signal.aborted;
  }
  participantEvidence(): Record<string, unknown> {
    const slots = this.participants.evidence();
    return { version: 1, expectedSlots: this.targetMatches, initializedSlots: slots.length,
      distinctAccounts: new Set(slots.flatMap(value => value.accountBindingHashes)).size,
      distinctOriginalSessions: new Set(slots.flatMap(value => value.sessionBindingHashes)).size,
      completedRematches: this.rounds.filter(value => value.round > 1 && value.readyObserved).length,
      slots, rounds: this.rounds.map(value => ({ ...value })), roomOperations: this.roomOperations.map(value => ({ ...value })),
      policy: { originalParticipantsPerSlot: 2, refreshOrReauthenticationOnRematch: false,
        profileMs: BACKGROUND_PROFILE_MS, referenceRoundMs: NORMAL_ROUND_MS, initialMatches: PVP_INITIAL_LIMIT,
        replacementLimit: PVP_REPLACEMENT_LIMIT, totalRoundLimit: PVP_INITIAL_LIMIT + PVP_REPLACEMENT_LIMIT,
        meaning: 'Finite reference900s/90s schedule budget; faster legitimate endings still fail at this bound.',
        credentialProof: 'Original GameLogin claims/expiry checked; public room/socket gates remain authoritative. No DB lease rewrite.' } };
  }
  observationContext(): Record<string, unknown> {
    return { activeSlots: this.pairs.length, replacingSlots: [...this.replacing], pendingMetricSlots: [...this.reading], controlFailure: this.controlFailure };
  }
  async observe(signal: AbortSignal): Promise<void> {
    if (this.observing) throw new InstrumentationFailure('previous_background_observation_active');
    this.observing = true;
    const coverage = { observedAt: new Date().toISOString(), phase: this.started ? 'running' as const : 'starting' as const, targetMatches: this.targetMatches, activeSlots: this.pairs.length, attemptedMetrics: 0, successfulMetrics: 0, confirmedEndMetricMisses: 0, observedEndingSlots: 0, replacingSlots: this.replacing.size, replacements: this.replacements, endCensoredMetricReads: 0 };
    const pending = new Set<number>();
    const finalize = oneShotCoverage(() => ({ ...coverage, activeSlots: this.pairs.length, replacingSlots: this.replacing.size, replacements: this.replacements,
      closure: this.lifetimeSignal?.aborted || this.stopping ? 'measurement_window_closed' as const : signal.aborted ? 'sample_deadline' as const : 'sample_complete' as const, pendingMetricSlots: [...pending] }), value => this.coverage.push(value));
    signal.addEventListener('abort', finalize, { once: true });
    try {
      if (signal.aborted) { finalize(); throw new InstrumentationFailure('background_observation_cancelled'); }
      if (this.coverage.length >= 2000) throw new InstrumentationFailure('background_coverage_bound_exceeded');
      if (!this.started) return;
      if (this.controlFailure) throw new InstrumentationFailure(this.controlFailure);
      if (this.pairs.length + this.replacing.size < this.targetMatches) throw new InstrumentationFailure('background_slot_missing_without_control');
      const outcomes = await Promise.allSettled([...this.pairs].map(async pair => {
        const ended = () => this.matchResults.has(pair.matchId);
        if (ended()) { coverage.observedEndingSlots++; return; }
        this.reading.add(pair.slot); pending.add(pair.slot); coverage.attemptedMetrics++;
        const readStarted = performance.now(); let readStage = 'rpc_pending', readOutcome = 'pending', httpStatus: number | null = null;
        const finishRead = oneShotCoverage(() => ({ slot: pair.slot, matchBindingHash: sha256(pair.matchId), startedMonoMs: readStarted, finishedMonoMs: performance.now(), elapsedMs: performance.now() - readStarted,
          stage: readStage, outcome: readOutcome === 'confirmed_match_end' ? readOutcome : signal.aborted ? this.lifetimeSignal?.aborted || this.stopping ? 'measurement_window_closed' : 'sample_signal_aborted' : readOutcome, httpStatus,
          signalDefinition: 'parent_sampler_shared_5s_readonly_observation_budget' }), value => { if (this.metricReads.length < 20000) this.metricReads.push(value); });
        const readLifetime = createMetricReadLifetime({ matchBindingHash: sha256(pair.matchId), parentSignal: signal });
        this.pendingMetricReads.set(pair.matchId, readLifetime);
        let endCensorRecorded = false;
        const closeOnResult = () => {
          const proof = readLifetime.finish();
          if (proof.closeReason !== 'authoritative_result' || endCensorRecorded) return;
          const result = this.matchResults.get(pair.matchId);
          if (!result) return;
          endCensorRecorded = true; coverage.endCensoredMetricReads++;
          this.metricEndCensors.push(Object.freeze({ ...proof, slot: pair.slot, authoritativeEventObservedMonoMs: result.observedMonoMs }));
          readOutcome = 'confirmed_match_end'; this.reading.delete(pair.slot); pending.delete(pair.slot); finishRead();
        };
        readLifetime.signal.addEventListener('abort', closeOnResult, { once: true });
        signal.addEventListener('abort', finishRead, { once: true });
        try {
          if (this.metricReads.length >= 20000) throw new InstrumentationFailure('metric_read_evidence_bound');
          let reply;
          try {
            const disposition = await settleMetricRead(call('shooter.metrics', { matchId: pair.matchId }, pair.token, { signal: readLifetime.signal }), readLifetime);
            if (disposition.kind === 'end_censored') return;
            reply = disposition.value;
          }
          catch (error) { if (endCensorRecorded) return; const parentClosed = error instanceof MetricReadParentAborted || signal.aborted; readOutcome = parentClosed ? 'sample_signal_aborted' : 'transport_exception'; throw new InstrumentationFailure(parentClosed ? 'pvp_metric_read_deadline' : 'pvp_metric_transport_exception'); }
          readStage = 'response_validation'; httpStatus = reply.status; readOutcome = 'response_received';
          if (reply.status >= 500) throw new SutUnavailable(`pvp_metrics_http_${reply.status}`);
          const body = object(reply.body);
          if (body.error === 'match_missing') {
            const untilEnd = Date.now() + 1000;
            while (!signal.aborted && Date.now() < untilEnd && !ended()) await wait(25);
            if (!signal.aborted && ended()) { coverage.confirmedEndMetricMisses++; readOutcome = 'confirmed_match_end'; return; }
            throw new SutUnavailable('pvp_metric_missing_without_result_proof');
          }
          if (body.error) throw new InstrumentationFailure('pvp_metrics_error_response');
          if (body.stake !== 0 || body.ticketsMinted !== 0) throw new InstrumentationFailure('pvp_non_free_workload');
          const values = ['n', 'p50', 'p95', 'max', 'tick'].map(key => Number(body[key]));
          if (!values.every(n => Number.isFinite(n) && n >= 0)) throw new InstrumentationFailure('pvp_metrics_invalid_quantiles');
          const seatInputs = (Array.isArray(body.seats) ? body.seats : []).map(value => {
            const seat = object(value), input = { applied: Number(seat.applied), held: Number(seat.held), neutral: Number(seat.neutral), late: Number(seat.late) };
            if (!Object.values(input).every(n => Number.isFinite(n) && n >= 0)) throw new InstrumentationFailure('pvp_metrics_invalid_input_counters'); return input;
          });
          if (signal.aborted || this.stopping) throw new InstrumentationFailure('background_observation_cancelled');
          if (this.matchObservations.length >= 10000) throw new InstrumentationFailure('match_observation_bound_exceeded');
          coverage.successfulMetrics++; readStage = 'completed'; readOutcome = 'observed';
          this.matchObservations.push({ slot: pair.slot, createdMonoMs: pair.createdMonoMs, replacement: pair.replacement, observedMonoMs: performance.now(), matchBindingHash: sha256(pair.matchId), observedAt: new Date().toISOString(), n: values[0], p50: values[1], p95: values[2], max: values[3], tick: values[4], phase: String(body.phase), endReason: String(body.endReason ?? ''), outcome: String(body.outcome ?? ''), seatInputs, observer: 'shooter.metrics' });
        } finally { readLifetime.signal.removeEventListener('abort', closeOnResult); readLifetime.finish(); if (this.pendingMetricReads.get(pair.matchId) === readLifetime) this.pendingMetricReads.delete(pair.matchId); signal.removeEventListener('abort', finishRead); finishRead(); this.reading.delete(pair.slot); pending.delete(pair.slot); }
      }));
      for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    } finally {
      this.observing = false;
      signal.removeEventListener('abort', finalize); finalize();
    }
  }
  async stop(): Promise<void> {
    this.stopping = true; this.controlAbort.abort();
    for (const frame of this.frames) clearInterval(frame);
    for (const live of this.live) { clearInterval(live.timer); live.rt.disconnect(); }
    this.frames = []; this.live = [];
    if (this.controlTask) await this.controlTask;
  }
}
