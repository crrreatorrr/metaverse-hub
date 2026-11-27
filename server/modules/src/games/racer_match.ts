// Sproto Racer online races on Nakama. The race itself is the vendored match host
// (vendor/racer-sim.js, Sproto-Racer src/net/match-host.js): it owns the one true simulation,
// takes each player's inputs a few ticks ahead, steps once per loop and tells every client which
// inputs it used. This file passes presences and messages through to it and decides who may join.
//
// The host object stays LIVE in a let binding for the whole match. Each match runs in its own
// goja VM, so the binding lives exactly as long as the match. Nakama exports the match state to Go
// and back on every callback, 60 times a second, so the state is a dozen scalars; presences,
// names and metrics stay beside the host in the VM. There is no crash-recovery copy: if the VM
// dies the race is gone, and a race has nothing to refund.
//
// One host.tick() per loop, never a catch-up loop: clients pace themselves from the tick numbers
// the host sends. Nakama queues the loops a slow tick delays (match.call_queue_size, 256) and
// closes the match if that queue fills.
//
// What the hub adds to the host:
// - Only a sproto-racer game session joins. One account, one socket: a second socket takes over
//   and the first is kicked. Messages from a socket that is not the account's current one are dropped.
// - Names come from the hub account (HubMatch.cleanName), not from the client's HELLO.
// - A private room admits its host and the accounts that used the code (racer.room_join signals
//   "admit:<uid>"). Its label is never open and never carries the code.
// - Nobody new joins once the race is set up. An account that holds a seat may always come back;
//   while it is away the AI drives its kart.
// - A quick-race room keeps a place for each matched account for 15 s and does not start on
//   READY until that many players are in. It starts regardless 45 s after its first player.
// - A lobby nobody is in, a lobby that never starts, a race everybody left and a race nobody
//   finishes within 15 minutes all close.
// - A room holds one of twelve storage slots from before it is created until it closes, so the
//   node limit holds even while a new room is not yet listed.
//
// Every message goes to an explicit list of presences. Nothing is broadcast with an empty list,
// which Nakama would send to the whole match.

namespace RacerRooms {
  export var COLLECTION = "sproto_racer";
  export var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
  export var COUNT_CACHE_S = 3;
  var COUNT_CACHE = "racer:counts";

