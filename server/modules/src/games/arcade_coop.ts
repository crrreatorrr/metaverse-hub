// Sproto Arcade 2P co-op (protocol v1, the shared contract with crrreatorrr/Sproto-Arcade).
//
// A lockstep relay: the two clients run the same deterministic story sim from a server-issued
// seed, and the match only relays inputs, compares state hashes and settles the reward. It runs
// no sim. Rooms are 2 seats (0 and 1), found by a 5-letter code or by the quick list.
//
// Rewards are settled here once per match: a clear both present seats report, on the match's
// level, with hashes agreeing through the last checked tick and no god mode, pays each present
// account that passes the AFK check (its non-zero input frames are at least half the ticks it
// relayed) 20 Tickets as `arcade_clear` (levels 1-14) and, on level 1, the Breakwater Coin through
// `arcade.boss_defeated` {boss:"bront"}. Both go through the single-player calls (game.earn_tickets
// via HubEconomy.earn, game.apply_event via HubRpc.grantEvent) with the seat's own game session,
// so caps, the session lease and idempotency are the same; keys are scoped to this match.
namespace ArcadeCoop {
  export var MATCH_NAME = "sproto_arcade_coop";
  export var GAME_ID = "sproto-arcade";
  export var PROTOCOL = 1;
  export var SEATS = 2;
  export var TICK_RATE = 30;
  export var LEVELS = 14;
  export var GRACE_S = 15;
  export var LOBBY_TIMEOUT_S = 600;
  export var LOAD_TIMEOUT_S = 120;
  export var MAX_DESYNCS = 3;
  /** OP_SEAT_DROP's tick is at least this far past the latest relayed input. */
  export var DROP_LEAD_TICKS = 10;
  export var TICKETS = 20;
  export var CLEAR_REASON = "arcade_clear";
  export var RELIC_EVENT = "arcade.boss_defeated";
  export var RELIC_DATA = { boss: "bront" };
  export var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  export var CODE_LENGTH = 5;
  export var COLLECTION = "arcade_coop";
  export var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
  /** Frames per OP_INPUT and the largest snapshot body we relay. */
  export var MAX_FRAMES = 32;
  export var MAX_SNAPSHOT = 262144;

  export var OP = {
    HELLO: 1,
    LOBBY: 2,
    START: 3,
    READY: 4,
    GO: 5,
    INPUT: 10,
    HASH: 11,
    DESYNC: 12,
    SNAPSHOT: 13,
    RESULT: 14,
    OUTCOME: 15,
    PEER: 16,
    SEAT_DROP: 17,
    PING: 18,
    CANCEL: 19,
  };

  var PILOT = /^[A-Za-z0-9_-]{1,32}$/;
  var CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

  export interface Seat {
    seat: number;
    userId: string;
    /** Game session id (ctx.vars.sid) from the join, for the reward calls. */
    sid: string;
    name: string;
    pilot: string;
    presence: nkruntime.Presence | null;
    present: boolean;
    hello: boolean;
    ready: boolean;
    /** Server tick the seat went away, -1 while present. */
    awayTick: number;
    /** Sim ticks this seat's inputs cover (the next expected `from`). */
    covered: number;
    /** Non-zero frames among those ticks. */
    nonZero: number;
    result: { status: string; level: number; tick: number; god: boolean } | null;
    dropped: boolean;
  }

  export interface State {
    code: string;
    quick: boolean;
    level: number;
    seed: number;
    phase: string;
    seats: (Seat | null)[];
    createdTick: number;
    phaseTick: number;
    /** Hashes by sim tick: [seat0, seat1]. */
    hashes: { [tick: string]: (string | null)[] };
    lastChecked: number;
    lastCheckOk: boolean;
    desyncs: number;
    /** Highest sim tick any relayed input covers. */
    lastInputTick: number;
    settled: boolean;
    endTick: number;
  }

  function seatsOf(state: State): Seat[] {
    var out: Seat[] = [];
    for (var i = 0; i < state.seats.length; i++) if (state.seats[i]) out.push(state.seats[i] as Seat);
    return out;
  }

