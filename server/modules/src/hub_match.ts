// M3 authoritative hub match. Not registered and not in tsconfig.json `files`,
// so the Nakama bundle does not include it. Wiring is docs/m3-server-prep.md.
//
// One instance, 10 players, 15 Hz. Presence is position, rotation, animation,
// name, owned Relics for orbit gems, and current game. This handler never
// credits Tickets, Verse, Relics, or items. Its only SQL is a relic read.
// The five-minute meta rollup is HubBoards.onHubTick, which writes ranked
// scores only.

namespace HubMatch {
  export var TICK_RATE = 15;
  /** Architecture's later cap is 100. This module's cap is the 10-player test. */
  export var MAX_PLAYERS = 10;
  export var OP_POSE = 1;
  export var OP_SNAPSHOT = 2;
  /** Walk 7.8 m/s and sprint 1.8x, from the hub controller, with three ticks of slack. */
  var MAX_H_STEP = (7.8 * 1.8 * 3) / 15;
  var MAX_V_STEP = 3;
  var RELIC_REFRESH_TICKS = 75;
  var SPAWN_X = 0;
  var SPAWN_Y = 1.775;
  var SPAWN_Z = 42;

  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true };
  var ANIMATIONS: { [id: string]: boolean } = {
    idle: true,
    walk: true,
    run: true,
    jump: true,
    wave: true,
    dance: true,
    cheer: true,
  };
  var RELIC_ORDER = ["hpos10i_core", "genesis_shard", "cones_tip", "tinubu_crown"];
  var RELIC_OK: { [id: string]: boolean } = {
    hpos10i_core: true,
    genesis_shard: true,
    cones_tip: true,
    tinubu_crown: true,
  };

  interface Presence {
    userId: string;
    sessionId: string;
    username: string;
    node: string;
  }

  interface MatchMessage {
    sender: Presence | null;
    opCode: number;
    data: string | ArrayBuffer | null;
  }

  interface MatchDispatcher {
    broadcastMessage(opCode: number, data: string, presences: Presence[] | null, sender: Presence | null, reliable: boolean): void;
    matchKick(presences: Presence[]): void;
    matchLabelUpdate(label: string): void;
  }

  interface Player {
    userId: string;
    sessionId: string;
    name: string;
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
    rw: number;
    animation: string;
    relics: string[];
    game: string;
    placed: boolean;
  }

  interface HubState {
    players: { [userId: string]: Player };
    count: number;
  }

  function errorText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
    return String(value);
  }

  function isObject(value: unknown): boolean {
    return !!value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  /** The match handler's own SQL is a single SELECT. */
  function assertSelectOnly(sql: string): void {
    var lower = sql.replace(/^\s+/, "").toLowerCase();
    if (lower.indexOf("select") !== 0) throw new Error("hub_match_write");
    if (lower.indexOf("insert") >= 0 || lower.indexOf("update") >= 0 || lower.indexOf("delete") >= 0) {
      throw new Error("hub_match_write");
    }
  }

  function sanitizeName(raw: string): string {
    var out = "";
    for (var i = 0; i < raw.length && out.length < 24; i++) {
      var code = raw.charCodeAt(i);
      var ok = (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || code === 32
        || code === 95
        || code === 45
        || code === 46;
      if (ok) out += raw.charAt(i);
    }
    return out || "player";
  }

  function lookupName(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, fallback: string): string {
    try {
      var account = nk.accountGetId(userId);
      var username = account && account.user && account.user.username ? account.user.username : "";
      if (username) return sanitizeName(username);
    } catch (e) {
      logger.warn("hub account unread " + errorText(e));
    }
    return sanitizeName(fallback);
  }

  function lookupRelics(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): string[] {
    var sql = "SELECT COALESCE(json_agg(relic_id), '[]'::json)::text AS result FROM game.relic_claim WHERE user_id = $1::uuid AND relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown')";
    assertSelectOnly(sql);
    try {
      var rows = nk.sqlQuery(sql, [userId]);
      var raw = rows && rows.length ? rows[0].result : "[]";
      var parsed: unknown = raw;
      if (typeof raw === "string") parsed = JSON.parse(raw);
      var have: { [id: string]: boolean } = {};
      if (parsed && Object.prototype.toString.call(parsed) === "[object Array]") {
        var list = parsed as unknown[];
        for (var i = 0; i < list.length; i++) if (typeof list[i] === "string" && RELIC_OK[list[i] as string]) have[list[i] as string] = true;
      }
      var out: string[] = [];
      for (var j = 0; j < RELIC_ORDER.length; j++) if (have[RELIC_ORDER[j]]) out.push(RELIC_ORDER[j]);
      return out;
    } catch (e) {
      logger.warn("hub relic read failed " + errorText(e));
      return [];
    }
  }

  function recount(state: HubState): void {
    state.count = Object.keys(state.players).length;
  }

  function labelOf(state: HubState): string {
    return JSON.stringify({ name: "hub", players: state.count, max: MAX_PLAYERS });
  }

  function snapshot(tick: number, state: HubState): string {
    var ids = Object.keys(state.players).sort();
    var players: { [key: string]: unknown }[] = [];
    for (var i = 0; i < ids.length; i++) {
      var player = state.players[ids[i]];
      players.push({
        userId: player.userId,
        name: player.name,
        position: { x: player.x, y: player.y, z: player.z },
        rotation: { x: player.rx, y: player.ry, z: player.rz, w: player.rw },
        animation: player.animation,
        relics: player.relics,
        game: player.game,
      });
    }
    return JSON.stringify({ tick: tick, players: players });
  }

  function broadcast(dispatcher: MatchDispatcher, tick: number, state: HubState): void {
    dispatcher.broadcastMessage(OP_SNAPSHOT, snapshot(tick, state), null, null, false);
  }

  function finite(value: unknown): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function readVec3(value: unknown): { x: number; y: number; z: number } | null {
    if (!isObject(value)) return null;
    var body = value as { [key: string]: unknown };
    var x = finite(body.x);
    var y = finite(body.y);
    var z = finite(body.z);
    if (x === null || y === null || z === null) return null;
    return { x: x, y: y, z: z };
  }

  function readQuat(value: unknown): { x: number; y: number; z: number; w: number } | null {
    if (!isObject(value)) return null;
    var body = value as { [key: string]: unknown };
    var x = finite(body.x);
    var y = finite(body.y);
    var z = finite(body.z);
    var w = finite(body.w);
    if (x === null || y === null || z === null || w === null) return null;
    var lengthSq = x * x + y * y + z * z + w * w;
    if (lengthSq < 0.25 || lengthSq > 2.25) return null;
    return { x: x, y: y, z: z, w: w };
  }

  function inBounds(x: number, y: number, z: number): boolean {
    return x >= -140 && x <= 140 && z >= -140 && z <= 140 && y >= -4 && y <= 40;
  }

  function messageText(nk: nkruntime.Nakama, data: string | ArrayBuffer | null): string {
    if (typeof data === "string") return data;
    if (data && typeof data.byteLength === "number") {
      try {
        return nk.binaryToString(data);
      } catch (_e) {
        return "";
      }
    }
    return "";
  }

  function applyPose(player: Player, raw: string): void {
    if (!raw || raw.length > 2048) return;
    var data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (_e) {
      return;
    }
    if (!isObject(data)) return;
    var body = data as { [key: string]: unknown };
    var position = readVec3(body.position);
    if (!position || !inBounds(position.x, position.y, position.z)) return;
    if (player.placed) {
      var dx = position.x - player.x;
      var dz = position.z - player.z;
      var dy = position.y - player.y;
      if (dx * dx + dz * dz > MAX_H_STEP * MAX_H_STEP) return;
      if (dy > MAX_V_STEP || dy < -MAX_V_STEP) return;
    }
    player.x = position.x;
    player.y = position.y;
    player.z = position.z;
    player.placed = true;
    var rotation = readQuat(body.rotation);
    if (rotation) {
      player.rx = rotation.x;
      player.ry = rotation.y;
      player.rz = rotation.z;
      player.rw = rotation.w;
    }
    if (typeof body.animation === "string" && ANIMATIONS[body.animation]) player.animation = body.animation;
    if (typeof body.game === "string" && (body.game === "" || GAMES[body.game])) player.game = body.game;
  }

  function blankPlayer(nk: nkruntime.Nakama, logger: nkruntime.Logger, presence: Presence): Player {
    return {
      userId: presence.userId,
      sessionId: presence.sessionId || "",
      name: lookupName(nk, logger, presence.userId, presence.username || ""),
      x: SPAWN_X,
      y: SPAWN_Y,
      z: SPAWN_Z,
      rx: 0,
      ry: 0,
      rz: 0,
      rw: 1,
      animation: "idle",
      relics: lookupRelics(nk, logger, presence.userId),
      game: "",
      placed: false,
    };
  }

  export function matchInit(
    _ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _params: { [key: string]: string },
  ): { state: HubState; tickRate: number; label: string } {
    logger.info("hub match init tick " + String(TICK_RATE) + " max " + String(MAX_PLAYERS));
    return {
      state: { players: {}, count: 0 },
      tickRate: TICK_RATE,
      label: JSON.stringify({ name: "hub", players: 0, max: MAX_PLAYERS }),
    };
  }

  export function matchJoinAttempt(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _dispatcher: MatchDispatcher,
    _tick: number,
    state: HubState,
    presence: Presence,
    _metadata: { [key: string]: string },
  ): { state: HubState; accept: boolean; rejectMessage?: string } {
    recount(state);
    if (!presence || !presence.userId) return { state: state, accept: false, rejectMessage: "unauthorized" };
    if (state.players[presence.userId]) return { state: state, accept: false, rejectMessage: "already_joined" };
    if (state.count >= MAX_PLAYERS) return { state: state, accept: false, rejectMessage: "hub_full" };
    return { state: state, accept: true };
  }

  export function matchJoin(
    _ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: MatchDispatcher,
    tick: number,
    state: HubState,
    presences: Presence[],
  ): { state: HubState } {
    for (var i = 0; i < presences.length; i++) {
      var presence = presences[i];
      if (!presence || !presence.userId || state.players[presence.userId]) continue;
      recount(state);
      if (state.count >= MAX_PLAYERS) {
        dispatcher.matchKick([presence]);
        continue;
      }
      state.players[presence.userId] = blankPlayer(nk, logger, presence);
    }
    recount(state);
    dispatcher.matchLabelUpdate(labelOf(state));
    broadcast(dispatcher, tick, state);
    return { state: state };
  }

  export function matchLeave(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    dispatcher: MatchDispatcher,
    tick: number,
    state: HubState,
    presences: Presence[],
  ): { state: HubState } {
    for (var i = 0; i < presences.length; i++) {
      var userId = presences[i] && presences[i].userId;
      if (userId && state.players[userId]) delete state.players[userId];
    }
    recount(state);
    dispatcher.matchLabelUpdate(labelOf(state));
    if (state.count > 0) broadcast(dispatcher, tick, state);
    return { state: state };
  }

  export function matchLoop(
    _ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    dispatcher: MatchDispatcher,
    tick: number,
    state: HubState,
    messages: MatchMessage[],
  ): { state: HubState } {
    var latest: { [userId: string]: string } = {};
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (!message || message.opCode !== OP_POSE || !message.sender || !message.sender.userId) continue;
      if (!state.players[message.sender.userId]) continue;
      latest[message.sender.userId] = messageText(nk, message.data);
    }
    var ids = Object.keys(latest);
    for (var j = 0; j < ids.length; j++) {
      var player = state.players[ids[j]];
      if (player) applyPose(player, latest[ids[j]]);
    }
    if (tick % RELIC_REFRESH_TICKS === 0) {
      var present = Object.keys(state.players);
      for (var k = 0; k < present.length; k++) {
        state.players[present[k]].relics = lookupRelics(nk, logger, present[k]);
      }
    }
    try {
      HubBoards.onHubTick(nk, logger, tick);
    } catch (e) {
      logger.warn("hub meta tick failed " + errorText(e));
    }
    recount(state);
    if (state.count > 0) broadcast(dispatcher, tick, state);
    return { state: state };
  }

  export function matchTerminate(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _dispatcher: MatchDispatcher,
    _tick: number,
    state: HubState,
    _graceSeconds: number,
  ): { state: HubState } {
    return { state: state };
  }

  export function matchSignal(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _dispatcher: MatchDispatcher,
    _tick: number,
    state: HubState,
    data: string,
  ): { state: HubState; data: string } {
    return { state: state, data: data };
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
