// M3 leaderboards. Not registered and not in tsconfig.json `files`, so the
// Nakama bundle does not include this. Wiring is docs/m3-server-prep.md.
//
// Scores land in game.ranked_score. Time and win boards for hpos10i, nobu,
// and sproto accept a write only when game.game_session.ranked is true.
// That flag is the session row, never the client. peoples-bitcoin is exempt.
// God-mode posts write no row. The meta board is recomputed from the four
// game boards. Nothing here credits Tickets, Verse, Relics, or items.

namespace HubBoards {
  /** 15 Hz times five minutes. The hub match calls onHubTick. */
  export var META_EVERY_TICKS = 4500;

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true };
  var BOARD_GAME: { [id: string]: string } = {
    hpos10i_act_time: "hpos10i",
    nobu_trial_time: "nobu",
    pb_total_xp: "peoples-bitcoin",
    sproto_wins: "sproto",
  };
  /** asc keeps the lower time. desc keeps the higher total. incr adds wins. */
  var BOARD_MODE: { [id: string]: string } = {
    hpos10i_act_time: "asc",
    nobu_trial_time: "asc",
    pb_total_xp: "desc",
    sproto_wins: "incr",
  };

  interface Session {
    userId: string;
    game: string;
    sid: string;
  }

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

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    assertNoGrant(sql);
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) throw new Error("empty_result");
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (isObject(raw)) return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell");
  }

  function sessionOf(ctx: nkruntime.Context): Session | null {
    if (!ctx.userId || !UUID.test(ctx.userId)) return null;
    var vars = ctx.vars || {};
    if (vars.scope !== "game" || !vars.game || !GAMES[vars.game] || !vars.sid || !UUID.test(vars.sid)) return null;
    return { userId: ctx.userId, game: vars.game, sid: vars.sid };
  }

  function storedMeta(meta: { [key: string]: unknown }): { [key: string]: unknown } {
    var out: { [key: string]: unknown } = {};
    var keys = Object.keys(meta);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === "godMode" || keys[i] === "god" || keys[i] === "god_mode") continue;
      out[keys[i]] = meta[keys[i]];
    }
    return out;
  }

  var SUBMIT_SQL = "WITH sess AS ("
    + " SELECT ranked, game_id FROM game.game_session"
    + " WHERE session_id = $1::uuid AND user_id = $2::uuid AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL"
    + " ), gate AS (SELECT CASE"
    + " WHEN NOT EXISTS (SELECT 1 FROM sess) THEN 'session_closed'"
    + " WHEN NOT COALESCE((SELECT ranked FROM sess), false)"
    + " AND (SELECT game_id FROM sess) IN ('hpos10i', 'nobu', 'sproto') THEN 'unranked'"
    + " WHEN $3::boolean THEN 'god_mode'"
    + " WHEN (SELECT game_id FROM sess) IS DISTINCT FROM $4::text THEN 'bad_board'"
    + " ELSE NULL END AS reason),"
    + " prev AS (SELECT value FROM game.ranked_score WHERE user_id = $2::uuid AND board_id = $5::text),"
    + " incoming AS (SELECT CASE"
    + " WHEN $6::text = 'asc' THEN LEAST(COALESCE((SELECT value FROM prev), $7::bigint), $7::bigint)"
    + " WHEN $6::text = 'incr' THEN COALESCE((SELECT value FROM prev), 0) + $7::bigint"
    + " ELSE GREATEST(COALESCE((SELECT value FROM prev), $7::bigint), $7::bigint) END AS value),"
    + " written AS ("
    + " INSERT INTO game.ranked_score (user_id, board_id, value, meta, session_id, updated_at)"
    + " SELECT $2::uuid, $5::text, (SELECT value FROM incoming), $8::jsonb, $1::uuid, now()"
    + " FROM gate WHERE reason IS NULL AND NOT ($6::text = 'incr' AND $7::bigint <= 0)"
    + " AND (NOT EXISTS (SELECT 1 FROM prev) OR (SELECT value FROM incoming) IS DISTINCT FROM (SELECT value FROM prev) OR $6::text = 'incr')"
    + " ON CONFLICT (user_id, board_id) DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta, session_id = EXCLUDED.session_id, updated_at = now()"
    + " WHERE game.ranked_score.value IS DISTINCT FROM EXCLUDED.value OR $6::text = 'incr'"
    + " RETURNING value)"
    + " SELECT jsonb_build_object("
    + " 'reason', (SELECT reason FROM gate),"
    + " 'posted', EXISTS (SELECT 1 FROM written),"
    + " 'value', COALESCE((SELECT value FROM written), (SELECT value FROM prev))"
    + " )::text AS result";

  var TOP_SQL = "WITH ranked AS ("
    + " SELECT s.user_id, COALESCE(u.username, '') AS name, s.value,"
    + " rank() OVER (ORDER BY CASE WHEN $2::text = 'asc' THEN s.value END ASC, CASE WHEN $2::text <> 'asc' THEN s.value END DESC) AS rnk"
    + " FROM game.ranked_score s LEFT JOIN users u ON u.id = s.user_id WHERE s.board_id = $1::text"
    + " ) SELECT jsonb_build_object("
    + " 'boardId', $1::text, 'order', $2::text,"
    + " 'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'name', name, 'value', value, 'rank', rnk) ORDER BY rnk, user_id)"
    + " FROM (SELECT user_id, name, value, rnk FROM ranked ORDER BY rnk, user_id LIMIT 10) top_rows), '[]'::jsonb),"
    + " 'me', (SELECT jsonb_build_object('userId', user_id, 'name', name, 'value', value, 'rank', rnk) FROM ranked WHERE user_id = $3::uuid)"
    + " )::text AS result";

  var META_SQL = "WITH scored AS ("
    + " SELECT user_id, board_id, value,"
    + " rank() OVER (PARTITION BY board_id ORDER BY"
    + " CASE WHEN board_id IN ('hpos10i_act_time', 'nobu_trial_time') THEN value END ASC,"
    + " CASE WHEN board_id IN ('pb_total_xp', 'sproto_wins') THEN value END DESC) AS rnk,"
    + " count(*) OVER (PARTITION BY board_id) AS n"
    + " FROM game.ranked_score"
    + " WHERE board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins')"
    + " ), contrib AS ("
    + " SELECT user_id, SUM(round((1000::numeric * (n - rnk + 1)) / NULLIF(n, 0)))::bigint AS meta_value"
    + " FROM scored GROUP BY user_id"
    + " ), upserted AS ("
    + " INSERT INTO game.ranked_score (user_id, board_id, value, meta, session_id, updated_at)"
    + " SELECT user_id, 'meta', meta_value, '{}'::jsonb, NULL, now() FROM contrib WHERE meta_value IS NOT NULL"
    + " ON CONFLICT (user_id, board_id) DO UPDATE SET value = EXCLUDED.value, meta = '{}'::jsonb, session_id = NULL, updated_at = now()"
    + " WHERE game.ranked_score.value IS DISTINCT FROM EXCLUDED.value"
    + " RETURNING user_id)"
    + " SELECT jsonb_build_object('players', (SELECT count(*) FROM contrib), 'updated', (SELECT count(*) FROM upserted))::text AS result";

  var META_DROP_SQL = "WITH removed AS ("
    + " DELETE FROM game.ranked_score AS m WHERE m.board_id = 'meta' AND NOT EXISTS ("
    + " SELECT 1 FROM game.ranked_score AS s WHERE s.user_id = m.user_id"
    + " AND s.board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins')"
    + " ) RETURNING m.user_id)"
    + " SELECT jsonb_build_object('removed', (SELECT count(*) FROM removed))::text AS result";

  /**
   * Replacement for score.submit. For hpos10i, nobu, and sproto, a write is
   * accepted only when game.game_session.ranked is true. A ranked field on
   * the payload is ignored. peoples-bitcoin may post pb_total_xp from an
   * unranked session. godMode on the body or on meta posts nothing. meta is
   * not a client board. Operators match the live score.submit modes.
   */
  export function submit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var session = sessionOf(ctx);
    if (!session) return fail("not_game_session");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var boardId = text(body, "boardId");
    if (!boardId && text(body, "board_id")) boardId = text(body, "board_id");
    if (boardId === "meta") return JSON.stringify({ accepted: false, reason: "server_board" });
    var mode = BOARD_MODE[boardId];
    if (!mode) return fail("bad_board");
    if (typeof body.value !== "number" || !isFinite(body.value) || body.value < 0) return fail("bad_score");
    var meta = body.meta;
    if (meta === undefined || meta === null) meta = {};
    if (!isObject(meta)) return fail("bad_json");
    var metaObj = meta as { [key: string]: unknown };
    var god = body.godMode === true || body.god_mode === true || metaObj.godMode === true || metaObj.god === true || metaObj.god_mode === true;
    var score = Math.round(body.value);
    if (score < 0) return fail("bad_score");
    var row = queryJson(nk, SUBMIT_SQL, [
      session.sid,
      session.userId,
      god,
      BOARD_GAME[boardId],
      boardId,
      mode,
      score,
      JSON.stringify(storedMeta(metaObj)),
    ]);
    var reason = typeof row.reason === "string" ? row.reason : "";
    if (reason === "unranked" || reason === "god_mode") {
      logger.debug("score skipped " + reason + " " + boardId);
      return JSON.stringify({ accepted: false, reason: reason });
    }
    if (reason) return fail(reason);
    var posted = row.posted === true || row.posted === "true";
    if (posted) logger.info("score posted " + boardId + " user " + session.userId);
    return JSON.stringify({
      accepted: true,
      posted: posted,
      value: asInt(row.value, score),
      order: mode === "asc" ? "asc" : "desc",
    });
  }

  /** Top 10 plus the caller's rank. Any authenticated session can read. */
  export function top(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var body: { [key: string]: unknown };
    try {
      body = parse(payload);
    } catch (_e) {
      return fail("bad_json");
    }
    var boardId = text(body, "boardId");
    if (!boardId && text(body, "board_id")) boardId = text(body, "board_id");
    if (boardId !== "meta" && !BOARD_MODE[boardId]) return fail("bad_board");
    var order = boardId === "meta" || BOARD_MODE[boardId] !== "asc" ? "desc" : "asc";
    return JSON.stringify(queryJson(nk, TOP_SQL, [boardId, order, ctx.userId]));
  }

  /**
   * meta = sum over the four boards of round(1000 * (N - rank + 1) / N).
   * N is the number of ranked rows on that board. A board with none adds 0.
   * Ties share rank(). Writes game.ranked_score only.
   */
  export function recomputeMeta(nk: nkruntime.Nakama, logger: nkruntime.Logger): { [key: string]: unknown } {
    var wrote = queryJson(nk, META_SQL, []);
    var dropped = queryJson(nk, META_DROP_SQL, []);
    logger.info("meta recomputed players " + String(wrote.players || 0));
    return { players: asInt(wrote.players, 0), updated: asInt(wrote.updated, 0), removed: asInt(dropped.removed, 0) };
  }

  export function onHubTick(nk: nkruntime.Nakama, logger: nkruntime.Logger, tick: number): void {
    if (tick < META_EVERY_TICKS || tick % META_EVERY_TICKS !== 0) return;
    recomputeMeta(nk, logger);
  }
}
