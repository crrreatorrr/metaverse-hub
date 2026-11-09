// Quick queue and private room codes for the free Shooter 1v1.
// Codes are locators. Joining still requires a sproto-shooter game session.
// One account, one live match. Storage is server-only. Nothing here writes a Ticket.

namespace ShooterMm {
  export var COLLECTION = "sproto_shooter_free";
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

  /** True while this account holds a free-queue ticket on a live socket. */
  export function queued(nk: nkruntime.Nakama, userId: string): boolean {
    if (!userId) return false;
    var row = read(nk, "queue", userId);
    if (!row) return false;
    return sessionLive(nk, userId, String(row.value["sessionId"] || ""));
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
    var windowMs = kind === "create" ? ShooterProto.CREATE_WINDOW_MS : ShooterProto.LOOKUP_WINDOW_MS;
    var max = kind === "create" ? ShooterProto.CREATE_MAX : ShooterProto.LOOKUP_MAX;
    var key = "shooter-pvp:" + kind + ":" + userId;
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

  function prop(props: { [key: string]: string | number }, key: string): string {
    if (!props || props[key] === undefined || props[key] === null) return "";
    return String(props[key]);
  }

  function freeProps(props: { [key: string]: string | number }): boolean {
    if (prop(props, "game") !== ShooterProto.GAME_ID) return false;
    if (prop(props, "mode") !== ShooterProto.MODE) return false;
    if (prop(props, "protocol") !== String(ShooterProto.PROTOCOL)) return false;
    if (prop(props, "sim") !== String(ShooterProto.SIM)) return false;
    if (prop(props, "content") !== ShooterProto.FINGERPRINT) return false;
    var stake = prop(props, "stake");
    if (stake && stake !== "0") return false;
    return true;
  }

  /** Fixed 10-Ticket queue. The stake is not a client-chosen amount. */
  function wagerProps(props: { [key: string]: string | number }): boolean {
    if (prop(props, "game") !== ShooterProto.GAME_ID) return false;
    if (prop(props, "mode") !== "wager") return false;
    if (prop(props, "protocol") !== String(ShooterProto.PROTOCOL)) return false;
    if (prop(props, "sim") !== String(ShooterProto.SIM)) return false;
    if (prop(props, "content") !== ShooterProto.FINGERPRINT) return false;
    if (prop(props, "stake") !== String(ShooterWagers.STAKE)) return false;
    return true;
  }

  /**
   * One free-queue ticket per socket. A dead socket's row is replaced.
   * Runs after the hub scope check. Other games are ignored.
   * Practice and any stake are rejected. Guests are not given a second queue row.
   */
  export function noteAdd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): void {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId || !ctx.sessionId) return;
    var props = add.stringProperties || {};
    if (props["game"] !== ShooterProto.GAME_ID) return;
    if (props["mode"] === "practice") throw new Error("practice_offline");
    var asProps = props as { [key: string]: string | number };
    if (props["mode"] === "wager" || props["stake"] === String(ShooterWagers.STAKE)) {
      if (!ShooterWagers.enabled(nk, ctx.userId, logger)) throw new Error("stakes_disabled");
      if (HubChat.isGuest(nk, logger, ctx.userId)) throw new Error("wager_guest");
      if (!wagerProps(asProps)) throw new Error("version_mismatch");
    } else {
      if (props["stake"] !== undefined && props["stake"] !== "0") throw new Error("stakes_disabled");
      if (!freeProps(asProps)) throw new Error("version_mismatch");
    }
    if (liveMatch(nk, ctx.userId)) throw new Error("already_in_match");
    claimQueue(nk, ctx.userId, ctx.sessionId);
  }

  export function noteRemove(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var raw = envelope as nkruntime.Envelope & { matchmakerRemove?: { ticket?: string } };
    if (!raw.matchmakerRemove || !ctx.userId) return envelope;
    var row = read(nk, "queue", ctx.userId);
    if (!row) return envelope;
    if (ctx.sessionId && String(row.value["sessionId"] || "") !== ctx.sessionId) return envelope;
    clearQueue(nk, ctx.userId);
    return envelope;
  }

  export function cancelQueue(nk: nkruntime.Nakama, userId: string): void {
    clearQueue(nk, userId);
  }

  /**
   * One free lobby for a matchmaker pair. A repeat of the same tickets returns
   * that match. An account already seated is not pulled into a second one.
   */
  export function onMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (!matches || matches.length !== ShooterProto.SEATS) return;
    var wagered = true;
    var freed = true;
    for (var p = 0; p < matches.length; p++) {
      var peek = matches[p];
      if (!peek || !peek.presence || !peek.presence.userId) return;
      var peeked = peek.properties || {};
      if (!wagerProps(peeked)) wagered = false;
      if (!freeProps(peeked)) freed = false;
    }
    // A free ticket and a wager ticket are not a match. Leave both queued.
    if (!wagered && !freed) return;
    if (wagered) {
      for (var g = 0; g < matches.length; g++) {
        var who = matches[g].presence.userId;
        if (!ShooterWagers.enabled(nk, who, logger) || HubChat.isGuest(nk, logger, who)) return;
      }
    }
    var ids: string[] = [];
    var seen: { [id: string]: boolean } = {};
    for (var i = 0; i < matches.length; i++) {
      var entry = matches[i];
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
        logger.info("sproto_shooter_free skip, already in a match");
        return;
      }
    }
    // The public spawn seed only. The secret combat seed is generated inside the match.
    var spawnSeed = ShooterProto.serverSeed(nk);
    var id = nk.matchCreate(ShooterProto.MATCH_NAME, {
      private: "0",
      roster: JSON.stringify(ids),
      token: token,
      spawnSeed: String(spawnSeed),
      seedSource: "server",
      wager: wagered ? "1" : "0",
    });
    rememberGroup(nk, token, id);
    for (var s = 0; s < ids.length; s++) setLive(nk, ids[s], id);
    logger.info((wagered ? "sproto_shooter_wager queue " : "sproto_shooter_free queue ") + id);
    return id;
  }
}

var shooterPrevMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd = HubRt.beforeMatchmakerAdd;
(HubRt as { beforeMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd }).beforeMatchmakerAdd = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  var out = shooterPrevMatchmakerAdd(ctx, logger, nk, envelope);
  ShooterMm.noteAdd(ctx, logger, nk, out);
  return out;
};

function rtBeforeShooterMatchmakerRemove(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  return ShooterMm.noteRemove(ctx, logger, nk, envelope);
}

// sproto_shooter.ts registers the id with no matchmaker. Attach the free queue
// when that registration runs. A second matchmaker for the id still throws.
var shooterPrevRegister = HubGames.register;
(HubGames as { register: typeof HubGames.register }).register = function (reg: HubGames.GameReg): void {
  if (reg && reg.game === ShooterProto.GAME_ID && !reg.matchmaker) {
    reg = { game: reg.game, matchmaker: ShooterMm.onMatched, chatRooms: reg.chatRooms, hubScope: reg.hubScope };
  }
  shooterPrevRegister(reg);
};