  function seatOfUser(state: State, userId: string): Seat | null {
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (s && s.userId === userId) return s;
    }
    return null;
  }

  function livePresences(state: State, except?: number): nkruntime.Presence[] {
    var out: nkruntime.Presence[] = [];
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (s && s.present && s.presence && s.seat !== except) out.push(s.presence);
    }
    return out;
  }

  function send(dispatcher: nkruntime.MatchDispatcher, op: number, body: unknown, to: nkruntime.Presence[]): void {
    if (!to.length) return;
    dispatcher.broadcastMessage(op, JSON.stringify(body), to, null, true);
  }

  function text(nk: nkruntime.Nakama, data: string | ArrayBuffer | null | undefined): string {
    if (typeof data === "string") return data;
    if (data && typeof (data as ArrayBuffer).byteLength === "number") return nk.binaryToString(data as ArrayBuffer);
    return "";
  }

  function parse(raw: string, max: number): { [key: string]: unknown } | null {
    if (!raw || raw.length > max) return null;
    try {
      var v = JSON.parse(raw) as unknown;
      if (!v || typeof v !== "object" || Object.prototype.toString.call(v) === "[object Array]") return null;
      return v as { [key: string]: unknown };
    } catch (_e) {
      return null;
    }
  }

  function isInt(v: unknown): boolean {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function labelOf(state: State): string {
    var n = 0;
    for (var i = 0; i < state.seats.length; i++) if (state.seats[i]) n++;
    return JSON.stringify({
      game: GAME_ID,
      mode: "coop",
      v: PROTOCOL,
      quick: state.quick ? 1 : 0,
      level: state.level,
      open: state.phase === "lobby" && n < SEATS ? 1 : 0,
      players: n,
    });
  }

  function relabel(dispatcher: nkruntime.MatchDispatcher, state: State): void {
    dispatcher.matchLabelUpdate(labelOf(state));
  }

  function lobbyBody(state: State): { [key: string]: unknown } {
    var seats: { [key: string]: unknown }[] = [];
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (s) seats.push({ seat: s.seat, name: s.name, pilot: s.pilot, present: s.present });
    }
    return { code: state.code, level: state.level, seats: seats };
  }

  function startBody(state: State, seat: number): { [key: string]: unknown } {
    var a = state.seats[0], b = state.seats[1];
    return {
      levelIndex: state.level - 1,
      pilots: [a ? a.pilot : "", b ? b.pilot : ""],
      seed: state.seed,
      seat: seat,
      names: [a ? a.name : "", b ? b.name : ""],
    };
  }

  /** A uint32 from the server's CSPRNG (uuidv4), never from a client. */
  function serverSeed(nk: nkruntime.Nakama): number {
    var hex = nk.sha256Hash(nk.uuidv4()).slice(0, 8);
    return parseInt(hex, 16) >>> 0;
  }

  function shortHash(nk: nkruntime.Nakama, value: string): string {
    return nk.sha256Hash(value).slice(0, 16);
  }

  // ----- codes (server-only storage, permission 0) -----

  function readCode(nk: nkruntime.Nakama, code: string): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: COLLECTION, key: "code:" + code, userId: SYSTEM_USER }]);
    return rows && rows.length ? rows[0] : null;
  }

  function reserveCode(nk: nkruntime.Nakama, code: string): boolean {
    try {
      nk.storageWrite([{ collection: COLLECTION, key: "code:" + code, userId: SYSTEM_USER, value: { matchId: "" }, version: "*", permissionRead: 0, permissionWrite: 0 }]);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function bindCode(nk: nkruntime.Nakama, code: string, matchId: string): void {
    nk.storageWrite([{ collection: COLLECTION, key: "code:" + code, userId: SYSTEM_USER, value: { matchId: matchId }, permissionRead: 0, permissionWrite: 0 }]);
  }

  export function releaseCode(nk: nkruntime.Nakama, code: string): void {
    if (!code) return;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: "code:" + code, userId: SYSTEM_USER }]);
    } catch (_e) {
      // Already gone.
    }
  }

  function newCode(nk: nkruntime.Nakama): string {
    for (var attempt = 0; attempt < 16; attempt++) {
      var hex = nk.sha256Hash(nk.uuidv4());
      var code = "";
      for (var i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % CODE_ALPHABET.length);
      var row = readCode(nk, code);
      if (row) {
        // A code whose match ended can be reused.
        var held = String(row.value["matchId"] || "");
        if (held && nk.matchGet(held)) continue;
        releaseCode(nk, code);
      }
      if (reserveCode(nk, code)) return code;
    }
    return "";
  }

  // ----- reward settlement -----

  function afkOk(seat: Seat): boolean {
    return seat.covered > 0 && seat.nonZero >= 0.5 * seat.covered;
  }

  /** Pays one seat. Errors (a cap, a closed session) pay nothing and are logged, never thrown. */
  function paySeat(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: State, matchId: string, seat: Seat): { tickets: number; relics: string[] } {
    var out = { tickets: 0, relics: [] as string[] };
    var who = { userId: seat.userId, sid: seat.sid, game: GAME_ID };
    var scope = "arcade-coop:" + shortHash(nk, matchId) + ":L" + String(state.level);
    try {
      var earned = HubEconomy.earn(nk, who, TICKETS, CLEAR_REASON, scope + ":clear");
      if (!earned.error) {
        // game.earn_tickets answers {balance, capped}; a capped credit may be partial, so it reads as 0 here.
        out.tickets = earned.capped === true ? 0 : TICKETS;
      } else {
        logger.info("arcade coop tickets refused " + String(earned.error) + " user " + seat.userId);
      }
    } catch (e) {
      logger.warn("arcade coop tickets failed " + String(e));
    }
    if (state.level === 1) {
      try {
        var granted = HubRpc.grantEvent(nk, logger, who, RELIC_EVENT, RELIC_DATA, scope + ":coin");
        if (!granted.error && typeof granted.granted === "string") out.relics.push(String(granted.granted));
      } catch (e) {
        logger.warn("arcade coop relic failed " + String(e));
      }
    }
    return out;
  }

  /** Settle once both present seats have a result (or one seat is left). */
  function maybeSettle(nk: nkruntime.Nakama, logger: nkruntime.Logger, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, matchId: string): void {
    if (state.settled || state.phase !== "play") return;
    var present: Seat[] = [];
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (s && !s.dropped) present.push(s);
    }
    if (!present.length) return;
    for (var j = 0; j < present.length; j++) if (!present[j].result) return;
    state.settled = true;
    state.phase = "done";
    state.endTick = tick;
    var first = present[0].result as { status: string; level: number; tick: number; god: boolean };
    var agree = true;
    var god = false;
    for (var k = 0; k < present.length; k++) {
      var r = present[k].result as { status: string; level: number; tick: number; god: boolean };
      if (r.status !== first.status || r.level !== first.level) agree = false;
      if (r.god) god = true;
    }
    var status = agree ? first.status : "abort";
    var reason = "";
    if (!agree) reason = "disagree";
    else if (first.status === "clear") {
      if (first.level !== state.level) reason = "level";
      else if (state.lastChecked >= 0 && !state.lastCheckOk) reason = "desync";
      else if (god) reason = "god";
    }
    var payable = agree && first.status === "clear" && !reason && state.level >= 1 && state.level <= LEVELS;
    for (var p = 0; p < present.length; p++) {
      var seat = present[p];
      var rewards = { tickets: 0, relics: [] as string[] };
      var seatReason = reason;
      if (payable && !afkOk(seat)) seatReason = "afk";
      else if (payable) rewards = paySeat(nk, logger, state, matchId, seat);
      var body: { [key: string]: unknown } = { status: status, rewards: rewards };
      if (seatReason) body.reason = seatReason;
      if (seat.present && seat.presence) send(dispatcher, OP.OUTCOME, body, [seat.presence]);
    }
    logger.info("arcade coop settled " + matchId + " level " + String(state.level) + " status " + status + (reason ? " reason " + reason : ""));
  }

  function cancel(nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, reason: string): void {
    send(dispatcher, OP.CANCEL, { reason: reason }, livePresences(state));
    state.phase = "done";
    state.settled = true;
    state.endTick = tick;
    releaseCode(nk, state.code);
  }

  function endUnrewarded(dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, reason: string): void {
    send(dispatcher, OP.OUTCOME, { status: "abort", reason: reason, rewards: { tickets: 0, relics: [] } }, livePresences(state));
    state.phase = "done";
    state.settled = true;
    state.endTick = tick;
  }

  // ----- match handlers -----

  export function matchInit(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }): { state: State; tickRate: number; label: string } {
    var level = Math.floor(Number(params && params.level));
    if (!(level >= 1 && level <= LEVELS)) level = 1;
    var state: State = {
      code: params && typeof params.code === "string" ? params.code : "",
      quick: !!(params && params.quick === "1"),
      level: level,
      seed: serverSeed(nk),
      phase: "lobby",
      seats: [null, null],
      createdTick: 0,
      phaseTick: 0,
      hashes: {},
      lastChecked: -1,
      lastCheckOk: true,
      desyncs: 0,
      lastInputTick: -1,
      settled: false,
      endTick: -1,
    };
    logger.info("arcade coop up level " + String(level) + (state.code ? " code " + state.code : " quick"));
    return { state: state, tickRate: TICK_RATE, label: labelOf(state) };
  }

  export function matchJoinAttempt(ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, presence: nkruntime.Presence, _metadata: { [key: string]: unknown }): { state: State; accept: boolean; rejectMessage?: string } {
    var vars = ctx.vars || null;
    if (!presence || !presence.userId) return { state: state, accept: false, rejectMessage: "unauthorized" };
    if (!vars || vars["scope"] !== "game" || vars["game"] !== GAME_ID || !vars["sid"]) return { state: state, accept: false, rejectMessage: "wrong_scope" };
    if (state.phase === "done") return { state: state, accept: false, rejectMessage: "ended" };
    var mine = seatOfUser(state, presence.userId);
    if (mine) {
      if (mine.dropped) return { state: state, accept: false, rejectMessage: "dropped" };
      mine.sid = String(vars["sid"]);
      return { state: state, accept: true };
    }
    if (state.phase !== "lobby") return { state: state, accept: false, rejectMessage: "started" };
    for (var i = 0; i < SEATS; i++) {
      if (!state.seats[i]) {
        state.seats[i] = {
          seat: i,
          userId: presence.userId,
          sid: String(vars["sid"]),
          name: HubMatch.cleanName(presence.username || "", 16),
          pilot: "",
          presence: null,
          present: false,
          hello: false,
          ready: false,
          awayTick: tick,
          covered: 0,
          nonZero: 0,
          result: null,
          dropped: false,
        };
        return { state: state, accept: true };
      }
    }
    return { state: state, accept: false, rejectMessage: "full" };
  }

  export function matchJoin(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, _tick: number, state: State, joined: nkruntime.Presence[]): { state: State } {
    for (var i = 0; i < joined.length; i++) {
      var pr = joined[i];
      var seat = pr ? seatOfUser(state, pr.userId) : null;
      if (!seat) continue;
      if (seat.present && seat.presence && seat.presence.sessionId !== pr.sessionId) dispatcher.matchKick([seat.presence]);
      var back = seat.hello && !seat.present;
      seat.presence = pr;
      seat.present = true;
      seat.awayTick = -1;
      if (back) {
        send(dispatcher, OP.PEER, { seat: seat.seat, present: true, graceS: 0 }, livePresences(state, seat.seat));
        // Back mid-run: the start again, then GO. Its next hash will differ, and the desync path
        // (seat 0's snapshot) brings it level.
        if (state.phase === "loading" || state.phase === "play") send(dispatcher, OP.START, startBody(state, seat.seat), [pr]);
        if (state.phase === "play") send(dispatcher, OP.GO, {}, [pr]);
      }
    }
    send(dispatcher, OP.LOBBY, lobbyBody(state), livePresences(state));
    relabel(dispatcher, state);
    return { state: state };
  }

  export function matchLeave(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, left: nkruntime.Presence[]): { state: State } {
    for (var i = 0; i < left.length; i++) {
      var pr = left[i];
      var seat = pr ? seatOfUser(state, pr.userId) : null;
      if (!seat || !seat.presence || seat.presence.sessionId !== pr.sessionId) continue;
      seat.present = false;
      seat.presence = null;
      seat.awayTick = tick;
      if (state.phase === "lobby") {
        // Before the start a seat is just freed, so the code still finds a partner.
        state.seats[seat.seat] = null;
      } else if (state.phase !== "done") {
        send(dispatcher, OP.PEER, { seat: seat.seat, present: false, graceS: GRACE_S }, livePresences(state));
      }
    }
    if (state.phase === "lobby") send(dispatcher, OP.LOBBY, lobbyBody(state), livePresences(state));
    relabel(dispatcher, state);
    return { state: state };
  }

  function onHello(dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, seat: Seat, body: { [key: string]: unknown }): void {
    if (body.v !== PROTOCOL) {
      if (seat.presence) send(dispatcher, OP.CANCEL, { reason: "version_mismatch" }, [seat.presence]);
      return;
    }
    if (body.level !== undefined && body.level !== state.level) {
      if (seat.presence) send(dispatcher, OP.CANCEL, { reason: "level_mismatch" }, [seat.presence]);
      return;
    }
    if (typeof body.pilot !== "string" || !PILOT.test(body.pilot)) return;
    if (state.phase !== "lobby") return;
    seat.pilot = body.pilot;
    seat.hello = true;
    send(dispatcher, OP.LOBBY, lobbyBody(state), livePresences(state));
    var a = state.seats[0], b = state.seats[1];
    if (a && b && a.hello && b.hello && a.present && b.present) {
      state.phase = "loading";
      state.phaseTick = tick;
      for (var i = 0; i < SEATS; i++) {
        var s = state.seats[i] as Seat;
        if (s.presence) send(dispatcher, OP.START, startBody(state, s.seat), [s.presence]);
      }
    }
  }

  function onReady(dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, seat: Seat): void {
    if (state.phase !== "loading") return;
    seat.ready = true;
    var a = state.seats[0], b = state.seats[1];
    if (a && b && a.ready && b.ready) {
      state.phase = "play";
      state.phaseTick = tick;
      send(dispatcher, OP.GO, {}, livePresences(state));
    }
  }

  function onInput(dispatcher: nkruntime.MatchDispatcher, state: State, seat: Seat, body: { [key: string]: unknown }): void {
    if (state.phase !== "play" || seat.dropped) return;
    var from = body.from;
    var frames = body.frames;
    if (!isInt(from) || (from as number) < 0 || Object.prototype.toString.call(frames) !== "[object Array]") return;
    var list = frames as unknown[];
    if (!list.length || list.length > MAX_FRAMES) return;
    var clean: number[] = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!isInt(f) || (f as number) < 0 || (f as number) > 1023) return;
      clean.push(f as number);
    }
    var start = from as number;
    // AFK count: each sim tick once, so a resent frame is not counted twice.
    for (var k = 0; k < clean.length; k++) {
      var t = start + k;
      if (t < seat.covered) continue;
      seat.covered = t + 1;
      if (clean[k] !== 0) seat.nonZero++;
    }
    var last = start + clean.length - 1;
    if (last > state.lastInputTick) state.lastInputTick = last;
    // The seat comes from the sender's presence, never from the body.
    send(dispatcher, OP.INPUT, { seat: seat.seat, from: start, frames: clean }, livePresences(state, seat.seat));
  }

  function onHash(dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, seat: Seat, body: { [key: string]: unknown }): void {
    if (state.phase !== "play") return;
    if (!isInt(body.tick) || (body.tick as number) < 0) return;
    var h = body.hash;
    if (!(typeof h === "string" && h.length > 0 && h.length <= 64) && !isInt(h)) return;
    var key = String(body.tick);
    var row = state.hashes[key] || (state.hashes[key] = [null, null]);
    row[seat.seat] = String(h);
    var other = state.seats[1 - seat.seat];
    if (row[0] === null || row[1] === null) {
      // The other seat is gone: nothing to compare against.
      if (!other || other.dropped) delete state.hashes[key];
      return;
    }
    var t = body.tick as number;
    delete state.hashes[key];
    if (t >= state.lastChecked) {
      state.lastChecked = t;
      state.lastCheckOk = row[0] === row[1];
    }
    if (row[0] !== row[1]) {
      state.desyncs++;
      send(dispatcher, OP.DESYNC, { tick: t, count: state.desyncs }, livePresences(state));
      if (state.desyncs >= MAX_DESYNCS) endUnrewarded(dispatcher, tick, state, "desync");
    }
    // Old unmatched rows (a lost hash) are dropped after a while.
    var keys = Object.keys(state.hashes);
    for (var i = 0; i < keys.length; i++) if (Number(keys[i]) < t - 600) delete state.hashes[keys[i]];
  }

  function onSnapshot(dispatcher: nkruntime.MatchDispatcher, state: State, seat: Seat, raw: string): void {
    if (state.phase !== "play" || seat.seat !== 0 || raw.length > MAX_SNAPSHOT) return;
    var body = parse(raw, MAX_SNAPSHOT);
    if (!body || !isInt(body.tick) || body.state === undefined) return;
    var other = state.seats[1];
    if (!other || !other.present || !other.presence) return;
    // A snapshot resets the comparison: hashes from before it no longer apply.
    state.lastCheckOk = true;
    send(dispatcher, OP.SNAPSHOT, { tick: body.tick, state: body.state }, [other.presence]);
  }

  function onResult(nk: nkruntime.Nakama, logger: nkruntime.Logger, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, seat: Seat, body: { [key: string]: unknown }, matchId: string): void {
    if (state.phase !== "play" || seat.result || seat.dropped) return;
    var status = body.status;
    if (status !== "clear" && status !== "wipe" && status !== "abort") return;
    var level = isInt(body.level) ? (body.level as number) : -1;
    var simTick = isInt(body.tick) ? (body.tick as number) : -1;
    // Anything but an explicit false counts as god mode, so a client that leaves it out is not paid.
    seat.result = { status: status, level: level, tick: simTick, god: body.god !== false };
    maybeSettle(nk, logger, dispatcher, tick, state, matchId);
  }

  export function matchLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, messages: nkruntime.MatchMessage[]): { state: State } | null {
    var matchId = ctx.matchId || "";
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (!m || !m.sender) continue;
      var seat = seatOfUser(state, m.sender.userId);
      if (!seat || !seat.present || !seat.presence || seat.presence.sessionId !== m.sender.sessionId) continue;
      var raw = text(nk, m.data);
      if (m.opCode === OP.SNAPSHOT) {
        onSnapshot(dispatcher, state, seat, raw);
        continue;
      }
      var body = parse(raw, 4096);
      if (m.opCode === OP.READY) {
        onReady(dispatcher, tick, state, seat);
        continue;
      }
      if (!body) continue;
      if (m.opCode === OP.HELLO) onHello(dispatcher, tick, state, seat, body);
      else if (m.opCode === OP.INPUT) onInput(dispatcher, state, seat, body);
      else if (m.opCode === OP.HASH) onHash(dispatcher, tick, state, seat, body);
      else if (m.opCode === OP.RESULT) onResult(nk, logger, dispatcher, tick, state, seat, body, matchId);
      else if (m.opCode === OP.PING) {
        var c = body.c;
        if ((typeof c === "number" && isFinite(c)) || (typeof c === "string" && c.length <= 32)) send(dispatcher, OP.PING, { c: c, s: Date.now() }, [seat.presence]);
      }
    }

    // Reconnect grace: a seat away for GRACE_S is dropped at a tick both sims can still reach.
    var seats = seatsOf(state);
    for (var j = 0; j < seats.length; j++) {
      var s = seats[j];
      if (s.present || s.dropped || s.awayTick < 0 || state.phase === "lobby" || state.phase === "done") continue;
      if (tick - s.awayTick < GRACE_S * TICK_RATE) continue;
      s.dropped = true;
      send(dispatcher, OP.SEAT_DROP, { seat: s.seat, tick: Math.max(0, state.lastInputTick) + DROP_LEAD_TICKS }, livePresences(state));
      if (state.phase === "loading") {
        cancel(nk, dispatcher, tick, state, "peer_left");
      } else {
        maybeSettle(nk, logger, dispatcher, tick, state, matchId);
      }
    }

    // A lobby seat reserved by a join attempt whose socket never joined is freed after 10 s.
    if (state.phase === "lobby") {
      for (var q = 0; q < SEATS; q++) {
        var held = state.seats[q];
        if (held && !held.present && held.awayTick >= 0 && tick - held.awayTick >= 10 * TICK_RATE) state.seats[q] = null;
      }
    }
    var anyone = livePresences(state).length > 0;
    if (state.phase === "lobby" && tick - state.createdTick >= LOBBY_TIMEOUT_S * TICK_RATE) cancel(nk, dispatcher, tick, state, "lobby_timeout");
    if (state.phase === "loading" && tick - state.phaseTick >= LOAD_TIMEOUT_S * TICK_RATE) cancel(nk, dispatcher, tick, state, "load_timeout");
    if (state.phase === "play") {
      var live = 0;
      for (var k = 0; k < seats.length; k++) if (!seats[k].dropped) live++;
      if (!live) {
        state.phase = "done";
        state.endTick = tick;
      }
    }
    if (state.phase === "lobby" && !anyone && tick - state.createdTick > 30 * TICK_RATE) cancel(nk, dispatcher, tick, state, "empty");
    if (state.phase === "done") {
      releaseCode(nk, state.code);
      // A short tail so the last OUTCOME/CANCEL frames leave before the match closes.
      if (state.endTick < 0) state.endTick = tick;
      if (tick - state.endTick >= TICK_RATE * 2 || !anyone) return null;
    }
    return { state: state };
  }

  export function matchTerminate(_ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, _grace: number): { state: State } {
    if (state.phase !== "done") cancel(nk, dispatcher, tick, state, "server_shutdown");
    return { state: state };
  }

  export function matchSignal(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: State, data: string): { state: State; data: string } {
    if (data === "status") return { state: state, data: JSON.stringify({ phase: state.phase, level: state.level, seats: seatsOf(state).length, desyncs: state.desyncs }) };
    return { state: state, data: "" };
  }

  // ----- RPCs -----

  function fail(code: string, message: string): string {
    return HubRpc.fail(code, message);
  }

  function gate(ctx: nkruntime.Context): string | null {
    var vars = ctx.vars || null;
    if (!ctx.userId || !vars || vars["scope"] !== "game" || vars["game"] !== GAME_ID) return fail("wrong_scope", "Sproto Arcade game session required");
    return null;
  }

  function rpcBody(payload: string): { [key: string]: unknown } | null {
    if (!payload) return {};
    return parse(payload, 1024);
  }

  function levelOf(body: { [key: string]: unknown }): number {
    var level = body.level;
    return isInt(level) && (level as number) >= 1 && (level as number) <= LEVELS ? (level as number) : 0;
  }

  function rateOk(nk: nkruntime.Nakama, userId: string, kind: string, max: number, windowS: number): boolean {
    var key = "arcade_coop:" + kind + ":" + userId;
    var now = Date.now();
    var bucket = { t: now, n: 0 };
    var raw = nk.localcacheGet(key);
    if (typeof raw === "string" && raw) {
      try {
        var parsed = JSON.parse(raw) as { t?: number; n?: number };
        if (parsed && typeof parsed.t === "number" && typeof parsed.n === "number") bucket = { t: parsed.t, n: parsed.n };
      } catch (_e) {
        bucket = { t: now, n: 0 };
      }
    }
    if (now - bucket.t >= windowS * 1000) bucket = { t: now, n: 0 };
    bucket.n++;
    nk.localcachePut(key, JSON.stringify(bucket), windowS + 2);
    return bucket.n <= max;
  }

  /** arcade.coop_create {level, pilot} → {match_id, code}. */
  export function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var body = rpcBody(payload);
    if (!body) return fail("bad_json", "Body must be a JSON object");
    var level = levelOf(body);
    if (!level) return fail("bad_level", "level must be 1 to 14");
    if (body.pilot !== undefined && (typeof body.pilot !== "string" || !PILOT.test(body.pilot))) return fail("bad_pilot", "Unknown pilot");
    if (!rateOk(nk, ctx.userId as string, "create", 6, 60)) return fail("rate_limited", "Too many rooms. Try again in a minute.");
    var code = newCode(nk);
    if (!code) return fail("busy", "No room code is free. Try again.");
    var matchId = nk.matchCreate(MATCH_NAME, { code: code, level: String(level), quick: "0" });
    bindCode(nk, code, matchId);
    logger.info("arcade coop room " + code + " level " + String(level));
    return JSON.stringify({ match_id: matchId, code: code });
  }

  /** arcade.coop_join {code} → {match_id}, or not_found / full. */
  export function rpcJoin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var body = rpcBody(payload);
    if (!body) return fail("bad_json", "Body must be a JSON object");
    if (!rateOk(nk, ctx.userId as string, "join", 20, 60)) return fail("rate_limited", "Too many tries. Try again in a minute.");
    var code = typeof body.code === "string" ? body.code.toUpperCase().replace(/\s+/g, "") : "";
    if (!CODE.test(code)) return fail("not_found", "No room with that code");
    var row = readCode(nk, code);
    var matchId = row ? String(row.value["matchId"] || "") : "";
    var match = matchId ? nk.matchGet(matchId) : null;
    if (!match) {
      if (row) releaseCode(nk, code);
      return fail("not_found", "No room with that code");
    }
    var label = parse(match.label || "", 512);
    if (match.size >= SEATS || (label && label.open === 0)) return fail("full", "That room is full");
    return JSON.stringify({ match_id: matchId });
  }

  /** arcade.coop_quick {level, pilot} → {match_id}: an open quick room on that level, or a new one. */
  export function rpcQuick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var body = rpcBody(payload);
    if (!body) return fail("bad_json", "Body must be a JSON object");
    var level = levelOf(body);
    if (!level) return fail("bad_level", "level must be 1 to 14");
    if (body.pilot !== undefined && (typeof body.pilot !== "string" || !PILOT.test(body.pilot))) return fail("bad_pilot", "Unknown pilot");
    if (!rateOk(nk, ctx.userId as string, "quick", 20, 60)) return fail("rate_limited", "Too many tries. Try again in a minute.");
    var query = "+label.game:" + GAME_ID + " +label.mode:coop +label.quick:1 +label.open:1 +label.level:" + String(level) + " +label.v:" + String(PROTOCOL);
    var found = nk.matchList(10, true, null, 0, SEATS - 1, query) || [];
    for (var i = 0; i < found.length; i++) {
      if (found[i] && found[i].matchId && found[i].size < SEATS) return JSON.stringify({ match_id: found[i].matchId });
    }
    var matchId = nk.matchCreate(MATCH_NAME, { code: "", level: String(level), quick: "1" });
    logger.info("arcade coop quick room level " + String(level));
    return JSON.stringify({ match_id: matchId });
  }

  export var handler = {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  };
}

// Nakama resolves these names from InitModule. They stay top-level functions.
function arcadeCoopInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return ArcadeCoop.handler.matchInit(ctx, logger, nk, params);
}
function arcadeCoopJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return ArcadeCoop.handler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function arcadeCoopJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, presences: nkruntime.Presence[]) {
  return ArcadeCoop.handler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function arcadeCoopLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, presences: nkruntime.Presence[]) {
  return ArcadeCoop.handler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function arcadeCoopLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, messages: nkruntime.MatchMessage[]) {
  return ArcadeCoop.handler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function arcadeCoopTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, grace: number) {
  return ArcadeCoop.handler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function arcadeCoopSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ArcadeCoop.State, data: string) {
  return ArcadeCoop.handler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
function rpcArcadeCoopCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ArcadeCoop.rpcCreate(ctx, logger, nk, payload);
}
function rpcArcadeCoopJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ArcadeCoop.rpcJoin(ctx, logger, nk, payload);
}
function rpcArcadeCoopQuick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return ArcadeCoop.rpcQuick(ctx, logger, nk, payload);
}
