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
      CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'pb', 'sproto')),
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
      CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'pb', 'sproto'))
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

    `CREATE OR REPLACE FUNCTION game.relic_for_event(p_game text, p_event text, p_data jsonb)
     RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
     DECLARE
       v_own text;
     BEGIN
       v_own := CASE p_game
         WHEN 'hpos10i' THEN 'hpos10i_core'
         WHEN 'pb' THEN 'genesis_shard'
         WHEN 'nobu' THEN 'cones_tip'
         WHEN 'sproto' THEN 'tinubu_crown'
         ELSE NULL
       END;
       IF v_own IS NULL OR p_event = 'ready' THEN
         RETURN NULL;
       END IF;
       IF p_event = 'game_beaten' THEN
         IF p_data ? 'relicId' AND p_data->>'relicId' <> v_own THEN
           RETURN NULL;
         END IF;
         RETURN v_own;
       END IF;
       IF p_event = 'hpos10i.level_complete' AND p_game = 'hpos10i'
          AND p_data->>'zone' = 'z1_retro_rush_hills'
          AND (p_data->'act') = '1'::jsonb THEN
         RETURN v_own;
       END IF;
       IF p_event = 'pb.quest_complete' AND p_game = 'pb'
          AND p_data->>'questId' = 'quest_tutorial' THEN
         RETURN v_own;
       END IF;
       IF p_event = 'nobu.boss_defeated' AND p_game = 'nobu'
          AND p_data->>'boss' = 'cone' THEN
         RETURN v_own;
       END IF;
       IF p_event = 'sproto.boss_defeated' AND p_game = 'sproto'
          AND p_data->>'boss' = 'tinubu' THEN
         RETURN v_own;
       END IF;
       RETURN NULL;
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

    `CREATE OR REPLACE FUNCTION game.apply_event(
       p_user_id uuid,
       p_session_id uuid,
       p_game_id text,
       p_event_id text,
       p_data jsonb,
       p_idem_key text,
       p_req_hash text
     ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_response jsonb;
       v_hash bytea;
       v_existing_hash bytea;
       v_relic text;
       v_event uuid;
       v_inserted int;
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
       IF NOT EXISTS (
         SELECT 1 FROM game.game_session
         WHERE session_id = p_session_id
           AND user_id = p_user_id
           AND game_id = p_game_id
           AND state = 'open'
           AND lease_until > now()
           AND ticket_redeemed_at IS NOT NULL
       ) THEN
         RETURN jsonb_build_object('error', 'session_closed');
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
       v_response := jsonb_build_object('verse', v_wallet, 'ticketsLeft', v_tickets, 'receiptId', v_receipt);
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

    "DROP TRIGGER IF EXISTS item_ledger_append_only ON game.item_ledger",
    "CREATE TRIGGER item_ledger_append_only BEFORE UPDATE OR DELETE ON game.item_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "DROP TRIGGER IF EXISTS tickets_ledger_append_only ON game.tickets_ledger",
    "CREATE TRIGGER tickets_ledger_append_only BEFORE UPDATE OR DELETE ON game.tickets_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "DROP TRIGGER IF EXISTS verse_ledger_append_only ON game.verse_ledger",
    "CREATE TRIGGER verse_ledger_append_only BEFORE UPDATE OR DELETE ON game.verse_ledger FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
  ];

  export function apply(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    for (var i = 0; i < STATEMENTS.length; i++) {
      nk.sqlExec(STATEMENTS[i], []);
    }
    logger.info("game schema ready");
  }
}
