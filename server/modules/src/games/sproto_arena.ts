// Sproto Duel online 1v1 (game id "sproto"; see docs/games/sproto-arena.md).
//
// The duel's simulation needs Rapier WASM and three.js, which goja cannot run, so
// one client (the host, picked at random) runs the fight and this match relays and
// referees: guest INPUT goes only to the host, host SNAPSHOTs only to the guest,
// the host reports each ROUND, and both clients report a RESULT. A verified win or
// a forfeit after at least one finished round and MIN_PLAY is recorded, including
// on sproto_wins. It does not mint Tickets (migration 0031). A modified host
// can still lie; the exposure is bounded by the random host pick and the pair and
// daily caps below. Opcodes match src/net/protocol.ts in the sproto-duel repo.

namespace SprotoArena {
  export var GAME_ID = "sproto";
  export var MATCH_NAME = "sproto_arena";
  export var KIND = "sproto_arena";
  /** Must equal NET_VERSION in sproto-duel src/net/protocol.ts. */
  export var NET_VERSION = "1";

  export var OP_HELLO = 1;     // c->s {v, staff}
  export var OP_START = 2;     // s->c {seat, hostSeat, names, staffs, rules, seed}
  export var OP_SIGNAL = 3;    // c->s->peer (WebRTC, reserved)
  export var OP_INPUT = 10;    // guest->s->host, relayed unparsed
  export var OP_SNAPSHOT = 11; // host->s->guest, relayed unparsed
  export var OP_ROUND = 12;    // host->s {round, winnerSeat, reason, wins}
  export var OP_RESULT = 13;   // c->s {winnerSeat, wins, rounds}
  export var OP_OUTCOME = 14;  // s->c {status, winnerSeat, reason, paid, balances}
  export var OP_CANCEL = 15;   // s->c {reason, seat?}
  export var OP_PEER = 16;     // s->c {seat, present, graceS}
  export var OP_PING = 17;     // c->s->c {c} -> {c, s}
  export var OP_FORFEIT = 18;  // c->s {}

  export var TICK_RATE = 30;
  export var JOIN_TIMEOUT_S = 30;
  /** A private room with nobody else in it closes after this. */
  export var ROOM_TIMEOUT_S = 300;
  export var RECONNECT_S = 10;
  export var STALL_S = 10;
  export var MAX_PLAY_S = 8 * 60;
  export var MIN_PLAY_S = 15;
  export var LINGER_S = 2;
  /** One RESULT in and the other player gone: decide after this. Both present: disputed after 3x. */
  export var RESULT_WAIT_S = 5;
  /** A round can't end sooner than this after the previous one (the intro alone is 2.4 s). */
  export var MIN_ROUND_S = 2;
  export var MAX_MSGS_PER_TICK = 4;
  export var MAX_INPUT_BYTES = 2048;
  export var MAX_SNAPSHOT_BYTES = 8192;
  export var ROUNDS_TO_WIN = 2;

  /** Online wins mint no Tickets. Migration 0031 also sets srv_pvp_win max_amount to 0. */
  export var PVP_WIN_TICKETS = 0;
  export var PVP_REASON = "srv_pvp_win";
  /** Paid wins per unordered pair of players per UTC day, and per winner per day. */
  export var PVP_PAIR_DAILY = 5;
  export var PVP_DAILY_PAID_WINS = 10;
  export var WINS_BOARD = "sproto_wins";

  export var STAFFS = ["duel_staff_sproto", "duel_staff_momentum", "duel_staff_moonward", "duel_staff_nobu"];
  export var ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

  export interface RoundRec { round: number; winnerSeat: number | null; reason: string; wins: number[]; tick: number }
  export interface ResultRec { winnerSeat: number | null; wins: number[]; rounds: number }
  export interface Outcome { status: string; winnerSeat: number | null; reason: string; paid: { [userId: string]: number }; balances: { [userId: string]: number } }

