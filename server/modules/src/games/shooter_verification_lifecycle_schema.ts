// Additive lifecycle only. Every activation flag and cohort defaults empty/off.
HubSchema.register({
  id: "0056_shooter_verification_lifecycle",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_cohort (
      user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_cohort_guard()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'shooter_cohort_sticky'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || NEW.user_id::text,0));
      RETURN NEW; END; $fn$`,
    `CREATE TRIGGER shooter_verification_cohort_guard BEFORE INSERT OR UPDATE OR DELETE
      ON game.shooter_verification_cohort FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_cohort_guard()`,
    "ALTER TABLE game.shooter_verification_run ADD COLUMN issue_ack jsonb CHECK(issue_ack IS NULL OR (jsonb_typeof(issue_ack)='object' AND octet_length(issue_ack::text)<=65536))",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN seal_ack jsonb CHECK(seal_ack IS NULL OR (jsonb_typeof(seal_ack)='object' AND octet_length(seal_ack::text)<=2048))",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN admission_closed_reason text CHECK(admission_closed_reason IN ('session_closed','session_expired','upload_deadline'))",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN admission_closed_at timestamptz",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN session_invalidated_reason text CHECK(session_invalidated_reason IN ('session_closed','session_expired'))",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN session_invalidated_at timestamptz",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_lifecycle_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
      IF (OLD.issue_ack IS NOT NULL AND NEW.issue_ack IS DISTINCT FROM OLD.issue_ack)
        OR (OLD.seal_ack IS NOT NULL AND NEW.seal_ack IS DISTINCT FROM OLD.seal_ack)
        OR (OLD.admission_closed_reason IS NOT NULL AND ROW(NEW.admission_closed_reason,NEW.admission_closed_at)
          IS DISTINCT FROM ROW(OLD.admission_closed_reason,OLD.admission_closed_at))
        OR (OLD.session_invalidated_reason IS NOT NULL AND ROW(NEW.session_invalidated_reason,NEW.session_invalidated_at)
          IS DISTINCT FROM ROW(OLD.session_invalidated_reason,OLD.session_invalidated_at)) THEN
        RAISE EXCEPTION 'shooter_lifecycle_binding_immutable'; END IF;
      RETURN NEW; END; $fn$`,
    `CREATE TRIGGER shooter_verification_lifecycle_immutable BEFORE UPDATE ON game.shooter_verification_run
      FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_lifecycle_immutable()`,
    // Session -> run is a subset of append/payment ordering. Never acquire a
    // quota, economy or scheduler lock from here. Retained quotas are not freed.
    `CREATE OR REPLACE FUNCTION game.shooter_verification_touch(p_user uuid,p_run text,p_nowait boolean DEFAULT false)
      RETURNS void LANGUAGE plpgsql AS $fn$
      DECLARE r game.shooter_verification_run%ROWTYPE; s game.game_session%ROWTYPE; sid uuid; t timestamptz; why text;
      BEGIN
        SELECT session_id INTO sid FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user;
        IF NOT FOUND THEN RETURN; END IF;
        IF p_nowait THEN
          SELECT * INTO s FROM game.game_session WHERE session_id=sid AND user_id=p_user FOR UPDATE NOWAIT;
          SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user FOR UPDATE NOWAIT;
        ELSE
          SELECT * INTO s FROM game.game_session WHERE session_id=sid AND user_id=p_user FOR UPDATE;
          SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user FOR UPDATE;
        END IF;
        IF NOT FOUND THEN RETURN; END IF;
        t:=clock_timestamp();
        IF s.session_id IS NULL OR s.game_id<>'sproto-shooter' OR s.state='closed' OR s.ticket_redeemed_at IS NULL THEN why:='session_closed';
        ELSIF s.state='expired' OR s.lease_until<=t THEN why:='session_expired';
        ELSIF s.state<>'open' THEN why:='session_closed';
        ELSIF r.upload_deadline<=t THEN why:='upload_deadline'; END IF;
        IF why IN ('session_closed','session_expired') AND r.session_invalidated_reason IS NULL THEN
          UPDATE game.shooter_verification_run SET session_invalidated_reason=why,session_invalidated_at=t WHERE run_id=p_run;
        END IF;
        IF why IS NOT NULL AND r.admission_closed_reason IS NULL THEN
          UPDATE game.shooter_verification_run SET admission_closed_reason=why,admission_closed_at=t,
            lifecycle=CASE WHEN lifecycle IN ('open','sealed','quarantined') THEN 'expired' ELSE lifecycle END,
            sealed_sequence=COALESCE(sealed_sequence,accepted_sequence),sealed_tick=COALESCE(sealed_tick,accepted_tick),updated_at=t
            WHERE run_id=p_run;
          r.admission_closed_reason:=why;
          IF r.lifecycle IN ('open','sealed','quarantined') THEN r.lifecycle:='expired'; END IF;
        END IF;
        IF r.lifecycle IN ('sealed','expired') AND r.verified_tick=r.accepted_tick AND r.terminal_tick IS NULL
          AND r.operational_reason IS NULL AND NOT EXISTS(SELECT 1 FROM game.shooter_verification_job
            WHERE run_id=p_run AND state IN ('ready','leased','retry_wait','quarantined')) THEN
          -- A server closure fact, never a synthetic simulator firstTerminal.
          UPDATE game.shooter_verification_run SET lifecycle='terminal',terminal_tick=simulation_tick,
            terminal_outcome='incomplete',terminal_result=jsonb_build_object('outcome','incomplete','reason','incomplete','eligible',false),
            terminal_revision=revision,terminal_accepted_sequence=CASE WHEN accepted_sequence>=0 THEN accepted_sequence END,
            terminal_accepted_tick=CASE WHEN accepted_tick>0 THEN accepted_tick END,
            resolved_at=t,payment_state='ineligible',payment_reason='ineligible',updated_at=t WHERE run_id=p_run;
        END IF;
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_reap(p_user uuid DEFAULT NULL)
      RETURNS integer LANGUAGE plpgsql AS $fn$ DECLARE item record; n integer:=0;
      BEGIN
        -- A separate short transaction from claiming/committing worker work.
        -- Stable session order prevents two reapers holding inverse session rows.
        FOR item IN SELECT r.user_id,r.run_id FROM game.shooter_verification_run r
          JOIN game.game_session s ON s.session_id=r.session_id AND s.user_id=r.user_id
          WHERE (p_user IS NULL OR r.user_id=p_user) AND (
            (r.session_invalidated_reason IS NULL AND r.lifecycle<>'invalid' AND r.payment_state IN ('none','pending')
              AND (s.state<>'open' OR s.lease_until<=clock_timestamp() OR s.ticket_redeemed_at IS NULL))
            OR (r.admission_closed_reason IS NULL AND r.lifecycle IN ('open','sealed','quarantined') AND r.upload_deadline<=clock_timestamp())
            OR (r.lifecycle IN ('sealed','expired') AND r.verified_tick=r.accepted_tick AND r.terminal_tick IS NULL
              AND r.operational_reason IS NULL AND NOT EXISTS(SELECT 1 FROM game.shooter_verification_job j WHERE j.run_id=r.run_id AND j.state IN ('ready','leased','retry_wait','quarantined'))))
          ORDER BY r.session_id,r.run_id LIMIT 16 LOOP
          BEGIN
            PERFORM game.shooter_verification_touch(item.user_id,item.run_id,true); n:=n+1;
          EXCEPTION WHEN lock_not_available THEN NULL;
          END;
        END LOOP; RETURN n;
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_finish(p_user uuid,p_session uuid,p_run text,p_sequence integer,p_tick integer)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE s game.game_session%ROWTYPE; r game.shooter_verification_run%ROWTYPE; t timestamptz; ack jsonb;
      BEGIN
        SELECT * INTO s FROM game.game_session WHERE session_id=p_session AND user_id=p_user FOR UPDATE;
        SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user AND session_id=p_session FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid','reason','unknown_run'); END IF;
        t:=clock_timestamp();
        IF s.session_id IS NULL OR s.game_id<>'sproto-shooter' OR s.state NOT IN ('open','expired') OR s.ticket_redeemed_at IS NULL THEN
          PERFORM game.shooter_verification_touch(p_user,p_run);
          RETURN jsonb_build_object('state','authorization_denied','reason','session_closed'); END IF;
        IF s.state='expired' OR s.lease_until<=t OR r.session_invalidated_reason IS NOT NULL THEN
          PERFORM game.shooter_verification_touch(p_user,p_run);
          RETURN jsonb_build_object('state','authorization_denied','reason',COALESCE(r.session_invalidated_reason,'session_expired')); END IF;
        IF r.upload_deadline<=t OR r.admission_closed_reason IS NOT NULL THEN
          PERFORM game.shooter_verification_touch(p_user,p_run);
          RETURN jsonb_build_object('state','authorization_denied','reason','upload_expired'); END IF;
        IF p_sequence IS NULL OR p_tick IS NULL OR p_sequence<>r.accepted_sequence OR p_tick<>r.accepted_tick THEN
          RETURN jsonb_build_object('state','invalid','reason','seal_conflict'); END IF;
        IF r.seal_ack IS NOT NULL THEN RETURN r.seal_ack; END IF;
        IF r.lifecycle NOT IN ('open','terminal') OR r.operational_reason IS NOT NULL THEN
          RETURN jsonb_build_object('state','invalid','reason','run_closed'); END IF;
        ack:=jsonb_build_object('protocol',2,'state','sealed','runId',p_run,'lastSequence',p_sequence,'lastTick',p_tick,'sealedAt',t);
        UPDATE game.shooter_verification_run SET lifecycle=CASE WHEN lifecycle='open' THEN 'sealed' ELSE lifecycle END,
          sealed_sequence=p_sequence,sealed_tick=p_tick,seal_ack=ack,updated_at=t WHERE run_id=p_run;
        PERFORM game.shooter_verification_touch(p_user,p_run);
        RETURN ack;
      END; $fn$`,
    // Select the version while holding the SAME economy/key locks as legacy.
    // New rows and full-run reservations live in one rollbackable transaction.
    `CREATE OR REPLACE FUNCTION game.issue_shooter_verification_run(
      u uuid,sid uuid,k text,rid text,d date,boss text,seed bigint,issuance text)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE old game.shooter_run%ROWTYPE; r game.shooter_verification_run%ROWTYPE;
        s game.game_session%ROWTYPE; c game.shooter_verification_admission%ROWTYPE; t timestamptz; ack jsonb; canonical jsonb;
      BEGIN
        SELECT * INTO c FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
        INSERT INTO game.shooter_verification_admission_account(user_id) VALUES(u) ON CONFLICT DO NOTHING;
        PERFORM 1 FROM game.shooter_verification_admission_account WHERE user_id=u FOR UPDATE;
        PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || u::text,0));
        PERFORM pg_advisory_xact_lock(hashtextextended('shooter-issue:' || u::text || ':' || k,0));
        SELECT * INTO s FROM game.game_session WHERE session_id=sid AND user_id=u FOR UPDATE;
        SELECT * INTO old FROM game.shooter_run WHERE user_id=u AND idem_key=k FOR UPDATE;
        IF FOUND THEN
          IF old.session_id IS DISTINCT FROM sid OR old.canonical_boss IS DISTINCT FROM boss THEN
            RETURN jsonb_build_object('state','invalid','reason','idempotency_mismatch'); END IF;
          SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=old.run_id FOR UPDATE;
          IF FOUND THEN
            IF r.issue_ack IS NULL THEN RETURN jsonb_build_object('state','pending_retryable','reason','issuance_unavailable'); END IF;
            RETURN r.issue_ack;
          END IF;
          RETURN jsonb_build_object('ok',true,'replay',true,'paid',false,'tickets',0,'ticketsMinted',0,'issuance',old.issuance_json::jsonb);
        END IF;
        IF NOT EXISTS(SELECT 1 FROM game.shooter_verification_cohort WHERE user_id=u) THEN
          RETURN jsonb_build_object('state','invalid','reason','wrong_protocol'); END IF;
        IF NOT COALESCE(c.new_runs_enabled,false)
          OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_scheduler WHERE singleton AND claims_enabled)
          OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_gateway WHERE singleton AND enabled)
          OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_payment_config WHERE singleton AND payments_enabled) THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','verification_unavailable'); END IF;
        -- Readiness is a non-reserving snapshot, not a promise that concurrent
        -- consumers cannot use capacity first. Owning helpers enforce atomic
        -- budgets. Do not take scheduler -> gateway locks (gateway uses inverse).
        IF NOT EXISTS(SELECT 1 FROM game.shooter_verification_scheduler q
          LEFT JOIN game.shooter_verification_scheduler_account a ON a.user_id=u
          WHERE q.singleton AND q.retained_jobs<q.max_jobs AND COALESCE(a.retained_jobs,0)<q.max_account_jobs
            AND q.retained_attempts<q.max_attempts_retained AND COALESCE(a.retained_attempts,0)<q.max_account_attempts_retained
            AND q.reserved_checkpoint_bytes+16777216<=q.max_checkpoint_bytes
            AND COALESCE(a.reserved_checkpoint_bytes,0)+16777216<=q.max_account_checkpoint_bytes)
          OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_gateway g WHERE g.singleton
            AND g.retained_requests+3<=g.max_requests
            AND g.reserved_receipt_bytes+3*game.shooter_verification_gateway_receipt_budget()<=g.max_receipt_bytes
            AND EXISTS(SELECT 1 FROM game.shooter_verification_principal p JOIN game.shooter_verification_worker w
              ON w.worker_id=p.worker_id AND w.account_id=p.account_id
              WHERE p.revoked_at IS NULL AND p.not_before<=clock_timestamp() AND p.expires_at>clock_timestamp()
                AND ARRAY['claim','renew','retry','result']::text[]<@p.scopes
                AND p.retained_requests+3<=g.max_principal_requests
                AND p.reserved_receipt_bytes+3*game.shooter_verification_gateway_receipt_budget()<=g.max_principal_receipt_bytes)) THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','verification_capacity'); END IF;
        t:=clock_timestamp();
        IF s.session_id IS NULL OR s.game_id<>'sproto-shooter' OR s.state<>'open' OR s.ticket_redeemed_at IS NULL THEN
          RETURN jsonb_build_object('state','authorization_denied','reason','session_closed'); END IF;
        IF s.lease_until<=t THEN RETURN jsonb_build_object('state','authorization_denied','reason','session_expired'); END IF;
        IF d IS DISTINCT FROM (t AT TIME ZONE 'UTC')::date THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','issuance_day_changed'); END IF;
        IF k IS NULL OR k!~'^[A-Za-z0-9_.:@|-]{1,80}$' OR rid IS NULL OR rid!~'^[0-9a-f-]{36}$'
          OR boss IS NULL OR boss NOT IN ('sahil','obama','broccoli','glowie','tinubu') OR seed IS NULL OR seed NOT BETWEEN 1 AND 4294967295
          OR issuance IS NULL OR octet_length(issuance)>32768 THEN
          RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
        canonical:=issuance::jsonb;
        IF jsonb_typeof(canonical) IS DISTINCT FROM 'object' THEN
          RETURN jsonb_build_object('state','invalid','reason','issuance_mismatch'); END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(canonical))<>19
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(canonical) AS fields(name)
            WHERE name<>ALL(ARRAY['v','protocol','runId','accountId','sessionId','day','seed','levelId','sectionId','encounterId',
              'canonicalBoss','parts','countAs','loadout','contentFingerprint','maxFrames','duelId','distinctFrom','initialStateHash']))
          OR canonical->'v' IS DISTINCT FROM '1'::jsonb OR canonical->'protocol' IS DISTINCT FROM '1'::jsonb
          OR canonical->'countAs' IS DISTINCT FROM '1'::jsonb OR canonical->'maxFrames' IS DISTINCT FROM '162000'::jsonb
          OR canonical->'seed' IS DISTINCT FROM to_jsonb(seed)
          OR canonical->'runId' IS DISTINCT FROM to_jsonb(rid) OR canonical->'accountId' IS DISTINCT FROM to_jsonb(u::text)
          OR canonical->'sessionId' IS DISTINCT FROM to_jsonb(sid::text) OR canonical->'day' IS DISTINCT FROM to_jsonb(to_char(d,'YYYY-MM-DD'))
          OR canonical->'canonicalBoss' IS DISTINCT FROM to_jsonb(boss) OR canonical->'loadout' IS DISTINCT FROM '"canonical-start"'::jsonb
          OR canonical->'contentFingerprint' IS DISTINCT FROM '"cea1f88b"'::jsonb
          OR jsonb_typeof(canonical->'initialStateHash') IS DISTINCT FROM 'string'
          OR canonical->>'initialStateHash'!~'^[0-9a-f]{8}$' THEN
          RETURN jsonb_build_object('state','invalid','reason','issuance_mismatch'); END IF;
        IF EXISTS(SELECT 1 FROM game.shooter_verification_run WHERE user_id=u AND lifecycle IN ('open','sealed','quarantined')) THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','active_run'); END IF;
        ack:=jsonb_build_object('protocol',2,'state','issued','runId',rid,'issuance',issuance::jsonb,
          'manifest',jsonb_build_object('artifact','shooter-sim','sourceCommit','05f7a0a245af921fc65a99588564175c19658e38',
            'sha256','797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9','protocol',1,'contentFingerprint','cea1f88b',
            'uploadProtocol',2,'replayApiVersion',2,'checkpointSchema',2,'economyPolicy',1),
          'issuedAt',t,'uploadDeadline',t+interval '45 minutes','sessionLeaseUntil',s.lease_until,
          'limits',jsonb_build_object('batchFramesTextBytes',2097152,'runFramesTextBytes',67108864,'bodyBytes',2162688,
            'batchFrames',28800,'runFrames',162000,'batches',4096,'batchActions',32,'runActions',131072,'depth',12,'idLength',80));
        BEGIN
          INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json,status)
            VALUES(rid,u,sid,k,d,boss,seed,issuance,'open');
          INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,
            artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline,issue_ack)
            VALUES(rid,u,sid,1,2,1,'797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9',
              '05f7a0a245af921fc65a99588564175c19658e38','cea1f88b',t,t+interval '45 minutes',ack);
        EXCEPTION WHEN raise_exception OR unique_violation THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','capacity_unavailable');
        END;
        RETURN ack;
      END; $fn$`,
    // Never rewrite historical migration bodies. Refuse unknown installed text.
    `DO $guard$ DECLARE src text;
      lock_anchor text := 'PERFORM pg_advisory_xact_lock(hashtextextended(''shooter-issue:'' || p_user_id::text || '':'' || p_idem_key, 0));';
      session_anchor text := 'IF NOT EXISTS (';
      retry_anchor text := 'RETURN jsonb_build_object(''ok'', true, ''replay'', true, ''paid'', false, ''tickets'', 0, ''ticketsMinted'', 0, ''issuance'', v_issuance::jsonb);';
      BEGIN
        src:=pg_get_functiondef('game.issue_shooter_run(uuid,uuid,text,text,date,text,bigint,text)'::regprocedure);
        IF position('shooter_v2_issue_cohort_guard' IN src)=0 THEN
          IF length(src)-length(replace(src,lock_anchor,''))<>length(lock_anchor)
            OR length(src)-length(replace(src,session_anchor,''))<>length(session_anchor)
            OR length(src)-length(replace(src,retry_anchor,''))<>length(retry_anchor) THEN
            RAISE EXCEPTION 'shooter issue guard anchor missing or ambiguous'; END IF;
          src:=replace(src,lock_anchor,'-- shooter_v2_issue_cohort_guard' || E'\n'
            || 'PERFORM pg_advisory_xact_lock(hashtextextended(''economy:'' || p_user_id::text,0));' || E'\n' || lock_anchor);
          src:=replace(src,retry_anchor,'IF EXISTS(SELECT 1 FROM game.shooter_verification_run r JOIN game.shooter_run old USING(run_id) WHERE old.user_id=p_user_id AND old.idem_key=p_idem_key) THEN '
            || 'RETURN COALESCE((SELECT r.issue_ack FROM game.shooter_verification_run r JOIN game.shooter_run old USING(run_id) WHERE old.user_id=p_user_id AND old.idem_key=p_idem_key),'
            || 'jsonb_build_object(''state'',''pending_retryable'',''reason'',''issuance_unavailable'')); END IF; ' || retry_anchor);
          src:=replace(src,session_anchor,'IF EXISTS(SELECT 1 FROM game.shooter_verification_cohort WHERE user_id=p_user_id) THEN '
            || 'RETURN jsonb_build_object(''state'',''pending_retryable'',''reason'',''verification_required''); END IF; ' || session_anchor);
          EXECUTE src;
        END IF;
      END; $guard$`,
    `DO $guard$ DECLARE src text; anchor text := 't:=clock_timestamp();'; BEGIN
      src:=pg_get_functiondef('game.shooter_verification_append(uuid,uuid,text,integer,integer,integer,text,jsonb,text)'::regprocedure);
      IF position('shooter_lifecycle_no_revival' IN src)=0 THEN
        IF length(src)-length(replace(src,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'shooter append lifecycle anchor missing or ambiguous'; END IF;
        src:=replace(src,anchor,anchor || E'\n-- shooter_lifecycle_no_revival\n'
          || 'IF s.session_id IS NULL OR s.state<>''open'' OR s.lease_until<=t OR s.ticket_redeemed_at IS NULL OR r.upload_deadline<=t THEN PERFORM game.shooter_verification_touch(p_user,p_run); END IF; '
          || 'IF r.session_invalidated_reason IS NOT NULL THEN RETURN jsonb_build_object(''state'',''authorization_denied'',''reason'',r.session_invalidated_reason); END IF;');
        EXECUTE src;
      END IF;
    END; $guard$`,
  ],
});

