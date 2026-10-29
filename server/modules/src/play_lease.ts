// M11 play lease. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include it. Wiring is docs/m11-single-active-tab.md.
//
// session.claim runs after the ticket swap. The newest call wins: Postgres
// mints a new lease_id, and the previous holder's socket gets session_superseded.
// session.heartbeat is the 15 second refresh. The 45 second TTL is enforced
// only with Postgres now(), in migration 0001.

namespace HubLease {
  /** Keep equal to the intervals in server/modules/migrations/0001_play_lease.sql. */
  export var HEARTBEAT_SECONDS = 15;
  export var TTL_SECONDS = 45;
  export var SESSION_SUPERSEDED_CODE = 1001;
  export var SESSION_SUPERSEDED_SUBJECT = "session_superseded";

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true };

  export interface LeaseError {
    error: "session_superseded" | "unauthorized";
    message: string;
  }

  interface LeaseDb extends nkruntime.Nakama {
    notificationSend(
      userId: string,
      subject: string,
      content: { [key: string]: string },
      code: number,
      senderId: string,
      persistent: boolean,
    ): string;
  }

  function leaseError(code: "session_superseded" | "unauthorized"): LeaseError {
    return { error: code, message: code };
  }

  function fail(code: string): string {
    return JSON.stringify({ error: code, message: code });
  }

  function errorText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "message" in value) {
      return String((value as { message: unknown }).message);
    }
    return String(value);
  }

  function text(data: { [key: string]: unknown }, key: string): string {
    var value = data[key];
    return typeof value === "string" ? value : "";
  }

  function whole(value: unknown, fallback: number): number {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string" && value !== "" && isFinite(Number(value))) return Number(value);
    return fallback;
  }

  function parse(payload: string): { [key: string]: unknown } {
    if (!payload) return {};
    if (payload.length > 8192) throw new Error("bad_json");
    var data = JSON.parse(payload) as unknown;
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") {
      throw new Error("bad_json");
    }
    return data as { [key: string]: unknown };
  }

  function queryJson(db: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = db.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) {
      throw new Error("empty_result");
    }
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (typeof raw === "object") return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell");
  }

  function userOf(ctx: nkruntime.Context): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return "";
    return ctx.userId;
  }

  /** Game token claims that game. Any other session claims the hub. */
  function expectedSurface(ctx: nkruntime.Context): string | null {
    var vars = ctx.vars || {};
    if (vars.scope === "game") {
      if (!vars.game || !GAMES[vars.game]) return null;
      return vars.game;
    }
    return "hub";
  }

  function leaseField(body: { [key: string]: unknown }): string {
    var camel = text(body, "leaseId");
    if (camel) return camel;
    return text(body, "lease_id");
  }

  function notifySuperseded(
    logger: nkruntime.Logger,
    db: nkruntime.Nakama,
    userId: string,
    leaseId: string,
    previousLeaseId: string,
    surface: string,
  ): void {
    var sender = db as LeaseDb;
    if (typeof sender.notificationSend !== "function") {
      logger.warn("session_superseded notify unavailable");
      return;
    }
    var content: { [key: string]: string } = {
      leaseId: leaseId,
      previousLeaseId: previousLeaseId,
      surface: surface,
    };
    try {
      sender.notificationSend(userId, SESSION_SUPERSEDED_SUBJECT, content, SESSION_SUPERSEDED_CODE, userId, false);
    } catch (e) {
      logger.warn("session_superseded notify failed " + errorText(e));
    }
  }

  /**
   * For write RPCs. A stale lease writes no row: the SQL function only locks
   * and raises. Returns the typed error, or null when the lease is current.
   * Unexpected database failures still throw.
   */
  export function RequireLease(
    ctx: nkruntime.Context,
    db: nkruntime.Nakama,
    userID: string,
    leaseID: string,
  ): LeaseError | null {
    if (!ctx.userId || ctx.userId !== userID || !UUID.test(userID)) return leaseError("unauthorized");
    if (!UUID.test(leaseID)) return leaseError("session_superseded");
    try {
      var rows = db.sqlQuery("SELECT game.require_lease($1::uuid, $2::uuid)::text AS result", [userID, leaseID]);
      var raw = rows && rows.length ? rows[0].result : null;
      if (raw !== true && raw !== "true" && raw !== "t") return leaseError("session_superseded");
    } catch (e) {
      if (errorText(e).indexOf("session_superseded") >= 0) return leaseError("session_superseded");
      throw e;
    }
    return null;
  }

  export function claim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = userOf(ctx);
    if (!userId) return fail("unauthorized");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var surface = expectedSurface(ctx);
    if (!surface) return fail("not_game_session");
    var requested = text(body, "surface");
    if (requested && requested !== surface) return fail("bad_surface");
    var row = queryJson(
      nk,
      "SELECT game.claim_play_lease($1::uuid, $2::text)::text AS result",
      [userId, surface],
    );
    if (typeof row.error === "string") return fail(row.error);
    var leaseId = text(row, "leaseId");
    if (!UUID.test(leaseId)) throw new Error("empty_result");
    var previousLeaseId = text(row, "previousLeaseId");
    if (row.superseded === true) {
      notifySuperseded(logger, nk, userId, leaseId, previousLeaseId, surface);
      logger.info("play lease superseded user " + userId + " surface " + surface);
    } else {
      logger.info("play lease claimed user " + userId + " surface " + surface);
    }
    return JSON.stringify({
      leaseId: leaseId,
      surface: surface,
      claimedAt: text(row, "claimedAt"),
      heartbeatAt: text(row, "heartbeatAt"),
      previousLeaseId: previousLeaseId || null,
      superseded: row.superseded === true,
      heartbeatSeconds: whole(row.heartbeatSeconds, HEARTBEAT_SECONDS),
      ttlSeconds: whole(row.ttlSeconds, TTL_SECONDS),
    });
  }

  export function heartbeat(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = userOf(ctx);
    if (!userId) return fail("unauthorized");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var leaseId = leaseField(body);
    if (!UUID.test(leaseId)) return fail("session_superseded");
    var row = queryJson(
      nk,
      "SELECT game.heartbeat_play_lease($1::uuid, $2::uuid)::text AS result",
      [userId, leaseId],
    );
    if (typeof row.error === "string") {
      logger.debug("play lease heartbeat rejected user " + userId);
      return fail(row.error);
    }
    return JSON.stringify({
      ok: true,
      leaseId: text(row, "leaseId"),
      heartbeatAt: text(row, "heartbeatAt"),
    });
  }
}
