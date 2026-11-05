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
  /** A queue row whose socket is gone is reusable after this. */
  export var QUEUE_STALE_MS = 3 * 60 * 1000;
  var QUEUE_N = "sproto:queue:n";
  var COUNT_CACHE = "sproto:counts";

  function now(): number {
    return Date.now();
  }

  function read(nk: nkruntime.Nakama, key: string, userId: string): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: userId }]);
    return rows && rows.length ? rows[0] : null;
  }

  function write(nk: nkruntime.Nakama, key: string, userId: string, value: { [k: string]: unknown }): void {
    nk.storageWrite([{
      collection: COLLECTION,
      key: key,
      userId: userId,
      value: value,
      permissionRead: 0,
      permissionWrite: 0,
    }]);
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
   * Runs after the hub scope check on MatchmakerAdd. A second sproto ticket for
   * this user, or a ticket while they sit in a live match, is rejected.
   * No session id (the unit harness) skips the bookkeeping and allows the add.
   */
  export function noteAdd(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): void {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId || !ctx.sessionId) return;
    var props = add.stringProperties || {};
    if (props["game"] !== SprotoArena.GAME_ID) return;
    if (liveMatch(nk, ctx.userId)) throw new Error("already_in_match");
    var row = read(nk, QUEUE_KEY, ctx.userId);
    if (row) {
      var at = Number(row.value["at"] || 0);
      var same = String(row.value["sessionId"] || "") === ctx.sessionId;
      if (same || now() - at < QUEUE_STALE_MS) throw new Error("already_queued");
      write(nk, QUEUE_KEY, ctx.userId, { sessionId: ctx.sessionId, at: now() });
      return;
    }
    write(nk, QUEUE_KEY, ctx.userId, { sessionId: ctx.sessionId, at: now() });
    setQueueN(nk, queueN(nk) + 1);
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