  function read(nk: nkruntime.Nakama, key: string): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: SYSTEM_USER }]);
    return rows && rows.length ? rows[0] : null;
  }

  function write(nk: nkruntime.Nakama, key: string, value: { [key: string]: unknown }, version?: string): void {
    var obj: nkruntime.StorageWrite = {
      collection: COLLECTION,
      key: key,
      userId: SYSTEM_USER,
      value: value,
      permissionRead: 0,
      permissionWrite: 0,
    };
    if (version !== undefined) obj.version = version;
    nk.storageWrite([obj]);
  }

  function drop(nk: nkruntime.Nakama, key: string): void {
    try {
      nk.storageDelete([{ collection: COLLECTION, key: key, userId: SYSTEM_USER }]);
    } catch (e) {
      /* already gone */
    }
  }

  /** True when the code was free and is now held. */
  export function reserveCode(nk: nkruntime.Nakama, code: string): boolean {
    try {
      write(nk, "code:" + code, { matchId: "", expiresAt: 0 }, "*");
      return true;
    } catch (e) {
      return false;
    }
  }

  export function bindCode(nk: nkruntime.Nakama, code: string, matchId: string, expiresAt: number): void {
    write(nk, "code:" + code, { matchId: matchId, expiresAt: expiresAt });
  }

  export function releaseCode(nk: nkruntime.Nakama, code: string): void {
    if (code) drop(nk, "code:" + code);
  }

  /** The match a code leads to, or "". A code that ran out or whose match is gone is dropped. */
  export function lookupCode(nk: nkruntime.Nakama, code: string): string {
    var row = read(nk, "code:" + code);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    var expires = Number(row.value["expiresAt"] || 0);
    if (!id || !expires || Date.now() > expires || !nk.matchGet(id)) {
      drop(nk, "code:" + code);
      return "";
    }
    return id;
  }

  function slotKeys(): nkruntime.StorageReadRequest[] {
    var keys: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < RacerProto.MAX_ROOMS; i++) keys.push({ collection: COLLECTION, key: "slot:" + i, userId: SYSTEM_USER });
    return keys;
  }

  /** The slot rows that exist, by slot number. */
  function slotRows(nk: nkruntime.Nakama): { [slot: string]: nkruntime.StorageObject } {
    var out: { [slot: string]: nkruntime.StorageObject } = {};
    var rows = nk.storageRead(slotKeys()) || [];
    for (var i = 0; i < rows.length; i++) out[rows[i].key.slice("slot:".length)] = rows[i];
    return out;
  }

  /** A slot is taken while its match exists, and for a few seconds after it was claimed or bound. */
  function slotTaken(nk: nkruntime.Nakama, row: nkruntime.StorageObject, now: number): boolean {
    var age = now - Number(row.value["at"] || 0);
    if (age < RacerProto.SLOT_FRESH_MS) return true;
    var id = String(row.value["matchId"] || "");
    return !!id && !!nk.matchGet(id);
  }

  /**
   * Takes one of the node's room slots, or returns -1 when all are taken. The write only succeeds
   * if nobody else took the slot first, so two requests at the same moment cannot share one.
   * A slot whose room is gone (a crash, a restart) is taken over.
   */
  export function claimSlot(nk: nkruntime.Nakama): number {
    var now = Date.now();
    var rows = slotRows(nk);
    for (var i = 0; i < RacerProto.MAX_ROOMS; i++) {
      var row = rows[String(i)];
      if (row && slotTaken(nk, row, now)) continue;
      try {
        write(nk, "slot:" + i, { matchId: "", at: now }, row ? row.version : "*");
        return i;
      } catch (e) {
        /* someone else took this one; try the next */
      }
    }
    return -1;
  }

  export function bindSlot(nk: nkruntime.Nakama, slot: number, matchId: string): void {
    if (slot >= 0) write(nk, "slot:" + slot, { matchId: matchId, at: Date.now() });
  }

  /** Frees a slot. With a match id, only while the slot still names that match. */
  export function releaseSlot(nk: nkruntime.Nakama, slot: number, matchId: string): void {
    if (!(slot >= 0)) return;
    if (matchId) {
      var row = read(nk, "slot:" + slot);
      if (!row || String(row.value["matchId"] || "") !== matchId) return;
    }
    drop(nk, "slot:" + slot);
  }

  /** Slots nobody holds right now. A reading, not a reservation. */
  export function freeSlots(nk: nkruntime.Nakama): number {
    var now = Date.now();
    var rows = slotRows(nk);
    var free = 0;
    for (var i = 0; i < RacerProto.MAX_ROOMS; i++) {
      var row = rows[String(i)];
      if (!row || !slotTaken(nk, row, now)) free++;
    }
    return free;
  }

  /** A fixed window per account and node: room creation, and code lookups (so codes cannot be guessed in bulk). */
  export function rateAllow(nk: nkruntime.Nakama, userId: string, kind: string): boolean {
    var windowMs = kind === "create" ? RacerProto.CREATE_WINDOW_MS : RacerProto.LOOKUP_WINDOW_MS;
    var max = kind === "create" ? RacerProto.CREATE_MAX : RacerProto.LOOKUP_MAX;
    var key = "racer:" + kind + ":" + userId;
    var now = Date.now();
    var bucket = { t: now, n: 0 };
    var raw = nk.localcacheGet(key);
    if (typeof raw === "string" && raw) {
      try {
        var parsed = JSON.parse(raw) as { t?: number; n?: number };
        if (parsed && typeof parsed.t === "number" && typeof parsed.n === "number") bucket = { t: parsed.t, n: parsed.n };
      } catch (e) {
        bucket = { t: now, n: 0 };
      }
    }
    if (now - bucket.t >= windowMs) {
      bucket.t = now;
      bucket.n = 0;
    }
    bucket.n++;
    nk.localcachePut(key, JSON.stringify(bucket), Math.ceil(windowMs / 1000) + 2);
    return bucket.n <= max;
  }

  /** Rooms alive and players in them. A room shows up about a second after it is created (Contract C7). */
  export function census(nk: nkruntime.Nakama): { rooms: number; players: number } {
    var listed = nk.matchList(100, true, null, null, null, "+label.kind:" + RacerProto.KIND) || [];
    var players = 0;
    for (var i = 0; i < listed.length; i++) players += listed[i].size || 0;
    return { rooms: listed.length, players: players };
  }

  /** The census, recomputed at most once per COUNT_CACHE_S on this node. */
  export function cachedCensus(nk: nkruntime.Nakama): { rooms: number; players: number; ageMs: number } {
    var now = Date.now();
    var raw = nk.localcacheGet(COUNT_CACHE);
    if (typeof raw === "string" && raw) {
      try {
        var hit = JSON.parse(raw) as { rooms?: number; players?: number; at?: number };
        if (hit && typeof hit.at === "number" && now - hit.at >= 0 && now - hit.at < COUNT_CACHE_S * 1000) {
          return { rooms: Number(hit.rooms) || 0, players: Number(hit.players) || 0, ageMs: now - hit.at };
        }
      } catch (e) {
        /* recompute */
      }
    }
    var fresh = census(nk);
    nk.localcachePut(COUNT_CACHE, JSON.stringify({ rooms: fresh.rooms, players: fresh.players, at: now }), COUNT_CACHE_S + 2);
    return { rooms: fresh.rooms, players: fresh.players, ageMs: 0 };
  }
}

namespace RacerMatch {
  /** Everything a match keeps besides its state. One per match VM, made in matchInit. */
  interface Room {
    host: RacerMatchHost;
    /** The dispatcher of the callback that is running. The host's sends go through it. */
    d: nkruntime.MatchDispatcher | null;
    /** The current socket of each account in the match. */
    present: { [userId: string]: nkruntime.Presence };
    /** `present` as a list, rebuilt when it changes. */
    everyone: nkruntime.Presence[] | null;
    names: { [userId: string]: string };
    /** Places kept for accounts that are on their way (an accepted join, a matched ticket), by the loop the hold ends on. */
    joining: { [userId: string]: number };
    /** Private rooms: accounts that used the code. */
    admitted: { [userId: string]: number };
    loops: number;
    /** Loops in a row with nobody present. */
    emptyLoops: number;
    /** The loop a public lobby first had a player in, or 0. */
    lobbySince: number;
    /** The loop the race finished on, or 0. */
    finishedLoop: number;
    /** Messages with nobody to send them to, or from a socket that is not the account's current one. */
    dropped: number;
    hostErrors: number;
    samples: number[];
    sampleAt: number;
    sampleCount: number;
    sampleSumMs: number;
    sampleMaxMs: number;
    overBudget: number;
  }

