// Queue seat, idempotent quick-match create, and the menu count for Sproto Duel.
//
// Nakama 3.41's JavaScript matchmaker hook receives presence and properties only
// (no ticket). A pair is therefore keyed by the sorted ticket when a runtime
// exposes one, otherwise by userId:sessionId. Storage is Nakama storage only.

namespace SprotoMm {
  export var COLLECTION = "sproto_mm";
  export var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
  export var QUEUE_KEY = "queue";
  export var LIVE_KEY = "live";
  /** Menu count is recomputed at most this often, per node. */
  export var COUNT_CACHE_S = 3;
  /** Every connected socket is tracked on this stream until it drops. Mode 0 is notifications. */
  var NOTIFY_STREAM_MODE = 0;
  var QUEUE_N = "sproto:queue:n";
  var COUNT_CACHE = "sproto:counts";

  function now(): number {
    return Date.now();
  }

  function read(nk: nkruntime.Nakama, key: string, userId: string): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: userId }]);
    return rows && rows.length ? rows[0] : null;
  }

  function write(nk: nkruntime.Nakama, key: string, userId: string, value: { [k: string]: unknown }, version?: string): void {
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

  /**
   * True when that socket is still on the notifications stream. A missing lookup
   * (the unit harness) or a lookup error counts as live, so a second ticket is
   * rejected instead of opening a double queue.
   */
  function sessionLive(nk: nkruntime.Nakama, userId: string, sessionId: string): boolean {
    if (!sessionId) return false;
    var probe = (nk as nkruntime.Nakama & {
      streamUserGet?(userId: string, sessionId: string, stream: { mode: number; subject: string }): { [k: string]: unknown } | null;
    }).streamUserGet;
    if (typeof probe !== "function") return true;
    try {
      return probe(userId, sessionId, { mode: NOTIFY_STREAM_MODE, subject: userId }) != null;
    } catch (e) {
      return true;
    }
  }

  /** The row belongs to this socket, or to another socket that is still connected. */
  function queueHeld(nk: nkruntime.Nakama, userId: string, sessionId: string, row: nkruntime.StorageObject): boolean {
    var sid = String(row.value["sessionId"] || "");
    if (!sid) return false;
    if (sid === sessionId) return true;
    return sessionLive(nk, userId, sid);
  }

  /**
   * One queue row per user. A dead socket's row is replaced. Two live sockets
   * lose the storage-version race: the second sees the winner and is rejected.
   */
  function claimQueue(nk: nkruntime.Nakama, userId: string, sessionId: string): void {
    for (var attempt = 0; attempt < 3; attempt++) {
      var row = read(nk, QUEUE_KEY, userId);
      if (row) {
        if (queueHeld(nk, userId, sessionId, row)) throw new Error("already_queued");
        try {
          write(nk, QUEUE_KEY, userId, { sessionId: sessionId, at: now() }, row.version);
          return;
        } catch (e) {
          continue;
        }
      }
      try {
        write(nk, QUEUE_KEY, userId, { sessionId: sessionId, at: now() }, "*");
        setQueueN(nk, queueN(nk) + 1);
        return;
      } catch (e) {
        continue;
      }
    }
    throw new Error("already_queued");
  }

  function queueN(nk: nkruntime.Nakama): number {
    var n = Number(nk.localcacheGet(QUEUE_N) || 0);
    return n > 0 ? n : 0;
  }

  function setQueueN(nk: nkruntime.Nakama, n: number): void {
    nk.localcachePut(QUEUE_N, n < 0 ? 0 : n, 0);
  }

  /**
   * Idempotency key for one matchmaker pair. Tickets win when the runtime
   * passes them; Nakama 3.41 does not, so the sockets stand in.
   */
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

  function pairKey(nk: nkruntime.Nakama, token: string): string {
    return "pair:" + nk.sha256Hash(token);
  }

  /** Match id already created for this pair while that match still exists, or "". */
  export function livePair(nk: nkruntime.Nakama, token: string): string {
    if (!token) return "";
    var key = pairKey(nk, token);
    var row = read(nk, key, SYSTEM_USER);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    if (id && nk.matchGet(id)) return id;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: key, userId: SYSTEM_USER }]);
    } catch (e) {
      /* the row is already gone */
    }
    return "";
  }

  export function rememberPair(nk: nkruntime.Nakama, token: string, matchId: string): void {
    if (!token || !matchId) return;
    write(nk, pairKey(nk, token), SYSTEM_USER, { matchId: matchId });
  }

  export function forgetPair(nk: nkruntime.Nakama, token: string): void {
    if (!token) return;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: pairKey(nk, token), userId: SYSTEM_USER }]);
    } catch (e) {
      /* already forgotten */
    }
  }

  /** Live sproto_arena match this user is seated in, or "". A dead id is dropped. */
  export function liveMatch(nk: nkruntime.Nakama, userId: string): string {
    if (!userId) return "";
    var row = read(nk, LIVE_KEY, userId);
    if (!row) return "";
    var id = String(row.value["matchId"] || "");
    if (id && nk.matchGet(id)) return id;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: LIVE_KEY, userId: userId }]);
    } catch (e) {
      /* already dropped */
    }
    return "";
  }

  export function setLive(nk: nkruntime.Nakama, userId: string, matchId: string): void {
    if (!userId || !matchId) return;
    write(nk, LIVE_KEY, userId, { matchId: matchId });
  }

  /** Drop the live seat only when it still names this match. */
  export function clearLive(nk: nkruntime.Nakama, userId: string, matchId: string): void {
    if (!userId) return;
    var row = read(nk, LIVE_KEY, userId);
    if (!row) return;
    if (matchId && String(row.value["matchId"] || "") !== matchId) return;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: LIVE_KEY, userId: userId }]);
    } catch (e) {
      /* already dropped */
    }
  }

  export function clearQueue(nk: nkruntime.Nakama, userId: string): void {
    if (!userId) return;
    var row = read(nk, QUEUE_KEY, userId);
    if (!row) return;
    try {
      nk.storageDelete([{ collection: COLLECTION, key: QUEUE_KEY, userId: userId }]);
    } catch (e) {
      /* already dropped */
    }
    setQueueN(nk, queueN(nk) - 1);
  }

  /**
   * Runs after the hub scope check on MatchmakerAdd. A second sproto ticket is
   * rejected while the socket that holds the row is still connected. A row whose
   * socket has dropped is replaced. No session id (the unit harness) skips this.
   */
  export function noteAdd(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): void {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId || !ctx.sessionId) return;
    var props = add.stringProperties || {};
    if (props["game"] !== SprotoArena.GAME_ID) return;
    if (Maint.on(nk)) throw new Error("maintenance");
    if (liveMatch(nk, ctx.userId)) throw new Error("already_in_match");
    claimQueue(nk, ctx.userId, ctx.sessionId);
  }

  /**
   * MatchmakerRemove for the session that queued. Nakama deletes the ticket
   * after this hook; we only drop our row so the player can queue again.
   */
  export function noteRemove(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var raw = envelope as nkruntime.Envelope & { matchmakerRemove?: { ticket?: string } };
    if (!raw.matchmakerRemove || !ctx.userId) return envelope;
    var row = read(nk, QUEUE_KEY, ctx.userId);
    if (!row) return envelope;
    if (ctx.sessionId && String(row.value["sessionId"] || "") !== ctx.sessionId) return envelope;
    clearQueue(nk, ctx.userId);
    return envelope;
  }

  /** Read-only. Recomputed at most once per COUNT_CACHE_S on this node. */
  export function rpcCount(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var vars = ctx.vars || null;
    if (!ctx.userId || !vars || vars["scope"] !== "game" || vars["game"] !== SprotoArena.GAME_ID) throw new Error("wrong_scope");
    var t = now();
    var cachedRaw = nk.localcacheGet(COUNT_CACHE);
    if (typeof cachedRaw === "string" && cachedRaw) {
      try {
        var cached = JSON.parse(cachedRaw) as { online?: number; queued?: number; at?: number };
        if (cached && typeof cached.at === "number" && t - cached.at < COUNT_CACHE_S * 1000) {
          return JSON.stringify({ online: Number(cached.online) || 0, queued: Number(cached.queued) || 0, ageMs: t - cached.at });
        }
      } catch (e) {
        /* recompute */
      }
    }
    var listed = nk.matchList(100, true, null, null, null, "+label.kind:" + SprotoArena.KIND);
    var online = 0;
    if (listed) for (var i = 0; i < listed.length; i++) online += listed[i].size || 0;
    var queued = queueN(nk);
    nk.localcachePut(COUNT_CACHE, JSON.stringify({ online: online, queued: queued, at: t }), COUNT_CACHE_S + 2);
    return JSON.stringify({ online: online, queued: queued, ageMs: 0 });
  }
}

var sprotoPrevMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd = HubRt.beforeMatchmakerAdd;
(HubRt as { beforeMatchmakerAdd: typeof HubRt.beforeMatchmakerAdd }).beforeMatchmakerAdd = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  var out = sprotoPrevMatchmakerAdd(ctx, logger, nk, envelope);
  SprotoMm.noteAdd(ctx, logger, nk, out);
  return out;
};

function rpcSprotoOnlineCount(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return SprotoMm.rpcCount(ctx, logger, nk, payload);
}

function rtBeforeSprotoMatchmakerRemove(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
  return SprotoMm.noteRemove(ctx, logger, nk, envelope);
}
