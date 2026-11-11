// Bounded durable input ingestion. These RPCs never run a simulator or pay.
// V2 issuance is deliberately absent; admission starts disabled in migration 0051.
namespace ShooterVerification {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var APPEND_KEYS = ["protocol", "runId", "sequence", "tick0", "n", "frames", "actions"];
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  export function failure(state: string, reason: string): string {
    return JSON.stringify({ protocol: 2, state: state, reason: reason, ticketsMinted: 0 });
  }

  function object(value: unknown): value is { [key: string]: unknown } {
    return value !== null && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function integer(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= min && value <= max;
  }

  function cheapLimit(nk: nkruntime.Nakama, key: string, limit: number): boolean {
    // Best effort per node only. Durable SQL rate limits remain authoritative.
    var minute = Math.floor(Date.now() / 60000);
    var raw = nk.localcacheGet(key);
    var count = 0;
    if (typeof raw === "string") {
      var parts = raw.split(":");
      if (Number(parts[0]) === minute) count = Number(parts[1]) || 0;
    }
    if (count >= limit) return false;
    nk.localcachePut(key, String(minute) + ":" + String(count + 1), 60);
    return true;
  }

  function parse(nk: nkruntime.Nakama, payload: string, max: number): { [key: string]: unknown } | null {
    // UTF-16 length is only a cheap lower bound; enforce actual UTF-8 bytes too.
    if (!payload || payload.length > max || nk.stringToBinary(payload).byteLength > max) return null;
    try {
      var body = JSON.parse(payload) as unknown;
      return object(body) ? body : null;
    } catch (_e) { return null; }
  }

  function exact(body: { [key: string]: unknown }, keys: string[]): boolean {
    var fields = Object.keys(body);
    if (fields.length !== keys.length) return false;
    for (var i = 0; i < fields.length; i++) if (keys.indexOf(fields[i]) < 0) return false;
    return true;
  }

  function gameUser(ctx: nkruntime.Context): { user: string; session: string } | null {
    var vars = ctx.vars;
    if (!ctx.userId || !UUID.test(ctx.userId) || !vars || vars.scope !== "game"
      || vars.game !== "sproto-shooter" || !vars.sid || !UUID.test(vars.sid)) return null;
    return { user: ctx.userId, session: vars.sid };
  }

  function canonicalFrames(frames: string, n: number): boolean {
    if (frames.length !== n * 16 || frames.length > 2097152 || !/^[A-Za-z0-9+/]+$/.test(frames)) return false;
    // Twelve raw bytes/frame are divisible by three: canonical encoding has no padding.
    for (var at = 0; at < frames.length; at += 16) {
      var bytes: number[] = [];
      for (var q = 0; q < 16; q += 4) {
        var a = B64.indexOf(frames.charAt(at + q));
        var b = B64.indexOf(frames.charAt(at + q + 1));
        var c = B64.indexOf(frames.charAt(at + q + 2));
        var d = B64.indexOf(frames.charAt(at + q + 3));
        bytes.push((a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d);
      }
      if ((bytes[0] === 0 && bytes[1] === 128) || (bytes[2] === 0 && bytes[3] === 128)
        || bytes[4] === 128 || bytes[5] === 128
        || !(bytes[10] <= 4 || bytes[10] === 255)
        || !(bytes[11] <= 4 || bytes[11] >= 252)) return false;
    }
    return true;
  }

  function canonicalActions(value: unknown, n: number): value is number[][] {
    if (Object.prototype.toString.call(value) !== "[object Array]") return false;
    var rows = value as unknown[];
    if (rows.length > 32) return false;
    var previous = -1;
    for (var i = 0; i < rows.length; i++) {
      if (Object.prototype.toString.call(rows[i]) !== "[object Array]") return false;
      var row = rows[i] as unknown[];
      if (row.length !== 2 || !integer(row[0], 0, n - 1) || row[0] <= previous || row[1] !== 1) return false;
      previous = row[0];
    }
    return true;
  }

  export function append(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var who = gameUser(ctx);
    if (!who) return failure("authorization_denied", "not_game_session");
    if (!cheapLimit(nk, "sh:v2:append:global", 2400) || !cheapLimit(nk, "sh:v2:append:" + who.user, 240)) {
      return failure("pending_retryable", "rate_limited");
    }
    var body = parse(nk, payload, 2162688);
    if (!body || !exact(body, APPEND_KEYS) || body.protocol !== 2 || typeof body.runId !== "string" || !UUID.test(body.runId)
      || !integer(body.sequence, 0, 4095) || !integer(body.tick0, 0, 161999) || !integer(body.n, 1, 28800)
      || body.tick0 + body.n > 162000 || typeof body.frames !== "string" || body.frames.length > 2097152) {
      return failure("invalid", "malformed");
    }
    var ready = ShooterRewards.queryJson(nk, "SELECT game.shooter_verification_preflight($1::uuid,$2::uuid,$3::text)::text AS result", [who.user, who.session, body.runId]);
    if (ready.state !== "ready") return JSON.stringify(ready);
    if (!canonicalFrames(body.frames, body.n) || !canonicalActions(body.actions, body.n)) return failure("invalid", "malformed");
    var canonical = JSON.stringify({ actions: body.actions, frames: body.frames, n: body.n, protocol: 2, runId: body.runId, sequence: body.sequence, tick0: body.tick0 });
    var digest = nk.sha256Hash(canonical);
    var result = ShooterRewards.queryJson(nk,
      "SELECT game.shooter_verification_append($1::uuid,$2::uuid,$3::text,$4::int,$5::int,$6::int,$7::text,$8::jsonb,$9::text)::text AS result",
      [who.user, who.session, body.runId, body.sequence, body.tick0, body.n, body.frames, JSON.stringify(body.actions), digest]);
    if (result.state === "received") HubFault.apply(ctx, nk, who.user, "shooter.append.after_commit");
    return JSON.stringify(result);
  }

  export function status(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId) || (ctx.vars && ctx.vars.scope === "game" && ctx.vars.game !== "sproto-shooter")) {
      return failure("authorization_denied", "unauthorized");
    }
    if (!cheapLimit(nk, "sh:v2:status:" + ctx.userId, 120)) return failure("pending_retryable", "rate_limited");
    var body = parse(nk, payload, 4096);
    if (!body || typeof body.runId !== "string" || !UUID.test(body.runId)
      || !(exact(body, ["runId"]) || exact(body, ["runId", "sequence"]))
      || (body.sequence !== undefined && !integer(body.sequence, 0, 4095))) return failure("invalid", "malformed");
    var result = ShooterRewards.queryJson(nk, `SELECT jsonb_build_object(
      'protocol',2,'runId',r.run_id,'state',r.lifecycle,'revision',r.revision,
      'operational',CASE WHEN r.operational_reason IN ('attempts_exhausted','predecessor_mismatch') THEN jsonb_build_object('state','pending_retryable','reason',r.operational_reason,'supportRequired',true) ELSE NULL END,
      'received',jsonb_build_object('sequence',r.accepted_sequence,'tick',r.accepted_tick,'bytes',r.accepted_bytes,'actions',r.accepted_actions,'batches',r.accepted_batches),
      'verified',jsonb_build_object('sequence',r.verified_sequence,'tick',r.verified_tick,'simulationTick',r.simulation_tick,'bytes',r.verified_bytes,'batches',r.verified_batches),
      'terminal',CASE WHEN r.terminal_tick IS NULL THEN NULL ELSE jsonb_build_object('tick',r.terminal_tick,'outcome',r.terminal_outcome,'canonicalBoss',old.canonical_boss) END,
      'payment',CASE WHEN paid.run_id IS NOT NULL THEN jsonb_build_object('state','paid','tickets',paid.tickets)
        WHEN r.payment_state='paid' THEN jsonb_build_object('state','pending_retryable','reason','receipt_unavailable')
        ELSE jsonb_build_object('state',r.payment_state,'reason',CASE WHEN r.payment_reason IN ('session_expired','session_closed','revoked','cap_exhausted','ineligible') THEN r.payment_reason ELSE NULL END) END,
      'authorization',CASE WHEN s.state<>'open' OR s.ticket_redeemed_at IS NULL THEN 'session_closed'
        WHEN s.lease_until<=clock_timestamp() THEN 'session_expired' WHEN r.upload_deadline<=clock_timestamp() THEN 'upload_expired' ELSE 'live' END,
      'receivedAck',(SELECT b.received_ack FROM game.shooter_verification_batch b WHERE b.run_id=r.run_id AND b.sequence=$3::int)
      )::text AS result FROM game.shooter_verification_run r
      JOIN game.shooter_run old ON old.run_id=r.run_id AND old.user_id=r.user_id
      JOIN game.game_session s ON s.session_id=r.session_id AND s.user_id=r.user_id
      LEFT JOIN game.shooter_receipt paid ON paid.run_id=r.run_id AND paid.user_id=r.user_id
      WHERE r.run_id=$1::text AND r.user_id=$2::uuid`, [body.runId, ctx.userId, body.sequence === undefined ? null : body.sequence]);
    return result.error ? failure("invalid", "unknown_run") : JSON.stringify(result);
  }
}

function rpcShooterRunAppend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(ShooterVerification.append, ctx, logger, nk, payload);
}
function rpcShooterRunStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(ShooterVerification.status, ctx, logger, nk, payload);
}
