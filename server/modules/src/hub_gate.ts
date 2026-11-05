// Hub item gates (migration 0034_hub_gate). Read-only: this file never inserts,
// updates, or deletes. checkGate grants nothing and writes nothing.
//
// Ownership is game.owned_item_ids: starters ∪ relic-derived (HubEffects matrix
// and the three relic pets) ∪ game.item_owned ∪ keepsake-derived. profile.get
// returns that list as items, and the same list decides each gate. quantum_cell
// is keepsake-derived from NOBU rematch pieces; those piece ids are not in this
// repo, so the function does not derive it (an empty piece list is not "owned").
// A quantum_cell row in item_owned still counts, because item_owned is part of
// the union. From 0036, an id that is still in game.item_owned_pending is left
// out of the union, so a held grant (hub_life_medal) does not open a gate and
// does not show on the shelf. Promotion into item_owned is what makes it count.
//
// Portal, zone, and session targets are keys in the allowlists below. A client
// URL, or any target not on the list, does not resolve and the gate stays locked.
// The client payload is unlocked bools only. It has no missing list and no
// required item ids.

namespace HubGate {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Refusal code for a later caller. This file does not register an RPC. */
  export var GATE_LOCKED = "GATE_LOCKED";

  /** Portal target key → Codex realm id. hatchery is the only portal in v1. */
  var PORTALS: { [key: string]: string } = {
    hatchery: "hatchery",
  };

  /** Zone target keys. The quantum door is a hub zone: no module uses it as a portal. */
  var ZONES: { [key: string]: boolean } = {
    quantum_door: true,
  };

  /** Session target keys (session game id, not a page URL). */
  var SESSIONS: { [key: string]: boolean } = {
    vcoin: true,
  };

  export interface GateCheck {
    ok: boolean;
    missing: string[];
  }

  /** What profile.get / init() may show. No missing[], no required item ids. */
  export interface ClientGate {
    gateId: string;
    unlocked: boolean;
    actionType: string;
    /** Allowlisted key, or null when the stored target is not on the allowlist. */
    target: string | null;
    lockedHintPool: string | null;
  }

  export interface ClientInventory {
    items: string[];
    gates: ClientGate[];
  }

  interface GateRow {
    gateId: string;
    actionType: string;
    target: string;
    requireAll: boolean;
    required: string[];
    hint: string | null;
    enabled: boolean;
  }

  interface Snapshot {
    owned: string[];
    gates: GateRow[];
  }

  var SNAPSHOT_SQL = [
    "SELECT jsonb_build_object(",
    "  'owned', COALESCE(to_json(game.owned_item_ids($1::uuid)), '[]'::json),",
    "  'gates', COALESCE((",
    "    SELECT json_agg(json_build_object(",
    "      'gateId', g.gate_id,",
    "      'actionType', g.action_type,",
    "      'target', COALESCE(g.target, ''),",
    "      'requireAll', g.require_all,",
    "      'required', COALESCE(to_json(g.required_item_ids), '[]'::json),",
    "      'hint', g.locked_hint_pool,",
    "      'enabled', g.enabled",
    "    ) ORDER BY g.gate_id)",
    "    FROM game.hub_gate g",
    "  ), '[]'::json)",
    ")::text AS result",
  ].join("\n");

  function assertReadOnly(sql: string): void {
    var lower = sql.toLowerCase();
    var markers = ["insert ", "update ", "delete ", "grant ", "revoke "];
    for (var i = 0; i < markers.length; i++) {
      if (lower.indexOf(markers[i]) >= 0) throw new Error("gate_write");
    }
  }

