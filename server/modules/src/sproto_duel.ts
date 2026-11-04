// Sproto Fighter online duels: matchmaking, signaling relay, result
// verification and 10-Ticket wagers. See the Sproto-Fighter repo's
// docs/MULTIPLAYER-PLAN.md for the design.
//
// Peers play over a WebRTC data channel; this match relays their connection
// setup (and inputs, if a direct connection fails) and holds the wager in
// escrow. Each client also streams its OWN inputs here; the match runs the
// game's simulation (vendor/sproto-sim.js) frame by frame as both streams
// arrive, so the server itself sees the KO and pays the winner. No client
// reports a result, so a loser can't withhold one, and a player can only ever
// speak for their own inputs.

namespace SprotoDuel {
  export var GAME_ID = "sproto-fighter";
  export var MATCH_NAME = "sproto_duel";

  /** Replay a match log; error code on a malformed or mismatched log. */
  export function verifyLog(log: unknown): { ok: true; winner: 0 | 1 | 2 | null; frame: number; hash: number } | { ok: false; error: string } {
    var problem = SprotoSim.checkLog(log, SPROTO_SIM_VERSION);
    if (problem) return { ok: false, error: problem };
    try {
      var r = SprotoSim.replayMatch(log as { v: 1; sim: string; fighters: [string, string]; frames: number; inputs: string });
      return { ok: true, winner: r.winner, frame: r.frame, hash: r.hash };
    } catch (e) {
      return { ok: false, error: "malformed_inputs" };
    }
  }