  export interface State {
    players: string[];
    names: { [userId: string]: string };
    sids: { [userId: string]: string };
    staffs: { [userId: string]: string };
    hostSeat: number;
    isPrivate: boolean;
    code: string;
    v: string;
    phase: string; // joining | playing | done
    present: { [userId: string]: nkruntime.Presence | null };
    leftTick: { [userId: string]: number };
    hello: { [userId: string]: boolean };
    createdTick: number;
    startedTick: number;
    lastInputTick: number;
    lastSnapTick: number;
    rounds: RoundRec[];
    implausible: boolean;
    results: { [seat: string]: ResultRec };
    firstResultTick: number;
    outcome: Outcome | null;
    doneTick: number;
    seed: number;
  }

  function isObj(x: unknown): x is { [k: string]: unknown } {
    return typeof x === "object" && x !== null && Object.prototype.toString.call(x) !== "[object Array]";
  }

  function isPair(x: unknown): x is number[] {
    if (Object.prototype.toString.call(x) !== "[object Array]") return false;
    var a = x as unknown[];
    return a.length === 2 && typeof a[0] === "number" && typeof a[1] === "number" && a[0] >= 0 && a[1] >= 0 && a[0] <= 9 && a[1] <= 9 && Math.floor(a[0]) === a[0] && Math.floor(a[1]) === a[1];
  }

  function seatOrNull(x: unknown): number | null | undefined {
    if (x === null) return null;
    if (x === 0 || x === 1) return x;
    return undefined;
  }

  function text(nk: nkruntime.Nakama, data: string | ArrayBuffer): string {
    return typeof data === "string" ? data : nk.binaryToString(data);
  }

  function parse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  export function label(state: State): string {
    var open = state.phase === "joining" && state.players.length < 2;
    return JSON.stringify({ game: GAME_ID, kind: KIND, v: state.v, open: open, code: state.isPrivate ? state.code : "" });
  }

  export function normalizeStaff(s: unknown): string {
    var id = String(s === undefined || s === null ? "" : s);
    return STAFFS.indexOf(id) >= 0 ? id : STAFFS[0];
  }

  export function roomCode(random?: () => number): string {
    var rnd = random || Math.random;
    var out = "";
    for (var i = 0; i < 6; i++) out += ROOM_ALPHABET.charAt(Math.floor(rnd() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length);
    return out;
  }

  export function normalizeRoomCode(input: unknown): string | null {
    var code = String(input === undefined || input === null ? "" : input).toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== 6) return null;
    for (var i = 0; i < code.length; i++) if (ROOM_ALPHABET.indexOf(code.charAt(i)) < 0) return null;
    return code;
  }

  function presenceList(state: State, seat: number): nkruntime.Presence[] {
    var uid = state.players[seat];
    var p = uid ? state.present[uid] : null;
    return p ? [p] : [];
  }

  function sendTo(d: nkruntime.MatchDispatcher, state: State, seat: number, op: number, body: unknown, sender?: nkruntime.Presence | null): void {
    var to = presenceList(state, seat);
    if (!to.length) return;
    d.broadcastMessage(op, typeof body === "string" ? body : JSON.stringify(body), to, sender || null, true);
  }

  function broadcast(d: nkruntime.MatchDispatcher, state: State, op: number, body: unknown): void {
    var to: nkruntime.Presence[] = [];
    for (var i = 0; i < state.players.length; i++) {
      var p = state.present[state.players[i]];
      if (p) to.push(p);
    }
    if (to.length) d.broadcastMessage(op, JSON.stringify(body), to, null, true);
  }

  function sendStart(d: nkruntime.MatchDispatcher, state: State, seat: number): void {
    var names: string[] = [], staffs: string[] = [];
    for (var i = 0; i < 2; i++) {
      var uid = state.players[i];
      names.push(state.names[uid] || "Player " + (i + 1));
      staffs.push(state.staffs[uid] || STAFFS[0]);
    }
    sendTo(d, state, seat, OP_START, { seat: seat, hostSeat: state.hostSeat, names: names, staffs: staffs, rules: "online1", seed: state.seed });
  }

  function elapsedS(state: State, tick: number): number {
    return state.startedTick < 0 ? 0 : (tick - state.startedTick) / TICK_RATE;
  }

