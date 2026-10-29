// M6 item grants. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include this file. Wiring is docs/m6-server-prep.md.
//
// A pet or any other cosmetic item is granted only by session.event plus a
// matching game.item_rule row. The grant is one statement: insert item_owned,
// and only when that insert adds a row, insert item_ledger op grant_item.
// The primary key (user_id, item_id) caps each item at one per player.
// Nothing here credits Tickets, Verse, or Relics, and there is no grant RPC.

namespace HubItems {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  interface CanonicalEvent {
    event: string;
    game: string;
    /** A new event_type. Its event_rule row must set max_amount to 0. */
    fresh: boolean;
  }

  // Reasons the games already report, plus the one new pup event.
  // game_beaten is not a reason. Store purchase is not a session.event.
  var CANONICAL: CanonicalEvent[] = [
    { event: "hpos10i.level_complete", game: "hpos10i", fresh: false },
    { event: "nobu.boss_defeated", game: "nobu", fresh: false },
    { event: "sproto.boss_defeated", game: "sproto", fresh: false },
    { event: "pb.quest_complete", game: "peoples-bitcoin", fresh: false },
    { event: "pb.item_obtained", game: "peoples-bitcoin", fresh: true },
  ];

  // Relics stay on relic_claim. Relic summons stay derived and are never rows.
  var EXCLUDED = [
    "hpos10i_core",
    "genesis_shard",
    "cones_tip",
    "tinubu_crown",
    "pet_speed_sproto",
    "pet_nobu",
    "pet_duelist_sproto",
  ];

  export interface GrantResult {
    error: string | null;
    granted_items: string[];
  }

  function assertCatalog(): void {
    var seen: { [id: string]: boolean } = {};
    var fresh = 0;
    for (var i = 0; i < CANONICAL.length; i++) {
      var row = CANONICAL[i];
      if (row.event === "game_beaten" || seen[row.event] || !row.game) throw new Error("bad_canonical");
      seen[row.event] = true;
      if (row.fresh) fresh++;
    }
    if (CANONICAL.length !== 5 || fresh !== 1 || !seen["pb.item_obtained"]) throw new Error("bad_canonical");
    if (seen["store.purchase"]) throw new Error("bad_canonical");
    var excluded: { [id: string]: boolean } = {};
    for (var j = 0; j < EXCLUDED.length; j++) {
      if (excluded[EXCLUDED[j]]) throw new Error("bad_excluded");
      excluded[EXCLUDED[j]] = true;
    }
    if (!excluded["pet_speed_sproto"] || !excluded["pet_nobu"] || !excluded["pet_duelist_sproto"]) {
      throw new Error("bad_excluded");
    }
    if (!excluded["hpos10i_core"] || EXCLUDED.length !== 7) throw new Error("bad_excluded");
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

  /** Reject any statement that would credit economy, Relics, or beaten rows. */
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
    if (lower.indexOf("grant_item") < 0 || lower.indexOf("on conflict (user_id, item_id) do nothing") < 0) {
      throw new Error("missing_grant");
    }
    if (lower.indexOf("<> 'game_beaten'") < 0) throw new Error("game_beaten_grant");
  }

  function pairPredicate(): string {
    var parts: string[] = [];
    for (var i = 0; i < CANONICAL.length; i++) {
      parts.push("($3::text = " + sqlQuote(CANONICAL[i].game) + " AND $4::text = " + sqlQuote(CANONICAL[i].event) + ")");
    }
    return parts.join(" OR ");
  }

  function freshPredicate(): string {
    var parts: string[] = [];
    for (var i = 0; i < CANONICAL.length; i++) {
      if (!CANONICAL[i].fresh) continue;
      parts.push("$4::text = " + sqlQuote(CANONICAL[i].event));
    }
    if (!parts.length) return "FALSE";
    return parts.join(" OR ");
  }

  function excludedList(): string {
    var parts: string[] = [];
    for (var i = 0; i < EXCLUDED.length; i++) parts.push(sqlQuote(EXCLUDED[i]));
    return parts.join(", ");
  }

