// In-game feedback (docs/feedback.md). Signed-in players send a note from the hub or a game
// (feedback.submit); the admin panel at /admin/ lists and works them (feedback.admin.*).
//
// A note is stored in game.feedback under a per-game id (SHOOTER-0042). Its screenshot lives in
// game.feedback_image and is deleted when the note is marked resolved; the note, its metadata
// and its history stay. "resolved" needs a resolution summary and a verification note.
namespace HubFeedback {
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var PUBLIC_ID = /^[A-Z0-9]{2,10}-\d{4,9}$/;
  var PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/pull\/\d{1,9}$/;
  var IMAGE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

  export var CATEGORIES = ["broke", "unclear", "too_hard", "too_easy", "controls", "performance", "other"];
  export var STATUSES = ["open", "in_progress", "fixed", "resolved"];
  /** A note's pull request as GitHub last reported it ("" = not checked yet). */
  export var PR_STATES = ["open", "draft", "merged", "closed"];
  export var MAX_PAYLOAD = 240000;
  export var MAX_IMAGE = 200000;
  export var MAX_NOTE = 2000;
  export var MAX_META = 16000;
  export var PER_TEN_MINUTES = 6;
  export var PER_DAY = 40;
  export var LOGIN_PER_TEN_MINUTES = 10;
  export var LOGIN_GLOBAL_PER_TEN_MINUTES = 60;
  export var ADMIN_TOKEN_SECONDS = 12 * 3600;
  var PASS_SALT = "hub-feedback-admin:";

  var PREFIX: { [game: string]: string } = {
    hub: "HUB",
    hpos10i: "HPOS",
    nobu: "NOBU",
    "peoples-bitcoin": "PB",
    sproto: "DUEL",
    "sproto-fighter": "FIGHTER",
    "sproto-arcade": "ARCADE",
    "sproto-shooter": "SHOOTER",
    "sproto-coop-battle": "COOP",
  };

  export function games(): string[] {
    var out: string[] = [];
    for (var k in PREFIX) if (Object.prototype.hasOwnProperty.call(PREFIX, k)) out.push(k);
    return out;
  }

  function fail(code: string, message?: string): string {
    return JSON.stringify({ error: code, message: message || code });
  }

