// Real SDK/WebSocket background traffic, separate accounts from campaign actors.
// Trusted CI owns flag setup; this module performs no SQL, wallet or flag writes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRealtime, type HubRealtime, type MatchHandle, type MatchData } from '../../../packages/hub-sdk/src/index.ts';
import { call, guest, openGame } from '../../../server/test/dup/harness.ts';
import { sha256 } from './contracts.ts';
import { SutUnavailable, InstrumentationFailure } from './runner.ts';
type Encoder = (input: Record<string, unknown>) => Uint8Array;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('background response is not an object');
  return value as Record<string, unknown>;
}
interface Live { rt: HubRealtime; match: MatchHandle; timer?: ReturnType<typeof setInterval> }
interface Seat extends Live { account: string; mail: MatchData[]; seat: number; seq: number; sentTick: number }
interface Pair { slot: number; createdMonoMs: number; replacement: boolean; matchId: string; token: string; seats: Seat[]; timer?: ReturnType<typeof setInterval> }
export interface MatchQuantiles { slot: number; createdMonoMs: number; replacement: boolean; observedMonoMs: number; matchBindingHash: string; observedAt: string; n: number; p50: number; p95: number; max: number; tick: number; phase: string; endReason: string; outcome: string; seatInputs: { applied: number; held: number; neutral: number; late: number }[]; observer: 'shooter.metrics'; }
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
  private lifetimeSignal: AbortSignal | null = null;
  private targetMatches = 0;
  private readonly encode: Encoder;
  private readonly pin: { protocol: number; sim: number; contentFingerprint: string };
  readonly matchObservations: MatchQuantiles[] = [];
  readonly matchEnds: { matchBindingHash: string; observedAt: string; reason: string; outcome: string; replacement: number }[] = [];
  readonly rejectionCounts: Record<string, number> = {};
  readonly coverage: { observedAt: string; phase: 'starting' | 'running'; targetMatches: number; activeSlots: number; attemptedMetrics: number; successfulMetrics: number; confirmedEndMetricMisses: number; replacements: number }[] = [];
  private replacements = 0;
  private readonly replacementLimit = 60;
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
    this.lifetimeSignal = signal; this.targetMatches = freePvpMatches;
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
    this.started = true;
  }
  private async pair(signal: AbortSignal, slot: number, replacement = false): Promise<void> {
    if (this.stopping || signal.aborted) throw new Error('background stopped');
    const a = await openGame((await guest()).token, 'sproto-shooter'), b = await openGame((await guest()).token, 'sproto-shooter');
    if (this.stopping || signal.aborted) throw new Error('background stopped');
    const created = object((await call('shooter.room_create', {}, a.gameToken, { signal })).body);
    if (created.error || created.stake !== 0 || typeof created.matchId !== 'string') throw new Error('free PvP background room unavailable');
    const joined = object((await call('shooter.room_join', { code: created.code, v: this.pin.protocol, sim: this.pin.sim, content: this.pin.contentFingerprint }, b.gameToken, { signal })).body);
    if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
    if (joined.matchId !== created.matchId) throw new Error('free PvP background join failed');
    const seats: Seat[] = [];
    for (const login of [a, b]) {
      const rt = this.socket(login.gameToken), mail: MatchData[] = [];
      const seat: Seat = { rt, match: undefined as unknown as MatchHandle, account: login.hub.userId, mail, seat: -1, seq: 0, sentTick: -1 }; this.live.push(seat);
      await rt.connect();
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
      seat.match = await rt.joinMatch({ matchId: created.matchId });
      if (this.stopping || signal.aborted) throw new InstrumentationFailure('background_handshake_cancelled');
      seat.match.onMessage(message => {
        if (this.stopping) return;
        mail.push(message); if (mail.length > 128) mail.shift();
        if (message.opCode === 3) { const reason = message.json<{ reason?: string }>().reason; const key = typeof reason === 'string' && /^[a-z0-9_]{1,80}$/.test(reason) ? reason : 'unclassified_rejection'; this.rejectionCounts[key] = (this.rejectionCounts[key] ?? 0) + 1; }
      }); seats.push(seat);
    }
    for (const s of seats) s.match.send(1, { accountId: s.account, protocol: this.pin.protocol, sim: this.pin.sim, content: this.pin.contentFingerprint, interpMs: 100 });
    for (const s of seats) {
      const welcome = await until(() => s.mail.find(m => m.opCode === 2 && m.json<{ accountId?: string }>().accountId === s.account), signal);
      s.seat = welcome.json<{ seat: number }>().seat; s.match.send(4, { accountId: s.account });
    }
    await until(() => seats[0].mail.find(m => m.opCode === 5 && m.json<{ phase?: string }>().phase === 'live'), signal);
    const pair: Pair = { slot, createdMonoMs: performance.now(), replacement, matchId: created.matchId, token: a.gameToken, seats }; this.pairs.push(pair);
    pair.timer = setInterval(() => {
      if (this.stopping || this.lifetimeSignal?.aborted) return;
      for (const s of seats) {
        if (s.mail.some(m => m.opCode === 8)) continue;
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
    const result = pair.seats.flatMap(s => s.mail.filter(m => m.opCode === 8)).at(-1);
    if (!result) return false;
    const end = result.json<{ reason?: string; outcome?: string }>();
    this.matchEnds.push({ matchBindingHash: sha256(pair.matchId), observedAt: new Date().toISOString(), reason: end.reason ?? 'unspecified', outcome: end.outcome ?? 'unspecified', replacement: this.replacements });
    clearInterval(pair.timer);
    for (const seat of pair.seats) seat.rt.disconnect();
    this.pairs = this.pairs.filter(p => p !== pair);
    if (++this.replacements > this.replacementLimit) throw new InstrumentationFailure('background_replacement_budget_exhausted');
    await this.pair(signal, pair.slot, true);
    return true;
  }
  async observe(signal: AbortSignal): Promise<void> {
    if (this.observing) throw new InstrumentationFailure('previous_background_observation_active');
    this.observing = true;
    const coverage = { observedAt: new Date().toISOString(), phase: this.started ? 'running' as const : 'starting' as const, targetMatches: this.targetMatches, activeSlots: this.pairs.length, attemptedMetrics: 0, successfulMetrics: 0, confirmedEndMetricMisses: 0, replacements: this.replacements };
    if (this.coverage.length >= 2000) throw new InstrumentationFailure('background_coverage_bound_exceeded');
    try {
    if (!this.started) return;
    while (this.pairs.length < this.targetMatches) {
      if (++this.replacements > this.replacementLimit) throw new InstrumentationFailure('background_replacement_budget_exhausted');
      const occupied = new Set(this.pairs.map(pair => pair.slot));
      const slot = Array.from({ length: this.targetMatches }, (_, i) => i).find(i => !occupied.has(i));
      if (slot === undefined) throw new InstrumentationFailure('background_slot_accounting_mismatch');
      await this.pair(signal, slot, true);
    }
    for (const pair of [...this.pairs]) {
      if (await this.replaceConfirmedEnd(pair, signal)) continue;
      coverage.attemptedMetrics++;
      const reply = await call('shooter.metrics', { matchId: pair.matchId }, pair.token, { signal });
      if (reply.status >= 500) throw new SutUnavailable(`pvp_metrics_http_${reply.status}`);
      const body = object(reply.body);
      if (body.error === 'match_missing') {
        const untilEnd = Date.now() + 1000;
        while (!signal.aborted && Date.now() < untilEnd && !pair.seats.some(s => s.mail.some(m => m.opCode === 8))) await wait(25);
        if (!signal.aborted && await this.replaceConfirmedEnd(pair, signal)) { coverage.confirmedEndMetricMisses++; continue; }
        throw new SutUnavailable('pvp_metric_missing_without_result_proof');
      }
      if (body.error) throw new InstrumentationFailure('pvp_metrics_error_response');
      if (body.stake !== 0 || body.ticketsMinted !== 0) throw new InstrumentationFailure('pvp_non_free_workload');
      const values = ['n', 'p50', 'p95', 'max', 'tick'].map(key => Number(body[key]));
      if (!values.every(n => Number.isFinite(n) && n >= 0)) throw new InstrumentationFailure('pvp_metrics_invalid_quantiles');
      if (this.matchObservations.length >= 10000) throw new InstrumentationFailure('match_observation_bound_exceeded');
      const seatInputs = (Array.isArray(body.seats) ? body.seats : []).map(value => { const seat = object(value); const input = { applied: Number(seat.applied), held: Number(seat.held), neutral: Number(seat.neutral), late: Number(seat.late) }; if (!Object.values(input).every(n => Number.isFinite(n) && n >= 0)) throw new InstrumentationFailure('pvp_metrics_invalid_input_counters'); return input; });
      if (signal.aborted || this.stopping) throw new InstrumentationFailure('background_observation_cancelled');
      coverage.successfulMetrics++;
      this.matchObservations.push({ slot: pair.slot, createdMonoMs: pair.createdMonoMs, replacement: pair.replacement, observedMonoMs: performance.now(), matchBindingHash: sha256(pair.matchId), observedAt: new Date().toISOString(), n: values[0], p50: values[1], p95: values[2], max: values[3], tick: values[4], phase: String(body.phase), endReason: String(body.endReason ?? ''), outcome: String(body.outcome ?? ''), seatInputs, observer: 'shooter.metrics' });
      // These are per-match server quantiles, never samples to merge into a
      // fictitious aggregate p95. Every observed result/end reason is retained
      // when its slot is replaced; a missing metric remains a failed sample.
    }
    } finally { this.observing = false; if (!this.stopping && !this.lifetimeSignal?.aborted) { coverage.activeSlots = this.pairs.length; coverage.replacements = this.replacements; this.coverage.push(coverage); } }
  }
  async stop(): Promise<void> {
    this.stopping = true;
    for (const frame of this.frames) clearInterval(frame);
    for (const live of this.live) { clearInterval(live.timer); live.rt.disconnect(); }
    this.frames = []; this.live = [];
  }
}