  function isObject(value: unknown): boolean {
    return !!value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function asBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "t" || value === "1") return true;
    if (value === "false" || value === "f" || value === "0") return false;
    return fallback;
  }

  function asStrings(value: unknown): string[] {
    var parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value) as unknown;
      } catch (_e) {
        return [];
      }
    }
    if (Object.prototype.toString.call(parsed) !== "[object Array]") return [];
    var items = parsed as unknown[];
    var out: string[] = [];
    for (var i = 0; i < items.length; i++) {
      if (typeof items[i] === "string" && items[i]) out.push(items[i] as string);
    }
    return out;
  }

  function parseSnapshot(raw: unknown): Snapshot | null {
    var body = raw;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw) as unknown;
      } catch (_e) {
        return null;
      }
    }
    if (!isObject(body)) return null;
    var row = body as { [key: string]: unknown };
    var owned = asStrings(row.owned);
    var gatesRaw = row.gates;
    if (typeof gatesRaw === "string") {
      try {
        gatesRaw = JSON.parse(gatesRaw) as unknown;
      } catch (_e) {
        return null;
      }
    }
    if (Object.prototype.toString.call(gatesRaw) !== "[object Array]") return null;
    var list = gatesRaw as unknown[];
    var gates: GateRow[] = [];
    for (var i = 0; i < list.length; i++) {
      if (!isObject(list[i])) return null;
      var gate = list[i] as { [key: string]: unknown };
      if (typeof gate.gateId !== "string" || !gate.gateId) return null;
      if (typeof gate.actionType !== "string" || !gate.actionType) return null;
      var hint = gate.hint;
      gates.push({
        gateId: gate.gateId,
        actionType: gate.actionType,
        target: typeof gate.target === "string" ? gate.target : "",
        requireAll: asBool(gate.requireAll, true),
        required: asStrings(gate.required),
        hint: typeof hint === "string" && hint ? hint : null,
        enabled: asBool(gate.enabled, false),
      });
    }
    return { owned: owned, gates: gates };
  }

  function readSnapshot(nk: nkruntime.Nakama, userId: string): Snapshot | null {
    try {
      var rows = nk.sqlQuery(SNAPSHOT_SQL, [userId]);
      if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return null;
      return parseSnapshot(rows[0].result);
    } catch (_e) {
      return null;
    }
  }

  /** Lookup failure counts as a guest so the gate refuses. */
  function isGuest(nk: nkruntime.Nakama, userId: string): boolean {
    try {
      var account = nk.accountGetId(userId);
      var email = account && typeof account.email === "string" ? account.email : "";
      return email === "";
    } catch (_e) {
      return true;
    }
  }

  /**
   * Server allowlist. Returns the realm id or the zone/session key, or null.
   * Anything with a scheme or a slash is a URL and does not resolve.
   */
  export function resolveTarget(actionType: string, target: string): string | null {
    if (!target || target.indexOf("://") >= 0 || target.indexOf("/") >= 0 || target.indexOf("\\") >= 0) return null;
    if (actionType === "portal") {
      var realm = PORTALS[target];
      return realm ? realm : null;
    }
    if (actionType === "zone") return ZONES[target] ? target : null;
    if (actionType === "session") return SESSIONS[target] ? target : null;
    return null;
  }

  function ownedSet(ids: string[]): { [id: string]: boolean } {
    var have: { [id: string]: boolean } = {};
    for (var i = 0; i < ids.length; i++) have[ids[i]] = true;
    return have;
  }

  function missingIds(required: string[], have: { [id: string]: boolean }): string[] {
    var missing: string[] = [];
    var seen: { [id: string]: boolean } = {};
    for (var i = 0; i < required.length; i++) {
      var id = required[i];
      if (!id || seen[id] || have[id]) continue;
      seen[id] = true;
      missing.push(id);
    }
    missing.sort();
    return missing;
  }

  function uniqueCount(ids: string[]): number {
    var seen: { [id: string]: boolean } = {};
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i] || seen[ids[i]]) continue;
      seen[ids[i]] = true;
      n++;
    }
    return n;
  }

  function itemsPass(row: GateRow, have: { [id: string]: boolean }): boolean {
    var need = uniqueCount(row.required);
    if (!need) return false;
    var missing = missingIds(row.required, have);
    if (row.requireAll) return missing.length === 0;
    return missing.length < need;
  }

  function deny(): GateCheck {
    return { ok: false, missing: [] };
  }

  /**
   * Request-time check. Unknown gate, disabled gate, target not on the
   * allowlist, empty requirement, read error, bad user id, or guest → ok false.
   * missing is the unowned required ids when the gate itself is real and
   * enabled; it is empty for the fail-closed cases above. Callers must not
   * send missing to a client.
   */
  export function checkGate(nk: nkruntime.Nakama, userId: string, gateId: string): GateCheck {
    if (!userId || !UUID.test(userId) || !gateId || gateId.length > 80) return deny();
    if (isGuest(nk, userId)) return deny();
    var snap = readSnapshot(nk, userId);
    if (!snap) return deny();
    var row: GateRow | null = null;
    for (var i = 0; i < snap.gates.length; i++) {
      if (snap.gates[i].gateId === gateId) row = snap.gates[i];
    }
    if (!row || !row.enabled) return deny();
    if (!resolveTarget(row.actionType, row.target)) return deny();
    var need = uniqueCount(row.required);
    if (!need) return deny();
    var have = ownedSet(snap.owned);
    var missing = missingIds(row.required, have);
    if (row.requireAll) return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing: missing };
    if (missing.length < need) return { ok: true, missing: [] };
    return { ok: false, missing: missing };
  }

  /**
   * Owned item ids plus one unlocked bool per enabled gate. Disabled gates are
   * omitted. A guest gets the owned union (starters, and anything the guest
   * account actually holds) and every gate locked. A read error returns empty
   * lists, which locks every prompt.
   */
  export function forClient(nk: nkruntime.Nakama, userId: string): ClientInventory {
    var empty: ClientInventory = { items: [], gates: [] };
    if (!userId || !UUID.test(userId)) return empty;
    var snap = readSnapshot(nk, userId);
    if (!snap) return empty;
    var guest = isGuest(nk, userId);
    var have = ownedSet(snap.owned);
    var items = snap.owned.slice();
    items.sort();
    var gates: ClientGate[] = [];
    for (var i = 0; i < snap.gates.length; i++) {
      var row = snap.gates[i];
      if (!row.enabled) continue;
      var target = resolveTarget(row.actionType, row.target);
      var unlocked = !guest && !!target && itemsPass(row, have);
      gates.push({
        gateId: row.gateId,
        unlocked: unlocked,
        actionType: row.actionType,
        target: target,
        lockedHintPool: row.hint,
      });
    }
    return { items: items, gates: gates };
  }

  assertReadOnly(SNAPSHOT_SQL);
}
