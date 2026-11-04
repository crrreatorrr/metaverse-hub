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

  /** A created match is listable only ~1 s later; remember it node-wide for this long. */
  export var RECENT_MS = 5000;

  interface Recent {
    id: string;
    shard: number;
    at: number;
    placed: number;
  }

  function readRecent(nk: nkruntime.Nakama, key: string, now: number): Recent[] {
    var raw = nk.localcacheGet(key);
    if (typeof raw !== "string" || !raw) return [];
    try {
      var list = JSON.parse(raw) as Recent[];
      var out: Recent[] = [];
      for (var i = 0; i < list.length; i++) if (list[i] && now - list[i].at < RECENT_MS) out.push(list[i]);
      return out;
    } catch (_e) {
      return [];
    }
  }

  export function place(nk: nkruntime.Nakama, logger: nkruntime.Logger, opts: PlaceOptions): Placement {
    var softMax = Math.max(1, Math.min(opts.softMax, opts.max));
    var now = Date.now();
    var recentKey = "shards:recent:" + opts.kind;
    var recent = readRecent(nk, recentKey, now);
    var all = nk.matchList(1000, true, null, null, null, "+label.kind:" + opts.kind) || [];
    var listed: { [id: string]: boolean } = {};
    var highest = 0;
    var bestId = "";
    var bestShard = 0;
    var bestSize = Infinity;
    var bestRecent: Recent | null = null;
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      listed[m.matchId] = true;
      var shard = labelShard(m.label);
      if (shard > highest) highest = shard;
      if (!labelOpen(m.label) || m.size >= softMax) continue;
      if (opts.preferMatchId && m.matchId === opts.preferMatchId) {
        return { matchId: m.matchId, shard: shard, created: false };
      }
      if (m.size < bestSize || (m.size === bestSize && shard < bestShard)) {
        bestId = m.matchId;
        bestShard = shard;
        bestSize = m.size;
        bestRecent = null;
      }
    }
    // Shards created in the last few seconds that the listing does not show yet.
    for (var r = 0; r < recent.length; r++) {
      var rec = recent[r];
      if (rec.shard > highest) highest = rec.shard;
      if (listed[rec.id] || rec.placed >= softMax) continue;
      if (rec.placed < bestSize || (rec.placed === bestSize && rec.shard < bestShard)) {
        bestId = rec.id;
        bestShard = rec.shard;
        bestSize = rec.placed;
        bestRecent = rec;
      }
    }
    if (bestId) {
      if (bestRecent) {
        bestRecent.placed++;
        nk.localcachePut(recentKey, JSON.stringify(recent), Math.ceil(RECENT_MS / 1000));
      }
      return { matchId: bestId, shard: bestShard, created: false };
    }
    var next = highest + 1;
    var params: { [k: string]: string } = {};
    if (opts.params) {
      var keys = Object.keys(opts.params);
      for (var k = 0; k < keys.length; k++) params[keys[k]] = opts.params[keys[k]];
    }
    params.shard = String(next);
    var id = nk.matchCreate(opts.module, params);
    recent.push({ id: id, shard: next, at: now, placed: 1 });
    nk.localcachePut(recentKey, JSON.stringify(recent), Math.ceil(RECENT_MS / 1000));
    logger.info("shard created " + opts.kind + " " + String(next) + " " + id);
    return { matchId: id, shard: next, created: true };
  }
}