  let rooms: { [matchId: string]: Room } | null = null;

  function roomBag(): { [matchId: string]: Room } {
    if (!rooms) rooms = {};
    return rooms;
  }

  export interface State {
    /** Why this match cannot run (the bundle is not the pinned one), or "". */
    broken: string;
    privateRoom: boolean;
    code: string;
    /** The account that created a private room. */
    host: string;
    /** The node slot this room holds (RacerRooms.claimSlot), or -1. */
    slot: number;
    courseId: string;
    laps: number;
    maxHumans: number;
    /** The host's phase: lobby, starting, race or finished. */
    phase: string;
    players: number;
    open: boolean;
    label: string;
    ended: boolean;
    endReason: string;
    /** Set by matchTerminate. Every later loop only cleans up and returns null. */
    terminated: boolean;
    cleaned: boolean;
  }

  function fail(code: string, message: string): string {
    return HubRpc.fail(code, message);
  }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function gameSession(ctx: nkruntime.Context): boolean {
    var vars = ctx.vars || null;
    if (!ctx.userId || !UUID.test(ctx.userId)) return false;
    if (!vars || vars["scope"] !== "game" || vars["game"] !== RacerProto.GAME_ID) return false;
    return !!vars["sid"] && UUID.test(vars["sid"]);
  }

  function gate(ctx: nkruntime.Context): string | null {
    return gameSession(ctx) ? null : fail("wrong_scope", "Game session required");
  }

