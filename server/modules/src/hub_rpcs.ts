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
    if (!allow(nk, "hubjoin:" + userId, JOIN_PER_MINUTE, 60000, Date.now())) return fail("rate_limited");
    var prefer = typeof body.prefer === "string" && MATCH_ID.test(body.prefer) ? body.prefer : "";
    var placed = HubShards.place(nk, logger, {
      module: HubMatch.MODULE,
      kind: "hub",
      max: HubMatch.MAX_PLAYERS,
      softMax: HubMatch.SOFT_CAP,
      preferMatchId: prefer || undefined,
    });
    return JSON.stringify({ matchId: placed.matchId, shard: placed.shard, room: "hub." + String(placed.shard) });
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
}
