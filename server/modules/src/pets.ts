// M6 hub pets. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include this file. Wiring is docs/m6-server-prep.md.
//
// profilePets builds the pets object for profile.get. setHub is the
// loadout.set_hub RPC. Both call ownedSet. The backfill statement is the
// text of a future ledger migration and is not executed. Equipping writes
// no ledger row and does not credit Tickets, Verse, Relics, or items.

declare namespace nkruntime {
  interface StorageReadRequest {
    collection: string;
    key: string;
    userId: string;
  }

  interface StorageObject {
    collection: string;
    key: string;
    userId: string;
    value: { [key: string]: unknown };
    version: string;
    permissionRead: number;
    permissionWrite: number;
  }

  interface Nakama {
    storageRead(keys: StorageReadRequest[]): StorageObject[];
  }

  interface StorageWrite {
    version?: string;
  }
}

namespace HubPets {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HUB_COLLECTION = "loadout";
  var HUB_KEY = "hub";
  var READ_OWNER = 1;
  var WRITE_NONE = 0;

  interface PetDef {
    id: string;
    /** Relic that derives ownership. Empty means the row lives in item_owned. */
    relic: string;
    /** True when a canonical session.event can match an item_rule for this id. */
    live: boolean;
    /** True only for the exchange / four-relic backfill migration. */
    backfill: boolean;
    /** True only for pets M7 store.purchase grants. */
    store: boolean;
  }

  var PETS: PetDef[] = [
    { id: "pet_baby_sproto", relic: "", live: false, backfill: true, store: false },
    { id: "pet_honk_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_spiral_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_mecha_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_conehead_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_presidential_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_moon_sproto", relic: "", live: true, backfill: false, store: false },
    { id: "pet_four_lights_sproto", relic: "", live: false, backfill: true, store: false },
    { id: "pet_hopium_sproto", relic: "", live: false, backfill: false, store: true },
    { id: "pet_coom_sproto", relic: "", live: false, backfill: false, store: true },
    { id: "pet_speed_sproto", relic: "hpos10i_core", live: false, backfill: false, store: false },
    { id: "pet_nobu", relic: "cones_tip", live: false, backfill: false, store: false },
    { id: "pet_duelist_sproto", relic: "tinubu_crown", live: false, backfill: false, store: false },
    { id: "pet_sproto_pup", relic: "", live: true, backfill: false, store: false },
  ];

  export interface ProfilePets {
    owned: string[];
    active: string | null;
  }

  interface HubSlot {
    pet: string | null;
    seq: number;
    version: string;
    updatedAt: string;
  }

  function assertCatalog(): void {
    var seen: { [id: string]: boolean } = {};
    var live = 0;
    var backfill = 0;
    var relics = 0;
    for (var i = 0; i < PETS.length; i++) {
      var pet = PETS[i];
      if (seen[pet.id] || pet.id.indexOf("pet_") !== 0) throw new Error("pet_count");
      seen[pet.id] = true;
      if (pet.relic && (pet.live || pet.backfill || pet.store)) throw new Error("derived_grant");
      if (pet.live) live++;
      if (pet.backfill) backfill++;
      if (pet.relic) relics++;
    }
    var store = 0;
    for (var s = 0; s < PETS.length; s++) if (PETS[s].store) store++;
    if (PETS.length !== 14 || live !== 7 || backfill !== 2 || relics !== 3 || store !== 2) throw new Error("pet_count");
    var pup = petById("pet_sproto_pup");
    if (!seen["pet_sproto_pup"] || pup.backfill || pup.store || pup.relic || !pup.live) throw new Error("pup_grant");
    var baby = petById("pet_baby_sproto");
    var lights = petById("pet_four_lights_sproto");
    if (!baby.backfill || !lights.backfill || baby.live || lights.live || baby.store || lights.store) {
      throw new Error("backfill_pets");
    }
    var hopium = petById("pet_hopium_sproto");
    var coom = petById("pet_coom_sproto");
    if (!hopium.store || !coom.store || hopium.live || hopium.backfill || coom.live || coom.backfill) {
      throw new Error("store_grant");
    }
    if (petById("pet_speed_sproto").relic !== "hpos10i_core") throw new Error("derived_grant");
    if (petById("pet_nobu").relic !== "cones_tip") throw new Error("derived_grant");
    if (petById("pet_duelist_sproto").relic !== "tinubu_crown") throw new Error("derived_grant");
  }

