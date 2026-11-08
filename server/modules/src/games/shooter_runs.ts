// Authenticated Shooter runs. The server picks the seed, day, loadout, and run id.
// Replay CPU runs only after auth, rate, size, and an issuance row that belongs
// to this account and session. Seen digests and run ids are plain arrays built
// in this call: Nakama turns a Set or Map into an array between callbacks, and
// this RPC does not keep either one.
namespace ShooterRuns {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var KEY = /^[A-Za-z0-9_.:@|-]{1,80}$/;
  var ISSUE_MAX = 4096;
  var SUBMIT_MAX = 2400000;
  var VERIFY_LIMIT = 30;
  var REPLAY_LIMIT = 400;
  var WINDOW_MS = 60000;

  function zero(reason: string): string {
    return JSON.stringify({ ok: false, paid: false, tickets: 0, ticketsMinted: 0, reason: reason });
  }

  function deny(code: string): string {
    return HubRpc.fail(code, code);
  }

  function isObj(value: unknown): value is { [key: string]: unknown } {
    return typeof value === "object" && value !== null && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function parse(payload: string, max: number): { [key: string]: unknown } {
    if (payload && payload.length > max) throw new Error("oversized");
    if (!payload) return {};
    try {
      var data = JSON.parse(payload) as unknown;
      if (!isObj(data)) throw new Error("bad_json");
      return data;
    } catch (e) {
      if (e instanceof Error && (e.message === "bad_json" || e.message === "oversized")) throw e;
      throw new Error("bad_json");
    }
  }

  function shooter(ctx: nkruntime.Context): { userId: string; sid: string } | null {
    if (!ctx.userId || !UUID.test(ctx.userId)) return null;
    var vars = ctx.vars || null;
    if (!vars || vars["scope"] !== "game" || vars["game"] !== ShooterRewards.GAME_ID) return null;
    if (!vars["sid"] || !UUID.test(vars["sid"])) return null;
    return { userId: ctx.userId, sid: vars["sid"] };
  }

  function allow(nk: nkruntime.Nakama, key: string, limit: number): boolean {
    var now = Date.now();
    var raw = nk.localcacheGet(key);
    var start = now;
    var count = 0;
    if (typeof raw === "string") {
      var parts = raw.split(":");
      var parsedStart = Number(parts[0]);
      var parsedCount = Number(parts[1]);
      if (parsedStart && now - parsedStart < WINDOW_MS) {
        start = parsedStart;
        count = parsedCount || 0;
      }
    }
    if (count >= limit) return false;
    nk.localcachePut(key, String(start) + ":" + String(count + 1), Math.ceil(WINDOW_MS / 1000));
    return true;
  }

  function serverDay(nk: nkruntime.Nakama): string {
    var rows = nk.sqlQuery("SELECT to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') AS day", []);
    if (!rows || !rows.length || typeof rows[0].day !== "string") return "";
    return rows[0].day;
  }

  function serverSeed(nk: nkruntime.Nakama): number {
    var hex = nk.sha256Hash(nk.uuidv4()).slice(0, 8);
    var n = parseInt(hex, 16);
    if (!n || n < 1 || n > 4294967295) return 1;
    return n;
  }

  function textCol(rows: { [key: string]: unknown }[] | null, field: string): string {
    if (!rows || !rows.length) return "";
    var value = rows[0][field];
    return typeof value === "string" ? value : "";
  }

  function loadRun(nk: nkruntime.Nakama, userId: string, runId: string): { [key: string]: unknown } | null {
    var rows = nk.sqlQuery(
      "SELECT session_id::text AS session_id, to_char(day, 'YYYY-MM-DD') AS day, canonical_boss, status, issuance_json, checkpoint_json FROM game.shooter_run WHERE run_id = $1 AND user_id = $2::uuid",
      [runId, userId],
    );
    if (!rows || !rows.length) return null;
    return rows[0];
  }

  function seen(nk: nkruntime.Nakama, userId: string): { digests: string[]; runIds: string[] } {
    var digests = nk.sqlQuery("SELECT digest FROM game.shooter_digest WHERE user_id = $1::uuid", [userId]);
    var runs = nk.sqlQuery("SELECT run_id FROM game.shooter_run WHERE user_id = $1::uuid AND status <> 'open'", [userId]);
    return {
      digests: ShooterRewards.column(digests || [], "digest"),
      runIds: ShooterRewards.column(runs || [], "run_id"),
    };
  }

  function storedReceipt(nk: nkruntime.Nakama, userId: string, runId: string): { [key: string]: unknown } | null {
    var row = ShooterRewards.queryJson(
      nk,
      "SELECT response::text AS result FROM game.shooter_receipt WHERE run_id = $1 AND user_id = $2::uuid",
      [runId, userId],
    );
    if (row.error) return null;
    return row;
  }

  export function issue(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var who = shooter(ctx);
    if (!ctx.userId || !UUID.test(ctx.userId || "")) return deny("unauthorized");
    if (!who) return deny("not_game_session");
    if (payload && payload.length > ISSUE_MAX) return zero("oversized");
    var mismatch = ShooterRewards.verifyRuntime();
    if (mismatch) {
      logger.error("shooter pin " + mismatch);
      return deny("version_mismatch");
    }
    if (!allow(nk, "sh:issue:" + who.userId, VERIFY_LIMIT)) return deny("rate_limited");
    var body = parse(payload || "", ISSUE_MAX);
    var blocked = ["seed", "loadout", "accountId", "sessionId", "day", "profile", "guns", "loot", "inventory", "checkpoint", "state", "resume", "protocol", "contentFingerprint"];
    for (var i = 0; i < blocked.length; i++) {
      if (Object.prototype.hasOwnProperty.call(body, blocked[i])) {
        var why = blocked[i] === "seed" ? "forged_seed" : "injected_inventory";
        if (blocked[i] === "checkpoint" || blocked[i] === "state" || blocked[i] === "resume") why = "bad_checkpoint";
        return zero(why);
      }
    }
    var key = typeof body.key === "string" ? body.key : "";
    var boss = typeof body.canonicalBoss === "string" ? body.canonicalBoss : "";
    if (!KEY.test(key)) return deny("bad_key");
    if (!boss) return zero("malformed");
    var day = serverDay(nk);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) return zero("malformed");
    var runId = nk.uuidv4();
    var seed = serverSeed(nk);
    var built = ShooterRewards.api().buildIssuance({
      accountId: who.userId,
      sessionId: who.sid,
      day: day,
      runId: runId,
      seed: seed,
      canonicalBoss: boss,
    });
    if (built.ok !== true || built.ticketsMinted !== 0 || !isObj(built.issuance)) {
      return zero(typeof built.reason === "string" ? built.reason : "malformed");
    }
    var issuance = built.issuance;
    if (issuance.contentFingerprint !== ShooterRewards.FINGERPRINT || issuance.accountId !== who.userId || issuance.sessionId !== who.sid) {
      return zero("fingerprint_mismatch");
    }
    var result = ShooterRewards.issue(nk, who.userId, who.sid, key, runId, day, boss, seed, JSON.stringify(issuance));
    if (result.error) return JSON.stringify(result);
    logger.info("shooter issue " + boss + " user " + who.userId);
    return JSON.stringify(result);
  }

