namespace HubSchema {
  var STATEMENTS: string[] = [
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
      kind text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    "ALTER TABLE game.tickets_ledger ADD COLUMN IF NOT EXISTS kind text",
    "ALTER TABLE game.tickets_ledger DROP CONSTRAINT IF EXISTS tickets_ledger_kind",
    "ALTER TABLE game.tickets_ledger ADD CONSTRAINT tickets_ledger_kind CHECK (kind IS NULL OR kind IN ('earn', 'exchange', 'spend', 'shop_sell'))",

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

    `CREATE TABLE IF NOT EXISTS game.shop_price (
      game text NOT NULL,
      item_id text NOT NULL,
      price integer,
      sell_price integer NOT NULL,
      PRIMARY KEY (game, item_id),
      CONSTRAINT shop_price_sell CHECK (sell_price < price OR price IS NULL),
      CONSTRAINT shop_price_nonneg CHECK (sell_price >= 0 AND (price IS NULL OR price >= 0))
    )`,

    // TODO: placeholder rows. Replace server/data/shop_price.peoples-bitcoin.json and rebuild.
    // Stored game id is pb. A null price can be sold and is not in stock.
    HubShop.seedSql(),

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
         VALUES (v_event, p_user_id, p_game_id, v_applied, v_balance, p_reason, p_session_id, 'earn');
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

    `CREATE OR REPLACE FUNCTION game.spend_tickets(
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_item_id text, p_qty bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_unit integer;
       v_price bigint;
       v_balance bigint;
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
       SELECT price INTO v_unit FROM game.shop_price
       WHERE game = p_game_id AND item_id = p_item_id;
       IF NOT FOUND OR v_unit IS NULL THEN
         RETURN jsonb_build_object('error', 'unknown_item');
       END IF;
       IF v_unit > 0 AND p_qty > (9223372036854775807::bigint / v_unit::bigint) THEN
         RETURN jsonb_build_object('error', 'bad_amount');
       END IF;
       v_price := v_unit::bigint * p_qty;
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id
       FOR UPDATE;
       IF NOT FOUND THEN v_balance := 0; END IF;
       -- balance = earned - spent - exchanged + sold, kept equal to the ledger sum.
       IF v_balance < v_price THEN
         RETURN jsonb_build_object('error', 'insufficient_tickets');
       END IF;
       UPDATE game.tickets_balance SET balance = balance - v_price
       WHERE user_id = p_user_id AND game_id = p_game_id
       RETURNING balance INTO v_balance;
       IF NOT FOUND THEN
         INSERT INTO game.tickets_balance (user_id, game_id, balance)
         VALUES (p_user_id, p_game_id, 0)
         RETURNING balance INTO v_balance;
       END IF;
       v_event := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (v_event, p_user_id, p_game_id, -v_price, v_balance, 'spend', p_session_id, 'spend');
       v_response := jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'spent', v_price, 'balance', v_balance);
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
       p_user_id uuid, p_session_id uuid, p_game_id text,
       p_item_id text, p_qty bigint, p_idem_key text, p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_unit integer;
       v_credit bigint;
       v_balance bigint;
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
       SELECT sell_price INTO v_unit FROM game.shop_price
       WHERE game = p_game_id AND item_id = p_item_id;
       IF NOT FOUND THEN
         RETURN jsonb_build_object('error', 'unknown_item');
       END IF;
       -- Shop sales are not earns: they skip session_ticket_cap and the daily earn window.
       IF v_unit > 0 AND p_qty > (9223372036854775807::bigint / v_unit::bigint) THEN
         RETURN jsonb_build_object('error', 'bad_amount');
       END IF;
       v_credit := v_unit::bigint * p_qty;
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id
       FOR UPDATE;
       IF NOT FOUND THEN
         INSERT INTO game.tickets_balance (user_id, game_id, balance)
         VALUES (p_user_id, p_game_id, v_credit)
         RETURNING balance INTO v_balance;
       ELSE
         UPDATE game.tickets_balance SET balance = balance + v_credit
         WHERE user_id = p_user_id AND game_id = p_game_id
         RETURNING balance INTO v_balance;
       END IF;
       v_event := gen_random_uuid();
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (v_event, p_user_id, p_game_id, v_credit, v_balance, 'shop_sell', p_session_id, 'shop_sell');
       v_response := jsonb_build_object('item_id', p_item_id, 'qty', p_qty, 'credited', v_credit, 'balance', v_balance);
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

    // Rename legacy `pb` rows to `peoples-bitcoin`. The seed above already
    // inserts the new id, so drop or merge leftovers instead of UPDATE-into-PK.
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "UPDATE game.game_session SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))",
    "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
    "DELETE FROM game.game_beaten AS old USING game.game_beaten AS neu WHERE old.game_id = 'pb' AND neu.game_id = 'peoples-bitcoin' AND old.user_id = neu.user_id",
    "UPDATE game.game_beaten SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'))",
    "DELETE FROM game.tickets_balance AS old USING game.tickets_balance AS neu WHERE old.game_id = 'pb' AND neu.game_id = 'peoples-bitcoin' AND old.user_id = neu.user_id",
    "UPDATE game.tickets_balance SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tickets_ledger_append_only') THEN
         ALTER TABLE game.tickets_ledger DISABLE TRIGGER tickets_ledger_append_only;
       END IF;
     END $$`,
    "UPDATE game.tickets_ledger SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tickets_ledger_append_only') THEN
         ALTER TABLE game.tickets_ledger ENABLE TRIGGER tickets_ledger_append_only;
       END IF;
     END $$`,
    "DELETE FROM game.verse_earned AS old USING game.verse_earned AS neu WHERE old.game_id = 'pb' AND neu.game_id = 'peoples-bitcoin' AND old.user_id = neu.user_id",
    "UPDATE game.verse_earned SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    "UPDATE game.exchange_tx SET game_id = 'peoples-bitcoin' WHERE game_id = 'pb'",
    "DELETE FROM game.earn_window AS old USING game.earn_window AS neu WHERE old.bucket IN ('tickets:pb', 'verse:pb') AND neu.bucket = replace(old.bucket, ':pb', ':peoples-bitcoin') AND old.user_id = neu.user_id AND old.day = neu.day",
    "UPDATE game.earn_window SET bucket = 'tickets:peoples-bitcoin' WHERE bucket = 'tickets:pb'",
    "UPDATE game.earn_window SET bucket = 'verse:peoples-bitcoin' WHERE bucket = 'verse:pb'",
    "DELETE FROM game.event_rule WHERE game_id = 'pb'",
  ];

  export function apply(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    for (var i = 0; i < STATEMENTS.length; i++) {
      nk.sqlExec(STATEMENTS[i], []);
    }
    logger.info("game schema ready");
  }
}