  function petById(id: string): PetDef {
    for (var i = 0; i < PETS.length; i++) if (PETS[i].id === id) return PETS[i];
    throw new Error("missing_pet");
  }

  function sqlQuote(value: string): string {
    var out = "'";
    for (var i = 0; i < value.length; i++) {
      var ch = value.charAt(i);
      out += ch === "'" ? "''" : ch;
    }
    return out + "'";
  }

  function isObject(value: unknown): boolean {
    return !!value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function assertCosmetic(sql: string): void {
    var lower = sql.toLowerCase();
    var banned = [
      "game.tickets_balance",
      "game.tickets_ledger",
      "game.verse_wallet",
      "game.verse_ledger",
      "game.verse_earned",
      "game.exchange_tx",
      "game.earn_window",
      "game.score_best",
      "game.relic_claim",
      "game.game_beaten",
    ];
    var markers = ["insert into ", "update ", "delete from "];
    for (var i = 0; i < banned.length; i++) {
      for (var j = 0; j < markers.length; j++) {
        if (lower.indexOf(markers[j] + banned[i]) >= 0) throw new Error("economy_grant");
      }
    }
    if (lower.indexOf("game.earn_tickets") >= 0 || lower.indexOf("game.exchange_tickets") >= 0) {
      throw new Error("economy_grant");
    }
    if (lower.indexOf("grant_relic") >= 0 || lower.indexOf("'purchase'") >= 0 || lower.indexOf("'store'") >= 0) {
      throw new Error("economy_grant");
    }
  }

  function nonRelicList(): string {
    var parts: string[] = [];
    for (var i = 0; i < PETS.length; i++) {
      if (PETS[i].relic) continue;
      parts.push(sqlQuote(PETS[i].id));
    }
    return parts.join(", ");
  }

  function queryList(nk: nkruntime.Nakama, sql: string, args: unknown[]): unknown[] {
    assertCosmetic(sql);
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return [];
    var raw = rows[0].result;
    var parsed: unknown = raw;
    if (typeof raw === "string") parsed = JSON.parse(raw) as unknown;
    if (Object.prototype.toString.call(parsed) !== "[object Array]") return [];
    return parsed as unknown[];
  }

  function relicForPet(itemId: string): string {
    for (var i = 0; i < PETS.length; i++) {
      if (PETS[i].id === itemId) return PETS[i].relic;
    }
    return "";
  }

  /**
   * True when itemId is one of the three relic summons and this user has
   * that relic on relic_claim. M7 store.purchase calls this before any
   * debit and treats true as already_owned. It does not read item_owned
   * and it does not grant.
   */
  export function derivedOwned(nk: nkruntime.Nakama, userId: string, itemId: string): boolean {
    var relic = relicForPet(itemId);
    if (!relic || !UUID.test(userId)) return false;
    var sql = "SELECT count(*)::text AS result FROM game.relic_claim WHERE user_id = $1::uuid AND relic_id = $2";
    assertCosmetic(sql);
    var rows = nk.sqlQuery(sql, [userId, relic]);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return false;
    var n = Number(rows[0].result);
    return isFinite(n) && n > 0;
  }

  /**
   * The only pet-ownership check. profilePets and setHub both call this.
   * Relic summons go through derivedOwned. Every other catalog pet comes
   * from item_owned. This does not grant.
   */
  function ownedSet(nk: nkruntime.Nakama, userId: string): { [id: string]: boolean } {
    var have: { [id: string]: boolean } = {};
    var itemSql = "SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json)::text AS result FROM game.item_owned WHERE user_id = $1::uuid AND item_id IN (" + nonRelicList() + ")";
    var items = queryList(nk, itemSql, [userId]);
    for (var i = 0; i < items.length; i++) {
      if (typeof items[i] !== "string") continue;
      var id = items[i] as string;
      var pet = findPet(id);
      if (pet && !pet.relic) have[id] = true;
    }
    for (var p = 0; p < PETS.length; p++) {
      if (!PETS[p].relic) continue;
      if (derivedOwned(nk, userId, PETS[p].id)) have[PETS[p].id] = true;
    }
    return have;
  }

  function findPet(id: string): PetDef | null {
    for (var i = 0; i < PETS.length; i++) if (PETS[i].id === id) return PETS[i];
    return null;
  }

  function sortedIds(have: { [id: string]: boolean }): string[] {
    var out: string[] = [];
    for (var i = 0; i < PETS.length; i++) if (have[PETS[i].id]) out.push(PETS[i].id);
    out.sort();
    return out;
  }

  function petField(value: { [key: string]: unknown }): string | null {
    var slots = value.slots;
    if (!isObject(slots)) return null;
    var pet = (slots as { [key: string]: unknown }).pet;
    if (typeof pet !== "string" || !pet) return null;
    return pet;
  }

  function asInt(value: unknown): number {
    if (typeof value === "number" && isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value !== "" && isFinite(Number(value))) return Math.floor(Number(value));
    return 0;
  }

  function readHub(nk: nkruntime.Nakama, userId: string): HubSlot {
    var rows = nk.storageRead([{ collection: HUB_COLLECTION, key: HUB_KEY, userId: userId }]);
    if (!rows || !rows.length || !rows[0]) return { pet: null, seq: 0, version: "", updatedAt: "" };
    var row = rows[0];
    var value = row.value && isObject(row.value) ? row.value : {};
    return {
      pet: petField(value),
      seq: asInt(value.seq),
      version: row.version || "",
      updatedAt: typeof value.updated_at === "string" ? value.updated_at : "",
    };
  }

  /**
   * Pets object for profile.get. Owned ids are item_owned pets plus the
   * three relic summons derived from relic_claim. Active is loadout/hub
   * slots.pet when that id is still owned. This does not write.
   */
  export function profilePets(nk: nkruntime.Nakama, userId: string): ProfilePets {
    if (!UUID.test(userId)) return { owned: [], active: null };
    var have = ownedSet(nk, userId);
    var owned = sortedIds(have);
    var slot = readHub(nk, userId);
    var active = slot.pet && have[slot.pet] ? slot.pet : null;
    return { owned: owned, active: active };
  }

  function fail(code: string): string {
    return JSON.stringify({ error: code, message: code });
  }

  function parse(payload: string): { [key: string]: unknown } {
    if (!payload) return {};
    if (payload.length > 8192) throw new Error("bad_json");
    var data = JSON.parse(payload) as unknown;
    if (!isObject(data)) throw new Error("bad_json");
    return data as { [key: string]: unknown };
  }

  function ack(ok: boolean, seq: number, pet: string | null, updatedAt: string, reason: string): string {
    var body: { [key: string]: unknown } = {
      ok: ok,
      v: 1,
      slots: { pet: pet },
      seq: seq,
      updated_at: updatedAt || null,
    };
    if (!ok) body.reason = reason;
    return JSON.stringify(body);
  }

  function storageValue(doc: { [key: string]: unknown }): { [key: string]: string | number | boolean } {
    var parsed = JSON.parse(JSON.stringify(doc)) as { [key: string]: string | number | boolean };
    return parsed;
  }

  function serverNow(nk: nkruntime.Nakama): string {
    var sql = "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS result";
    assertCosmetic(sql);
    var rows = nk.sqlQuery(sql, []);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) throw new Error("empty_result");
    return String(rows[0].result);
  }