  export function submit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var who = shooter(ctx);
    if (!ctx.userId || !UUID.test(ctx.userId || "")) return deny("unauthorized");
    if (!who) return deny("not_game_session");
    if (payload && payload.length > SUBMIT_MAX) return zero("oversized");
    var mismatch = ShooterRewards.verifyRuntime();
    if (mismatch) {
      logger.error("shooter pin " + mismatch);
      return deny("version_mismatch");
    }
    var body = parse(payload || "", SUBMIT_MAX);
    var runId = typeof body.runId === "string" ? body.runId : "";
    if (!UUID.test(runId)) return zero("malformed");
    if (!isObj(body.log)) return zero("malformed");
    var row = loadRun(nk, who.userId, runId);
    if (!row) return zero("unknown_run");
    if (textCol([row], "session_id") !== who.sid) return zero("rebind");
    var status = textCol([row], "status");
    var limit = status === "open" ? VERIFY_LIMIT : REPLAY_LIMIT;
    if (!allow(nk, "sh:submit:" + who.userId + ":" + (status === "open" ? "open" : "replay"), limit)) return deny("rate_limited");
    var issuanceText = textCol([row], "issuance_json");
    var issuance: unknown;
    try {
      issuance = JSON.parse(issuanceText) as unknown;
    } catch (err) {
      logger.warn("shooter issuance " + String(err));
      return zero("bad_start");
    }
    if (!isObj(issuance)) return zero("bad_start");
    var prior = seen(nk, who.userId);
    var resume: { [key: string]: unknown } | null = null;
    var segments = body.log.segments;
    var firstFrom: unknown = null;
    if (Object.prototype.toString.call(segments) === "[object Array]" && (segments as unknown[]).length) {
      var first = (segments as unknown[])[0];
      if (isObj(first)) firstFrom = first.from;
    }
    if (firstFrom != null) {
      var checkpointText = textCol([row], "checkpoint_json");
      if (!checkpointText) return zero("bad_checkpoint");
      var parsed: unknown;
      try {
        parsed = JSON.parse(checkpointText) as unknown;
      } catch (err) {
        logger.warn("shooter checkpoint " + String(err));
        return zero("bad_checkpoint");
      }
      if (!isObj(parsed)) return zero("bad_checkpoint");
      resume = parsed;
    }
    var ctxVerify: { [key: string]: unknown } = {
      issuance: issuance,
      accountId: who.userId,
      sessionId: who.sid,
      day: textCol([row], "day"),
      seenDigests: prior.digests,
      seenRunIds: prior.runIds,
    };
    if (resume) ctxVerify.resume = resume;
    var receipt = ShooterRewards.api().verifyRun(body.log, ctxVerify);
    var cpu = typeof receipt.cpuMs === "number" ? receipt.cpuMs : 0;
    logger.info("shooter verify " + String(receipt.reason || "") + " cpuMs " + String(cpu) + " boss " + String(receipt.canonicalBoss || "") + " user " + who.userId);
    if (receipt.ticketsMinted !== 0) return zero("mint_refused");
    if (receipt.reason === "reused_log" || receipt.reason === "reused_run") {
      var stored = storedReceipt(nk, who.userId, runId);
      if (stored && stored.paid === true) return JSON.stringify(stored);
      return zero(String(receipt.reason));
    }
    if (receipt.ok !== true) return zero(typeof receipt.reason === "string" ? receipt.reason : "malformed");
    var digest = typeof receipt.logDigest === "string" ? receipt.logDigest : "";
    if (!digest) return zero("malformed");
    if (ShooterRewards.payable(receipt)) {
      var frames = typeof receipt.frames === "number" ? receipt.frames : 0;
      if (!frames || frames < 1) return zero("malformed");
      var clearMs = Math.round(frames * 1000 / 60);
      var stateHash = typeof receipt.stateHash === "string" ? receipt.stateHash : "";
      var boss = String(receipt.canonicalBoss || "");
      var day = textCol([row], "day");
      var reqHash = nk.sha256Hash("shooter.settle\n" + runId + "\n" + digest + "\n" + boss + "\n" + day);
      var settled = ShooterRewards.settle(nk, who.userId, who.sid, runId, boss, day, digest, stateHash, clearMs, reqHash);
      if (settled.paid === true) HubFault.apply(ctx, nk, who.userId, "shooter.after_commit");
      logger.info("shooter settle paid " + String(settled.paid) + " tickets " + String(settled.tickets) + " user " + who.userId);
      return JSON.stringify(settled);
    }
    if (receipt.outcome === "incomplete" && isObj(receipt.checkpoint)) {
      var checkpoint = receipt.checkpoint;
      var hash = typeof checkpoint.hash === "string" ? checkpoint.hash : "";
      var tick = typeof checkpoint.tick === "number" ? checkpoint.tick : 0;
      var saved = ShooterRewards.saveCheckpoint(nk, who.userId, runId, digest, JSON.stringify(checkpoint), hash, tick);
      return JSON.stringify(saved);
    }
    var closed = ShooterRewards.closeRun(nk, who.userId, runId, digest, typeof receipt.reason === "string" ? receipt.reason : "rejected");
    return JSON.stringify(closed);
  }
}

function rpcShooterRunIssue(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(ShooterRuns.issue, ctx, logger, nk, payload);
}

function rpcShooterRunSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(ShooterRuns.submit, ctx, logger, nk, payload);
}
