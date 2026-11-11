// Plaza RPCs. hub.join places a hub-scope session on the least-full open shard
// (HubShards, Contract C7) and names the chat room for that shard.
namespace HubRealtimeRpc {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var MATCH_ID = /^[0-9a-f-]{36}\.[A-Za-z0-9_.-]{0,64}$/;
  export var JOIN_PER_MINUTE = 6;
  export var REPORTS_PER_HOUR = 10;

  function fail(code: string): string {
    return JSON.stringify({ error: code, message: code });
  }

  function parse(payload: string): { [key: string]: unknown } {
    if (!payload) return {};
    if (payload.length > 4096) throw new Error("bad_json");
    var data = JSON.parse(payload) as unknown;
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") throw new Error("bad_json");
    return data as { [key: string]: unknown };
  }

  function hubUser(ctx: nkruntime.Context): string | null {
    if (!ctx.userId || !UUID.test(ctx.userId)) return null;
    var scope = ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
    if (scope !== "hub" && scope !== "") return null;
    return ctx.userId;
  }

  /** Fixed-window counter in localcache ("<count>:<windowStartMs>"). */
  export function allow(nk: nkruntime.Nakama, key: string, limit: number, windowMs: number, nowMs: number): boolean {
    var raw = nk.localcacheGet(key);
    var count = 0;
    var start = nowMs;
    if (typeof raw === "string") {
      var parts = raw.split(":");
      var c = Number(parts[0]);
      var s = Number(parts[1]);
      if (isFinite(c) && isFinite(s) && nowMs - s < windowMs) {
        count = c;
        start = s;
      }
    }
    if (count >= limit) return false;
    nk.localcachePut(key, String(count + 1) + ":" + String(start), Math.ceil(windowMs / 1000));
    return true;
  }

  /** {prefer?: matchId} → {matchId, shard, room}. Hub scope only, 6 per minute. */
  export function join(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = hubUser(ctx);
    if (!userId) return fail("wrong_scope");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var realm = body.realm === undefined ? HubRealms.get("plaza") : typeof body.realm === "string" ? HubRealms.get(body.realm) : null;
    if (!realm) return fail("bad_realm");
    if (!allow(nk, "hubjoin:" + userId, JOIN_PER_MINUTE, 60000, Date.now())) return fail("rate_limited");
    var prefer = typeof body.prefer === "string" && MATCH_ID.test(body.prefer) ? body.prefer : "";
    var placed = HubShards.place(nk, logger, {
      module: HubMatch.MODULE,
      kind: realm.kind,
      params: realm.id === "plaza" ? undefined : { realm: realm.id },
      max: HubMatch.MAX_PLAYERS,
      softMax: HubMatch.SOFT_CAP,
      preferMatchId: prefer || undefined,
    });
    return JSON.stringify({ matchId: placed.matchId, shard: placed.shard, room: realm.roomPrefix + "." + String(placed.shard) });
  }

  /** {channelId, messageId, userId, text?, reason} → {ok}. Any signed-in hub user, 10 per hour. */
  export function report(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = hubUser(ctx);
    if (!userId) return fail("wrong_scope");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var target = typeof body.userId === "string" ? body.userId : "";
    if (!UUID.test(target) || target === userId) return fail("bad_target");
    var channelId = typeof body.channelId === "string" ? body.channelId.slice(0, 128) : "";
    var messageId = typeof body.messageId === "string" ? body.messageId.slice(0, 64) : "";
    var text = typeof body.text === "string" ? body.text.slice(0, 512) : "";
    var reason = typeof body.reason === "string" ? body.reason.slice(0, 64) : "";
    if (!allow(nk, "chatreport:" + userId, REPORTS_PER_HOUR, 3600000, Date.now())) return fail("rate_limited");
    nk.sqlExec(
      "INSERT INTO game.chat_report (reporter, target, channel_id, message_id, text, reason) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)",
      [userId, target, channelId, messageId, text, reason],
    );
    logger.info("chat report " + userId + " -> " + target);
    return JSON.stringify({ ok: true });
  }
  // ---------------------------------------------------------------- plaza life (gameplay plan E3, E4)