// 0053, 0055 and 0056 are already applied, so their artifact literals stay.
// This moves the live allowlist onto the vendored campaign bundle. New receipts
// carry that bundle's fingerprint. Stored rows, the 20 Ticket amount, and wager
// settlement are untouched. A fresh database runs the earlier migrations first.
// Applying this twice changes nothing.
HubSchema.register({
  id: "0066_shooter_campaign_artifact",
  statements: [
    `DO $art$
    DECLARE src text;
    BEGIN
      src := pg_get_functiondef('game.issue_shooter_verification_run(uuid,uuid,text,text,date,text,bigint,text)'::regprocedure);
      src := replace(src, 'cea1f88b', '73c6eb0f');
      src := replace(src, '05f7a0a245af921fc65a99588564175c19658e38', '2215995f40d999f31336815296e1e7b7726f932a');
      src := replace(src, '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9', '4968fa64a1be5b74afbf6a788a8438234615996e7d3d82cf657edd8251ab6905');
      IF position('cea1f88b' in src) > 0 OR position('73c6eb0f' in src) = 0
        OR position('05f7a0a245af921fc65a99588564175c19658e38' in src) > 0
        OR position('2215995f40d999f31336815296e1e7b7726f932a' in src) = 0
        OR position('797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9' in src) > 0
        OR position('4968fa64a1be5b74afbf6a788a8438234615996e7d3d82cf657edd8251ab6905' in src) = 0 THEN
        RAISE EXCEPTION 'shooter_campaign_artifact_issue_not_replaced';
      END IF;
      EXECUTE src;

      src := pg_get_functiondef('game.shooter_verification_private_work(jsonb,text)'::regprocedure);
      src := replace(src, 'cea1f88b', '73c6eb0f');
      src := replace(src, '05f7a0a245af921fc65a99588564175c19658e38', '2215995f40d999f31336815296e1e7b7726f932a');
      src := replace(src, '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9', '4968fa64a1be5b74afbf6a788a8438234615996e7d3d82cf657edd8251ab6905');
      IF position('cea1f88b' in src) > 0 OR position('73c6eb0f' in src) = 0
        OR position('05f7a0a245af921fc65a99588564175c19658e38' in src) > 0
        OR position('2215995f40d999f31336815296e1e7b7726f932a' in src) = 0
        OR position('797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9' in src) > 0
        OR position('4968fa64a1be5b74afbf6a788a8438234615996e7d3d82cf657edd8251ab6905' in src) = 0 THEN
        RAISE EXCEPTION 'shooter_campaign_artifact_work_not_replaced';
      END IF;
      EXECUTE src;

      src := pg_get_functiondef('game.settle_shooter_verified_result(uuid,text,text,text,text)'::regprocedure);
      src := replace(src, 'cea1f88b', '73c6eb0f');
      IF position('cea1f88b' in src) > 0 OR position('73c6eb0f' in src) = 0 THEN
        RAISE EXCEPTION 'shooter_campaign_artifact_settlement_not_replaced';
      END IF;
      EXECUTE src;
    END;
    $art$`,
  ],
});