  function isObj(value: unknown): value is { [key: string]: unknown } {
    return typeof value === "object" && value !== null && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function bodyOf(payload: string): { [key: string]: unknown } | null {
    if (payload && payload.length > RacerProto.MAX_JSON) return null;
    if (!payload) return {};
    try {
      var data = JSON.parse(payload) as unknown;
      return isObj(data) ? data : null;
    } catch (e) {
      return null;
    }
  }

  /** "" when the request names no version or the pinned ones; otherwise the error code. */
  function versionError(req: { [key: string]: unknown }): string {
    if (req["version"] !== undefined && String(req["version"]) !== RacerProto.NET_VERSION) return "version_mismatch";
    if (req["simVersion"] !== undefined && String(req["simVersion"]) !== RacerProto.SIM_VERSION) return "sim_version_mismatch";
    return "";
  }

  function count(bag: { [key: string]: unknown }): number {
    var n = 0;
    for (var key in bag) if (Object.prototype.hasOwnProperty.call(bag, key)) n++;
    return n;
  }

  function everyone(room: Room): nkruntime.Presence[] {
    if (room.everyone) return room.everyone;
    var to: nkruntime.Presence[] = [];
    for (var id in room.present) if (Object.prototype.hasOwnProperty.call(room.present, id)) to.push(room.present[id]);
    room.everyone = to;
    return to;
  }

  function sendTo(room: Room, userId: string, op: number, data: Uint8Array | string): void {
    var presence = room.present[userId];
    if (!room.d || !presence) {
      room.dropped += 1;
      return;
    }
    room.d.broadcastMessage(op, RacerProto.payloadOf(data), [presence], null, true);
  }

  function sendAll(room: Room, op: number, data: Uint8Array | string): void {
    var to = everyone(room);
    if (!room.d || !to.length) {
      room.dropped += 1;
      return;
    }
    room.d.broadcastMessage(op, RacerProto.payloadOf(data), to, null, true);
  }

  function makeRoom(sim: RacerSimApi, state: State, seed: number, minPlayers: number): Room {
    var room: Room = {
      host: null as unknown as RacerMatchHost,
      d: null,
      present: {},
      everyone: null,
      names: {},
      joining: {},
      admitted: {},
      loops: 0,
      emptyLoops: 0,
      lobbySince: 0,
      finishedLoop: 0,
      dropped: 0,
      hostErrors: 0,
      samples: [],
      sampleAt: 0,
      sampleCount: 0,
      sampleSumMs: 0,
      sampleMaxMs: 0,
      overBudget: 0,
    };
    room.host = sim.createMatchHost({
      courseId: state.courseId,
      seed: seed,
      laps: state.laps,
      seatCount: RacerProto.SEATS,
      maxHumans: state.maxHumans,
      minPlayers: minPlayers,
      allowLateJoin: false,
      send: function (playerId: string, op: number, data: Uint8Array | string): void {
        sendTo(room, playerId, op, data);
      },
      broadcast: function (op: number, data: Uint8Array | string): void {
        sendAll(room, op, data);
      },
      onError: function (): void {
        room.hostErrors += 1;
      },
    });
    return room;
  }

  function blank(): State {
    return {
      broken: "",
      privateRoom: false,
      code: "",
      host: "",
      slot: -1,
      courseId: "",
      laps: RacerProto.LAPS,
      maxHumans: RacerProto.MAX_HUMANS,
      phase: "lobby",
      players: 0,
      open: false,
      label: "",
      ended: false,
      endReason: "",
      terminated: false,
      cleaned: false,
    };
  }

  function ownsSeat(room: Room, userId: string): boolean {
    if (room.host.phase === "lobby") return false;
    var seats = room.host.seats;
    for (var i = 0; i < seats.length; i++) if (seats[i].owner === userId) return true;
    return false;
  }

  /**
   * Mirror the host into the state and publish the label when it changed. This runs on every
   * loop, so the label text is only built when something it shows has moved.
   */
  function refresh(d: nkruntime.MatchDispatcher | null, state: State, room: Room | null): void {
    var phase = state.phase;
    var players = 0;
    var open = false;
    if (room) {
      phase = room.host.phase;
      players = count(room.present);
      open = !state.broken && !state.ended && !state.terminated && phase === "lobby" && players + count(room.joining) < state.maxHumans;
    }
    if (state.label && phase === state.phase && players === state.players && open === state.open) return;
    state.phase = phase;
    state.players = players;
    state.open = open;
    var label = RacerProto.labelFor(state);
    if (label === state.label) return;
    state.label = label;
    if (d) d.matchLabelUpdate(label);
  }

  function cleanup(nk: nkruntime.Nakama, state: State, matchId: string): void {
    if (state.cleaned) return;
    state.cleaned = true;
    if (state.code) RacerRooms.releaseCode(nk, state.code);
    RacerRooms.releaseSlot(nk, state.slot, matchId);
    if (rooms) delete rooms[matchId];
  }

  /**
   * Stop: the next loop returns null. Everyone still here is told why, except after a finished
   * race, whose players already have the result.
   */
  function endMatch(d: nkruntime.MatchDispatcher, state: State, room: Room | null, reason: string): void {
    if (state.ended) return;
    state.ended = true;
    state.endReason = reason;
    if (room && reason !== "finished" && everyone(room).length) {
      room.d = d;
      sendAll(room, RacerProto.OP_ERROR, JSON.stringify({ error: reason }));
    }
    refresh(d, state, room);
  }

  /**
   * HELLO carries the name the other players will see. The client's own text is replaced with
   * the hub account's cleaned name; everything else in the message reaches the host as it came.
   * A HELLO that is too long or is not a JSON object is not forwarded at all: the host is handed
   * nothing and answers bad_hello, so no name the hub did not write can reach the lobby.
   */
  function helloOf(nk: nkruntime.Nakama, room: Room, userId: string, data: string | ArrayBuffer | null): Uint8Array | string {
    var bytes = RacerProto.bytesOf(data);
    if (!bytes.length || bytes.length > RacerProto.MAX_JSON) return new Uint8Array(0);
    try {
      var parsed = JSON.parse(nk.binaryToString(data as ArrayBuffer)) as unknown;
      if (!isObj(parsed)) return new Uint8Array(0);
      parsed["name"] = room.names[userId] || "Racer";
      return JSON.stringify(parsed);
    } catch (e) {
      return new Uint8Array(0);
    }
  }

  function sample(room: Room, started: number): void {
    var ms = Date.now() - started;
    if (!(ms >= 0)) ms = 0;
    if (room.samples.length < RacerProto.SAMPLE_CAP) room.samples.push(ms);
    else room.samples[room.sampleAt] = ms;
    room.sampleAt = (room.sampleAt + 1) % RacerProto.SAMPLE_CAP;
    room.sampleCount += 1;
    room.sampleSumMs += ms;
    if (ms > room.sampleMaxMs) room.sampleMaxMs = ms;
    if (ms > RacerProto.BUDGET_MS) room.overBudget += 1;
  }

  function percentile(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    var at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[at];
  }

  function metricsOf(state: State, room: Room | null): { [key: string]: unknown } {
    var out: { [key: string]: unknown } = {
      phase: state.phase,
      players: state.players,
      courseId: state.courseId,
      privateRoom: state.privateRoom,
      ended: state.ended,
      endReason: state.endReason,
      broken: state.broken,
      budgetMs: RacerProto.BUDGET_MS,
    };
    if (!room) return out;
    var recent = room.samples.slice();
    recent.sort(function (a, b) { return a - b; });
    out["loops"] = room.loops;
    out["raceTick"] = room.host.raceTick;
    out["loopMs"] = {
      // Date.now() counts whole milliseconds, so the mean over many loops is the figure to read.
      count: room.sampleCount,
      mean: room.sampleCount ? Math.round((room.sampleSumMs / room.sampleCount) * 1000) / 1000 : 0,
      max: room.sampleMaxMs,
      overBudget: room.overBudget,
      recent: recent.length,
      recentP50: percentile(recent, 0.5),
      recentP95: percentile(recent, 0.95),
      recentP99: percentile(recent, 0.99),
    };
    out["dropped"] = room.dropped;
    out["hostErrors"] = room.hostErrors;
    var stats = room.host.stats;
    var copy: { [key: string]: number } = {};
    for (var key in stats) if (Object.prototype.hasOwnProperty.call(stats, key)) copy[key] = (stats as unknown as { [key: string]: number })[key];
    out["host"] = copy;
    return out;
  }

  /** The timers the host does not have. Returns the reason the match should end, or "". */
  function clocks(state: State, room: Room, logger: nkruntime.Logger, matchId: string): string {
    var rate = RacerProto.TICK_RATE;
    for (var id in room.joining) {
      if (Object.prototype.hasOwnProperty.call(room.joining, id) && room.loops > room.joining[id]) delete room.joining[id];
    }
    var phase = room.host.phase;
    room.emptyLoops = count(room.present) === 0 ? room.emptyLoops + 1 : 0;
    if (phase === "lobby") {
      if (room.emptyLoops > RacerProto.EMPTY_LOBBY_S * rate) return "empty";
      if (room.loops > RacerProto.LOBBY_MAX_S * rate) return "lobby_timeout";
      // Looked at twice a second: the lobby list is a fresh array each time.
      if (!state.privateRoom && room.loops % 30 === 0) {
        if (!room.host.lobby().length) room.lobbySince = 0;
        else if (!room.lobbySince) room.lobbySince = room.loops;
        else if (room.loops - room.lobbySince >= RacerProto.PUBLIC_START_S * rate) room.host.start();
      }
      return "";
    }
    if (phase === "finished") {
      if (!room.finishedLoop) {
        room.finishedLoop = room.loops;
        var results = room.host.results;
        logger.info("sproto_racer finished " + matchId + " tick " + (results ? results.tick : -1) + " hash " + (results ? results.hash : ""));
      }
      if (room.loops - room.finishedLoop > RacerProto.LINGER_S * rate) return "finished";
      return "";
    }
    if (room.emptyLoops > RacerProto.ABANDON_S * rate) return "abandoned";
    // The host ends a race 25 s after the first kart finishes. If no kart ever does, this does.
    if (room.host.raceTick > RacerProto.MAX_RACE_S * rate) return "race_timeout";
    return "";
  }

  /** The matched accounts a quick-race room was made for: distinct uuids, at most a full room. */
  function rosterOf(raw: unknown): string[] {
    var out: string[] = [];
    if (typeof raw !== "string" || !raw) return out;
    try {
      var parsed = JSON.parse(raw) as unknown;
      if (Object.prototype.toString.call(parsed) !== "[object Array]") return out;
      var list = parsed as unknown[];
      for (var i = 0; i < list.length && out.length < RacerProto.MAX_HUMANS; i++) {
        var id = String(list[i] || "");
        if (UUID.test(id) && out.indexOf(id) < 0) out.push(id);
      }
    } catch (e) {
      return [];
    }
    return out;
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (ctx, logger, nk, params) {
      var state = blank();
      var matchId = ctx.matchId || "";
      state.privateRoom = params["private"] === "1";
      state.code = typeof params["code"] === "string" ? (params["code"] as string) : "";
      state.host = typeof params["host"] === "string" ? (params["host"] as string) : "";
      state.maxHumans = RacerProto.clampHumans(params["maxSeats"]);
      var slot = parseInt(String(params["slot"]), 10);
      state.slot = slot >= 0 && slot < RacerProto.MAX_ROOMS ? slot : -1;
      var roster = rosterOf(params["roster"]);
      var mismatch = RacerProto.verifyRuntime();
      var sim = RacerProto.api();
      if (mismatch || !sim) {
        state.broken = mismatch || "sim_missing";
        logger.error("sproto_racer pin " + state.broken);
      } else {
        state.courseId = RacerProto.knownCourse(params["courseId"]) ? (params["courseId"] as string) : RacerProto.randomCourse(nk);
        try {
          // A matched group races together: READY starts the race only once that many are in.
          var made = makeRoom(sim, state, RacerProto.serverSeed(nk), roster.length > 1 ? roster.length : 1);
          for (var r = 0; r < roster.length; r++) made.joining[roster[r]] = RacerProto.ROSTER_HOLD_S * RacerProto.TICK_RATE;
          roomBag()[matchId] = made;
        } catch (e) {
          state.broken = "host_failed";
          logger.error("sproto_racer host " + String(e).slice(0, 200));
        }
      }
      refresh(null, state, state.broken ? null : roomBag()[matchId] || null);
      logger.info("sproto_racer init " + matchId + " " + state.courseId + (state.privateRoom ? " private" : " public"));
      return { state: state, tickRate: RacerProto.TICK_RATE, label: state.label };
    },

    matchJoinAttempt: function (ctx, _logger, _nk, d, _tick, state, presence, metadata) {
      if (!presence || !presence.userId || !presence.sessionId) return { state: state, accept: false, rejectMessage: "malformed" };
      if (!gameSession(ctx)) return { state: state, accept: false, rejectMessage: "wrong_scope" };
      if (state.broken) return { state: state, accept: false, rejectMessage: "version" };
      var room = roomBag()[ctx.matchId || ""];
      if (!room || state.ended || state.terminated || state.cleaned) return { state: state, accept: false, rejectMessage: "ended" };
      var userId = presence.userId;
      // An account that is here, or that holds a seat, may always come back (also to a finished race).
      if (room.present[userId] || ownsSeat(room, userId)) return { state: state, accept: true };
      if (room.host.phase !== "lobby") return { state: state, accept: false, rejectMessage: "race_started" };
      var wrong = isObj(metadata) ? versionError(metadata) : "";
      if (wrong) return { state: state, accept: false, rejectMessage: wrong };
      if (state.privateRoom && userId !== state.host && !room.admitted[userId]) {
        return { state: state, accept: false, rejectMessage: "not_admitted" };
      }
      if (!room.joining[userId]) {
        if (count(room.present) + count(room.joining) >= state.maxHumans) return { state: state, accept: false, rejectMessage: "match_full" };
        room.joining[userId] = room.loops + RacerProto.JOINING_S * RacerProto.TICK_RATE;
      }
      refresh(d, state, room);
      return { state: state, accept: true };
    },

    matchJoin: function (ctx, _logger, _nk, d, _tick, state, presences) {
      var room = roomBag()[ctx.matchId || ""];
      if (!room) return { state: state };
      room.d = d;
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var userId = presence.userId;
        delete room.joining[userId];
        var old = room.present[userId];
        if (old && old.sessionId !== presence.sessionId) {
          try {
            d.matchKick([old]);
          } catch (e) {
            /* the previous socket may already be gone */
          }
        }
        // The whole presence, node included: routed messages go to exactly this socket.
        room.present[userId] = { userId: userId, sessionId: presence.sessionId, username: presence.username, node: presence.node };
        room.everyone = null;
        room.names[userId] = HubMatch.cleanName(presence.username, RacerProto.NAME_MAX) || "Racer";
        room.host.join(userId, { name: room.names[userId] });
      }
      refresh(d, state, room);
      return { state: state };
    },

    matchLeave: function (ctx, _logger, _nk, d, _tick, state, presences) {
      var room = roomBag()[ctx.matchId || ""];
      if (!room) return { state: state };
      room.d = d;
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var current = room.present[presence.userId];
        // A socket that was replaced leaves after its successor joined: the account is still here.
        if (!current || current.sessionId !== presence.sessionId) continue;
        delete room.present[presence.userId];
        room.everyone = null;
        // In a race the seat stays this account's and the AI drives it until the account is back.
        room.host.leave(presence.userId);
      }
      refresh(d, state, room);
      return { state: state };
    },