  var PRESENCE_GAMES: string[] = ["hpos10i", "nobu", "peoples-bitcoin", "sproto", "sproto-fighter", "sproto-arcade", "sproto-shooter", "sproto-coop-battle"];
  export var PRESENCE_WINDOW_MINUTES = 30;
  export var PRESENCE_CACHE_SECONDS = 15;
  export var PRESENCE_PER_MINUTE = 12;
  export var CHAMPIONS_LIMIT = 50;
  export var CHAMPIONS_CACHE_SECONDS = 60;
  var FOUR_LIGHTS: string[] = ["hpos10i_core", "genesis_shard", "cones_tip", "tinubu_crown"];

  function cached(nk: nkruntime.Nakama, key: string): string | null {
    var hit = nk.localcacheGet(key);
    return typeof hit === "string" && hit !== "" ? hit : null;
  }

  /**
   * hub.presence {} → { counts: { <game>: n }, windowMinutes }. Hub scope, read only.
   * An estimate ("about N playing"): accounts with an open game session whose portal ticket was
   * redeemed in the last 30 minutes. Entering another game closes the previous session, so nobody
   * is counted twice. The answer is cached for 15 s as one string (localcache takes scalars only).
   */
  export function presence(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = hubUser(ctx);
    if (!userId) return fail("wrong_scope");
    if (!allow(nk, "hubpresence:" + userId, PRESENCE_PER_MINUTE, 60000, Date.now())) return fail("rate_limited");
    var hit = cached(nk, "hub:presence");
    if (hit) return hit;
    var rows = nk.sqlQuery(
      "SELECT game_id, count(DISTINCT user_id)::int AS n FROM game.game_session"
        + " WHERE state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL"
        + " AND ticket_redeemed_at > now() - ($1::int * interval '1 minute')"
        + " GROUP BY game_id",
      [PRESENCE_WINDOW_MINUTES],
    ) || [];
    var counts: { [game: string]: number } = {};
    for (var g = 0; g < PRESENCE_GAMES.length; g++) counts[PRESENCE_GAMES[g]] = 0;
    for (var i = 0; i < rows.length; i++) {
      var game = String(rows[i].game_id);
      var n = Number(rows[i].n);
      if (Object.prototype.hasOwnProperty.call(counts, game) && isFinite(n) && n > 0) counts[game] = Math.floor(n);
    }
    var out = JSON.stringify({ counts: counts, windowMinutes: PRESENCE_WINDOW_MINUTES });
    nk.localcachePut("hub:presence", out, PRESENCE_CACHE_SECONDS);
    return out;
  }

  /**
   * hub.champions {} → { champions: [{ order, userId, name }] }. Hub scope, read only.
   * The first 50 accounts that hold all four Four Lights Relics, ordered by the time of their
   * fourth claim. Names are cleaned like board names (never the raw username). Cached for 60 s.
   */
  export function champions(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = hubUser(ctx);
    if (!userId) return fail("wrong_scope");
    if (!allow(nk, "hubchampions:" + userId, PRESENCE_PER_MINUTE, 60000, Date.now())) return fail("rate_limited");
    var hit = cached(nk, "hub:champions");
    if (hit) return hit;
    var rows = nk.sqlQuery(
      "SELECT c.user_id::text AS user_id, COALESCE(u.username, '') AS name"
        + " FROM (SELECT user_id, max(claimed_at) AS done FROM game.relic_claim"
        + "       WHERE relic_id IN ('" + FOUR_LIGHTS.join("', '") + "')"
        + "       GROUP BY user_id HAVING count(DISTINCT relic_id) = " + String(FOUR_LIGHTS.length) + ") c"
        + " LEFT JOIN users u ON u.id = c.user_id"
        + " ORDER BY c.done, c.user_id LIMIT $1::int",
      [CHAMPIONS_LIMIT],
    ) || [];
    var list: { order: number; userId: string; name: string }[] = [];
    for (var i = 0; i < rows.length; i++) {
      var row = { userId: String(rows[i].user_id), name: String(rows[i].name === null || rows[i].name === undefined ? "" : rows[i].name) };
      HubBoards.cleanRowName(row);
      list.push({ order: i + 1, userId: row.userId, name: row.name });
    }
    var out = JSON.stringify({ champions: list });
    nk.localcachePut("hub:champions", out, CHAMPIONS_CACHE_SECONDS);
    return out;
  }
}