  /**
   * Record the result row (the match id makes a repeat a no-op) and count the win
   * on sproto_wins. Online wins do not mint Tickets: there is no HubEconomy.earn
   * here, and migration 0031 sets srv_pvp_win max_amount to 0.
   */
  export function payout(nk: nkruntime.Nakama, logger: nkruntime.Logger, matchId: string, state: State, winnerSeat: number, status: string, out: Outcome): void {
    var winner = state.players[winnerSeat], loser = state.players[1 - winnerSeat];
    if (!winner || !loser) return;
    var recorded = false;
    try {
      var rows = nk.sqlQuery(PAY_SQL, [matchId, winner, loser, status, PVP_PAIR_DAILY, PVP_DAILY_PAID_WINS]);
      recorded = !!rows && rows.length > 0;
    } catch (e) {
      logger.error("sproto_arena payout row failed " + matchId + ": " + String(e));
    }
    if (!recorded) logger.warn("sproto_arena " + matchId + " " + PVP_REASON + " result row missing; mint stays " + String(PVP_WIN_TICKETS));
    try {
      HubBoards.recordWin(nk, winner, WINS_BOARD, matchId);
    } catch (e) {
      logger.warn("sproto_arena recordWin " + matchId + ": " + String(e));
    }
  }

  // One statement: the advisory lock serialises payouts for this winner, the counts see
  // every paid row of the UTC day, and ON CONFLICT keeps a repeat call from inserting twice.
  export var PAY_SQL =
    "WITH lock AS (SELECT pg_advisory_xact_lock(hashtext('sproto_pvp:' || $2::text))), " +
    "counts AS (SELECT " +
    "(SELECT count(*) FROM game.sproto_pvp_result r, lock WHERE r.day = (now() AT TIME ZONE 'utc')::date AND r.paid " +
    "AND LEAST(r.winner, r.loser) = LEAST($2::uuid, $3::uuid) AND GREATEST(r.winner, r.loser) = GREATEST($2::uuid, $3::uuid)) AS pair_n, " +
    "(SELECT count(*) FROM game.sproto_pvp_result r, lock WHERE r.day = (now() AT TIME ZONE 'utc')::date AND r.paid AND r.winner = $2::uuid) AS win_n), " +
    "ins AS (INSERT INTO game.sproto_pvp_result (match_id, winner, loser, day, status, paid) " +
    "SELECT $1::text, $2::uuid, $3::uuid, (now() AT TIME ZONE 'utc')::date, $4::text, (pair_n < $5::int AND win_n < $6::int) FROM counts " +
    "ON CONFLICT (match_id) DO NOTHING RETURNING paid) " +
    "SELECT (SELECT paid FROM ins) AS paid";

  function finish(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: State, status: string, winnerSeat: number | null, reason: string): void {
    if (state.phase === "done") return;
    var out: Outcome = { status: status, winnerSeat: winnerSeat, reason: reason, paid: {}, balances: {} };
    var pays = status === "verified" || (status === "forfeit" && elapsedS(state, tick) >= MIN_PLAY_S && state.rounds.length >= 1);
    if (winnerSeat !== null && (status === "verified" || status === "forfeit")) {
      if (pays) payout(nk, logger, ctx.matchId || "", state, winnerSeat, status, out);
      else {
        try {
          HubBoards.recordWin(nk, state.players[winnerSeat], WINS_BOARD, ctx.matchId || "");
        } catch (e) {
          logger.warn("sproto_arena recordWin " + String(e));
        }
      }
    }
    state.outcome = out;
    state.phase = "done";
    state.doneTick = tick;
    broadcast(d, state, OP_OUTCOME, out);
    d.matchLabelUpdate(label(state));
    logger.info("sproto_arena " + (ctx.matchId || "") + " " + status + " " + reason + " winner " + String(winnerSeat));
  }

  function cancel(d: nkruntime.MatchDispatcher, tick: number, state: State, reason: string, seat?: number): void {
    broadcast(d, state, OP_CANCEL, seat === undefined ? { reason: reason } : { reason: reason, seat: seat });
    state.phase = "done";
    state.doneTick = tick;
    d.matchLabelUpdate(label(state));
  }

