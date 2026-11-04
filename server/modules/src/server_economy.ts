// Server-side Ticket calls for match handlers (Contract C6). Thin wrappers over
// the same SQL functions the tickets.* RPCs use, so caps, the session lease and
// game.idempotency apply unchanged. Results are the SQL function's JSON
// ({error} on failure). Keys must be deterministic per real-world event and
// sealed before the call, so a retry reuses the same key and amount.
// Server-only earn reasons start with srv_; tickets.earn rejects them from clients.
namespace HubEconomy {
  export interface Who {
    userId: string;
    /** ctx.vars.sid captured in matchJoinAttempt. */
    sid: string;
    game: string;
  }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var items = value as unknown[];
      var parts: string[] = [];
      for (var i = 0; i < items.length; i++) parts.push(stable(items[i]));
      return "[" + parts.join(",") + "]";
    }
    var obj = value as { [key: string]: unknown };
    var keys = Object.keys(obj).sort();
    var out: string[] = [];
    for (var j = 0; j < keys.length; j++) out.push(JSON.stringify(keys[j]) + ":" + stable(obj[keys[j]]));
    return "{" + out.join(",") + "}";
  }

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return { error: "empty_result" };
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (typeof raw === "object") return raw as { [key: string]: unknown };
    return { error: "bad_json_cell" };
  }

  function bad(who: Who, key: string): { [key: string]: unknown } | null {
    if (!who || !UUID.test(who.userId || "")) return { error: "unauthorized" };
    if (!UUID.test(who.sid || "")) return { error: "session_closed" };
    if (!who.game) return { error: "bad_game" };
    if (!key || key.length > 80) return { error: "bad_key" };
    return null;
  }

  function wholeCount(value: number): boolean {
    return typeof value === "number" && isFinite(value) && value > 0 && Math.floor(value) === value && value <= 1000000;
  }

  /** game.earn_tickets. Same request hash as tickets.earn, so a shared key replays the first answer. */
  export function earn(nk: nkruntime.Nakama, who: Who, amount: number, reason: string, key: string): { [k: string]: unknown } {
    var invalid = bad(who, key);
    if (invalid) return invalid;
    if (!wholeCount(amount)) return { error: "bad_amount" };
    if (!reason || reason.length > 64) return { error: "bad_reason" };
    var reqHash = nk.sha256Hash("tickets.earn\n" + stable({ amount: amount, reason: reason }));
    return queryJson(
      nk,
      "SELECT game.earn_tickets($1::uuid, $2::uuid, $3::text, $4::numeric::bigint, $5::text, $6::text, $7::text)::text AS result",
      [who.userId, who.sid, who.game, amount, reason, key, reqHash],
    );
  }

  export function spend(nk: nkruntime.Nakama, who: Who, shopId: string, itemId: string, packs: number, key: string): { [k: string]: unknown } {
    var invalid = bad(who, key);
    if (invalid) return invalid;
    if (!shopId || shopId.length > 64 || !itemId || itemId.length > 64) return { error: "unknown_item" };
    if (!wholeCount(packs)) return { error: "bad_amount" };
    var reqHash = nk.sha256Hash("tickets.spend\n" + stable({ game: who.game, shop_id: shopId, item_id: itemId, packs: packs }));
    return queryJson(
      nk,
      "SELECT game.spend_tickets($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text, $8::text)::text AS result",
      [who.userId, who.sid, who.game, shopId, itemId, packs, key, reqHash],
    );
  }

  export function sell(nk: nkruntime.Nakama, who: Who, shopId: string, itemId: string, packs: number, key: string): { [k: string]: unknown } {
    var invalid = bad(who, key);
    if (invalid) return invalid;
    if (!shopId || shopId.length > 64 || !itemId || itemId.length > 64) return { error: "unknown_item" };
    if (!wholeCount(packs)) return { error: "bad_amount" };
    var reqHash = nk.sha256Hash("tickets.sell\n" + stable({ game: who.game, shop_id: shopId, item_id: itemId, packs: packs }));
    return queryJson(
      nk,
      "SELECT game.sell_tickets($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text, $8::text)::text AS result",
      [who.userId, who.sid, who.game, shopId, itemId, packs, key, reqHash],
    );
  }

  /** { balance, sessionCapLeft, dailyCapLeft, serverTime }, the same numbers tickets.balance returns. */
  export function balance(nk: nkruntime.Nakama, who: Who): { [k: string]: unknown } {
    if (!who || !UUID.test(who.userId || "")) return { error: "unauthorized" };
    if (!UUID.test(who.sid || "")) return { error: "session_closed" };
    return queryJson(
      nk,
      "SELECT json_build_object('balance', COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = $1::uuid AND game_id = $2), 0), 'sessionCapLeft', GREATEST(0, game.session_ticket_cap() - COALESCE((SELECT SUM(delta) FROM game.tickets_ledger WHERE user_id = $1::uuid AND game_id = $2 AND ref_id = $3::uuid AND delta > 0 AND COALESCE(kind, '') <> 'refund' AND reason <> 'refund'), 0)), 'dailyCapLeft', GREATEST(0, 1000 - COALESCE((SELECT amount FROM game.earn_window WHERE user_id = $1::uuid AND bucket = 'tickets:' || $2 AND day = (now() AT TIME ZONE 'utc')::date), 0)), 'serverTime', floor(extract(epoch FROM now()) * 1000)::bigint)::text AS result",
      [who.userId, who.game, who.sid],
    );
  }
}
