// Placement over sharded authoritative matches (hub plaza; PB may reuse it).
// Policy is least-full open instance (Contract C7). A match created by
// nk.matchCreate is listable only about 1 s later, so place() returns the id it
// created; two racing creates are tolerated (the spare shard closes when empty).
namespace HubShards {
  export interface PlaceOptions {
    /** registerMatch name, e.g. "hub". */
    module: string;
    /** label.kind, e.g. "hub". */
    kind: string;
    max: number;
    /** Placement stops at this size; the rest is headroom for friends and reconnects. */
    softMax: number;
    /** Extra matchCreate params (strings). `shard` is added. */
    params?: { [k: string]: string };
    /** Keep a player in this match when it is still open and below softMax. */
    preferMatchId?: string;
  }

  export interface Placement {
    matchId: string;
    shard: number;
    created: boolean;
  }

  function labelShard(label: string): number {
    try {
      var parsed = JSON.parse(label) as { shard?: unknown };
      var n = typeof parsed.shard === "number" ? parsed.shard : Number(parsed.shard);
      return isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch (_e) {
      return 0;
    }
  }

  function labelOpen(label: string): boolean {
    try {
      return (JSON.parse(label) as { open?: unknown }).open === true;
    } catch (_e) {
      return false;
    }
  }

  export function place(nk: nkruntime.Nakama, logger: nkruntime.Logger, opts: PlaceOptions): Placement {
    var softMax = Math.max(1, Math.min(opts.softMax, opts.max));
    var all = nk.matchList(1000, true, null, null, null, "+label.kind:" + opts.kind) || [];
    var highest = 0;
    var best: nkruntime.Match | null = null;
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      var shard = labelShard(m.label);
      if (shard > highest) highest = shard;
      if (!labelOpen(m.label) || m.size >= softMax) continue;
      if (opts.preferMatchId && m.matchId === opts.preferMatchId) {
        return { matchId: m.matchId, shard: shard, created: false };
      }
      if (!best || m.size < best.size || (m.size === best.size && shard < labelShard(best.label))) best = m;
    }
    if (best) return { matchId: best.matchId, shard: labelShard(best.label), created: false };
    var next = highest + 1;
    var params: { [k: string]: string } = {};
    if (opts.params) {
      var keys = Object.keys(opts.params);
      for (var k = 0; k < keys.length; k++) params[keys[k]] = opts.params[keys[k]];
    }
    params.shard = String(next);
    var id = nk.matchCreate(opts.module, params);
    logger.info("shard created " + opts.kind + " " + String(next) + " " + id);
    return { matchId: id, shard: next, created: true };
  }
}