    matchLoop: function (ctx, logger, nk, d, _tick, state, messages) {
      var started = Date.now();
      var matchId = ctx.matchId || "";
      var room = roomBag()[matchId];
      if (state.terminated || state.broken || state.ended || !room) {
        cleanup(nk, state, matchId);
        return null;
      }
      room.d = d;
      room.loops += 1;
      try {
        for (var i = 0; i < messages.length; i++) {
          var message = messages[i];
          var sender = message.sender;
          var current = sender ? room.present[sender.userId] : null;
          if (!current || current.sessionId !== sender.sessionId) {
            room.dropped += 1;
            continue;
          }
          var data = message.opCode === RacerProto.OP_HELLO ? helloOf(nk, room, sender.userId, message.data) : RacerProto.bytesOf(message.data);
          room.host.receive(sender.userId, message.opCode, data);
          // RESULT went out once, when the race ended. A player who was away then gets it with the welcome back.
          if (message.opCode === RacerProto.OP_HELLO && room.host.phase === "finished" && room.host.results && ownsSeat(room, sender.userId)) {
            sendTo(room, sender.userId, RacerProto.OP_RESULT, JSON.stringify(room.host.results));
          }
        }
        room.host.tick();
        var over = clocks(state, room, logger, matchId);
        if (over) {
          if (over !== "finished") logger.info("sproto_racer closed " + matchId + " " + over);
          endMatch(d, state, room, over);
        }
      } catch (e) {
        logger.error("sproto_racer host failed " + matchId + " " + String(e).slice(0, 200));
        endMatch(d, state, room, "server_error");
      }
      refresh(d, state, room);
      sample(room, started);
      return { state: state };
    },

