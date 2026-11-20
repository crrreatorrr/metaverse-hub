// M11 play lease (docs/m11-single-active-tab.md). Compiled and registered: migration 0074 creates
// game.play_lease and InitModule registers session.claim / session.heartbeat. No write RPC calls
// RequireLease yet, so nothing is fenced until clients claim leases and that step is wired.
//
// session.claim runs after the ticket swap. The newest call wins: Postgres
// mints a new lease_id, and the previous holder's socket gets session_superseded.
// session.heartbeat is the 15 second refresh. The 45 second TTL is enforced
// only with Postgres now(), in the play_lease migration.

namespace HubLease {
  /** Keep equal to the intervals in server/modules/migrations/play_lease.sql. */
  export var HEARTBEAT_SECONDS = 15;
  export var TTL_SECONDS = 45;
  export var SESSION_SUPERSEDED_CODE = 1001;
  export var SESSION_SUPERSEDED_SUBJECT = "session_superseded";

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true, "sproto-fighter": true, "sproto-arcade": true, "sproto-shooter": true, "sproto-coop-battle": true, "sproto-open-world": true, vcoin: true };

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

// Statements from server/modules/migrations/play_lease.sql, surfaces widened to every game id.
// Applied: never edit. 0077_sproto_open_world (games/sproto_open_world.ts) adds sproto-open-world.
HubSchema.register({
  id: "0074_play_lease",
  statements: [
    "CREATE SCHEMA IF NOT EXISTS game",
    `CREATE TABLE IF NOT EXISTS game.play_lease (
  user_id uuid PRIMARY KEY,
  lease_id uuid NOT NULL,
  surface text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT play_lease_surface CHECK (
    surface IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'vcoin')
  ),
  CONSTRAINT play_lease_lease_id_key UNIQUE (lease_id)
)`,
    `CREATE OR REPLACE FUNCTION game.claim_play_lease(p_user_id uuid, p_surface text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_prev uuid;
  v_lease uuid;
  v_at timestamptz;
BEGIN
  IF p_surface NOT IN ('hub', 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'vcoin') THEN
    RETURN jsonb_build_object('error', 'bad_surface');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('play_lease:' || p_user_id::text, 0));
  SELECT lease_id INTO v_prev
  FROM game.play_lease
  WHERE user_id = p_user_id
  FOR UPDATE;
  v_lease := gen_random_uuid();
  v_at := now();
  INSERT INTO game.play_lease (user_id, lease_id, surface, claimed_at, heartbeat_at)
  VALUES (p_user_id, v_lease, p_surface, v_at, v_at)
  ON CONFLICT (user_id) DO UPDATE
    SET lease_id = EXCLUDED.lease_id,
        surface = EXCLUDED.surface,
        claimed_at = EXCLUDED.claimed_at,
        heartbeat_at = EXCLUDED.heartbeat_at;
  RETURN jsonb_build_object(
    'ok', true,
    'leaseId', v_lease,
    'surface', p_surface,
    'claimedAt', v_at,
    'heartbeatAt', v_at,
    'previousLeaseId', v_prev,
    'superseded', v_prev IS NOT NULL,
    'heartbeatSeconds', 15,
    'ttlSeconds', 45
  );
END;
$fn$`,
    `CREATE OR REPLACE FUNCTION game.heartbeat_play_lease(p_user_id uuid, p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  UPDATE game.play_lease
     SET heartbeat_at = now()
   WHERE user_id = p_user_id
     AND lease_id = p_lease_id
     AND heartbeat_at >= now() - interval '45 seconds'
  RETURNING heartbeat_at INTO v_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'session_superseded');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'leaseId', p_lease_id,
    'heartbeatAt', v_at
  );
END;
$fn$`,
    `CREATE OR REPLACE FUNCTION game.require_lease(p_user_id uuid, p_lease_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_lease uuid;
  v_heart timestamptz;
BEGIN
  SELECT lease_id, heartbeat_at
    INTO v_lease, v_heart
  FROM game.play_lease
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_lease IS DISTINCT FROM p_lease_id
     OR v_heart < now() - interval '45 seconds' THEN
    RAISE EXCEPTION 'session_superseded' USING ERRCODE = 'P0001';
  END IF;
  RETURN true;
END;
$fn$`,
  ],
});