  function shown(slot: HubSlot, have: { [id: string]: boolean }): string | null {
    if (!slot.pet || !have[slot.pet]) return null;
    return slot.pet;
  }

  /**
   * loadout.set_hub. Hub session only. pet is a catalog id or null.
   * seq must be an integer greater than the stored seq. Ownership is
   * item_owned, or relic_claim for the three derived summons. A forged id
   * is not_owned. The write is Nakama storage loadout/hub with
   * permission_write 0. No item_ledger row is written.
   */
  export function setHub(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var scope = ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
    if (scope === "game") return fail("not_hub_session");
    var userId = ctx.userId;
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    if (body.v !== undefined && body.v !== 1) return fail("bad_json");
    if (!("pet" in body)) return fail("bad_json");
    var rawPet = body.pet;
    var pet = "";
    if (rawPet === null) pet = "";
    else if (typeof rawPet !== "string" || !rawPet || rawPet.length > 64) return fail("bad_json");
    else pet = rawPet;
    if (typeof body.seq !== "number" || !isFinite(body.seq) || Math.floor(body.seq) !== body.seq || body.seq <= 0 || body.seq > 9007199254740991) {
      return fail("bad_json");
    }
    var seq = Math.floor(body.seq);
    if (pet && !findPet(pet)) {
      var missing = readHub(nk, userId);
      var missingOwned = ownedSet(nk, userId);
      return ack(false, missing.seq, shown(missing, missingOwned), missing.updatedAt, "not_owned");
    }
    var have = ownedSet(nk, userId);
    if (pet && !have[pet]) {
      var denied = readHub(nk, userId);
      return ack(false, denied.seq, shown(denied, have), denied.updatedAt, "not_owned");
    }
    var current = readHub(nk, userId);
    var nextPet = pet ? pet : null;
    if (seq === current.seq && nextPet === (current.pet || null) && (!nextPet || have[nextPet])) {
      return ack(true, current.seq, shown(current, have), current.updatedAt, "");
    }
    if (seq <= current.seq) return ack(false, current.seq, shown(current, have), current.updatedAt, "stale_seq");
    var updatedAt = serverNow(nk);
    var doc: { [key: string]: unknown } = {
      v: 1,
      slots: { pet: nextPet },
      seq: seq,
      updated_at: updatedAt,
    };
    var write: nkruntime.StorageWrite = {
      collection: HUB_COLLECTION,
      key: HUB_KEY,
      userId: userId,
      value: storageValue(doc),
      permissionRead: READ_OWNER,
      permissionWrite: WRITE_NONE,
    };
    if (current.version) write.version = current.version;
    try {
      nk.storageWrite([write]);
    } catch (e) {
      var message = String(e).toLowerCase();
      if (current.version && (message.indexOf("version") >= 0 || message.indexOf("storage") >= 0)) {
        var again = readHub(nk, userId);
        var againOwned = ownedSet(nk, userId);
        return ack(false, again.seq, shown(again, againOwned), again.updatedAt, "stale_seq");
      }
      throw e;
    }
    logger.info("hub pet set user " + userId);
    return ack(true, seq, nextPet, updatedAt, "");
  }

