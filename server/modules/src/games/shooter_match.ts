// Nakama-authoritative free 1v1. The vendored director owns seed, loadout,
// ready, KO, stall, and the result. This file routes presences, sessions, and
// broadcasts. It does not mint, stake, or settle Tickets.
//
// The director object (and its Map queues) stays in a let binding created on
// the first callback. Nakama exports match state to Go between callbacks and
// drops functions, so the returned state is plain JSON only. Each match VM is
// its own runtime, so the binding lives for the match.

namespace ShooterMatch {
  let directors: { [id: string]: ShooterPvpDirector } | null = null;

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

  export interface State {
    phase: string;
    seed: number;
    privateRoom: boolean;
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
    present: { [id: string]: nkruntime.Presence | null };
    seated: number;
    tick: number;
    result: ResultBody | null;
    resultSent: boolean;
    broken: string;
    cleaned: boolean;
    endReason: string;
    doneTick: number;
    warpMs: number;
    serverSeq: number;
    samples: number[];
    sampleOver: number;
    overBudget: number;
    snapBytes: number;
    snapCount: number;
    inBytes: number;
    loopCount: number;
    createdMs: number;
  }

  function fail(code: string, message: string): string {
    return HubRpc.fail(code, message);
  }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  function blank(): State {
    return {
      phase: "lobby",
      seed: 1,
      privateRoom: false,
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
      broken: "",
      cleaned: false,
      endReason: "",
      doneTick: 0,
      warpMs: 0,
      serverSeq: 0,
      samples: [],
      sampleOver: 0,
      overBudget: 0,
      snapBytes: 0,
      snapCount: 0,
      inBytes: 0,
      loopCount: 0,
      createdMs: Date.now(),
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

  function nowOf(state: State): number {
    return Date.now() + state.warpMs;
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

  function recipients(state: State): nkruntime.Presence[] {
    var to: nkruntime.Presence[] = [];
    for (var id in state.present) {
      var presence = state.present[id];
      if (presence) to.push(presence);
    }
    return to;
  }

  function emit(d: nkruntime.MatchDispatcher, state: State, op: number, body: { [key: string]: unknown }): void {
    var stamped: { [key: string]: unknown } = {};
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
    var to = recipients(state);
    if (to.length) d.broadcastMessage(op, text, to, null, true);
  }

  function mirror(state: State, director: ShooterPvpDirector): void {
    state.phase = director.phase;
    state.seated = director.occupied();
    state.tick = director.sim ? director.sim.tick : 0;
    if (director.result) {
      state.result = {
        outcome: director.result.outcome,
        winner: director.result.winner,
        reason: director.result.reason,
        tick: director.result.tick,
        stateHash: director.result.stateHash,
        ticketsMinted: 0,
        stakes: false,
      };
      state.phase = "done";
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

  function finishShutdown(d: nkruntime.MatchDispatcher, state: State, director: ShooterPvpDirector | null): void {
    if (state.resultSent) return;
    var body = state.result && state.phase === "done" ? state.result : shutdownBody(state, director);
    if (!state.result) state.result = body;
    state.phase = "done";
    state.endReason = body.reason;
    state.resultSent = true;
    emit(d, state, ShooterProto.OP_RESULT, {
      outcome: body.outcome,
      winner: body.winner,
      reason: body.reason,
      tick: body.tick,
      stateHash: body.stateHash,
      ticketsMinted: 0,
      stakes: false,
    });
  }

  function cleanup(nk: nkruntime.Nakama, state: State, matchId: string): void {
    if (state.cleaned) return;
    state.cleaned = true;
    if (state.code) ShooterMm.releaseCode(nk, state.code);
    if (state.token) ShooterMm.forgetGroup(nk, state.token);
    if (state.host) ShooterMm.clearLive(nk, state.host, matchId);
    for (var id in state.sids) ShooterMm.clearLive(nk, id, matchId);
    for (var r = 0; r < state.roster.length; r++) ShooterMm.clearLive(nk, state.roster[r], matchId);
    if (directors) delete directors[matchId];
  }

  function publish(d: nkruntime.MatchDispatcher, state: State, director: ShooterPvpDirector, advanced: { snapshots: { [key: string]: unknown }[]; result: ShooterPvpResult | null; phaseMessage: { [key: string]: unknown } | null }, messages: { op: number; body: { [key: string]: unknown } }[]): void {
    for (var i = 0; i < messages.length; i++) emit(d, state, messages[i].op, messages[i].body);
    if (advanced.phaseMessage) emit(d, state, ShooterProto.OP_PHASE, advanced.phaseMessage);
    for (var s = 0; s < advanced.snapshots.length; s++) emit(d, state, ShooterProto.OP_SNAPSHOT, advanced.snapshots[s]);
    mirror(state, director);
    if (state.result && !state.resultSent) {
      state.resultSent = true;
      emit(d, state, ShooterProto.OP_RESULT, {
        outcome: state.result.outcome,
        winner: state.result.winner,
        reason: state.result.reason,
        tick: state.result.tick,
        stateHash: state.result.stateHash,
        ticketsMinted: 0,
        stakes: false,
      });
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

  function metricsOf(state: State): { [key: string]: unknown } {
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
      loops: state.loopCount,
      tick: state.tick,
      phase: state.phase,
      endReason: state.endReason,
      stateHash: state.result ? state.result.stateHash : "",
      outcome: state.result ? state.result.outcome : "",
      winner: state.result ? state.result.winner : null,
      ticketsMinted: 0,
      stakes: false,
      stake: 0,
      seated: state.seated,
      accounts: accounts,
      guests: guests,
      serverSeq: state.serverSeq,
      protocol: ShooterProto.PROTOCOL,
      sim: ShooterProto.SIM,
      content: ShooterProto.FINGERPRINT,
    };
  }

  function seedOf(nk: nkruntime.Nakama, params: { [key: string]: unknown }): number {
    if (params["seedSource"] === "server") {
      var n = parseInt(String(params["seed"] === undefined || params["seed"] === null ? "" : params["seed"]), 10);
      if (n > 0 && n <= 4294967295) return n >>> 0;
    }
    return ShooterProto.serverSeed(nk);
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (ctx, logger, nk, params) {
      var state = blank();
      var mismatch = ShooterProto.verifyRuntime();
      var matchId = ctx.matchId || "";
      state.privateRoom = params["private"] === "1";
      state.code = typeof params["code"] === "string" ? params["code"] : "";
      state.token = typeof params["token"] === "string" ? params["token"] : "";
      state.host = typeof params["host"] === "string" ? params["host"] : "";
      state.roster = parseRoster(params["roster"]);
      state.seed = seedOf(nk, params);
      if (mismatch) {
        state.broken = mismatch;
        logger.error("sproto_shooter_free pin " + mismatch);
      } else {
        var sim = ShooterProto.api();
        if (!sim) {
          state.broken = "sim_missing";
          logger.error("sproto_shooter_free pin sim_missing");
        } else directorBag()[matchId] = sim.createDirector({ seed: state.seed, matchId: matchId });
      }
      logger.info("sproto_shooter_free init " + matchId);
      return { state: state, tickRate: ShooterProto.TICK_RATE, label: ShooterProto.labelFor() };
    },

    matchJoinAttempt: function (ctx, _logger, nk, _d, _tick, state, presence, _metadata) {
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
      if (!director) return { state: state, accept: false, rejectMessage: "ended" };
      if (director.phase === "done" || state.phase === "done") return { state: state, accept: false, rejectMessage: "ended" };
      if (!known) {
        if (!onRoster(state, userId)) return { state: state, accept: false, rejectMessage: "not_in_roster" };
        if (accountCount(state) >= ShooterProto.SEATS) return { state: state, accept: false, rejectMessage: "match_full" };
        var verdict = director.joinAttempt(userId);
        if (!verdict.accept) return { state: state, accept: false, rejectMessage: verdict.reason || "match_full" };
        var elsewhere = ShooterMm.liveMatch(nk, userId);
        if (elsewhere && elsewhere !== (ctx.matchId || "")) return { state: state, accept: false, rejectMessage: "already_in_match" };
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
        state.present[presence.userId] = presence;
        ShooterMm.setLive(nk, presence.userId, matchId);
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
      if (state.broken || !director) {
        if (!state.resultSent) finishShutdown(d, state, director);
        cleanup(nk, state, matchId);
        sample(state, started);
        return null;
      }
      var now = nowOf(state);
      var produced: { op: number; body: { [key: string]: unknown } }[] = [];
      var limit = messages.length < ShooterProto.MAX_MSGS ? messages.length : ShooterProto.MAX_MSGS;
      for (var i = 0; i < messages.length; i++) {
        var message = messages[i];
        var sender = message.sender;
        if (!sender || !sender.userId) continue;
        var size = typeof message.data === "string" ? message.data.length : message.data ? message.data.byteLength : 0;
        state.inBytes += size;
        if (i >= limit) {
          produced.push({ op: ShooterProto.OP_REJECT, body: { accountId: sender.userId, reason: "rate", lastSeq: 0, tick: state.tick, ticketsMinted: 0 } });
          continue;
        }
        var op = message.opCode;
        var packet: string | Uint8Array = "";
        if (op === ShooterProto.OP_INPUT) {
          var bytes = ShooterProto.bytesOf(nk, message.data);
          if (bytes.length !== ShooterProto.FRAME_BYTES) {
            produced.push({ op: ShooterProto.OP_REJECT, body: { accountId: sender.userId, reason: "malformed", lastSeq: 0, tick: state.tick, ticketsMinted: 0 } });
            continue;
          }
          packet = bytes;
        } else {
          var text = ShooterProto.textOf(nk, message.data);
          if (text.length > ShooterProto.MAX_JSON) {
            produced.push({ op: ShooterProto.OP_REJECT, body: { accountId: sender.userId, reason: "malformed", lastSeq: 0, tick: state.tick, ticketsMinted: 0 } });
            continue;
          }
          if (op === ShooterProto.OP_HELLO || op === ShooterProto.OP_READY || op === ShooterProto.OP_RESYNC) {
            var parsed = bodyOf(text);
            if (parsed && ShooterProto.hostile(parsed)) {
              produced.push({ op: ShooterProto.OP_REJECT, body: { accountId: sender.userId, reason: "client_result", lastSeq: 0, tick: state.tick, ticketsMinted: 0 } });
              continue;
            }
          }
          packet = text;
        }
        var actor = { userId: sender.userId, sessionId: sender.sessionId };
        if (op === ShooterProto.OP_RESYNC && director.seatOf(sender.userId) >= 0) {
          var rebound = director.handle(actor, ShooterProto.OP_HELLO, JSON.stringify({
            accountId: sender.userId,
            protocol: ShooterProto.PROTOCOL,
            sim: ShooterProto.SIM,
            content: ShooterProto.FINGERPRINT,
          }), now);
          var reboundMessages = rebound && rebound.messages ? rebound.messages : [];
          for (var r = 0; r < reboundMessages.length; r++) produced.push(reboundMessages[r]);
          if (!rebound || !rebound.ok) continue;
        }
        var out = director.handle(actor, op, packet, now);
        var extra = out && out.messages ? out.messages : [];
        for (var m = 0; m < extra.length; m++) produced.push(extra[m]);
      }
      var advanced = director.advance(now);
      if (director.phase === "live" && director.sim && now - state.createdMs > ShooterProto.MAX_MATCH_MS && director.sim.phase !== "done" && !director.result) {
        logger.warn("sproto_shooter_free duration " + matchId);
      }
      publish(d, state, director, advanced, produced);
      if (director.phase === "lobby" && director.occupied() === 0 && now - state.createdMs >= ShooterProto.READY_MS && !state.resultSent) {
        state.result = { outcome: "cancel", winner: null, reason: "ready_timeout", tick: 0, stateHash: null, ticketsMinted: 0, stakes: false };
        state.phase = "done";
        state.endReason = "ready_timeout";
        state.resultSent = true;
        state.doneTick = tick;
        emit(d, state, ShooterProto.OP_RESULT, {
          outcome: "cancel",
          winner: null,
          reason: "ready_timeout",
          tick: 0,
          stateHash: null,
          ticketsMinted: 0,
          stakes: false,
        });
      }
      if (state.phase === "done") {
        if (!state.doneTick) state.doneTick = tick;
        if (tick - state.doneTick > ShooterProto.LINGER_S * ShooterProto.TICK_RATE) {
          cleanup(nk, state, matchId);
          sample(state, started);
          return null;
        }
      }
      sample(state, started);
      return { state: state };
    },

    matchTerminate: function (ctx, _logger, nk, d, _tick, state, _grace) {
      var matchId = ctx.matchId || "";
      var director = directorBag()[matchId];
      if (director) mirror(state, director);
      finishShutdown(d, state, director);
      cleanup(nk, state, matchId);
      return { state: state };
    },

    matchSignal: function (ctx, _logger, _nk, _d, _tick, state, data) {
      if (data === "reset-metrics") {
        state.samples = [];
        state.sampleOver = 0;
        state.overBudget = 0;
      } else if (data.indexOf("advance:") === 0) {
        var env = ctx.env || null;
        if (env && env["HUB_FAULT_INJECT"] === "1") {
          var delta = parseInt(data.slice("advance:".length), 10);
          if (delta > 0 && delta < 3600000) state.warpMs += delta;
        }
      }
      return { state: state, data: JSON.stringify(metricsOf(state)) };
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
    if (ShooterProto.hostile(req) || req["seed"] !== undefined || req["state"] !== undefined) return fail("rejected", "The server chooses the match");
    if (req["v"] !== undefined && Number(req["v"]) !== ShooterProto.PROTOCOL) return fail("version_mismatch", "Version mismatch");
    if (req["sim"] !== undefined && Number(req["sim"]) !== ShooterProto.SIM) return fail("version_mismatch", "Version mismatch");
    if (req["content"] !== undefined && String(req["content"]) !== ShooterProto.FINGERPRINT) return fail("version_mismatch", "Version mismatch");
    if (!ShooterMm.rateAllow(nk, ctx.userId || "", "create")) return fail("rate_limited", "Too many rooms");
    if (ShooterMm.liveMatch(nk, ctx.userId || "")) return fail("already_in_match", "Already in a match");
    var code = "";
    for (var attempt = 0; attempt < 5 && !code; attempt++) {
      var candidate = ShooterProto.roomCode();
      if (ShooterMm.reserveCode(nk, candidate)) code = candidate;
    }
    if (!code) return fail("room_code_busy", "Could not allocate a room code");
    var seed = ShooterProto.serverSeed(nk);
    var matchId = "";
    try {
      matchId = nk.matchCreate(ShooterProto.MATCH_NAME, {
        private: "1",
        code: code,
        host: ctx.userId || "",
        seed: String(seed),
        seedSource: "server",
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
      stake: 0,
      ticketsMinted: 0,
      stakes: false,
      mode: ShooterProto.MODE,
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

  export function rpcMetrics(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var id = String(req["matchId"] || "");
    if (!id || id.length > 128) return fail("match_missing", "No match");
    if (!nk.matchGet(id)) return fail("match_missing", "No match");
    try {
      var raw = nk.matchSignal(id, req["reset"] === true ? "reset-metrics" : "metrics");
      return raw || "{}";
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
