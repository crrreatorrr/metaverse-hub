// M3 loadout RPCs. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include them. Wiring is docs/m3-server-prep.md.
//
// loadout/<game> reads one row. equip_change writes that row. Matrix items
// are derived from game.relic_claim and are never stored or granted.
// equip_change does not credit Tickets, Verse, Relics, or items.

namespace HubLoadout {
  export var CATALOG_VERSION = 1;
  export var STARTER_STAFF = "duel_staff_sproto";

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true };
  var RELIC_GAME: { [relic: string]: string } = {
    hpos10i_core: "hpos10i",
    genesis_shard: "peoples-bitcoin",
    cones_tip: "nobu",
    tinubu_crown: "sproto",
  };
  var SLOTS: { [game: string]: string[] } = {
    hpos10i: ["skin", "cape"],
    nobu: ["head", "neck", "back", "body"],
    "peoples-bitcoin": ["summon"],
    sproto: ["staff"],
  };

  interface ItemDef {
    id: string;
    game: string;
    slot: string;
    /** Empty string is the starter, which is always owned. */
    relic: string;
  }

  // 12 matrix rows, plus the Sproto staff that every duel has. A Relic never
  // produces an item in the game that awarded it.
  var ITEMS: ItemDef[] = [
    { id: "nobu_wizard_hat", game: "nobu", slot: "head", relic: "tinubu_crown" },
    { id: "nobu_golden_collar", game: "nobu", slot: "neck", relic: "genesis_shard" },
    { id: "nobu_clown_collar", game: "nobu", slot: "neck", relic: "hpos10i_core" },
    { id: STARTER_STAFF, game: "sproto", slot: "staff", relic: "" },
    { id: "duel_staff_momentum", game: "sproto", slot: "staff", relic: "hpos10i_core" },
    { id: "duel_staff_moonward", game: "sproto", slot: "staff", relic: "genesis_shard" },
    { id: "duel_staff_nobu", game: "sproto", slot: "staff", relic: "cones_tip" },
    { id: "hpos_skin_golden", game: "hpos10i", slot: "skin", relic: "genesis_shard" },
    { id: "hpos_skin_nobu", game: "hpos10i", slot: "skin", relic: "cones_tip" },
    { id: "hpos_cape_duelist", game: "hpos10i", slot: "cape", relic: "tinubu_crown" },
    { id: "pb_summon_speed", game: "peoples-bitcoin", slot: "summon", relic: "hpos10i_core" },
    { id: "pb_summon_nobu", game: "peoples-bitcoin", slot: "summon", relic: "cones_tip" },
    { id: "pb_summon_duelist", game: "peoples-bitcoin", slot: "summon", relic: "tinubu_crown" },
  ];

  interface Caller {
    userId: string;
    hub: boolean;
    game: string;
    sid: string;
  }

  interface Slots {
    [slot: string]: string | null;
  }

  function assertCatalog(): void {
    var seen: { [id: string]: boolean } = {};
    var relicCount: { [relic: string]: number } = {};
    var starters = 0;
    for (var i = 0; i < ITEMS.length; i++) {
      var item = ITEMS[i];
      if (seen[item.id]) throw new Error("duplicate_item");
      seen[item.id] = true;
      var keys = SLOTS[item.game];
      if (!keys) throw new Error("bad_game");
      var slotOk = false;
      for (var s = 0; s < keys.length; s++) if (keys[s] === item.slot) slotOk = true;
      if (!slotOk) throw new Error("bad_slot");
      if (item.relic === "") {
        starters++;
        if (item.id !== STARTER_STAFF || item.game !== "sproto" || item.slot !== "staff") throw new Error("bad_starter");
      } else {
        if (!RELIC_GAME[item.relic] || RELIC_GAME[item.relic] === item.game) throw new Error("relic_in_own_game");
        relicCount[item.relic] = (relicCount[item.relic] || 0) + 1;
      }
    }
    if (starters !== 1 || ITEMS.length !== 13) throw new Error("matrix_count");
    var relics = ["hpos10i_core", "genesis_shard", "cones_tip", "tinubu_crown"];
    for (var r = 0; r < relics.length; r++) {
      if (relicCount[relics[r]] !== 3) throw new Error("matrix_count");
    }
  }
  assertCatalog();

  function fail(code: string): string {
    return JSON.stringify({ error: code, message: code });
  }

  function isObject(value: unknown): boolean {
    return !!value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function parse(payload: string): { [key: string]: unknown } {
    if (!payload) return {};
    if (payload.length > 8192) throw new Error("bad_json");
    var data = JSON.parse(payload) as unknown;
    if (!isObject(data)) throw new Error("bad_json");
    return data as { [key: string]: unknown };
  }

  function text(data: { [key: string]: unknown }, key: string): string {
    var value = data[key];
    return typeof value === "string" ? value : "";
  }

  function asInt(value: unknown, fallback: number): number {
    if (typeof value === "number" && isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value !== "" && isFinite(Number(value))) return Math.floor(Number(value));
    return fallback;
  }

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    assertNoGrant(sql);
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) throw new Error("empty_result");
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (isObject(raw)) return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell");
  }

  function queryList(nk: nkruntime.Nakama, sql: string, args: unknown[]): unknown[] {
    assertNoGrant(sql);
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return [];
    var raw = rows[0].result;
    var parsed: unknown = raw;
    if (typeof raw === "string") parsed = JSON.parse(raw);
    if (!parsed || Object.prototype.toString.call(parsed) !== "[object Array]") return [];
    return parsed as unknown[];
  }

  /** Reject any statement that would credit economy or grant a Relic. */
  function assertNoGrant(sql: string): void {
    var lower = sql.toLowerCase();
    var banned = [
      "game.tickets_balance",
      "game.tickets_ledger",
      "game.verse_wallet",
      "game.verse_ledger",
      "game.verse_earned",
      "game.item_ledger",
      "game.exchange_tx",
      "game.earn_window",
      "game.score_best",
    ];
    var markers = ["insert into ", "update ", "delete from "];
    for (var i = 0; i < banned.length; i++) {
      for (var j = 0; j < markers.length; j++) {
        if (lower.indexOf(markers[j] + banned[i]) >= 0) throw new Error("economy_grant");
      }
    }
    if (lower.indexOf("insert into game.relic_claim") >= 0) throw new Error("relic_grant");
    if (lower.indexOf("update game.relic_claim") >= 0) throw new Error("relic_grant");
    if (lower.indexOf("delete from game.relic_claim") >= 0) throw new Error("relic_grant");
  }

  function sqlQuote(value: string): string {
    var out = "'";
    for (var i = 0; i < value.length; i++) {
      var ch = value.charAt(i);
      out += ch === "'" ? "''" : ch;
    }
    return out + "'";
  }

  function caller(ctx: nkruntime.Context): Caller | null {
    if (!ctx.userId || !UUID.test(ctx.userId)) return null;
    var vars = ctx.vars || {};
    if (vars.scope === "game") {
      var game = vars.game && GAMES[vars.game] ? vars.game : "";
      var sid = vars.sid && UUID.test(vars.sid) ? vars.sid : "";
      return { userId: ctx.userId, hub: false, game: game, sid: sid };
    }
    return { userId: ctx.userId, hub: true, game: "", sid: "" };
  }

  function itemById(id: string): ItemDef | null {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    return null;
  }

  function defaultSlots(game: string): Slots {
    var keys = SLOTS[game] || [];
    var slots: Slots = {};
    for (var i = 0; i < keys.length; i++) {
      slots[keys[i]] = game === "sproto" && keys[i] === "staff" ? STARTER_STAFF : null;
    }
    return slots;
  }

  function ownedFor(game: string, relics: string[]): string[] {
    var have: { [id: string]: boolean } = {};
    for (var i = 0; i < relics.length; i++) have[relics[i]] = true;
    var out: string[] = [];
    for (var j = 0; j < ITEMS.length; j++) {
      var item = ITEMS[j];
      if (item.game !== game) continue;
      if (item.relic === "" || have[item.relic]) out.push(item.id);
    }
    return out;
  }

  function cleanSlots(game: string, raw: { [key: string]: unknown } | null, owned: string[]): Slots {
    var have: { [id: string]: boolean } = {};
    for (var i = 0; i < owned.length; i++) have[owned[i]] = true;
    var slots = defaultSlots(game);
    var keys = SLOTS[game] || [];
    if (!raw) return slots;
    for (var k = 0; k < keys.length; k++) {
      var slot = keys[k];
      var value = raw[slot];
      if (typeof value !== "string" || !have[value]) continue;
      var item = itemById(value);
      if (item && item.game === game && item.slot === slot) slots[slot] = value;
    }
    return slots;
  }

  function sameDocument(raw: { [key: string]: unknown } | null, slots: Slots): boolean {
    if (!raw) return false;
    var keys = Object.keys(slots);
    if (Object.keys(raw).length !== keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      var expected = slots[keys[i]];
      var value = raw[keys[i]];
      if (expected === null) {
        if (value !== null) return false;
      } else if (value !== expected) {
        return false;
      }
    }
    return true;
  }

  function parseSlots(value: unknown): { [key: string]: unknown } | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "string") {
      var parsed = JSON.parse(value) as unknown;
      return isObject(parsed) ? parsed as { [key: string]: unknown } : null;
    }
    return isObject(value) ? value as { [key: string]: unknown } : null;
  }

  function relicIds(nk: nkruntime.Nakama, userId: string): string[] {
    var rows = queryList(
      nk,
      "SELECT COALESCE(json_agg(relic_id ORDER BY relic_id), '[]'::json)::text AS result FROM game.relic_claim WHERE user_id = $1::uuid",
      [userId],
    );
    var out: string[] = [];
    for (var i = 0; i < rows.length; i++) if (typeof rows[i] === "string" && RELIC_GAME[rows[i] as string]) out.push(rows[i] as string);
    return out;
  }

  function readRow(nk: nkruntime.Nakama, userId: string, game: string): { found: boolean; raw: { [key: string]: unknown } | null; seq: number; updatedAt: string } {
    var sql = "SELECT slots::text AS slots, seq::text AS seq, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at FROM game.loadout WHERE user_id = $1::uuid AND game_id = $2";
    assertNoGrant(sql);
    var rows = nk.sqlQuery(sql, [userId, game]);
    if (!rows || !rows.length) return { found: false, raw: null, seq: 0, updatedAt: "" };
    return {
      found: true,
      raw: parseSlots(rows[0].slots),
      seq: asInt(rows[0].seq, 0),
      updatedAt: rows[0].updated_at === undefined || rows[0].updated_at === null ? "" : String(rows[0].updated_at),
    };
  }

  function persistClean(nk: nkruntime.Nakama, userId: string, game: string, slots: Slots): void {
    var sql = "UPDATE game.loadout SET slots = $3::jsonb WHERE user_id = $1::uuid AND game_id = $2 AND slots IS DISTINCT FROM $3::jsonb";
    assertNoGrant(sql);
    nk.sqlExec(sql, [userId, game, JSON.stringify(slots)]);
  }

  function view(game: string, raw: { [key: string]: unknown } | null, relics: string[]): { slots: Slots; owned: string[] } {
    var owned = ownedFor(game, relics);
    return { slots: cleanSlots(game, raw, owned), owned: owned };
  }

  /**
   * Read RPC for `loadout/<game>`. `game` is pinned by the registered id.
   * A game session can read only its own game. A hub session can read any.
   * The response drops equipped ids the player does not own. Duel's staff
   * falls back to the starter. This does not grant anything.
   */
  export function read(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var who = caller(ctx);
    if (!who) return fail("unauthorized");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var game = text(body, "game");
    if (!GAMES[game]) return fail("bad_game");
    if (!who.hub && who.game !== game) return fail("bad_game");
    var row = readRow(nk, who.userId, game);
    var shown = view(game, row.raw, relicIds(nk, who.userId));
    if (row.found && !sameDocument(row.raw, shown.slots)) persistClean(nk, who.userId, game, shown.slots);
    logger.debug("loadout read " + game + " user " + who.userId);
    return JSON.stringify({
      v: 1,
      game: game,
      slots: shown.slots,
      owned: shown.owned,
      seq: row.seq,
      updated_at: row.updatedAt || null,
      catalogVersion: CATALOG_VERSION,
    });
  }

  function slotPredicate(): string {
    var games = ["hpos10i", "nobu", "peoples-bitcoin", "sproto"];
    var parts: string[] = [];
    for (var i = 0; i < games.length; i++) {
      var keys = SLOTS[games[i]];
      var list: string[] = [];
      for (var j = 0; j < keys.length; j++) list.push(sqlQuote(keys[j]));
      parts.push("($3::text = " + sqlQuote(games[i]) + " AND $4::text IN (" + list.join(",") + "))");
    }
    return parts.join(" OR ");
  }

  function catalogValues(): string {
    var parts: string[] = [];
    for (var i = 0; i < ITEMS.length; i++) {
      var item = ITEMS[i];
      var relic = item.relic ? sqlQuote(item.relic) : "NULL::text";
      parts.push("(" + sqlQuote(item.game) + "," + sqlQuote(item.slot) + "," + sqlQuote(item.id) + "," + relic + ")");
    }
    return parts.join(",");
  }

  function equipSql(): string {
    return "WITH catalog(game_id, slot, item_id, relic_id) AS (VALUES " + catalogValues() + "),"
      + " chosen AS (SELECT CASE WHEN $3::text = 'sproto' AND $4::text = 'staff' AND NULLIF($5::text, '') IS NULL THEN 'duel_staff_sproto' ELSE NULLIF($5::text, '') END AS item_id),"
      + " sess AS (SELECT session_id FROM game.game_session WHERE session_id = $2::uuid AND user_id = $1::uuid AND game_id = $3::text AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL),"
      + " picked AS (SELECT c.game_id, c.slot, c.item_id, c.relic_id FROM catalog c JOIN chosen ch ON c.item_id = ch.item_id),"
      + " gate AS (SELECT CASE"
      + " WHEN NOT EXISTS (SELECT 1 FROM sess) THEN 'session_closed'"
      + " WHEN NOT (" + slotPredicate() + ") THEN 'bad_slot'"
      + " WHEN (SELECT item_id FROM chosen) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM picked) THEN 'not_owned'"
      + " WHEN (SELECT item_id FROM chosen) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM picked p WHERE p.game_id = $3::text AND p.slot = $4::text) THEN 'bad_slot'"
      + " WHEN (SELECT item_id FROM chosen) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM picked p WHERE p.game_id = $3::text AND p.slot = $4::text AND (p.relic_id IS NULL OR EXISTS (SELECT 1 FROM game.relic_claim rc WHERE rc.user_id = $1::uuid AND rc.relic_id = p.relic_id))) THEN 'not_owned'"
      + " WHEN $6::bigint <= COALESCE((SELECT seq FROM game.loadout WHERE user_id = $1::uuid AND game_id = $3::text), 0) THEN 'stale_seq'"
      + " ELSE NULL END AS reason),"
      + " prev AS (SELECT slots, seq, updated_at FROM game.loadout WHERE user_id = $1::uuid AND game_id = $3::text),"
      + " next_slots AS (SELECT jsonb_set(CASE WHEN (SELECT slots FROM prev) IS NOT NULL AND jsonb_typeof((SELECT slots FROM prev)) = 'object' THEN (SELECT slots FROM prev) ELSE $7::jsonb END, ARRAY[$4::text], CASE WHEN (SELECT item_id FROM chosen) IS NULL THEN 'null'::jsonb ELSE to_jsonb((SELECT item_id FROM chosen)) END, true) AS slots),"
      + " written AS (INSERT INTO game.loadout (user_id, game_id, slots, seq, updated_at) SELECT $1::uuid, $3::text, (SELECT slots FROM next_slots), $6::bigint, now() FROM gate WHERE reason IS NULL ON CONFLICT (user_id, game_id) DO UPDATE SET slots = EXCLUDED.slots, seq = EXCLUDED.seq, updated_at = now() WHERE game.loadout.seq < EXCLUDED.seq RETURNING slots, seq, updated_at)"
      + " SELECT jsonb_build_object("
      + " 'ok', (SELECT reason FROM gate) IS NULL AND EXISTS (SELECT 1 FROM written),"
      + " 'reason', CASE WHEN (SELECT reason FROM gate) IS NOT NULL THEN (SELECT reason FROM gate) WHEN NOT EXISTS (SELECT 1 FROM written) THEN 'stale_seq' ELSE NULL END,"
      + " 'slots', COALESCE((SELECT slots FROM written), (SELECT slots FROM prev), $7::jsonb),"
      + " 'seq', COALESCE((SELECT seq FROM written), (SELECT seq FROM prev), 0),"
      + " 'updated_at', CASE WHEN COALESCE((SELECT updated_at FROM written), (SELECT updated_at FROM prev)) IS NULL THEN NULL ELSE to_char(COALESCE((SELECT updated_at FROM written), (SELECT updated_at FROM prev)) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') END"
      + " )::text AS result";
  }

  function ack(ok: boolean, game: string, seq: number, slots: Slots, owned: string[], reason: string): string {
    var body: { [key: string]: unknown } = {
      ok: ok,
      v: 1,
      game: game,
      seq: seq,
      loadout: slots,
      owned: owned,
      catalogVersion: CATALOG_VERSION,
    };
    if (!ok) body.reason = reason;
    return JSON.stringify(body);
  }

  /**
   * equip_change. The open game session must be this game. `seq` must be
   * greater than the stored seq. One item per slot: the write replaces that
   * slot only. A null staff becomes the starter. Ownership is checked again
   * in the same statement against game.relic_claim. No ledger row is written.
   */
  export function equip(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var who = caller(ctx);
    if (!who) return fail("unauthorized");
    if (who.hub || !who.sid || !who.game) return fail("not_game_session");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    if (body.v !== undefined && body.v !== 1) return fail("bad_json");
    var game = text(body, "game");
    var slot = text(body, "slot");
    if (!GAMES[game]) return fail("bad_game");
    if (who.game !== game) return fail("bad_game");
    if (!slot || slot.length > 32 || !/^[a-z_]+$/.test(slot)) return fail("bad_slot");
    if (!("item_id" in body) && !("itemId" in body)) return fail("bad_json");
    var rawItem: unknown = "item_id" in body ? body.item_id : body.itemId;
    var itemId = "";
    if (rawItem === null || rawItem === undefined) itemId = "";
    else if (typeof rawItem !== "string" || rawItem.length > 64) return fail("bad_json");
    else itemId = rawItem;
    if (typeof body.seq !== "number" || !isFinite(body.seq) || Math.floor(body.seq) !== body.seq || body.seq <= 0 || body.seq > 9007199254740991) {
      return fail("bad_json");
    }
    var seq = Math.floor(body.seq);
    var wanted = itemId;
    if (game === "sproto" && slot === "staff" && wanted === "") wanted = STARTER_STAFF;
    var sql = equipSql();
    var row = queryJson(nk, sql, [who.userId, who.sid, game, slot, itemId, seq, JSON.stringify(defaultSlots(game))]);
    var relics = relicIds(nk, who.userId);
    var shown = view(game, parseSlots(row.slots), relics);
    var serverSeq = asInt(row.seq, 0);
    var reason = typeof row.reason === "string" ? row.reason : "";
    var ok = row.ok === true || row.ok === "true";
    if (!ok && reason === "stale_seq" && serverSeq === seq && shown.slots[slot] === (wanted === "" ? null : wanted)) {
      ok = true;
      reason = "";
    }
    if (!ok && reason !== "not_owned" && reason !== "bad_slot" && reason !== "stale_seq" && reason !== "session_closed") {
      return fail(reason || "session_closed");
    }
    if (ok) logger.info("equip " + game + " " + slot + " user " + who.userId);
    else logger.debug("equip rejected " + reason + " " + game + " " + slot);
    return ack(ok, game, serverSeq, shown.slots, shown.owned, reason);
  }
}