  /** Both RESULTs in: verified when equal, a decisive 2 wins, consistent with the ROUNDs and long enough. */
  export function decide(state: State, tick: number): { status: string; winnerSeat: number | null; reason: string } {
    var a = state.results["0"], b = state.results["1"];
    var same = a.winnerSeat === b.winnerSeat && a.wins[0] === b.wins[0] && a.wins[1] === b.wins[1] && a.rounds === b.rounds;
    if (!same) return { status: "disputed", winnerSeat: null, reason: "results_differ" };
    if (a.winnerSeat === null) return { status: "draw", winnerSeat: null, reason: "draw" };
    var last = state.rounds[state.rounds.length - 1];
    var consistent = !state.implausible && a.wins[a.winnerSeat] === ROUNDS_TO_WIN && a.wins[1 - a.winnerSeat] < ROUNDS_TO_WIN &&
      a.rounds === state.rounds.length && !!last && last.wins[0] === a.wins[0] && last.wins[1] === a.wins[1];
    if (!consistent || elapsedS(state, tick) < MIN_PLAY_S) return { status: "disputed", winnerSeat: null, reason: "implausible" };
    return { status: "verified", winnerSeat: a.winnerSeat, reason: "agreed" };
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (_ctx, _logger, _nk, params) {
      var players: string[] = [];
      var names: { [userId: string]: string } = {};
      try {
        players = JSON.parse(String(params["players"] || "[]")) as string[];
        names = JSON.parse(String(params["names"] || "{}")) as { [userId: string]: string };
      } catch (e) {
        players = [];
      }
      var isPrivate = String(params["private"] || "0") === "1";
      var state: State = {
        players: players.slice(0, 2),
        names: names,
        sids: {},
        staffs: {},
        hostSeat: Math.random() < 0.5 ? 0 : 1,
        isPrivate: isPrivate,
        code: isPrivate ? String(params["code"] || "") : "",
        v: String(params["v"] || NET_VERSION),
        phase: "joining",
        present: {},
        leftTick: {},
        hello: {},
        createdTick: 0,
        startedTick: -1,
        lastInputTick: 0,
        lastSnapTick: 0,
        rounds: [],
        implausible: false,
        results: {},
        firstResultTick: -1,
        outcome: null,
        doneTick: -1,
        seed: Math.floor(Math.random() * 2147483647),
      };
      return { state: state, tickRate: TICK_RATE, label: label(state) };
    },

    matchJoinAttempt: function (ctx, _logger, _nk, _d, _tick, state, presence, _metadata) {
      if (state.phase === "done") return { state: state, accept: false, rejectMessage: "match_over" };
      var vars = ctx.vars || null;
      if (!vars || vars["scope"] !== "game" || vars["game"] !== GAME_ID) return { state: state, accept: false, rejectMessage: "wrong_scope" };
      var uid = presence.userId;
      var seat = state.players.indexOf(uid);
      if (seat < 0) {
        if (!state.isPrivate || state.players.length >= 2 || state.phase !== "joining") return { state: state, accept: false, rejectMessage: "match_full" };
        state.players.push(uid);
        state.names[uid] = String(presence.username || "").slice(0, 32);
      }
      if (state.present[uid] && state.present[uid]!.sessionId !== presence.sessionId && state.phase === "joining") {
        return { state: state, accept: false, rejectMessage: "already_joined" };
      }
      // The joiner's game session id (ctx.vars are the joining user's here): Tickets need it open.
      if (vars["sid"]) state.sids[uid] = vars["sid"];
      return { state: state, accept: true };
    },

    matchJoin: function (_ctx, _logger, _nk, d, _tick, state, presences) {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var seat = state.players.indexOf(p.userId);
        if (seat < 0) continue;
        var back = state.leftTick[p.userId] !== undefined;
        state.present[p.userId] = p;
        delete state.leftTick[p.userId];
        if (!state.names[p.userId]) state.names[p.userId] = String(p.username || "").slice(0, 32);
        if (back && state.phase === "playing") {
          sendTo(d, state, 1 - seat, OP_PEER, { seat: seat, present: true, graceS: 0 });
          sendStart(d, state, seat);
        }
      }
      d.matchLabelUpdate(label(state));
      return { state: state };
    },

