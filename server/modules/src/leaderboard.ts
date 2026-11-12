// Public leaderboards (score.submit → submit, leaderboard.top → top).
//
// Scores land in game.ranked_score, keyed (user, board, variant). A sproto
// client post is accepted only when game.game_session.ranked is true (the
// session row, never the client). HPOS10I's act time is two boards in one:
// a ranked session writes variant "" (the ranked standings, which feed meta);
// a normal hub-entered session writes variant "open" (gameplay plan B4), which
// the Bar shows and which never feeds meta or the ranked rows. Both are bounded
// (HPOS_FLOOR_S..HPOS_CEIL_S, Zone 1 Act 1 only) and open posts need an account
// with an email, not a guest. NOBU
// time trials are gear-free and always eligible (Contract C13): one board,
// variant = Classic level ("1".."3"), layout ("1v2".."3v2"), or new level ("4".."6"), integer milliseconds.
// peoples-bitcoin is exempt. sproto_wins and meta are server boards: only
// recordWin and the meta rollup write them. God-mode posts write no row.
// Nothing here credits Tickets, Verse, Relics, or items.

namespace HubBoards {

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true, "sproto-fighter": true, "sproto-arcade": true, "sproto-shooter": true, "sproto-coop-battle": true };
  var BOARD_GAME: { [id: string]: string } = {
    hpos10i_act_time: "hpos10i",
    nobu_trial_time: "nobu",
    pb_total_xp: "peoples-bitcoin",
    sproto_wins: "sproto",
    shooter_story_clear_ms_v1: "sproto-shooter",
    coop_stage_clear_ms_v1: "sproto-coop-battle",
  };
  /** asc keeps the lower time. desc keeps the higher total. incr adds wins. */
  var BOARD_MODE: { [id: string]: string } = {
    hpos10i_act_time: "asc",
    nobu_trial_time: "asc",
    pb_total_xp: "desc",
    sproto_wins: "incr",
    shooter_story_clear_ms_v1: "asc",
    coop_stage_clear_ms_v1: "asc",
  };

  /** Integer ms floors per NOBU level (same numbers as NOBU's src/config/trials.js) and the ceiling. */
  export var NOBU_FLOOR_MS: { [level: string]: number } = {
    "1": 15000, "2": 15000, "3": 12000,
    "1v2": 25700, "2v2": 26000, "3v2": 20600,
    "4": 24000, "6": 30000, "5": 21000,
  };
  export var NOBU_CEIL_MS = 1800000;
  /**
   * HPOS10I act time, in seconds, Zone 1 Act 1 only (the one act the game posts).
   * Floor: the act is 22,224 px from PlayerStart (x 96) to GoalSign (x 22320) in HPOS10I's
   * src/levels/data/z1_retro_rush_hills/act1.json, and the physics hard cap is 16 px/frame at 60 Hz
   * (docs/PHYSICS.md "Speed cap"), 960 px/s. Holding the cap for the whole act from a standing start
   * is impossible and would take 23.15 s, so no legitimate run is under 23 s (par is 80 s).
   */
  export var HPOS_BOARD_ZONE = "z1_retro_rush_hills";
  export var HPOS_BOARD_ACT = 1;
  export var HPOS_FLOOR_S = 23;
  export var HPOS_CEIL_S = 1800;
  export var HPOS_OPEN_VARIANT = "open";
  export var SUBMIT_EVERY_MS = 5000;
  /** Boards a client may not post to. */
  var SERVER_BOARDS: { [id: string]: boolean } = { meta: true, sproto_wins: true };

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
    + " AND (SELECT game_id FROM sess) IN ('sproto') THEN 'unranked'"
    + " WHEN $3::boolean THEN 'god_mode'"
    + " WHEN (SELECT game_id FROM sess) IS DISTINCT FROM $4::text THEN 'bad_board'"
    + " ELSE NULL END AS reason),"
    // HPOS10I from an unranked session lands on the "open" variant, decided from the session row.
    + " v AS (SELECT CASE WHEN (SELECT game_id FROM sess) = 'hpos10i' AND NOT COALESCE((SELECT ranked FROM sess), false)"
    + " THEN 'open' ELSE $9::text END AS variant),"
    + " prev AS (SELECT value FROM game.ranked_score WHERE user_id = $2::uuid AND board_id = $5::text AND variant = (SELECT variant FROM v)),"
    + " incoming AS (SELECT CASE"
    + " WHEN $6::text = 'asc' THEN LEAST(COALESCE((SELECT value FROM prev), $7::bigint), $7::bigint)"
    + " WHEN $6::text = 'incr' THEN COALESCE((SELECT value FROM prev), 0) + $7::bigint"
    + " ELSE GREATEST(COALESCE((SELECT value FROM prev), $7::bigint), $7::bigint) END AS value),"
    + " written AS ("
    + " INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)"
    + " SELECT $2::uuid, $5::text, (SELECT variant FROM v), (SELECT value FROM incoming), $8::jsonb, $1::uuid, now()"
    + " FROM gate WHERE reason IS NULL AND NOT ($6::text = 'incr' AND $7::bigint <= 0)"
    + " AND (NOT EXISTS (SELECT 1 FROM prev) OR (SELECT value FROM incoming) IS DISTINCT FROM (SELECT value FROM prev) OR $6::text = 'incr')"
    + " ON CONFLICT (user_id, board_id, variant) DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta, session_id = EXCLUDED.session_id, updated_at = now()"
    + " WHERE game.ranked_score.value IS DISTINCT FROM EXCLUDED.value OR $6::text = 'incr'"
    + " RETURNING value)"
    + " SELECT jsonb_build_object("
    + " 'reason', (SELECT reason FROM gate),"
    + " 'posted', EXISTS (SELECT 1 FROM written),"
    + " 'value', COALESCE((SELECT value FROM written), (SELECT value FROM prev)),"
    + " 'variant', (SELECT variant FROM v)"
    + " )::text AS result";

  var TOP_SQL = "WITH ranked AS ("
    + " SELECT s.user_id, COALESCE(u.username, '') AS name, s.value,"
    + " rank() OVER (ORDER BY CASE WHEN $2::text = 'asc' THEN s.value END ASC, CASE WHEN $2::text <> 'asc' THEN s.value END DESC) AS rnk"
    + " FROM game.ranked_score s LEFT JOIN users u ON u.id = s.user_id WHERE s.board_id = $1::text AND s.variant = $4::text"
    + " ) SELECT jsonb_build_object("
    + " 'boardId', $1::text, 'variant', $4::text, 'order', $2::text,"
    + " 'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'name', name, 'value', value, 'rank', rnk) ORDER BY rnk, user_id)"
    + " FROM (SELECT user_id, name, value, rnk FROM ranked ORDER BY rnk, user_id LIMIT $5::int) top_rows), '[]'::jsonb),"
    + " 'me', (SELECT jsonb_build_object('userId', user_id, 'name', name, 'value', value, 'rank', rnk) FROM ranked WHERE user_id = $3::uuid)"
    + " )::text AS result";

  // meta = sum over boards of round(1000 * (N - rank + 1) / N); a board with
  // variants (NOBU levels) contributes the average of its per-level scores.
  var META_SQL = "WITH scored AS ("
    + " SELECT user_id, board_id, variant, value,"
    + " rank() OVER (PARTITION BY board_id, variant ORDER BY"
    + " CASE WHEN board_id IN ('hpos10i_act_time', 'nobu_trial_time') THEN value END ASC,"
    + " CASE WHEN board_id IN ('pb_total_xp', 'sproto_wins') THEN value END DESC) AS rnk,"
    + " count(*) OVER (PARTITION BY board_id, variant) AS n"
    + " FROM game.ranked_score"
    + " WHERE board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins')"
    + " AND NOT (board_id = 'hpos10i_act_time' AND variant = 'open')"
    + " ), per_variant AS ("
    + " SELECT user_id, board_id, round((1000::numeric * (n - rnk + 1)) / NULLIF(n, 0)) AS score FROM scored"
    + " ), per_board AS ("
    + " SELECT user_id, board_id, avg(score) AS score FROM per_variant GROUP BY user_id, board_id"
    + " ), contrib AS ("
    + " SELECT user_id, round(SUM(score))::bigint AS meta_value FROM per_board GROUP BY user_id"
    + " ), upserted AS ("
    + " INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)"
    + " SELECT user_id, 'meta', '', meta_value, '{}'::jsonb, NULL, now() FROM contrib WHERE meta_value IS NOT NULL"
    + " ON CONFLICT (user_id, board_id, variant) DO UPDATE SET value = EXCLUDED.value, meta = '{}'::jsonb, session_id = NULL, updated_at = now()"
    + " WHERE game.ranked_score.value IS DISTINCT FROM EXCLUDED.value"
    + " RETURNING user_id)"
    + " SELECT jsonb_build_object('players', (SELECT count(*) FROM contrib), 'updated', (SELECT count(*) FROM upserted))::text AS result";

  var META_DROP_SQL = "WITH removed AS ("
    + " DELETE FROM game.ranked_score AS m WHERE m.board_id = 'meta' AND NOT EXISTS ("
    + " SELECT 1 FROM game.ranked_score AS s WHERE s.user_id = m.user_id"
    + " AND s.board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins')"
    + " AND NOT (s.board_id = 'hpos10i_act_time' AND s.variant = 'open')"
    + " ) RETURNING m.user_id)"
    + " SELECT jsonb_build_object('removed', (SELECT count(*) FROM removed))::text AS result";

  function variantFor(boardId: string, meta: { [key: string]: unknown }): string | null {
    if (boardId !== "nobu_trial_time") return "";
    var level = meta.level;
    var key = typeof level === "number" && isFinite(level) ? String(level) : typeof level === "string" ? level : "";
    return Object.prototype.hasOwnProperty.call(NOBU_FLOOR_MS, key) ? key : null;
  }

  /**
   * score.submit. The server decides eligibility: {accepted:false, reason} for
   * server_board / unranked / god_mode, an {error} for bad input. NOBU posts
   * integer ms per level and counts from unranked sessions.
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
    // Clients cannot post a Shooter or Coop clear. Settlement writes the row in the same receipt.
    if (boardId === "shooter_story_clear_ms_v1" || boardId === "coop_stage_clear_ms_v1") return fail("bad_board");
    if (SERVER_BOARDS[boardId]) return JSON.stringify({ accepted: false, reason: "server_board" });
    var mode = BOARD_MODE[boardId];
    if (!mode) return fail("bad_board");
    if (typeof body.value !== "number" || !isFinite(body.value) || body.value < 0) return fail("bad_score");
    var meta = body.meta;
    if (meta === undefined || meta === null) meta = {};
    if (!isObject(meta)) return fail("bad_json");
    var metaObj = meta as { [key: string]: unknown };
    var metaText = JSON.stringify(storedMeta(metaObj));
    if (metaText.length > 512) return fail("bad_json");
    var variant = variantFor(boardId, metaObj);
    if (variant === null) return fail("bad_variant");
    var score: number;
    if (boardId === "nobu_trial_time") {
      if (Math.floor(body.value) !== body.value) return fail("bad_score");
      score = body.value;
      if (score < NOBU_FLOOR_MS[variant] || score > NOBU_CEIL_MS) {
        logger.warn("implausible nobu time " + String(score) + " level " + variant + " user " + session.userId);
        return fail("implausible_score");
      }
    } else if (boardId === "hpos10i_act_time") {
      if (metaObj.zone !== HPOS_BOARD_ZONE || metaObj.act !== HPOS_BOARD_ACT) return fail("bad_variant");
      if (body.value < HPOS_FLOOR_S || body.value > HPOS_CEIL_S) {
        logger.warn("implausible hpos10i time " + String(body.value) + " user " + session.userId);
        return fail("implausible_score");
      }
      score = Math.round(body.value);
      // An unranked (plaza-entered) post goes to the open board and needs a real account.
      var vars = ctx.vars || {};
      if (vars.ranked !== "1" && HubChat.isGuest(nk, logger, session.userId)) {
        return JSON.stringify({ accepted: false, reason: "guest" });
      }
    } else {
      score = Math.round(body.value);
    }
    var god = body.godMode === true || body.god_mode === true || metaObj.godMode === true || metaObj.god === true || metaObj.god_mode === true;
    var rateKey = "score:" + session.userId + ":" + boardId + ":" + variant;
    var last = Number(nk.localcacheGet(rateKey) || 0);
    var now = Date.now();
    if (last && now - last < SUBMIT_EVERY_MS) return fail("rate_limited");
    nk.localcachePut(rateKey, now, Math.ceil(SUBMIT_EVERY_MS / 1000));
    var row = queryJson(nk, SUBMIT_SQL, [
      session.sid,
      session.userId,
      god,
      BOARD_GAME[boardId],
      boardId,
      mode,
      score,
      metaText,
      variant,
    ]);
    var reason = typeof row.reason === "string" ? row.reason : "";
    if (reason === "unranked" || reason === "god_mode") {
      logger.debug("score skipped " + reason + " " + boardId);
      return JSON.stringify({ accepted: false, reason: reason });
    }
    if (reason) return fail(reason);
    var posted = row.posted === true || row.posted === "true";
    if (posted) logger.info("score posted " + boardId + (variant ? ":" + variant : "") + " user " + session.userId);
    return JSON.stringify({
      accepted: true,
      posted: posted,
      value: asInt(row.value, score),
      order: mode === "asc" ? "asc" : "desc",
    });
  }

  /** Top rows (default 10, max 50) plus the caller's own row. Any signed-in session (hub or game) can read. */
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
    var variant = "";
    if (boardId === "nobu_trial_time") {
      variant = variantFor(boardId, { level: body.variant }) || "";
      if (!variant) return fail("bad_variant");
    } else if (boardId === "hpos10i_act_time") {
      // "" is the ranked standings; "open" is what normal hub sessions post.
      if (body.variant !== undefined && body.variant !== "" && body.variant !== HPOS_OPEN_VARIANT) return fail("bad_variant");
      variant = body.variant === HPOS_OPEN_VARIANT ? HPOS_OPEN_VARIANT : "";
    } else if (boardId === CoopRewards.BOARD_ID) {
      // One row per boss (gameplay plan E5): the variant is one of the twelve settled boss ids.
      variant = typeof body.variant === "string" ? body.variant : "";
      if (CoopRewards.BOSSES.indexOf(variant) < 0) return fail("bad_variant");
    }
    var limit = asInt(body.limit, 10);
    if (limit < 1) limit = 1;
    if (limit > 50) limit = 50;
    var order = boardId === "meta" || BOARD_MODE[boardId] !== "asc" ? "desc" : "asc";
    var result = queryJson(nk, TOP_SQL, [boardId, order, ctx.userId, variant, limit]);
    var rows = result.rows;
    if (Object.prototype.toString.call(rows) === "[object Array]") for (var i = 0; i < (rows as unknown[]).length; i++) cleanRowName((rows as unknown[])[i]);
    cleanRowName(result.me);
    return JSON.stringify(result);
  }

  /**
   * Board names are usernames: clean them for display (HubMatch.cleanName; accounts are never renamed).
   * A name that cleans to "" shows the first 8 characters of the row's userId, like the SQL
   * fallback for a missing username. Clients group rows by userId, never by name.
   */
  export function cleanRowName(row: unknown): void {
    if (!isObject(row)) return;
    var r = row as { [key: string]: unknown };
    if (r.name === undefined) return;
    var name = HubMatch.cleanName(r.name);
    if (!name && typeof r.userId === "string") name = r.userId.slice(0, 8);
    r.name = name;
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

  var WIN_SQL = "WITH ins AS ("
    + " INSERT INTO game.win_record (match_id, user_id, board_id) VALUES ($1::text, $2::uuid, $3::text)"
    + " ON CONFLICT (match_id, user_id) DO NOTHING RETURNING user_id),"
    + " up AS ("
    + " INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)"
    + " SELECT user_id, $3::text, '', 1, '{}'::jsonb, NULL, now() FROM ins"
    + " ON CONFLICT (user_id, board_id, variant) DO UPDATE SET value = game.ranked_score.value + 1, updated_at = now()"
    + " RETURNING value)"
    + " SELECT jsonb_build_object('recorded', EXISTS (SELECT 1 FROM ins), 'value', (SELECT value FROM up))::text AS result";

  /**
   * Server-only +1 on an incr board (sproto_wins). Idempotent on matchId through
   * game.win_record. Returns false when this (match, user) was already recorded.
   */
  export function recordWin(nk: nkruntime.Nakama, userId: string, boardId: string, matchId: string): boolean {
    if (!UUID.test(userId || "")) throw new Error("unauthorized");
    if (BOARD_MODE[boardId] !== "incr") throw new Error("bad_board");
    if (!matchId || matchId.length > 128) throw new Error("bad_match");
    var row = queryJson(nk, WIN_SQL, [matchId, userId, boardId]);
    return row.recorded === true || row.recorded === "true";
  }

  export var META_EVERY_MS = 5 * 60 * 1000;

  /**
   * Time-based meta rollup, called from every hub shard's loop. The node-wide
   * localcache stamp makes one shard run it per window; the SQL itself is safe to repeat.
   */
  export function maybeRecomputeMeta(nk: nkruntime.Nakama, logger: nkruntime.Logger, nowMs: number): boolean {
    var last = Number(nk.localcacheGet("hub:meta:last") || 0);
    if (!last) {
      nk.localcachePut("hub:meta:last", nowMs, 0);
      return false;
    }
    if (nowMs - last < META_EVERY_MS) return false;
    nk.localcachePut("hub:meta:last", nowMs, 0);
    recomputeMeta(nk, logger);
    return true;
  }
}
