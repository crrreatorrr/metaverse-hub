// Feature flags (plan R.12.2, migration 0042_server_flags). Launch work merges with
// its flag off; turning a flag off is the first rollback, with no deploy.
//
//   if (Flags.on(nk, "shooter_pvp", ctx.userId, logger)) { ... }
//   if (Flags.on(nk, "maint", ctx.userId, logger, { onReadError: true })) { ... }  // maint: pass the safe default
//
// Each key buckets users on its own, so a nested rollout (shooter_pvp_wager inside
// shooter_pvp) must gate on both flags: a wager cohort is not a subset of the pvp cohort.
//
// Rows are changed by the owner in SQL; this module never writes game.server_flags:
//   UPDATE game.server_flags SET state = 'allowlist', allowlist = '{<uuid>}', updated_at = now() WHERE key = 'shooter_pvp';
//   UPDATE game.server_flags SET state = 'percent', percent = 10, updated_at = now() WHERE key = 'shooter_pvp';
// A change is seen within FLAG_CACHE_MS. Nothing reads a flag yet (HUB-W-1-04).

namespace Flags {
  /** The launch flags seeded by 0042, all off. */
  export var LAUNCH_FLAGS = [
    "shooter_pvp",
    "shooter_pvp_wager",
    "shooter_pvp_ranked",
    "hub_exchange",
    "verse_store",
    "diagnostics_prompt",
    "maint",
  ];

  /** How long one node reuses a flag row (node-wide localcache). */
  export var FLAG_CACHE_MS = 5000;

  var KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
  var CACHE_PREFIX = "flag:";
  var ROW_SQL = "SELECT jsonb_build_object('state', state, 'allowlist', to_json(allowlist), 'percent', percent)::text AS result"
    + " FROM game.server_flags WHERE key = $1";

  interface FlagRow {
    state: string;
    allowlist: string[];
    percent: number;
  }

  var OFF: FlagRow = { state: "off", allowlist: [], percent: 0 };

  export interface OnOptions {
    /**
     * The answer when the row cannot be read (DB error). Default false. A flag whose
     * safe state is "on", like `maint`, must pass true so a DB outage fails closed.
     */
    onReadError?: boolean;
  }

  var clock: () => number = function () { return Date.now(); };

  /** Tests only: replace the cache clock (null restores Date.now). */
  export function _setClockForTest(now: (() => number) | null): void {
    clock = now || function () { return Date.now(); };
  }

  /**
   * Stable rollout bucket 0..99 for this key and user: FNV-1a (32-bit) of "<key>:<userId>"
   * (user id lowercased). Per key, so each flag's percent picks its own cohort.
   */
  export function bucket(key: string, userId: string): number {
    var input = key + ":" + String(userId || "").toLowerCase();
    var h = 0x811c9dc5;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i) & 0xff;
      h ^= (input.charCodeAt(i) >>> 8) & 0xff;
      // h *= 16777619 (FNV prime), without Math.imul.
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h % 100;
  }

  function asRow(raw: unknown): FlagRow {
    var body = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!body || typeof body !== "object") return OFF;
    var b = body as { [k: string]: unknown };
    var list: string[] = [];
    if (Object.prototype.toString.call(b["allowlist"]) === "[object Array]") {
      var items = b["allowlist"] as unknown[];
      for (var i = 0; i < items.length; i++) if (typeof items[i] === "string") list.push((items[i] as string).toLowerCase());
    }
    var pct = Number(b["percent"]);
    return { state: String(b["state"] || "off"), allowlist: list, percent: isFinite(pct) ? pct : 0 };
  }

  /** The row for key, from the node cache when it is younger than FLAG_CACHE_MS. A read error returns null (not cached). */
  function read(nk: nkruntime.Nakama, logger: nkruntime.Logger | null, key: string, nowMs: number): FlagRow | null {
    var cacheKey = CACHE_PREFIX + key;
    try {
      var cached = nk.localcacheGet(cacheKey);
      if (typeof cached === "string" && cached) {
        var hit = JSON.parse(cached) as { at: number; row: FlagRow };
        if (hit && typeof hit.at === "number" && nowMs - hit.at >= 0 && nowMs - hit.at < FLAG_CACHE_MS) return hit.row;
      }
    } catch (_e) {
      // A bad cache entry is read again from the table.
    }
    var row: FlagRow;
    try {
      var rows = nk.sqlQuery(ROW_SQL, [key]);
      row = rows && rows.length ? asRow(rows[0].result) : OFF;
    } catch (e) {
      if (logger) logger.warn("server flag " + key + " read failed " + String(e));
      return null;
    }
    try {
      nk.localcachePut(cacheKey, JSON.stringify({ at: nowMs, row: row }), Math.ceil(FLAG_CACHE_MS / 1000) + 1);
    } catch (_e) {
      // Uncached is still correct.
    }
    return row;
  }

  /**
   * Is the flag on for this user? off: no. on: yes. allowlist: userId is listed.
   * percent: listed, or bucket(key, userId) < percent. An unknown key, a missing row
   * or an unknown state is off. A failed read returns opts.onReadError (default false).
   */
  export function on(nk: nkruntime.Nakama, key: string, userId: string, logger?: nkruntime.Logger, opts?: OnOptions): boolean {
    if (typeof key !== "string" || !KEY_RE.test(key)) return false;
    var row = read(nk, logger || null, key, clock());
    if (!row) return !!(opts && opts.onReadError);
    if (row.state === "on") return true;
    if (row.state !== "allowlist" && row.state !== "percent") return false;
    var uid = String(userId || "").toLowerCase();
    if (!uid) return false;
    if (row.allowlist.indexOf(uid) >= 0) return true;
    if (row.state === "percent") return bucket(key, uid) < row.percent;
    return false;
  }
}
