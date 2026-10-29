// M7 store.purchase. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include it. Wiring is docs/m7-server-prep.md.
//
// The debit amount is game.store_item.price_verse. expected_price is compared
// to that row and is never subtracted. The seed INSERT lives in the doc, not
// here, and there is no migration file.

namespace HubStore {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var ITEM_ID = /^[a-z0-9_]{1,64}$/;

  interface CatalogRow {
    id: string;
    kind: string;
    priceVerse: number;
    /** Non-null means a gameplay param. The loader rejects those rows. */
    effect: null | string | number | boolean | { [key: string]: unknown };
  }

  // Matrix items. Each one has a gameplay param in the relic matrix, so none
  // of them can be seeded or sold. Visual FX on a store row is not this list.
  var EFFECT_IDS: string[] = [
    "nobu_wizard_hat",
    "nobu_golden_collar",
    "nobu_clown_collar",
    "duel_staff_momentum",
    "duel_staff_moonward",
    "duel_staff_nobu",
    "hpos_skin_golden",
    "hpos_skin_nobu",
    "hpos_cape_duelist",
    "pb_summon_speed",
    "pb_summon_nobu",
    "pb_summon_duelist",
  ];

  // Earn-only ids with no gameplay param of their own. Still never priced.
  var EARN_ONLY_IDS: string[] = [
    "hpos10i_core",
    "genesis_shard",
    "cones_tip",
    "tinubu_crown",
    "duel_staff_sproto",
  ];

  // Mirrors the seed in docs/m7-server-prep.md. Not the debit source.
  var RAW_CATALOG: CatalogRow[] = [
    { id: "hub_face_clown_nose", kind: "face", priceVerse: 50, effect: null },
    { id: "hub_title_never_sell", kind: "title", priceVerse: 50, effect: null },
    { id: "hub_title_tartarian", kind: "title", priceVerse: 100, effect: null },
    { id: "hub_nameplate_golden_ticket", kind: "nameplate", priceVerse: 100, effect: null },
    { id: "hub_emote_mega_bark", kind: "emote", priceVerse: 100, effect: null },
    { id: "hub_emote_spin_dash", kind: "emote", priceVerse: 100, effect: null },
    { id: "nobu_body_hopium_bandana", kind: "body", priceVerse: 100, effect: null },
    { id: "hub_outfit_hopium_hoodie", kind: "outfit", priceVerse: 150, effect: null },
    { id: "duel_bolt_hopium_green", kind: "bolt", priceVerse: 150, effect: null },
    { id: "hub_head_moonward_hat", kind: "head", priceVerse: 200, effect: null },
    { id: "hub_back_sproto_plush", kind: "back", priceVerse: 200, effect: null },
    { id: "hub_trail_coom_sparks", kind: "trail", priceVerse: 250, effect: null },
    { id: "hub_trail_hopium_bubbles", kind: "trail", priceVerse: 250, effect: null },
    { id: "duel_staffskin_golden_ticket", kind: "staffskin", priceVerse: 250, effect: null },
    { id: "duel_staffskin_tartarian_stone", kind: "staffskin", priceVerse: 250, effect: null },
    { id: "hub_portal_terminal_glitch", kind: "portal", priceVerse: 300, effect: null },
    { id: "pet_hopium_sproto", kind: "pet", priceVerse: 300, effect: null },
    { id: "hub_outfit_presidential_suit", kind: "outfit", priceVerse: 450, effect: null },
    { id: "pet_coom_sproto", kind: "pet", priceVerse: 500, effect: null },
    { id: "hub_outfit_10inu_robe", kind: "outfit", priceVerse: 1000, effect: null },
  ];

  function quotedIds(ids: string[]): string {
    var parts: string[] = [];
    for (var i = 0; i < ids.length; i++) {
      if (!ITEM_ID.test(ids[i])) throw new Error("bad_item_id");
      parts.push("'" + ids[i] + "'");
    }
    return parts.join(", ");
  }

  function inList(ids: string[], id: string): boolean {
    for (var i = 0; i < ids.length; i++) if (ids[i] === id) return true;
    return false;
  }

