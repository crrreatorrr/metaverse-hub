// Server-only Shooter boss settlement. The vendored verifier never mints.
// This file pays 20 Tickets once per account, game, canonical boss, and issuance
// UTC day, under the existing 200-per-session and 1000-per-account-per-game-per-day
// caps. The amount is fixed in SQL. A client cannot name it through tickets.earn,
// session.event, or score.submit. There is no positive event_rule for this game.
//
// Wager escrow is a later phase. That path must not create Tickets. This function
// is the only Shooter mint, and it cannot pay any amount other than 20 or 0.
namespace ShooterRewards {
  export var GAME_ID = "sproto-shooter";
  export var BANKED_REASON = "srv_shooter_boss_clear";
  export var BANKED_EVENT = "shooter.boss_clear";
  export var BOARD_ID = "shooter_story_clear_ms_v1";
  export var PAY = 20;
  export var REPO = "crrreatorrr/sproto-shooter";
  export var COMMIT = "7137f558846da4c552f6c21ef74756eb527c657d";
  export var BUNDLE_SHA256 = "ae9ede47f2bdb4896820810888e62cca9eb3c9f6675052645dae0fb31518145b";
  // 0040 wrote 3c657fb5. 0048 swapped the live function to cea1f88b.
  // 0065_shooter_campaign_fingerprint swaps that for this vendored fingerprint.
  export var FINGERPRINT = "73c6eb0f";
  export var PROTOCOL = 1;
  var BOSSES = ["sahil", "obama", "broccoli", "glowie", "tinubu"];

  export function clientBlocked(name: string): boolean {
    return name === BANKED_REASON || name === BANKED_EVENT || name === BOARD_ID;
  }

  export function allowedBoss(id: string): boolean {
    for (var i = 0; i < BOSSES.length; i++) if (BOSSES[i] === id) return true;
    return false;
  }

  /** The campaign API. Nakama freezes the global, so the loader keeps it in a box. */
  export function api(): ShooterSimApi {
    if (typeof __sprotoShooterSim === "function") {
      var loaded = __sprotoShooterSim();
      if (loaded) return loaded;
    }
    if (typeof SprotoShooterSim !== "undefined" && SprotoShooterSim) return SprotoShooterSim;
    throw new Error("bundle_missing");
  }

  /** Empty string when the loaded bundle matches the pin. */
  export function verifyRuntime(): string {
    var sim: ShooterSimApi;
    try {
      sim = api();
    } catch (err) {
      return err ? "bundle_missing" : "bundle_missing";
    }
    if (sim.PROTOCOL_VERSION !== PROTOCOL) return "protocol";
    if (sim.SOURCE_COMMIT !== COMMIT) return "commit";
    if (sim.contentFingerprintOf() !== FINGERPRINT) return "fingerprint";
    var economy = sim.ECONOMY;
    if (!economy || economy.mintsTickets !== false || economy.ticketsMintedByArtifact !== 0) return "economy";
    if (economy.payoutAuthority !== "server" || economy.wagerMayCreateTickets !== false) return "economy";
    return "";
  }

  export function payable(receipt: { [key: string]: unknown }): boolean {
    return receipt.ok === true
      && receipt.eligible === true
      && receipt.outcome === "clear"
      && receipt.reason === "boss_clear"
      && receipt.ticketsMinted === 0
      && receipt.canonicalCount === 1
      && receipt.protocol === PROTOCOL
      && receipt.contentFingerprint === FINGERPRINT
      && allowedBoss(String(receipt.canonicalBoss || ""));
  }

