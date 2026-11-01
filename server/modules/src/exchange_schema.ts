// Migration 0004: $BITCOIN <-> Verse exchange. Design: docs/crypto-exchange-design.md.
//
// 1 Verse = 1 whole $BITCOIN. Deposits from a linked wallet credit Verse; cash-out debits
// Verse and issues a voucher that the ownerless VerseCashout contract pays. Every limit is
// enforced here, never on chain. Safe defaults: every switch is off and every limit is 0
// until an operator sets them with game.economy_config_set.
//
// Functions the chain service calls are SECURITY DEFINER and granted only to the
// hub_chain role, so the service can run as a login that has no other rights.
namespace HubExchangeSchema {
  export var STATEMENTS: string[] = [
    `CREATE TABLE game.chain_config (
      chain text PRIMARY KEY CHECK (chain IN ('eth')),
      chain_id bigint NOT NULL CHECK (chain_id > 0),
      token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
      token_decimals integer CHECK (token_decimals BETWEEN 0 AND 36),
      deposit_address text CHECK (deposit_address ~ '^0x[0-9a-f]{40}$'),
      cashout_address text CHECK (cashout_address ~ '^0x[0-9a-f]{40}$'),
      deposits_enabled boolean NOT NULL DEFAULT false,
      vouchers_enabled boolean NOT NULL DEFAULT false,
      global_daily_verse bigint NOT NULL DEFAULT 0 CHECK (global_daily_verse >= 0),
      hourly_release boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    `INSERT INTO game.chain_config (chain, chain_id, token_address)
     VALUES ('eth', 1, '0x72e4f9f808c49a2a61de9c5896298920dc4eeea9')`,

    `CREATE TABLE game.economy_config (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      account_daily_verse bigint NOT NULL DEFAULT 0 CHECK (account_daily_verse >= 0),
      ref_usd_per_token numeric CHECK (ref_usd_per_token > 0),
      price_alert_usd numeric CHECK (price_alert_usd > 0),
      voucher_ttl interval NOT NULL DEFAULT interval '30 days' CHECK (voucher_ttl > interval '0'),
      link_hold interval NOT NULL DEFAULT interval '72 hours' CHECK (link_hold >= interval '0'),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    "INSERT INTO game.economy_config (singleton) VALUES (true)",

    `CREATE TABLE game.economy_config_log (
      seq bigserial PRIMARY KEY,
      set_by text NOT NULL,
      before jsonb NOT NULL,
      after jsonb NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE game.wallet_link (
      user_id uuid NOT NULL,
      chain text NOT NULL REFERENCES game.chain_config (chain),
      address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
      linked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, chain),
      UNIQUE (chain, address)
    )`,

    `CREATE TABLE game.wallet_link_log (
      seq bigserial PRIMARY KEY,
      user_id uuid NOT NULL,
      chain text NOT NULL,
      address text NOT NULL,
      op text NOT NULL CHECK (op IN ('link', 'unlink')),
      reason text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE game.link_nonce (
      nonce text PRIMARY KEY,
      user_id uuid NOT NULL,
      chain text NOT NULL REFERENCES game.chain_config (chain),
      address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    )`,

    "CREATE INDEX link_nonce_user ON game.link_nonce (user_id, created_at)",

    `CREATE TABLE game.deposit (
      deposit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      chain text NOT NULL REFERENCES game.chain_config (chain),
      tx_hash text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
      log_index integer NOT NULL CHECK (log_index >= 0),
      block_number bigint NOT NULL CHECK (block_number >= 0),
      from_address text NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
      amount numeric(78, 0) NOT NULL CHECK (amount > 0),
      status text NOT NULL CHECK (status IN ('credited', 'unmatched', 'held')),
      user_id uuid,
      verse bigint CHECK (verse >= 0),
      seen_at timestamptz NOT NULL DEFAULT now(),
      credited_at timestamptz,
      UNIQUE (chain, tx_hash, log_index),
      CHECK ((status = 'credited') = (user_id IS NOT NULL AND verse IS NOT NULL AND credited_at IS NOT NULL))
    )`,

    "CREATE INDEX deposit_pending ON game.deposit (chain, from_address) WHERE status <> 'credited'",

    `CREATE TABLE game.deposit_dust (
      user_id uuid NOT NULL,
      chain text NOT NULL REFERENCES game.chain_config (chain),
      amount numeric(78, 0) NOT NULL CHECK (amount >= 0),
      PRIMARY KEY (user_id, chain)
    )`,

    `CREATE TABLE game.purchase_intent (
      intent_id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 64),
      verse_price bigint NOT NULL CHECK (verse_price > 0),
      chain text NOT NULL REFERENCES game.chain_config (chain),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired')),
      deposit_id uuid REFERENCES game.deposit (deposit_id),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      paid_at timestamptz
    )`,

    "CREATE INDEX purchase_intent_open ON game.purchase_intent (user_id, chain, created_at) WHERE status = 'open'",

    `CREATE TABLE game.withdrawal (
      id bigserial PRIMARY KEY,
      user_id uuid NOT NULL,
      chain text NOT NULL REFERENCES game.chain_config (chain),
      chain_id bigint NOT NULL,
      cashout_address text NOT NULL CHECK (cashout_address ~ '^0x[0-9a-f]{40}$'),
      recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
      amount bigint NOT NULL CHECK (amount > 0),
      expiry timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('issued', 'signed', 'claimed', 'refunded')),
      signature text CHECK (signature ~ '^0x[0-9a-f]{130}$'),
      idem_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      signed_at timestamptz,
      claimed_at timestamptz,
      claim_tx text,
      refunded_at timestamptz,
      UNIQUE (user_id, idem_key),
      CHECK (expiry = date_trunc('second', expiry)),
      CHECK ((status IN ('signed', 'claimed')) <= (signature IS NOT NULL)),
      CHECK ((status = 'claimed') = (claim_tx IS NOT NULL)),
      CHECK ((status = 'refunded') <= (refunded_at IS NOT NULL))
    )`,

    "CREATE INDEX withdrawal_open ON game.withdrawal (chain, cashout_address, expiry) WHERE status IN ('issued', 'signed')",
    "CREATE INDEX withdrawal_user ON game.withdrawal (user_id, created_at DESC)",

    `CREATE TABLE game.withdrawal_log (
      seq bigserial PRIMARY KEY,
      withdrawal_id bigint NOT NULL,
      status text NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE game.payout_window (
      chain text NOT NULL REFERENCES game.chain_config (chain),
      day date NOT NULL,
      amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
      PRIMARY KEY (chain, day)
    )`,

    `CREATE TABLE game.chain_cursor (
      chain text NOT NULL REFERENCES game.chain_config (chain),
      stream text NOT NULL CHECK (stream IN ('deposits', 'claims')),
      block_number bigint NOT NULL CHECK (block_number >= 0),
      block_time timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chain, stream)
    )`,

    `CREATE TABLE game.chain_alert (
      seq bigserial PRIMARY KEY,
      chain text NOT NULL,
      kind text NOT NULL,
      detail jsonb NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    )`,

    "CREATE TRIGGER economy_config_log_append_only BEFORE UPDATE OR DELETE ON game.economy_config_log FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "CREATE TRIGGER wallet_link_log_append_only BEFORE UPDATE OR DELETE ON game.wallet_link_log FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "CREATE TRIGGER withdrawal_log_append_only BEFORE UPDATE OR DELETE ON game.withdrawal_log FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",
    "CREATE TRIGGER chain_alert_append_only BEFORE UPDATE OR DELETE ON game.chain_alert FOR EACH ROW EXECUTE FUNCTION game.reject_mutation()",

    // A withdrawal row can only move forward through its states, and its voucher fields
    // (id, recipient, amount, expiry, contract, chain) never change once written.
    `CREATE FUNCTION game.withdrawal_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only'; END IF;
       IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.chain <> OLD.chain
          OR NEW.chain_id <> OLD.chain_id OR NEW.cashout_address <> OLD.cashout_address
          OR NEW.recipient <> OLD.recipient OR NEW.amount <> OLD.amount OR NEW.expiry <> OLD.expiry
          OR NEW.idem_key <> OLD.idem_key OR NEW.created_at <> OLD.created_at THEN
         RAISE EXCEPTION 'withdrawal_immutable';
       END IF;
       IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN
         RAISE EXCEPTION 'withdrawal_immutable';
       END IF;
       -- issued->claimed and refunded->claimed only happen on an alert path in claim_record.
       IF NOT ((OLD.status = 'issued' AND NEW.status IN ('signed', 'refunded', 'claimed'))
            OR (OLD.status = 'signed' AND NEW.status IN ('claimed', 'refunded'))
            OR (OLD.status = 'refunded' AND NEW.status = 'claimed')) THEN
         RAISE EXCEPTION 'withdrawal_transition %->%', OLD.status, NEW.status;
       END IF;
       RETURN NEW;
     END;
     $fn$`,

    "CREATE TRIGGER withdrawal_guard BEFORE UPDATE OR DELETE ON game.withdrawal FOR EACH ROW EXECUTE FUNCTION game.withdrawal_guard()",

    `CREATE FUNCTION game.utc_day() RETURNS date LANGUAGE sql STABLE AS $fn$
       SELECT (now() AT TIME ZONE 'utc')::date
     $fn$`,

    // Verse the global window has released so far today. With hourly release the daily
    // budget opens in 24 slices; unused budget rolls forward until 00:00 UTC.
    `CREATE FUNCTION game.global_released(p_daily bigint, p_hourly boolean) RETURNS bigint
     LANGUAGE sql STABLE AS $fn$
       SELECT CASE WHEN p_hourly
         THEN (p_daily * (extract(hour FROM now() AT TIME ZONE 'utc')::bigint + 1)) / 24
         ELSE p_daily END
     $fn$`,

    `CREATE FUNCTION game.economy_snapshot() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
       SELECT jsonb_build_object(
         'economy', (SELECT to_jsonb(e) - 'singleton' FROM game.economy_config e),
         'chains', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.chain) FROM game.chain_config c), '[]'::jsonb))
     $fn$`,

    // Operator control. p_patch keys: economy.* and chains.<chain>.* matching the column names.
    `CREATE FUNCTION game.economy_config_set(p_patch jsonb, p_by text) RETURNS jsonb
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_before jsonb;
       v_key text;
       v_val jsonb;
       v_chain text;
       v_ckey text;
       v_cval jsonb;
       v_econ text[] := ARRAY['account_daily_verse', 'ref_usd_per_token', 'price_alert_usd', 'voucher_ttl', 'link_hold'];
       v_cols text[] := ARRAY['chain_id', 'token_address', 'token_decimals', 'deposit_address', 'cashout_address',
                              'deposits_enabled', 'vouchers_enabled', 'global_daily_verse', 'hourly_release'];
     BEGIN
       IF p_by IS NULL OR length(p_by) = 0 THEN RAISE EXCEPTION 'config_set_by_required'; END IF;
       IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'config_patch_object'; END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended('economy_config', 0));
       v_before := game.economy_snapshot();
       FOR v_key, v_val IN SELECT * FROM jsonb_each(p_patch) LOOP
         IF v_key = 'economy' THEN
           FOR v_ckey, v_cval IN SELECT * FROM jsonb_each(v_val) LOOP
             IF NOT v_ckey = ANY (v_econ) THEN RAISE EXCEPTION 'config_unknown_key economy.%', v_ckey; END IF;
             EXECUTE format('UPDATE game.economy_config SET %I = ($1 #>> ''{}'')::%s, updated_at = now()',
               v_ckey, CASE WHEN v_ckey IN ('voucher_ttl', 'link_hold') THEN 'interval'
                            WHEN v_ckey = 'account_daily_verse' THEN 'bigint' ELSE 'numeric' END)
               USING v_cval;
           END LOOP;
         ELSIF v_key = 'chains' THEN
           FOR v_chain, v_val IN SELECT * FROM jsonb_each(v_val) LOOP
             IF NOT EXISTS (SELECT 1 FROM game.chain_config WHERE chain = v_chain) THEN
               RAISE EXCEPTION 'config_unknown_chain %', v_chain;
             END IF;
             FOR v_ckey, v_cval IN SELECT * FROM jsonb_each(v_val) LOOP
               IF NOT v_ckey = ANY (v_cols) THEN RAISE EXCEPTION 'config_unknown_key chains.%.%', v_chain, v_ckey; END IF;
               IF v_ckey = 'token_decimals' AND (SELECT token_decimals FROM game.chain_config WHERE chain = v_chain) IS NOT NULL
                  AND (SELECT token_decimals FROM game.chain_config WHERE chain = v_chain) <> (v_cval #>> '{}')::integer
                  AND EXISTS (SELECT 1 FROM game.deposit WHERE chain = v_chain) THEN
                 RAISE EXCEPTION 'config_decimals_locked';
               END IF;
               EXECUTE format('UPDATE game.chain_config SET %I = ($1 #>> ''{}'')::%s, updated_at = now() WHERE chain = $2',
                 v_ckey, CASE WHEN v_ckey IN ('deposits_enabled', 'vouchers_enabled', 'hourly_release') THEN 'boolean'
                              WHEN v_ckey IN ('chain_id', 'global_daily_verse') THEN 'bigint'
                              WHEN v_ckey = 'token_decimals' THEN 'integer' ELSE 'text' END)
                 USING CASE WHEN jsonb_typeof(v_cval) = 'string' AND v_ckey LIKE '%address'
                            THEN to_jsonb(lower(v_cval #>> '{}')) ELSE v_cval END, v_chain;
             END LOOP;
           END LOOP;
         ELSE
           RAISE EXCEPTION 'config_unknown_key %', v_key;
         END IF;
       END LOOP;
       INSERT INTO game.economy_config_log (set_by, before, after) VALUES (p_by, v_before, game.economy_snapshot());
       RETURN game.economy_snapshot();
     END;
     $fn$`,

    // wallet.nonce: the server writes the exact text the wallet signs.
    `CREATE FUNCTION game.link_nonce_create(p_user_id uuid, p_chain text, p_address text, p_domain text, p_uri text)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_nonce text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
       v_cfg game.chain_config;
       v_address text := lower(p_address);
       v_message text;
       v_now timestamptz := date_trunc('second', now());
       v_recent integer;
     BEGIN
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = p_chain;
       IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bad_chain'); END IF;
       IF v_address !~ '^0x[0-9a-f]{40}$' THEN RETURN jsonb_build_object('error', 'bad_address'); END IF;
       SELECT count(*) INTO v_recent FROM game.link_nonce
       WHERE user_id = p_user_id AND created_at > now() - interval '10 minutes';
       IF v_recent >= 10 THEN RETURN jsonb_build_object('error', 'rate_limited'); END IF;
       v_message := p_domain || ' wants you to sign in with your Ethereum account:' || chr(10)
         || p_address || chr(10) || chr(10)
         || 'Link this wallet to your Metaverse Hub account for HPOS10I $BITCOIN deposits and cash-out. '
         || 'This does not move any funds.' || chr(10) || chr(10)
         || 'URI: ' || p_uri || chr(10)
         || 'Version: 1' || chr(10)
         || 'Chain ID: ' || v_cfg.chain_id || chr(10)
         || 'Nonce: ' || v_nonce || chr(10)
         || 'Issued At: ' || to_char(v_now AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || chr(10)
         || 'Expiration Time: ' || to_char((v_now + interval '10 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || chr(10)
         || 'Request ID: ' || p_user_id::text;
       INSERT INTO game.link_nonce (nonce, user_id, chain, address, message, expires_at)
       VALUES (v_nonce, p_user_id, p_chain, v_address, v_message, v_now + interval '10 minutes');
       RETURN jsonb_build_object('nonce', v_nonce, 'message', v_message, 'address', v_address, 'chainId', v_cfg.chain_id);
     END;
     $fn$`,

    `CREATE FUNCTION game.link_nonce_get(p_user_id uuid, p_nonce text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
       SELECT jsonb_build_object('message', message, 'address', address, 'chain', chain)
       FROM game.link_nonce
       WHERE nonce = p_nonce AND user_id = p_user_id AND used_at IS NULL AND expires_at > now()
     $fn$`,

    // wallet.link after the signature over the stored message recovered to p_recovered.
    `CREATE FUNCTION game.wallet_link_apply(p_user_id uuid, p_nonce text, p_recovered text)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_n game.link_nonce;
       v_old game.wallet_link;
       v_owner uuid;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       SELECT * INTO v_n FROM game.link_nonce WHERE nonce = p_nonce FOR UPDATE;
       IF NOT FOUND OR v_n.user_id <> p_user_id OR v_n.used_at IS NOT NULL OR v_n.expires_at <= now() THEN
         RETURN jsonb_build_object('error', 'bad_nonce');
       END IF;
       UPDATE game.link_nonce SET used_at = now() WHERE nonce = p_nonce;
       IF lower(p_recovered) <> v_n.address THEN
         RETURN jsonb_build_object('error', 'bad_signature');
       END IF;
       PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || v_n.chain || ':' || v_n.address, 0));
       SELECT user_id INTO v_owner FROM game.wallet_link WHERE chain = v_n.chain AND address = v_n.address;
       IF FOUND AND v_owner <> p_user_id THEN
         RETURN jsonb_build_object('error', 'address_taken');
       END IF;
       SELECT * INTO v_old FROM game.wallet_link WHERE user_id = p_user_id AND chain = v_n.chain FOR UPDATE;
       IF FOUND AND v_old.address = v_n.address THEN
         RETURN jsonb_build_object('address', v_old.address, 'chain', v_old.chain, 'linkedAt', v_old.linked_at, 'changed', false);
       END IF;
       IF FOUND THEN
         DELETE FROM game.wallet_link WHERE user_id = p_user_id AND chain = v_n.chain;
         INSERT INTO game.wallet_link_log (user_id, chain, address, op, reason)
         VALUES (p_user_id, v_old.chain, v_old.address, 'unlink', 'replaced');
       END IF;
       INSERT INTO game.wallet_link (user_id, chain, address) VALUES (p_user_id, v_n.chain, v_n.address);
       INSERT INTO game.wallet_link_log (user_id, chain, address, op, reason)
       VALUES (p_user_id, v_n.chain, v_n.address, 'link', CASE WHEN v_old.address IS NULL THEN 'new' ELSE 'replace' END);
       RETURN jsonb_build_object('address', v_n.address, 'chain', v_n.chain, 'linkedAt', now(), 'changed', true);
     END;
     $fn$`,

    // wallet.withdraw: debit Verse and issue one voucher, inside both daily locks.
    `CREATE FUNCTION game.withdraw_verse(p_user_id uuid, p_chain text, p_amount bigint, p_idem_key text, p_req_hash text)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_hash bytea := decode(p_req_hash, 'hex');
       v_response jsonb;
       v_existing_hash bytea;
       v_cfg game.chain_config;
       v_econ game.economy_config;
       v_link game.wallet_link;
       v_day date := game.utc_day();
       v_used bigint;
       v_global_used bigint;
       v_released bigint;
       v_balance bigint;
       v_id bigint;
       v_expiry timestamptz;
     BEGIN
       PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
       SELECT response, req_hash INTO v_response, v_existing_hash
       FROM game.idempotency WHERE user_id = p_user_id AND key = p_idem_key;
       IF FOUND THEN
         IF v_existing_hash <> v_hash THEN RETURN jsonb_build_object('error', 'idempotency_mismatch'); END IF;
         RETURN v_response;
       END IF;
       IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'bad_amount'); END IF;
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = p_chain;
       IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bad_chain'); END IF;
       IF NOT v_cfg.vouchers_enabled OR v_cfg.cashout_address IS NULL OR v_cfg.token_decimals IS NULL THEN
         RETURN jsonb_build_object('error', 'cashout_closed');
       END IF;
       SELECT * INTO v_econ FROM game.economy_config;
       SELECT * INTO v_link FROM game.wallet_link WHERE user_id = p_user_id AND chain = p_chain;
       IF NOT FOUND THEN RETURN jsonb_build_object('error', 'no_wallet'); END IF;
       IF v_link.linked_at + v_econ.link_hold > now() THEN
         RETURN jsonb_build_object('error', 'wallet_hold', 'holdUntil', v_link.linked_at + v_econ.link_hold);
       END IF;
       SELECT balance INTO v_balance FROM game.verse_wallet WHERE user_id = p_user_id FOR UPDATE;
       IF NOT FOUND OR v_balance < p_amount THEN RETURN jsonb_build_object('error', 'insufficient_verse'); END IF;
       SELECT amount INTO v_used FROM game.earn_window WHERE user_id = p_user_id AND bucket = 'withdraw' AND day = v_day;
       IF NOT FOUND THEN v_used := 0; END IF;
       IF v_used + p_amount > v_econ.account_daily_verse THEN
         RETURN jsonb_build_object('error', 'account_limit', 'accountRoom', GREATEST(v_econ.account_daily_verse - v_used, 0));
       END IF;
       INSERT INTO game.payout_window (chain, day, amount) VALUES (p_chain, v_day, 0) ON CONFLICT DO NOTHING;
       SELECT amount INTO v_global_used FROM game.payout_window WHERE chain = p_chain AND day = v_day FOR UPDATE;
       v_released := game.global_released(v_cfg.global_daily_verse, v_cfg.hourly_release);
       IF v_global_used + p_amount > v_released THEN
         RETURN jsonb_build_object('error', 'global_limit', 'globalRoom', GREATEST(v_released - v_global_used, 0));
       END IF;
       UPDATE game.verse_wallet SET balance = balance - p_amount WHERE user_id = p_user_id RETURNING balance INTO v_balance;
       UPDATE game.payout_window SET amount = amount + p_amount WHERE chain = p_chain AND day = v_day;
       INSERT INTO game.earn_window (user_id, bucket, day, amount) VALUES (p_user_id, 'withdraw', v_day, p_amount)
       ON CONFLICT (user_id, bucket, day) DO UPDATE SET amount = game.earn_window.amount + EXCLUDED.amount;
       v_expiry := date_trunc('second', now() + v_econ.voucher_ttl);
       INSERT INTO game.withdrawal (user_id, chain, chain_id, cashout_address, recipient, amount, expiry, status, idem_key)
       VALUES (p_user_id, p_chain, v_cfg.chain_id, v_cfg.cashout_address, v_link.address, p_amount, v_expiry, 'issued', p_idem_key)
       RETURNING id INTO v_id;
       INSERT INTO game.withdrawal_log (withdrawal_id, status, detail) VALUES (v_id, 'issued', jsonb_build_object('amount', p_amount));
       INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
       VALUES (gen_random_uuid(), p_user_id, -p_amount, v_balance, 'withdraw:' || p_chain, NULL);
       v_response := jsonb_build_object('withdrawalId', v_id::text, 'amount', p_amount, 'recipient', v_link.address,
         'expiry', extract(epoch FROM v_expiry)::bigint, 'verse', v_balance,
         'accountRoom', v_econ.account_daily_verse - v_used - p_amount);
       INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
       VALUES (p_user_id, p_idem_key, 'wallet.withdraw', v_hash, v_response);
       RETURN v_response;
     END;
     $fn$`,

    // store.intent: earmark a $BITCOIN payment for an item. The item itself is granted by the
    // M7 store once it consumes 'paid' intents; until then the paid Verse stays in the wallet.
    `CREATE FUNCTION game.purchase_intent_create(p_user_id uuid, p_chain text, p_item_id text, p_verse_price bigint)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_cfg game.chain_config;
       v_id uuid := gen_random_uuid();
       v_expires timestamptz := date_trunc('second', now() + interval '30 minutes');
     BEGIN
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = p_chain;
       IF NOT FOUND THEN RETURN jsonb_build_object('error', 'bad_chain'); END IF;
       IF NOT v_cfg.deposits_enabled OR v_cfg.deposit_address IS NULL OR v_cfg.token_decimals IS NULL THEN
         RETURN jsonb_build_object('error', 'deposits_closed');
       END IF;
       IF NOT EXISTS (SELECT 1 FROM game.wallet_link WHERE user_id = p_user_id AND chain = p_chain) THEN
         RETURN jsonb_build_object('error', 'no_wallet');
       END IF;
       IF p_verse_price IS NULL OR p_verse_price <= 0 THEN RETURN jsonb_build_object('error', 'bad_amount'); END IF;
       UPDATE game.purchase_intent SET status = 'expired'
       WHERE user_id = p_user_id AND status = 'open' AND expires_at <= now();
       INSERT INTO game.purchase_intent (intent_id, user_id, item_id, verse_price, chain, expires_at)
       VALUES (v_id, p_user_id, p_item_id, p_verse_price, p_chain, v_expires);
       RETURN jsonb_build_object('intentId', v_id, 'itemId', p_item_id, 'versePrice', p_verse_price,
         'tokenAmount', (p_verse_price::numeric * (10::numeric ^ v_cfg.token_decimals))::numeric(78, 0)::text,
         'depositAddress', v_cfg.deposit_address, 'tokenAddress', v_cfg.token_address,
         'chainId', v_cfg.chain_id, 'expiresAt', extract(epoch FROM v_expires)::bigint);
     END;
     $fn$`,

    // Credits one deposit row to its linked account. Caller holds the account lock.
    `CREATE FUNCTION game.deposit_settle_one(p_deposit_id uuid, p_user_id uuid) RETURNS jsonb
     LANGUAGE plpgsql AS $fn$
     DECLARE
       v_d game.deposit;
       v_unit numeric;
       v_dust numeric;
       v_total numeric;
       v_verse bigint;
       v_balance bigint;
       v_intent uuid;
     BEGIN
       SELECT * INTO v_d FROM game.deposit WHERE deposit_id = p_deposit_id FOR UPDATE;
       IF v_d.status = 'credited' THEN RETURN jsonb_build_object('status', 'credited', 'verse', v_d.verse); END IF;
       SELECT 10::numeric ^ token_decimals INTO v_unit FROM game.chain_config WHERE chain = v_d.chain;
       SELECT amount INTO v_dust FROM game.deposit_dust WHERE user_id = p_user_id AND chain = v_d.chain FOR UPDATE;
       IF NOT FOUND THEN v_dust := 0; END IF;
       v_total := v_dust + v_d.amount;
       v_verse := floor(v_total / v_unit)::bigint;
       INSERT INTO game.deposit_dust (user_id, chain, amount) VALUES (p_user_id, v_d.chain, v_total - v_verse * v_unit)
       ON CONFLICT (user_id, chain) DO UPDATE SET amount = EXCLUDED.amount;
       IF v_verse > 0 THEN
         INSERT INTO game.verse_wallet (user_id, balance) VALUES (p_user_id, v_verse)
         ON CONFLICT (user_id) DO UPDATE SET balance = game.verse_wallet.balance + EXCLUDED.balance
         RETURNING balance INTO v_balance;
         INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
         VALUES (gen_random_uuid(), p_user_id, v_verse, v_balance, 'deposit:' || v_d.chain, v_d.deposit_id);
       END IF;
       UPDATE game.deposit SET status = 'credited', user_id = p_user_id, verse = v_verse, credited_at = now()
       WHERE deposit_id = v_d.deposit_id;
       SELECT intent_id INTO v_intent FROM game.purchase_intent
       WHERE user_id = p_user_id AND chain = v_d.chain AND status = 'open' AND expires_at > now()
         AND verse_price <= v_verse
       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
       IF FOUND THEN
         UPDATE game.purchase_intent SET status = 'paid', deposit_id = v_d.deposit_id, paid_at = now()
         WHERE intent_id = v_intent;
       END IF;
       RETURN jsonb_build_object('status', 'credited', 'verse', v_verse, 'intentId', v_intent);
     END;
     $fn$`,

    // Chain service: one finalized Transfer(from, depositAddress, value) log.
    `CREATE FUNCTION game.deposit_record(p_chain text, p_tx_hash text, p_log_index integer, p_block bigint,
                                         p_from text, p_amount numeric)
     RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_cfg game.chain_config;
       v_from text := lower(p_from);
       v_tx text := lower(p_tx_hash);
       v_user uuid;
       v_id uuid;
       v_status text;
     BEGIN
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = p_chain;
       IF NOT FOUND OR v_cfg.token_decimals IS NULL THEN RAISE EXCEPTION 'deposit_chain_not_configured'; END IF;
       IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'deposit_bad_amount'; END IF;
       SELECT deposit_id, status INTO v_id, v_status FROM game.deposit
       WHERE chain = p_chain AND tx_hash = v_tx AND log_index = p_log_index;
       IF FOUND THEN RETURN jsonb_build_object('depositId', v_id, 'status', v_status, 'duplicate', true); END IF;
       SELECT user_id INTO v_user FROM game.wallet_link WHERE chain = p_chain AND address = v_from;
       INSERT INTO game.deposit (chain, tx_hash, log_index, block_number, from_address, amount, status)
       VALUES (p_chain, v_tx, p_log_index, p_block, v_from, p_amount,
               CASE WHEN v_user IS NULL THEN 'unmatched' ELSE 'held' END)
       RETURNING deposit_id INTO v_id;
       IF v_user IS NOT NULL AND v_cfg.deposits_enabled THEN
         PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || v_user::text, 0));
         RETURN jsonb_build_object('depositId', v_id) || game.deposit_settle_one(v_id, v_user);
       END IF;
       RETURN jsonb_build_object('depositId', v_id, 'status', CASE WHEN v_user IS NULL THEN 'unmatched' ELSE 'held' END);
     END;
     $fn$`,

    // Chain service: credit held deposits (switch back on) and unmatched ones whose sender is now linked.
    `CREATE FUNCTION game.deposit_settle_pending(p_chain text, p_limit integer)
     RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_row record;
       v_n integer := 0;
     BEGIN
       IF NOT (SELECT deposits_enabled FROM game.chain_config WHERE chain = p_chain) THEN RETURN 0; END IF;
       FOR v_row IN
         SELECT d.deposit_id, l.user_id FROM game.deposit d
         JOIN game.wallet_link l ON l.chain = d.chain AND l.address = d.from_address
         WHERE d.chain = p_chain AND d.status IN ('unmatched', 'held')
         ORDER BY d.block_number, d.log_index LIMIT p_limit
       LOOP
         PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || v_row.user_id::text, 0));
         PERFORM game.deposit_settle_one(v_row.deposit_id, v_row.user_id);
         v_n := v_n + 1;
       END LOOP;
       RETURN v_n;
     END;
     $fn$`,

    // Voucher signer: vouchers waiting for a signature.
    `CREATE FUNCTION game.voucher_pending(p_chain text, p_limit integer)
     RETURNS TABLE (id bigint, chain_id bigint, cashout_address text, recipient text, amount bigint, expiry bigint)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
       SELECT w.id, w.chain_id, w.cashout_address, w.recipient, w.amount, extract(epoch FROM w.expiry)::bigint
       FROM game.withdrawal w
       WHERE w.chain = p_chain AND w.status = 'issued' AND w.expiry > now()
       ORDER BY w.id LIMIT p_limit
     $fn$`,

    // Voucher signer: store a signature. The signer passes back the fields it signed, so a
    // row that changed since voucher_pending can never be signed with stale values.
    `CREATE FUNCTION game.voucher_store_signature(p_id bigint, p_chain_id bigint, p_cashout text, p_recipient text,
                                                  p_amount bigint, p_expiry bigint, p_signature text)
     RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_w game.withdrawal;
       v_cfg game.chain_config;
       v_sig text := lower(p_signature);
     BEGIN
       SELECT * INTO v_w FROM game.withdrawal WHERE id = p_id FOR UPDATE;
       IF NOT FOUND THEN RAISE EXCEPTION 'voucher_unknown'; END IF;
       IF v_w.chain_id <> p_chain_id OR v_w.cashout_address <> lower(p_cashout) OR v_w.recipient <> lower(p_recipient)
          OR v_w.amount <> p_amount OR extract(epoch FROM v_w.expiry)::bigint <> p_expiry THEN
         RAISE EXCEPTION 'voucher_mismatch';
       END IF;
       IF v_w.status = 'signed' AND v_w.signature = v_sig THEN RETURN jsonb_build_object('status', 'signed'); END IF;
       IF v_w.status <> 'issued' THEN RETURN jsonb_build_object('status', v_w.status, 'skipped', true); END IF;
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = v_w.chain;
       IF NOT v_cfg.vouchers_enabled OR v_cfg.cashout_address IS DISTINCT FROM v_w.cashout_address THEN
         RETURN jsonb_build_object('status', 'issued', 'skipped', true);
       END IF;
       UPDATE game.withdrawal SET status = 'signed', signature = v_sig, signed_at = now() WHERE id = p_id;
       INSERT INTO game.withdrawal_log (withdrawal_id, status) VALUES (p_id, 'signed');
       RETURN jsonb_build_object('status', 'signed');
     END;
     $fn$`,

    // Watcher: a finalized Claimed(id, recipient, amount, tokens) event from a cashout contract.
    `CREATE FUNCTION game.claim_record(p_chain text, p_cashout text, p_id numeric, p_recipient text, p_amount numeric,
                                       p_tx_hash text, p_block bigint)
     RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_w game.withdrawal;
       v_detail jsonb := jsonb_build_object('cashout', lower(p_cashout), 'id', p_id::text, 'recipient', lower(p_recipient),
                                            'amount', p_amount::text, 'tx', lower(p_tx_hash), 'block', p_block);
     BEGIN
       IF p_id <= 9223372036854775807 THEN
         SELECT * INTO v_w FROM game.withdrawal WHERE id = p_id::bigint FOR UPDATE;
       END IF;
       IF v_w.id IS NULL OR v_w.chain <> p_chain OR v_w.cashout_address <> lower(p_cashout)
          OR v_w.recipient <> lower(p_recipient) OR v_w.amount::numeric <> p_amount THEN
         INSERT INTO game.chain_alert (chain, kind, detail) VALUES (p_chain, 'unknown_claim', v_detail);
         RETURN jsonb_build_object('alert', 'unknown_claim');
       END IF;
       IF v_w.status = 'claimed' THEN RETURN jsonb_build_object('status', 'claimed', 'duplicate', true); END IF;
       IF v_w.status = 'refunded' THEN
         INSERT INTO game.chain_alert (chain, kind, detail) VALUES (p_chain, 'claim_after_refund', v_detail);
       END IF;
       IF v_w.status = 'issued' THEN
         INSERT INTO game.chain_alert (chain, kind, detail) VALUES (p_chain, 'claim_before_signature_stored', v_detail);
       END IF;
       -- A claim whose signature never reached the database keeps a zero placeholder.
       UPDATE game.withdrawal
          SET status = 'claimed', claimed_at = now(), claim_tx = lower(p_tx_hash),
              signature = COALESCE(signature, '0x' || repeat('0', 130))
        WHERE id = v_w.id;
       INSERT INTO game.withdrawal_log (withdrawal_id, status, detail) VALUES (v_w.id, 'claimed', v_detail);
       RETURN jsonb_build_object('status', 'claimed', 'alert', CASE WHEN v_w.status = 'refunded' THEN 'claim_after_refund' END);
     END;
     $fn$`,

    // Watcher: advance a stream cursor. Claims must be recorded up to a block before vouchers
    // can be expired against that block's time.
    `CREATE FUNCTION game.cursor_set(p_chain text, p_stream text, p_block bigint, p_block_time timestamptz)
     RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     BEGIN
       INSERT INTO game.chain_cursor (chain, stream, block_number, block_time) VALUES (p_chain, p_stream, p_block, p_block_time)
       ON CONFLICT (chain, stream) DO UPDATE
         SET block_number = EXCLUDED.block_number, block_time = EXCLUDED.block_time, updated_at = now()
         WHERE game.chain_cursor.block_number <= EXCLUDED.block_number;
     END;
     $fn$`,

    `CREATE FUNCTION game.cursor_get(p_chain text, p_stream text) RETURNS bigint
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
       SELECT block_number FROM game.chain_cursor WHERE chain = p_chain AND stream = p_stream
     $fn$`,

    // Watcher: refund vouchers that can no longer be claimed. A voucher is dead only when the
    // claims stream has processed a finalized block whose timestamp is past its expiry; the
    // contract rejects it in that block and every later one, so a refund can never pay twice.
    `CREATE FUNCTION game.voucher_expire(p_chain text, p_limit integer)
     RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
     DECLARE
       v_seen timestamptz;
       v_due record;
       v_w game.withdrawal;
       v_balance bigint;
       v_n integer := 0;
     BEGIN
       SELECT block_time INTO v_seen FROM game.chain_cursor WHERE chain = p_chain AND stream = 'claims';
       IF v_seen IS NULL THEN RETURN 0; END IF;
       FOR v_due IN
         SELECT id, user_id FROM game.withdrawal
         WHERE chain = p_chain AND status IN ('issued', 'signed') AND expiry < v_seen
         ORDER BY id LIMIT p_limit
       LOOP
         PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || v_due.user_id::text, 0));
         SELECT * INTO v_w FROM game.withdrawal WHERE id = v_due.id FOR UPDATE;
         CONTINUE WHEN v_w.status NOT IN ('issued', 'signed');
         UPDATE game.withdrawal SET status = 'refunded', refunded_at = now() WHERE id = v_w.id;
         INSERT INTO game.verse_wallet (user_id, balance) VALUES (v_w.user_id, v_w.amount)
         ON CONFLICT (user_id) DO UPDATE SET balance = game.verse_wallet.balance + EXCLUDED.balance
         RETURNING balance INTO v_balance;
         INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id)
         VALUES (gen_random_uuid(), v_w.user_id, v_w.amount, v_balance, 'withdraw_refund', NULL);
         INSERT INTO game.withdrawal_log (withdrawal_id, status, detail)
         VALUES (v_w.id, 'refunded', jsonb_build_object('claimsSeenThrough', v_seen));
         v_n := v_n + 1;
       END LOOP;
       RETURN v_n;
     END;
     $fn$`,

    // Watcher: every cashout contract that can still pay an open voucher, plus the current one.
    // The claims stream must cover all of them before voucher_expire trusts its cursor.
    `CREATE FUNCTION game.cashout_watch_list(p_chain text) RETURNS text[]
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
       SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), ARRAY[]::text[]) FROM (
         SELECT cashout_address AS a FROM game.withdrawal WHERE chain = p_chain AND status IN ('issued', 'signed')
         UNION SELECT cashout_address FROM game.chain_config WHERE chain = p_chain AND cashout_address IS NOT NULL) s
     $fn$`,

    `CREATE FUNCTION game.chain_alert_add(p_chain text, p_kind text, p_detail jsonb)
     RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
       INSERT INTO game.chain_alert (chain, kind, detail) VALUES (p_chain, p_kind, p_detail)
     $fn$`,

    `CREATE FUNCTION game.chain_service_config(p_chain text) RETURNS jsonb
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, game AS $fn$
       SELECT to_jsonb(c) FROM game.chain_config c WHERE c.chain = p_chain
     $fn$`,

    // wallet.status for the exchange machine.
    `CREATE FUNCTION game.wallet_status(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $fn$
     DECLARE
       v_econ game.economy_config;
       v_cfg game.chain_config;
       v_link game.wallet_link;
       v_used bigint;
       v_global bigint;
     BEGIN
       SELECT * INTO v_econ FROM game.economy_config;
       SELECT * INTO v_cfg FROM game.chain_config WHERE chain = 'eth';
       SELECT * INTO v_link FROM game.wallet_link WHERE user_id = p_user_id AND chain = 'eth';
       SELECT amount INTO v_used FROM game.earn_window WHERE user_id = p_user_id AND bucket = 'withdraw' AND day = game.utc_day();
       SELECT amount INTO v_global FROM game.payout_window WHERE chain = 'eth' AND day = game.utc_day();
       RETURN jsonb_build_object(
         'verse', COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = p_user_id), 0),
         'chain', jsonb_build_object(
           'chain', v_cfg.chain, 'chainId', v_cfg.chain_id, 'tokenAddress', v_cfg.token_address,
           'tokenDecimals', v_cfg.token_decimals, 'depositAddress', v_cfg.deposit_address,
           'cashoutAddress', v_cfg.cashout_address,
           'depositsOpen', v_cfg.deposits_enabled AND v_cfg.deposit_address IS NOT NULL AND v_cfg.token_decimals IS NOT NULL,
           'cashoutOpen', v_cfg.vouchers_enabled AND v_cfg.cashout_address IS NOT NULL AND v_cfg.token_decimals IS NOT NULL),
         'wallet', CASE WHEN v_link.address IS NULL THEN NULL ELSE jsonb_build_object(
           'address', v_link.address, 'linkedAt', extract(epoch FROM v_link.linked_at)::bigint,
           'holdUntil', extract(epoch FROM v_link.linked_at + v_econ.link_hold)::bigint) END,
         'accountLimit', v_econ.account_daily_verse,
         'accountRoom', GREATEST(v_econ.account_daily_verse - COALESCE(v_used, 0), 0),
         'globalRoom', GREATEST(game.global_released(v_cfg.global_daily_verse, v_cfg.hourly_release) - COALESCE(v_global, 0), 0),
         'refUsdPerToken', v_econ.ref_usd_per_token,
         'vouchers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', w.id::text, 'recipient', w.recipient, 'amount', w.amount, 'expiry', extract(epoch FROM w.expiry)::bigint,
             'status', w.status, 'signature', w.signature, 'cashoutAddress', w.cashout_address, 'chainId', w.chain_id,
             'claimTx', w.claim_tx, 'createdAt', extract(epoch FROM w.created_at)::bigint) ORDER BY w.id DESC)
           FROM (SELECT * FROM game.withdrawal WHERE user_id = p_user_id ORDER BY id DESC LIMIT 50) w), '[]'::jsonb),
         'deposits', COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'tx', d.tx_hash, 'amount', d.amount::text, 'verse', d.verse, 'status', d.status,
             'at', extract(epoch FROM d.seen_at)::bigint) ORDER BY d.seen_at DESC)
           FROM (SELECT * FROM game.deposit
                 WHERE user_id = p_user_id OR (status <> 'credited' AND from_address = v_link.address AND chain = 'eth')
                 ORDER BY seen_at DESC LIMIT 50) d), '[]'::jsonb),
         'intents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'intentId', i.intent_id, 'itemId', i.item_id, 'versePrice', i.verse_price, 'status', i.status,
             'expiresAt', extract(epoch FROM i.expires_at)::bigint) ORDER BY i.created_at DESC)
           FROM (SELECT * FROM game.purchase_intent WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 20) i), '[]'::jsonb));
     END;
     $fn$`,

    `DO $do$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_chain') THEN
         CREATE ROLE hub_chain NOLOGIN;
       END IF;
     END
     $do$`,

    // Functions default to EXECUTE for PUBLIC. Only the owner (Nakama's database user) and
    // hub_chain, for the functions granted below, may call anything in the game schema.
    "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA game FROM PUBLIC",

    "GRANT USAGE ON SCHEMA game TO hub_chain",

    `GRANT EXECUTE ON FUNCTION game.deposit_record(text, text, integer, bigint, text, numeric),
       game.deposit_settle_pending(text, integer), game.voucher_pending(text, integer),
       game.voucher_store_signature(bigint, bigint, text, text, bigint, bigint, text),
       game.claim_record(text, text, numeric, text, numeric, text, bigint), game.cursor_set(text, text, bigint, timestamptz),
       game.cursor_get(text, text), game.voucher_expire(text, integer), game.chain_alert_add(text, text, jsonb),
       game.chain_service_config(text), game.cashout_watch_list(text) TO hub_chain`,
  ];
}
