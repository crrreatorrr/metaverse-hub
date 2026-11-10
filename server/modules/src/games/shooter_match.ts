// Nakama-authoritative free 1v1 on director v2 (sproto-shooter protocol 2 /
// sim 2). The vendored director owns spawn seed, combat seed, loadout, ready,
// the input jitter buffer, lag compensation, KO, stall, and the result. This
// file routes presences, sessions, and messages. A free match does not mint,
// stake, or settle Tickets. A wager match (both server flags on) escrows 10
// Tickets a seat through ShooterWagers and settles only from the director.
//
// The director object stays LIVE in a let binding created in matchInit, for
// the whole match. Each match runs in its own goja VM, so the binding lives
// for the match. It is not frozen and thawed per callback (exportState +
// restoreDirector cost 7.4 ms mean / 14 ms p95 per callback in goja late in a
// match), and its used-input log and combat seed never go into the Nakama
// match state, which stays plain JSON. There is no crash-recovery copy: if
// the match VM dies the match is gone, and a free match has nothing to refund.
//
// "done" is sticky (state.ended): once the director or the hub ends the match it
// never reopens during the linger. matchTerminate is final: Nakama keeps calling
// matchLoop for shutdown_grace_sec, and those loops only clean up and return null.
//
// Private rooms: only the host and accounts that used the code (shooter.room_join
// signals "admit:<uid>") may join; the label says private.
//
// Every director message is { op, body, to }. `to` null goes to every present
// seat; otherwise it goes only to the stored presence of that user and
// session (presences carry their node), or to the sender itself, and is
// dropped when no presence matches. Nothing is broadcast with an empty list,
// which Nakama would send to the whole match.

namespace ShooterMatch {
  let directors: { [id: string]: ShooterPvpDirector } | null = null;
  /** REJECTs already sent this loop, by user:session:reason. Null outside a loop. */
  let rejectsThisLoop: { [key: string]: boolean } | null = null;

  function directorBag(): { [id: string]: ShooterPvpDirector } {
    if (!directors) directors = {};
    return directors;
  }

  export interface ResultBody {
    outcome: string;
    winner: number | null;
    reason: string;
    tick: number;
    stateHash: string | null;
    ticketsMinted: number;
    stakes: boolean;
  }

  export interface ReplaySummary {
    /** off (SHOOTER_PVP_REPLAY unset), pending until the director's RESULT is out, then done or skipped. */
    status: string;
    verified: boolean;
    policy: string;
    mismatch: string[];
    ms: number;
    stored: boolean;
  }

  export interface State {
    phase: string;
    /** Public spawn seed. The combat seed lives only in the director. */
    spawnSeed: number;
    /** sha256 of the combat seed, as WELCOME/PHASE send it. */
    combatCommit: string;
    privateRoom: boolean;
    /** Private rooms: accounts that used the code. The host is always admitted. */
    admitted: { [id: string]: number };
    code: string;
    token: string;
    host: string;
    roster: string[];
    /** Hub game-session id. Reconnect must present this same session generation. */
    sids: { [id: string]: string };
    /** 1 when the account has no email. A guest still gets only one seat. */
    guest: { [id: string]: number };
    /** Stays 1 for the life of the seat. A new socket does not bump it. */
    generation: { [id: string]: number };
    /** The current presence (with its node) of each account, or null after it left. */
    present: { [id: string]: nkruntime.Presence | null };
    seated: number;
    tick: number;
    result: ResultBody | null;
    /** True once a match-wide RESULT (the director's, or the hub's shutdown one) went out. */
    resultSent: boolean;
    /** Loop tick the director's RESULT went out on; the replay runs on a later loop. */
    resultTick: number;
    replay: ReplaySummary;
    broken: string;
    /** Sticky: set when the match ends for any reason. Nothing reopens it. */
    ended: boolean;
    /** Set by matchTerminate. Every later loop only cleans up and returns null. */
    terminated: boolean;
    /** HUB_FAULT_INJECT only: the next loop's director call throws. */
    faultThrow: boolean;
    cleaned: boolean;
    liveCleared: boolean;
    endReason: string;
    doneTick: number;
    /** Server clock origin (wall ms at init). */
    startMs: number;
    /** The match clock: monotonic, follows wall time, at most MAX_CLOCK_STEP_MS per loop. */
    clockMs: number;
    /** The wall clock at the last loop, to measure the next step. */
    wallMs: number;
    /** HUB_FAULT_INJECT time warp, added on top of the clock. */
    warpMs: number;
    serverSeq: number;
    samples: number[];
    sampleOver: number;
    overBudget: number;
    snapBytes: number;
    snapCount: number;
    inBytes: number;
    rateDrops: number;
    dropped: number;
    loopCount: number;
    createdMs: number;
    /** True when both server flags allowed this match to escrow. Free matches stay false. */
    wager: boolean;
    /** sha256 of the immutable rule text. Empty on a free match. */
    ruleHash: string;
    /** Accounts that have sent READY. The second one holds the stakes before the director goes live. */
    wagerReady: { [id: string]: number };
    /** Both debits and the escrow row committed. */
    wagerHeld: boolean;
    /** The hold has moved to settled or refunded, or the match ended with nothing in escrow. */
    wagerClosed: boolean;
    /** The one ledger receipt, when the hold closed. */
    wagerReceipt: { [key: string]: unknown } | null;
  }

  function fail(code: string, message: string): string {
    return HubRpc.fail(code, message);
  }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HEX_SEED = /^[0-9a-f]{32,128}$/;

  function gate(ctx: nkruntime.Context): string | null {
    var vars = ctx.vars || null;
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("wrong_scope", "Game session required");
    if (!vars || vars["scope"] !== "game" || vars["game"] !== ShooterProto.GAME_ID) return fail("wrong_scope", "Game session required");
    if (!vars["sid"] || !UUID.test(vars["sid"])) return fail("wrong_scope", "Game session required");
    return null;
  }