    matchTerminate: function (ctx, logger, nk, d, _tick, state, _grace) {
      var matchId = ctx.matchId || "";
      var room = roomBag()[matchId] || null;
      endMatch(d, state, room, "server_shutdown");
      state.terminated = true;
      cleanup(nk, state, matchId);
      logger.info("sproto_racer terminate " + matchId);
      return { state: state };
    },

    matchSignal: function (ctx, _logger, _nk, _d, _tick, state, data) {
      var room = roomBag()[ctx.matchId || ""] || null;
      if (data.indexOf("admit:") === 0) {
        // Server-only (nk.matchSignal): racer.room_join admits the account that used the code.
        var uid = data.slice("admit:".length);
        var ok = !!room && state.privateRoom && !state.ended && !state.terminated && UUID.test(uid);
        // After the start only an account that already holds a seat is told yes: it may rejoin.
        if (ok && room && room.host.phase !== "lobby") ok = ownsSeat(room, uid);
        if (ok && room && !room.admitted[uid] && uid !== state.host) {
          if (count(room.admitted) >= RacerProto.MAX_ADMITTED) ok = false;
          else room.admitted[uid] = 1;
        }
        return { state: state, data: JSON.stringify(ok ? { ok: true } : { ok: false, error: "room_closed" }) };
      }
      if (data === "metrics") return { state: state, data: JSON.stringify(metricsOf(state, room)) };
      return { state: state, data: JSON.stringify({ error: "bad_signal" }) };
    },
  };

  function prop(props: { [key: string]: string | number } | null | undefined, key: string): string {
    if (!props || props[key] === undefined || props[key] === null) return "";
    return String(props[key]);
  }

  /** The reason a quick-race ticket is not one of this build's, or "". */
  function ticketError(props: { [key: string]: string | number } | null | undefined): string {
    if (prop(props, "game") !== RacerProto.GAME_ID) return "bad_game";
    if (prop(props, "mode") !== RacerProto.MODE) return "bad_mode";
    if (prop(props, "version") !== RacerProto.NET_VERSION) return "version_mismatch";
    if (prop(props, "simVersion") !== RacerProto.SIM_VERSION) return "sim_version_mismatch";
    var course = prop(props, "courseId");
    if (course && !RacerProto.knownCourse(course)) return "invalid_course";
    return "";
  }

  /**
   * Runs after the hub scope check on MatchmakerAdd. A ticket this server could not turn into a
   * race is refused here, where the client still gets the reason. Other games are ignored.
   */
  export function noteAdd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): void {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId) return;
    var props = add.stringProperties || {};
    if (props["game"] !== RacerProto.GAME_ID) return;
    if (Maint.on(nk)) throw new Error("maintenance");
    if (RacerProto.verifyRuntime()) throw new Error("version_mismatch");
    var wrong = ticketError(props);
    if (wrong) throw new Error(wrong);
    if (!Flags.on(nk, RacerProto.FLAG, ctx.userId, logger)) throw new Error("online_off");
    if (RacerRooms.freeSlots(nk) < 1) throw new Error("busy");
    // A game built for twelve seats asks for up to twelve; a group that size has no room to go to.
    if (typeof add.maxCount !== "number" || add.maxCount > RacerProto.MAX_HUMANS) add.maxCount = RacerProto.MAX_HUMANS;
    if (add.maxCount < RacerProto.MIN_HUMANS) add.maxCount = RacerProto.MIN_HUMANS;
    if (typeof add.minCount !== "number" || add.minCount < RacerProto.MIN_HUMANS) add.minCount = RacerProto.MIN_HUMANS;
    if (add.minCount > add.maxCount) add.minCount = add.maxCount;
  }

  /**
   * One public lobby for a matched group of two to six tickets. The room keeps a place for each
   * of them. The group races the circuit they all asked for, or one the server picks. Nothing is
   * created while the flag is off for any of them, during a deploy drain, or when every room is
   * in use. A group that gets no room is given none by Nakama either; tickets this server cannot
   * serve are refused when they are added (noteAdd), which is where the player is told.
   */
  export function onMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (!matches || matches.length < RacerProto.MIN_HUMANS || matches.length > RacerProto.MAX_HUMANS) return;
    if (RacerProto.verifyRuntime()) return;
    var course = "";
    var roster: string[] = [];
    for (var i = 0; i < matches.length; i++) {
      var entry = matches[i];
      if (!entry || !entry.presence || !entry.presence.userId) return;
      if (ticketError(entry.properties)) return;
      var uid = entry.presence.userId;
      if (!Flags.on(nk, RacerProto.FLAG, uid, logger)) return;
      if (roster.indexOf(uid) < 0) roster.push(uid);
      var wanted = prop(entry.properties, "courseId");
      if (i === 0) course = wanted;
      else if (wanted !== course) course = "";
    }
    if (Maint.on(nk)) return;
    var slot = RacerRooms.claimSlot(nk);
    if (slot < 0) {
      logger.warn("sproto_racer queue refused, every room is in use");
      return;
    }
    var id = "";
    try {
      id = nk.matchCreate(RacerProto.MATCH_NAME, {
        private: "0",
        courseId: course,
        maxSeats: String(RacerProto.MAX_HUMANS),
        slot: String(slot),
        roster: JSON.stringify(roster),
      });
    } catch (e) {
      RacerRooms.releaseSlot(nk, slot, "");
      logger.error("sproto_racer queue " + String(e).slice(0, 200));
      return;
    }
    RacerRooms.bindSlot(nk, slot, id);
    logger.info("sproto_racer queue " + id);
    return id;
  }

  export function rpcVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var mismatch = RacerProto.verifyRuntime();
    if (mismatch) {
      logger.error("sproto_racer pin " + mismatch);
      return fail("version_mismatch", "Simulation pin mismatch");
    }
    return JSON.stringify({
      version: RacerProto.NET_VERSION,
      simVersion: RacerProto.SIM_VERSION,
      bundleSha256: RacerProto.BUNDLE_SHA256,
      commit: RacerProto.COMMIT,
      repo: RacerProto.REPO,
      match: RacerProto.MATCH_NAME,
      mode: RacerProto.MODE,
      tickRate: RacerProto.TICK_RATE,
      seats: RacerProto.SEATS,
      maxSeats: RacerProto.MAX_HUMANS,
      laps: RacerProto.LAPS,
      courses: RacerProto.courseIds(),
      // Whether this account may open a new room or queue. A room that exists is not affected.
      enabled: Flags.on(nk, RacerProto.FLAG, ctx.userId || "", logger),
    });
  }

  export function rpcRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var userId = ctx.userId || "";
    if (RacerProto.verifyRuntime()) return fail("version_mismatch", "Simulation pin mismatch");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var wrong = versionError(req);
    if (wrong) return fail(wrong, "Version mismatch");
    if (req["mode"] !== undefined && req["mode"] !== RacerProto.MODE) return fail("bad_mode", "Only races are online");
    if (req["courseId"] !== undefined && !RacerProto.knownCourse(req["courseId"])) return fail("invalid_course", "Unknown circuit");
    if (!Flags.on(nk, RacerProto.FLAG, userId, logger)) return fail("online_off", "Online races are off");
    var closed = Maint.deny(nk);
    if (closed) return closed;
    if (!RacerRooms.rateAllow(nk, userId, "create")) return fail("rate_limited", "Too many rooms");
    var slot = RacerRooms.claimSlot(nk);
    if (slot < 0) return fail("busy", "Every room is in use");
    var code = "";
    for (var attempt = 0; attempt < 5 && !code; attempt++) {
      var candidate = RacerProto.roomCode(nk);
      if (candidate && RacerRooms.reserveCode(nk, candidate)) code = candidate;
    }
    if (!code) {
      RacerRooms.releaseSlot(nk, slot, "");
      return fail("room_code_busy", "Could not allocate a room code");
    }
    var maxSeats = RacerProto.clampHumans(req["maxSeats"]);
    var courseId = typeof req["courseId"] === "string" ? (req["courseId"] as string) : "";
    var matchId = "";
    try {
      matchId = nk.matchCreate(RacerProto.MATCH_NAME, { private: "1", code: code, host: userId, courseId: courseId, maxSeats: String(maxSeats), slot: String(slot) });
    } catch (e) {
      RacerRooms.releaseCode(nk, code);
      RacerRooms.releaseSlot(nk, slot, "");
      logger.error("sproto_racer room " + String(e).slice(0, 200));
      return fail("room_failed", "Could not create the room");
    }
    RacerRooms.bindSlot(nk, slot, matchId);
    RacerRooms.bindCode(nk, code, matchId, Date.now() + RacerProto.CODE_TTL_S * 1000);
    logger.info("sproto_racer room " + matchId);
    return JSON.stringify({ matchId: matchId, code: code, version: RacerProto.NET_VERSION, simVersion: RacerProto.SIM_VERSION, maxSeats: maxSeats });
  }

  export function rpcRoomJoin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var userId = ctx.userId || "";
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var wrong = versionError(req);
    if (wrong) return fail(wrong, "Version mismatch");
    if (!RacerRooms.rateAllow(nk, userId, "lookup")) return fail("rate_limited", "Too many lookups");
    var code = RacerProto.normalizeCode(req["code"]);
    if (!code) return fail("room_not_found", "Room not found");
    var matchId = RacerRooms.lookupCode(nk, code);
    if (!matchId) return fail("room_not_found", "Room not found");
    // The code is the invitation: admit this account. Finding the match id is not enough to join.
    try {
      var admitted = JSON.parse(nk.matchSignal(matchId, "admit:" + userId) || "{}") as { ok?: boolean };
      if (!admitted.ok) return fail("room_not_found", "Room not found");
    } catch (e) {
      return fail("room_not_found", "Room not found");
    }
    return JSON.stringify({ matchId: matchId, code: code, version: RacerProto.NET_VERSION, simVersion: RacerProto.SIM_VERSION });
  }

  /** Read-only. Players in rooms of this game, recomputed at most every few seconds. */
  export function rpcOnlineCount(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var seen = RacerRooms.cachedCensus(nk);
    return JSON.stringify({ count: seen.players, rooms: seen.rooms, ageMs: seen.ageMs });
  }

  /** Loop times and host counters of one room. The http key only (no user id). */
  export function rpcMetrics(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (ctx.userId) return fail("unauthorized", "Server only");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var id = String(req["matchId"] || "");
    if (!id || id.length > 128) return fail("match_missing", "No match");
    // Told apart by the label: other matches answer a "metrics" signal with their own numbers.
    var found = nk.matchGet(id);
    if (!found || String(found.label || "").indexOf('"kind":"' + RacerProto.KIND + '"') < 0) return fail("match_missing", "No match");
    try {
      return nk.matchSignal(id, "metrics") || "{}";
    } catch (e) {
      return fail("match_missing", "No match");
    }
  }
}

var racerPrevMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd = HubRt.beforeMatchmakerAdd;
(HubRt as { beforeMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd }).beforeMatchmakerAdd = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  var out = racerPrevMatchmakerAdd(ctx, logger, nk, envelope);
  RacerMatch.noteAdd(ctx, logger, nk, out);
  return out;
};

function racerMatchmakerMatched(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
  return RacerMatch.onMatched(ctx, logger, nk, matches);
}
function sprotoRacerInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return RacerMatch.handler.matchInit(ctx, logger, nk, params);
}
function sprotoRacerJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return RacerMatch.handler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function sprotoRacerJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, presences: nkruntime.Presence[]) {
  return RacerMatch.handler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function sprotoRacerLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, presences: nkruntime.Presence[]) {
  return RacerMatch.handler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function sprotoRacerLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, messages: nkruntime.MatchMessage[]) {
  return RacerMatch.handler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function sprotoRacerTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, grace: number) {
  return RacerMatch.handler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function sprotoRacerSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: RacerMatch.State, data: string) {
  return RacerMatch.handler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
function rpcRacerVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return RacerMatch.rpcVersion(ctx, logger, nk, payload);
}
function rpcRacerRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return RacerMatch.rpcRoomCreate(ctx, logger, nk, payload);
}
function rpcRacerRoomJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return RacerMatch.rpcRoomJoin(ctx, logger, nk, payload);
}
function rpcRacerOnlineCount(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return RacerMatch.rpcOnlineCount(ctx, logger, nk, payload);
}
function rpcRacerMetrics(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return RacerMatch.rpcMetrics(ctx, logger, nk, payload);
}
