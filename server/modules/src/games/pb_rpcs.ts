// pb.worlds (Contract C1): the numbered world list for The People's Bitcoin's
// world select. Worlds 1..PB_WORLDS (env, default 2) always exist; when every
// live world is past 90% full, the next number opens. The registry rows
// `pb_registry/world-<n>` (system user) are the source of truth, because a new
// match shows in matchList only about a second after matchCreate (C7). Racing
// creates are settled by the row's OCC version; the loser's empty match closes
// itself (pb_world.ts).

namespace PbRpcs {
  var DEFAULT_WORLDS = 2;
  var MAX_PLAYERS = 100;
  var OVERFLOW_AT = 0.9;
  /** Never open more than this many worlds on one node. */
  var HARD_CAP = 50;

  export interface WorldRow {
    world: number;
    matchId: string;
    players: number;
    max: number;
    sim: string;
  }

  function wanted(ctx: nkruntime.Context): number {
    var raw = ctx.env ? Number(ctx.env["PB_WORLDS"]) : NaN;
    return isFinite(raw) && raw >= 1 ? Math.min(HARD_CAP, Math.floor(raw)) : DEFAULT_WORLDS;
  }

  function readRow(nk: nkruntime.Nakama, n: number): nkruntime.StorageObject | null {
    var rows = nk.storageRead([{ collection: PbWorld.REGISTRY.collection, key: "world-" + n, userId: PbWorld.SYSTEM_USER }]);
    return rows.length ? rows[0] : null;
  }

  /** The live match for world n, creating and registering one if needed. */
  export function ensureWorld(nk: nkruntime.Nakama, logger: nkruntime.Logger, n: number): string {
    for (var attempt = 0; attempt < 3; attempt++) {
      var row = readRow(nk, n);
      var id = row ? String((row.value as { matchId?: string }).matchId || "") : "";
      if (id && nk.matchGet(id)) return id;
      var created = nk.matchCreate(PbWorld.MATCH_NAME, { world: n });
      try {
        nk.storageWrite([
          {
            collection: PbWorld.REGISTRY.collection,
            key: "world-" + n,
            userId: PbWorld.SYSTEM_USER,
            value: { matchId: created, world: n },
            version: row ? row.version : "*",
            permissionRead: 0,
            permissionWrite: 0,
          },
        ]);
        logger.info("[pb.worlds] world " + n + " is " + created);
        return created;
      } catch (e) {
        // Someone else registered it first; use theirs (ours closes once empty).
        logger.warn("[pb.worlds] world " + n + " race: " + String(e));
      }
    }
    var final = readRow(nk, n);
    return final ? String((final.value as { matchId?: string }).matchId || "") : "";
  }

  function highestRegistered(nk: nkruntime.Nakama, from: number): number {
    var n = from;
    while (n < HARD_CAP && readRow(nk, n + 1)) n++;
    return n;
  }

  export function rpcWorlds(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!ctx.userId) throw new Error("unauthenticated");
    var count = highestRegistered(nk, wanted(ctx));
    var out: WorldRow[] = [];
    var allBusy = true;
    for (var n = 1; n <= count; n++) {
      var id = ensureWorld(nk, logger, n);
      var m = id ? nk.matchGet(id) : null;
      var size = m ? m.size : 0;
      if (size < MAX_PLAYERS * OVERFLOW_AT) allBusy = false;
      out.push({ world: n, matchId: id, players: size, max: MAX_PLAYERS, sim: PB_SIM_VERSION });
    }
    if (allBusy && count < HARD_CAP) {
      var next = count + 1;
      var nextId = ensureWorld(nk, logger, next);
      out.push({ world: next, matchId: nextId, players: 0, max: MAX_PLAYERS, sim: PB_SIM_VERSION });
    }
    return JSON.stringify({ worlds: out, sim: PB_SIM_VERSION });
  }
}

namespace PbRpcs {
  /**
   * Development only (answers only when PB_DEV_RPCS=1): runs PB's world bench
   * inside this runtime and returns the phase timings, to size worlds on a node.
   */
  export function rpcBench(ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.env || ctx.env["PB_DEV_RPCS"] !== "1") throw new Error("not_found");
    if (!ctx.userId) throw new Error("unauthenticated");
    var body = payload ? (JSON.parse(payload) as { players?: number; ticks?: number; walk?: number }) : {};
    var players = Math.max(1, Math.min(100, Math.floor(Number(body.players) || 100)));
    var ticks = Math.max(1, Math.min(200, Math.floor(Number(body.ticks) || 30)));
    var walk = Math.max(0, Math.min(1, Number(body.walk) || 0));
    var result = PbSim.benchWorld(players, ticks, walk, function () {
      return Date.now();
    });
    return JSON.stringify({ players: players, ticks: ticks, walk: walk, result: result, sim: PB_SIM_VERSION });
  }
}

function rpcPbBench(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return PbRpcs.rpcBench(ctx, logger, nk, payload);
}

function rpcPbWorlds(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return PbRpcs.rpcWorlds(ctx, logger, nk, payload);
}