  function isObj(value: unknown): value is { [key: string]: unknown } {
    return typeof value === "object" && value !== null && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function bodyOf(payload: string): { [key: string]: unknown } | null {
    if (payload && payload.length > ShooterProto.MAX_JSON) return null;
    if (!payload) return {};
    try {
      var data = JSON.parse(payload) as unknown;
      if (!isObj(data)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /** The display name the director puts in WELCOME `names`: HubMatch.cleanName, or "player" when nothing is left. */
  export function displayName(raw: unknown): string {
    return HubMatch.cleanName(typeof raw === "string" ? raw : "") || "player";
  }

  function blankReplay(on: boolean): ReplaySummary {
    return { status: on ? "pending" : "off", verified: false, policy: "", mismatch: [], ms: 0, stored: false };
  }

  function blank(): State {
    var now = Date.now();
    return {
      phase: "lobby",
      spawnSeed: 1,
      combatCommit: "",
      privateRoom: false,
      admitted: {},
      code: "",
      token: "",
      host: "",
      roster: [],
      sids: {},
      guest: {},
      generation: {},
      present: {},
      seated: 0,
      tick: 0,
      result: null,
      resultSent: false,
      resultTick: 0,
      replay: blankReplay(false),
      broken: "",
      ended: false,
      terminated: false,
      faultThrow: false,
      cleaned: false,
      liveCleared: false,
      endReason: "",
      doneTick: 0,
      startMs: now,
      clockMs: now,
      wallMs: now,
      warpMs: 0,
      serverSeq: 0,
      samples: [],
      sampleOver: 0,
      overBudget: 0,
      snapBytes: 0,
      snapCount: 0,
      inBytes: 0,
      rateDrops: 0,
      dropped: 0,
      loopCount: 0,
      createdMs: now,
      wager: false,
      ruleHash: "",
      wagerReady: {},
      wagerHeld: false,
      wagerClosed: false,
      wagerReceipt: null,
    };
  }

  function parseRoster(raw: unknown): string[] {
    if (typeof raw !== "string" || !raw) return [];
    try {
      var parsed = JSON.parse(raw) as unknown;
      if (Object.prototype.toString.call(parsed) !== "[object Array]") return [];
      var list = parsed as unknown[];
      var out: string[] = [];
      for (var i = 0; i < list.length; i++) {
        var id = String(list[i] || "");
        if (id) out.push(id);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function onRoster(state: State, userId: string): boolean {
    if (!state.roster.length) return true;
    for (var i = 0; i < state.roster.length; i++) if (state.roster[i] === userId) return true;
    return false;
  }

  function accountCount(state: State): number {
    var n = 0;
    for (var key in state.sids) if (key) n++;
    return n;
  }

  /**
   * The match clock for this loop: it advances by the wall time since the last
   * loop, so a late or slow loop catches up (the director steps at most 4 ticks
   * per advance), but never backwards and never more than MAX_CLOCK_STEP_MS per
   * loop when the wall clock jumps.
   */
  function advanceClock(state: State): number {
    var wall = Date.now();
    var step = wall - state.wallMs;
    if (!(step > 0)) step = 0;
    if (step > ShooterProto.MAX_CLOCK_STEP_MS) step = ShooterProto.MAX_CLOCK_STEP_MS;
    state.wallMs = wall;
    state.clockMs += step;
    return state.clockMs + state.warpMs;
  }

  function markEnded(state: State): void {
    state.phase = "done";
    state.ended = true;
  }

  function noteGuest(nk: nkruntime.Nakama, state: State, userId: string): void {
    if (state.guest[userId] === 0 || state.guest[userId] === 1) return;
    var guest = 1;
    try {
      var account = nk.accountGetId(userId);
      var email = account && typeof account.email === "string" ? account.email : "";
      if (email) guest = 0;
    } catch (e) {
      guest = 1;
    }
    state.guest[userId] = guest;
  }

  function everyone(state: State): nkruntime.Presence[] {
    var to: nkruntime.Presence[] = [];
    for (var id in state.present) {
      var presence = state.present[id];
      if (presence) to.push(presence);
    }
    return to;
  }

  /**
   * Who a message goes to. `to` null: every present seat. Otherwise the sender
   * (REJECT and PONG answer it) or the stored presence of that user + session.
   * An empty list means drop: never hand Nakama an empty list.
   */
  function resolve(state: State, to: ShooterPvpTo | null, sender: nkruntime.Presence | null): nkruntime.Presence[] {
    if (to === null || to === undefined) return everyone(state);
    if (!to.userId || !to.sessionId) return [];
    if (sender && sender.userId === to.userId && sender.sessionId === to.sessionId) return [sender];
    var stored = state.present[to.userId];
    if (stored && stored.sessionId === to.sessionId) return [stored];
    return [];
  }

  function send(d: nkruntime.MatchDispatcher, state: State, message: ShooterPvpMessage, sender: nkruntime.Presence | null): void {
    var op = message.op;
    var to = resolve(state, message.to, sender);
    if (!to.length) {
      state.dropped += 1;
      return;
    }
    if (op === ShooterProto.OP_REJECT && rejectsThisLoop) {
      // One REJECT per sender and reason per loop: a burst of bad frames costs one reply.
      var reason = message.body ? String(message.body["reason"] || "") : "";
      var key = to[0].userId + ":" + to[0].sessionId + ":" + reason;
      if (rejectsThisLoop[key]) return;
      rejectsThisLoop[key] = true;
    }
    var stamped: { [key: string]: unknown } = {};
    var body = message.body || {};
    for (var key in body) stamped[key] = body[key];
    if (op === ShooterProto.OP_SNAPSHOT) {
      state.serverSeq += 1;
      stamped["serverSeq"] = state.serverSeq;
    }
    if (stamped["ticketsMinted"] === undefined) stamped["ticketsMinted"] = 0;
    if (op === ShooterProto.OP_RESULT || op === ShooterProto.OP_SNAPSHOT || op === ShooterProto.OP_WELCOME || op === ShooterProto.OP_PHASE) {
      stamped["stakes"] = false;
    }
    var text = JSON.stringify(stamped);
    if (op === ShooterProto.OP_SNAPSHOT) {
      state.snapBytes += text.length;
      state.snapCount += 1;
    }
    d.broadcastMessage(op, text, to, null, true);
  }

  /** A hub-side REJECT for the sender only. */
  function rejectTo(d: nkruntime.MatchDispatcher, state: State, sender: nkruntime.Presence, reason: string): void {
    send(d, state, {
      op: ShooterProto.OP_REJECT,
      body: { accountId: sender.userId, reason: reason, lastSeq: 0, tick: state.tick, ticketsMinted: 0 },
      to: { userId: sender.userId, sessionId: sender.sessionId },
    }, sender);
  }

  function mirror(state: State, director: ShooterPvpDirector): void {
    if (!state.ended) state.phase = director.phase;
    state.seated = director.occupied();
    state.tick = director.sim ? director.sim.tick : 0;
    if (director.result) {
      // Not the combat seed: the match state stays free of it.
      state.result = {
        outcome: director.result.outcome,
        winner: director.result.winner,
        reason: director.result.reason,
        tick: director.result.tick,
        stateHash: director.result.stateHash,
        ticketsMinted: 0,
        stakes: false,
      };
      markEnded(state);
      state.endReason = director.result.reason;
      if (!state.tick) state.tick = director.result.tick;
    }
  }

  function shutdownBody(state: State, director: ShooterPvpDirector | null): ResultBody {
    return {
      outcome: "cancel",
      winner: null,
      reason: "server_shutdown",
      tick: director && director.sim ? director.sim.tick : state.tick,
      stateHash: null,
      ticketsMinted: 0,
      stakes: false,
    };
  }

  /**
   * The hub's only RESULT: the match is ending (shutdown, broken pin) before the
   * director reached its own. A finished match already sent the director's.
   */
  function finishShutdown(d: nkruntime.MatchDispatcher, state: State, director: ShooterPvpDirector | null): void {
    if (state.resultSent || state.ended) {
      state.ended = true;
      return;
    }
    var body = shutdownBody(state, director);
    state.result = body;
    markEnded(state);
    state.endReason = body.reason;
    state.resultSent = true;
    send(d, state, {
      op: ShooterProto.OP_RESULT,
      body: {
        outcome: body.outcome,
        winner: body.winner,
        reason: body.reason,
        tick: body.tick,
        stateHash: body.stateHash,
        ticketsMinted: 0,
        stakes: false,
      },
      to: null,
    }, null);
  }

  /** Free the "one live match" rows so both accounts can queue again while the match lingers. */
  function clearLive(nk: nkruntime.Nakama, state: State, matchId: string): void {
    if (state.liveCleared) return;
    state.liveCleared = true;
    if (state.host) ShooterMm.clearLive(nk, state.host, matchId);
    for (var id in state.sids) ShooterMm.clearLive(nk, id, matchId);
    for (var r = 0; r < state.roster.length; r++) ShooterMm.clearLive(nk, state.roster[r], matchId);
  }

  function cleanup(nk: nkruntime.Nakama, state: State, matchId: string): void {
    if (state.cleaned) return;
    state.cleaned = true;
    if (state.code) ShooterMm.releaseCode(nk, state.code);
    if (state.token) ShooterMm.forgetGroup(nk, state.token);
    clearLive(nk, state, matchId);
    if (directors) delete directors[matchId];
  }

  /** Send messages in order; note the director's match-wide RESULT. */
  function publish(d: nkruntime.MatchDispatcher, state: State, messages: ShooterPvpMessage[], sender: nkruntime.Presence | null, tick: number): void {
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.op === ShooterProto.OP_RESULT && message.to === null) {
        if (state.resultSent) continue;
        state.resultSent = true;
        state.resultTick = tick;
      }
      send(d, state, message, sender);
    }
  }

  /**
   * After RESULT: re-run the director's used-input log through replayJSON v2
   * and keep the record write-once, server-only. Free play settles nothing;
   * this is the groundwork wagers will settle on. A mismatch is logged without
   * the record (which holds the combat seed).
   */
  function keepRecord(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: State, director: ShooterPvpDirector, matchId: string): void {
    if (state.replay.status !== "pending") return;
    var sim = ShooterProto.api();
    // No sim (a lobby cancel) or no director RESULT (shutdown first): nothing worth replaying.
    if (!sim || !director.sim || !director.result) {
      state.replay.status = "skipped";
      closeWager(nk, logger, state, director, matchId);
      return;
    }
    var started = Date.now();
    var record = director.replayRecord();
    var receipt: ShooterPvpReceipt;
    try {
      receipt = JSON.parse(sim.replayJSON(record)) as ShooterPvpReceipt;
    } catch (e) {
      receipt = { ok: false, reason: "replay_threw", outcome: null, winner: null, ticketsMinted: 0 };
    }
    var verdict = receipt.verdict || null;
    state.replay.status = "done";
    state.replay.verified = receipt.verified === true;
    state.replay.policy = verdict ? verdict.policy : "refuse";
    state.replay.mismatch = receipt.mismatch ? receipt.mismatch.slice(0, 16) : [receipt.reason || "refused"];
    state.replay.ms = Date.now() - started;
    if (!state.replay.verified) {
      logger.warn("sproto_shooter_free replay mismatch " + matchId + " " + state.replay.mismatch.join(","));
    }
    try {
      nk.storageWrite([{
        collection: ShooterProto.REPLAY_COLLECTION,
        key: matchId,
        userId: ShooterMm.SYSTEM_USER,
        value: {
          v: 1,
          matchId: matchId,
          storedAt: Date.now(),
          commit: ShooterProto.COMMIT,
          bundleSha256: ShooterProto.BUNDLE_SHA256,
          record: record,
          receipt: {
            ok: receipt.ok !== false,
            verified: state.replay.verified,
            mismatch: state.replay.mismatch,
            verdict: verdict,
            tick: receipt.tick === undefined ? null : receipt.tick,
            stateHash: receipt.stateHash === undefined ? null : receipt.stateHash,
            stateSha256: receipt.stateSha256 === undefined ? null : receipt.stateSha256,
            outcome: receipt.outcome,
            winner: receipt.winner,
          },
          ticketsMinted: 0,
          stakes: false,
        },
        version: "*",
        permissionRead: 0,
        permissionWrite: 0,
      }]);
      state.replay.stored = true;
    } catch (e) {
      logger.error("sproto_shooter_free replay store failed " + matchId);
    }
    sweepRecords(nk, logger);
    closeWager(nk, logger, state, director, matchId);
  }

  /**
   * Delete replay records past REPLAY_RETENTION_DAYS. Runs after a store, at most
   * once an hour per node, over at most REPLAY_SWEEP_PAGES pages of 100.
   */
  function sweepRecords(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    var key = "shooter-pvp:replay-sweep";
    try {
      if (nk.localcacheGet(key)) return;
      nk.localcachePut(key, "1", 3600);
      var cutoff = Date.now() - ShooterProto.REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      var cursor = "";
      for (var page = 0; page < ShooterProto.REPLAY_SWEEP_PAGES; page++) {
        var list = nk.storageList(ShooterMm.SYSTEM_USER, ShooterProto.REPLAY_COLLECTION, 100, cursor);
        var objects = list && list.objects ? list.objects : [];
        var old: nkruntime.StorageDeleteRequest[] = [];
        for (var i = 0; i < objects.length; i++) {
          var at = Number(objects[i].value ? objects[i].value["storedAt"] : 0);
          if (!(at > cutoff)) old.push({ collection: ShooterProto.REPLAY_COLLECTION, key: objects[i].key, userId: ShooterMm.SYSTEM_USER });
        }
        if (old.length) nk.storageDelete(old);
        cursor = list && list.cursor ? list.cursor : "";
        if (!cursor) break;
      }
    } catch (e) {
      logger.warn("sproto_shooter_free replay sweep failed");
    }
  }

  function sample(state: State, started: number): void {
    var elapsed = Date.now() - started;
    if (elapsed < 0) elapsed = 0;
    state.samples.push(elapsed);
    if (state.samples.length > ShooterProto.SAMPLE_CAP) state.samples.shift();
    if (elapsed >= 25) state.sampleOver += 1;
    if (elapsed >= ShooterProto.BUDGET_MS) state.overBudget += 1;
    state.loopCount += 1;
  }

  function percentile(samples: number[], p: number): number {
    if (!samples.length) return 0;
    var copy = samples.slice();
    copy.sort(function (a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * copy.length) - 1;
    if (idx < 0) idx = 0;
    if (idx >= copy.length) idx = copy.length - 1;
    return copy[idx];
  }

  function seatMetrics(director: ShooterPvpDirector | null): { [key: string]: unknown }[] {
    var out: { [key: string]: unknown }[] = [];
    if (!director) return out;
    for (var i = 0; i < ShooterProto.SEATS; i++) {
      var stats = director.seatStats(i);
      if (!stats) continue;
      out.push({
        seat: i,
        connected: stats.connected,
        applied: stats.applied,
        held: stats.held,
        neutral: stats.neutral,
        late: stats.late,
        buffer: stats.buffer,
        rttMs: stats.rttMs,
        rewindCap: stats.rewindCap,
        clamped: stats.clamped,
      });
    }
    return out;
  }

  /** Never includes the combat seed, the replay record, or the used-input log. */
  function metricsOf(state: State, director: ShooterPvpDirector | null): { [key: string]: unknown } {
    var guests = 0;
    var accounts = 0;
    for (var id in state.sids) {
      accounts += 1;
      if (state.guest[id] === 1) guests += 1;
    }
    return {
      n: state.samples.length,
      p50: percentile(state.samples, 50),
      p95: percentile(state.samples, 95),
      max: state.samples.length ? percentile(state.samples, 100) : 0,
      over25: state.sampleOver,
      overBudget: state.overBudget,
      budgetMs: ShooterProto.BUDGET_MS,
      snapBytes: state.snapBytes,
      snapCount: state.snapCount,
      inBytes: state.inBytes,
      rateDrops: state.rateDrops,
      dropped: state.dropped,
      loops: state.loopCount,
      tick: state.tick,
      phase: state.phase,
      endReason: state.endReason,
      stateHash: state.result ? state.result.stateHash : "",
      outcome: state.result ? state.result.outcome : "",
      winner: state.result ? state.result.winner : null,
      combatCommit: state.combatCommit,
      private: state.privateRoom,
      replay: {
        status: state.replay.status,
        verified: state.replay.verified,
        policy: state.replay.policy,
        mismatch: state.replay.mismatch,
        ms: state.replay.ms,
        stored: state.replay.stored,
      },
      seats: seatMetrics(director),
      ticketsMinted: 0,
      stakes: state.wagerHeld,
      stake: state.wagerHeld ? ShooterWagers.STAKE : 0,
      wagerClosed: state.wagerClosed,
      seated: state.seated,
      accounts: accounts,
      guests: guests,
      serverSeq: state.serverSeq,
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
    };
  }

  function spawnSeedOf(nk: nkruntime.Nakama, params: { [key: string]: unknown }): number {
    if (params["seedSource"] === "server") {
      var n = parseInt(String(params["spawnSeed"] === undefined || params["spawnSeed"] === null ? "" : params["spawnSeed"]), 10);
      if (n > 0 && n <= 4294967295) return n >>> 0;
    }
    return ShooterProto.serverSeed(nk);
  }

  function hostDirector(sim: ShooterPvpApi, nk: nkruntime.Nakama, state: State, matchId: string): ShooterPvpDirector | string {
    var combatSeed = ShooterProto.combatSeed(nk);
    if (!HEX_SEED.test(combatSeed)) return "combat_seed";
    var options: ShooterPvpHostedOptions = {
      spawnSeed: state.spawnSeed,
      combatSeed: combatSeed,
      matchId: matchId,
      build: { bundleSha256: ShooterProto.BUNDLE_SHA256, sourceCommit: ShooterProto.COMMIT },
    };
    if (state.wager) options.rttCeilingMs = ShooterWagers.RTT_CEILING_MS;
    // A matchmade pair fixes seat order. A private room seats in HELLO order.
    if (state.roster.length === ShooterProto.SEATS && state.roster[0] !== state.roster[1]) {
      options.accounts = [state.roster[0], state.roster[1]];
    }
    var director: ShooterPvpDirector;
    try {
      director = sim.createHostedDirector(options);
    } catch (e) {
      // The message can name the option; never the seed itself.
      return "director_init";
    }
    if (director.combatSeedDerived !== false) return "combat_seed";
    return director;
  }

  /** Seat 0 and seat 1. A matchmade roster must be that same pair, in that order. */
  function pairOf(state: State, director: ShooterPvpDirector): [string, string] | null {
    var a = "";
    var b = "";
    for (var id in state.sids) {
      var seat = director.seatOf(id);
      if (seat === 0) a = id;
      else if (seat === 1) b = id;
    }
    if (!a || !b || a === b) return null;
    if (state.roster.length === 2 && (a !== state.roster[0] || b !== state.roster[1])) return null;
    return [a, b];
  }

  /** End a wager match that never took a hold. No ledger call. */
  function endUnheld(d: nkruntime.MatchDispatcher, state: State, reason: string): void {
    if (state.ended) {
      state.wagerClosed = true;
      return;
    }
    state.result = {
      outcome: "cancel",
      winner: null,
      reason: reason,
      tick: state.tick,
      stateHash: null,
      ticketsMinted: 0,
      stakes: false,
    };
    markEnded(state);
    state.endReason = reason;
    state.wagerClosed = true;
    if (state.replay.status === "pending") state.replay.status = "skipped";
    send(d, state, {
      op: ShooterProto.OP_RESULT,
      body: {
        outcome: "cancel",
        winner: null,
        reason: reason,
        tick: state.tick,
        stateHash: null,
        ticketsMinted: 0,
        stakes: false,
      },
      to: null,
    }, null);
  }

  /**
   * On the READY that completes the pair, debit both seats before the director
   * is allowed to go live. A refusal ends the match and does not deliver READY.
   */
  function armHold(nk: nkruntime.Nakama, logger: nkruntime.Logger, d: nkruntime.MatchDispatcher, state: State, director: ShooterPvpDirector, matchId: string, userId: string): boolean {
    if (!state.wager || state.wagerHeld || state.ended) return true;
    state.wagerReady[userId] = 1;
    var pair = pairOf(state, director);
    if (!pair) {
      var readyN = 0;
      for (var id in state.wagerReady) if (state.wagerReady[id]) readyN += 1;
      if (readyN >= 2 && director.occupied() >= 2) {
        endUnheld(d, state, "version_mismatch");
        return false;
      }
      return true;
    }
    if (!state.wagerReady[pair[0]] || !state.wagerReady[pair[1]]) return true;
    if (state.guest[pair[0]] === 1 || state.guest[pair[1]] === 1) {
      endUnheld(d, state, "wager_guest");
      return false;
    }
    if (!ShooterWagers.enabled(nk, pair[0], logger) || !ShooterWagers.enabled(nk, pair[1], logger)) {
      endUnheld(d, state, "stakes_disabled");
      return false;
    }
    var held = ShooterWagers.hold(nk, matchId, pair[0], pair[1], state.ruleHash);
    if (!held || held["error"] || held["status"] !== "held") {
      endUnheld(d, state, held && held["error"] ? String(held["error"]) : "hold_failed");
      return false;
    }
    state.wagerHeld = true;
    return true;
  }

  /** Move a held pot to settled or refunded once. Waits until the replay is no longer pending. */
  function closeWager(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: State, director: ShooterPvpDirector | null, matchId: string): void {
    if (!state.wager || state.wagerClosed) return;
    if (state.replay.status === "pending") return;
    if (!state.wagerHeld) {
      state.wagerClosed = true;
      return;
    }
    var live = director && director.result ? director.result : null;
    var outcome = live ? live.outcome : (state.result ? state.result.outcome : "");
    var reason = live ? live.reason : (state.result ? state.result.reason : "");
    var winner = live ? live.winner : (state.result ? state.result.winner : null);
    var money = ShooterWagers.plan(outcome, reason, winner, state.replay.policy || "", state.replay.verified === true);
    var receipt: { [key: string]: unknown } | null = null;
    try {
      if (money.op === "settle" && (money.winnerSeat === 0 || money.winnerSeat === 1)) {
        receipt = ShooterWagers.settle(nk, matchId, money.winnerSeat, money.reason);
        if (receipt["error"]) {
          logger.error("shooter wager settle " + matchId + " " + String(receipt["error"]));
          receipt = ShooterWagers.refund(nk, matchId, "replay_refuse");
        }
      } else {
        receipt = ShooterWagers.refund(nk, matchId, money.reason);
      }
    } catch (e) {
      // A thrown settle or refund must not leave the pot until the 20 minute sweep.
      logger.error("shooter wager close threw " + matchId + " " + String(e));
      try {
        receipt = ShooterWagers.refund(nk, matchId, "replay_refuse");
      } catch (e2) {
        logger.error("shooter wager refund threw " + matchId + " " + String(e2));
        return;
      }
    }
    if (!receipt) return;
    state.wagerClosed = true;
    state.wagerReceipt = receipt;
    if (receipt["error"]) logger.error("shooter wager close " + matchId + " " + String(receipt["error"]));
    else logger.info("shooter wager " + String(receipt["status"] || "closed") + " " + matchId);
  }

  /** One loop of director work: route each message, advance the clock, mirror the result. */
  function runDirector(nk: nkruntime.Nakama, logger: nkruntime.Logger, d: nkruntime.MatchDispatcher, tick: number, state: State, director: ShooterPvpDirector, messages: nkruntime.MatchMessage[], now: number, matchId: string): void {
    var handled: { [userId: string]: number } = {};
    var rated: { [userId: string]: boolean } = {};
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      var sender = message.sender;
      if (!sender || !sender.userId || !sender.sessionId) continue;
      var current = state.present[sender.userId];
      if (!current || current.sessionId !== sender.sessionId) {
        // A replaced or departed socket: not this seat's presence any more.
        state.dropped += 1;
        continue;
      }
      var size = typeof message.data === "string" ? message.data.length : message.data ? message.data.byteLength : 0;
      state.inBytes += size;
      var count = (handled[sender.userId] || 0) + 1;
      handled[sender.userId] = count;
      if (count > ShooterProto.MAX_MSGS_PER_SENDER) {
        state.rateDrops += 1;
        if (!rated[sender.userId]) {
          rated[sender.userId] = true;
          rejectTo(d, state, sender, "rate");
        }
        continue;
      }
      var op = message.opCode;
      var packet: string | Uint8Array = "";
      if (op === ShooterProto.OP_INPUT) {
        var bytes = ShooterProto.bytesOf(nk, message.data);
        if (bytes.length !== ShooterProto.FRAME_BYTES) {
          rejectTo(d, state, sender, "malformed");
          continue;
        }
        packet = bytes;
      } else {
        var text = ShooterProto.textOf(nk, message.data);
        if (text.length > ShooterProto.MAX_JSON) {
          rejectTo(d, state, sender, "malformed");
          continue;
        }
        if (op === ShooterProto.OP_HELLO || op === ShooterProto.OP_READY || op === ShooterProto.OP_RESYNC) {
          var parsed = bodyOf(text);
          if (parsed && ShooterProto.hostile(parsed)) {
            rejectTo(d, state, sender, "client_result");
            continue;
          }
        }
        packet = text;
      }
      var justHeld = false;
      if (op === ShooterProto.OP_READY) {
        var wasHeld = state.wagerHeld;
        if (!armHold(nk, logger, d, state, director, matchId, sender.userId)) break;
        justHeld = !wasHeld && state.wagerHeld;
      }
      // HELLO is the only rebind; RESYNC serves the bound session only.
      var actor: ShooterPvpSender = { userId: sender.userId, sessionId: sender.sessionId, username: displayName(sender.username) };
      var out = director.handle(actor, op, packet, now);
      if (justHeld && !state.ended && director.phase !== "live" && director.phase !== "done") {
        // The hold committed and the director refused to start. Put both stakes back.
        ShooterWagers.refund(nk, matchId, "ready_timeout");
        state.wagerHeld = false;
        state.wagerClosed = true;
        endUnheld(d, state, "ready_timeout");
        break;
      }
      publish(d, state, out && out.messages ? out.messages : [], sender, tick);
    }
    if (!state.ended) {
      var advanced = director.advance(now);
      publish(d, state, advanced && advanced.messages ? advanced.messages : [], null, tick);
      mirror(state, director);
    }
  }

  /** The caller of a metrics signal: "" for the server, else a user that must hold a seat. */
  function signalUser(data: string, name: string): string | null {
    if (data === name) return "";
    if (data.indexOf(name + ":") === 0) return data.slice(name.length + 1);
    return null;
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (ctx, logger, nk, params) {
      var state = blank();
      var mismatch = ShooterProto.verifyRuntime();
      var matchId = ctx.matchId || "";
      state.privateRoom = params["private"] === "1";
      var env = ctx.env || null;
      state.replay = blankReplay(!!env && env[ShooterProto.REPLAY_ENV] === "1");
      state.code = typeof params["code"] === "string" ? params["code"] : "";
      state.token = typeof params["token"] === "string" ? params["token"] : "";
      state.host = typeof params["host"] === "string" ? params["host"] : "";
      state.roster = parseRoster(params["roster"]);
      state.spawnSeed = spawnSeedOf(nk, params);
      var wantWager = params["wager"] === "1";
      if (wantWager && !mismatch) {
        var rosterOk = state.roster.length === 0 || (state.roster.length === 2 && state.roster[0] !== state.roster[1]);
        var flagged = false;
        if (state.roster.length === 2) flagged = ShooterWagers.enabled(nk, state.roster[0], logger) && ShooterWagers.enabled(nk, state.roster[1], logger);
        else if (state.host) flagged = ShooterWagers.enabled(nk, state.host, logger);
        if (rosterOk && flagged) {
          state.wager = true;
          state.ruleHash = ShooterWagers.ruleHash(nk);
          state.replay = blankReplay(true);
        } else {
          logger.info("sproto_shooter_free wager refused");
        }
      }
      if (mismatch) {
        state.broken = mismatch;
        logger.error("sproto_shooter_free pin " + mismatch);
      } else {
        var sim = ShooterProto.api();
        if (!sim) {
          state.broken = "sim_missing";
          logger.error("sproto_shooter_free pin sim_missing");
        } else {
          var made = hostDirector(sim, nk, state, matchId);
          if (typeof made === "string") {
            state.broken = made;
            logger.error("sproto_shooter_free director " + made);
          } else {
            directorBag()[matchId] = made;
            state.combatCommit = made.combatCommit;
          }
        }
      }
      logger.info("sproto_shooter_free init " + matchId);
      return { state: state, tickRate: ShooterProto.TICK_RATE, label: ShooterProto.labelFor(state.privateRoom, state.wager ? ShooterWagers.STAKE : 0) };
    },

    matchJoinAttempt: function (ctx, logger, nk, _d, _tick, state, presence, _metadata) {
      var vars = ctx.vars || null;
      if (!presence || !presence.userId || !presence.sessionId) return { state: state, accept: false, rejectMessage: "malformed" };
      if (!vars || vars["scope"] !== "game" || vars["game"] !== ShooterProto.GAME_ID || !vars["sid"] || !UUID.test(vars["sid"])) {
        return { state: state, accept: false, rejectMessage: "wrong_scope" };
      }
      if (state.broken) return { state: state, accept: false, rejectMessage: "version" };
      var userId = presence.userId;
      var sid = vars["sid"];
      var known = state.sids[userId] || "";
      if (known && known !== sid) return { state: state, accept: false, rejectMessage: "wrong_sender" };
      var director = directorBag()[ctx.matchId || ""];
      if (!director || state.cleaned || state.terminated) return { state: state, accept: false, rejectMessage: "ended" };
      if (state.ended || director.phase === "done") {
        // A seated account may come back to a finished match: its HELLO gets
        // WELCOME, the final snapshot and a copy of RESULT. Nobody else.
        if (known && director.seatOf(userId) >= 0) return { state: state, accept: true };
        return { state: state, accept: false, rejectMessage: "ended" };
      }
      if (!known) {
        if (state.privateRoom && userId !== state.host && !state.admitted[userId]) {
          return { state: state, accept: false, rejectMessage: "not_admitted" };
        }
        if (!onRoster(state, userId)) return { state: state, accept: false, rejectMessage: "not_in_roster" };
        if (accountCount(state) >= ShooterProto.SEATS) return { state: state, accept: false, rejectMessage: "match_full" };
        var verdict = director.joinAttempt(userId);
        if (!verdict.accept) return { state: state, accept: false, rejectMessage: verdict.reason || "match_full" };
        var elsewhere = ShooterMm.liveMatch(nk, userId);
        if (elsewhere && elsewhere !== (ctx.matchId || "")) return { state: state, accept: false, rejectMessage: "already_in_match" };
      }
      if (state.wager) {
        noteGuest(nk, state, userId);
        if (state.guest[userId] === 1) return { state: state, accept: false, rejectMessage: "wager_guest" };
        if (!ShooterWagers.enabled(nk, userId, logger)) return { state: state, accept: false, rejectMessage: "stakes_disabled" };
      }
      if (!known) {
        state.sids[userId] = sid;
        state.generation[userId] = 1;
        noteGuest(nk, state, userId);
      }
      return { state: state, accept: true };
    },

    matchJoin: function (ctx, _logger, nk, d, _tick, state, presences) {
      var matchId = ctx.matchId || "";
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var old = state.present[presence.userId];
        if (old && old.sessionId !== presence.sessionId) {
          try {
            d.matchKick([old]);
          } catch (e) {
            /* the previous socket may already be gone */
          }
        }
        // The whole presence, node included: routed messages go to exactly this one.
        state.present[presence.userId] = presence;
        if (!state.ended && !state.terminated) ShooterMm.setLive(nk, presence.userId, matchId);
      }
      return { state: state };
    },

    matchLeave: function (ctx, _logger, _nk, _d, _tick, state, presences) {
      var director = directorBag()[ctx.matchId || ""];
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var current = state.present[presence.userId];
        if (current && current.sessionId === presence.sessionId) state.present[presence.userId] = null;
        if (director) director.disconnect(presence.userId, presence.sessionId);
      }
      return { state: state };
    },

    matchLoop: function (ctx, logger, nk, d, tick, state, messages) {
      var started = Date.now();
      var matchId = ctx.matchId || "";
      var director = directorBag()[matchId];
      if (state.terminated || state.broken || !director) {
        finishShutdown(d, state, director || null);
        if (state.replay.status === "pending") state.replay.status = "skipped";
        closeWager(nk, logger, state, director || null, matchId);
        cleanup(nk, state, matchId);
        sample(state, started);
        return null;
      }
      if (state.ended && state.resultSent && state.replay.status === "pending" && tick > state.resultTick) {
        // Deferred: never on the loop that stepped the sim and sent RESULT, and
        // kept out of the per-loop samples (the match is over).
        keepRecord(nk, logger, state, director, matchId);
        started = Date.now();
      }
      var now = advanceClock(state);
      rejectsThisLoop = {};
      try {
        if (state.faultThrow) throw new Error("fault_inject");
        // A match the hub ended while the director still sat in its lobby (nobody
        // said HELLO) stays shut: no late HELLO seats anyone during the linger.
        if (!state.ended || director.phase === "done") runDirector(nk, logger, d, tick, state, director, messages, now, matchId);
      } catch (e) {
        rejectsThisLoop = null;
        // The error text is not logged: it could carry director internals.
        logger.error("sproto_shooter_free director failed " + matchId);
        finishShutdown(d, state, director);
        if (state.replay.status === "pending") state.replay.status = "skipped";
        closeWager(nk, logger, state, director, matchId);
        cleanup(nk, state, matchId);
        sample(state, started);
        return null;
      }
      rejectsThisLoop = null;
      if (director.phase === "live" && director.sim && now - state.startMs > ShooterProto.MAX_MATCH_MS && director.sim.phase !== "done" && !director.result) {
        logger.warn("sproto_shooter_free duration " + matchId);
      }
      if (!state.ended && director.phase === "lobby" && director.occupied() === 0 && now - state.startMs >= ShooterProto.READY_MS) {
        // Nobody said HELLO: there is no seat to tell, so no RESULT. The match closes.
        state.result = { outcome: "cancel", winner: null, reason: "ready_timeout", tick: 0, stateHash: null, ticketsMinted: 0, stakes: false };
        markEnded(state);
        state.endReason = "ready_timeout";
        if (state.replay.status === "pending") state.replay.status = "skipped";
      }
      if (state.ended) {
        closeWager(nk, logger, state, director, matchId);
        if (!state.doneTick) state.doneTick = tick;
        clearLive(nk, state, matchId);
        if (tick - state.doneTick > ShooterProto.LINGER_S * ShooterProto.TICK_RATE) {
          if (state.replay.status === "pending" && state.resultSent) keepRecord(nk, logger, state, director, matchId);
          cleanup(nk, state, matchId);
          sample(state, started);
          return null;
        }
      }
      sample(state, started);
      return { state: state };
    },

    matchTerminate: function (ctx, logger, nk, d, _tick, state, _grace) {
      var matchId = ctx.matchId || "";
      var director = directorBag()[matchId] || null;
      if (director) mirror(state, director);
      // Only a match whose director RESULT went out has a record; a shutdown first has none.
      if (director && director.result && state.resultSent && state.replay.status === "pending") keepRecord(nk, logger, state, director, matchId);
      if (state.replay.status === "pending") state.replay.status = "skipped";
      finishShutdown(d, state, director);
      closeWager(nk, logger, state, director, matchId);
      state.terminated = true;
      cleanup(nk, state, matchId);
      return { state: state };
    },

    matchSignal: function (ctx, _logger, _nk, _d, _tick, state, data) {
      var env = ctx.env || null;
      var faults = !!env && env["HUB_FAULT_INJECT"] === "1";
      if (data.indexOf("admit:") === 0) {
        // Server-only (nk.matchSignal): shooter.room_join admits the account that used the code.
        var uid = data.slice("admit:".length);
        var ok = state.privateRoom && !state.ended && !state.terminated && UUID.test(uid);
        if (ok && !state.admitted[uid] && uid !== state.host) {
          var n = 0;
          for (var id in state.admitted) if (id) n++;
          if (n >= ShooterProto.MAX_ADMITTED) ok = false;
          else state.admitted[uid] = 1;
        }
        return { state: state, data: JSON.stringify(ok ? { ok: true } : { ok: false, error: "room_closed" }) };
      }
      if (data.indexOf("advance:") === 0) {
        if (faults) {
          var delta = parseInt(data.slice("advance:".length), 10);
          if (delta > 0 && delta < 3600000) state.warpMs += delta;
        }
      } else if (data === "fault:throw") {
        if (faults) state.faultThrow = true;
      }
      var reset = signalUser(data, "reset-metrics");
      var who = reset !== null ? reset : signalUser(data, "metrics");
      if (who) {
        // A game session may read (or reset) only a match it holds a seat in.
        if (!state.sids[who]) return { state: state, data: JSON.stringify({ error: "not_in_match" }) };
      }
      if (reset !== null) {
        state.samples = [];
        state.sampleOver = 0;
        state.overBudget = 0;
      }
      return { state: state, data: JSON.stringify(metricsOf(state, directorBag()[ctx.matchId || ""] || null)) };
    },
  };

  export function rpcVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var mismatch = ShooterProto.verifyRuntime();
    if (mismatch) {
      logger.error("sproto_shooter_free pin " + mismatch);
      return fail("version_mismatch", "Simulation pin mismatch");
    }
    return JSON.stringify({
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
      loadoutHash: ShooterProto.LOADOUT_HASH,
      bundleSha256: ShooterProto.BUNDLE_SHA256,
      commit: ShooterProto.COMMIT,
      repo: ShooterProto.REPO,
      campaignFingerprint: ShooterProto.CAMPAIGN_FINGERPRINT,
      match: ShooterProto.MATCH_NAME,
      mode: ShooterProto.MODE,
      loopHz: ShooterProto.TICK_RATE,
      readyMs: ShooterProto.READY_MS,
      stallMs: ShooterProto.STALL_MS,
      reconnectMs: ShooterProto.STALL_MS,
      budgetMs: ShooterProto.BUDGET_MS,
      stake: 0,
      ticketsMinted: 0,
      stakes: false,
      wagerEnabled: ShooterWagers.enabled(nk, ctx.userId || "", logger),
      wagerStake: ShooterWagers.STAKE,
      wagerPot: ShooterWagers.POT,
      guests: "one_seat",
      practice: "offline",
    });
  }

  export function rpcRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var mismatch = ShooterProto.verifyRuntime();
    if (mismatch) {
      logger.error("sproto_shooter_free pin " + mismatch);
      return fail("version_mismatch", "Simulation pin mismatch");
    }
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    if (req["mode"] === "practice") return fail("practice_offline", "Practice stays on this machine");
    var wantWager = req["mode"] === "wager";
    if (wantWager) {
      if (!ShooterWagers.enabled(nk, ctx.userId || "", logger)) return fail("stakes_disabled", "Wagers are off");
      if (HubChat.isGuest(nk, logger, ctx.userId || "")) return fail("wager_guest", "Sign in to wager");
    }
    if (ShooterProto.hostile(req) || req["seed"] !== undefined || req["state"] !== undefined) return fail("rejected", "The server chooses the match");
    if (req["v"] !== undefined && Number(req["v"]) !== ShooterProto.PROTOCOL) return fail("version_mismatch", "Version mismatch");
    if (req["sim"] !== undefined && Number(req["sim"]) !== ShooterProto.SIM) return fail("version_mismatch", "Version mismatch");
    if (req["content"] !== undefined && String(req["content"]) !== ShooterProto.FINGERPRINT) return fail("version_mismatch", "Version mismatch");
    // shooter_pvp gates a new free room. shooter_pvp_wager is still required, with it, for a hold.
    // Joining or playing a match that already exists does not read this flag.
    if (!wantWager && !Flags.on(nk, ShooterWagers.FLAG_PVP, ctx.userId || "", logger)) return fail("pvp_off", "Free matches are off");
    var closed = Maint.deny(nk);
    if (closed) return closed;
    if (!ShooterMm.rateAllow(nk, ctx.userId || "", "create")) return fail("rate_limited", "Too many rooms");
    if (ShooterMm.liveMatch(nk, ctx.userId || "")) return fail("already_in_match", "Already in a match");
    // A queued account would be live in two matches: leave the queue first (MatchmakerRemove).
    if (ShooterMm.queued(nk, ctx.userId || "")) return fail("already_queued", "Leave the queue first");
    var code = "";
    for (var attempt = 0; attempt < 5 && !code; attempt++) {
      var candidate = ShooterProto.roomCode(nk);
      if (ShooterMm.reserveCode(nk, candidate)) code = candidate;
    }
    if (!code) return fail("room_code_busy", "Could not allocate a room code");
    // The spawn seed only. The combat seed is made inside the match and never leaves it before RESULT.
    var spawnSeed = ShooterProto.serverSeed(nk);
    var matchId = "";
    try {
      matchId = nk.matchCreate(ShooterProto.MATCH_NAME, {
        private: "1",
        code: code,
        host: ctx.userId || "",
        spawnSeed: String(spawnSeed),
        seedSource: "server",
        wager: wantWager ? "1" : "0",
      });
    } catch (e) {
      ShooterMm.releaseCode(nk, code);
      logger.error("sproto_shooter_free room " + String(e));
      return fail("room_failed", "Could not create the room");
    }
    ShooterMm.bindCode(nk, code, matchId, Date.now() + ShooterProto.CODE_TTL_S * 1000);
    ShooterMm.setLive(nk, ctx.userId || "", matchId);
    logger.info("sproto_shooter_free room " + matchId);
    return JSON.stringify({
      matchId: matchId,
      code: code,
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
      loadoutHash: ShooterProto.LOADOUT_HASH,
      stake: wantWager ? ShooterWagers.STAKE : 0,
      pot: wantWager ? ShooterWagers.POT : 0,
      ticketsMinted: 0,
      stakes: wantWager,
      mode: wantWager ? "wager" : ShooterProto.MODE,
    });
  }

  export function rpcRoomJoin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    if (req["mode"] === "practice") return fail("practice_offline", "Practice stays on this machine");
    if (ShooterProto.hostile(req)) return fail("rejected", "The server chooses the match");
    if (req["v"] !== undefined && Number(req["v"]) !== ShooterProto.PROTOCOL) return fail("version_mismatch", "Version mismatch");
    if (req["sim"] !== undefined && Number(req["sim"]) !== ShooterProto.SIM) return fail("version_mismatch", "Version mismatch");
    if (req["content"] !== undefined && String(req["content"]) !== ShooterProto.FINGERPRINT) return fail("version_mismatch", "Version mismatch");
    if (!ShooterMm.rateAllow(nk, ctx.userId || "", "lookup")) return fail("rate_limited", "Too many lookups");
    var code = ShooterProto.normalizeCode(req["code"]);
    if (!code) return fail("room_not_found", "Room not found");
    var matchId = ShooterMm.lookupCode(nk, code);
    if (!matchId) return fail("room_not_found", "Room not found");
    var existing = ShooterMm.liveMatch(nk, ctx.userId || "");
    if (existing && existing !== matchId) return fail("already_in_match", "Already in a match");
    if (ShooterMm.queued(nk, ctx.userId || "")) return fail("already_queued", "Leave the queue first");
    // The code is the invitation: admit this account. Finding the match id is not enough to join.
    try {
      var admitted = JSON.parse(nk.matchSignal(matchId, "admit:" + (ctx.userId || "")) || "{}") as { ok?: boolean };
      if (!admitted.ok) return fail("room_not_found", "Room not found");
    } catch (e) {
      return fail("room_not_found", "Room not found");
    }
    return JSON.stringify({
      matchId: matchId,
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
      stake: 0,
      ticketsMinted: 0,
      stakes: false,
      mode: ShooterProto.MODE,
    });
  }

