// Drain RPCs for deploy-server.sh. The http key calls them (no user id).
// maint.begin refuses new duel, arena, coop, Shooter and Racer matches until maint.end
// or the deadline. Matches that already exist keep running. coop.resume stays open.
// The plaza and People's Bitcoin worlds are not hard matches.

namespace Maint {
  var KEY = "maint:drain";

  interface State {
    reason: string;
    deadline: number;
  }

  function read(nk: nkruntime.Nakama): State | null {
    var raw = nk.localcacheGet(KEY);
    if (typeof raw !== "string" || !raw) return null;
    try {
      var parsed = JSON.parse(raw) as { reason?: string; deadline?: number };
      if (!parsed || typeof parsed.deadline !== "number") return null;
      if (parsed.deadline <= Math.floor(Date.now() / 1000)) {
        nk.localcacheDelete(KEY);
        return null;
      }
      return { reason: typeof parsed.reason === "string" ? parsed.reason : "", deadline: parsed.deadline };
    } catch (e) {
      return null;
    }
  }

  /** True while a deploy drain is in force. */
  export function on(nk: nkruntime.Nakama): boolean {
    return read(nk) !== null;
  }

  /** JSON error for an RPC, or null when new matches are allowed. */
  export function deny(nk: nkruntime.Nakama): string | null {
    if (!on(nk)) return null;
    return JSON.stringify({ error: "maintenance", message: "Maintenance. Try again after the restart." });
  }

  function serverOnly(ctx: nkruntime.Context): string | null {
    if (ctx.userId) return JSON.stringify({ error: "unauthorized", message: "Server only" });
    return null;
  }

  export function begin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = serverOnly(ctx);
    if (denied) return denied;
    var body: { reason?: string; deadline?: number } = {};
    try {
      body = JSON.parse(payload || "{}") as { reason?: string; deadline?: number };
    } catch (e) {
      return JSON.stringify({ error: "bad_json", message: "Bad request" });
    }
    var deadline = Number(body.deadline);
    if (!deadline || deadline <= Math.floor(Date.now() / 1000)) {
      return JSON.stringify({ error: "bad_deadline", message: "Deadline must be in the future" });
    }
    var reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
    var ttl = Math.max(1, deadline - Math.floor(Date.now() / 1000));
    nk.localcachePut(KEY, JSON.stringify({ reason: reason, deadline: deadline }), ttl);
    return JSON.stringify({ ok: true, reason: reason, deadline: deadline });
  }

  export function end(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = serverOnly(ctx);
    if (denied) return denied;
    nk.localcacheDelete(KEY);
    return JSON.stringify({ ok: true });
  }

  type Kind = "duel" | "arena" | "coop" | "shooter" | "racer";

  // The kind of a listed match, read from its label. Nakama 3.41 gives a module a match's id,
  // size and label and nothing else: no handler name. "" is a match the drain does not wait
  // for (the plaza, People's Bitcoin worlds, arcade coop). null is the wager sweep, which is
  // the server's own timer and not a match anybody plays.
  // A duel's label has a game and no kind (sproto_duel.ts matchInit), so it is told by the game.
  function kindOf(label: string): Kind | "" | null {
    var parsed: { kind?: unknown; game?: unknown } | null = null;
    try {
      parsed = JSON.parse(label) as { kind?: unknown; game?: unknown } | null;
    } catch (e) {
      return "";
    }
    if (!parsed || typeof parsed !== "object") return "";
    var kind = typeof parsed.kind === "string" ? parsed.kind : "";
    if (kind === SprotoArena.KIND) return "arena";
    if (kind === CoopProto.KIND) return "coop";
    if (kind === ShooterProto.KIND) return "shooter";
    if (kind === RacerProto.KIND) return "racer";
    if (kind === ShooterWagers.SWEEP_MATCH) return null;
    if (!kind && parsed.game === SprotoDuel.GAME_ID) return "duel";
    return "";
  }

  export function live(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = serverOnly(ctx);
    if (denied) return denied;
    var kinds = { duel: 0, arena: 0, coop: 0, shooter: 0, racer: 0 };
    var hard = 0;
    var soft = 0;
    var listed = nk.matchList(1000, true, null, null, null, null) || [];
    for (var i = 0; i < listed.length; i++) {
      var row = listed[i];
      if (!row || !(row.size > 0)) continue;
      var kind = kindOf(String(row.label || ""));
      if (kind) {
        kinds[kind] += 1;
        hard += 1;
      } else if (kind === "") {
        soft += 1;
      }
    }
    return JSON.stringify({ hard: hard, soft: soft, kinds: kinds });
  }
}

function rpcMaintBegin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return Maint.begin(ctx, logger, nk, payload);
}

function rpcMaintLive(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return Maint.live(ctx, logger, nk, payload);
}

function rpcMaintEnd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return Maint.end(ctx, logger, nk, payload);
}