  function grantSql(): string {
    return [
      "WITH sess AS (",
      "  SELECT 1 FROM game.game_session",
      "  WHERE session_id = $2::uuid AND user_id = $1::uuid AND game_id = $3::text",
      "    AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL",
      "),",
      "eligible AS (",
      "  SELECT r.item_id FROM game.item_rule r",
      "  WHERE EXISTS (SELECT 1 FROM sess)",
      "    AND (" + pairPredicate() + ")",
      "    AND r.game_id = $3::text AND r.event_type = $4::text",
      "    AND r.event_type <> 'game_beaten'",
      "    AND r.match <> '{}'::jsonb",
      "    AND r.match <@ COALESCE($5::jsonb, '{}'::jsonb)",
      "    AND r.item_id NOT IN (" + excludedList() + ")",
      "    AND EXISTS (",
      "      SELECT 1 FROM game.event_rule e",
      "      WHERE e.game_id = r.game_id AND e.event_type = r.event_type",
      "        AND e.event_type <> 'game_beaten'",
      "        AND (NOT (" + freshPredicate() + ") OR e.max_amount = 0)",
      "    )",
      "),",
      "ins AS (",
      "  INSERT INTO game.item_owned (user_id, item_id, source, ref_id)",
      "  SELECT $1::uuid, item_id, 'event', gen_random_uuid() FROM eligible",
      "  ON CONFLICT (user_id, item_id) DO NOTHING",
      "  RETURNING item_id, ref_id",
      "),",
      "led AS (",
      "  INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)",
      "  SELECT ref_id, $1::uuid, 'grant_item', item_id, 'event', ref_id FROM ins",
      "  RETURNING item_id",
      ")",
      "SELECT jsonb_build_object(",
      "  'error', CASE WHEN NOT EXISTS (SELECT 1 FROM sess) THEN 'session_closed' ELSE NULL END,",
      "  'granted_items', COALESCE((SELECT json_agg(item_id ORDER BY item_id) FROM led), '[]'::json)",
      ")::text AS result",
    ].join("\n");
  }

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    assertCosmetic(sql);
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) {
      throw new Error("empty_result");
    }
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (isObject(raw)) return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell");
  }

  function asList(value: unknown): string[] {
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
    for (var i = 0; i < items.length; i++) if (typeof items[i] === "string") out.push(items[i] as string);
    return out;
  }

  function none(error: string | null): GrantResult {
    return { error: error, granted_items: [] };
  }

  function canonical(eventType: string): CanonicalEvent | null {
    for (var i = 0; i < CANONICAL.length; i++) {
      if (CANONICAL[i].event === eventType) return CANONICAL[i];
    }
    return null;
  }

  /**
   * Match item_rule for one session.event and grant each hit once.
   * Pass the server session's user, session id, and game. Never a client game id.
   * A second call for the same player and item inserts nothing and returns
   * granted_items empty. Wire this statement inside game.apply_event, before
   * the idempotency insert, so the stored response keeps the first list.
   * Do not register this as an RPC.
   */
  export function grantFromEvent(
    nk: nkruntime.Nakama,
    userId: string,
    sessionId: string,
    gameId: string,
    eventType: string,
    data: { [key: string]: unknown },
  ): GrantResult {
    if (!UUID.test(userId)) return none("unauthorized");
    if (!UUID.test(sessionId)) return none("session_closed");
    if (eventType === "game_beaten") return none("bad_event");
    var known = canonical(eventType);
    if (!known || known.game !== gameId) return none("bad_event");
    if (!isObject(data)) return none("bad_event");
    var encoded = "";
    try {
      encoded = JSON.stringify(data);
    } catch (_e) {
      return none("bad_event");
    }
    if (!encoded || encoded.length > 8192) return none("bad_event");
    var row = queryJson(nk, grantSql(), [userId, sessionId, gameId, eventType, encoded]);
    var error = typeof row.error === "string" && row.error ? row.error : null;
    var granted = error ? [] : asList(row.granted_items);
    var blocked: { [id: string]: boolean } = {};
    for (var i = 0; i < EXCLUDED.length; i++) blocked[EXCLUDED[i]] = true;
    for (var g = 0; g < granted.length; g++) {
      if (blocked[granted[g]]) throw new Error("derived_pet_grant");
    }
    return { error: error, granted_items: granted };
  }

  assertCatalog();
  assertCosmetic(grantSql());
}