  /**
   * Catalogue loader. A row with a non-null effect is rejected, and so is any
   * id already known to carry a gameplay param or to be earn-only. The 20
   * store rows are cosmetic: effect is null, and the prices sum to 4850.
   */
  export function loadCatalog(rows: CatalogRow[]): CatalogRow[] {
    var seen: { [id: string]: boolean } = {};
    var total = 0;
    var out: CatalogRow[] = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.effect !== null) throw new Error("item_effect");
      if (!ITEM_ID.test(row.id) || !row.kind || !ITEM_ID.test(row.kind)) throw new Error("bad_item_id");
      if (inList(EFFECT_IDS, row.id)) throw new Error("item_effect");
      if (inList(EARN_ONLY_IDS, row.id)) throw new Error("earn_only");
      if (seen[row.id]) throw new Error("duplicate_item");
      seen[row.id] = true;
      if (typeof row.priceVerse !== "number" || !isFinite(row.priceVerse) || Math.floor(row.priceVerse) !== row.priceVerse || row.priceVerse <= 0) {
        throw new Error("bad_price");
      }
      total += row.priceVerse;
      out.push(row);
    }
    if (out.length !== 20 || total !== 4850) throw new Error("catalog_total");
    return out;
  }

  var CATALOG = loadCatalog(RAW_CATALOG);

  export var APPLY_SQL = [
    "CREATE OR REPLACE FUNCTION game.apply_store_purchase(",
    "  p_user_id uuid,",
    "  p_item_id text,",
    "  p_expected_price bigint,",
    "  p_idem_key text,",
    "  p_req_hash text",
    ") RETURNS jsonb",
    "LANGUAGE plpgsql",
    "AS $fn$",
    "DECLARE",
    "  v_response jsonb;",
    "  v_hash bytea;",
    "  v_existing_hash bytea;",
    "  v_price bigint;",
    "  v_on_sale boolean;",
    "  v_catalog int;",
    "  v_verse bigint;",
    "  v_balance bigint;",
    "  v_purchase uuid;",
    "BEGIN",
    "  PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));",
    "  v_hash := decode(p_req_hash, 'hex');",
    "  SELECT COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = p_user_id), 0) INTO v_verse;",
    "",
    "  -- step_idempotency_read",
    "  SELECT response, req_hash INTO v_response, v_existing_hash",
    "  FROM game.idempotency",
    "  WHERE user_id = p_user_id AND key = p_idem_key;",
    "  IF FOUND THEN",
    "    IF v_existing_hash IS DISTINCT FROM v_hash THEN",
    "      RETURN jsonb_build_object('ok', false, 'reason', 'idem_mismatch', 'verse', v_verse);",
    "    END IF;",
    "    RETURN v_response;",
    "  END IF;",
    "",
    "  -- step_server_price",
    "  SELECT price_verse, on_sale, catalog_version INTO v_price, v_on_sale, v_catalog",
    "  FROM game.store_item",
    "  WHERE item_id = p_item_id;",
    "  IF NOT FOUND THEN",
    "    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_item', 'verse', v_verse);",
    "  END IF;",
    "  IF NOT v_on_sale THEN",
    "    RETURN jsonb_build_object('ok', false, 'reason', 'not_for_sale', 'verse', v_verse);",
    "  END IF;",
    "  IF v_price IS DISTINCT FROM p_expected_price THEN",
    "    v_response := jsonb_build_object('ok', false, 'reason', 'price_changed', 'verse', v_verse);",
    "    INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "    VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "    RETURN v_response;",
    "  END IF;",
    "",
    "  -- step_owned_before_debit",
    "  IF EXISTS (SELECT 1 FROM game.item_owned WHERE user_id = p_user_id AND item_id = p_item_id)",
    "     OR p_item_id = ANY (ARRAY[" + quotedIds(EFFECT_IDS.concat(EARN_ONLY_IDS)) + "]::text[])",
    "  THEN",
    "    v_response := jsonb_build_object('ok', false, 'reason', 'already_owned', 'verse', v_verse);",
    "    INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "    VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "    RETURN v_response;",
    "  END IF;",
    "",
    "  -- step_wallet_lock",
    "  SELECT balance INTO v_balance",
    "  FROM game.verse_wallet",
    "  WHERE user_id = p_user_id",
    "  FOR UPDATE;",
    "  IF NOT FOUND OR v_balance < v_price THEN",
    "    v_response := jsonb_build_object('ok', false, 'reason', 'insufficient_verse', 'verse', COALESCE(v_balance, 0));",
    "    INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "    VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "    RETURN v_response;",
    "  END IF;",
    "",
    "  -- step_debit",
    "  -- Debit the server price only. p_expected_price is not subtracted.",
    "  UPDATE game.verse_wallet",
    "     SET balance = balance - v_price",
    "   WHERE user_id = p_user_id",
    "     AND balance >= v_price",
    "  RETURNING balance INTO v_balance;",
    "  IF NOT FOUND THEN",
    "    v_response := jsonb_build_object('ok', false, 'reason', 'insufficient_verse', 'verse', v_verse);",
    "    INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "    VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "    RETURN v_response;",
    "  END IF;",
    "  PERFORM game.fault_at(p_user_id, 'purchase.after_wallet');",
    "",
    "  v_purchase := gen_random_uuid();",
    "",
    "  -- step_verse_ledger",
    "  INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)",
    "  VALUES (gen_random_uuid(), p_user_id, -v_price, v_balance, 'store', v_purchase);",
    "",
    "  -- step_item_grant",
    "  INSERT INTO game.item_owned (user_id, item_id, source, ref_id)",
    "  VALUES (p_user_id, p_item_id, 'store', v_purchase);",
    "  PERFORM game.fault_at(p_user_id, 'purchase.after_item');",
    "",
    "  -- step_item_ledger",
    "  INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)",
    "  VALUES (gen_random_uuid(), p_user_id, 'purchase', p_item_id, 'store', v_purchase);",
    "",
    "  -- step_store_purchase",
    "  INSERT INTO game.store_purchase (purchase_id, user_id, item_id, price, catalog_version, idem_key)",
    "  VALUES (v_purchase, p_user_id, p_item_id, v_price, v_catalog, p_idem_key);",
    "  PERFORM game.fault_at(p_user_id, 'purchase.after_purchase');",
    "",
    "  v_response := jsonb_build_object(",
    "    'ok', true,",
    "    'purchase_id', v_purchase,",
    "    'item_id', p_item_id,",
    "    'price', v_price,",
    "    'verse_after', v_balance",
    "  );",
    "",
    "  -- step_idempotency_write",
    "  INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "  VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "  RETURN v_response;",
    "EXCEPTION WHEN unique_violation THEN",
    "  SELECT response, req_hash INTO v_response, v_existing_hash",
    "  FROM game.idempotency",
    "  WHERE user_id = p_user_id AND key = p_idem_key;",
    "  IF FOUND THEN",
    "    IF v_existing_hash IS DISTINCT FROM v_hash THEN",
    "      RETURN jsonb_build_object('ok', false, 'reason', 'idem_mismatch', 'verse',",
    "        COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = p_user_id), 0));",
    "    END IF;",
    "    RETURN v_response;",
    "  END IF;",
    "  IF EXISTS (SELECT 1 FROM game.item_owned WHERE user_id = p_user_id AND item_id = p_item_id)",
    "     OR EXISTS (SELECT 1 FROM game.store_purchase WHERE user_id = p_user_id AND item_id = p_item_id)",
    "  THEN",
    "    v_response := jsonb_build_object('ok', false, 'reason', 'already_owned', 'verse',",
    "      COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = p_user_id), 0));",
    "    BEGIN",
    "      INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)",
    "      VALUES (p_user_id, p_idem_key, 'store.purchase', v_hash, v_response);",
    "    EXCEPTION WHEN unique_violation THEN",
    "      SELECT response, req_hash INTO v_response, v_existing_hash",
    "      FROM game.idempotency",
    "      WHERE user_id = p_user_id AND key = p_idem_key;",
    "      IF FOUND AND v_existing_hash IS NOT DISTINCT FROM v_hash THEN",
    "        RETURN v_response;",
    "      END IF;",
    "      IF FOUND THEN",
    "        RETURN jsonb_build_object('ok', false, 'reason', 'idem_mismatch', 'verse',",
    "          COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = p_user_id), 0));",
    "      END IF;",
    "      RAISE;",
    "    END;",
    "    RETURN v_response;",
    "  END IF;",
    "  RAISE;",
    "END;",
    "$fn$;",
  ].join("\n");

  var PURCHASE_CALL =
    "SELECT game.apply_store_purchase($1::uuid, $2::text, $3::numeric::bigint, $4::text, $5::text)::text AS result";

  function assertPurchaseSql(): void {
    var sql = APPLY_SQL;
    var markers = [
      "step_idempotency_read",
      "step_server_price",
      "step_owned_before_debit",
      "step_wallet_lock",
      "step_debit",
      "step_verse_ledger",
      "step_item_grant",
      "step_item_ledger",
      "step_store_purchase",
      "step_idempotency_write",
    ];
    var at = -1;
    for (var i = 0; i < markers.length; i++) {
      var next = sql.indexOf(markers[i]);
      if (next <= at) throw new Error("purchase_order");
      at = next;
    }
    if (sql.indexOf("balance - v_price") < 0) throw new Error("debit_source");
    if (sql.indexOf("balance - p_expected_price") >= 0) throw new Error("client_price");
    if (sql.indexOf("FROM game.store_item") < 0) throw new Error("price_table");
    if (PURCHASE_CALL.indexOf("apply_store_purchase") < 0) throw new Error("purchase_call");
    var blocked = EFFECT_IDS.concat(EARN_ONLY_IDS);
    for (var b = 0; b < blocked.length; b++) {
      if (sql.indexOf("'" + blocked[b] + "'") < 0) throw new Error("effect_guard");
    }
    for (var c = 0; c < CATALOG.length; c++) {
      if (inList(blocked, CATALOG[c].id)) throw new Error("item_effect");
    }
  }
  assertPurchaseSql();

  function fail(code: string): string {
    return JSON.stringify({ error: code, message: code });
  }

  function reject(reason: string, verse: number): string {
    return JSON.stringify({ ok: false, reason: reason, verse: verse });
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

  function integer(value: unknown): number | null {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) return null;
    if (value > 9007199254740991 || value < -9007199254740991) return null;
    return value;
  }

  function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) || "null";
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var items = value as unknown[];
      var parts: string[] = [];
      for (var i = 0; i < items.length; i++) parts.push(stable(items[i]));
      return "[" + parts.join(",") + "]";
    }
    var obj = value as { [key: string]: unknown };
    var keys = Object.keys(obj).sort();
    var body: string[] = [];
    for (var j = 0; j < keys.length; j++) {
      body.push(JSON.stringify(keys[j]) + ":" + stable(obj[keys[j]]));
    }
    return "{" + body.join(",") + "}";
  }

  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) throw new Error("empty_result");
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (isObject(raw)) return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell");
  }

  function verseBalance(nk: nkruntime.Nakama, userId: string): number {
    try {
      var rows = nk.sqlQuery(
        "SELECT COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = $1::uuid), 0)::text AS result",
        [userId],
      );
      if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return 0;
      var n = Number(rows[0].result);
      return isFinite(n) ? n : 0;
    } catch (_e) {
      return 0;
    }
  }

  /**
   * store.purchase. Hub session only. A game session is wrong_scope. A missing
   * session is unauthorized. Neither path writes. The SQL function does the
   * idempotency read, the server price check, the owned check, and the debit,
   * grant, and ledger inserts in one transaction.
   */
  export function purchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = ctx.userId;
    var scope = scopeOf(ctx);
    if (scope !== "" && scope !== "hub") return reject("wrong_scope", verseBalance(nk, userId));
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var idemKey = text(body, "idem_key");
    if (!idemKey || !UUID_V4.test(idemKey)) return fail("bad_key");
    var rawItem = body.item_id;
    if (typeof rawItem !== "string" || rawItem.length < 1 || rawItem.length > 64) return fail("bad_json");
    var itemId = rawItem;
    if (!("expected_price" in body)) return fail("bad_price");
    var expected = integer(body.expected_price);
    if (expected === null) return fail("bad_price");
    HubFault.apply(ctx, nk, userId, "purchase.before_rpc");
    var reqHash = nk.sha256Hash("store.purchase\n" + stable({ expected_price: expected, item_id: itemId }));
    var result = queryJson(nk, PURCHASE_CALL, [userId, itemId, expected, idemKey, reqHash]);
    HubFault.apply(ctx, nk, userId, "purchase.after_commit");
    if (result.ok === true) logger.info("store purchase " + itemId + " user " + userId);
    else logger.debug("store purchase rejected " + String(result.reason) + " user " + userId);
    return JSON.stringify(result);
  }
}
