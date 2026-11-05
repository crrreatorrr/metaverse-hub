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
// Rate limits are storage counters, one row per bucket, in a fixed 10-minute
// window. A call is counted only after the marker and the hub scope check pass.
// Each reserve increments under the row's storage version (optimistic
// concurrency). The write commits only if that version is still current, so
// two callers cannot both claim the same count. If the committed count is over
// the limit, that increment is rolled back and the call is denied. Retries
// that run out, or any storage error, deny as well.
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
  interface Claim { key: string; start: number }

  /** Storage owner for every bucket. Not an account; same nil id other game rows use. */
  var RATE_OWNER = "00000000-0000-0000-0000-000000000000";
  var RATE_COLLECTION = "sproto_sa_rl";
  /** Enough for a burst to serialize on one row, then give up and deny. */
  var RESERVE_ATTEMPTS = 16;

  function errorText(e: unknown): string {
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return String(e);
  }

  function versionConflict(e: unknown): boolean {
    return errorText(e).toLowerCase().indexOf("version") >= 0;
  }

  function whole(n: unknown): number | null {
    if (typeof n !== "number" || !isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function readRows(nk: nkruntime.Nakama, slots: Slot[]): { [key: string]: nkruntime.StorageObject } | null {
    var keys: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < slots.length; i++) {
      keys.push({ collection: RATE_COLLECTION, key: slots[i].key, userId: RATE_OWNER });
    }
    try {
      var rows = nk.storageRead(keys);
      var out: { [key: string]: nkruntime.StorageObject } = {};
      for (var j = 0; j < rows.length; j++) out[rows[j].key] = rows[j];
      return out;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Claim one slot on every bucket, or none. The increment is committed with the
   * row version just read, so a racing call cannot commit the same count. A
   * committed count over that bucket's limit is rolled back and the call is denied.
   */
  function reserve(nk: nkruntime.Nakama, logger: nkruntime.Logger, slots: Slot[], now: number): boolean {
    for (var attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
      var rows = readRows(nk, slots);
      if (!rows) return false;
      var writes: nkruntime.StorageWrite[] = [];
      var claimed: Claim[] = [];
      var over = false;
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var row = rows[slot.key];
        var count = 0;
        var start = now;
        var version = "*";
        if (row) {
          version = row.version || "*";
          var seen = whole(row.value.count);
          var opened = whole(row.value.start);
          var live = seen !== null && opened !== null && now >= opened && now - opened < WINDOW_MS;
          if (live) {
            count = seen as number;
            start = opened as number;
          } else if (seen === null && opened !== null && now >= opened && now - opened < WINDOW_MS) {
            return false;
          }
        }
        var next = count + 1;
        if (next > slot.limit) over = true;
        writes.push({
          collection: RATE_COLLECTION,
          key: slot.key,
          userId: RATE_OWNER,
          value: { count: next, start: start },
          version: version,
          permissionRead: 0,
          permissionWrite: 0,
        });
        claimed.push({ key: slot.key, start: start });
      }
      try {
        nk.storageWrite(writes);
      } catch (e) {
        if (versionConflict(e)) continue;
        logger.warn("sproto standalone rate write " + errorText(e));
        return false;
      }
      if (!over) return true;
      undo(nk, logger, claimed);
      return false;
    }
    logger.warn("sproto standalone rate retries exhausted");
    return false;
  }

  /** Drop one claimed increment per key. A changed window is left alone. */
  function undo(nk: nkruntime.Nakama, logger: nkruntime.Logger, claimed: Claim[]): void {
    for (var i = 0; i < claimed.length; i++) {
      var claim = claimed[i];
      for (var attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
        var rows: nkruntime.StorageObject[];
        try {
          rows = nk.storageRead([{ collection: RATE_COLLECTION, key: claim.key, userId: RATE_OWNER }]);
        } catch (e) {
          logger.warn("sproto standalone rate undo read " + errorText(e));
          break;
        }
        if (!rows.length) break;
        var count = whole(rows[0].value.count);
        var start = whole(rows[0].value.start);
        if (count === null || start === null || start !== claim.start || count <= 0) break;
        try {
          nk.storageWrite([{
            collection: RATE_COLLECTION,
            key: claim.key,
            userId: RATE_OWNER,
            value: { count: count - 1, start: start },
            version: rows[0].version,
            permissionRead: 0,
            permissionWrite: 0,
          }]);
          break;
        } catch (e) {
          if (versionConflict(e)) continue;
          logger.warn("sproto standalone rate undo " + errorText(e));
          break;
        }
      }
    }
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
    if (!reserve(nk, logger, slots, Date.now())) return fail("rate_limited", "Too many Duel sessions. Try again in a few minutes.");

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
