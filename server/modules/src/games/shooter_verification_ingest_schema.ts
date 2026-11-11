// PR07. Default-off capacity reservation and atomic input persistence only.
// No new v2 issuer, simulator execution or payment function is introduced.
HubSchema.register({
  id: "0051_shooter_verification_ingest",
  statements: [
    "CREATE INDEX IF NOT EXISTS shooter_digest_run ON game.shooter_digest (run_id, user_id)",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_bind_run()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE st text; cp text;
    BEGIN
      -- Match append's quota prefix before taking the legacy version-choice lock.
      PERFORM 1 FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'shooter_verification_disabled'; END IF;
      INSERT INTO game.shooter_verification_admission_account (user_id) VALUES (NEW.user_id) ON CONFLICT DO NOTHING;
      PERFORM 1 FROM game.shooter_verification_admission_account WHERE user_id=NEW.user_id FOR UPDATE;
      -- Serialize choosing v2 with legacy close/checkpoint/payment, before FK row locks.
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || NEW.user_id::text,0));
      SELECT status,checkpoint_json INTO st,cp FROM game.shooter_run WHERE run_id=NEW.run_id AND user_id=NEW.user_id AND session_id=NEW.session_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='shooter_verification_identity'; END IF;
      IF st<>'open' OR cp IS NOT NULL OR EXISTS (SELECT 1 FROM game.shooter_digest WHERE run_id=NEW.run_id)
        OR EXISTS (SELECT 1 FROM game.shooter_receipt WHERE run_id=NEW.run_id) THEN
        RAISE EXCEPTION 'shooter_verification_legacy_processed';
      END IF;
      RETURN NEW;
    END; $fn$`,
    `DO $trigger$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_run'::regclass AND tgname='shooter_verification_bind_run') THEN
        CREATE TRIGGER shooter_verification_bind_run BEFORE INSERT ON game.shooter_verification_run
          FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_bind_run();
      END IF;
    END; $trigger$`,
    // Version guard installed additively. The historical migration bodies and all
    // v1 economics remain unchanged; already-running legacy RPCs cannot race v2 binding.
    `DO $guard$
    DECLARE name text; src text;
      anchor text := 'PERFORM pg_advisory_xact_lock(hashtextextended(''economy:'' || p_user_id::text, 0));';
    BEGIN
      FOREACH name IN ARRAY ARRAY[
        'game.close_shooter_run(uuid,text,text,text)',
        'game.save_shooter_checkpoint(uuid,text,text,text,text,bigint)',
        'game.settle_shooter_clear(uuid,uuid,text,text,date,text,text,bigint,integer,text,text)'
      ] LOOP
        src:=pg_get_functiondef(name::regprocedure);
        IF position('shooter_v2_legacy_guard' IN src)=0 THEN
          IF position(anchor IN src)=0 THEN RAISE EXCEPTION 'shooter legacy version guard anchor missing'; END IF;
          src:=replace(src,anchor,anchor || E'\n-- shooter_v2_legacy_guard\n'
            || 'IF EXISTS (SELECT 1 FROM game.shooter_verification_run WHERE run_id=p_run_id AND user_id=p_user_id) THEN '
            || 'RETURN jsonb_build_object(''ok'',false,''paid'',false,''tickets'',0,''ticketsMinted'',0,''reason'',''wrong_protocol''); END IF;');
          EXECUTE src;
        END IF;
      END LOOP;
    END; $guard$`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_admission (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      new_runs_enabled boolean NOT NULL DEFAULT false,
      max_global_runs bigint CHECK (max_global_runs BETWEEN 1 AND 1000000),
      max_account_runs bigint CHECK (max_account_runs BETWEEN 1 AND 4096),
      max_global_bytes bigint CHECK (max_global_bytes BETWEEN 67108864 AND 1099511627776),
      max_account_bytes bigint CHECK (max_account_bytes BETWEEN 67108864 AND 1099511627776),
      max_global_batches bigint CHECK (max_global_batches BETWEEN 4096 AND 10000000),
      max_account_batches bigint CHECK (max_account_batches BETWEEN 4096 AND 1000000),
      global_appends_per_minute integer CHECK (global_appends_per_minute BETWEEN 1 AND 100000),
      account_appends_per_minute integer CHECK (account_appends_per_minute BETWEEN 1 AND 10000),
      retained_runs bigint NOT NULL DEFAULT 0 CHECK (retained_runs >= 0),
      retained_batches bigint NOT NULL DEFAULT 0 CHECK (retained_batches >= 0),
      retained_bytes bigint NOT NULL DEFAULT 0 CHECK (retained_bytes >= 0),
      reserved_batches bigint NOT NULL DEFAULT 0 CHECK (reserved_batches >= retained_batches),
      reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= retained_bytes),
      rate_minute timestamptz NOT NULL DEFAULT date_trunc('minute',clock_timestamp()),
      rate_count integer NOT NULL DEFAULT 0 CHECK (rate_count >= 0),
      CHECK (NOT new_runs_enabled OR (max_global_runs IS NOT NULL AND max_account_runs IS NOT NULL
        AND max_global_bytes IS NOT NULL AND max_account_bytes IS NOT NULL
        AND max_global_batches IS NOT NULL AND max_account_batches IS NOT NULL
        AND global_appends_per_minute IS NOT NULL AND account_appends_per_minute IS NOT NULL))
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_admission_account (
      user_id uuid PRIMARY KEY,
      retained_runs bigint NOT NULL DEFAULT 0 CHECK (retained_runs >= 0),
      retained_batches bigint NOT NULL DEFAULT 0 CHECK (retained_batches >= 0),
      retained_bytes bigint NOT NULL DEFAULT 0 CHECK (retained_bytes >= 0),
      reserved_batches bigint NOT NULL DEFAULT 0 CHECK (reserved_batches >= retained_batches),
      reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= retained_bytes),
      rate_minute timestamptz NOT NULL DEFAULT date_trunc('minute',clock_timestamp()),
      rate_count integer NOT NULL DEFAULT 0 CHECK (rate_count >= 0)
    )`,
    // Upgrade accounts for retained evidence once. Reboots never reset quotas.
    `INSERT INTO game.shooter_verification_admission
      (singleton,retained_runs,retained_batches,retained_bytes,reserved_batches,reserved_bytes)
      SELECT true,(SELECT count(*) FROM game.shooter_verification_run),count(*),COALESCE(sum(encoded_bytes),0),
        (SELECT count(*)*4096 FROM game.shooter_verification_run),(SELECT count(*)*67108864 FROM game.shooter_verification_run)
      FROM game.shooter_verification_batch ON CONFLICT (singleton) DO NOTHING`,
    `INSERT INTO game.shooter_verification_admission_account
      (user_id,retained_runs,retained_batches,retained_bytes,reserved_batches,reserved_bytes)
      SELECT r.user_id,count(DISTINCT r.run_id),count(b.sequence),COALESCE(sum(b.encoded_bytes),0),
        count(DISTINCT r.run_id)*4096,count(DISTINCT r.run_id)*67108864
      FROM game.shooter_verification_run r LEFT JOIN game.shooter_verification_batch b USING (run_id)
      GROUP BY r.user_id ON CONFLICT (user_id) DO NOTHING`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_reserve_run()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_admission%ROWTYPE; a game.shooter_verification_admission_account%ROWTYPE;
    BEGIN
      SELECT * INTO c FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
      IF NOT FOUND OR NOT c.new_runs_enabled THEN RAISE EXCEPTION 'shooter_verification_disabled'; END IF;
      INSERT INTO game.shooter_verification_admission_account (user_id) VALUES (NEW.user_id) ON CONFLICT DO NOTHING;
      SELECT * INTO a FROM game.shooter_verification_admission_account WHERE user_id=NEW.user_id FOR UPDATE;
      IF c.retained_runs+1>c.max_global_runs OR a.retained_runs+1>c.max_account_runs
        OR c.reserved_bytes+67108864>c.max_global_bytes OR a.reserved_bytes+67108864>c.max_account_bytes
        OR c.reserved_batches+4096>c.max_global_batches OR a.reserved_batches+4096>c.max_account_batches THEN
        RAISE EXCEPTION 'shooter_verification_capacity';
      END IF;
      UPDATE game.shooter_verification_admission SET retained_runs=retained_runs+1,
        reserved_bytes=reserved_bytes+67108864,reserved_batches=reserved_batches+4096 WHERE singleton;
      UPDATE game.shooter_verification_admission_account SET retained_runs=retained_runs+1,
        reserved_bytes=reserved_bytes+67108864,reserved_batches=reserved_batches+4096 WHERE user_id=NEW.user_id;
      RETURN NEW;
    END; $fn$`,
    `DO $trigger$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_run'::regclass AND tgname='shooter_verification_reserve_run') THEN
        CREATE TRIGGER shooter_verification_reserve_run AFTER INSERT ON game.shooter_verification_run
          FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_reserve_run();
      END IF;
    END; $trigger$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_preflight(p_user uuid,p_session uuid,p_run text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_admission%ROWTYPE; a game.shooter_verification_admission_account%ROWTYPE;
      t timestamptz; m timestamptz;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user AND session_id=p_session) THEN
        RETURN jsonb_build_object('state','invalid','reason','unknown_run');
      END IF;
      SELECT * INTO c FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
      IF NOT FOUND OR c.global_appends_per_minute IS NULL OR c.account_appends_per_minute IS NULL THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','capacity_unconfigured');
      END IF;
      SELECT * INTO a FROM game.shooter_verification_admission_account WHERE user_id=p_user FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('state','pending_retryable','reason','capacity_unconfigured'); END IF;
      t:=clock_timestamp(); m:=date_trunc('minute',t);
      IF c.rate_minute<>m THEN c.rate_count:=0; END IF;
      IF a.rate_minute<>m THEN a.rate_count:=0; END IF;
      IF c.rate_count>=c.global_appends_per_minute OR a.rate_count>=c.account_appends_per_minute THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','rate_limited','retryAfterMs',1000);
      END IF;
      UPDATE game.shooter_verification_admission SET rate_minute=m,rate_count=c.rate_count+1 WHERE singleton;
      UPDATE game.shooter_verification_admission_account SET rate_minute=m,rate_count=a.rate_count+1 WHERE user_id=p_user;
      IF NOT EXISTS (SELECT 1 FROM game.game_session WHERE session_id=p_session AND user_id=p_user
        AND game_id='sproto-shooter' AND state='open' AND ticket_redeemed_at IS NOT NULL AND lease_until>t) THEN
        RETURN jsonb_build_object('state','authorization_denied','reason','session_closed');
      END IF;
      RETURN jsonb_build_object('state','ready');
    END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_append(
      p_user uuid,p_session uuid,p_run text,p_sequence integer,p_tick0 integer,p_n integer,p_frames text,p_actions jsonb,p_digest text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_admission%ROWTYPE; a game.shooter_verification_admission_account%ROWTYPE;
      s game.game_session%ROWTYPE; r game.shooter_verification_run%ROWTYPE; b game.shooter_verification_batch%ROWTYPE;
      t timestamptz; ack jsonb; bytes integer; actions integer;
    BEGIN
      -- Common lock order: global admission, account admission, original session, run.
      SELECT * INTO c FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
      SELECT * INTO a FROM game.shooter_verification_admission_account WHERE user_id=p_user FOR UPDATE;
      SELECT * INTO s FROM game.game_session WHERE session_id=p_session AND user_id=p_user FOR UPDATE;
      SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user AND session_id=p_session FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid','reason','unknown_run'); END IF;
      t:=clock_timestamp();
      IF s.session_id IS NULL OR s.game_id<>'sproto-shooter' OR s.state<>'open' OR s.ticket_redeemed_at IS NULL THEN
        RETURN jsonb_build_object('state','authorization_denied','reason','session_closed');
      END IF;
      IF s.lease_until<=t THEN RETURN jsonb_build_object('state','authorization_denied','reason','session_expired'); END IF;
      IF r.upload_deadline<=t THEN RETURN jsonb_build_object('state','authorization_denied','reason','upload_expired'); END IF;
      IF p_actions IS NULL OR jsonb_typeof(p_actions)<>'array' THEN
        RETURN jsonb_build_object('state','invalid','reason','malformed');
      END IF;
      bytes:=octet_length(p_frames); actions:=jsonb_array_length(p_actions);
      IF p_sequence IS NULL OR p_sequence<0 OR p_sequence>4095 OR p_tick0 IS NULL OR p_tick0<0
        OR p_n IS NULL OR p_n<1 OR p_n>28800 OR p_tick0>161999 OR p_tick0::bigint+p_n::bigint>162000 OR bytes IS NULL OR bytes<1 OR bytes>2097152
        OR actions>32 OR p_digest IS NULL OR p_digest!~'^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('state','invalid','reason','malformed');
      END IF;
      SELECT * INTO b FROM game.shooter_verification_batch WHERE run_id=p_run AND sequence=p_sequence;
      IF FOUND THEN
        IF b.request_sha256=p_digest AND b.tick0=p_tick0 AND b.frame_count=p_n AND b.frames=p_frames AND b.actions=p_actions THEN
          RETURN b.received_ack;
        END IF;
        RETURN jsonb_build_object('state','invalid','reason','sequence_conflict');
      END IF;
      IF r.lifecycle<>'open' OR r.sealed_sequence IS NOT NULL OR r.terminal_tick IS NOT NULL THEN
        RETURN jsonb_build_object('state','invalid','reason','run_closed');
      END IF;
      IF p_sequence<>r.accepted_sequence+1 OR p_tick0<>r.accepted_tick THEN
        RETURN jsonb_build_object('state','invalid','reason','noncontiguous');
      END IF;
      IF r.accepted_tick+p_n>162000 OR r.accepted_batches+1>4096 OR r.accepted_bytes+bytes>67108864 OR r.accepted_actions+actions>131072 THEN
        RETURN jsonb_build_object('state','invalid','reason','run_limit');
      END IF;
      IF p_tick0+p_n>floor(GREATEST(0,extract(epoch FROM (t-r.issued_at)))*60)+120 THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','too_fast','retryAfterMs',1000);
      END IF;
      IF c.singleton IS NULL OR a.user_id IS NULL OR c.global_appends_per_minute IS NULL OR c.account_appends_per_minute IS NULL
        OR c.retained_bytes+bytes>c.reserved_bytes OR c.retained_batches+1>c.reserved_batches
        OR a.retained_bytes+bytes>a.reserved_bytes OR a.retained_batches+1>a.reserved_batches THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','capacity_unconfigured');
      END IF;
      ack:=jsonb_build_object('protocol',2,'state','received','runId',p_run,'sequence',p_sequence,'tick0',p_tick0,'n',p_n,
        'acceptedSequence',p_sequence,'acceptedTick',p_tick0+p_n,'digest',p_digest,'receivedAt',t);
      INSERT INTO game.shooter_verification_batch
        (run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,accepted_at,authorized_lease_until)
        VALUES (p_run,p_sequence,p_tick0,p_n,p_frames,bytes,p_actions,actions,p_digest,ack,t,s.lease_until);
      UPDATE game.shooter_verification_run SET accepted_sequence=p_sequence,accepted_tick=p_tick0+p_n,
        accepted_bytes=accepted_bytes+bytes,accepted_actions=accepted_actions+actions,accepted_batches=accepted_batches+1,
        last_accepted_at=t,updated_at=t WHERE run_id=p_run;
      UPDATE game.shooter_verification_admission SET retained_bytes=retained_bytes+bytes,retained_batches=retained_batches+1 WHERE singleton;
      UPDATE game.shooter_verification_admission_account SET retained_bytes=retained_bytes+bytes,retained_batches=retained_batches+1 WHERE user_id=p_user;
      RETURN ack;
    END; $fn$`,
  ],
});
