// 0-Ticket Sproto Duel for a visitor who never opened a portal ticket.
//
// A normal device (or email) session is scope "hub": beforeAuthenticateDevice
// drops every client var. That session calls sproto.standalone_session with the
// public app marker below. The marker is not a secret and grants nothing except
// this session shape. The server mints the token; the payload cannot choose
// scope, game, sid, or ranked.
//
// nk.authenticateTokenGenerate writes those vars into the session JWT (claim
// "vrs"). Match join, sproto.room_create, sproto.room_join, and MatchmakerAdd
// all read ctx.vars from that token, the same way a portal "t:" custom-auth
// token does. The client must open its socket with the minted token. Refreshing
// the original hub refresh token stays scope "hub". This RPC does not return a
// refresh token; the access token lasts for the server's token_expiry_sec
// (7200 in deploy and compose). Call again when it expires.
//
// Rate limits use Nakama localcache (one node, cleared on restart). A call is
// counted only after the marker and the hub scope check pass.
//
// | Bucket | Limit | Window |
// | user id | 10 | 10 minutes |
// | each linked device id | 10 | 10 minutes |
// | client IP (ctx.clientIp), when Nakama set one | 40 | 10 minutes |
namespace SprotoStandalone {
  /** Public app marker. Not a secret. Exact string, case-sensitive. */
  export var APP_MARKER = "sproto-duel";
  export var RPC_ID = "sproto.standalone_session";
  export var GAME_ID = "sproto";

  export var USER_LIMIT = 10;
  export var DEVICE_LIMIT = 10;
  export var IP_LIMIT = 40;
  export var WINDOW_MS = 10 * 60 * 1000;

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function fail(code: string, message: string): string {
    return JSON.stringify({ error: code, message: message });
  }

  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  function clientIp(ctx: nkruntime.Context): string {
    var ip = (ctx as unknown as { clientIp?: unknown }).clientIp;
    if (typeof ip !== "string") return "";
    if (ip.length < 3 || ip.length > 64) return "";
    return ip;
  }

  function parse(payload: string): { [key: string]: unknown } | null {
    if (!payload) return {};
    if (payload.length > 1024) return null;
    try {
      var data = JSON.parse(payload) as unknown;
      if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") return null;
      return data as { [key: string]: unknown };
    } catch (_e) {
      return null;
    }
  }

  interface Slot { key: string; limit: number }

  function windowCount(nk: nkruntime.Nakama, key: string, now: number): { count: number; start: number } {
    var raw = nk.localcacheGet(key);
    if (typeof raw !== "string") return { count: 0, start: now };
    var parts = raw.split(":");
    var count = Number(parts[0]);
    var start = Number(parts[1]);
    if (!isFinite(count) || !isFinite(start) || now - start >= WINDOW_MS) return { count: 0, start: now };
    return { count: count, start: start };
  }

  /** All-or-nothing fixed window. A full bucket rejects without incrementing the others. */
  function take(nk: nkruntime.Nakama, slots: Slot[], now: number): boolean {
    var open: { count: number; start: number }[] = [];
    for (var i = 0; i < slots.length; i++) {
      var state = windowCount(nk, slots[i].key, now);
      if (state.count >= slots[i].limit) return false;
      open.push(state);
    }
    var ttl = Math.ceil(WINDOW_MS / 1000);
    for (var j = 0; j < slots.length; j++) {
      nk.localcachePut(slots[j].key, String(open[j].count + 1) + ":" + String(open[j].start), ttl);
    }
    return true;
  }

  /**
   * sproto.standalone_session {app: "sproto-duel"} from a hub session.
   * Returns {token, exp, sid}. Every other payload field is ignored.
   * Vars on the token are exactly {scope:"game", game:"sproto", sid, ranked:"0"}.
   */
  export function session(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized", "Sign in first");
    if (scopeOf(ctx) !== "hub") return fail("wrong_scope", "Open this from a hub session");
    var body = parse(payload);
    if (!body) return fail("bad_json", "Body must be a JSON object");
    if (body["app"] !== APP_MARKER) return fail("bad_app", "Unknown app");

    var account: nkruntime.Account;
    try {
      account = nk.accountGetId(ctx.userId);
    } catch (e) {
      logger.warn("sproto standalone account " + ctx.userId + " " + String(e));
      return fail("unauthorized", "Sign in first");
    }
    var username = account && account.user && account.user.username ? account.user.username : "";
    if (!username && ctx.username) username = ctx.username;
    if (!username) return fail("unauthorized", "Sign in first");

    var slots: Slot[] = [{ key: "sproto:sa:u:" + ctx.userId, limit: USER_LIMIT }];
    var seen: { [id: string]: boolean } = {};
    var devices = account && account.devices ? account.devices : [];
    for (var i = 0; i < devices.length; i++) {
      var deviceId = devices[i] && devices[i].id ? devices[i].id : "";
      if (!deviceId || deviceId.length > 256 || seen["#" + deviceId]) continue;
      seen["#" + deviceId] = true;
      slots.push({ key: "sproto:sa:d:" + nk.sha256Hash(deviceId), limit: DEVICE_LIMIT });
    }
    var ip = clientIp(ctx);
    if (ip) slots.push({ key: "sproto:sa:ip:" + nk.sha256Hash(ip), limit: IP_LIMIT });
    if (!take(nk, slots, Date.now())) return fail("rate_limited", "Too many Duel sessions. Try again in a few minutes.");

    var sid = nk.uuidv4();
    if (!UUID.test(sid)) return fail("mint_failed", "Could not open a Duel session");
    // Built here, not copied from the client. Four keys, nothing else.
    var vars: { [key: string]: string } = {
      scope: "game",
      game: GAME_ID,
      sid: sid,
      ranked: "0",
    };
    try {
      var minted = nk.authenticateTokenGenerate(ctx.userId, username, null, vars);
      logger.info("sproto standalone session " + ctx.userId);
      return JSON.stringify({ token: minted.token, exp: minted.exp, sid: sid });
    } catch (e) {
      logger.error("sproto standalone mint " + ctx.userId + " " + String(e));
      return fail("mint_failed", "Could not open a Duel session");
    }
  }
}
