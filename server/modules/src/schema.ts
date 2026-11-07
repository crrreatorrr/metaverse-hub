namespace HubSchema {
  interface SchemaMigration {
    id: string;
    statements: string[];
  }

  // Dev databases have no ledger rows yet. This CREATE is idempotent, so the
  // first boot can create the table, run it once more as 0001, and record it.
  var SCHEMA_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS game.schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

  // Applied migrations are immutable. Any fix goes in a new numbered migration;
  // do not edit one that has already shipped. 0002_baseline is the schema on
  // main when this ledger starts. CREATE IF NOT EXISTS will not add columns on
  // a dev database that already has those tables, so later schema changes are
  // 0004 and up, never edits to 0002. Checksums cover statement text only.
  var MIGRATIONS: SchemaMigration[] = [
    {
      id: "0001_schema_migrations",
      statements: [SCHEMA_MIGRATIONS_TABLE],
    },
    {
      id: "0002_baseline",
      statements: [
    "CREATE SCHEMA IF NOT EXISTS game",

    `CREATE TABLE IF NOT EXISTS game.game_session (
      session_id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      ranked boolean NOT NULL,
      effects jsonb NOT NULL,
      ticket_jti uuid NOT NULL UNIQUE,
      state text NOT NULL DEFAULT 'open',
      opened_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz NOT NULL,
      ticket_exp timestamptz NOT NULL,
      ticket_redeemed_at timestamptz,
      CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto')),
      CONSTRAINT game_session_state CHECK (state IN ('open', 'closed', 'expired'))
    )`,

    `CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON game.game_session (user_id) WHERE state = 'open'`,

    `CREATE TABLE IF NOT EXISTS game.idempotency (
      user_id uuid NOT NULL,
      key text NOT NULL,
      rpc text NOT NULL,
      req_hash bytea NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    )`,

    `CREATE TABLE IF NOT EXISTS game.relic_claim (
      user_id uuid NOT NULL,
      relic_id text NOT NULL,
      session_id uuid NOT NULL,
      event_id uuid NOT NULL UNIQUE,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, relic_id),
      CONSTRAINT relic_claim_known CHECK (relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown'))
    )`,

    `CREATE TABLE IF NOT EXISTS game.game_beaten (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      relic_id text NOT NULL,
      beaten_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id),
      CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))
    )`,

    `CREATE TABLE IF NOT EXISTS game.item_ledger (
      seq bigserial PRIMARY KEY,
      event_id uuid NOT NULL UNIQUE,
      user_id uuid NOT NULL,
      op text NOT NULL,
      item_id text NOT NULL,
      source text NOT NULL,
      ref_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT item_ledger_op CHECK (op IN ('grant_relic', 'admin_revoke'))
    )`,

    `CREATE TABLE IF NOT EXISTS game.tickets_balance (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      balance bigint NOT NULL CHECK (balance >= 0),
      PRIMARY KEY (user_id, game_id)
    )`,

    `CREATE TABLE IF NOT EXISTS game.tickets_ledger (
      seq bigserial PRIMARY KEY,
      event_id uuid NOT NULL,
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      delta bigint NOT NULL,
      balance_after bigint NOT NULL CHECK (balance_after >= 0),
      reason text NOT NULL,
      ref_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS game.verse_wallet (
      user_id uuid PRIMARY KEY,
      balance bigint NOT NULL CHECK (balance >= 0)
    )`,

    `CREATE TABLE IF NOT EXISTS game.verse_ledger (
      seq bigserial PRIMARY KEY,
      event_id uuid NOT NULL,
      user_id uuid NOT NULL,
      delta bigint NOT NULL,
      balance_after bigint NOT NULL,
      source text NOT NULL,
      ref_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS game.exchange_tx (
      receipt_id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      tickets bigint NOT NULL CHECK (tickets > 0),
      verse bigint NOT NULL CHECK (verse > 0),
      rate text NOT NULL,
      idem_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, idem_key)
    )`,

    `CREATE TABLE IF NOT EXISTS game.earn_window (
      user_id uuid NOT NULL,
      bucket text NOT NULL,
      day date NOT NULL,
      amount bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, bucket, day)
    )`,

    `CREATE TABLE IF NOT EXISTS game.verse_earned (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      lifetime bigint NOT NULL CHECK (lifetime >= 0),
      PRIMARY KEY (user_id, game_id)
    )`,

    `CREATE TABLE IF NOT EXISTS game.score_best (
      user_id uuid NOT NULL,
      board_id text NOT NULL,
      value bigint NOT NULL CHECK (value >= 0),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, board_id),
      CONSTRAINT score_best_board CHECK (board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta'))
    )`,
    "ALTER TABLE game.score_best ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE game.score_best DROP CONSTRAINT IF EXISTS score_best_board",
    "ALTER TABLE game.score_best ADD CONSTRAINT score_best_board CHECK (board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta'))",

    `CREATE TABLE IF NOT EXISTS game.fault_arm (
      user_id uuid NOT NULL,
      point text NOT NULL,
      remaining integer NOT NULL CHECK (remaining >= 0),
      mode text NOT NULL CHECK (mode IN ('raise', 'sleep')),
      PRIMARY KEY (user_id, point)
    )`,

    `CREATE TABLE IF NOT EXISTS game.recovery_code (
      user_id uuid PRIMARY KEY,
      code_hash bytea NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      used_at timestamptz
    )`,

    `CREATE OR REPLACE FUNCTION game.reject_mutation() RETURNS trigger
     LANGUAGE plpgsql AS $fn$
     BEGIN
       RAISE EXCEPTION 'append_only';
     END;
     $fn$`,

    "ALTER TABLE game.game_session ADD COLUMN IF NOT EXISTS event_seq bigint NOT NULL DEFAULT 0",

    `CREATE TABLE IF NOT EXISTS game.event_rule (
      game_id text NOT NULL,
      event_type text NOT NULL,
      relic_id text,
      tickets bigint,
      session_limit integer,
      day_limit integer,
      match jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (game_id, event_type)
    )`,

    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match)
     VALUES
       ('hpos10i', 'game_beaten', 'hpos10i_core', NULL, NULL, NULL, '{}'::jsonb),
       ('hpos10i', 'hpos10i.level_complete', 'hpos10i_core', NULL, NULL, NULL, '{"zone":"z1_retro_rush_hills","act":1}'::jsonb),
       ('peoples-bitcoin', 'game_beaten', 'genesis_shard', NULL, NULL, NULL, '{}'::jsonb),
       ('peoples-bitcoin', 'pb.quest_complete', 'genesis_shard', NULL, NULL, NULL, '{"questId":"quest_tutorial"}'::jsonb),
       ('nobu', 'game_beaten', 'cones_tip', NULL, NULL, NULL, '{}'::jsonb),
       ('nobu', 'nobu.boss_defeated', 'cones_tip', NULL, NULL, NULL, '{"boss":"cone"}'::jsonb),
       ('sproto', 'game_beaten', 'tinubu_crown', NULL, NULL, NULL, '{}'::jsonb),
       ('sproto', 'sproto.boss_defeated', 'tinubu_crown', NULL, NULL, NULL, '{"boss":"tinubu"}'::jsonb)
     ON CONFLICT (game_id, event_type) DO NOTHING`,

    // SESSION_TICKET_CAP is 200: ten wins of 20 Tickets, and two sessions stay under the 1000 daily cap.
    `CREATE OR REPLACE FUNCTION game.session_ticket_cap()
     RETURNS bigint LANGUAGE sql IMMUTABLE AS $fn$
       SELECT 200::bigint
     $fn$`,

    "DROP FUNCTION IF EXISTS game.relic_for_event(text, text, jsonb)",

    `CREATE FUNCTION game.relic_for_event(p_game text, p_event text, p_data jsonb)
     RETURNS text LANGUAGE plpgsql STABLE AS $fn$
     DECLARE
       v_relic text;
     BEGIN
       IF p_event = 'ready' THEN
         RETURN NULL;
       END IF;
       SELECT relic_id INTO v_relic
       FROM game.event_rule
       WHERE game_id = p_game
         AND event_type = p_event
         AND relic_id IS NOT NULL
         -- Subset match: extra payload fields, such as time, do not block a grant.
         AND match <@ COALESCE(p_data, '{}'::jsonb)
       LIMIT 1;
       IF v_relic IS NULL THEN
         RETURN NULL;
       END IF;
       IF p_event = 'game_beaten' AND p_data ? 'relicId' AND p_data->>'relicId' <> v_relic THEN
         RETURN NULL;
       END IF;
       RETURN v_relic;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.open_portal(
       p_user_id uuid,
       p_session_id uuid,
       p_game_id text,
       p_ranked boolean,
       p_effects jsonb,
       p_ticket_jti uuid
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_iat timestamptz;
       v_exp timestamptz;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('portal:' || p_user_id::text, 0));
       UPDATE game.game_session SET state = 'closed' WHERE user_id = p_user_id AND state = 'open';
       v_iat := now();
       v_exp := v_iat + interval '60 seconds';
       INSERT INTO game.game_session (
         session_id, user_id, game_id, ranked, effects, ticket_jti, state, opened_at, lease_until, ticket_exp
       ) VALUES (
         p_session_id, p_user_id, p_game_id, p_ranked, p_effects, p_ticket_jti,
         'open', v_iat, v_iat + interval '6 hours', v_exp
       );
       RETURN jsonb_build_object(
         'ok', true,
         'sessionId', p_session_id,
         'ticketJti', p_ticket_jti,
         'iat', floor(extract(epoch FROM v_iat))::bigint,
         'exp', floor(extract(epoch FROM v_exp))::bigint
       );
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.redeem_ticket(p_jti uuid, p_game text, p_user_id uuid)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_user uuid;
       v_session uuid;
       v_game text;
       v_ranked boolean;
       v_effects jsonb;
       v_state text;
       v_exp timestamptz;
       v_redeemed timestamptz;
     BEGIN
       SELECT user_id, session_id, game_id, ranked, effects, state, ticket_exp, ticket_redeemed_at
         INTO v_user, v_session, v_game, v_ranked, v_effects, v_state, v_exp, v_redeemed
       FROM game.game_session
       WHERE ticket_jti = p_jti
       FOR UPDATE;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'ticket_invalid');
       END IF;
       IF v_game <> p_game THEN
         RETURN jsonb_build_object('error', 'ticket_game');
       END IF;
       IF v_user <> p_user_id OR v_state <> 'open' THEN
         RETURN jsonb_build_object('error', 'ticket_invalid');
       END IF;
       IF v_exp <= now() THEN
         RETURN jsonb_build_object('error', 'ticket_expired');
       END IF;
       IF v_redeemed IS NOT NULL THEN
         RETURN jsonb_build_object('error', 'ticket_used');
       END IF;
       UPDATE game.game_session SET ticket_redeemed_at = now() WHERE session_id = v_session;
       RETURN jsonb_build_object(
         'ok', true,
         'userId', v_user,
         'sessionId', v_session,
         'gameId', v_game,
         'ranked', v_ranked,
         'effects', v_effects
       );
     END;
     $fn$`,

    "DROP FUNCTION IF EXISTS game.apply_event(uuid, uuid, text, text, jsonb, text, text)",

    `CREATE OR REPLACE FUNCTION game.apply_event(
       p_user_id uuid,
       p_session_id uuid,
       p_game_id text,
       p_event_id text,
       p_data jsonb,
       p_idem_key text,
       p_req_hash text,
       p_seq bigint DEFAULT NULL
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_relic text;
       v_event uuid;
       v_inserted int;
       v_last bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency
       WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       SELECT event_seq INTO v_last
       FROM game.game_session
       WHERE session_id = p_session_id
         AND user_id = p_user_id
         AND game_id = p_game_id
         AND state = 'open'
         AND lease_until > now()
         AND ticket_redeemed_at IS NOT NULL
       FOR UPDATE;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       IF p_seq IS NOT NULL THEN
         IF v_last > 0 AND p_seq = v_last THEN
           RETURN jsonb_build_object('error', 'seq_duplicate');
         ELSIF p_seq <> v_last + 1 THEN
           RETURN jsonb_build_object('error', 'seq_stale');
         END IF;
         UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
       END IF;
       v_relic := game.relic_for_event(p_game_id, p_event_id, p_data);
       v_response := '{}'::jsonb;
       IF v_relic IS NOT NULL THEN
         v_event := gen_random_uuid();
         INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
         VALUES (p_user_id, v_relic, p_session_id, v_event)
         ON CONFLICT (user_id, relic_id) DO NOTHING;
         GET DIAGNOSTICS v_inserted = ROW_COUNT;
         IF v_inserted = 1 THEN
           INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
           VALUES (v_event, p_user_id, 'grant_relic', v_relic, p_game_id, p_session_id);
           INSERT INTO game.game_beaten (user_id, game_id, relic_id)
           VALUES (p_user_id, p_game_id, v_relic)
           ON CONFLICT (user_id, game_id) DO NOTHING;
           v_response := jsonb_build_object('granted', v_relic);
         END IF;
       END IF;
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency
       WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN
         RAISE;
       END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.recovery_create(p_user_id uuid, p_hash text)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_used timestamptz;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('recovery:' || p_user_id::text, 0));
       SELECT used_at INTO v_used FROM game.recovery_code WHERE user_id = p_user_id FOR UPDATE;
       IF FOUND AND v_used IS NULL THEN
         RETURN jsonb_build_object('error', 'recovery_exists');
       END IF;
       INSERT INTO game.recovery_code (user_id, code_hash)
       VALUES (p_user_id, decode(p_hash, 'hex'))
       ON CONFLICT (user_id) DO UPDATE
         SET code_hash = EXCLUDED.code_hash, created_at = now(), used_at = NULL
         WHERE game.recovery_code.used_at IS NOT NULL;
       RETURN jsonb_build_object('ok', true);
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.recovery_consume(p_hash text, p_current_user uuid)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_user uuid;
       v_used timestamptz;
     BEGIN
       SELECT user_id, used_at INTO v_user, v_used
       FROM game.recovery_code
       WHERE code_hash = decode(p_hash, 'hex')
       FOR UPDATE;
       IF NOT FOUND OR v_used IS NOT NULL THEN
         RETURN jsonb_build_object('error', 'recovery_invalid');
       END IF;
       IF v_user = p_current_user THEN
         RETURN jsonb_build_object('error', 'recovery_same_account');
       END IF;
       UPDATE game.recovery_code SET used_at = now() WHERE user_id = v_user;
       RETURN jsonb_build_object('ok', true, 'userId', v_user);
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.recovery_release(p_user_id uuid)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     BEGIN
       UPDATE game.recovery_code SET used_at = NULL WHERE user_id = p_user_id;
       RETURN jsonb_build_object('ok', true);
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.earn_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_amount bigint, p_reason text, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_day date;
       v_used bigint;
       v_room bigint;
       v_applied bigint;
       v_balance bigint;
       v_event uuid;
       v_cap bigint;
       v_session_earned bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       v_cap := game.session_ticket_cap();
       SELECT COALESCE(SUM(delta), 0) INTO v_session_earned
       FROM game.tickets_ledger
       WHERE user_id = p_user_id AND game_id = p_game_id AND ref_id = p_session_id AND delta > 0;
       -- A request for the whole daily cap (1000) still uses the daily partial rules.
       -- Any smaller earn that would pass the session cap is rejected with no ledger row.
       IF p_amount < 1000 AND v_session_earned + p_amount > v_cap THEN
         RETURN jsonb_build_object('error', 'session_ticket_cap');
       END IF;
       v_day := (now() AT TIME ZONE 'utc')::date;
       SELECT amount INTO v_used FROM game.earn_window
       WHERE user_id = p_user_id AND bucket = 'tickets:' || p_game_id AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       v_room := 1000 - v_used;
       IF v_room < 0 THEN v_room := 0; END IF;
       v_applied := LEAST(p_amount, v_room);
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id;
       IF NOT FOUND THEN v_balance := 0; END IF;
       IF v_applied > 0 THEN
         v_event := gen_random_uuid();
         INSERT INTO game.tickets_balance (user_id, game_id, balance)
         VALUES (p_user_id, p_game_id, v_applied)
         ON CONFLICT (user_id, game_id) DO UPDATE
           SET balance = game.tickets_balance.balance + EXCLUDED.balance
         RETURNING balance INTO v_balance;
         INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id)
         VALUES (v_event, p_user_id, p_game_id, v_applied, v_balance, p_reason, p_session_id);
         INSERT INTO game.earn_window (user_id, bucket, day, amount)
         VALUES (p_user_id, 'tickets:' || p_game_id, v_day, v_applied)
         ON CONFLICT (user_id, bucket, day) DO UPDATE
           SET amount = game.earn_window.amount + EXCLUDED.amount;
       END IF;
       v_response := jsonb_build_object('balance', v_balance, 'capped', v_applied < p_amount);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.earn', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.exchange_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_tickets bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_day date;
       v_used bigint;
       v_room bigint;
       v_verse bigint;
       v_debit bigint;
       v_tickets bigint;
       v_wallet bigint;
       v_event uuid;
       v_receipt uuid;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       v_verse := p_tickets / 10;
       IF v_verse <= 0 THEN
         RETURN jsonb_build_object('error', 'below_rate');
       END IF;
       v_day := (now() AT TIME ZONE 'utc')::date;
       SELECT amount INTO v_used FROM game.earn_window
       WHERE user_id = p_user_id AND bucket = 'verse:' || p_game_id AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       v_room := 50 - v_used;
       IF v_room <= 0 THEN
         RETURN jsonb_build_object('error', 'verse_cap');
       END IF;
       IF v_verse > v_room THEN v_verse := v_room; END IF;
       v_debit := v_verse * 10;
       SELECT balance INTO v_tickets FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id FOR UPDATE;
       IF NOT FOUND OR v_tickets < v_debit THEN
         RETURN jsonb_build_object('error', 'insufficient_tickets');
       END IF;
       UPDATE game.tickets_balance SET balance = balance - v_debit
       WHERE user_id = p_user_id AND game_id = p_game_id
       RETURNING balance INTO v_tickets;
       INSERT INTO game.verse_wallet (user_id, balance) VALUES (p_user_id, v_verse)
       ON CONFLICT (user_id) DO UPDATE
         SET balance = game.verse_wallet.balance + EXCLUDED.balance
       RETURNING balance INTO v_wallet;
       v_event := gen_random_uuid();
       v_receipt := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id)
       VALUES (v_event, p_user_id, p_game_id, -v_debit, v_tickets, 'exchange', v_receipt);
       INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
       VALUES (gen_random_uuid(), p_user_id, v_verse, v_wallet, p_game_id, v_receipt);
       INSERT INTO game.exchange_tx (receipt_id, user_id, game_id, tickets, verse, rate, idem_key)
       VALUES (v_receipt, p_user_id, p_game_id, v_debit, v_verse, '10:1', p_idem_key);
       INSERT INTO game.verse_earned (user_id, game_id, lifetime)
       VALUES (p_user_id, p_game_id, v_verse)
       ON CONFLICT (user_id, game_id) DO UPDATE
         SET lifetime = game.verse_earned.lifetime + EXCLUDED.lifetime;
       INSERT INTO game.earn_window (user_id, bucket, day, amount)
       VALUES (p_user_id, 'verse:' || p_game_id, v_day, v_verse)
       ON CONFLICT (user_id, bucket, day) DO UPDATE
         SET amount = game.earn_window.amount + EXCLUDED.amount;
       v_response := jsonb_build_object('verse', v_wallet, 'ticketsLeft', v_tickets, 'receiptId', v_receipt, 'verseCapLeft', v_room - v_verse);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.exchange', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.fault_at(p_user uuid, p_point text)
     RETURNS void LANGUAGE plpgsql AS $fn$
     DECLARE
       v_mode text;
     BEGIN
       SELECT mode INTO v_mode
       FROM game.fault_arm
       WHERE user_id = p_user AND point = p_point AND remaining > 0
       FOR UPDATE;
       IF NOT FOUND THEN
         RETURN;
       END IF;
       UPDATE game.fault_arm
          SET remaining = remaining - 1
        WHERE user_id = p_user AND point = p_point;
       IF v_mode = 'sleep' THEN
         PERFORM set_config('application_name', 'hf:' || p_user::text || ':' || p_point, true);
         PERFORM pg_sleep(45);
         RETURN;
       END IF;
       RAISE EXCEPTION 'fault_injected:%', p_point;
     END;
     $fn$`,

    "DROP TRIGGER IF EXISTS item_ledger_append_only ON game.item_ledger",
    "CREATE TRIGGER item_ledger_append_only BEFORE UPDATE OR DELETE ON game.item_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "DROP TRIGGER IF EXISTS tickets_ledger_append_only ON game.tickets_ledger",
    "CREATE TRIGGER tickets_ledger_append_only BEFORE UPDATE OR DELETE ON game.tickets_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "DROP TRIGGER IF EXISTS verse_ledger_append_only ON game.verse_ledger",
    "CREATE TRIGGER verse_ledger_append_only BEFORE UPDATE OR DELETE ON game.verse_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
      ],
    },
    {
      id: "0003_merge_pb_into_peoples_bitcoin",
      statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    // Before renaming, drop pb rows that would collide with a peoples-bitcoin
    // row on a unique index or constraint that includes game_id. Keep the
    // peoples-bitcoin row. Log the count. Do not fail the boot.
    `DO $rename$
     DECLARE
       tbl text;
       idx record;
       colname text;
       key_cols text[];
       others text;
       pb_pred text;
       canon_pred text;
       dropped bigint;
       total bigint;
       has_game_id boolean;
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tickets_ledger_append_only') THEN
         ALTER TABLE game.tickets_ledger DISABLE TRIGGER tickets_ledger_append_only;
       END IF;
       FOREACH tbl IN ARRAY ARRAY['game_session', 'tickets_ledger', 'exchange_tx']
       LOOP
         total := 0;
         FOR idx IN
           SELECT i.indrelid, i.indkey, ic.relname AS index_name,
                  pg_get_expr(i.indpred, i.indrelid) AS pred
           FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace nsp ON nsp.oid = t.relnamespace
           JOIN pg_class ic ON ic.oid = i.indexrelid
           WHERE nsp.nspname = 'game' AND t.relname = tbl AND i.indisunique
         LOOP
           has_game_id := false;
           key_cols := ARRAY[]::text[];
           IF EXISTS (SELECT 1 FROM unnest(idx.indkey) AS attnum WHERE attnum = 0) THEN
             CONTINUE;
           END IF;
           FOR colname IN
             SELECT a.attname
             FROM unnest(idx.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = k.attnum
             WHERE k.attnum > 0
             ORDER BY k.ord
           LOOP
             key_cols := array_append(key_cols, colname);
             IF colname = 'game_id' THEN has_game_id := true; END IF;
           END LOOP;
           IF NOT has_game_id THEN CONTINUE; END IF;
           SELECT string_agg(format('pb.%I IS NOT DISTINCT FROM canon.%I', c, c), ' AND ')
             INTO others
           FROM unnest(key_cols) AS c
           WHERE c <> 'game_id';
           IF others IS NULL THEN others := 'TRUE'; END IF;
           pb_pred := 'TRUE';
           canon_pred := 'TRUE';
           IF idx.pred IS NOT NULL THEN
             pb_pred := idx.pred;
             canon_pred := idx.pred;
             FOR colname IN
               SELECT a.attname
               FROM pg_attribute a
               WHERE a.attrelid = idx.indrelid AND a.attnum > 0 AND NOT a.attisdropped
               ORDER BY length(a.attname) DESC
             LOOP
               pb_pred := regexp_replace(pb_pred, '\\m' || colname || '\\M', 'pb.' || quote_ident(colname), 'g');
               canon_pred := regexp_replace(canon_pred, '\\m' || colname || '\\M', 'canon.' || quote_ident(colname), 'g');
             END LOOP;
             pb_pred := replace(pb_pred, 'pb.' || quote_ident('game_id'), '''peoples-bitcoin''');
           END IF;
           others := replace(others, '%', '%%');
           pb_pred := replace(pb_pred, '%', '%%');
           canon_pred := replace(canon_pred, '%', '%%');
           EXECUTE format(
             'WITH del AS (
                DELETE FROM game.%I pb
                USING game.%I canon
                WHERE pb.game_id = ''pb''
                  AND canon.game_id = ''peoples-bitcoin''
                  AND %s
                  AND (%s)
                  AND (%s)
                RETURNING 1
              ) SELECT count(*) FROM del',
             tbl, tbl, others, pb_pred, canon_pred
           ) INTO dropped;
           total := total + COALESCE(dropped, 0);
         END LOOP;
         EXECUTE format(
           'UPDATE game.%I SET game_id = %L WHERE game_id = %L',
           tbl, 'peoples-bitcoin', 'pb'
         );
         RAISE NOTICE 'game.% pb rows dropped for unique game_id collision: %', tbl, total;
       END LOOP;
       IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tickets_ledger_append_only') THEN
         ALTER TABLE game.tickets_ledger ENABLE TRIGGER tickets_ledger_append_only;
       END IF;
     END
     $rename$`,
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))",
    "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
    // Sum, rename pb-only rows, then delete pb leftovers. #16's overlap deletes
    // are not run again after this block.
    `DO $$ DECLARE
       n bigint;
     BEGIN
       UPDATE game.tickets_balance AS neu
          SET balance = neu.balance + old.balance
         FROM game.tickets_balance AS old
        WHERE neu.user_id = old.user_id
          AND neu.game_id = 'peoples-bitcoin'
          AND old.game_id = 'pb';
       UPDATE game.tickets_balance AS pb_row
          SET game_id = 'peoples-bitcoin'
        WHERE pb_row.game_id = 'pb'
          AND NOT EXISTS (
            SELECT 1 FROM game.tickets_balance AS canon
             WHERE canon.user_id = pb_row.user_id
               AND canon.game_id = 'peoples-bitcoin'
          );
       DELETE FROM game.tickets_balance WHERE game_id = 'pb';
       GET DIAGNOSTICS n = ROW_COUNT;
       RAISE NOTICE 'game.tickets_balance pb rows dropped for unique game_id collision: %', n;

       UPDATE game.verse_earned AS neu
          SET lifetime = neu.lifetime + old.lifetime
         FROM game.verse_earned AS old
        WHERE neu.user_id = old.user_id
          AND neu.game_id = 'peoples-bitcoin'
          AND old.game_id = 'pb';
       UPDATE game.verse_earned AS pb_row
          SET game_id = 'peoples-bitcoin'
        WHERE pb_row.game_id = 'pb'
          AND NOT EXISTS (
            SELECT 1 FROM game.verse_earned AS canon
             WHERE canon.user_id = pb_row.user_id
               AND canon.game_id = 'peoples-bitcoin'
          );
       DELETE FROM game.verse_earned WHERE game_id = 'pb';
       GET DIAGNOSTICS n = ROW_COUNT;
       RAISE NOTICE 'game.verse_earned pb rows dropped for unique game_id collision: %', n;

       -- Row presence is the beaten flag (OR). Keep the earliest timestamp.
       UPDATE game.game_beaten AS neu
          SET beaten_at = LEAST(neu.beaten_at, old.beaten_at)
         FROM game.game_beaten AS old
        WHERE neu.user_id = old.user_id
          AND neu.game_id = 'peoples-bitcoin'
          AND old.game_id = 'pb'
          AND old.beaten_at < neu.beaten_at;
       UPDATE game.game_beaten AS pb_row
          SET game_id = 'peoples-bitcoin'
        WHERE pb_row.game_id = 'pb'
          AND NOT EXISTS (
            SELECT 1 FROM game.game_beaten AS canon
             WHERE canon.user_id = pb_row.user_id
               AND canon.game_id = 'peoples-bitcoin'
          );
       DELETE FROM game.game_beaten WHERE game_id = 'pb';
       GET DIAGNOSTICS n = ROW_COUNT;
       RAISE NOTICE 'game.game_beaten pb rows dropped for unique game_id collision: %', n;

       UPDATE game.earn_window AS neu
          SET amount = neu.amount + old.amount
         FROM game.earn_window AS old
        WHERE neu.user_id = old.user_id
          AND neu.day = old.day
          AND old.bucket IN ('tickets:pb', 'verse:pb')
          AND neu.bucket = replace(old.bucket, ':pb', ':peoples-bitcoin');
       UPDATE game.earn_window AS pb_row
          SET bucket = replace(pb_row.bucket, ':pb', ':peoples-bitcoin')
        WHERE pb_row.bucket IN ('tickets:pb', 'verse:pb')
          AND NOT EXISTS (
            SELECT 1 FROM game.earn_window AS canon
             WHERE canon.user_id = pb_row.user_id
               AND canon.day = pb_row.day
               AND canon.bucket = replace(pb_row.bucket, ':pb', ':peoples-bitcoin')
          );
       DELETE FROM game.earn_window WHERE bucket IN ('tickets:pb', 'verse:pb');
       GET DIAGNOSTICS n = ROW_COUNT;
       RAISE NOTICE 'game.earn_window pb rows dropped for unique game_id collision: %', n;

       SELECT count(*) INTO n
         FROM game.event_rule pb
        WHERE pb.game_id = 'pb'
          AND EXISTS (
            SELECT 1 FROM game.event_rule canon
             WHERE canon.game_id = 'peoples-bitcoin'
               AND canon.event_type = pb.event_type
          );
       INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match)
       SELECT 'peoples-bitcoin', event_type, relic_id, tickets, session_limit, day_limit, match
         FROM game.event_rule
        WHERE game_id = 'pb'
       ON CONFLICT DO NOTHING;
       DELETE FROM game.event_rule WHERE game_id = 'pb';
       RAISE NOTICE 'game.event_rule pb rows dropped for unique game_id collision: %', n;
     END $$`,
    "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))",
      ],
    },
    // 0004 is reserved. Shop catalog, ledger kind, nobu level_end cap, and the
    // stricter whole-credit session path. No pb game_id row rewrite.,
    {
      id: "0005_pb_shop_tickets",
      statements: [
    "ALTER TABLE game.tickets_ledger ADD COLUMN IF NOT EXISTS kind text",
    "ALTER TABLE game.tickets_ledger DROP CONSTRAINT IF EXISTS tickets_ledger_kind",
    "ALTER TABLE game.tickets_ledger ADD CONSTRAINT tickets_ledger_kind CHECK (kind IS NULL OR kind IN ('earn', 'exchange', 'spend', 'shop_sell'))",

    `DO $$ BEGIN
       IF to_regclass('game.shop_price') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'game' AND table_name = 'shop_price' AND column_name = 'shop_id'
       ) THEN
         DROP TABLE game.shop_price;
       END IF;
     END $$`,

    `CREATE TABLE IF NOT EXISTS game.shop_price (
      game text NOT NULL,
      shop_id text NOT NULL,
      item_id text NOT NULL,
      pack_size integer NOT NULL DEFAULT 1,
      price integer NOT NULL,
      sell_price integer NOT NULL,
      PRIMARY KEY (game, shop_id, item_id),
      CONSTRAINT shop_price_pack CHECK (pack_size >= 1),
      CONSTRAINT shop_price_positive CHECK (price >= 1),
      CONSTRAINT shop_price_sell CHECK (sell_price >= 0 AND sell_price < price)
    )`,

    // Prices come from the CSVs. Prune then upsert. A later rebalance is a new migration.
    HubShop.pruneSql(),
    HubShop.seedSql(),

    "ALTER TABLE game.shop_price DROP CONSTRAINT IF EXISTS shop_price_sell",
    "ALTER TABLE game.shop_price ADD CONSTRAINT shop_price_sell CHECK (sell_price >= 0 AND sell_price < price)",

    "ALTER TABLE game.event_rule ADD COLUMN IF NOT EXISTS max_amount bigint",
    "ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_max_amount",
    "ALTER TABLE game.event_rule ADD CONSTRAINT event_rule_max_amount CHECK (max_amount IS NULL OR max_amount > 0)",
    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
     VALUES ('nobu', 'level_end', NULL, NULL, NULL, NULL, '{}'::jsonb, 110)
     ON CONFLICT (game_id, event_type) DO UPDATE SET max_amount = EXCLUDED.max_amount`,

    `CREATE OR REPLACE FUNCTION game.take_ticket_credit(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_amount bigint, p_reason text, p_kind text, p_whole boolean
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_cap bigint;
       v_session_earned bigint;
       v_session_room bigint;
       v_day date;
       v_used bigint;
       v_room bigint;
       v_applied bigint;
       v_balance bigint;
       v_event uuid;
     BEGIN
       v_cap := game.session_ticket_cap();
       -- Credits that are not refunds. Earns and shop sales both count. One path for every game.
       SELECT COALESCE(SUM(delta), 0) INTO v_session_earned
       FROM game.tickets_ledger
       WHERE user_id = p_user_id AND game_id = p_game_id AND ref_id = p_session_id AND delta > 0
         AND COALESCE(kind, '') <> 'refund'
         AND reason <> 'refund';
       v_session_room := v_cap - v_session_earned;
       IF v_session_room < 0 THEN v_session_room := 0; END IF;
       IF v_session_earned + p_amount > v_cap THEN
         RETURN jsonb_build_object('error', 'session_ticket_cap', 'sessionCapLeft', v_session_room, 'capLeft', v_session_room);
       END IF;
       v_day := (now() AT TIME ZONE 'utc')::date;
       SELECT amount INTO v_used FROM game.earn_window
       WHERE user_id = p_user_id AND bucket = 'tickets:' || p_game_id AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       v_room := 1000 - v_used;
       IF v_room < 0 THEN v_room := 0; END IF;
       IF p_amount > v_room THEN
         RETURN jsonb_build_object('error', 'daily_ticket_cap', 'dailyCapLeft', v_room, 'capLeft', v_room);
       END IF;
       v_applied := p_amount;
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id
       FOR UPDATE;
       IF NOT FOUND THEN v_balance := 0; END IF;
       IF v_applied > 0 THEN
         v_event := gen_random_uuid();
         INSERT INTO game.tickets_balance (user_id, game_id, balance)
         VALUES (p_user_id, p_game_id, v_applied)
         ON CONFLICT (user_id, game_id) DO UPDATE
           SET balance = game.tickets_balance.balance + EXCLUDED.balance
         RETURNING balance INTO v_balance;
         INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
         VALUES (v_event, p_user_id, p_game_id, v_applied, v_balance, p_reason, p_session_id, p_kind);
         INSERT INTO game.earn_window (user_id, bucket, day, amount)
         VALUES (p_user_id, 'tickets:' || p_game_id, v_day, v_applied)
         ON CONFLICT (user_id, bucket, day) DO UPDATE
           SET amount = game.earn_window.amount + EXCLUDED.amount;
       END IF;
       RETURN jsonb_build_object('balance', v_balance, 'applied', v_applied);
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.earn_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_amount bigint, p_reason text, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_credit jsonb;
       v_applied bigint;
       v_balance bigint;
       v_max bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       SELECT max_amount INTO v_max FROM game.event_rule
       WHERE game_id = p_game_id AND event_type = p_reason AND max_amount IS NOT NULL
       LIMIT 1;
       IF FOUND AND p_amount > v_max THEN
         RETURN jsonb_build_object('error', 'amount_over_rule');
       END IF;
       v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, p_amount, p_reason, 'earn', false);
       IF v_credit ? 'error' THEN
         RETURN v_credit;
       END IF;
       v_balance := (v_credit->>'balance')::bigint;
       v_applied := (v_credit->>'applied')::bigint;
       v_response := jsonb_build_object('balance', v_balance, 'capped', v_applied < p_amount);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.earn', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.exchange_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_tickets bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_day date;
       v_used bigint;
       v_room bigint;
       v_verse bigint;
       v_debit bigint;
       v_tickets bigint;
       v_wallet bigint;
       v_event uuid;
       v_receipt uuid;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       v_verse := p_tickets / 10;
       IF v_verse <= 0 THEN
         RETURN jsonb_build_object('error', 'below_rate');
       END IF;
       v_day := (now() AT TIME ZONE 'utc')::date;
       SELECT amount INTO v_used FROM game.earn_window
       WHERE user_id = p_user_id AND bucket = 'verse:' || p_game_id AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       v_room := 50 - v_used;
       IF v_room <= 0 THEN
         RETURN jsonb_build_object('error', 'verse_cap');
       END IF;
       IF v_verse > v_room THEN v_verse := v_room; END IF;
       v_debit := v_verse * 10;
       -- Same wallet row lock as earn, spend, and sell. The economy advisory lock is taken above.
       SELECT balance INTO v_tickets FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id FOR UPDATE;
       IF NOT FOUND OR v_tickets < v_debit THEN
         RETURN jsonb_build_object('error', 'insufficient_tickets');
       END IF;
       UPDATE game.tickets_balance SET balance = balance - v_debit
       WHERE user_id = p_user_id AND game_id = p_game_id
       RETURNING balance INTO v_tickets;
       INSERT INTO game.verse_wallet (user_id, balance) VALUES (p_user_id, v_verse)
       ON CONFLICT (user_id) DO UPDATE
         SET balance = game.verse_wallet.balance + EXCLUDED.balance
       RETURNING balance INTO v_wallet;
       v_event := gen_random_uuid();
       v_receipt := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (v_event, p_user_id, p_game_id, -v_debit, v_tickets, 'exchange', v_receipt, 'exchange');
       INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
       VALUES (gen_random_uuid(), p_user_id, v_verse, v_wallet, p_game_id, v_receipt);
       INSERT INTO game.exchange_tx (receipt_id, user_id, game_id, tickets, verse, rate, idem_key)
       VALUES (v_receipt, p_user_id, p_game_id, v_debit, v_verse, '10:1', p_idem_key);
       INSERT INTO game.verse_earned (user_id, game_id, lifetime)
       VALUES (p_user_id, p_game_id, v_verse)
       ON CONFLICT (user_id, game_id) DO UPDATE
         SET lifetime = game.verse_earned.lifetime + EXCLUDED.lifetime;
       INSERT INTO game.earn_window (user_id, bucket, day, amount)
       VALUES (p_user_id, 'verse:' || p_game_id, v_day, v_verse)
       ON CONFLICT (user_id, bucket, day) DO UPDATE
         SET amount = game.earn_window.amount + EXCLUDED.amount;
       v_response := jsonb_build_object('verse', v_wallet, 'ticketsLeft', v_tickets, 'balance', v_tickets, 'receiptId', v_receipt, 'verseCapLeft', v_room - v_verse);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.exchange', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    "DROP FUNCTION IF EXISTS game.spend_tickets(uuid, uuid, text, text, bigint, text, text)",
    "DROP FUNCTION IF EXISTS game.sell_tickets(uuid, uuid, text, text, bigint, text, text)",

    `CREATE OR REPLACE FUNCTION game.spend_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text, p_shop_id text,
       p_item_id text, p_packs bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_price integer;
       v_sell integer;
       v_pack integer;
       v_cost bigint;
       v_balance bigint;
       v_units bigint;
       v_event uuid;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       SELECT price, sell_price, pack_size INTO v_price, v_sell, v_pack
       FROM game.shop_price
       WHERE game = p_game_id AND shop_id = p_shop_id AND item_id = p_item_id;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'unknown_item');
       END IF;
       IF p_packs > (9223372036854775807::bigint / v_price::bigint) THEN
         RETURN jsonb_build_object('error', 'bad_amount');
       END IF;
       v_cost := v_price::bigint * p_packs;
       v_units := v_pack::bigint * p_packs;
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id
       FOR UPDATE;
       IF NOT FOUND THEN v_balance := 0; END IF;
       IF v_balance < v_cost THEN
         RETURN jsonb_build_object('error', 'insufficient_tickets');
       END IF;
       UPDATE game.tickets_balance SET balance = balance - v_cost
       WHERE user_id = p_user_id AND game_id = p_game_id
       RETURNING balance INTO v_balance;
       IF NOT FOUND THEN
         INSERT INTO game.tickets_balance (user_id, game_id, balance)
         VALUES (p_user_id, p_game_id, 0)
         RETURNING balance INTO v_balance;
       END IF;
       v_event := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (v_event, p_user_id, p_game_id, -v_cost, v_balance, 'spend', p_session_id, 'spend');
       v_response := jsonb_build_object('shop_id', p_shop_id, 'item_id', p_item_id, 'packs', p_packs, 'units', v_units, 'spent', v_cost, 'balance', v_balance);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.spend', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.sell_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text, p_shop_id text,
       p_item_id text, p_packs bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_price integer;
       v_sell integer;
       v_pack integer;
       v_amount bigint;
       v_units bigint;
       v_taken jsonb;
       v_balance bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       SELECT price, sell_price, pack_size INTO v_price, v_sell, v_pack
       FROM game.shop_price
       WHERE game = p_game_id AND shop_id = p_shop_id AND item_id = p_item_id;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'unknown_item');
       END IF;
       IF v_sell > 0 AND p_packs > (9223372036854775807::bigint / v_sell::bigint) THEN
         RETURN jsonb_build_object('error', 'bad_amount');
       END IF;
       v_amount := v_sell::bigint * p_packs;
       v_units := v_pack::bigint * p_packs;
       IF v_amount <= 0 THEN
         RETURN jsonb_build_object('error', 'zero_value');
       END IF;
       v_taken := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_amount, 'shop_sell', 'shop_sell', true);
       IF v_taken ? 'error' THEN
         RETURN v_taken;
       END IF;
       v_balance := (v_taken->>'balance')::bigint;
       v_response := jsonb_build_object('shop_id', p_shop_id, 'item_id', p_item_id, 'packs', p_packs, 'units', v_units, 'credited', v_amount, 'balance', v_balance);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.sell', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,
      ],
    },
    // Portal tickets. 0004 stays unused. These statements do not rewrite economy rows.,
    {
      id: "0006_hashed_portal_tickets",
      statements: [
    // Hashed portal tickets. The raw secret is returned once and never stored.
    // This statement does not update or delete economy rows.
    `CREATE TABLE IF NOT EXISTS game.auth_ticket (
      ticket_hash bytea PRIMARY KEY,
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      session_id uuid NOT NULL,
      ranked boolean NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))
    )`,

    `CREATE TABLE IF NOT EXISTS game.portal_attempt (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    "CREATE INDEX IF NOT EXISTS portal_attempt_recent ON game.portal_attempt (user_id, created_at)",

    `CREATE TABLE IF NOT EXISTS game.maint_sweep (
      name text PRIMARY KEY,
      ran_at timestamptz NOT NULL
    )`,

    `CREATE OR REPLACE FUNCTION game.claim_portal_rate(p_user uuid)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_n integer;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('portal-rate:' || p_user::text, 0));
       SELECT count(*) INTO v_n
       FROM game.portal_attempt
       WHERE user_id = p_user AND created_at > now() - interval '1 minute';
       IF v_n >= 10 THEN
         RETURN jsonb_build_object('error', 'rate_limited');
       END IF;
       INSERT INTO game.portal_attempt (user_id) VALUES (p_user);
       RETURN jsonb_build_object('ok', true);
     END;
     $fn$`,

    "DELETE FROM game.auth_ticket WHERE created_at < now() - interval '1 hour'",
    "DELETE FROM game.portal_attempt WHERE created_at < now() - interval '1 hour'",
    `INSERT INTO game.maint_sweep (name, ran_at) VALUES ('auth_ticket', now())
     ON CONFLICT (name) DO UPDATE SET ran_at = now()`,
      ],
    },
    // 0004 stays unused. Earn ceilings, cap-time relic grants, and whole Verse
    // exchange rejects. This migration does not delete rows. The event_rule
    // upsert updates max_amount on rows that already exist.,
    {
      id: "0007_earn_caps_relic_exchange",
      statements: [
    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
     VALUES
       ('sproto', 'win', NULL, NULL, NULL, NULL, '{}'::jsonb, 20),
       ('sproto', 'duel_win', NULL, NULL, NULL, NULL, '{}'::jsonb, 20),
       ('hpos10i', 'level_end', NULL, NULL, NULL, NULL, '{}'::jsonb, 20),
       ('nobu', 'level_end', NULL, NULL, NULL, NULL, '{}'::jsonb, 20),
       ('peoples-bitcoin', 'pb_bank', NULL, NULL, NULL, NULL, '{}'::jsonb, 200),
       ('peoples-bitcoin', 'pb_drop', NULL, NULL, NULL, NULL, '{}'::jsonb, 200),
       ('peoples-bitcoin', 'pb_lobby', NULL, NULL, NULL, NULL, '{}'::jsonb, 200),
       ('peoples-bitcoin', 'pb_sell', NULL, NULL, NULL, NULL, '{}'::jsonb, 200),
       ('peoples-bitcoin', 'pb_quest', NULL, NULL, NULL, NULL, '{}'::jsonb, 158)
     ON CONFLICT (game_id, event_type) DO UPDATE SET max_amount = EXCLUDED.max_amount`,

    `CREATE OR REPLACE FUNCTION game.claim_event_relic(
       p_user_id uuid, p_session_id uuid, p_game_id text, p_event_id text, p_data jsonb
     ) RETURNS text LANGUAGE plpgsql AS $fn$
     DECLARE
       v_relic text;
       v_event uuid;
       v_inserted int;
     BEGIN
       v_relic := game.relic_for_event(p_game_id, p_event_id, p_data);
       IF v_relic IS NULL THEN
         RETURN NULL;
       END IF;
       v_event := gen_random_uuid();
       INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
       VALUES (p_user_id, v_relic, p_session_id, v_event)
       ON CONFLICT (user_id, relic_id) DO NOTHING;
       GET DIAGNOSTICS v_inserted = ROW_COUNT;
       IF v_inserted = 1 THEN
         INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
         VALUES (v_event, p_user_id, 'grant_relic', v_relic, p_game_id, p_session_id);
         INSERT INTO game.game_beaten (user_id, game_id, relic_id)
         VALUES (p_user_id, p_game_id, v_relic)
         ON CONFLICT (user_id, game_id) DO NOTHING;
         RETURN v_relic;
       END IF;
       RETURN NULL;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.apply_event(
       p_user_id uuid,
       p_session_id uuid,
       p_game_id text,
       p_event_id text,
       p_data jsonb,
       p_idem_key text,
       p_req_hash text,
       p_seq bigint DEFAULT NULL
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_relic text;
       v_last bigint;
       v_pay bigint;
       v_credit jsonb;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency
       WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       SELECT event_seq INTO v_last
       FROM game.game_session
       WHERE session_id = p_session_id
         AND user_id = p_user_id
         AND game_id = p_game_id
         AND state = 'open'
         AND lease_until > now()
         AND ticket_redeemed_at IS NOT NULL
       FOR UPDATE;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       IF p_seq IS NOT NULL THEN
         IF v_last > 0 AND p_seq = v_last THEN
           RETURN jsonb_build_object('error', 'seq_duplicate');
         ELSIF p_seq <> v_last + 1 THEN
           RETURN jsonb_build_object('error', 'seq_stale');
         END IF;
       END IF;
       SELECT tickets INTO v_pay
       FROM game.event_rule
       WHERE game_id = p_game_id
         AND event_type = p_event_id
         AND tickets IS NOT NULL
         AND match <@ COALESCE(p_data, '{}'::jsonb)
       LIMIT 1;
       IF v_pay IS NOT NULL AND v_pay > 0 THEN
         PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
         v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_pay, p_event_id, 'earn', false);
         IF v_credit ? 'error' THEN
           IF v_credit->>'error' IN ('session_ticket_cap', 'daily_ticket_cap') THEN
             v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
             RETURN v_credit || jsonb_build_object('relic_granted', v_relic IS NOT NULL);
           END IF;
           RETURN v_credit;
         END IF;
       END IF;
       IF p_seq IS NOT NULL THEN
         UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
       END IF;
       v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
       v_response := '{}'::jsonb;
       IF v_relic IS NOT NULL THEN
         v_response := jsonb_build_object('granted', v_relic);
       END IF;
       IF v_credit IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
         v_response := v_response || jsonb_build_object('tickets', (v_credit->>'applied')::bigint);
       END IF;
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency
       WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN
         RAISE;
       END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.earn_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_amount bigint, p_reason text, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_credit jsonb;
       v_applied bigint;
       v_balance bigint;
       v_max bigint;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       SELECT max_amount INTO v_max FROM game.event_rule
       WHERE game_id = p_game_id AND event_type = p_reason AND max_amount IS NOT NULL
       LIMIT 1;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'unknown_reason');
       END IF;
       IF p_amount > v_max THEN
         RETURN jsonb_build_object('error', 'amount_over_rule');
       END IF;
       v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, p_amount, p_reason, 'earn', false);
       IF v_credit ? 'error' THEN
         RETURN v_credit;
       END IF;
       v_balance := (v_credit->>'balance')::bigint;
       v_applied := (v_credit->>'applied')::bigint;
       v_response := jsonb_build_object('balance', v_balance, 'capped', v_applied < p_amount);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.earn', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,

    `CREATE OR REPLACE FUNCTION game.exchange_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_tickets bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_day date;
       v_used bigint;
       v_room bigint;
       v_verse bigint;
       v_debit bigint;
       v_tickets bigint;
       v_wallet bigint;
       v_event uuid;
       v_receipt uuid;
     BEGIN
       IF p_game_id = 'hpos10i' THEN
         RETURN jsonb_build_object('error', 'exchange_not_allowed');
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       v_hash := decode(p_req_hash, 'hex');
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN
           RETURN jsonb_build_object('error', 'idempotency_mismatch');
         END IF;
         RETURN v_response;
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
           AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
       END IF;
       v_verse := p_tickets / 10;
       IF v_verse <= 0 THEN
         RETURN jsonb_build_object('error', 'below_rate');
       END IF;
       v_day := (now() AT TIME ZONE 'utc')::date;
       SELECT amount INTO v_used FROM game.earn_window
       WHERE user_id = p_user_id AND bucket = 'verse:' || p_game_id AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       v_room := 50 - v_used;
       IF v_room <= 0 OR v_verse > v_room THEN
         RETURN jsonb_build_object('error', 'verse_cap');
       END IF;
       v_debit := v_verse * 10;
       SELECT balance INTO v_tickets FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id FOR UPDATE;
       IF NOT FOUND OR v_tickets < v_debit THEN
         RETURN jsonb_build_object('error', 'insufficient_tickets');
       END IF;
       UPDATE game.tickets_balance SET balance = balance - v_debit
       WHERE user_id = p_user_id AND game_id = p_game_id
       RETURNING balance INTO v_tickets;
       INSERT INTO game.verse_wallet (user_id, balance) VALUES (p_user_id, v_verse)
       ON CONFLICT (user_id) DO UPDATE
         SET balance = game.verse_wallet.balance + EXCLUDED.balance
       RETURNING balance INTO v_wallet;
       v_event := gen_random_uuid();
       v_receipt := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (v_event, p_user_id, p_game_id, -v_debit, v_tickets, 'exchange', v_receipt, 'exchange');
       INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
       VALUES (gen_random_uuid(), p_user_id, v_verse, v_wallet, p_game_id, v_receipt);
       INSERT INTO game.exchange_tx (receipt_id, user_id, game_id, tickets, verse, rate, idem_key)
       VALUES (v_receipt, p_user_id, p_game_id, v_debit, v_verse, '10:1', p_idem_key);
       INSERT INTO game.verse_earned (user_id, game_id, lifetime)
       VALUES (p_user_id, p_game_id, v_verse)
       ON CONFLICT (user_id, game_id) DO UPDATE
         SET lifetime = game.verse_earned.lifetime + EXCLUDED.lifetime;
       INSERT INTO game.earn_window (user_id, bucket, day, amount)
       VALUES (p_user_id, 'verse:' || p_game_id, v_day, v_verse)
       ON CONFLICT (user_id, bucket, day) DO UPDATE
         SET amount = game.earn_window.amount + EXCLUDED.amount;
       v_response := jsonb_build_object('verse', v_wallet, 'ticketsLeft', v_tickets, 'balance', v_tickets, 'receiptId', v_receipt, 'verseCapLeft', v_room - v_verse);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'tickets.exchange', v_hash, v_response);
       RETURN v_response;
     EXCEPTION WHEN unique_violation THEN
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF NOT FOUND THEN RAISE; END IF;
       IF v_existing_hash <> v_hash THEN
         RETURN jsonb_build_object('error', 'idempotency_mismatch');
       END IF;
       RETURN v_response;
     END;
     $fn$`,
      ],
    },
    {
      // 0002_baseline still inserts these four rows, once. This delete is what
      // leaves them out. 0002 is immutable, so it is not edited and does not run again.
      // Numbered 0008 so it lands after #12 (0005), #25 (0006), and #13 (0007).
      id: "0008_drop_open_game_beaten_rules",
      statements: [
        `DELETE FROM game.event_rule
         WHERE event_type = 'game_beaten'
           AND match = '{}'::jsonb
           AND (game_id, relic_id) IN (
             ('hpos10i', 'hpos10i_core'),
             ('peoples-bitcoin', 'genesis_shard'),
             ('nobu', 'cones_tip'),
             ('sproto', 'tinubu_crown')
           )`,
      ],
    },
    {
      // Sproto Fighter joins as the fifth game (entered from the Bar's arcade cabinet).
      // Widens the game and relic checks, adds the Tidebreaker Belt trigger (Story World 1)
      // and the per-win Ticket ceiling. No economy rows are touched. No open game_beaten rule.
      id: "0009_sproto_fighter",
      statements: [
        "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
        "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter'))",
        "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
        "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter'))",
        "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
        "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter'))",
        "ALTER TABLE game.relic_claim DROP CONSTRAINT IF EXISTS relic_claim_known",
        "ALTER TABLE game.relic_claim ADD CONSTRAINT relic_claim_known CHECK (relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt'))",
        `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
         VALUES
           ('sproto-fighter', 'fighter.story_level_complete', 'tidebreaker_belt', NULL, NULL, NULL, '{"world":1}'::jsonb, NULL),
           ('sproto-fighter', 'fighter_win', NULL, NULL, NULL, NULL, '{}'::jsonb, 20)
         ON CONFLICT (game_id, event_type) DO NOTHING`,
      ],
    },
    {
      // Sproto Fighter online duels: a fixed stake per player held in escrow by
      // the sproto_duel match, paid to the verified winner or refunded. Wagers
      // move existing Tickets between players; they never mint Tickets, so they
      // do not touch earn_window or the session earn cap.
      id: "0010_sproto_fighter_wagers",
      statements: [
        "ALTER TABLE game.tickets_ledger DROP CONSTRAINT IF EXISTS tickets_ledger_kind",
        "ALTER TABLE game.tickets_ledger ADD CONSTRAINT tickets_ledger_kind CHECK (kind IS NULL OR kind IN ('earn', 'exchange', 'spend', 'shop_sell', 'duel_stake', 'duel_payout', 'duel_refund'))",
        `CREATE TABLE IF NOT EXISTS game.sproto_wager (
          wager_id uuid PRIMARY KEY,
          match_id text NOT NULL UNIQUE,
          stake bigint NOT NULL CHECK (stake > 0),
          player_a uuid NOT NULL,
          player_b uuid NOT NULL,
          status text NOT NULL,
          winner uuid,
          reason text,
          created_at timestamptz NOT NULL DEFAULT now(),
          closed_at timestamptz,
          CONSTRAINT sproto_wager_players CHECK (player_a <> player_b),
          CONSTRAINT sproto_wager_status CHECK (status IN ('held', 'settled', 'refunded')),
          CONSTRAINT sproto_wager_winner CHECK (winner IS NULL OR winner = player_a OR winner = player_b)
        )`,
        "CREATE INDEX IF NOT EXISTS sproto_wager_open ON game.sproto_wager (created_at) WHERE status = 'held'",
        "CREATE INDEX IF NOT EXISTS sproto_wager_a ON game.sproto_wager (player_a, created_at)",
        "CREATE INDEX IF NOT EXISTS sproto_wager_b ON game.sproto_wager (player_b, created_at)",

        // Move Tickets for one user inside an already-locked transaction.
        // Returns the new balance, or NULL when a debit would go negative.
        `CREATE OR REPLACE FUNCTION game.sproto_wager_move(
           p_user_id uuid, p_delta bigint, p_kind text, p_wager_id uuid
         ) RETURNS bigint LANGUAGE plpgsql AS $fn$
         DECLARE v_balance bigint;
         BEGIN
           SELECT balance INTO v_balance FROM game.tickets_balance
           WHERE user_id = p_user_id AND game_id = 'sproto-fighter' FOR UPDATE;
           IF NOT FOUND THEN v_balance := 0; END IF;
           IF v_balance + p_delta < 0 THEN RETURN NULL; END IF;
           INSERT INTO game.tickets_balance (user_id, game_id, balance)
           VALUES (p_user_id, 'sproto-fighter', v_balance + p_delta)
           ON CONFLICT (user_id, game_id) DO UPDATE SET balance = EXCLUDED.balance
           RETURNING balance INTO v_balance;
           INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
           VALUES (gen_random_uuid(), p_user_id, 'sproto-fighter', p_delta, v_balance, p_kind, p_wager_id, p_kind);
           RETURN v_balance;
         END;
         $fn$`,

        // Lock both players' economies in a fixed order, so two holds can't deadlock.
        `CREATE OR REPLACE FUNCTION game.sproto_wager_lock(p_a uuid, p_b uuid) RETURNS void LANGUAGE plpgsql AS $fn$
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || LEAST(p_a::text, p_b::text), 0));
           PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || GREATEST(p_a::text, p_b::text), 0));
         END;
         $fn$`,

        // Take the stake from both players. Idempotent by match id. Abuse limits:
        // p_min_cpu_wins verified CPU wins before a first wager, p_pair_limit
        // wagers per pair per UTC day, p_daily_cap net Tickets won per UTC day.
        `CREATE OR REPLACE FUNCTION game.sproto_wager_hold(
           p_match_id text, p_a uuid, p_b uuid, p_stake bigint,
           p_min_cpu_wins int, p_pair_limit int, p_daily_cap bigint
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_existing game.sproto_wager%ROWTYPE;
           v_wager uuid;
           v_day timestamptz;
           v_user uuid;
           v_count bigint;
           v_net bigint;
           v_a bigint;
           v_b bigint;
         BEGIN
           IF p_a = p_b THEN RETURN jsonb_build_object('error', 'same_player'); END IF;
           PERFORM game.sproto_wager_lock(p_a, p_b);
           SELECT * INTO v_existing FROM game.sproto_wager WHERE match_id = p_match_id;
           IF FOUND THEN
             RETURN jsonb_build_object('wagerId', v_existing.wager_id, 'status', v_existing.status, 'stake', v_existing.stake);
           END IF;
           v_day := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
           FOREACH v_user IN ARRAY ARRAY[p_a, p_b] LOOP
             SELECT count(*) INTO v_count FROM game.tickets_ledger
             WHERE user_id = v_user AND game_id = 'sproto-fighter' AND reason = 'fighter_win';
             IF v_count < p_min_cpu_wins THEN
               RETURN jsonb_build_object('error', 'not_eligible', 'user', v_user, 'needed', p_min_cpu_wins - v_count);
             END IF;
             SELECT COALESCE(SUM(delta), 0) INTO v_net FROM game.tickets_ledger
             WHERE user_id = v_user AND game_id = 'sproto-fighter' AND created_at >= v_day
               AND kind IN ('duel_stake', 'duel_payout', 'duel_refund');
             IF v_net >= p_daily_cap THEN
               RETURN jsonb_build_object('error', 'daily_wager_cap', 'user', v_user);
             END IF;
           END LOOP;
           SELECT count(*) INTO v_count FROM game.sproto_wager
           WHERE created_at >= v_day AND ((player_a = p_a AND player_b = p_b) OR (player_a = p_b AND player_b = p_a));
           IF v_count >= p_pair_limit THEN
             RETURN jsonb_build_object('error', 'pair_limit');
           END IF;
           v_wager := gen_random_uuid();
           v_a := game.sproto_wager_move(p_a, -p_stake, 'duel_stake', v_wager);
           IF v_a IS NULL THEN RETURN jsonb_build_object('error', 'insufficient_tickets', 'user', p_a); END IF;
           v_b := game.sproto_wager_move(p_b, -p_stake, 'duel_stake', v_wager);
           IF v_b IS NULL THEN
             -- Undo player A's debit in this same transaction by raising; caller sees the error.
             RAISE EXCEPTION 'sproto_wager_insufficient_b';
           END IF;
           INSERT INTO game.sproto_wager (wager_id, match_id, stake, player_a, player_b, status)
           VALUES (v_wager, p_match_id, p_stake, p_a, p_b, 'held');
           RETURN jsonb_build_object('wagerId', v_wager, 'status', 'held', 'stake', p_stake,
             'balances', jsonb_build_object(p_a::text, v_a, p_b::text, v_b));
         EXCEPTION WHEN raise_exception THEN
           IF SQLERRM = 'sproto_wager_insufficient_b' THEN
             RETURN jsonb_build_object('error', 'insufficient_tickets', 'user', p_b);
           END IF;
           RAISE;
         END;
         $fn$`,

        // Pay the pot to the winner. Idempotent; a closed wager is never paid twice.
        `CREATE OR REPLACE FUNCTION game.sproto_wager_settle(p_match_id text, p_winner uuid, p_reason text)
         RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE w game.sproto_wager%ROWTYPE; v_balance bigint;
         BEGIN
           SELECT * INTO w FROM game.sproto_wager WHERE match_id = p_match_id;
           IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_wager'); END IF;
           PERFORM game.sproto_wager_lock(w.player_a, w.player_b);
           SELECT * INTO w FROM game.sproto_wager WHERE match_id = p_match_id FOR UPDATE;
           IF w.status <> 'held' THEN
             RETURN jsonb_build_object('status', w.status, 'winner', w.winner, 'reason', w.reason, 'repeat', true);
           END IF;
           IF p_winner <> w.player_a AND p_winner <> w.player_b THEN RETURN jsonb_build_object('error', 'not_a_player'); END IF;
           v_balance := game.sproto_wager_move(p_winner, w.stake * 2, 'duel_payout', w.wager_id);
           UPDATE game.sproto_wager SET status = 'settled', winner = p_winner, reason = p_reason, closed_at = now()
           WHERE wager_id = w.wager_id;
           RETURN jsonb_build_object('status', 'settled', 'winner', p_winner, 'payout', w.stake * 2, 'balance', v_balance, 'reason', p_reason);
         END;
         $fn$`,

        // Return each stake. Idempotent.
        `CREATE OR REPLACE FUNCTION game.sproto_wager_refund(p_match_id text, p_reason text)
         RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE w game.sproto_wager%ROWTYPE;
         BEGIN
           SELECT * INTO w FROM game.sproto_wager WHERE match_id = p_match_id;
           IF NOT FOUND THEN RETURN jsonb_build_object('status', 'none'); END IF;
           PERFORM game.sproto_wager_lock(w.player_a, w.player_b);
           SELECT * INTO w FROM game.sproto_wager WHERE match_id = p_match_id FOR UPDATE;
           IF w.status <> 'held' THEN
             RETURN jsonb_build_object('status', w.status, 'winner', w.winner, 'reason', w.reason, 'repeat', true);
           END IF;
           PERFORM game.sproto_wager_move(w.player_a, w.stake, 'duel_refund', w.wager_id);
           PERFORM game.sproto_wager_move(w.player_b, w.stake, 'duel_refund', w.wager_id);
           UPDATE game.sproto_wager SET status = 'refunded', reason = p_reason, closed_at = now()
           WHERE wager_id = w.wager_id;
           RETURN jsonb_build_object('status', 'refunded', 'reason', p_reason);
         END;
         $fn$`,

        // Refund every wager still held after p_age (a crashed or abandoned match).
        `CREATE OR REPLACE FUNCTION game.sproto_wager_expire(p_age interval) RETURNS integer LANGUAGE plpgsql AS $fn$
         DECLARE m text; n integer := 0;
         BEGIN
           FOR m IN SELECT match_id FROM game.sproto_wager WHERE status = 'held' AND created_at < now() - p_age LOOP
             PERFORM game.sproto_wager_refund(m, 'expired');
             n := n + 1;
           END LOOP;
           RETURN n;
         END;
         $fn$`,
      ],
    },
    {
      // Public boards (Contract C13). variant is the NOBU level ('1'..'3'), '' elsewhere.
      // win_record makes HubBoards.recordWin idempotent per (match, user).
      id: "0011_ranked_scores",
      statements: [
        `CREATE TABLE IF NOT EXISTS game.ranked_score (
           user_id uuid NOT NULL,
           board_id text NOT NULL,
           variant text NOT NULL DEFAULT '',
           value bigint NOT NULL CHECK (value >= 0),
           meta jsonb NOT NULL DEFAULT '{}'::jsonb,
           session_id uuid,
           updated_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, board_id, variant),
           CONSTRAINT ranked_score_board CHECK (board_id IN (
             'hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta'
           )),
           CONSTRAINT ranked_score_meta_object CHECK (jsonb_typeof(meta) = 'object')
         )`,
        "CREATE INDEX IF NOT EXISTS ranked_score_board_value ON game.ranked_score (board_id, variant, value)",
        `CREATE TABLE IF NOT EXISTS game.win_record (
           match_id text NOT NULL,
           user_id uuid NOT NULL,
           board_id text NOT NULL,
           at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (match_id, user_id)
         )`,
      ],
    },
    {
      // Plaza chat moderation (Contract C14). Mutes are checked by HubChat; reports come
      // from chat.report and from automatic hard-list hits (reporter NULL, reason 'auto').
      id: "0012_chat_moderation",
      statements: [
        `CREATE TABLE IF NOT EXISTS game.chat_mute (
           user_id uuid NOT NULL,
           until timestamptz NOT NULL,
           reason text NOT NULL DEFAULT '',
           by uuid,
           created_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, until)
         )`,
        `CREATE TABLE IF NOT EXISTS game.chat_report (
           id bigserial PRIMARY KEY,
           reporter uuid,
           target uuid NOT NULL,
           channel_id text NOT NULL DEFAULT '',
           message_id text NOT NULL DEFAULT '',
           text text NOT NULL DEFAULT '',
           reason text NOT NULL DEFAULT '',
           created_at timestamptz NOT NULL DEFAULT now()
         )`,
        "CREATE INDEX IF NOT EXISTS chat_report_created ON game.chat_report (created_at)",
        "CREATE INDEX IF NOT EXISTS chat_report_reporter ON game.chat_report (reporter, created_at)",
      ],
    },
    {
      // M6 item grants (docs/m6-server-prep.md, "Schema to number later"). The only definition of
      // game.item_owned and of the widened item_ledger_op. session.event grants a cosmetic item once
      // per player when a game.item_rule row matches; game.apply_event is 0007's body plus that grant.
      id: "0030_m6_item_grants",
      statements: [
        `CREATE TABLE IF NOT EXISTS game.item_owned (
           user_id uuid NOT NULL,
           item_id text NOT NULL,
           source text NOT NULL CHECK (source IN ('event', 'meta', 'store', 'migration')),
           ref_id uuid,
           acquired_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, item_id)
         )`,
        `CREATE TABLE IF NOT EXISTS game.item_rule (
           game_id text NOT NULL,
           event_type text NOT NULL,
           item_id text NOT NULL,
           match jsonb NOT NULL DEFAULT '{}'::jsonb,
           PRIMARY KEY (game_id, event_type, item_id),
           CONSTRAINT item_rule_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto')),
           CONSTRAINT item_rule_not_game_beaten CHECK (event_type <> 'game_beaten')
         )`,
        "ALTER TABLE game.item_ledger DROP CONSTRAINT IF EXISTS item_ledger_op",
        `ALTER TABLE game.item_ledger ADD CONSTRAINT item_ledger_op
           CHECK (op IN ('grant_relic', 'grant_item', 'purchase', 'admin_revoke'))`,
        `INSERT INTO game.item_rule (game_id, event_type, item_id, match)
         VALUES
           ('hpos10i', 'hpos10i.level_complete', 'pet_honk_sproto', '{"zone":"z1_retro_rush_hills","act":2}'::jsonb),
           ('hpos10i', 'hpos10i.level_complete', 'pet_spiral_sproto', '{"zone":"z2_wizard_academy","act":2}'::jsonb),
           ('nobu', 'nobu.boss_defeated', 'pet_mecha_sproto', '{"boss":"bird"}'::jsonb),
           ('nobu', 'nobu.boss_defeated', 'pet_conehead_sproto', '{"boss":"cat"}'::jsonb),
           ('sproto', 'sproto.boss_defeated', 'pet_presidential_sproto', '{"boss":"obama"}'::jsonb),
           ('peoples-bitcoin', 'pb.quest_complete', 'pet_moon_sproto', '{"questId":"quest_moonward"}'::jsonb),
           ('peoples-bitcoin', 'pb.quest_complete', 'pet_sproto_pup', '{"questId":"quest_hatchery"}'::jsonb)
         ON CONFLICT (game_id, event_type, item_id) DO NOTHING`,
        `CREATE OR REPLACE FUNCTION game.apply_event(
           p_user_id uuid,
           p_session_id uuid,
           p_game_id text,
           p_event_id text,
           p_data jsonb,
           p_idem_key text,
           p_req_hash text,
           p_seq bigint DEFAULT NULL
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_response jsonb;
           v_hash bytea;
           v_existing_hash bytea;
           v_relic text;
           v_last bigint;
           v_pay bigint;
           v_credit jsonb;
           v_items json;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
           v_hash := decode(p_req_hash, 'hex');
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF FOUND THEN
             IF v_existing_hash <> v_hash THEN
               RETURN jsonb_build_object('error', 'idempotency_mismatch');
             END IF;
             RETURN v_response;
           END IF;
           SELECT event_seq INTO v_last
           FROM game.game_session
           WHERE session_id = p_session_id
             AND user_id = p_user_id
             AND game_id = p_game_id
             AND state = 'open'
             AND lease_until > now()
             AND ticket_redeemed_at IS NOT NULL
           FOR UPDATE;
           IF NOT FOUND THEN
             RETURN jsonb_build_object('error', 'session_closed');
           END IF;
           IF p_seq IS NOT NULL THEN
             IF v_last > 0 AND p_seq = v_last THEN
               RETURN jsonb_build_object('error', 'seq_duplicate');
             ELSIF p_seq <> v_last + 1 THEN
               RETURN jsonb_build_object('error', 'seq_stale');
             END IF;
           END IF;
           SELECT tickets INTO v_pay
           FROM game.event_rule
           WHERE game_id = p_game_id
             AND event_type = p_event_id
             AND tickets IS NOT NULL
             AND match <@ COALESCE(p_data, '{}'::jsonb)
           LIMIT 1;
           IF v_pay IS NOT NULL AND v_pay > 0 THEN
             PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
             v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_pay, p_event_id, 'earn', false);
             IF v_credit ? 'error' THEN
               IF v_credit->>'error' IN ('session_ticket_cap', 'daily_ticket_cap') THEN
                 v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
                 RETURN v_credit || jsonb_build_object('relic_granted', v_relic IS NOT NULL);
               END IF;
               RETURN v_credit;
             END IF;
           END IF;
           IF p_seq IS NOT NULL THEN
             UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
           END IF;
           v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
           v_response := '{}'::jsonb;
           IF v_relic IS NOT NULL THEN
             v_response := jsonb_build_object('granted', v_relic);
           END IF;
           IF v_credit IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
             v_response := v_response || jsonb_build_object('tickets', (v_credit->>'applied')::bigint);
           END IF;
           -- M6 item grant (docs/m6-server-prep.md). Same transaction as the relic claim, before the
           -- idempotency insert, so a replay of this key returns the stored granted_items.
           -- Keep the pairs, the excluded ids and the item_rule seeds in step with HubItems in item_grant.ts.
           WITH sess AS (
             -- The relic session check above (already locked); item_grant.ts inlines the same predicate.
             SELECT event_seq FROM game.game_session
             WHERE session_id = p_session_id
               AND user_id = p_user_id
               AND game_id = p_game_id
               AND state = 'open'
               AND lease_until > now()
               AND ticket_redeemed_at IS NOT NULL
             FOR UPDATE
           ),
           eligible AS (
             SELECT r.item_id FROM game.item_rule r
             WHERE EXISTS (SELECT 1 FROM sess)
               AND (
                 (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
                 OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
                 OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
                 OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
               )
               AND r.game_id = p_game_id AND r.event_type = p_event_id
               AND r.event_type <> 'game_beaten'
               AND r.match <> '{}'::jsonb
               AND r.match <@ COALESCE(p_data, '{}'::jsonb)
               AND r.item_id NOT IN (
                 'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown',
                 'tidebreaker_belt', 'breakwater_coin',
                 'pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto'
               )
               AND EXISTS (
                 SELECT 1 FROM game.event_rule e
                 WHERE e.game_id = r.game_id AND e.event_type = r.event_type
                   AND e.event_type <> 'game_beaten'
               )
           ),
           ins AS (
             INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
             SELECT p_user_id, item_id, 'event', gen_random_uuid() FROM eligible
             ON CONFLICT (user_id, item_id) DO NOTHING
             RETURNING item_id, ref_id
           ),
           led AS (
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             SELECT ref_id, p_user_id, 'grant_item', item_id, 'event', ref_id FROM ins
             RETURNING item_id
           )
           SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json) INTO v_items FROM led;
           v_response := COALESCE(v_response, '{}'::jsonb)
             || jsonb_build_object('granted_items', COALESCE(v_items, '[]'::json));
           INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
           VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
           RETURN v_response;
         EXCEPTION WHEN unique_violation THEN
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF NOT FOUND THEN
             RAISE;
           END IF;
           IF v_existing_hash <> v_hash THEN
             RETURN jsonb_build_object('error', 'idempotency_mismatch');
           END IF;
           RETURN v_response;
         END;
         $fn$`,
      ],
    },
    {
      // Ken's Ticket rules (Nov 4), economy step only. Online and CPU win mints stop.
      // Story bosses pay 20 T once per player per boss per UTC day through session.event.
      // 0007/0009/0020 are frozen, so this entry updates the live rows and replaces
      // game.apply_event. Wager escrow (0010) is not touched.
      //
      // event_rule_max_amount forbids 0, so the ceiling is widened to >= 0 and the
      // four win-mint rows are set to 0. earn_tickets then rejects any positive amount
      // (amount_over_rule). Their tickets column stays NULL, so apply_event does not
      // pay them either.
      //
      // The old primary key is (game_id, event_type), which cannot hold one row per
      // boss. rule_key is the match's boss id, or '' when the rule is not per-boss.
      // day_limit and session_limit were never read. day_limit 1 is now enforced per
      // (player, boss, UTC day) with an earn_window bucket boss:<game>:<boss>, inside
      // the same apply_event transaction as the idempotency row. A second key the same
      // day pays nothing and still runs the relic and item claims.
      id: "0031_story_boss_tickets",
      statements: [
        "ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_max_amount",
        "ALTER TABLE game.event_rule ADD CONSTRAINT event_rule_max_amount CHECK (max_amount IS NULL OR max_amount >= 0)",
        `UPDATE game.event_rule SET max_amount = 0
         WHERE (game_id, event_type) IN (
           ('sproto', 'win'),
           ('sproto', 'duel_win'),
           ('sproto', 'srv_pvp_win'),
           ('sproto-fighter', 'fighter_win')
         )`,
        "ALTER TABLE game.event_rule ADD COLUMN IF NOT EXISTS rule_key text",
        `UPDATE game.event_rule
         SET rule_key = COALESCE(match->>'boss', '')
         WHERE rule_key IS NULL`,
        "ALTER TABLE game.event_rule ALTER COLUMN rule_key SET DEFAULT ''",
        "ALTER TABLE game.event_rule ALTER COLUMN rule_key SET NOT NULL",
        "ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_rule_key",
        "ALTER TABLE game.event_rule ADD CONSTRAINT event_rule_rule_key CHECK (rule_key = COALESCE(match->>'boss', ''))",
        "ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_pkey",
        "ALTER TABLE game.event_rule ADD PRIMARY KEY (game_id, event_type, rule_key)",
        `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount, rule_key)
         VALUES
           ('sproto', 'sproto.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sahil"}'::jsonb, NULL, 'sahil'),
           ('sproto', 'sproto.boss_defeated', NULL, 20, NULL, 1, '{"boss":"obama"}'::jsonb, NULL, 'obama'),
           ('sproto', 'sproto.boss_defeated', NULL, 20, NULL, 1, '{"boss":"broccoli"}'::jsonb, NULL, 'broccoli'),
           ('sproto', 'sproto.boss_defeated', NULL, 20, NULL, 1, '{"boss":"agent"}'::jsonb, NULL, 'agent'),
           ('sproto', 'sproto.boss_defeated', 'tinubu_crown', 20, NULL, 1, '{"boss":"tinubu"}'::jsonb, NULL, 'tinubu'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sproto3215"}'::jsonb, NULL, 'sproto3215'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sproto2616"}'::jsonb, NULL, 'sproto2616'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sproto3152"}'::jsonb, NULL, 'sproto3152'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"rivet"}'::jsonb, NULL, 'rivet'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sproto865"}'::jsonb, NULL, 'sproto865'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"sproto943"}'::jsonb, NULL, 'sproto943'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"nick"}'::jsonb, NULL, 'nick'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"guest07"}'::jsonb, NULL, 'guest07'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"vela"}'::jsonb, NULL, 'vela'),
           ('sproto-fighter', 'fighter.boss_defeated', NULL, 20, NULL, 1, '{"boss":"vaudream"}'::jsonb, NULL, 'vaudream')
         ON CONFLICT (game_id, event_type, rule_key) DO UPDATE
           SET tickets = EXCLUDED.tickets,
               day_limit = EXCLUDED.day_limit`,
        `CREATE OR REPLACE FUNCTION game.apply_event(
           p_user_id uuid,
           p_session_id uuid,
           p_game_id text,
           p_event_id text,
           p_data jsonb,
           p_idem_key text,
           p_req_hash text,
           p_seq bigint DEFAULT NULL
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_response jsonb;
           v_hash bytea;
           v_existing_hash bytea;
           v_relic text;
           v_last bigint;
           v_pay bigint;
           v_credit jsonb;
           v_items json;
           v_day_limit integer;
           v_rule_match jsonb;
           v_boss text;
           v_rule_bucket text;
           v_rule_day date;
           v_used bigint;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
           v_hash := decode(p_req_hash, 'hex');
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF FOUND THEN
             IF v_existing_hash <> v_hash THEN
               RETURN jsonb_build_object('error', 'idempotency_mismatch');
             END IF;
             RETURN v_response;
           END IF;
           SELECT event_seq INTO v_last
           FROM game.game_session
           WHERE session_id = p_session_id
             AND user_id = p_user_id
             AND game_id = p_game_id
             AND state = 'open'
             AND lease_until > now()
             AND ticket_redeemed_at IS NOT NULL
           FOR UPDATE;
           IF NOT FOUND THEN
             RETURN jsonb_build_object('error', 'session_closed');
           END IF;
           IF p_seq IS NOT NULL THEN
             IF v_last > 0 AND p_seq = v_last THEN
               RETURN jsonb_build_object('error', 'seq_duplicate');
             ELSIF p_seq <> v_last + 1 THEN
               RETURN jsonb_build_object('error', 'seq_stale');
             END IF;
           END IF;
           -- Most specific match wins. Boss rows are disjoint; the extra order
           -- keeps a broader row from beating a boss row if one is added later.
           v_rule_bucket := NULL;
           SELECT tickets, day_limit, match
             INTO v_pay, v_day_limit, v_rule_match
           FROM game.event_rule
           WHERE game_id = p_game_id
             AND event_type = p_event_id
             AND tickets IS NOT NULL
             AND tickets > 0
             AND match <@ COALESCE(p_data, '{}'::jsonb)
           ORDER BY cardinality(ARRAY(SELECT jsonb_object_keys(match))) DESC
           LIMIT 1;
           IF v_pay IS NOT NULL AND v_pay > 0 AND v_day_limit IS NOT NULL THEN
             v_boss := v_rule_match->>'boss';
             IF v_boss IS NULL OR v_boss = '' THEN
               v_pay := NULL;
             ELSE
               v_rule_day := (now() AT TIME ZONE 'utc')::date;
               v_rule_bucket := 'boss:' || p_game_id || ':' || v_boss;
               SELECT amount INTO v_used FROM game.earn_window
               WHERE user_id = p_user_id AND bucket = v_rule_bucket AND day = v_rule_day;
               IF COALESCE(v_used, 0) >= v_day_limit THEN
                 v_pay := NULL;
                 v_rule_bucket := NULL;
               END IF;
             END IF;
           END IF;
           IF v_pay IS NOT NULL AND v_pay > 0 THEN
             PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
             v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_pay, p_event_id, 'earn', false);
             IF v_credit ? 'error' THEN
               IF v_credit->>'error' IN ('session_ticket_cap', 'daily_ticket_cap') THEN
                 v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
                 RETURN v_credit || jsonb_build_object('relic_granted', v_relic IS NOT NULL);
               END IF;
               RETURN v_credit;
             END IF;
             IF v_rule_bucket IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
               INSERT INTO game.earn_window (user_id, bucket, day, amount)
               VALUES (p_user_id, v_rule_bucket, v_rule_day, 1)
               ON CONFLICT (user_id, bucket, day) DO UPDATE
                 SET amount = game.earn_window.amount + 1
               WHERE game.earn_window.amount < v_day_limit;
             END IF;
           END IF;
           IF p_seq IS NOT NULL THEN
             UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
           END IF;
           v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
           v_response := '{}'::jsonb;
           IF v_relic IS NOT NULL THEN
             v_response := jsonb_build_object('granted', v_relic);
           END IF;
           IF v_credit IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
             v_response := v_response || jsonb_build_object('tickets', (v_credit->>'applied')::bigint);
           END IF;
           -- M6 item grant (docs/m6-server-prep.md). Same transaction as the relic claim, before the
           -- idempotency insert, so a replay of this key returns the stored granted_items.
           -- Keep the pairs, the excluded ids and the item_rule seeds in step with HubItems in item_grant.ts.
           WITH sess AS (
             -- The relic session check above (already locked); item_grant.ts inlines the same predicate.
             SELECT event_seq FROM game.game_session
             WHERE session_id = p_session_id
               AND user_id = p_user_id
               AND game_id = p_game_id
               AND state = 'open'
               AND lease_until > now()
               AND ticket_redeemed_at IS NOT NULL
             FOR UPDATE
           ),
           eligible AS (
             SELECT r.item_id FROM game.item_rule r
             WHERE EXISTS (SELECT 1 FROM sess)
               AND (
                 (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
                 OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
                 OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
                 OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
               )
               AND r.game_id = p_game_id AND r.event_type = p_event_id
               AND r.event_type <> 'game_beaten'
               AND r.match <> '{}'::jsonb
               AND r.match <@ COALESCE(p_data, '{}'::jsonb)
               AND r.item_id NOT IN (
                 'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown',
                 'tidebreaker_belt', 'breakwater_coin',
                 'pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto'
               )
               AND EXISTS (
                 SELECT 1 FROM game.event_rule e
                 WHERE e.game_id = r.game_id AND e.event_type = r.event_type
                   AND e.event_type <> 'game_beaten'
               )
           ),
           ins AS (
             INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
             SELECT p_user_id, item_id, 'event', gen_random_uuid() FROM eligible
             ON CONFLICT (user_id, item_id) DO NOTHING
             RETURNING item_id, ref_id
           ),
           led AS (
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             SELECT ref_id, p_user_id, 'grant_item', item_id, 'event', ref_id FROM ins
             RETURNING item_id
           )
           SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json) INTO v_items FROM led;
           v_response := COALESCE(v_response, '{}'::jsonb)
             || jsonb_build_object('granted_items', COALESCE(v_items, '[]'::json));
           INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
           VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
           RETURN v_response;
         EXCEPTION WHEN unique_violation THEN
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF NOT FOUND THEN
             RAISE;
           END IF;
           IF v_existing_hash <> v_hash THEN
             RETURN jsonb_build_object('error', 'idempotency_mismatch');
           END IF;
           RETURN v_response;
         END;
         $fn$`,
      ],
    },
    {
      // 0010 is frozen. This replaces game.sproto_wager_hold with that body, plus a
      // guest refusal before the lock, and without the fighter_win qualifying count.
      // Any signed-in player may wager. game.user_is_guest matches HubChat.isGuest.
      // Replay (schema_migrations row removed, objects still present): drop only the
      // old 7-arg overload. The 6-arg function keeps the same argument names and
      // jsonb return, so CREATE OR REPLACE replaces it. Dropping it first is not
      // required and would not be, unless the return type or names changed.
      id: "0032_wager_online_qualify",
      statements: [
        `CREATE OR REPLACE FUNCTION game.user_is_guest(p_user uuid)
         RETURNS boolean LANGUAGE sql STABLE AS $fn$
           SELECT NOT EXISTS (
             SELECT 1 FROM users
             WHERE id = p_user AND COALESCE(email, '') <> ''
           )
         $fn$`,
        "DROP FUNCTION IF EXISTS game.sproto_wager_hold(text, uuid, uuid, bigint, int, int, bigint)",
        `CREATE OR REPLACE FUNCTION game.sproto_wager_hold(
           p_match_id text, p_a uuid, p_b uuid, p_stake bigint,
           p_pair_limit int, p_daily_cap bigint
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_existing game.sproto_wager%ROWTYPE;
           v_wager uuid;
           v_day timestamptz;
           v_user uuid;
           v_count bigint;
           v_net bigint;
           v_a bigint;
           v_b bigint;
         BEGIN
           IF p_a = p_b THEN RETURN jsonb_build_object('error', 'same_player'); END IF;
           IF game.user_is_guest(p_a) OR game.user_is_guest(p_b) THEN
             RETURN jsonb_build_object('error', 'wager_guest');
           END IF;
           PERFORM game.sproto_wager_lock(p_a, p_b);
           SELECT * INTO v_existing FROM game.sproto_wager WHERE match_id = p_match_id;
           IF FOUND THEN
             RETURN jsonb_build_object('wagerId', v_existing.wager_id, 'status', v_existing.status, 'stake', v_existing.stake);
           END IF;
           v_day := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
           FOREACH v_user IN ARRAY ARRAY[p_a, p_b] LOOP
             SELECT COALESCE(SUM(delta), 0) INTO v_net FROM game.tickets_ledger
             WHERE user_id = v_user AND game_id = 'sproto-fighter' AND created_at >= v_day
               AND kind IN ('duel_stake', 'duel_payout', 'duel_refund');
             IF v_net >= p_daily_cap THEN
               RETURN jsonb_build_object('error', 'daily_wager_cap', 'user', v_user);
             END IF;
           END LOOP;
           SELECT count(*) INTO v_count FROM game.sproto_wager
           WHERE created_at >= v_day AND ((player_a = p_a AND player_b = p_b) OR (player_a = p_b AND player_b = p_a));
           IF v_count >= p_pair_limit THEN
             RETURN jsonb_build_object('error', 'pair_limit');
           END IF;
           v_wager := gen_random_uuid();
           v_a := game.sproto_wager_move(p_a, -p_stake, 'duel_stake', v_wager);
           IF v_a IS NULL THEN RETURN jsonb_build_object('error', 'insufficient_tickets', 'user', p_a); END IF;
           v_b := game.sproto_wager_move(p_b, -p_stake, 'duel_stake', v_wager);
           IF v_b IS NULL THEN
             -- Undo player A's debit in this same transaction by raising; caller sees the error.
             RAISE EXCEPTION 'sproto_wager_insufficient_b';
           END IF;
           INSERT INTO game.sproto_wager (wager_id, match_id, stake, player_a, player_b, status)
           VALUES (v_wager, p_match_id, p_stake, p_a, p_b, 'held');
           RETURN jsonb_build_object('wagerId', v_wager, 'status', 'held', 'stake', p_stake,
             'balances', jsonb_build_object(p_a::text, v_a, p_b::text, v_b));
         EXCEPTION WHEN raise_exception THEN
           IF SQLERRM = 'sproto_wager_insufficient_b' THEN
             RETURN jsonb_build_object('error', 'insufficient_tickets', 'user', p_b);
           END IF;
           RAISE;
         END;
         $fn$`,
      ],
    },
    {
      // Interim hold for forgeable client-reported Relic and item grants (0033).
      // Does not revoke or rewrite game.relic_claim / game.item_owned. A matching
      // rule with grant_hold goes to the pending table (earn-once PK, ON CONFLICT
      // DO NOTHING) and pays nothing: no Tickets, no Verse, no item_ledger, no
      // game_beaten, no derived staff/pet. sproto_wager_hold counts fighter_win
      // tickets_ledger rows only, so a pending row cannot qualify a wager.
      // Story-boss allowlist rows (match pins a boss) and server-recorded results
      // stay live. Promotion is game.promote_pending_grant; nothing calls it yet,
      // and it is not an RPC.
      //
      // Held pairs (grant_hold = true):
      //   sproto-fighter, fighter.story_level_complete, tidebreaker_belt
      //     Client posts the story level. No Fighter story sim.
      //   hpos10i, hpos10i.level_complete, hpos10i_core
      //   hpos10i, hpos10i.level_complete, pet_honk_sproto
      //   hpos10i, hpos10i.level_complete, pet_spiral_sproto
      //     Client posts the act. The server does not replay the level.
      //   peoples-bitcoin, pb.quest_complete, genesis_shard
      //   peoples-bitcoin, pb.quest_complete, pet_moon_sproto
      //   peoples-bitcoin, pb.quest_complete, pet_sproto_pup
      //     Client posts the quest. The server does not verify completion.
      // Left live: nobu.boss_defeated (cones_tip, pet_mecha_sproto, pet_conehead_sproto),
      // sproto.boss_defeated (tinubu_crown, pet_presidential_sproto),
      // arcade.boss_defeated (breakwater_coin). Those matches are the story-boss
      // allowlist. Duel sim and arena srv_pvp_win write no Relic or item.
      //
      // game.apply_event is not replaced. PR #62 (0031) replaces that function;
      // replacing it here would drop that body or be dropped by it. Relic holds
      // live in claim_event_relic, which 0031 does not replace. Item holds live
      // in a BEFORE INSERT trigger, so whichever apply_event inserts item_owned
      // still diverts a held item.
      id: "0033_hold_client_relic_grants",
      statements: [
        "ALTER TABLE game.event_rule ADD COLUMN IF NOT EXISTS grant_hold boolean NOT NULL DEFAULT false",
        "ALTER TABLE game.item_rule ADD COLUMN IF NOT EXISTS grant_hold boolean NOT NULL DEFAULT false",
        `CREATE TABLE IF NOT EXISTS game.relic_claim_pending (
           user_id uuid NOT NULL,
           relic_id text NOT NULL,
           session_id uuid NOT NULL,
           game_id text NOT NULL,
           event_type text NOT NULL,
           data jsonb NOT NULL DEFAULT '{}'::jsonb,
           created_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, relic_id),
           CONSTRAINT relic_claim_pending_known CHECK (relic_id IN (
             'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin'
           ))
         )`,
        `CREATE TABLE IF NOT EXISTS game.item_owned_pending (
           user_id uuid NOT NULL,
           item_id text NOT NULL,
           session_id uuid NOT NULL,
           game_id text NOT NULL,
           event_type text NOT NULL,
           data jsonb NOT NULL DEFAULT '{}'::jsonb,
           created_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, item_id)
         )`,
        `UPDATE game.event_rule SET grant_hold = true
         WHERE (game_id, event_type, relic_id) IN (
           ('sproto-fighter', 'fighter.story_level_complete', 'tidebreaker_belt'),
           ('hpos10i', 'hpos10i.level_complete', 'hpos10i_core'),
           ('peoples-bitcoin', 'pb.quest_complete', 'genesis_shard')
         )`,
        `UPDATE game.item_rule SET grant_hold = true
         WHERE (game_id, event_type, item_id) IN (
           ('hpos10i', 'hpos10i.level_complete', 'pet_honk_sproto'),
           ('hpos10i', 'hpos10i.level_complete', 'pet_spiral_sproto'),
           ('peoples-bitcoin', 'pb.quest_complete', 'pet_moon_sproto'),
           ('peoples-bitcoin', 'pb.quest_complete', 'pet_sproto_pup')
         )`,
        "ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_hold_no_tickets",
        `ALTER TABLE game.event_rule ADD CONSTRAINT event_rule_hold_no_tickets
           CHECK (grant_hold = false OR tickets IS NULL)`,
        // 0007's body, plus transaction-local grant context for the item trigger,
        // plus the hold branch. The live insert is unchanged.
        `CREATE OR REPLACE FUNCTION game.claim_event_relic(
           p_user_id uuid, p_session_id uuid, p_game_id text, p_event_id text, p_data jsonb
         ) RETURNS text LANGUAGE plpgsql AS $fn$
         DECLARE
           v_relic text;
           v_event uuid;
           v_inserted int;
           v_hold boolean;
         BEGIN
           PERFORM set_config('hub.grant_session', COALESCE(p_session_id::text, ''), true);
           PERFORM set_config('hub.grant_game', COALESCE(p_game_id, ''), true);
           PERFORM set_config('hub.grant_event', COALESCE(p_event_id, ''), true);
           PERFORM set_config('hub.grant_data', COALESCE(p_data, '{}'::jsonb)::text, true);
           v_relic := game.relic_for_event(p_game_id, p_event_id, p_data);
           IF v_relic IS NULL THEN
             RETURN NULL;
           END IF;
           v_hold := false;
           SELECT grant_hold INTO v_hold
           FROM game.event_rule
           WHERE game_id = p_game_id
             AND event_type = p_event_id
             AND relic_id = v_relic
             AND match <@ COALESCE(p_data, '{}'::jsonb)
           LIMIT 1;
           IF NOT FOUND THEN
             v_hold := false;
           END IF;
           IF v_hold THEN
             IF NOT EXISTS (
               SELECT 1 FROM game.relic_claim
               WHERE user_id = p_user_id AND relic_id = v_relic
             ) THEN
               INSERT INTO game.relic_claim_pending (
                 user_id, relic_id, session_id, game_id, event_type, data
               ) VALUES (
                 p_user_id, v_relic, p_session_id, p_game_id, p_event_id, COALESCE(p_data, '{}'::jsonb)
               )
               ON CONFLICT (user_id, relic_id) DO NOTHING;
             END IF;
             RETURN NULL;
           END IF;
           v_event := gen_random_uuid();
           INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
           VALUES (p_user_id, v_relic, p_session_id, v_event)
           ON CONFLICT (user_id, relic_id) DO NOTHING;
           GET DIAGNOSTICS v_inserted = ROW_COUNT;
           IF v_inserted = 1 THEN
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             VALUES (v_event, p_user_id, 'grant_relic', v_relic, p_game_id, p_session_id);
             INSERT INTO game.game_beaten (user_id, game_id, relic_id)
             VALUES (p_user_id, p_game_id, v_relic)
             ON CONFLICT (user_id, game_id) DO NOTHING;
             RETURN v_relic;
           END IF;
           RETURN NULL;
         END;
         $fn$`,
        `CREATE OR REPLACE FUNCTION game.item_owned_hold_pending()
         RETURNS trigger LANGUAGE plpgsql AS $fn$
         DECLARE
           v_session uuid;
           v_game text;
           v_event text;
           v_data jsonb;
         BEGIN
           IF current_setting('hub.grant_promote', true) = '1' THEN
             RETURN NEW;
           END IF;
           IF NEW.source IS DISTINCT FROM 'event' THEN
             RETURN NEW;
           END IF;
           IF NOT EXISTS (
             SELECT 1 FROM game.item_rule
             WHERE item_id = NEW.item_id AND grant_hold
           ) THEN
             RETURN NEW;
           END IF;
           BEGIN
             v_session := NULLIF(current_setting('hub.grant_session', true), '')::uuid;
             v_data := COALESCE(NULLIF(current_setting('hub.grant_data', true), '')::jsonb, '{}'::jsonb);
           EXCEPTION WHEN others THEN
             v_session := NULL;
             v_data := '{}'::jsonb;
           END;
           v_game := COALESCE(NULLIF(current_setting('hub.grant_game', true), ''), '');
           v_event := COALESCE(NULLIF(current_setting('hub.grant_event', true), ''), '');
           IF v_session IS NULL OR v_game = '' OR v_event = '' THEN
             RAISE EXCEPTION 'grant_hold_missing_session';
           END IF;
           IF NOT EXISTS (
             SELECT 1 FROM game.item_owned o
             WHERE o.user_id = NEW.user_id AND o.item_id = NEW.item_id
           ) THEN
             INSERT INTO game.item_owned_pending (
               user_id, item_id, session_id, game_id, event_type, data
             ) VALUES (
               NEW.user_id, NEW.item_id, v_session, v_game, v_event, v_data
             )
             ON CONFLICT (user_id, item_id) DO NOTHING;
           END IF;
           RETURN NULL;
         END;
         $fn$`,
        "DROP TRIGGER IF EXISTS item_owned_hold_pending ON game.item_owned",
        `CREATE TRIGGER item_owned_hold_pending
           BEFORE INSERT ON game.item_owned
           FOR EACH ROW EXECUTE FUNCTION game.item_owned_hold_pending()`,
        // Server-side only. Not registered as an RPC. No caller yet.
        // Moves one pending Relic or item onto the live table exactly once.
        // Writes the same ledger (and, for a Relic, game_beaten) as a live claim.
        // Does not pay Tickets or Verse, does not insert a staff or a pet, and
        // does not update a row that is already live.
        `CREATE OR REPLACE FUNCTION game.promote_pending_grant(
           p_user_id uuid, p_kind text, p_id text
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_relic game.relic_claim_pending%ROWTYPE;
           v_item game.item_owned_pending%ROWTYPE;
           v_event uuid;
           v_inserted int;
         BEGIN
           IF p_kind IS NULL OR p_kind NOT IN ('relic', 'item') THEN
             RETURN jsonb_build_object('ok', false, 'reason', 'bad_kind');
           END IF;
           IF p_user_id IS NULL OR p_id IS NULL OR p_id = '' THEN
             RETURN jsonb_build_object('ok', false, 'reason', 'bad_id');
           END IF;
           PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
           IF p_kind = 'relic' THEN
             IF EXISTS (
               SELECT 1 FROM game.relic_claim
               WHERE user_id = p_user_id AND relic_id = p_id
             ) THEN
               DELETE FROM game.relic_claim_pending
               WHERE user_id = p_user_id AND relic_id = p_id;
               RETURN jsonb_build_object('ok', true, 'promoted', false, 'reason', 'already_live', 'kind', 'relic', 'id', p_id);
             END IF;
             SELECT * INTO v_relic FROM game.relic_claim_pending
             WHERE user_id = p_user_id AND relic_id = p_id
             FOR UPDATE;
             IF NOT FOUND THEN
               RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'kind', 'relic', 'id', p_id);
             END IF;
             v_event := gen_random_uuid();
             INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
             VALUES (p_user_id, v_relic.relic_id, v_relic.session_id, v_event)
             ON CONFLICT (user_id, relic_id) DO NOTHING;
             GET DIAGNOSTICS v_inserted = ROW_COUNT;
             IF v_inserted = 1 THEN
               INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
               VALUES (v_event, p_user_id, 'grant_relic', v_relic.relic_id, v_relic.game_id, v_relic.session_id);
               INSERT INTO game.game_beaten (user_id, game_id, relic_id)
               VALUES (p_user_id, v_relic.game_id, v_relic.relic_id)
               ON CONFLICT (user_id, game_id) DO NOTHING;
               DELETE FROM game.relic_claim_pending
               WHERE user_id = p_user_id AND relic_id = p_id;
               RETURN jsonb_build_object('ok', true, 'promoted', true, 'kind', 'relic', 'id', p_id);
             END IF;
             IF EXISTS (
               SELECT 1 FROM game.relic_claim
               WHERE user_id = p_user_id AND relic_id = p_id
             ) THEN
               DELETE FROM game.relic_claim_pending
               WHERE user_id = p_user_id AND relic_id = p_id;
               RETURN jsonb_build_object('ok', true, 'promoted', false, 'reason', 'already_live', 'kind', 'relic', 'id', p_id);
             END IF;
             RETURN jsonb_build_object('ok', false, 'reason', 'not_promoted', 'kind', 'relic', 'id', p_id);
           END IF;
           IF EXISTS (
             SELECT 1 FROM game.item_owned
             WHERE user_id = p_user_id AND item_id = p_id
           ) THEN
             DELETE FROM game.item_owned_pending
             WHERE user_id = p_user_id AND item_id = p_id;
             RETURN jsonb_build_object('ok', true, 'promoted', false, 'reason', 'already_live', 'kind', 'item', 'id', p_id);
           END IF;
           SELECT * INTO v_item FROM game.item_owned_pending
           WHERE user_id = p_user_id AND item_id = p_id
           FOR UPDATE;
           IF NOT FOUND THEN
             RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'kind', 'item', 'id', p_id);
           END IF;
           v_event := gen_random_uuid();
           PERFORM set_config('hub.grant_promote', '1', true);
           INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
           VALUES (p_user_id, v_item.item_id, 'event', v_event)
           ON CONFLICT (user_id, item_id) DO NOTHING;
           GET DIAGNOSTICS v_inserted = ROW_COUNT;
           PERFORM set_config('hub.grant_promote', '', true);
           IF v_inserted = 1 THEN
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             VALUES (v_event, p_user_id, 'grant_item', v_item.item_id, 'event', v_event);
             DELETE FROM game.item_owned_pending
             WHERE user_id = p_user_id AND item_id = p_id;
             RETURN jsonb_build_object('ok', true, 'promoted', true, 'kind', 'item', 'id', p_id);
           END IF;
           IF EXISTS (
             SELECT 1 FROM game.item_owned
             WHERE user_id = p_user_id AND item_id = p_id
           ) THEN
             DELETE FROM game.item_owned_pending
             WHERE user_id = p_user_id AND item_id = p_id;
             RETURN jsonb_build_object('ok', true, 'promoted', false, 'reason', 'already_live', 'kind', 'item', 'id', p_id);
           END IF;
           RETURN jsonb_build_object('ok', false, 'reason', 'not_promoted', 'kind', 'item', 'id', p_id);
         END;
         $fn$`,
      ],
    },
    {
      // Hub item gates. Read-only to clients: no RPC writes this table. Hall of Champions
      // stays on the four Four Lights relic ids in the plaza client; that rule is not an item id.
      id: "0034_hub_gate",
      statements: [
        `CREATE TABLE IF NOT EXISTS game.hub_gate (
           gate_id text PRIMARY KEY,
           action_type text NOT NULL CHECK (action_type IN ('portal', 'session', 'interact', 'zone')),
           target text,
           required_item_ids text[] NOT NULL,
           require_all boolean NOT NULL DEFAULT true,
           enabled boolean NOT NULL DEFAULT true,
           locked_hint_pool text
         )`,
        `COMMENT ON TABLE game.hub_gate IS 'Server-owned item gates. Clients receive unlocked bools only. Gates grant nothing.'`,
        `CREATE OR REPLACE FUNCTION game.owned_item_ids(p_user_id uuid)
         RETURNS text[]
         LANGUAGE sql
         STABLE
         AS $own$
           SELECT COALESCE(array_agg(item_id ORDER BY item_id), ARRAY[]::text[])
           FROM (
             SELECT DISTINCT item_id FROM (
               SELECT 'duel_staff_sproto'::text AS item_id
               UNION ALL
               SELECT v.item_id
               FROM (VALUES
                 ('nobu_clown_collar', 'hpos10i_core'),
                 ('pb_summon_speed_sproto', 'hpos10i_core'),
                 ('duel_staff_momentum', 'hpos10i_core'),
                 ('pet_speed_sproto', 'hpos10i_core'),
                 ('hpos_skin_golden_sproto', 'genesis_shard'),
                 ('nobu_golden_collar', 'genesis_shard'),
                 ('duel_staff_moonward', 'genesis_shard'),
                 ('hpos_skin_nobu', 'cones_tip'),
                 ('pb_summon_nobu', 'cones_tip'),
                 ('duel_staff_nobu', 'cones_tip'),
                 ('pet_nobu', 'cones_tip'),
                 ('pb_summon_duelist_sproto', 'tinubu_crown'),
                 ('nobu_wizard_hat', 'tinubu_crown'),
                 ('hpos_cape_duelist', 'tinubu_crown'),
                 ('pet_duelist_sproto', 'tinubu_crown'),
                 ('duel_staff_fighters_might', 'tidebreaker_belt'),
                 ('nobu_champions_crown', 'tidebreaker_belt'),
                 ('pb_summon_champion_sproto', 'tidebreaker_belt'),
                 ('hpos_skin_tidebreaker', 'tidebreaker_belt')
               ) AS v(item_id, relic_id)
               WHERE EXISTS (
                 SELECT 1 FROM game.relic_claim c
                 WHERE c.user_id = p_user_id AND c.relic_id = v.relic_id
               )
               UNION ALL
               SELECT o.item_id
               FROM game.item_owned o
               WHERE o.user_id = p_user_id
               -- quantum_cell is keepsake-derived from NOBU rematch pieces. Those piece ids are
               -- not in this repo. An empty piece list must not count as owned. A real item_owned
               -- row for the id still counts in the branch above.
             ) u
             WHERE item_id IS NOT NULL AND item_id <> ''
           ) d
         $own$`,
        `INSERT INTO game.hub_gate (gate_id, action_type, target, required_item_ids, require_all, enabled, locked_hint_pool)
         VALUES
           ('hub_arcade_vcoin_game', 'session', 'vcoin', ARRAY['hub_v_coin'], true, true, NULL),
           ('hub_quantum_door', 'zone', 'quantum_door', ARRAY['quantum_cell'], true, true, NULL),
           (
             'hub_hatchery',
             'portal',
             'hatchery',
             ARRAY['arc_the_remote', 'duel_time_spirit_potion', 'pb_space_goggles', 'hub_v_coin', 'hub_life_medal', 'quantum_cell'],
             true,
             true,
             NULL
           )
         ON CONFLICT (gate_id) DO NOTHING`,
        "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
        "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin'))",
        "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
        "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin'))",
      ],
    },
    {
      // V Coin. People's Bitcoin white rabbit / Bar beat (quest_way_out) on the verified
      // pb.quest_complete path, and only when pb_space_goggles is already on the owned union.
      // 0 Tickets / 0 Verse: no event_rule tickets row and no verse write. Earn-once is
      // item_owned's primary key plus ON CONFLICT DO NOTHING.
      // apply_event is 0031_story_boss_tickets' body plus the hub_v_coin predicate in eligible.
      id: "0035_hub_v_coin",
      statements: [
        `INSERT INTO game.item_rule (game_id, event_type, item_id, match)
         VALUES ('peoples-bitcoin', 'pb.quest_complete', 'hub_v_coin', '{"questId":"quest_way_out"}'::jsonb)
         ON CONFLICT (game_id, event_type, item_id) DO NOTHING`,
        `CREATE OR REPLACE FUNCTION game.apply_event(
           p_user_id uuid,
           p_session_id uuid,
           p_game_id text,
           p_event_id text,
           p_data jsonb,
           p_idem_key text,
           p_req_hash text,
           p_seq bigint DEFAULT NULL
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_response jsonb;
           v_hash bytea;
           v_existing_hash bytea;
           v_relic text;
           v_last bigint;
           v_pay bigint;
           v_credit jsonb;
           v_items json;
           v_day_limit integer;
           v_rule_match jsonb;
           v_boss text;
           v_rule_bucket text;
           v_rule_day date;
           v_used bigint;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
           v_hash := decode(p_req_hash, 'hex');
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF FOUND THEN
             IF v_existing_hash <> v_hash THEN
               RETURN jsonb_build_object('error', 'idempotency_mismatch');
             END IF;
             RETURN v_response;
           END IF;
           SELECT event_seq INTO v_last
           FROM game.game_session
           WHERE session_id = p_session_id
             AND user_id = p_user_id
             AND game_id = p_game_id
             AND state = 'open'
             AND lease_until > now()
             AND ticket_redeemed_at IS NOT NULL
           FOR UPDATE;
           IF NOT FOUND THEN
             RETURN jsonb_build_object('error', 'session_closed');
           END IF;
           IF p_seq IS NOT NULL THEN
             IF v_last > 0 AND p_seq = v_last THEN
               RETURN jsonb_build_object('error', 'seq_duplicate');
             ELSIF p_seq <> v_last + 1 THEN
               RETURN jsonb_build_object('error', 'seq_stale');
             END IF;
           END IF;
           -- Most specific match wins. Boss rows are disjoint; the extra order
           -- keeps a broader row from beating a boss row if one is added later.
           v_rule_bucket := NULL;
           SELECT tickets, day_limit, match
             INTO v_pay, v_day_limit, v_rule_match
           FROM game.event_rule
           WHERE game_id = p_game_id
             AND event_type = p_event_id
             AND tickets IS NOT NULL
             AND tickets > 0
             AND match <@ COALESCE(p_data, '{}'::jsonb)
           ORDER BY cardinality(ARRAY(SELECT jsonb_object_keys(match))) DESC
           LIMIT 1;
           IF v_pay IS NOT NULL AND v_pay > 0 AND v_day_limit IS NOT NULL THEN
             v_boss := v_rule_match->>'boss';
             IF v_boss IS NULL OR v_boss = '' THEN
               v_pay := NULL;
             ELSE
               v_rule_day := (now() AT TIME ZONE 'utc')::date;
               v_rule_bucket := 'boss:' || p_game_id || ':' || v_boss;
               SELECT amount INTO v_used FROM game.earn_window
               WHERE user_id = p_user_id AND bucket = v_rule_bucket AND day = v_rule_day;
               IF COALESCE(v_used, 0) >= v_day_limit THEN
                 v_pay := NULL;
                 v_rule_bucket := NULL;
               END IF;
             END IF;
           END IF;
           IF v_pay IS NOT NULL AND v_pay > 0 THEN
             PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
             v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_pay, p_event_id, 'earn', false);
             IF v_credit ? 'error' THEN
               IF v_credit->>'error' IN ('session_ticket_cap', 'daily_ticket_cap') THEN
                 v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
                 RETURN v_credit || jsonb_build_object('relic_granted', v_relic IS NOT NULL);
               END IF;
               RETURN v_credit;
             END IF;
             IF v_rule_bucket IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
               INSERT INTO game.earn_window (user_id, bucket, day, amount)
               VALUES (p_user_id, v_rule_bucket, v_rule_day, 1)
               ON CONFLICT (user_id, bucket, day) DO UPDATE
                 SET amount = game.earn_window.amount + 1
               WHERE game.earn_window.amount < v_day_limit;
             END IF;
           END IF;
           IF p_seq IS NOT NULL THEN
             UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
           END IF;
           v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
           v_response := '{}'::jsonb;
           IF v_relic IS NOT NULL THEN
             v_response := jsonb_build_object('granted', v_relic);
           END IF;
           IF v_credit IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
             v_response := v_response || jsonb_build_object('tickets', (v_credit->>'applied')::bigint);
           END IF;
           -- M6 item grant (docs/m6-server-prep.md). Same transaction as the relic claim, before the
           -- idempotency insert, so a replay of this key returns the stored granted_items.
           -- Keep the pairs, the excluded ids and the item_rule seeds in step with HubItems in item_grant.ts.
           WITH sess AS (
             -- The relic session check above (already locked); item_grant.ts inlines the same predicate.
             SELECT event_seq FROM game.game_session
             WHERE session_id = p_session_id
               AND user_id = p_user_id
               AND game_id = p_game_id
               AND state = 'open'
               AND lease_until > now()
               AND ticket_redeemed_at IS NOT NULL
             FOR UPDATE
           ),
           eligible AS (
             SELECT r.item_id FROM game.item_rule r
             WHERE EXISTS (SELECT 1 FROM sess)
               AND (
                 (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
                 OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
                 OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
                 OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
               )
               AND r.game_id = p_game_id AND r.event_type = p_event_id
               AND r.event_type <> 'game_beaten'
               AND r.match <> '{}'::jsonb
               AND r.match <@ COALESCE(p_data, '{}'::jsonb)
               AND r.item_id NOT IN (
                 'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown',
                 'tidebreaker_belt', 'breakwater_coin',
                 'pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto'
               )
               -- 0035: hub_v_coin also requires pb_space_goggles on the owned union.
               AND (
                 r.item_id <> 'hub_v_coin'
                 OR 'pb_space_goggles' = ANY (game.owned_item_ids(p_user_id))
               )
               AND EXISTS (
                 SELECT 1 FROM game.event_rule e
                 WHERE e.game_id = r.game_id AND e.event_type = r.event_type
                   AND e.event_type <> 'game_beaten'
               )
           ),
           ins AS (
             INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
             SELECT p_user_id, item_id, 'event', gen_random_uuid() FROM eligible
             ON CONFLICT (user_id, item_id) DO NOTHING
             RETURNING item_id, ref_id
           ),
           led AS (
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             SELECT ref_id, p_user_id, 'grant_item', item_id, 'event', ref_id FROM ins
             RETURNING item_id
           )
           SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json) INTO v_items FROM led;
           v_response := COALESCE(v_response, '{}'::jsonb)
             || jsonb_build_object('granted_items', COALESCE(v_items, '[]'::json));
           INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
           VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
           RETURN v_response;
         EXCEPTION WHEN unique_violation THEN
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF NOT FOUND THEN
             RAISE;
           END IF;
           IF v_existing_hash <> v_hash THEN
             RETURN jsonb_build_object('error', 'idempotency_mismatch');
           END IF;
           RETURN v_response;
         END;
         $fn$`,
      ],
    },
    {
      // Life Medal. Earn-once, 0 Tickets, 0 Verse. No effect except hub_hatchery membership
      // once the row is live, and a place on the shelf (the owned-item list from
      // game.owned_item_ids). There is no item_def table; this item_rule is the definition.
      // grant_hold sends the insert to item_owned_pending (0033 trigger). A pending row is
      // excluded from owned_item_ids, so checkGate stays fail-closed until promotion.
      id: "0037_hub_life_medal",
      statements: [
        `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount, rule_key, grant_hold)
         VALUES ('hpos10i', 'hpos10i.boss_defeated', NULL, NULL, NULL, NULL, '{"boss":"deathbot"}'::jsonb, NULL, 'deathbot', false)
         ON CONFLICT (game_id, event_type, rule_key) DO NOTHING`,
        `INSERT INTO game.item_rule (game_id, event_type, item_id, match, grant_hold)
         VALUES ('hpos10i', 'hpos10i.boss_defeated', 'hub_life_medal', '{"boss":"deathbot"}'::jsonb, true)
         ON CONFLICT (game_id, event_type, item_id) DO UPDATE SET grant_hold = EXCLUDED.grant_hold`,
        `CREATE OR REPLACE FUNCTION game.owned_item_ids(p_user_id uuid)
         RETURNS text[]
         LANGUAGE sql
         STABLE
         AS $own$
           SELECT COALESCE(array_agg(item_id ORDER BY item_id), ARRAY[]::text[])
           FROM (
             SELECT DISTINCT item_id FROM (
               SELECT 'duel_staff_sproto'::text AS item_id
               UNION ALL
               SELECT v.item_id
               FROM (VALUES
                 ('nobu_clown_collar', 'hpos10i_core'),
                 ('pb_summon_speed_sproto', 'hpos10i_core'),
                 ('duel_staff_momentum', 'hpos10i_core'),
                 ('pet_speed_sproto', 'hpos10i_core'),
                 ('hpos_skin_golden_sproto', 'genesis_shard'),
                 ('nobu_golden_collar', 'genesis_shard'),
                 ('duel_staff_moonward', 'genesis_shard'),
                 ('hpos_skin_nobu', 'cones_tip'),
                 ('pb_summon_nobu', 'cones_tip'),
                 ('duel_staff_nobu', 'cones_tip'),
                 ('pet_nobu', 'cones_tip'),
                 ('pb_summon_duelist_sproto', 'tinubu_crown'),
                 ('nobu_wizard_hat', 'tinubu_crown'),
                 ('hpos_cape_duelist', 'tinubu_crown'),
                 ('pet_duelist_sproto', 'tinubu_crown'),
                 ('duel_staff_fighters_might', 'tidebreaker_belt'),
                 ('nobu_champions_crown', 'tidebreaker_belt'),
                 ('pb_summon_champion_sproto', 'tidebreaker_belt'),
                 ('hpos_skin_tidebreaker', 'tidebreaker_belt')
               ) AS v(item_id, relic_id)
               WHERE EXISTS (
                 SELECT 1 FROM game.relic_claim c
                 WHERE c.user_id = p_user_id AND c.relic_id = v.relic_id
               )
               UNION ALL
               SELECT o.item_id
               FROM game.item_owned o
               WHERE o.user_id = p_user_id
               -- quantum_cell is keepsake-derived from NOBU rematch pieces. Those piece ids are
               -- not in this repo. An empty piece list must not count as owned. A real item_owned
               -- row for the id still counts in the branch above.
             ) u
             WHERE item_id IS NOT NULL AND item_id <> ''
               AND NOT EXISTS (
                 SELECT 1 FROM game.item_owned_pending p
                 WHERE p.user_id = p_user_id AND p.item_id = u.item_id
               )
           ) d
         $own$`,
        `CREATE OR REPLACE FUNCTION game.apply_event(
           p_user_id uuid,
           p_session_id uuid,
           p_game_id text,
           p_event_id text,
           p_data jsonb,
           p_idem_key text,
           p_req_hash text,
           p_seq bigint DEFAULT NULL
         ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
         DECLARE
           v_response jsonb;
           v_hash bytea;
           v_existing_hash bytea;
           v_relic text;
           v_last bigint;
           v_pay bigint;
           v_credit jsonb;
           v_items json;
           v_day_limit integer;
           v_rule_match jsonb;
           v_boss text;
           v_rule_bucket text;
           v_rule_day date;
           v_used bigint;
         BEGIN
           PERFORM pg_advisory_xact_lock(hashtextextended('event:' || p_user_id::text, 0));
           v_hash := decode(p_req_hash, 'hex');
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF FOUND THEN
             IF v_existing_hash <> v_hash THEN
               RETURN jsonb_build_object('error', 'idempotency_mismatch');
             END IF;
             RETURN v_response;
           END IF;
           SELECT event_seq INTO v_last
           FROM game.game_session
           WHERE session_id = p_session_id
             AND user_id = p_user_id
             AND game_id = p_game_id
             AND state = 'open'
             AND lease_until > now()
             AND ticket_redeemed_at IS NOT NULL
           FOR UPDATE;
           IF NOT FOUND THEN
             RETURN jsonb_build_object('error', 'session_closed');
           END IF;
           IF p_seq IS NOT NULL THEN
             IF v_last > 0 AND p_seq = v_last THEN
               RETURN jsonb_build_object('error', 'seq_duplicate');
             ELSIF p_seq <> v_last + 1 THEN
               RETURN jsonb_build_object('error', 'seq_stale');
             END IF;
           END IF;
           -- Most specific match wins. Boss rows are disjoint; the extra order
           -- keeps a broader row from beating a boss row if one is added later.
           v_rule_bucket := NULL;
           SELECT tickets, day_limit, match
             INTO v_pay, v_day_limit, v_rule_match
           FROM game.event_rule
           WHERE game_id = p_game_id
             AND event_type = p_event_id
             AND tickets IS NOT NULL
             AND tickets > 0
             AND match <@ COALESCE(p_data, '{}'::jsonb)
           ORDER BY cardinality(ARRAY(SELECT jsonb_object_keys(match))) DESC
           LIMIT 1;
           IF v_pay IS NOT NULL AND v_pay > 0 AND v_day_limit IS NOT NULL THEN
             v_boss := v_rule_match->>'boss';
             IF v_boss IS NULL OR v_boss = '' THEN
               v_pay := NULL;
             ELSE
               v_rule_day := (now() AT TIME ZONE 'utc')::date;
               v_rule_bucket := 'boss:' || p_game_id || ':' || v_boss;
               SELECT amount INTO v_used FROM game.earn_window
               WHERE user_id = p_user_id AND bucket = v_rule_bucket AND day = v_rule_day;
               IF COALESCE(v_used, 0) >= v_day_limit THEN
                 v_pay := NULL;
                 v_rule_bucket := NULL;
               END IF;
             END IF;
           END IF;
           IF v_pay IS NOT NULL AND v_pay > 0 THEN
             PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
             v_credit := game.take_ticket_credit(p_user_id, p_session_id, p_game_id, v_pay, p_event_id, 'earn', false);
             IF v_credit ? 'error' THEN
               IF v_credit->>'error' IN ('session_ticket_cap', 'daily_ticket_cap') THEN
                 v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
                 RETURN v_credit || jsonb_build_object('relic_granted', v_relic IS NOT NULL);
               END IF;
               RETURN v_credit;
             END IF;
             IF v_rule_bucket IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
               INSERT INTO game.earn_window (user_id, bucket, day, amount)
               VALUES (p_user_id, v_rule_bucket, v_rule_day, 1)
               ON CONFLICT (user_id, bucket, day) DO UPDATE
                 SET amount = game.earn_window.amount + 1
               WHERE game.earn_window.amount < v_day_limit;
             END IF;
           END IF;
           IF p_seq IS NOT NULL THEN
             UPDATE game.game_session SET event_seq = p_seq WHERE session_id = p_session_id;
           END IF;
           v_relic := game.claim_event_relic(p_user_id, p_session_id, p_game_id, p_event_id, p_data);
           v_response := '{}'::jsonb;
           IF v_relic IS NOT NULL THEN
             v_response := jsonb_build_object('granted', v_relic);
           END IF;
           IF v_credit IS NOT NULL AND COALESCE((v_credit->>'applied')::bigint, 0) > 0 THEN
             v_response := v_response || jsonb_build_object('tickets', (v_credit->>'applied')::bigint);
           END IF;
           -- M6 item grant (docs/m6-server-prep.md). Same transaction as the relic claim, before the
           -- idempotency insert, so a replay of this key returns the stored granted_items.
           -- Keep the pairs, the excluded ids and the item_rule seeds in step with HubItems in item_grant.ts.
           WITH sess AS (
             -- The relic session check above (already locked); item_grant.ts inlines the same predicate.
             SELECT event_seq FROM game.game_session
             WHERE session_id = p_session_id
               AND user_id = p_user_id
               AND game_id = p_game_id
               AND state = 'open'
               AND lease_until > now()
               AND ticket_redeemed_at IS NOT NULL
             FOR UPDATE
           ),
           eligible AS (
             SELECT r.item_id FROM game.item_rule r
             WHERE EXISTS (SELECT 1 FROM sess)
               AND (
                 (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
                 OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
                 OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
                 OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
                 -- 0037: Deathbot can match hub_life_medal. grant_hold diverts that insert to pending.
                 OR (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.boss_defeated')
               )
               AND r.game_id = p_game_id AND r.event_type = p_event_id
               AND r.event_type <> 'game_beaten'
               AND r.match <> '{}'::jsonb
               AND r.match <@ COALESCE(p_data, '{}'::jsonb)
               AND r.item_id NOT IN (
                 'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown',
                 'tidebreaker_belt', 'breakwater_coin',
                 'pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto'
               )
               -- 0035: hub_v_coin also requires pb_space_goggles on the owned union.
               AND (
                 r.item_id <> 'hub_v_coin'
                 OR 'pb_space_goggles' = ANY (game.owned_item_ids(p_user_id))
               )
               AND EXISTS (
                 SELECT 1 FROM game.event_rule e
                 WHERE e.game_id = r.game_id AND e.event_type = r.event_type
                   AND e.event_type <> 'game_beaten'
               )
           ),
           ins AS (
             INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
             SELECT p_user_id, item_id, 'event', gen_random_uuid() FROM eligible
             ON CONFLICT (user_id, item_id) DO NOTHING
             RETURNING item_id, ref_id
           ),
           led AS (
             INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
             SELECT ref_id, p_user_id, 'grant_item', item_id, 'event', ref_id FROM ins
             RETURNING item_id
           )
           SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json) INTO v_items FROM led;
           v_response := COALESCE(v_response, '{}'::jsonb)
             || jsonb_build_object('granted_items', COALESCE(v_items, '[]'::json));
           INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
           VALUES (p_user_id, p_idem_key, 'session.event', v_hash, v_response);
           RETURN v_response;
         EXCEPTION WHEN unique_violation THEN
           SELECT response, req_hash INTO v_response, v_existing_hash
           FROM game.idempotency
           WHERE user_id = p_user_id AND key = p_idem_key;
           IF NOT FOUND THEN
             RAISE;
           END IF;
           IF v_existing_hash <> v_hash THEN
             RETURN jsonb_build_object('error', 'idempotency_mismatch');
           END IF;
           RETURN v_response;
         END;
         $fn$`,
      ],
    },
  ];

  function migrationSource(statements: string[]): string {
    return statements.join("\n");
  }

  function sqlLiteral(value: string): string {
    return "'" + value.replace(/'/g, "''") + "'";
  }

  // One connection for the whole run. pg_advisory_lock blocks the other boot;
  // pg_advisory_xact_lock stays until commit, after the session unlock, so the
  // waiter sees the ledger rows. The fixed key is hub schema_migrations.
  var SCHEMA_LOCK_KEY = "872341";

  function statementExecute(id: string, statement: string): string {
    if (statement.indexOf("$hub_lock$") >= 0) {
      throw new Error("schema migration sql contains the wrapper tag: " + id);
    }
    var tag = "stmt";
    while (statement.indexOf("$" + tag + "$") >= 0) tag += "x";
    return "EXECUTE $" + tag + "$" + statement + "$" + tag + "$;\n";
  }

  function migrationNumber(id: string): number {
    var match = /^([0-9]+)_/.exec(id);
    if (!match) {
      throw new Error("schema migration id has no numeric prefix: " + id);
    }
    return parseInt(match[1], 10);
  }

  function lockedRunQuery(plans: { id: string; checksum: string; statements: string[] }[]): string {
    var ids: string[] = [];
    var codeValues: string[] = [];
    for (var i = 0; i < plans.length; i++) {
      ids.push(sqlLiteral(plans[i].id));
      codeValues.push("(" + migrationNumber(plans[i].id) + "::int, " + sqlLiteral(plans[i].id) + "::text)");
    }
    var sql = "DO $hub_lock$\nDECLARE\n  recorded text;\n  missing text;\n  out_of_order text;\n  highest text;\nBEGIN\n";
    sql += "PERFORM pg_advisory_lock(" + SCHEMA_LOCK_KEY + ");\n";
    sql += "PERFORM pg_advisory_xact_lock(" + SCHEMA_LOCK_KEY + ");\n";
    sql += "BEGIN\n";
    sql += "CREATE SCHEMA IF NOT EXISTS game;\n";
    sql += statementExecute("0001_schema_migrations", SCHEMA_MIGRATIONS_TABLE);
    sql += "SELECT id INTO missing FROM game.schema_migrations WHERE id <> ALL (ARRAY[" + ids.join(", ") + "]) LIMIT 1;\n";
    sql += "IF FOUND THEN\n  RAISE EXCEPTION 'schema migration recorded but missing from code: %', missing;\nEND IF;\n";
    sql += "SELECT string_agg(c.id, ', ' ORDER BY c.n), (\n";
    sql += "         SELECT id FROM game.schema_migrations\n";
    sql += "         WHERE split_part(id, '_', 1) ~ '^[0-9]+$'\n";
    sql += "         ORDER BY split_part(id, '_', 1)::int DESC\n";
    sql += "         LIMIT 1\n";
    sql += "       )\n";
    sql += "  INTO out_of_order, highest\n";
    sql += "  FROM (VALUES " + codeValues.join(", ") + ") AS c(n, id)\n";
    sql += " WHERE NOT EXISTS (SELECT 1 FROM game.schema_migrations m WHERE m.id = c.id)\n";
    sql += "   AND c.n < COALESCE((\n";
    sql += "         SELECT split_part(id, '_', 1)::int FROM game.schema_migrations\n";
    sql += "         WHERE split_part(id, '_', 1) ~ '^[0-9]+$'\n";
    sql += "         ORDER BY split_part(id, '_', 1)::int DESC\n";
    sql += "         LIMIT 1\n";
    sql += "       ), 0);\n";
    sql += "IF out_of_order IS NOT NULL THEN\n";
    sql += "  RAISE EXCEPTION 'unapplied schema migration % is older than the highest recorded migration %', out_of_order, highest;\n";
    sql += "END IF;\n";
    for (var p = 0; p < plans.length; p++) {
      var plan = plans[p];
      sql += "SELECT checksum INTO recorded FROM game.schema_migrations WHERE id = " + sqlLiteral(plan.id) + ";\n";
      sql += "IF FOUND THEN\n";
      sql += "  IF recorded IS DISTINCT FROM " + sqlLiteral(plan.checksum) + " THEN\n";
      sql += "    RAISE EXCEPTION 'schema migration checksum mismatch: " + plan.id + "';\n";
      sql += "  END IF;\n";
      sql += "ELSE\n";
      for (var s = 0; s < plan.statements.length; s++) {
        sql += statementExecute(plan.id, plan.statements[s]);
      }
      sql += "  INSERT INTO game.schema_migrations (id, checksum, applied_at) VALUES ("
        + sqlLiteral(plan.id) + ", " + sqlLiteral(plan.checksum) + ", now());\n";
      sql += "  RAISE NOTICE 'schema migration applied %', " + sqlLiteral(plan.id) + ";\n";
      sql += "END IF;\n";
    }
    sql += "PERFORM pg_advisory_unlock(" + SCHEMA_LOCK_KEY + ");\n";
    sql += "EXCEPTION WHEN OTHERS THEN\n";
    sql += "  PERFORM pg_advisory_unlock(" + SCHEMA_LOCK_KEY + ");\n";
    sql += "  RAISE;\n";
    sql += "END;\n";
    sql += "END\n$hub_lock$;";
    return sql;
  }

  function fail(logger: nkruntime.Logger, message: string): never {
    logger.error(message);
    throw new Error(message);
  }

  // Migrations registered by game files (src/games/*.ts) at load time.
  // Reserved id ranges (Contract C4): hub 0011-0012, peoples-bitcoin 0013-0019,
  // sproto 0020-0024, sproto-arcade 0025-0029. The hub's later entries take the next id above every
  // reserved range: 0030_m6_item_grants, 0031_story_boss_tickets, 0032_wager_online_qualify,
  // 0033_hold_client_relic_grants, 0034_hub_gate, 0035_hub_v_coin, 0037_hub_life_medal.
  // 0036 is reserved for NOBU treats and is not registered here. 0031 and 0032 keep those ids.
  // 0038 stays unregistered: an unmerged shooter patch proposed it, and this phase does not take it.
  // 0039_sproto_shooter_coop is registered from src/games/sproto_shooter.ts. It widens game_session
  // and auth_ticket only, and the new checks still list vcoin.
  // The runner refuses an unapplied id below the highest recorded one, so PRs merge and deploy in id order.
  var REGISTERED: SchemaMigration[] = [];

  /** Call at top level of a game file. apply() sorts every migration by numeric prefix and rejects duplicates. */
  export function register(m: { id: string; statements: string[] }): void {
    if (!m || typeof m.id !== "string" || !/^[0-9]+_[a-z0-9_]+$/.test(m.id)) {
      throw new Error("schema migration id must be <number>_<name>: " + String(m && m.id));
    }
    if (!m.statements || !m.statements.length) throw new Error("schema migration has no statements: " + m.id);
    REGISTERED.push({ id: m.id, statements: m.statements.slice() });
  }

  /** Every migration (hub + registered), sorted by numeric prefix. Throws on a duplicate id or number. */
  export function all(): { id: string; statements: string[] }[] {
    var list = MIGRATIONS.concat(REGISTERED);
    var ids: { [id: string]: boolean } = {};
    var numbers: { [n: string]: string } = {};
    var indexed: { n: number; i: number; m: SchemaMigration }[] = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i].id;
      if (ids[id]) throw new Error("duplicate schema migration id: " + id);
      ids[id] = true;
      var n = migrationNumber(id);
      if (numbers[String(n)]) throw new Error("duplicate schema migration number: " + id + " and " + numbers[String(n)]);
      numbers[String(n)] = id;
      indexed.push({ n: n, i: i, m: list[i] });
    }
    indexed.sort(function (a, b) {
      return a.n - b.n || a.i - b.i;
    });
    var out: { id: string; statements: string[] }[] = [];
    for (var j = 0; j < indexed.length; j++) out.push(indexed[j].m);
    return out;
  }

  export function apply(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    var plans: { id: string; checksum: string; statements: string[] }[] = [];
    var sorted: { id: string; statements: string[] }[];
    try {
      sorted = all();
    } catch (e) {
      fail(logger, String(e && (e as { message?: unknown }).message ? (e as { message: unknown }).message : e));
    }
    for (var i = 0; i < sorted.length; i++) {
      plans.push({
        id: sorted[i].id,
        checksum: nk.sha256Hash(migrationSource(sorted[i].statements)),
        statements: sorted[i].statements,
      });
    }

    try {
      nk.sqlExec(lockedRunQuery(plans), []);
    } catch (err) {
      logger.error(String(err));
      throw err;
    }
    logger.info("game schema ready");
  }
}