  function isObject(v: unknown): v is { [key: string]: unknown } {
    return !!v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]";
  }

  function parse(payload: string, max: number): { [key: string]: unknown } | null {
    if (!payload) return {};
    if (payload.length > max) return null;
    try {
      var data = JSON.parse(payload) as unknown;
      return isObject(data) ? data : null;
    } catch (_e) {
      return null;
    }
  }

  function text(v: unknown, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
  }

  function num(v: unknown): number | null {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  function sameText(a: string, b: string): boolean {
    var diff = a.length ^ b.length;
    for (var i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** The game a session speaks for: its ticket's game, or "hub" for a hub session. */
  function gameOf(ctx: nkruntime.Context): string | null {
    var vars = ctx.vars || {};
    var scope = vars.scope || "";
    if (scope === "game") return vars.game && PREFIX[vars.game] ? vars.game : null;
    if (scope === "hub" || scope === "") return "hub";
    return null;
  }

  /** Username of a signed-in account. Guests (no email on the account) get null. */
  function signedIn(nk: nkruntime.Nakama, userId: string): string | null {
    var account = nk.accountGetId(userId);
    if (!account || !account.email) return null;
    var name = account.user ? account.user.username : "";
    return name || null;
  }

  /** {} → {ok, game, username}: may this session send feedback? Lets the window say so before the form. */
  export function can(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var game = gameOf(ctx);
    if (!game) return fail("wrong_scope");
    var username = signedIn(nk, ctx.userId);
    if (!username) return fail("sign_in_required", "Sign in to a hub account to send feedback");
    return JSON.stringify({ ok: true, game: game, username: username });
  }

  /**
   * {categories[], note?, meta?, image?, clientTime?, source?} → {id}. Signed-in accounts only,
   * 6 per ten minutes and 40 per day. The game comes from the session, never from the body.
   */
  export function submit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var userId = ctx.userId;
    var game = gameOf(ctx);
    if (!game) return fail("wrong_scope");
    var body = parse(payload, MAX_PAYLOAD);
    if (!body) return fail("bad_json");

    var categories: string[] = [];
    var rawCats = body.categories;
    if (Object.prototype.toString.call(rawCats) === "[object Array]") {
      var list = rawCats as unknown[];
      for (var i = 0; i < list.length && i < 16; i++) {
        var c = list[i];
        if (typeof c === "string" && CATEGORIES.indexOf(c) >= 0 && categories.indexOf(c) < 0) categories.push(c);
      }
    }
    var note = text(body.note, MAX_NOTE).replace(/^\s+|\s+$/g, "");
    if (!categories.length && !note) return fail("empty", "Pick an option or write a note");

    var meta = isObject(body.meta) ? body.meta : {};
    var metaJson = JSON.stringify(meta);
    if (metaJson.length > MAX_META) return fail("meta_too_large");
    var image = typeof body.image === "string" ? body.image : "";
    if (image && (image.length > MAX_IMAGE || !IMAGE.test(image))) return fail("bad_image");

    var username = signedIn(nk, userId);
    if (!username) return fail("sign_in_required", "Sign in to a hub account to send feedback");
    var now = Date.now();
    if (!HubRealtimeRpc.allow(nk, "feedback10:" + userId, PER_TEN_MINUTES, 600000, now)) return fail("rate_limited");
    if (!HubRealtimeRpc.allow(nk, "feedbackday:" + userId, PER_DAY, 86400000, now)) return fail("rate_limited");

    var pos = isObject(meta.position) ? meta.position : {};
    var source = body.source === "crash" ? "crash" : "manual";
    var rows = nk.sqlQuery(
      `WITH s AS (
         INSERT INTO game.feedback_seq (game, next) VALUES ($1, 1)
         ON CONFLICT (game) DO UPDATE SET next = game.feedback_seq.next + 1
         RETURNING next
       ), f AS (
         INSERT INTO game.feedback (public_id, game, seq, user_id, username, source, categories, note, meta,
                                    level, mode, pos_x, pos_y, pos_z, version, client_time, game_time, has_image)
         SELECT $2 || '-' || lpad(s.next::text, 4, '0'), $1, s.next, $3::uuid, $4, $5, $6::jsonb, $7, $8::jsonb,
                $9, $10, $11::double precision, $12::double precision, $13::double precision, $14, $15,
                $16::double precision, $17 <> ''
         FROM s
         RETURNING id, public_id
       ), i AS (
         INSERT INTO game.feedback_image (feedback_id, data) SELECT f.id, $17 FROM f WHERE $17 <> ''
       ), e AS (
         INSERT INTO game.feedback_event (feedback_id, status, by_name, summary) SELECT f.id, 'open', $4, 'submitted' FROM f
       )
       SELECT public_id FROM f`,
      [
        game,
        PREFIX[game],
        userId,
        username,
        source,
        JSON.stringify(categories),
        note,
        metaJson,
        text(meta.level, 96),
        text(meta.mode, 64),
        num(pos.x),
        num(pos.y),
        num(pos.z),
        text(meta.version, 96),
        text(body.clientTime, 40),
        num(meta.gameTime),
        image,
      ],
    );
    var id = rows.length ? String(rows[0].public_id) : "";
    if (!id) throw new Error("feedback_insert_failed");
    logger.info("feedback " + id + " from " + userId);
    return JSON.stringify({ ok: true, id: id });
  }

  // ------------------------------------------------------------------ admin

  function tokenFor(ctx: nkruntime.Context, nk: nkruntime.Nakama, user: string, passHash: string, exp: number): string {
    var key = ctx.env ? ctx.env.TICKET_HMAC_KEY || "" : "";
    if (!key) throw new Error("feedback_admin_unconfigured");
    return String(exp) + "." + nk.sha256Hash(key + "|feedback-admin|" + user + "|" + passHash + "|" + String(exp) + "|" + key);
  }

  function adminRow(nk: nkruntime.Nakama, user: string): string | null {
    var rows = nk.sqlQuery("SELECT pass_sha256 FROM game.feedback_admin WHERE username = $1", [user]);
    return rows.length ? String(rows[0].pass_sha256) : null;
  }

  export function passHash(nk: nkruntime.Nakama, pass: string): string {
    return nk.sha256Hash(PASS_SALT + pass);
  }

  /** {user, pass} → {token, expiresAt}. Any session may try; attempts are rate-limited. */
  export function adminLogin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("unauthorized");
    var body = parse(payload, 1024);
    if (!body) return fail("bad_json");
    var now = Date.now();
    if (!HubRealtimeRpc.allow(nk, "feedbacklogin:" + ctx.userId, LOGIN_PER_TEN_MINUTES, 600000, now)) return fail("rate_limited");
    if (!HubRealtimeRpc.allow(nk, "feedbacklogin:*", LOGIN_GLOBAL_PER_TEN_MINUTES, 600000, now)) return fail("rate_limited");
    var user = text(body.user, 64);
    var pass = text(body.pass, 256);
    var stored = user ? adminRow(nk, user) : null;
    var given = passHash(nk, pass);
    if (!stored || !sameText(stored, given)) {
      logger.warn("feedback admin login refused for " + ctx.userId);
      return fail("bad_login", "Wrong user or password");
    }
    var exp = Math.floor(now / 1000) + ADMIN_TOKEN_SECONDS;
    return JSON.stringify({ ok: true, user: user, token: user + ":" + tokenFor(ctx, nk, user, stored, exp), expiresAt: exp });
  }

  /** Admin user named by a valid token, or null. Changing the password voids old tokens. */
  function admin(ctx: nkruntime.Context, nk: nkruntime.Nakama, body: { [key: string]: unknown }): string | null {
    if (!ctx.userId || !UUID.test(ctx.userId)) return null;
    var token = text(body.token, 256);
    var at = token.lastIndexOf(":");
    if (at <= 0) return null;
    var user = token.slice(0, at);
    var rest = token.slice(at + 1);
    var exp = Number(rest.split(".")[0]);
    if (!isFinite(exp) || exp * 1000 < Date.now()) return null;
    var stored = adminRow(nk, user);
    if (!stored) return null;
    return sameText(rest, tokenFor(ctx, nk, user, stored, exp)) ? user : null;
  }

  // jsonb columns come back as text: Nakama hands raw jsonb to the runtime as a byte array.
  var LIST_COLUMNS =
    "public_id, game, user_id, username, source, status, categories::text AS categories, note, level, mode, pos_x, pos_y, pos_z, version, " +
    "client_time, game_time, has_image, resolution, verification, fixed_commit, pr_url, pr_state, " +
    "to_char(pr_checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS pr_checked_at, " +
    "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, " +
    "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at";

  function jsonField(v: unknown, fallback: unknown): unknown {
    if (typeof v !== "string") return v === null || v === undefined ? fallback : v;
    try {
      return JSON.parse(v);
    } catch (_e) {
      return fallback;
    }
  }

  function shape(row: { [key: string]: unknown }): { [key: string]: unknown } {
    return {
      id: row.public_id,
      game: row.game,
      userId: row.user_id,
      username: row.username,
      source: row.source,
      status: row.status,
      categories: jsonField(row.categories, []),
      note: row.note,
      level: row.level,
      mode: row.mode,
      position: row.pos_x === null || row.pos_x === undefined ? null : { x: Number(row.pos_x), y: Number(row.pos_y), z: row.pos_z === null ? null : Number(row.pos_z) },
      version: row.version,
      clientTime: row.client_time,
      gameTime: row.game_time === null || row.game_time === undefined ? null : Number(row.game_time),
      hasImage: row.has_image === true,
      resolution: row.resolution,
      verification: row.verification,
      fixedCommit: row.fixed_commit,
      prUrl: row.pr_url || "",
      prState: row.pr_state || "",
      prCheckedAt: row.pr_checked_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** {token, game?, status?, category?, q?, limit?, offset?} → {items, total, counts, games}. */
  export function adminList(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 4096);
    if (!body) return fail("bad_json");
    if (!admin(ctx, nk, body)) return fail("unauthorized");
    var where: string[] = [];
    var args: unknown[] = [];
    var game = text(body.game, 64);
    if (game) {
      if (!PREFIX[game]) return fail("bad_game");
      args.push(game);
      where.push("game = $" + args.length);
    }
    var status = text(body.status, 16);
    if (status) {
      if (STATUSES.indexOf(status) < 0) return fail("bad_status");
      args.push(status);
      where.push("status = $" + args.length);
    }
    var category = text(body.category, 32);
    if (category) {
      if (CATEGORIES.indexOf(category) < 0) return fail("bad_category");
      args.push(JSON.stringify([category]));
      where.push("categories @> $" + args.length + "::jsonb");
    }
    var q = text(body.q, 120);
    if (q) {
      args.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
      var p = "$" + args.length;
      where.push("(note ILIKE " + p + " OR username ILIKE " + p + " OR public_id ILIKE " + p + " OR level ILIKE " + p + " OR resolution ILIKE " + p + ")");
    }
    var clause = where.length ? " WHERE " + where.join(" AND ") : "";
    var limit = Math.max(1, Math.min(500, Math.floor(num(body.limit) || 100)));
    var offset = Math.max(0, Math.floor(num(body.offset) || 0));
    var totalRows = nk.sqlQuery("SELECT count(*) AS n FROM game.feedback" + clause, args);
    var rows = nk.sqlQuery(
      "SELECT " + LIST_COLUMNS + " FROM game.feedback" + clause + " ORDER BY created_at DESC, id DESC LIMIT " + String(limit) + " OFFSET " + String(offset),
      args,
    );
    var countRows = nk.sqlQuery("SELECT game, status, count(*) AS n FROM game.feedback GROUP BY game, status", []);
    var counts: { [game: string]: { [status: string]: number } } = {};
    for (var i = 0; i < countRows.length; i++) {
      var g = String(countRows[i].game);
      if (!counts[g]) counts[g] = {};
      counts[g][String(countRows[i].status)] = Number(countRows[i].n);
    }
    var items: unknown[] = [];
    for (var j = 0; j < rows.length; j++) items.push(shape(rows[j]));
    return JSON.stringify({ ok: true, items: items, total: totalRows.length ? Number(totalRows[0].n) : 0, counts: counts, games: games() });
  }

  /** {token, id} → {item (with meta), image, events}. */
  export function adminGet(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 1024);
    if (!body) return fail("bad_json");
    if (!admin(ctx, nk, body)) return fail("unauthorized");
    var id = text(body.id, 32).toUpperCase();
    if (!PUBLIC_ID.test(id)) return fail("bad_id");
    var rows = nk.sqlQuery("SELECT id, meta::text AS meta, " + LIST_COLUMNS + " FROM game.feedback WHERE public_id = $1", [id]);
    if (!rows.length) return fail("not_found");
    var item = shape(rows[0]);
    item.meta = jsonField(rows[0].meta, {});
    var images = nk.sqlQuery("SELECT data FROM game.feedback_image WHERE feedback_id = $1", [rows[0].id]);
    var events = nk.sqlQuery(
      "SELECT status, by_name, summary, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS at FROM game.feedback_event WHERE feedback_id = $1 ORDER BY id",
      [rows[0].id],
    );
    var history: unknown[] = [];
    for (var i = 0; i < events.length; i++) history.push({ status: events[i].status, by: events[i].by_name, summary: events[i].summary, at: events[i].at });
    return JSON.stringify({ ok: true, item: item, image: images.length ? String(images[0].data) : null, events: history });
  }

  /**
   * {token, id, status?, resolution?, verification?, fixedCommit?, prUrl?, comment?, runId?} → {item}.
   * "resolved" needs a resolution summary and a verification note (how the fix was checked),
   * either in this call or already on the note. Resolving deletes the screenshot.
   * runId: the agent of a check run sends its run; the change is refused (run_not_running) once
   * that run is canceled, failed or finished, so an agent that outlived its run changes nothing.
   * prUrl: the GitHub pull request with the fix ("" clears it). A PR link written as the fixing
   * commit becomes the note's PR when it has none. A new PR starts with an unknown state until
   * the worker next asks GitHub (feedback.admin.prstate).
   */
  export function adminUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 8192);
    if (!body) return fail("bad_json");
    var by = admin(ctx, nk, body);
    if (!by) return fail("unauthorized");
    var id = text(body.id, 32).toUpperCase();
    if (!PUBLIC_ID.test(id)) return fail("bad_id");
    if (body.runId !== undefined && body.runId !== null && body.runId !== "") {
      var runId = Math.floor(Number(body.runId));
      if (!(runId > 0)) return fail("bad_run");
      var live = nk.sqlQuery("SELECT 1 AS ok FROM game.feedback_run WHERE id = $1 AND state = 'running'", [runId]);
      if (!live.length) return fail("run_not_running", "Check run " + String(runId) + " is not running; stop working these notes");
    }
    var rows = nk.sqlQuery("SELECT id, status, resolution, verification, fixed_commit, pr_url FROM game.feedback WHERE public_id = $1", [id]);
    if (!rows.length) return fail("not_found");
    var row = rows[0];
    var status = body.status === undefined ? String(row.status) : text(body.status, 16);
    if (STATUSES.indexOf(status) < 0) return fail("bad_status");
    var resolution = body.resolution === undefined ? String(row.resolution || "") : text(body.resolution, 600).replace(/^\s+|\s+$/g, "");
    var verification = body.verification === undefined ? String(row.verification || "") : text(body.verification, 600).replace(/^\s+|\s+$/g, "");
    var fixedCommit = body.fixedCommit === undefined ? String(row.fixed_commit || "") : text(body.fixedCommit, 120).replace(/^\s+|\s+$/g, "");
    var prUrl = String(row.pr_url || "");
    if (body.prUrl !== undefined) {
      prUrl = text(body.prUrl, 300).replace(/^\s+|\s+$/g, "");
      if (prUrl && !PR_URL.test(prUrl)) return fail("bad_pr_url", "A pull request link looks like https://github.com/<owner>/<repo>/pull/<number>");
    } else if (!prUrl && PR_URL.test(fixedCommit)) {
      prUrl = fixedCommit;
    }
    if (status === "resolved") {
      if (!resolution) return fail("resolution_required", "A resolved note needs a short resolution summary");
      if (!verification) return fail("verification_required", "Say how the fix was verified before marking a note resolved");
    }
    var comment = text(body.comment, 600).replace(/^\s+|\s+$/g, "");
    var summary = comment || (status === "resolved" ? resolution : status === String(row.status) ? "updated" : "status → " + status);
    nk.sqlQuery(
      `WITH u AS (
         UPDATE game.feedback
            SET status = $2, resolution = $3, verification = $4, fixed_commit = $5, updated_at = now(),
                pr_state = CASE WHEN pr_url = $8 THEN pr_state ELSE '' END,
                pr_checked_at = CASE WHEN pr_url = $8 THEN pr_checked_at ELSE NULL END,
                pr_url = $8,
                resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
                has_image = CASE WHEN $2 = 'resolved' THEN false ELSE has_image END
          WHERE id = $1
          RETURNING id
       ), d AS (
         DELETE FROM game.feedback_image WHERE $2 = 'resolved' AND feedback_id IN (SELECT id FROM u)
       )
       INSERT INTO game.feedback_event (feedback_id, status, by_name, summary) SELECT id, $2, $6, $7 FROM u RETURNING id`,
      [row.id, status, resolution, verification, fixedCommit, by, summary, prUrl],
    );
    logger.info("feedback " + id + " -> " + status + " by " + by);
    var after = nk.sqlQuery("SELECT " + LIST_COLUMNS + " FROM game.feedback WHERE id = $1", [row.id]);
    return JSON.stringify({ ok: true, item: after.length ? shape(after[0]) : null });
  }

  /**
   * {token, prs: [{url, state}]} → {updated}. The worker reports what GitHub says about each
   * pull request linked from a note; every note with that link takes the state. A change of state
   * goes into the note's history ("PR merged"), so the panel shows when it happened.
   */
  export function adminPrState(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 65536);
    if (!body) return fail("bad_json");
    var by = admin(ctx, nk, body);
    if (!by) return fail("unauthorized");
    if (Object.prototype.toString.call(body.prs) !== "[object Array]") return fail("bad_prs");
    var prs = body.prs as unknown[];
    if (prs.length > 200) return fail("too_many");
    var updated = 0;
    for (var i = 0; i < prs.length; i++) {
      var pr = prs[i];
      if (!isObject(pr)) return fail("bad_prs");
      var url = text(pr.url, 300);
      var state = text(pr.state, 16);
      if (!PR_URL.test(url)) return fail("bad_pr_url");
      if (PR_STATES.indexOf(state) < 0) return fail("bad_pr_state");
      var rows = nk.sqlQuery(
        `WITH old AS (
           SELECT id, status, pr_state FROM game.feedback WHERE pr_url = $1 FOR UPDATE
         ), u AS (
           UPDATE game.feedback f SET pr_state = $2, pr_checked_at = now()
             FROM old WHERE f.id = old.id
             RETURNING f.id, old.status, old.pr_state AS was
         ), e AS (
           INSERT INTO game.feedback_event (feedback_id, status, by_name, summary)
           SELECT id, status, $3, 'PR ' || $2 FROM u WHERE was <> $2
         )
         SELECT count(*) AS n FROM u`,
        [url, state, by],
      );
      updated += rows.length ? Number(rows[0].n) : 0;
    }
    return JSON.stringify({ ok: true, updated: updated });
  }

  // ------------------------------------------------------------------ check runs
  //
  // "Check" in the admin panel queues one run that works through every note not yet resolved.
  // A worker on the owner's machine (scripts/feedback-worker.mjs) claims the queued run, starts
  // the agent, and sends a heartbeat while it works. One run at a time: a unique index allows a
  // single queued-or-running row, so pressing Check twice, or from two tabs, never starts a
  // second run over the same notes. A running run whose heartbeat stops is failed after
  // RUN_STALE_SECONDS, so a crashed worker does not block the next Check.

  export var RUN_STATES = ["queued", "running", "done", "failed", "canceled"];
  export var RUN_STALE_SECONDS = 30 * 60;
  var WORKER = /^[A-Za-z0-9._:@-]{1,64}$/;

  var RUN_COLUMNS =
    "id, state, requested_by, worker, summary, note_count, " +
    "to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS requested_at, " +
    "to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS started_at, " +
    "to_char(heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS heartbeat_at, " +
    "to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS finished_at";

  function runShape(row: { [key: string]: unknown }): { [key: string]: unknown } {
    return {
      id: Number(row.id),
      state: row.state,
      requestedBy: row.requested_by,
      worker: row.worker,
      summary: row.summary,
      noteCount: Number(row.note_count || 0),
      requestedAt: row.requested_at,
      startedAt: row.started_at || null,
      heartbeatAt: row.heartbeat_at || null,
      finishedAt: row.finished_at || null,
    };
  }

  /** Fails a running run whose worker stopped sending heartbeats. */
  function expireStale(nk: nkruntime.Nakama): void {
    nk.sqlExec(
      "UPDATE game.feedback_run SET state = 'failed', finished_at = now(), " +
        "summary = CASE WHEN summary = '' THEN 'The worker stopped answering.' ELSE summary END " +
        "WHERE state = 'running' AND heartbeat_at < now() - make_interval(secs => $1)",
      [RUN_STALE_SECONDS],
    );
  }

  function activeRun(nk: nkruntime.Nakama): { [key: string]: unknown } | null {
    var rows = nk.sqlQuery("SELECT " + RUN_COLUMNS + " FROM game.feedback_run WHERE state IN ('queued', 'running') ORDER BY id DESC LIMIT 1", []);
    return rows.length ? runShape(rows[0]) : null;
  }

  /**
   * {token} → {run, created}. Queues a run over every note that is not resolved, or returns the
   * run already queued or running (created: false). Nothing to do: {run: null, created: false}.
   */
  export function adminCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 1024);
    if (!body) return fail("bad_json");
    var by = admin(ctx, nk, body);
    if (!by) return fail("unauthorized");
    expireStale(nk);
    var active = activeRun(nk);
    if (active) return JSON.stringify({ ok: true, run: active, created: false });
    var open = nk.sqlQuery("SELECT count(*) AS n FROM game.feedback WHERE status <> 'resolved'", []);
    var count = open.length ? Number(open[0].n) : 0;
    if (!count) return JSON.stringify({ ok: true, run: null, created: false, noteCount: 0 });
    // A second Check racing this one hits the unique index and inserts nothing.
    var rows = nk.sqlQuery(
      "INSERT INTO game.feedback_run (state, requested_by, note_count) VALUES ('queued', $1, $2) ON CONFLICT DO NOTHING RETURNING " + RUN_COLUMNS,
      [by, count],
    );
    if (!rows.length) return JSON.stringify({ ok: true, run: activeRun(nk), created: false });
    logger.info("feedback check run " + String(rows[0].id) + " queued by " + by + " over " + String(count) + " notes");
    return JSON.stringify({ ok: true, run: runShape(rows[0]), created: true });
  }

  /** {token, limit?} → {active, runs}: the run in flight, if any, and the latest runs. */
  export function adminRuns(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 1024);
    if (!body) return fail("bad_json");
    if (!admin(ctx, nk, body)) return fail("unauthorized");
    expireStale(nk);
    var limit = Math.max(1, Math.min(20, Math.floor(num(body.limit) || 5)));
    var rows = nk.sqlQuery("SELECT " + RUN_COLUMNS + " FROM game.feedback_run ORDER BY id DESC LIMIT " + String(limit), []);
    var runs: unknown[] = [];
    for (var i = 0; i < rows.length; i++) runs.push(runShape(rows[i]));
    return JSON.stringify({ ok: true, active: activeRun(nk), runs: runs, staleSeconds: RUN_STALE_SECONDS });
  }

  /** {token, worker} → {run}: the worker takes the queued run, or gets run: null. */
  export function adminClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 1024);
    if (!body) return fail("bad_json");
    if (!admin(ctx, nk, body)) return fail("unauthorized");
    var worker = text(body.worker, 64);
    if (!WORKER.test(worker)) return fail("bad_worker");
    expireStale(nk);
    var rows = nk.sqlQuery(
      "UPDATE game.feedback_run SET state = 'running', worker = $1, started_at = now(), heartbeat_at = now() " +
        "WHERE id = (SELECT id FROM game.feedback_run WHERE state = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) " +
        "AND state = 'queued' RETURNING " + RUN_COLUMNS,
      [worker],
    );
    if (!rows.length) return JSON.stringify({ ok: true, run: null });
    logger.info("feedback check run " + String(rows[0].id) + " claimed by " + worker);
    return JSON.stringify({ ok: true, run: runShape(rows[0]) });
  }

  /**
   * {token, id, worker?, state?, summary?} → {run}.
   * The worker that holds a running run sends a heartbeat (no state) and finishes it ("done" or
   * "failed"); any other worker gets not_running and must stop. The panel cancels a queued or
   * running run with state "canceled" and no worker.
   */
  export function adminRun(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var body = parse(payload, 4096);
    if (!body) return fail("bad_json");
    var by = admin(ctx, nk, body);
    if (!by) return fail("unauthorized");
    var id = Math.floor(num(body.id) || 0);
    if (id <= 0) return fail("bad_id");
    var state = body.state === undefined ? "" : text(body.state, 16);
    var summary = text(body.summary, 2000).replace(/^\s+|\s+$/g, "");
    var rows: { [key: string]: unknown }[];
    if (state === "canceled") {
      rows = nk.sqlQuery(
        "UPDATE game.feedback_run SET state = 'canceled', finished_at = now(), summary = $2 WHERE id = $1 AND state IN ('queued', 'running') RETURNING " + RUN_COLUMNS,
        [id, summary || "Canceled by " + by + "."],
      );
    } else {
      if (state && state !== "done" && state !== "failed") return fail("bad_state");
      var worker = text(body.worker, 64);
      if (!WORKER.test(worker)) return fail("bad_worker");
      rows = nk.sqlQuery(
        "UPDATE game.feedback_run SET heartbeat_at = now(), " +
          "state = CASE WHEN $3 = '' THEN state ELSE $3 END, " +
          "finished_at = CASE WHEN $3 = '' THEN finished_at ELSE now() END, " +
          "summary = CASE WHEN $4 = '' THEN summary ELSE $4 END " +
          "WHERE id = $1 AND worker = $2 AND state = 'running' RETURNING " + RUN_COLUMNS,
        [id, worker, state, summary],
      );
    }
    if (!rows.length) return fail("not_running", "This run is not running (finished, canceled, or taken over)");
    if (state) logger.info("feedback check run " + String(id) + " -> " + state + " by " + by);
    return JSON.stringify({ ok: true, run: runShape(rows[0]) });
  }
}