  /**
   * Inserts for the one-time backfill ledger entry. Not executed.
   * Wiring copies this statement into a numbered migration. It is not a function to call.
   */
  function backfillSql(): string {
    return [
      "WITH baby AS (",
      "  SELECT DISTINCT user_id, 'pet_baby_sproto'::text AS item_id FROM game.exchange_tx",
      "),",
      "lights AS (",
      "  SELECT user_id, 'pet_four_lights_sproto'::text AS item_id FROM game.relic_claim",
      "  WHERE relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown')",
      "  GROUP BY user_id",
      "  HAVING count(DISTINCT relic_id) = 4",
      "),",
      "earned AS (",
      "  SELECT user_id, item_id FROM baby",
      "  UNION ALL",
      "  SELECT user_id, item_id FROM lights",
      "),",
      "ins AS (",
      "  INSERT INTO game.item_owned (user_id, item_id, source, ref_id)",
      "  SELECT user_id, item_id, 'migration', gen_random_uuid() FROM earned",
      "  ON CONFLICT (user_id, item_id) DO NOTHING",
      "  RETURNING item_id, ref_id, user_id",
      "),",
      "led AS (",
      "  INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)",
      "  SELECT ref_id, user_id, 'grant_item', item_id, 'migration', ref_id FROM ins",
      "  RETURNING item_id",
      ")",
      "SELECT COALESCE(count(*), 0)::text AS result FROM led",
    ].join("\n");
  }

  function assertBackfill(sql: string): void {
    assertCosmetic(sql);
    var lower = sql.toLowerCase();
    if (lower.indexOf("pet_sproto_pup") >= 0) throw new Error("pup_backfill");
    if (lower.indexOf("game_beaten") >= 0) throw new Error("game_beaten_backfill");
    if (lower.indexOf("pet_baby_sproto") < 0 || lower.indexOf("pet_four_lights_sproto") < 0) throw new Error("backfill_pets");
    if (lower.indexOf("on conflict (user_id, item_id) do nothing") < 0) throw new Error("missing_grant");
    if (lower.indexOf("'migration'") < 0 || lower.indexOf("grant_item") < 0) throw new Error("missing_grant");
    if (lower.indexOf("insert into game.relic_claim") >= 0) throw new Error("relic_grant");
    if (lower.indexOf("pb.item_obtained") >= 0) throw new Error("pup_backfill");
  }

  assertCatalog();
  assertBackfill(backfillSql());
}