  export function rpcQueueCancel(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    ShooterMm.cancelQueue(nk, ctx.userId || "");
    return JSON.stringify({ ok: true, queued: false, ticketsMinted: 0, stakes: false });
  }

  export function rpcResume(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var matchId = ShooterMm.liveMatch(nk, ctx.userId || "");
    if (!matchId) return fail("match_missing", "No live match");
    return JSON.stringify({
      matchId: matchId,
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
      stake: 0,
      ticketsMinted: 0,
      stakes: false,
    });
  }

  /**
   * Loop metrics for one match. The server (http key, no user) may read any
   * match; a game session only a match it holds a seat in. Anyone else gets
   * match_missing, so the RPC does not confirm that a match exists.
   */
  export function rpcMetrics(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var server = !ctx.userId;
    if (!server) {
      var denied = gate(ctx);
      if (denied) return denied;
    }
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var id = String(req["matchId"] || "");
    if (!id || id.length > 128) return fail("match_missing", "No match");
    if (!nk.matchGet(id)) return fail("match_missing", "No match");
    var signal = req["reset"] === true ? "reset-metrics" : "metrics";
    if (!server) signal += ":" + ctx.userId;
    try {
      var raw = nk.matchSignal(id, signal) || "{}";
      var parsed = JSON.parse(raw) as { error?: string };
      if (parsed && parsed.error) return fail("match_missing", "No match");
      return raw;
    } catch (e) {
      return fail("match_missing", "No match");
    }
  }
}

function sprotoShooterFreeInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return ShooterMatch.handler.matchInit(ctx, logger, nk, params);
}
function sprotoShooterFreeJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return ShooterMatch.handler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function sprotoShooterFreeJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, presences: nkruntime.Presence[]) {
  return ShooterMatch.handler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function sprotoShooterFreeLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, presences: nkruntime.Presence[]) {
  return ShooterMatch.handler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function sprotoShooterFreeLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, messages: nkruntime.MatchMessage[]) {
  return ShooterMatch.handler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function sprotoShooterFreeTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, grace: number) {
  return ShooterMatch.handler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function sprotoShooterFreeSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterMatch.State, data: string) {
  return ShooterMatch.handler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
function rpcShooterVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcVersion(ctx, logger, nk, payload);
}
function rpcShooterRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcRoomCreate(ctx, logger, nk, payload);
}
function rpcShooterRoomJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcRoomJoin(ctx, logger, nk, payload);
}
function rpcShooterQueueCancel(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcQueueCancel(ctx, logger, nk, payload);
}
function rpcShooterResume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcResume(ctx, logger, nk, payload);
}
function rpcShooterMetrics(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ShooterMatch.rpcMetrics(ctx, logger, nk, payload);
}