function rpcFeedbackCan(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.can(c, l, n, p); }
function rpcFeedbackSubmit(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.submit(c, l, n, p); }
function rpcFeedbackAdminLogin(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminLogin(c, l, n, p); }
function rpcFeedbackAdminList(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminList(c, l, n, p); }
function rpcFeedbackAdminGet(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminGet(c, l, n, p); }
function rpcFeedbackAdminUpdate(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminUpdate(c, l, n, p); }
function rpcFeedbackAdminPrState(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminPrState(c, l, n, p); }
function rpcFeedbackAdminCheck(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminCheck(c, l, n, p); }
function rpcFeedbackAdminRuns(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminRuns(c, l, n, p); }
function rpcFeedbackAdminClaim(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminClaim(c, l, n, p); }
function rpcFeedbackAdminRun(c: nkruntime.Context, l: nkruntime.Logger, n: nkruntime.Nakama, p: string): string { return HubFeedback.adminRun(c, l, n, p); }

// The admin row is user "333" with password "333", as the owner asked. pass_sha256 is
// sha256("hub-feedback-admin:" || password); change it with one UPDATE on game.feedback_admin.
HubSchema.register({
  id: "0059_feedback",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.feedback_seq (
       game text PRIMARY KEY,
       next integer NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS game.feedback (
       id bigserial PRIMARY KEY,
       public_id text NOT NULL UNIQUE,
       game text NOT NULL,
       seq integer NOT NULL,
       user_id uuid NOT NULL,
       username text NOT NULL,
       source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'crash')),
       status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'fixed', 'resolved')),
       categories jsonb NOT NULL DEFAULT '[]'::jsonb,
       note text NOT NULL DEFAULT '',
       meta jsonb NOT NULL DEFAULT '{}'::jsonb,
       level text NOT NULL DEFAULT '',
       mode text NOT NULL DEFAULT '',
       pos_x double precision,
       pos_y double precision,
       pos_z double precision,
       version text NOT NULL DEFAULT '',
       client_time text NOT NULL DEFAULT '',
       game_time double precision,
       has_image boolean NOT NULL DEFAULT false,
       resolution text NOT NULL DEFAULT '',
       verification text NOT NULL DEFAULT '',
       fixed_commit text NOT NULL DEFAULT '',
       created_at timestamptz NOT NULL DEFAULT now(),
       updated_at timestamptz NOT NULL DEFAULT now(),
       resolved_at timestamptz,
       UNIQUE (game, seq),
       CHECK (status <> 'resolved' OR (resolution <> '' AND verification <> ''))
     )`,
    "CREATE INDEX IF NOT EXISTS feedback_game_status ON game.feedback (game, status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS feedback_user ON game.feedback (user_id, created_at DESC)",
    `CREATE TABLE IF NOT EXISTS game.feedback_image (
       feedback_id bigint PRIMARY KEY REFERENCES game.feedback(id) ON DELETE CASCADE,
       data text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS game.feedback_event (
       id bigserial PRIMARY KEY,
       feedback_id bigint NOT NULL REFERENCES game.feedback(id) ON DELETE CASCADE,
       status text NOT NULL,
       by_name text NOT NULL DEFAULT '',
       summary text NOT NULL DEFAULT '',
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    "CREATE INDEX IF NOT EXISTS feedback_event_feedback ON game.feedback_event (feedback_id, id)",
    `CREATE TABLE IF NOT EXISTS game.feedback_admin (
       username text PRIMARY KEY,
       pass_sha256 text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
    "INSERT INTO game.feedback_admin (username, pass_sha256) VALUES ('333', encode(sha256(convert_to('hub-feedback-admin:333', 'UTF8')), 'hex')) ON CONFLICT (username) DO NOTHING",
  ],
});

// Check runs: the panel's Check button queues one, the worker on the owner's machine claims it.
// The partial unique index allows one queued-or-running run at a time. Each note also keeps the
// pull request with its fix and that PR's state as GitHub last reported it.
HubSchema.register({
  id: "0064_feedback_check",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.feedback_run (
       id bigserial PRIMARY KEY,
       state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'canceled')),
       requested_by text NOT NULL DEFAULT '',
       worker text NOT NULL DEFAULT '',
       summary text NOT NULL DEFAULT '',
       note_count integer NOT NULL DEFAULT 0,
       requested_at timestamptz NOT NULL DEFAULT now(),
       started_at timestamptz,
       heartbeat_at timestamptz,
       finished_at timestamptz
     )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS feedback_run_one_active ON game.feedback_run ((true)) WHERE state IN ('queued', 'running')",
    "ALTER TABLE game.feedback ADD COLUMN IF NOT EXISTS pr_url text NOT NULL DEFAULT ''",
    "ALTER TABLE game.feedback ADD COLUMN IF NOT EXISTS pr_state text NOT NULL DEFAULT '' CHECK (pr_state IN ('', 'open', 'draft', 'merged', 'closed'))",
    "ALTER TABLE game.feedback ADD COLUMN IF NOT EXISTS pr_checked_at timestamptz",
    "CREATE INDEX IF NOT EXISTS feedback_pr_url ON game.feedback (pr_url) WHERE pr_url <> ''",
  ],
});