  /**
   * Development-only RPC (answers only when SPROTO_DEV_RPCS=1): replay a log and
   * report the result and timing. Lets the game repo check that this runtime
   * computes the same states as browsers.
   */
  export function rpcReplay(ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.env || ctx.env["SPROTO_DEV_RPCS"] !== "1") throw new Error("not_found");
    if (!ctx.userId) throw new Error("unauthenticated");
    var started = Date.now();
    var result = verifyLog(JSON.parse(payload));
    return JSON.stringify({ result: result, ms: Date.now() - started, sim: SPROTO_SIM_VERSION });
  }

  // ---- Match protocol (opcodes are shared with src/net/hubDuel.ts in Sproto-Fighter) ----
  export var OP_HELLO = 1;    // client: {fighter, stage, sim}
  export var OP_START = 2;    // server: {seat, fighters, stage, names, wager}
  export var OP_SIGNAL = 3;   // client <-> client via server: WebRTC offer/answer/ICE (opaque)
  export var OP_RELAY = 4;    // client <-> client via server: input packets when WebRTC fails (base64)
  // 5 was a client result upload in an earlier draft; the server's own simulation decides now.
  export var OP_INPUTS = 8;   // client: {start, masks} this player's own inputs, every few frames
  export var OP_OUTCOME = 6;  // server: {status, winnerSeat, reason, deltas}
  export var OP_CANCEL = 7;   // server: {reason, seat?}

  export var STAKE = 10;
  /** Verified CPU wins ("fighter_win" earns) before a first wager. */
  export var MIN_CPU_WINS = 3;
  /** Wagered matches per pair of players per UTC day. */
  export var PAIR_LIMIT = 5;
  /** Net Tickets a player may win from wagers per UTC day. */
  export var DAILY_WIN_CAP = 200;

  var TICK_RATE = 20;
  var JOIN_TIMEOUT = 30 * TICK_RATE;
  var RECONNECT = 10 * TICK_RATE;
  /** A player whose input stream stops this long while the other's continues forfeits. */
  var STALL = 10 * TICK_RATE;
  var MAX_PLAY = 15 * 60 * TICK_RATE;
  var LINGER = 2 * TICK_RATE;

  export interface DuelState {
    players: string[];          // seat order
    wager: boolean;
    sim: string;
    names: { [userId: string]: string };
    present: { [userId: string]: nkruntime.Presence | null };
    hello: { [userId: string]: { fighter: string; stage: string } };
    phase: string;              // joining | playing | done
    createdTick: number;
    startedTick: number;
    leftTick: { [userId: string]: number };
    /** Each seat's own inputs by frame, not yet simulated. */
    inputs: number[][];
    /** Frame index of inputs[seat][0]. */
    inputBase: number;
    /** Last tick each seat's stream advanced. */
    streamTick: number[];
    /**
     * The server's own copy of the match, as JSON text. Nakama converts match
     * state to Go values between ticks, which loses JavaScript property order
     * (the simulation depends on it), so the game state is kept as a string.
     */
    game: string | null;
    simFrame: number;
    doneTick: number;
    outcome: { [key: string]: unknown } | null;
  }

  function seatOf(state: DuelState, userId: string): number {
    return state.players.indexOf(userId);
  }

  function messageText(nk: nkruntime.Nakama, data: string | ArrayBuffer): string {
    return typeof data === "string" ? data : nk.binaryToString(data);
  }

  function presences(state: DuelState): nkruntime.Presence[] {
    var out: nkruntime.Presence[] = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.present[state.players[i]];
      if (p) out.push(p);
    }
    return out;
  }

  function sendTo(dispatcher: nkruntime.MatchDispatcher, state: DuelState, userId: string, op: number, body: unknown): void {
    var p = state.present[userId];
    if (p) dispatcher.broadcastMessage(op, JSON.stringify(body), [p], null, true);
  }

  function broadcast(dispatcher: nkruntime.MatchDispatcher, state: DuelState, op: number, body: unknown): void {
    var targets = presences(state);
    if (targets.length) dispatcher.broadcastMessage(op, JSON.stringify(body), targets, null, true);
  }

  function sql(nk: nkruntime.Nakama, query: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(query, args);
    var value = rows.length ? rows[0]["r"] : null;
    return (typeof value === "string" ? JSON.parse(value) : value) as { [key: string]: unknown };
  }

  function finish(dispatcher: nkruntime.MatchDispatcher, tick: number, state: DuelState, outcome: { [key: string]: unknown }): void {
    state.phase = "done";
    state.doneTick = tick;
    state.outcome = outcome;
    broadcast(dispatcher, state, OP_OUTCOME, outcome);
  }

  /** Close the match: pay the verified winner, or refund. `winnerSeat` null means refund. */
  function close(nk: nkruntime.Nakama, logger: nkruntime.Logger, dispatcher: nkruntime.MatchDispatcher, ctx: nkruntime.Context,
    tick: number, state: DuelState, winnerSeat: number | null, reason: string): void {
    var deltas: { [userId: string]: number } = {};
    var status = winnerSeat === null ? "refunded" : "settled";
    if (state.wager) {
      var r = winnerSeat === null
        ? sql(nk, "SELECT game.sproto_wager_refund($1, $2)::text AS r", [ctx.matchId, reason])
        : sql(nk, "SELECT game.sproto_wager_settle($1, $2::uuid, $3)::text AS r", [ctx.matchId, state.players[winnerSeat], reason]);
      if (r && r["error"]) logger.error("sproto wager close failed " + JSON.stringify(r));
      status = r && typeof r["status"] === "string" ? String(r["status"]) : status;
      for (var i = 0; i < state.players.length; i++) {
        deltas[state.players[i]] = status === "settled" ? (i === winnerSeat ? STAKE : -STAKE) : 0;
      }
    }
    finish(dispatcher, tick, state, { status: status, winnerSeat: winnerSeat, reason: reason, wager: state.wager, stake: STAKE, deltas: deltas });
  }

  function cancel(nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, ctx: nkruntime.Context, tick: number, state: DuelState,
    reason: string, seat: number | null): void {
    if (state.wager) nk.sqlQuery("SELECT game.sproto_wager_refund($1, $2)::text AS r", [ctx.matchId, reason]);
    state.phase = "done";
    state.doneTick = tick;
    state.outcome = { status: "cancelled", reason: reason, seat: seat };
    broadcast(dispatcher, state, OP_CANCEL, state.outcome);
  }

  var MAX_BATCH = 120;

  /** Store a batch of one seat's own inputs; overlapping frames already received are ignored. */
  function acceptInputs(state: DuelState, seat: number, body: { [key: string]: unknown }, tick: number): void {
    var start = Number(body["start"]), masks = body["masks"];
    if (!Array.isArray(masks) || masks.length > MAX_BATCH || !(start >= 0) || Math.floor(start) !== start) return;
    var have = state.inputBase + state.inputs[seat].length;
    if (start > have) return; // a gap: wait for the client to resend from `have`
    if (have >= SprotoSim.MAX_LOG_FRAMES) return;
    for (var i = have - start; i < masks.length; i++) {
      var mask = masks[i];
      if (typeof mask !== "number" || mask < 0 || mask > 4095 || Math.floor(mask) !== mask) return;
      state.inputs[seat].push(mask);
    }
    if (masks.length > 0) state.streamTick[seat] = tick;
  }

  /** Step the server's simulation for every frame both seats have sent. Returns the winner once decided. */
  function advanceSim(state: DuelState): 0 | 1 | 2 | null {
    if (!state.game) return null;
    var game = JSON.parse(state.game) as { [key: string]: unknown };
    var n = Math.min(state.inputs[0].length, state.inputs[1].length);
    if (n === 0) return game["winner"] as 0 | 1 | 2 | null;
    for (var i = 0; i < n; i++) {
      SprotoSim.step(game, [state.inputs[0][i], state.inputs[1][i]]);
      state.simFrame++;
      if (game["winner"] !== null) break;
    }
    state.inputs[0].splice(0, n);
    state.inputs[1].splice(0, n);
    state.inputBase += n;
    state.game = JSON.stringify(game);
    return game["winner"] as 0 | 1 | 2 | null;
  }

  export var handler: nkruntime.MatchHandler<DuelState> = {
    matchInit: function (_ctx, _logger, _nk, params) {
      var players = JSON.parse(String(params["players"])) as string[];
      var names = JSON.parse(String(params["names"] || "{}")) as { [userId: string]: string };
      var state: DuelState = {
        players: players, wager: params["wager"] === "1", sim: String(params["sim"]), names: names,
        present: {}, hello: {}, phase: "joining", createdTick: 0, startedTick: -1, leftTick: {},
        inputs: [[], []], inputBase: 0, streamTick: [0, 0], game: null, simFrame: 0, doneTick: -1, outcome: null,
      };
      return { state: state, tickRate: TICK_RATE, label: JSON.stringify({ game: GAME_ID, wager: state.wager }) };
    },
    matchJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence) {
      if (state.phase === "done") return { state: state, accept: false, rejectMessage: "match_over" };
      if (seatOf(state, presence.userId) < 0) return { state: state, accept: false, rejectMessage: "not_a_player" };
      return { state: state, accept: true };
    },
    matchJoin: function (_ctx, _logger, _nk, _dispatcher, _tick, state, joined) {
      for (var i = 0; i < joined.length; i++) {
        state.present[joined[i].userId] = joined[i];
        delete state.leftTick[joined[i].userId];
      }
      return { state: state };
    },
    matchLeave: function (_ctx, _logger, _nk, _dispatcher, tick, state, left) {
      for (var i = 0; i < left.length; i++) {
        state.present[left[i].userId] = null;
        state.leftTick[left[i].userId] = tick;
      }
      return { state: state };
    },
    matchLoop: function (ctx, logger, nk, dispatcher, tick, state, messages) {
      if (state.phase === "done") return tick - state.doneTick > LINGER ? null : { state: state };
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m], from = msg.sender.userId, seat = seatOf(state, from);
        if (seat < 0) continue;
        var other = state.players[1 - seat];
        if (msg.opCode === OP_SIGNAL || msg.opCode === OP_RELAY) {
          var peer = state.present[other];
          if (peer && state.phase === "playing") dispatcher.broadcastMessage(msg.opCode, messageText(nk, msg.data), [peer], null, msg.opCode === OP_SIGNAL);
          continue;
        }
        var body: { [key: string]: unknown };
        try { body = JSON.parse(messageText(nk, msg.data)); } catch (e) { continue; }
        if (msg.opCode === OP_HELLO && state.phase === "joining") {
          if (body["sim"] !== SPROTO_SIM_VERSION) { cancel(nk, dispatcher, ctx, tick, state, "sim_mismatch", seat); return { state: state }; }
          if (SprotoSim.PLAYABLE_FIGHTERS.indexOf(String(body["fighter"])) < 0) { cancel(nk, dispatcher, ctx, tick, state, "bad_fighter", seat); return { state: state }; }
          state.hello[from] = { fighter: String(body["fighter"]), stage: String(body["stage"] || "ranch").slice(0, 64) };
        } else if (msg.opCode === OP_INPUTS && state.phase === "playing") {
          acceptInputs(state, seat, body, tick);
        }
      }
      if (state.phase === "joining") {
        if (state.hello[state.players[0]] && state.hello[state.players[1]] && state.present[state.players[0]] && state.present[state.players[1]]) {
          if (state.wager) {
            var held = sql(nk, "SELECT game.sproto_wager_hold($1, $2::uuid, $3::uuid, $4, $5, $6, $7)::text AS r",
              [ctx.matchId, state.players[0], state.players[1], STAKE, MIN_CPU_WINS, PAIR_LIMIT, DAILY_WIN_CAP]);
            if (!held || held["error"]) {
              var who = held && typeof held["user"] === "string" ? seatOf(state, String(held["user"])) : null;
              cancel(nk, dispatcher, ctx, tick, state, held ? String(held["error"]) : "hold_failed", who);
              return { state: state };
            }
          }
          state.phase = "playing";
          state.startedTick = tick;
          state.streamTick = [tick, tick];
          var fighters = [state.hello[state.players[0]].fighter, state.hello[state.players[1]].fighter];
          state.game = JSON.stringify(SprotoSim.createState(fighters[0], "versus", fighters[1]));
          state.simFrame = 0;
          for (var s = 0; s < 2; s++) {
            sendTo(dispatcher, state, state.players[s], OP_START, {
              seat: s, fighters: fighters, stage: state.hello[state.players[0]].stage,
              names: [state.names[state.players[0]] || "Player 1", state.names[state.players[1]] || "Player 2"],
              wager: state.wager ? { stake: STAKE, pot: STAKE * 2 } : null,
            });
          }
        } else if (tick - state.createdTick > JOIN_TIMEOUT) {
          cancel(nk, dispatcher, ctx, tick, state, "join_timeout", null);
        }
        return { state: state };
      }
      // playing: advance the server's simulation as far as both input streams allow
      var winner = advanceSim(state);
      if (winner === 0 || winner === 1) { close(nk, logger, dispatcher, ctx, tick, state, winner, "verified"); return { state: state }; }
      if (winner === 2) { close(nk, logger, dispatcher, ctx, tick, state, null, "draw"); return { state: state }; }
      var gone: number[] = [];
      for (var g = 0; g < 2; g++) {
        var left = state.leftTick[state.players[g]];
        var stalled = tick - state.streamTick[g] > STALL && tick - state.streamTick[1 - g] <= STALL;
        if ((left !== undefined && tick - left > RECONNECT) || stalled) gone.push(g);
      }
      if (gone.length === 2) { close(nk, logger, dispatcher, ctx, tick, state, null, "both_left"); return { state: state }; }
      if (gone.length === 1) { close(nk, logger, dispatcher, ctx, tick, state, 1 - gone[0], "forfeit"); return { state: state }; }
      if (tick - state.startedTick > MAX_PLAY) close(nk, logger, dispatcher, ctx, tick, state, null, "timeout");
      return { state: state };
    },
    matchTerminate: function (ctx, _logger, nk, dispatcher, tick, state) {
      if (state.phase !== "done") cancel(nk, dispatcher, ctx, tick, state, "server_shutdown", null);
      return { state: state };
    },
    matchSignal: function (_ctx, _logger, _nk, _dispatcher, _tick, state, data) {
      return { state: state, data: data };
    },
  };

  /** Matchmaker pairs for this game become a duel match (both players must ask for the same wager setting and simulation). */
  export function onMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (matches.length !== 2) return;
    for (var i = 0; i < 2; i++) if (matches[i].properties["game"] !== GAME_ID) return;
    var a = matches[0], b = matches[1];
    if (a.presence.userId === b.presence.userId) return;
    if (a.properties["wager"] !== b.properties["wager"] || a.properties["sim"] !== b.properties["sim"]) return;
    // Refund anything a crashed match left in escrow.
    nk.sqlQuery("SELECT game.sproto_wager_expire(interval '15 minutes')", []);
    var names: { [userId: string]: string } = {};
    names[a.presence.userId] = String(a.presence.username || "").slice(0, 32);
    names[b.presence.userId] = String(b.presence.username || "").slice(0, 32);
    var id = nk.matchCreate(MATCH_NAME, {
      players: JSON.stringify([a.presence.userId, b.presence.userId]), names: JSON.stringify(names),
      wager: a.properties["wager"] === "1" ? "1" : "0", sim: String(a.properties["sim"]),
    });
    logger.info("sproto duel created " + id);
    return id;
  }
}

// Sproto Fighter runs on the hub session, so hub-scope tickets may matchmake for it.
HubGames.register({ game: SprotoDuel.GAME_ID, matchmaker: SprotoDuel.onMatched, hubScope: true });
