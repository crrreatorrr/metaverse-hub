namespace HubRpc {
  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true };
  var BOARDS: { [id: string]: boolean } = {
    hpos10i_act_time: true,
    nobu_trial_time: true,
    pb_total_xp: true,
    sproto_wins: true,
    meta: true,
  };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  export function fail(code: string, message: string): string {
    return JSON.stringify({ error: code, message: message });
  }

  function ok(body: { [key: string]: unknown }): string {
    return JSON.stringify(body);
  }

  export function mapError(e: unknown): string | null {
    var message = "";
    if (e && typeof e === "object" && "message" in e) message = String((e as { message: unknown }).message);
    else message = String(e);
    var codes = [
      "idempotency_mismatch",
      "session_closed",
      "ticket_used",
      "ticket_expired",
      "ticket_invalid",
      "ticket_game",
      "recovery_exists",
      "recovery_invalid",
      "recovery_same_account",
      "bad_key",
      "bad_event",
      "bad_game",
      "bad_json",
      "unknown_item",
      "unauthorized",
      "not_game_session",
      "not_hub_session",
      "device_mismatch",
      "restore_failed",
      "missing_ticket_key",
      "missing_recovery_pepper",
    ];
    for (var i = 0; i < codes.length; i++) {
      if (message.indexOf(codes[i]) >= 0) return codes[i];
    }
    return null;
  }

  export function wrap(fn: nkruntime.RpcFunction): nkruntime.RpcFunction {
    return function (ctx, logger, nk, payload) {
      try {
        return fn(ctx, logger, nk, payload);
      } catch (e) {
        var mapped = mapError(e);
        if (mapped) return fail(mapped, mapped);
        logger.error("rpc failure " + String(e));
        throw e;
      }
    };
  }

  function parse(payload: string): { [key: string]: unknown } {
    if (!payload) return {};
    if (payload.length > 8192) throw new Error("bad_json");
    var data = JSON.parse(payload) as unknown;
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") {
      throw new Error("bad_json");
    }
    return data as { [key: string]: unknown };
  }

  function text(data: { [key: string]: unknown }, key: string): string {
    var value = data[key];
    return typeof value === "string" ? value : "";
  }

  function failBody(result: { [key: string]: unknown }): string {
    var body: { [key: string]: unknown } = {
      error: String(result.error),
      message: String(result.message || result.error),
    };
    var left = result.capLeft;
    if (typeof left === "number" && isFinite(left)) body.capLeft = left;
    else if (typeof left === "string" && left !== "" && isFinite(Number(left))) body.capLeft = Number(left);
    return JSON.stringify(body);
  }

  function wholeQty(value: unknown): number {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || Math.floor(value) !== value || value > 1000000) {
      return 0;
    }
    return value;
  }

  function flag(data: { [key: string]: unknown }, key: string): boolean {
    return data[key] === true;
  }

  function requireUser(ctx: nkruntime.Context): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) throw new Error("unauthorized");
    return ctx.userId;
  }

  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  function requireHub(ctx: nkruntime.Context): string {
    var userId = requireUser(ctx);
    if (scopeOf(ctx) === "game") throw new Error("not_hub_session");
    return userId;
  }

  function requireGame(ctx: nkruntime.Context): { userId: string; game: string; sid: string; ranked: boolean } {
    var userId = requireUser(ctx);
    var vars = ctx.vars || {};
    if (vars.scope !== "game" || !vars.game || !vars.sid || !GAMES[vars.game] || !UUID.test(vars.sid)) {
      throw new Error("not_game_session");
    }
    return { userId: userId, game: vars.game, sid: vars.sid, ranked: vars.ranked === "1" };
  }

  function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) {
      throw new Error("empty_result");
    }
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (typeof raw === "object") return raw as { [key: string]: unknown };
    throw new Error("bad_json_cell " + typeof raw);
  }

  function queryList(nk: nkruntime.Nakama, sql: string, args: unknown[]): unknown[] {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length) return [];
    var raw = rows[0].result;
    var parsed: unknown = raw;
    if (typeof raw === "string") parsed = JSON.parse(raw);
    if (!parsed || Object.prototype.toString.call(parsed) !== "[object Array]") return [];
    return parsed as unknown[];
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

  /** Daily Ticket room. Matches the 1000 cap inside game.earn_tickets. */
  function ticketsRoom(nk: nkruntime.Nakama, userId: string, game: string): number {
    var rows = nk.sqlQuery(
      "SELECT GREATEST(0, 1000 - COALESCE((SELECT amount FROM game.earn_window WHERE user_id = $1::uuid AND bucket = $2 AND day = (now() AT TIME ZONE 'utc')::date), 0))::text AS result",
      [userId, "tickets:" + game],
    );
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return 1000;
    var raw = rows[0].result;
    var parsed = typeof raw === "number" ? raw : Number(raw);
    if (!isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  }

  function relicIds(nk: nkruntime.Nakama, userId: string): string[] {
    var rows = queryList(
      nk,
      "SELECT COALESCE(json_agg(relic_id ORDER BY claimed_at), '[]'::json)::text AS result FROM game.relic_claim WHERE user_id = $1::uuid",
      [userId],
    );
    var out: string[] = [];
    for (var i = 0; i < rows.length; i++) if (typeof rows[i] === "string") out.push(rows[i] as string);
    return out;
  }

  function beatenRows(nk: nkruntime.Nakama, userId: string): { gameId: string; relicId: string }[] {
    var rows = queryList(
      nk,
      "SELECT COALESCE(json_agg(json_build_object('gameId', game_id, 'relicId', relic_id) ORDER BY game_id), '[]'::json)::text AS result FROM game.game_beaten WHERE user_id = $1::uuid",
      [userId],
    );
    var out: { gameId: string; relicId: string }[] = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] as { gameId?: unknown; relicId?: unknown };
      if (row && typeof row.gameId === "string" && typeof row.relicId === "string") {
        out.push({ gameId: row.gameId, relicId: row.relicId });
      }
    }
    return out;
  }

  function syncStorage(nk: nkruntime.Nakama, userId: string, rows: { gameId: string; relicId: string }[]): void {
    if (!rows.length) return;
    var writes: nkruntime.StorageWrite[] = [];
    for (var i = 0; i < rows.length; i++) {
      writes.push({
        collection: "metaverse",
        key: "game_beaten:" + rows[i].gameId,
        userId: userId,
        value: { beaten: true, gameId: rows[i].gameId, relicId: rows[i].relicId },
        permissionRead: 1,
        permissionWrite: 0,
      });
    }
    nk.storageWrite(writes);
  }

  function pepper(ctx: nkruntime.Context): string {
    var value = ctx.env ? ctx.env.RECOVERY_PEPPER : "";
    if (!value) throw new Error("missing_recovery_pepper");
    return value;
  }

  function normalizeCode(input: string): string {
    var upper = input.toUpperCase();
    var stripped = "";
    for (var i = 0; i < upper.length; i++) {
      var c = upper.charAt(i);
      if ((c >= "0" && c <= "9") || (c >= "A" && c <= "F")) stripped += c;
    }
    if (stripped.length !== 16) throw new Error("recovery_invalid");
    return stripped;
  }

  function makeCode(nk: nkruntime.Nakama): string {
    var raw = nk.uuidv4().replace(/-/g, "").toUpperCase().substring(0, 16);
    return raw.substring(0, 4) + "-" + raw.substring(4, 8) + "-" + raw.substring(8, 12) + "-" + raw.substring(12, 16);
  }

  function usernameOf(nk: nkruntime.Nakama, userId: string): string {
    var account = nk.accountGetId(userId);
    var name = account && account.user ? account.user.username : "";
    if (!name) throw new Error("unauthorized");
    return name;
  }

  function deviceOwned(nk: nkruntime.Nakama, userId: string, deviceId: string): boolean {
    var account = nk.accountGetId(userId);
    var devices = account && account.devices ? account.devices : [];
    for (var i = 0; i < devices.length; i++) {
      var device = devices[i];
      if (device && device.id === deviceId) return true;
    }
    return false;
  }

  export function health(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    nk.sqlQuery("SELECT count(*)::text AS n FROM game.relic_claim", []);
    logger.debug("health user " + (ctx.userId || "anonymous"));
    return ok({ ok: true });
  }

  export function profile(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    var userId = requireUser(ctx);
    var relics = relicIds(nk, userId);
    var beaten = beatenRows(nk, userId);
    try {
      syncStorage(nk, userId, beaten);
    } catch (e) {
      _logger.warn("storage sync failed " + String(e));
    }
    var games: string[] = [];
    for (var i = 0; i < beaten.length; i++) games.push(beaten[i].gameId);
    var wallet = queryJson(
      nk,
      "SELECT json_build_object('balance', COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = $1::uuid), 0), 'earned', COALESCE((SELECT json_agg(json_build_object('gameId', game_id, 'lifetime', lifetime) ORDER BY game_id) FROM game.verse_earned WHERE user_id = $1::uuid), '[]'::json))::text AS result",
      [userId],
    );
    var profileBody: { [key: string]: unknown } = {
      playerId: userId,
      relics: relics,
      gameBeaten: games,
      scope: scopeOf(ctx),
      verse: Number(wallet.balance) || 0,
      verseEarned: wallet.earned || [],
    };
    var profileGame = ctx.vars && ctx.vars.game ? ctx.vars.game : "";
    if (scopeOf(ctx) === "game" && GAMES[profileGame]) {
      profileBody.ticketsCapLeft = ticketsRoom(nk, userId, profileGame);
    }
    return ok(profileBody);
  }

  export function verseBoard(_ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    var rows: unknown[] = [];
    try {
      rows = queryList(
        nk,
        "SELECT COALESCE((SELECT json_agg(json_build_object('name', COALESCE(u.username, left(e.user_id::text, 8)), 'gameId', e.game_id, 'lifetime', e.lifetime) ORDER BY e.lifetime DESC) FROM game.verse_earned e LEFT JOIN users u ON u.id = e.user_id), '[]'::json)::text AS result",
        [],
      );
    } catch (e) {
      _logger.warn("verse board query failed " + String(e));
      rows = [];
    }
    return ok({ rows: rows });
  }

  export function portalEnter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = requireHub(ctx);
    var body = parse(payload);
    var game = text(body, "game");
    if (!GAMES[game]) return fail("bad_game", "Unknown game");
    if (body.ranked !== undefined && typeof body.ranked !== "boolean") return fail("bad_json", "ranked must be boolean");
    var ranked = flag(body, "ranked");
    var relics = relicIds(nk, userId);
    var effects = HubEffects.resolve(game, relics, ranked);
    var sessionId = nk.uuidv4();
    var ticketJti = nk.uuidv4();
    var opened = queryJson(
      nk,
      "SELECT game.open_portal($1::uuid, $2::uuid, $3::text, $4::boolean, $5::jsonb, $6::uuid)::text AS result",
      [userId, sessionId, game, ranked, JSON.stringify(effects), ticketJti],
    );
    if (opened.error) return fail(String(opened.error), String(opened.error));
    var exp = Number(opened.exp);
    var iat = Number(opened.iat);
    var ticket = HubTickets.issue(ctx, nk, {
      jti: ticketJti,
      sid: sessionId,
      game: game,
      uid: userId,
      ranked: ranked,
      exp: exp,
      iat: iat,
      iss: "hub",
    });
    logger.info("portal enter " + game + " user " + userId);
    return ok({ ticket: ticket, sessionId: sessionId, expiresAt: exp });
  }

  export function sessionRedeem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload);
    var ticket = text(body, "ticket");
    var gameId = text(body, "gameId");
    if (!GAMES[gameId]) return fail("bad_game", "Unknown game");
    var claims = HubTickets.read(ctx, nk, ticket);
    if (!claims) return fail("ticket_invalid", "Ticket signature or payload is not valid");
    if (claims.game !== gameId) return fail("ticket_game", "Ticket is for a different game");
    if (!UUID.test(claims.jti) || !UUID.test(claims.uid) || !UUID.test(claims.sid)) {
      return fail("ticket_invalid", "Ticket ids are not valid");
    }
    var redeemed = queryJson(
      nk,
      "SELECT game.redeem_ticket($1::uuid, $2::text, $3::uuid)::text AS result",
      [claims.jti, gameId, claims.uid],
    );
    if (redeemed.error) return fail(String(redeemed.error), String(redeemed.message || redeemed.error));
    var userId = String(redeemed.userId);
    var sessionId = String(redeemed.sessionId);
    var ranked = redeemed.ranked === true;
    var username = usernameOf(nk, userId);
    var minted = nk.authenticateTokenGenerate(userId, username, null, {
      scope: "game",
      game: gameId,
      sid: sessionId,
      ranked: ranked ? "1" : "0",
    });
    var relics = relicIds(nk, userId);
    var beaten = beatenRows(nk, userId);
    var games: string[] = [];
    for (var i = 0; i < beaten.length; i++) games.push(beaten[i].gameId);
    var effects = redeemed.effects && typeof redeemed.effects === "object" ? redeemed.effects : {};
    logger.info("ticket redeemed " + gameId + " user " + userId);
    return ok({
      token: minted.token,
      playerId: userId,
      ranked: ranked,
      sid: sessionId,
      relics: relics,
      effects: effects,
      ticketsCapLeft: ticketsRoom(nk, userId, gameId),
      gameBeaten: games,
    });
  }

  export function sessionEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var eventId = text(body, "eventId");
    var key = text(body, "key");
    var data = body.data;
    var seq: number | null = null;
    if (!eventId || eventId.length > 80) return fail("bad_event", "Event id is required");
    if (!key || key.length > 80) return fail("bad_key", "Idempotency key is required");
    if (!data || typeof data !== "object" || Object.prototype.toString.call(data) === "[object Array]") {
      return fail("bad_event", "Event data must be an object");
    }
    if (body.seq !== undefined && body.seq !== null) {
      if (typeof body.seq !== "number" || !isFinite(body.seq) || Math.floor(body.seq) !== body.seq) {
        return fail("bad_event", "seq must be an integer");
      }
      seq = body.seq;
    }
    HubFault.apply(ctx, nk, session.userId, "grant.before_rpc");
    var hashed: { [key: string]: unknown } = { eventId: eventId, data: data };
    if (seq !== null) hashed.seq = seq;
    var reqHash = nk.sha256Hash("session.event\n" + stable(hashed));
    var result = queryJson(
      nk,
      "SELECT game.apply_event($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb, $6::text, $7::text, $8::bigint)::text AS result",
      [session.userId, session.sid, session.game, eventId, JSON.stringify(data), key, reqHash, seq],
    );
    if (result.error) return fail(String(result.error), String(result.error));
    HubFault.apply(ctx, nk, session.userId, "grant.after_commit");
    if (typeof result.granted === "string") {
      try {
        syncStorage(nk, session.userId, [{ gameId: session.game, relicId: result.granted }]);
      } catch (e) {
        logger.warn("storage sync failed " + String(e));
      }
      logger.info("relic granted " + result.granted + " user " + session.userId);
    }
    return ok(result);
  }

  export function sessionClose(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    var session = requireGame(ctx);
    nk.sqlExec(
      "UPDATE game.game_session SET state = 'closed' WHERE session_id = $1::uuid AND user_id = $2::uuid AND state = 'open'",
      [session.sid, session.userId],
    );
    return ok({ ok: true });
  }

  var SCORE_MODE: { [id: string]: string } = {
    hpos10i_act_time: "asc",
    nobu_trial_time: "asc",
    pb_total_xp: "desc",
    sproto_wins: "incr",
    meta: "desc",
  };

  export function scoreSubmit(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var boardId = text(body, "boardId");
    if (!BOARDS[boardId]) return fail("bad_board", "Unknown board");
    if (typeof body.value !== "number" || !isFinite(body.value) || body.value < 0) return fail("bad_score", "Score must be a non-negative number");
    var mode = SCORE_MODE[boardId] || "desc";
    var meta = body.meta;
    if (!meta || typeof meta !== "object" || Object.prototype.toString.call(meta) === "[object Array]") meta = {};
    var score = Math.round(body.value);
    var rows = nk.sqlQuery(
      "INSERT INTO game.score_best (user_id, board_id, value, meta) VALUES ($1::uuid, $2, $3::bigint, $4::jsonb) ON CONFLICT (user_id, board_id) DO UPDATE SET value = CASE WHEN $5 = 'asc' THEN LEAST(game.score_best.value, EXCLUDED.value) WHEN $5 = 'incr' THEN game.score_best.value + EXCLUDED.value ELSE GREATEST(game.score_best.value, EXCLUDED.value) END, meta = CASE WHEN $5 = 'asc' AND EXCLUDED.value < game.score_best.value THEN EXCLUDED.meta WHEN $5 = 'desc' AND EXCLUDED.value > game.score_best.value THEN EXCLUDED.meta WHEN $5 = 'incr' AND EXCLUDED.value > 0 THEN EXCLUDED.meta ELSE game.score_best.meta END, updated_at = CASE WHEN $5 = 'asc' AND EXCLUDED.value < game.score_best.value THEN now() WHEN $5 = 'desc' AND EXCLUDED.value > game.score_best.value THEN now() WHEN $5 = 'incr' AND EXCLUDED.value > 0 THEN now() ELSE game.score_best.updated_at END RETURNING value::text AS result, meta::text AS meta",
      [session.userId, boardId, score, JSON.stringify(meta), mode],
    );
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) {
      return fail("bad_score", "Score was not stored");
    }
    return ok({ accepted: true, value: Number(rows[0].result), order: mode === "asc" ? "asc" : "desc" });
  }

  export function ticketsEarn(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var key = text(body, "key");
    var reason = text(body, "reason");
    if (!key || key.length > 80) return fail("bad_key", "Idempotency key is required");
    if (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount <= 0) {
      return fail("bad_amount", "Ticket amount must be positive");
    }
    if (!reason) return fail("bad_reason", "A reason is required");
    var amount = Math.floor(body.amount);
    HubFault.apply(ctx, nk, session.userId, "earn.before_rpc");
    var reqHash = nk.sha256Hash("tickets.earn\n" + stable({ amount: amount, reason: reason }));
    var result = queryJson(
      nk,
      "SELECT game.earn_tickets($1::uuid, $2::uuid, $3::text, $4::numeric::bigint, $5::text, $6::text, $7::text)::text AS result",
      [session.userId, session.sid, session.game, amount, reason, key, reqHash],
    );
    if (result.error) return failBody(result);
    HubFault.apply(ctx, nk, session.userId, "earn.after_commit");
    return ok(result);
  }

  export function ticketsExchange(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var key = text(body, "key");
    var raw = typeof body.tickets === "number" ? body.tickets : body.amount;
    if (!key || key.length > 80) return fail("bad_key", "Idempotency key is required");
    if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return fail("bad_amount", "Exchange amount must be positive");
    var tickets = Math.floor(raw);
    HubFault.apply(ctx, nk, session.userId, "exchange.before_rpc");
    var reqHash = nk.sha256Hash("tickets.exchange\n" + stable({ tickets: tickets }));
    var result = queryJson(
      nk,
      "SELECT game.exchange_tickets($1::uuid, $2::uuid, $3::text, $4::numeric::bigint, $5::text, $6::text)::text AS result",
      [session.userId, session.sid, session.game, tickets, key, reqHash],
    );
    if (result.error) return fail(String(result.error), String(result.error));
    HubFault.apply(ctx, nk, session.userId, "exchange.after_commit");
    return ok(result);
  }

  function shopBody(ctx: nkruntime.Context, payload: string): { session: { userId: string; game: string; sid: string }; shopId: string; itemId: string; packs: number; key: string } | string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var key = text(body, "key");
    var shopId = text(body, "shop_id");
    var itemId = text(body, "item_id");
    var game = text(body, "game");
    var packs = wholeQty(body.packs);
    if (!key || key.length > 80) return fail("bad_key", "Idempotency key is required");
    if (!game || game !== session.game) return fail("bad_game", "Unknown game");
    if (!shopId || shopId.length > 64 || !itemId || itemId.length > 64) return fail("unknown_item", "Unknown item");
    if (!packs) return fail("bad_amount", "Quantity must be a positive integer");
    return { session: session, shopId: shopId, itemId: itemId, packs: packs, key: key };
  }

  export function ticketsSpend(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var shop = shopBody(ctx, payload);
    if (typeof shop === "string") return shop;
    var reqHash = nk.sha256Hash("tickets.spend\n" + stable({ game: shop.session.game, shop_id: shop.shopId, item_id: shop.itemId, packs: shop.packs }));
    var result = queryJson(
      nk,
      "SELECT game.spend_tickets($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text, $8::text)::text AS result",
      [shop.session.userId, shop.session.sid, shop.session.game, shop.shopId, shop.itemId, shop.packs, shop.key, reqHash],
    );
    if (result.error) return failBody(result);
    return ok(result);
  }

  export function ticketsSell(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var shop = shopBody(ctx, payload);
    if (typeof shop === "string") return shop;
    var reqHash = nk.sha256Hash("tickets.sell\n" + stable({ game: shop.session.game, shop_id: shop.shopId, item_id: shop.itemId, packs: shop.packs }));
    var result = queryJson(
      nk,
      "SELECT game.sell_tickets($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text, $8::text)::text AS result",
      [shop.session.userId, shop.session.sid, shop.session.game, shop.shopId, shop.itemId, shop.packs, shop.key, reqHash],
    );
    if (result.error) return failBody(result);
    return ok(result);
  }

  export function ticketsBalance(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var session = requireGame(ctx);
    var body = parse(payload);
    var game = text(body, "game");
    if (!game || game !== session.game) return fail("bad_game", "Unknown game");
    var rows = nk.sqlQuery(
      "SELECT COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = $1::uuid AND game_id = $2), 0)::text AS result",
      [session.userId, session.game],
    );
    var balance = 0;
    if (rows && rows.length && rows[0].result !== undefined && rows[0].result !== null) balance = Number(rows[0].result);
    if (!isFinite(balance)) balance = 0;
    return ok({ balance: balance });
  }

  export function recoveryCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): string {
    var userId = requireUser(ctx);
    var code = makeCode(nk);
    var hash = nk.sha256Hash(pepper(ctx) + ":" + normalizeCode(code));
    var result = queryJson(nk, "SELECT game.recovery_create($1::uuid, $2::text)::text AS result", [userId, hash]);
    if (result.error) return fail(String(result.error), "A recovery code already exists and was shown once");
    logger.info("recovery code created for " + userId);
    return ok({ code: code });
  }

  export function recoveryRedeem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = requireUser(ctx);
    var body = parse(payload);
    var deviceId = text(body, "deviceId");
    var code = text(body, "code");
    if (!deviceId || deviceId.length < 6 || deviceId.length > 128) return fail("device_mismatch", "Device id is not valid");
    if (!deviceOwned(nk, userId, deviceId)) return fail("device_mismatch", "Device is not on this account");
    var hash = nk.sha256Hash(pepper(ctx) + ":" + normalizeCode(code));
    var consumed = queryJson(nk, "SELECT game.recovery_consume($1::text, $2::uuid)::text AS result", [hash, userId]);
    if (consumed.error) return fail(String(consumed.error), String(consumed.error));
    var originalId = String(consumed.userId);
    if (!UUID.test(originalId)) return fail("restore_failed", "Recovery target is not valid");
    try {
      nk.linkCustom(userId, "hold" + nk.uuidv4().replace(/-/g, ""));
      nk.unlinkDevice(userId, deviceId);
      nk.linkDevice(originalId, deviceId);
    } catch (e) {
      try {
        nk.linkDevice(userId, deviceId);
      } catch (again) {
        logger.error("device restore left the device unlinked " + String(again));
      }
      try {
        nk.sqlQuery("SELECT game.recovery_release($1::uuid)::text AS result", [originalId]);
      } catch (releaseError) {
        logger.error("recovery release failed " + String(releaseError));
      }
      logger.error("device restore failed " + String(e));
      return fail("restore_failed", "Could not move this device onto the recovered account");
    }
    var minted = nk.authenticateTokenGenerate(originalId, usernameOf(nk, originalId), null, { scope: "hub" });
    logger.info("recovery restored " + originalId + " from " + userId);
    return ok({ restored: true, userId: originalId, token: minted.token });
  }

  export function forceScope(
    data: { [key: string]: unknown } | null,
    vars: { [key: string]: string },
  ): { [key: string]: unknown } {
    var next = data || {};
    var account = next.account;
    if (!account || typeof account !== "object") {
      next.account = { vars: vars };
    } else {
      (account as { [key: string]: unknown }).vars = vars;
    }
    return next;
  }

  export function beforeAuthenticateDevice(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    data: { [key: string]: unknown },
  ): { [key: string]: unknown } {
    return forceScope(data, { scope: "hub" });
  }

  export function beforeSessionRefresh(
    ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    data: { [key: string]: unknown },
  ): { [key: string]: unknown } {
    var current = ctx.vars || {};
    var vars: { [key: string]: string } = { scope: current.scope === "game" ? "game" : "hub" };
    if (vars.scope === "game") {
      vars.game = current.game || "";
      vars.sid = current.sid || "";
      vars.ranked = current.ranked || "0";
    }
    return forceScope(data, vars);
  }
}