    matchLeave: function (_ctx, _logger, _nk, d, tick, state, presences) {
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        var cur = state.present[p.userId];
        if (!cur || cur.sessionId !== p.sessionId) continue;
        var seat = state.players.indexOf(p.userId);
        state.present[p.userId] = null;
        state.leftTick[p.userId] = tick;
        if (state.phase === "joining") {
          // Before START: whoever is still here is told, and the match closes.
          cancel(d, tick, state, "opponent_left", seat);
        } else if (state.phase === "playing") {
          sendTo(d, state, 1 - seat, OP_PEER, { seat: seat, present: false, graceS: RECONNECT_S });
        }
      }
      return { state: state };
    },

    matchLoop: function (ctx, logger, nk, d, tick, state, messages) {
      var T = TICK_RATE;
      if (state.phase === "done") return tick - state.doneTick >= LINGER_S * T ? null : { state: state };
      var counts: { [userId: string]: number } = {};
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        var uid = m.sender.userId;
        var seat = state.players.indexOf(uid);
        if (seat < 0) continue;
        counts[uid] = (counts[uid] || 0) + 1;
        if (counts[uid] > MAX_MSGS_PER_TICK) continue;
        var raw = text(nk, m.data);
        switch (m.opCode) {
          case OP_HELLO: {
            var h = parse(raw);
            if (!isObj(h) || String(h["v"]) !== state.v || state.v !== NET_VERSION) {
              cancel(d, tick, state, "version_mismatch", seat);
              return { state: state };
            }
            state.hello[uid] = true;
            state.staffs[uid] = normalizeStaff(h["staff"]);
            break;
          }
          case OP_INPUT:
            if (state.phase !== "playing" || seat === state.hostSeat || raw.length > MAX_INPUT_BYTES) break;
            state.lastInputTick = tick;
            sendTo(d, state, state.hostSeat, OP_INPUT, raw, m.sender);
            break;
          case OP_SNAPSHOT:
            if (state.phase !== "playing" || seat !== state.hostSeat || raw.length > MAX_SNAPSHOT_BYTES) break;
            state.lastSnapTick = tick;
            sendTo(d, state, 1 - state.hostSeat, OP_SNAPSHOT, raw, m.sender);
            break;
          case OP_SIGNAL:
            if (state.phase === "playing" && raw.length <= MAX_INPUT_BYTES) sendTo(d, state, 1 - seat, OP_SIGNAL, raw, m.sender);
            break;
          case OP_ROUND: {
            if (state.phase !== "playing" || seat !== state.hostSeat) break;
            var r = parse(raw);
            if (!isObj(r) || typeof r["round"] !== "number" || !isPair(r["wins"])) break;
            var ws = seatOrNull(r["winnerSeat"]);
            if (ws === undefined) break;
            var prev = state.rounds[state.rounds.length - 1];
            var wins = prev ? [prev.wins[0], prev.wins[1]] : [0, 0];
            if (ws !== null) wins[ws]++;
            var rw = r["wins"] as number[];
            var since = tick - (prev ? prev.tick : state.startedTick);
            if (r["round"] !== state.rounds.length + 1 || wins[0] !== rw[0] || wins[1] !== rw[1] || since < MIN_ROUND_S * T) state.implausible = true;
            state.rounds.push({ round: r["round"] as number, winnerSeat: ws, reason: String(r["reason"]), wins: [rw[0], rw[1]], tick: tick });
            break;
          }
          case OP_RESULT: {
            if (state.phase !== "playing" || state.results[String(seat)]) break;
            var res = parse(raw);
            if (!isObj(res) || !isPair(res["wins"]) || typeof res["rounds"] !== "number") break;
            var rs = seatOrNull(res["winnerSeat"]);
            if (rs === undefined) break;
            var rwins = res["wins"] as number[];
            state.results[String(seat)] = { winnerSeat: rs, wins: [rwins[0], rwins[1]], rounds: res["rounds"] as number };
            if (state.firstResultTick < 0) state.firstResultTick = tick;
            if (state.results["0"] && state.results["1"]) {
              var verdict = decide(state, tick);
              finish(ctx, logger, nk, d, tick, state, verdict.status, verdict.winnerSeat, verdict.reason);
            }
            break;
          }
          case OP_PING: {
            var pg = parse(raw);
            if (isObj(pg) && typeof pg["c"] === "number") sendTo(d, state, seat, OP_PING, { c: pg["c"], s: tick });
            break;
          }
          case OP_FORFEIT:
            if (state.phase === "playing") finish(ctx, logger, nk, d, tick, state, "forfeit", 1 - seat, "forfeit");
            break;
          default:
            break;
        }
        if (state.phase === "done") return { state: state };
      }

      if (state.phase === "joining") {
        var ready = state.players.length === 2;
        for (var k = 0; k < state.players.length; k++) {
          var pid = state.players[k];
          if (!state.present[pid] || !state.hello[pid]) ready = false;
        }
        if (ready) {
          state.phase = "playing";
          state.startedTick = state.lastInputTick = state.lastSnapTick = tick;
          sendStart(d, state, 0);
          sendStart(d, state, 1);
          d.matchLabelUpdate(label(state));
        } else {
          var limit = state.isPrivate && state.players.length < 2 ? ROOM_TIMEOUT_S : JOIN_TIMEOUT_S;
          if (tick - state.createdTick > limit * T) cancel(d, tick, state, state.players.length < 2 ? "room_expired" : "join_timeout");
        }
        return { state: state };
      }

      // Playing.
      var gone: boolean[] = [];
      for (var s = 0; s < 2; s++) {
        var lt = state.leftTick[state.players[s]];
        gone.push(lt !== undefined && tick - lt > RECONNECT_S * T);
      }
      if (gone[0] && gone[1]) finish(ctx, logger, nk, d, tick, state, "both_left", null, "both_left");
      else if (gone[0] || gone[1]) finish(ctx, logger, nk, d, tick, state, "forfeit", gone[0] ? 1 : 0, "left");
      else if (state.present[state.players[0]] && state.present[state.players[1]]) {
        var guest = 1 - state.hostSeat;
        if (tick - state.lastInputTick > STALL_S * T && tick - state.lastSnapTick <= T) finish(ctx, logger, nk, d, tick, state, "forfeit", state.hostSeat, "guest_stalled");
        else if (tick - state.lastSnapTick > STALL_S * T && tick - state.lastInputTick <= T) finish(ctx, logger, nk, d, tick, state, "forfeit", guest, "host_stalled");
      }
      if (state.phase === "playing" && elapsedS(state, tick) > MAX_PLAY_S) finish(ctx, logger, nk, d, tick, state, "timeout", null, "max_play");
      if (state.phase === "playing" && state.firstResultTick >= 0 && tick - state.firstResultTick > RESULT_WAIT_S * T) {
        var missing = state.results["0"] ? 1 : 0;
        if (!state.present[state.players[missing]]) finish(ctx, logger, nk, d, tick, state, "forfeit", 1 - missing, "left_before_result");
        else if (tick - state.firstResultTick > 3 * RESULT_WAIT_S * T) finish(ctx, logger, nk, d, tick, state, "disputed", null, "no_result");
      }
      return { state: state };
    },

    matchTerminate: function (ctx, logger, nk, d, tick, state, _grace) {
      if (state.phase === "playing") finish(ctx, logger, nk, d, tick, state, "server_shutdown", null, "server_shutdown");
      return { state: state };
    },

    matchSignal: function (_ctx, _logger, _nk, _d, _tick, state, data) {
      return { state: state, data: data };
    },
  };

  /** Matchmaker: two "sproto" tickets of the same protocol version, different users. */
  export function onMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (matches.length !== 2) return;
    var a = matches[0], b = matches[1];
    for (var i = 0; i < 2; i++) if (matches[i].properties["game"] !== GAME_ID) return;
    if (String(a.properties["v"]) !== String(b.properties["v"]) || String(a.properties["v"]) !== NET_VERSION) return;
    if (a.presence.userId === b.presence.userId) return;
    var names: { [userId: string]: string } = {};
    names[a.presence.userId] = String(a.presence.username || "").slice(0, 32);
    names[b.presence.userId] = String(b.presence.username || "").slice(0, 32);
    var id = nk.matchCreate(MATCH_NAME, {
      players: JSON.stringify([a.presence.userId, b.presence.userId]), names: JSON.stringify(names), v: NET_VERSION, private: "0",
    });
    logger.info("sproto_arena created " + id);
    return id;
  }

  function gameSession(ctx: nkruntime.Context): boolean {
    var vars = ctx.vars || null;
    return !!ctx.userId && !!vars && vars["scope"] === "game" && vars["game"] === GAME_ID;
  }

  function body(payload: string): { [k: string]: unknown } {
    var b = payload ? parse(payload) : {};
    return isObj(b) ? b : {};
  }

  /** sproto.room_create {v} → {matchId, code}. The creator joins the match id directly (listing lags ~1 s). */
  export function rpcRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!gameSession(ctx)) throw new Error("wrong_scope");
    var req = body(payload);
    if (String(req["v"]) !== NET_VERSION) throw new Error("version_mismatch");
    var code = "";
    for (var attempt = 0; attempt < 5 && !code; attempt++) {
      var c = roomCode();
      var taken = nk.matchList(1, true, null, null, null, "+label.kind:" + KIND + " +label.code:" + c);
      if (!taken || !taken.length) code = c;
    }
    if (!code) throw new Error("room_code_busy");
    var names: { [userId: string]: string } = {};
    names[ctx.userId!] = String(ctx.username || "").slice(0, 32);
    var matchId = nk.matchCreate(MATCH_NAME, { players: JSON.stringify([ctx.userId]), names: JSON.stringify(names), v: NET_VERSION, private: "1", code: code });
    logger.info("sproto_arena room " + code + " " + matchId);
    return JSON.stringify({ matchId: matchId, code: code });
  }

  /** sproto.room_join {code, v} → {matchId}, or room_not_found / version_mismatch. */
  export function rpcRoomJoin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!gameSession(ctx)) throw new Error("wrong_scope");
    var req = body(payload);
    var code = normalizeRoomCode(req["code"]);
    if (!code) throw new Error("room_not_found");
    var found = nk.matchList(1, true, null, 0, 1, "+label.kind:" + KIND + " +label.code:" + code + " +label.open:T");
    if (!found || !found.length) throw new Error("room_not_found");
    var lab = parse(found[0].label || "");
    if (!isObj(lab) || String(lab["v"]) !== String(req["v"])) throw new Error("version_mismatch");
    return JSON.stringify({ matchId: found[0].matchId });
  }
}

