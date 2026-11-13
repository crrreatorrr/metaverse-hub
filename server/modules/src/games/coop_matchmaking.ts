// Quick queue, private room codes, and resume claims for Sproto Coop Battle.
// Codes are locators. Joining still requires a sproto-coop-battle game session.
// Storage is server-only (permission 0). Nothing here writes a Ticket or a score.

namespace CoopMm {
  export var COLLECTION = "sproto_coop";
  export var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  function read(nk: nkruntime.Nakama, key: string, userId: string): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: userId }]);
    return rows && rows.length ? rows[0] : null;
  }

  function write(nk: nkruntime.Nakama, key: string, userId: string, value: { [key: string]: unknown }, version?: string): void {
    var obj: nkruntime.StorageWrite = {
      collection: COLLECTION,
      key: key,
      userId: userId,
      value: value,
      permissionRead: 0,
      permissionWrite: 0,
    };
    if (version !== undefined) obj.version = version;
    nk.storageWrite([obj]);
  }

  function drop(nk: nkruntime.Nakama, key: string, userId: string): void {
    try {
      nk.storageDelete([{ collection: COLLECTION, key: key, userId: userId }]);
    } catch (e) {
      /* already gone */
    }
  }

  /** Missing stream lookup counts as live, so a second ticket is rejected. */
  function sessionLive(nk: nkruntime.Nakama, userId: string, sessionId: string): boolean {
    if (!sessionId) return false;
    var probe = (nk as nkruntime.Nakama & {
      streamUserGet?(userId: string, sessionId: string, stream: { mode: number; subject: string }): { [key: string]: unknown } | null;
    }).streamUserGet;
    if (typeof probe !== "function") return true;
    try {
      return probe(userId, sessionId, { mode: 0, subject: userId }) != null;
    } catch (e) {
      return true;
    }
  }

  export function liveMatch(nk: nkruntime.Nakama, userId: string): string {
    if (!userId) return "";
    var row = read(nk, "live", userId);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    if (id && nk.matchGet(id)) return id;
    drop(nk, "live", userId);
    return "";
  }

  export function setLive(nk: nkruntime.Nakama, userId: string, matchId: string): void {
    if (!userId || !matchId) return;
    write(nk, "live", userId, { matchId: matchId });
  }

  export function clearLive(nk: nkruntime.Nakama, userId: string, matchId: string): void {
    if (!userId) return;
    var row = read(nk, "live", userId);
    if (!row) return;
    if (matchId && String(row.value["matchId"] || "") !== matchId) return;
    drop(nk, "live", userId);
  }

  function clearQueue(nk: nkruntime.Nakama, userId: string): void {
    if (!userId) return;
    if (!read(nk, "queue", userId)) return;
    drop(nk, "queue", userId);
  }

  function claimQueue(nk: nkruntime.Nakama, userId: string, sessionId: string): void {
    var row = read(nk, "queue", userId);
    if (row) {
      var held = String(row.value["sessionId"] || "");
      if (held === sessionId || sessionLive(nk, userId, held)) throw new Error("already_queued");
      try {
        write(nk, "queue", userId, { sessionId: sessionId, at: Date.now() }, row.version);
        return;
      } catch (e) {
        throw new Error("already_queued");
      }
    }
    try {
      write(nk, "queue", userId, { sessionId: sessionId, at: Date.now() }, "*");
    } catch (e) {
      throw new Error("already_queued");
    }
  }

  export function rateAllow(nk: nkruntime.Nakama, userId: string, kind: string): boolean {
    var windowMs = kind === "create" ? CoopProto.CREATE_WINDOW_MS : CoopProto.LOOKUP_WINDOW_MS;
    var max = kind === "create" ? CoopProto.CREATE_MAX : CoopProto.LOOKUP_MAX;
    var key = "coop:" + kind + ":" + userId;
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

  /** Claim a fresh code. False when another room already holds it. */
  export function reserveCode(nk: nkruntime.Nakama, code: string): boolean {
    try {
      write(nk, "code:" + code, SYSTEM_USER, { matchId: "", expiresAt: 0 }, "*");
      return true;
    } catch (e) {
      return false;
    }
  }

  export function bindCode(nk: nkruntime.Nakama, code: string, matchId: string, expiresAt: number): void {
    write(nk, "code:" + code, SYSTEM_USER, { matchId: matchId, expiresAt: expiresAt });
  }

  export function releaseCode(nk: nkruntime.Nakama, code: string): void {
    if (!code) return;
    drop(nk, "code:" + code, SYSTEM_USER);
  }

  /** Match id for a live code, or "". Expired and dead rows are removed. */
  export function lookupCode(nk: nkruntime.Nakama, code: string): string {
    var row = read(nk, "code:" + code, SYSTEM_USER);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    var expires = Number(row.value["expiresAt"] || 0);
    if (!id || !expires || Date.now() > expires || !nk.matchGet(id)) {
      drop(nk, "code:" + code, SYSTEM_USER);
      return "";
    }
    return id;
  }

  export function pairToken(matches: nkruntime.MatchmakerResult[]): string {
    var parts: string[] = [];
    for (var i = 0; i < matches.length; i++) {
      var entry = matches[i] as nkruntime.MatchmakerResult & { ticket?: string };
      var ticket = entry && entry.ticket ? String(entry.ticket) : "";
      var presence = entry ? entry.presence : null;
      if (ticket) parts.push("t:" + ticket);
      else if (presence && presence.userId) parts.push("p:" + presence.userId + ":" + (presence.sessionId || ""));
    }
    parts.sort();
    return parts.join("|");
  }

  function groupKey(nk: nkruntime.Nakama, token: string): string {
    return "group:" + nk.sha256Hash(token);
  }

  export function liveGroup(nk: nkruntime.Nakama, token: string): string {
    if (!token) return "";
    var row = read(nk, groupKey(nk, token), SYSTEM_USER);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    if (id && nk.matchGet(id)) return id;
    drop(nk, groupKey(nk, token), SYSTEM_USER);
    return "";
  }

  export function rememberGroup(nk: nkruntime.Nakama, token: string, matchId: string): void {
    if (!token || !matchId) return;
    write(nk, groupKey(nk, token), SYSTEM_USER, { matchId: matchId });
  }

  export function forgetGroup(nk: nkruntime.Nakama, token: string): void {
    if (!token) return;
    drop(nk, groupKey(nk, token), SYSTEM_USER);
  }

  export function readCheckpoint(nk: nkruntime.Nakama, matchId: string): nkruntime.StorageObject | null {
    if (!matchId) return null;
    return read(nk, "ckpt:" + matchId, SYSTEM_USER);
  }

  export function writeCheckpoint(nk: nkruntime.Nakama, matchId: string, value: { [key: string]: unknown }, version?: string): void {
    write(nk, "ckpt:" + matchId, SYSTEM_USER, value, version);
  }

  /**
   * One quick-queue ticket per socket. A dead socket's row is replaced.
   * Runs after the hub scope check. Other games are ignored.
   */
  export function noteAdd(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): void {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId || !ctx.sessionId) return;
    var props = add.stringProperties || {};
    if (props["game"] !== CoopProto.GAME_ID) return;
    if (Maint.on(nk)) throw new Error("maintenance");
    if (!CoopMatch.open(ctx)) throw new Error("capacity_dark");
    if (props["v"] !== String(CoopProto.PROTOCOL) || props["sim"] !== CoopProto.FINGERPRINT) throw new Error("version_mismatch");
    if (liveMatch(nk, ctx.userId)) throw new Error("already_in_match");
    // A client built for six seats still asks for up to six; a group that size has no match to join.
    if (typeof add.maxCount !== "number" || add.maxCount > CoopProto.MAX_SEATS) add.maxCount = CoopProto.MAX_SEATS;
    if (typeof add.minCount === "number" && add.minCount > add.maxCount) add.minCount = add.maxCount;
    claimQueue(nk, ctx.userId, ctx.sessionId);
  }

  /** MatchmakerRemove drops our row. A second remove is a no-op. */
  export function noteRemove(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var raw = envelope as nkruntime.Envelope & { matchmakerRemove?: { ticket?: string } };
    if (!raw.matchmakerRemove || !ctx.userId) return envelope;
    var row = read(nk, "queue", ctx.userId);
    if (!row) return envelope;
    if (ctx.sessionId && String(row.value["sessionId"] || "") !== ctx.sessionId) return envelope;
    clearQueue(nk, ctx.userId);
    return envelope;
  }

  /** Idempotent queue cancel for the authenticated account, with or without a ticket. */
  export function cancelQueue(nk: nkruntime.Nakama, userId: string): void {
    clearQueue(nk, userId);
  }

  /**
   * One authoritative lobby for a matchmaker group. A repeat of the same
   * tickets returns that match. Someone already seated is not pulled into a second one.
   */
  export function onMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (!CoopMatch.open(_ctx)) return;
    if (Maint.on(nk)) return;
    if (!matches || matches.length < 1 || matches.length > CoopProto.MAX_SEATS) return;
    var ids: string[] = [];
    var seen: { [id: string]: boolean } = {};
    for (var i = 0; i < matches.length; i++) {
      var entry = matches[i];
      if (!entry || !entry.presence || !entry.presence.userId) return;
      var props = entry.properties || {};
      if (String(props["game"]) !== CoopProto.GAME_ID) return;
      if (String(props["v"]) !== String(CoopProto.PROTOCOL)) return;
      if (String(props["sim"]) !== CoopProto.FINGERPRINT) return;
      var uid = entry.presence.userId;
      if (seen[uid]) return;
      seen[uid] = true;
      ids.push(uid);
      clearQueue(nk, uid);
    }
    var token = pairToken(matches);
    var existing = liveGroup(nk, token);
    if (existing) {
      for (var j = 0; j < ids.length; j++) setLive(nk, ids[j], existing);
      return existing;
    }
    for (var k = 0; k < ids.length; k++) {
      if (liveMatch(nk, ids[k])) {
        logger.info("sproto_coop skip, already in a match");
        return;
      }
    }
    var names: { [id: string]: string } = {};
    for (var n = 0; n < matches.length; n++) names[matches[n].presence.userId] = HubMatch.cleanName(matches[n].presence.username, 16);
    var id = nk.matchCreate(CoopProto.MATCH_NAME, {
      private: "0",
      roster: JSON.stringify(ids),
      names: JSON.stringify(names),
      token: token,
      seedSource: "server",
    });
    rememberGroup(nk, token, id);
    for (var s = 0; s < ids.length; s++) setLive(nk, ids[s], id);
    logger.info("sproto_coop queue " + id);
    return id;
  }
}

var coopPrevMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd = HubRt.beforeMatchmakerAdd;
(HubRt as { beforeMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd }).beforeMatchmakerAdd = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  var out = coopPrevMatchmakerAdd(ctx, logger, nk, envelope);
  CoopMm.noteAdd(ctx, logger, nk, out);
  return out;
};

function rtBeforeCoopMatchmakerRemove(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  return CoopMm.noteRemove(ctx, logger, nk, envelope);
}

// The before-hook VM evaluates this file but does not call InitModule. The game
// id is registered later by sproto_coop_battle.ts, so the matchmaker has to be
// attached at that registration or quick queue is rejected as the wrong scope.
var coopPrevRegister = HubGames.register;
(HubGames as { register: typeof HubGames.register }).register = function (reg: HubGames.GameReg): void {
  if (reg && reg.game === CoopProto.GAME_ID && !reg.matchmaker) {
    reg = { game: reg.game, matchmaker: CoopMm.onMatched, chatRooms: reg.chatRooms, hubScope: reg.hubScope };
  }
  coopPrevRegister(reg);
};