  export function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return { error: "empty_result" };
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (typeof raw === "object") return raw as { [key: string]: unknown };
    return { error: "bad_json_cell" };
  }

  /** Plain arrays built in this call. Nakama must not be asked to keep a Set or Map. */
  export function column(rows: { [key: string]: unknown }[], field: string): string[] {
    var out: string[] = [];
    if (!rows) return out;
    for (var i = 0; i < rows.length; i++) {
      var value = rows[i][field];
      if (typeof value === "string" && value) out.push(value);
    }
    return out;
  }

  export function issue(nk: nkruntime.Nakama, userId: string, sessionId: string, key: string, runId: string, day: string, boss: string, seed: number, issuanceJson: string): { [key: string]: unknown } {
    return queryJson(
      nk,
      "SELECT game.issue_shooter_run($1::uuid, $2::uuid, $3::text, $4::text, $5::date, $6::text, $7::bigint, $8::text)::text AS result",
      [userId, sessionId, key, runId, day, boss, seed, issuanceJson],
    );
  }

  export function settle(nk: nkruntime.Nakama, userId: string, sessionId: string, runId: string, boss: string, day: string, digest: string, stateHash: string, clearMs: number, reqHash: string): { [key: string]: unknown } {
    return queryJson(
      nk,
      "SELECT game.settle_shooter_clear($1::uuid, $2::uuid, $3::text, $4::text, $5::date, $6::text, $7::text, $8::bigint, $9::int, $10::text, $11::text)::text AS result",
      [userId, sessionId, runId, boss, day, digest, stateHash, clearMs, PROTOCOL, FINGERPRINT, reqHash],
    );
  }

  export function closeRun(nk: nkruntime.Nakama, userId: string, runId: string, digest: string, reason: string): { [key: string]: unknown } {
    return queryJson(
      nk,
      "SELECT game.close_shooter_run($1::uuid, $2::text, $3::text, $4::text)::text AS result",
      [userId, runId, digest, reason],
    );
  }

  export function saveCheckpoint(nk: nkruntime.Nakama, userId: string, runId: string, digest: string, checkpointJson: string, hash: string, tick: number): { [key: string]: unknown } {
    return queryJson(
      nk,
      "SELECT game.save_shooter_checkpoint($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::bigint)::text AS result",
      [userId, runId, digest, checkpointJson, hash, tick],
    );
  }
}