// Top-level wrappers: Nakama resolves match handlers and RPCs by global function name.
function sprotoArenaInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return SprotoArena.handler.matchInit(ctx, logger, nk, params);
}
function sprotoArenaJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return SprotoArena.handler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function sprotoArenaJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, presences: nkruntime.Presence[]) {
  return SprotoArena.handler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function sprotoArenaLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, presences: nkruntime.Presence[]) {
  return SprotoArena.handler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function sprotoArenaLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, messages: nkruntime.MatchMessage[]) {
  return SprotoArena.handler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function sprotoArenaTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, grace: number) {
  return SprotoArena.handler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function sprotoArenaSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: SprotoArena.State, data: string) {
  return SprotoArena.handler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
function rpcSprotoRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return SprotoArena.rpcRoomCreate(ctx, logger, nk, payload);
}
function rpcSprotoRoomJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return SprotoArena.rpcRoomJoin(ctx, logger, nk, payload);
}

HubGames.register({ game: SprotoArena.GAME_ID, matchmaker: SprotoArena.onMatched });

HubSchema.register({
  id: "0020_sproto_pvp",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.sproto_pvp_result (
      match_id text PRIMARY KEY,
      winner uuid NOT NULL,
      loser uuid NOT NULL,
      day date NOT NULL,
      status text NOT NULL,
      paid boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    "CREATE INDEX IF NOT EXISTS sproto_pvp_result_paid_day ON game.sproto_pvp_result (day, winner) WHERE paid",
    // Server-only reason (srv_ is refused by tickets.earn), at most 20 per grant.
    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
     VALUES ('sproto', 'srv_pvp_win', NULL, NULL, NULL, NULL, '{}'::jsonb, 20)
     ON CONFLICT (game_id, event_type) DO UPDATE SET max_amount = EXCLUDED.max_amount`,
  ],
});