HubSchema.register({
  id: "0040_shooter_boss_receipt",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.shooter_run (
      run_id text PRIMARY KEY,
      user_id uuid NOT NULL,
      session_id uuid NOT NULL,
      idem_key text NOT NULL,
      day date NOT NULL,
      canonical_boss text NOT NULL,
      seed bigint NOT NULL,
      issuance_json text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      checkpoint_json text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shooter_run_boss CHECK (canonical_boss IN ('sahil', 'obama', 'broccoli', 'glowie', 'tinubu')),
      CONSTRAINT shooter_run_status CHECK (status IN ('open', 'settled', 'closed')),
      CONSTRAINT shooter_run_seed CHECK (seed >= 1 AND seed <= 4294967295),
      UNIQUE (user_id, idem_key)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_digest (
      user_id uuid NOT NULL,
      digest text NOT NULL,
      run_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, digest)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_receipt (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      canonical_boss text NOT NULL,
      day date NOT NULL,
      run_id text NOT NULL,
      session_id uuid NOT NULL,
      log_digest text NOT NULL,
      state_hash text NOT NULL,
      clear_ms bigint NOT NULL CHECK (clear_ms >= 0),
      tickets bigint NOT NULL CHECK (tickets = 20),
      protocol integer NOT NULL,
      fingerprint text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id, canonical_boss, day),
      UNIQUE (run_id),
      CONSTRAINT shooter_receipt_game CHECK (game_id = 'sproto-shooter'),
      CONSTRAINT shooter_receipt_boss CHECK (canonical_boss IN ('sahil', 'obama', 'broccoli', 'glowie', 'tinubu'))
    )`,
    "CREATE INDEX IF NOT EXISTS shooter_run_user_status ON game.shooter_run (user_id, status)",
    "ALTER TABLE game.ranked_score DROP CONSTRAINT IF EXISTS ranked_score_board",
    "ALTER TABLE game.ranked_score ADD CONSTRAINT ranked_score_board CHECK (board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta', 'shooter_story_clear_ms_v1'))",
    `CREATE OR REPLACE FUNCTION game.issue_shooter_run(
      p_user_id uuid, p_session_id uuid, p_idem_key text, p_run_id text,
      p_day date, p_boss text, p_seed bigint, p_issuance text
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE
      v_boss text;
      v_session text;
      v_issuance text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('shooter-issue:' || p_user_id::text || ':' || p_idem_key, 0));
      IF p_boss NOT IN ('sahil', 'obama', 'broccoli', 'glowie', 'tinubu') THEN
        RETURN jsonb_build_object('error', 'unknown_boss', 'ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
      END IF;
      SELECT canonical_boss, session_id::text, issuance_json
        INTO v_boss, v_session, v_issuance
      FROM game.shooter_run
      WHERE user_id = p_user_id AND idem_key = p_idem_key;
      IF FOUND THEN
        IF v_boss IS DISTINCT FROM p_boss OR v_session IS DISTINCT FROM p_session_id::text THEN
          RETURN jsonb_build_object('error', 'idempotency_mismatch', 'ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
        END IF;
        RETURN jsonb_build_object('ok', true, 'replay', true, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'issuance', v_issuance::jsonb);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM game.game_session
        WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = 'sproto-shooter'
          AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
      ) THEN
        RETURN jsonb_build_object('error', 'session_closed', 'ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
      END IF;
      INSERT INTO game.shooter_run (run_id, user_id, session_id, idem_key, day, canonical_boss, seed, issuance_json, status)
      VALUES (p_run_id, p_user_id, p_session_id, p_idem_key, p_day, p_boss, p_seed, p_issuance, 'open');
      RETURN jsonb_build_object('ok', true, 'replay', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'issuance', p_issuance::jsonb);
    END;
    $fn$`,
    `CREATE OR REPLACE FUNCTION game.close_shooter_run(
      p_user_id uuid, p_run_id text, p_digest text, p_reason text
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE
      v_status text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
      SELECT status INTO v_status FROM game.shooter_run
      WHERE run_id = p_run_id AND user_id = p_user_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'unknown_run');
      END IF;
      IF v_status = 'settled' THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'reused_run');
      END IF;
      INSERT INTO game.shooter_digest (user_id, digest, run_id)
      VALUES (p_user_id, p_digest, p_run_id)
      ON CONFLICT (user_id, digest) DO NOTHING;
      UPDATE game.shooter_run SET status = 'closed'
      WHERE run_id = p_run_id AND user_id = p_user_id AND status = 'open';
      RETURN jsonb_build_object('ok', true, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', p_reason);
    END;
    $fn$`,
    `CREATE OR REPLACE FUNCTION game.save_shooter_checkpoint(
      p_user_id uuid, p_run_id text, p_digest text, p_checkpoint text, p_hash text, p_tick bigint
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE
      v_status text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
      SELECT status INTO v_status FROM game.shooter_run
      WHERE run_id = p_run_id AND user_id = p_user_id
      FOR UPDATE;
      IF NOT FOUND OR v_status <> 'open' THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'reused_run');
      END IF;
      INSERT INTO game.shooter_digest (user_id, digest, run_id)
      VALUES (p_user_id, p_digest, p_run_id)
      ON CONFLICT (user_id, digest) DO NOTHING;
      UPDATE game.shooter_run SET checkpoint_json = p_checkpoint
      WHERE run_id = p_run_id AND user_id = p_user_id AND status = 'open';
      RETURN jsonb_build_object(
        'ok', true, 'paid', false, 'tickets', 0, 'ticketsMinted', 0,
        'reason', 'boss_alive', 'checkpointHash', p_hash, 'checkpointTick', p_tick
      );
    END;
    $fn$`,
    `CREATE OR REPLACE FUNCTION game.settle_shooter_clear(
      p_user_id uuid, p_session_id uuid, p_run_id text, p_boss text, p_day date,
      p_digest text, p_state_hash text, p_clear_ms bigint, p_protocol integer,
      p_fingerprint text, p_req_hash text
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE
      v_response jsonb;
      v_credit jsonb;
      v_balance bigint;
      v_applied bigint;
      v_status text;
      v_run_session uuid;
      v_run_boss text;
      v_run_day date;
      v_used bigint;
      v_bucket text;
      v_idem_key text;
      v_rows integer;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
      SELECT response INTO v_response FROM game.shooter_receipt WHERE run_id = p_run_id;
      IF FOUND THEN
        RETURN v_response;
      END IF;
      SELECT response INTO v_response FROM game.shooter_receipt
      WHERE user_id = p_user_id AND game_id = 'sproto-shooter' AND canonical_boss = p_boss AND day = p_day;
      IF FOUND THEN
        UPDATE game.shooter_run SET status = 'closed'
        WHERE run_id = p_run_id AND user_id = p_user_id AND status = 'open';
        INSERT INTO game.shooter_digest (user_id, digest, run_id)
        VALUES (p_user_id, p_digest, p_run_id)
        ON CONFLICT (user_id, digest) DO NOTHING;
        RETURN jsonb_build_object(
          'ok', true, 'paid', false, 'tickets', 0, 'ticketsMinted', 0,
          'reason', 'already_paid', 'canonicalBoss', p_boss, 'replay', false
        );
      END IF;
      IF p_protocol IS DISTINCT FROM 1 OR p_fingerprint IS DISTINCT FROM '3c657fb5' THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'unsupported_version');
      END IF;
      IF p_boss NOT IN ('sahil', 'obama', 'broccoli', 'glowie', 'tinubu') THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'unknown_boss');
      END IF;
      IF p_clear_ms IS NULL OR p_clear_ms < 0 THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'malformed');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM game.game_session
        WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = 'sproto-shooter'
          AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
      ) THEN
        RETURN jsonb_build_object('error', 'session_closed', 'ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
      END IF;
      SELECT status, session_id, canonical_boss, day
        INTO v_status, v_run_session, v_run_boss, v_run_day
      FROM game.shooter_run
      WHERE run_id = p_run_id AND user_id = p_user_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'unknown_run');
      END IF;
      IF v_run_session IS DISTINCT FROM p_session_id OR v_run_boss IS DISTINCT FROM p_boss OR v_run_day IS DISTINCT FROM p_day THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'rebind');
      END IF;
      IF v_status <> 'open' THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'reused_run');
      END IF;
      IF EXISTS (SELECT 1 FROM game.shooter_digest WHERE user_id = p_user_id AND digest = p_digest) THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'reused_log');
      END IF;
      v_bucket := 'boss:sproto-shooter:' || p_boss;
      SELECT amount INTO v_used FROM game.earn_window
      WHERE user_id = p_user_id AND bucket = v_bucket AND day = p_day;
      IF COALESCE(v_used, 0) >= 1 THEN
        UPDATE game.shooter_run SET status = 'closed' WHERE run_id = p_run_id AND status = 'open';
        INSERT INTO game.shooter_digest (user_id, digest, run_id)
        VALUES (p_user_id, p_digest, p_run_id)
        ON CONFLICT (user_id, digest) DO NOTHING;
        RETURN jsonb_build_object('ok', true, 'paid', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'already_paid', 'canonicalBoss', p_boss);
      END IF;
      v_credit := game.take_ticket_credit(p_user_id, p_session_id, 'sproto-shooter', 20, 'srv_shooter_boss_clear', 'earn', false);
      IF v_credit ? 'error' THEN
        RETURN v_credit || jsonb_build_object('ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
      END IF;
      v_applied := COALESCE((v_credit->>'applied')::bigint, 0);
      IF v_applied IS DISTINCT FROM 20 THEN
        RAISE EXCEPTION 'shooter_pay_not_20';
      END IF;
      v_balance := (v_credit->>'balance')::bigint;
      INSERT INTO game.earn_window (user_id, bucket, day, amount)
      VALUES (p_user_id, v_bucket, p_day, 1)
      ON CONFLICT (user_id, bucket, day) DO UPDATE
        SET amount = game.earn_window.amount + 1
        WHERE game.earn_window.amount < 1;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'shooter_boss_bucket';
      END IF;
      v_response := jsonb_build_object(
        'ok', true,
        'paid', true,
        'replay', false,
        'tickets', 20,
        'balance', v_balance,
        'canonicalBoss', p_boss,
        'canonicalCount', 1,
        'day', to_char(p_day, 'YYYY-MM-DD'),
        'runId', p_run_id,
        'logDigest', p_digest,
        'stateHash', p_state_hash,
        'clearMs', p_clear_ms,
        'score', p_clear_ms,
        'boardId', 'shooter_story_clear_ms_v1',
        'protocol', 1,
        'fingerprint', '3c657fb5',
        'ticketsMinted', 0
      );
      INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)
      VALUES (
        p_user_id, 'shooter_story_clear_ms_v1', p_boss, p_clear_ms,
        jsonb_build_object('protocol', 1, 'fingerprint', '3c657fb5', 'runId', p_run_id, 'stateHash', p_state_hash, 'version', 1),
        p_session_id, now()
      )
      ON CONFLICT (user_id, board_id, variant) DO UPDATE
        SET value = LEAST(game.ranked_score.value, EXCLUDED.value),
            meta = EXCLUDED.meta,
            session_id = EXCLUDED.session_id,
            updated_at = now()
        WHERE game.ranked_score.value > EXCLUDED.value;
      INSERT INTO game.shooter_receipt (
        user_id, game_id, canonical_boss, day, run_id, session_id, log_digest, state_hash,
        clear_ms, tickets, protocol, fingerprint, response
      ) VALUES (
        p_user_id, 'sproto-shooter', p_boss, p_day, p_run_id, p_session_id, p_digest, p_state_hash,
        p_clear_ms, 20, 1, '3c657fb5', v_response
      );
      INSERT INTO game.shooter_digest (user_id, digest, run_id)
      VALUES (p_user_id, p_digest, p_run_id);
      UPDATE game.shooter_run SET status = 'settled' WHERE run_id = p_run_id AND user_id = p_user_id;
      v_idem_key := 'shclr:' || p_run_id;
      INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
      VALUES (p_user_id, v_idem_key, 'tickets.earn', decode(p_req_hash, 'hex'), v_response);
      RETURN v_response;
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_response FROM game.shooter_receipt WHERE run_id = p_run_id;
      IF FOUND THEN
        RETURN v_response;
      END IF;
      RETURN jsonb_build_object('error', 'idempotency_mismatch', 'ok', false, 'paid', false, 'tickets', 0, 'ticketsMinted', 0);
    END;
    $fn$`,
  ],
});

// 0040 is already applied, so its fingerprint literal stays. This replaces the
// live function with the rebaked campaign fingerprint. A fresh database runs
// 0040 first, then this. 0047 is the duel relic staves migration on main.
HubSchema.register({
  id: "0048_shooter_campaign_fingerprint",
  statements: [
    `DO $fp$
    DECLARE src text;
    BEGIN
      src := pg_get_functiondef('game.settle_shooter_clear(uuid,uuid,text,text,date,text,text,bigint,integer,text,text)'::regprocedure);
      src := replace(src, '3c657fb5', 'cea1f88b');
      EXECUTE src;
    END;
    $fp$`,
  ],
});

// 0040 and 0048 are already applied, so their fingerprint literals stay. This replaces
// the live function with the vendored campaign fingerprint, so new receipts and board
// rows carry the label of the sim that produced them, and the function refuses a caller
// still sending cea1f88b (unsupported_version, nothing paid). A fresh database runs
// 0040, then 0048, then this. Applying it twice changes nothing.
//
// Only the label changes. The amount (20), the once-per-boss-per-UTC-day rule, the
// session and daily caps and the keys are the same statements. No stored row is
// rewritten: a clear settled under the old label keeps its receipt, its Tickets and
// its stored answer. A retry of that settlement still returns the stored answer,
// because the receipt lookup comes before the version check.
HubSchema.register({
  id: "0065_shooter_campaign_fingerprint",
  statements: [
    `DO $fp$
    DECLARE src text;
    BEGIN
      src := pg_get_functiondef('game.settle_shooter_clear(uuid,uuid,text,text,date,text,text,bigint,integer,text,text)'::regprocedure);
      src := replace(src, 'cea1f88b', '73c6eb0f');
      IF position('cea1f88b' in src) > 0 OR position('73c6eb0f' in src) = 0 THEN
        RAISE EXCEPTION 'shooter_campaign_fingerprint_not_replaced';
      END IF;
      EXECUTE src;
    END;
    $fp$`,
  ],
});
