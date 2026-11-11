// PR10: default-off service authorization and bounded durable RPC receipts.
// No production principals/secrets are inserted, no checkpoint is committed here.
HubSchema.register({
  id: "0053_shooter_verification_internal",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_gateway (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
      global_attempts_per_minute integer CHECK(global_attempts_per_minute BETWEEN 1 AND 1000000),
      account_attempts_per_minute integer CHECK(account_attempts_per_minute BETWEEN 1 AND 100000),
      rate_window timestamptz, rate_attempts integer NOT NULL DEFAULT 0 CHECK(rate_attempts>=0),
      max_requests bigint CHECK(max_requests BETWEEN 1 AND 10000000),
      max_principal_requests bigint CHECK(max_principal_requests BETWEEN 1 AND 1000000),
      max_receipt_bytes bigint CHECK(max_receipt_bytes BETWEEN 20971520 AND 1099511627776),
      max_principal_receipt_bytes bigint CHECK(max_principal_receipt_bytes BETWEEN 20971520 AND 1099511627776),
      retained_requests bigint NOT NULL DEFAULT 0 CHECK(retained_requests>=0),
      reserved_receipt_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_receipt_bytes>=0),
      CHECK(NOT enabled OR (global_attempts_per_minute IS NOT NULL AND account_attempts_per_minute IS NOT NULL AND max_requests IS NOT NULL AND max_principal_requests IS NOT NULL AND max_receipt_bytes IS NOT NULL AND max_principal_receipt_bytes IS NOT NULL))
    )`,
    "INSERT INTO game.shooter_verification_gateway(singleton) VALUES(true) ON CONFLICT DO NOTHING",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_gateway_rate (
      account_id uuid PRIMARY KEY, rate_window timestamptz NOT NULL,
      attempts integer NOT NULL CHECK(attempts>=0)
    )`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_gateway_preflight(a uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE cfg game.shooter_verification_gateway%ROWTYPE; rate game.shooter_verification_gateway_rate%ROWTYPE; win timestamptz;
      BEGIN
        -- No row is created for arbitrary account IDs. Body/token are not parsed.
        IF NOT EXISTS(SELECT 1 FROM game.shooter_verification_principal WHERE account_id=a) THEN
          RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized'); END IF;
        SELECT * INTO cfg FROM game.shooter_verification_gateway WHERE singleton FOR UPDATE;
        IF NOT FOUND OR NOT cfg.enabled OR cfg.global_attempts_per_minute IS NULL OR cfg.account_attempts_per_minute IS NULL THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','gateway_disabled'); END IF;
        win:=clock_timestamp();
        IF cfg.rate_window IS NULL OR cfg.rate_window+interval '1 minute'<=win THEN
          UPDATE game.shooter_verification_gateway SET rate_window=win,rate_attempts=0 WHERE singleton;
          cfg.rate_attempts:=0; cfg.rate_window:=win;
        END IF;
        INSERT INTO game.shooter_verification_gateway_rate(account_id,rate_window,attempts) VALUES(a,win,0) ON CONFLICT DO NOTHING;
        SELECT * INTO rate FROM game.shooter_verification_gateway_rate WHERE account_id=a FOR UPDATE;
        IF rate.rate_window+interval '1 minute'<=win THEN
          UPDATE game.shooter_verification_gateway_rate SET rate_window=win,attempts=0 WHERE account_id=a;
          rate.attempts:=0; rate.rate_window:=win;
        END IF;
        IF cfg.rate_attempts>=cfg.global_attempts_per_minute OR rate.attempts>=cfg.account_attempts_per_minute THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','rate_limited','retryAt',CASE WHEN cfg.rate_attempts>=cfg.global_attempts_per_minute THEN cfg.rate_window+interval '1 minute' ELSE rate.rate_window+interval '1 minute' END); END IF;
        UPDATE game.shooter_verification_gateway SET rate_attempts=rate_attempts+1 WHERE singleton;
        UPDATE game.shooter_verification_gateway_rate SET attempts=attempts+1 WHERE account_id=a;
        RETURN jsonb_build_object('state','ready');
      END; $fn$`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_worker (
      worker_id text PRIMARY KEY CHECK(worker_id ~ '^[A-Za-z0-9_.:@|-]{1,80}$'),
      account_id uuid NOT NULL, UNIQUE(worker_id,account_id)
    )`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_worker_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'shooter_worker_identity_immutable'; END; $fn$`,
    `DO $trigger$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_worker'::regclass AND tgname='shooter_worker_identity_immutable') THEN
        CREATE TRIGGER shooter_worker_identity_immutable BEFORE UPDATE OR DELETE ON game.shooter_verification_worker
          FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_worker_immutable();
      END IF;
    END; $trigger$`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_principal (
      account_id uuid NOT NULL, worker_id text NOT NULL CHECK(worker_id ~ '^[A-Za-z0-9_.:@|-]{1,80}$'),
      key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9_.:@|-]{1,80}$'), token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
      scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 4 AND scopes <@ ARRAY['claim','renew','retry','result']::text[]),
      not_before timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>not_before), revoked_at timestamptz,
      retained_requests bigint NOT NULL DEFAULT 0 CHECK(retained_requests>=0),
      reserved_receipt_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_receipt_bytes>=0),
      PRIMARY KEY(account_id,worker_id,key_id), UNIQUE(worker_id,key_id),
      FOREIGN KEY(worker_id,account_id) REFERENCES game.shooter_verification_worker(worker_id,account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_gateway_receipt (
      account_id uuid NOT NULL, worker_id text NOT NULL, key_id text NOT NULL,
      request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_.:@|-]{1,80}$'),
      operation text NOT NULL CHECK(operation IN ('claim','renew','retry','result')),
      request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
      acknowledgment jsonb NOT NULL CHECK(jsonb_typeof(acknowledgment)='object' AND octet_length(acknowledgment::text)<=20971520),
      created_at timestamptz NOT NULL,
      PRIMARY KEY(worker_id,request_id),
      FOREIGN KEY(account_id,worker_id,key_id) REFERENCES game.shooter_verification_principal(account_id,worker_id,key_id)
    )`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_gateway_receipt_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'shooter_gateway_receipt_immutable'; END; $fn$`,
    `DO $trigger$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_gateway_receipt'::regclass AND tgname='shooter_gateway_receipt_immutable') THEN
        CREATE TRIGGER shooter_gateway_receipt_immutable BEFORE UPDATE OR DELETE ON game.shooter_verification_gateway_receipt
          FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_gateway_receipt_immutable();
      END IF;
    END; $trigger$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_hash_equal(a text,b text)
      RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$ DECLARE d integer:=0; i integer;
      BEGIN IF a IS NULL OR b IS NULL OR length(a)<>64 OR length(b)<>64 THEN RETURN false; END IF;
        FOR i IN 1..64 LOOP d:=d | (ascii(substr(a,i,1)) # ascii(substr(b,i,1))); END LOOP;
        RETURN d=0;
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_private_work(c jsonb,owner_id text)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE r game.shooter_verification_run%ROWTYPE; j game.shooter_verification_job%ROWTYPE;
        b game.shooter_verification_batch%ROWTYPE; issuance jsonb; accepted_before boolean;
      BEGIN
        SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=(c->>'jobId')::uuid;
        SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=j.run_id;
        SELECT * INTO b FROM game.shooter_verification_batch WHERE run_id=j.run_id AND sequence=j.sequence_from;
        SELECT issuance_json::jsonb INTO issuance FROM game.shooter_run WHERE run_id=r.run_id AND user_id=r.user_id AND session_id=r.session_id;
        IF j.job_id IS NULL OR r.run_id IS NULL OR b.run_id IS NULL OR j.state<>'leased' OR j.lease_owner<>owner_id OR j.fencing_token<>(c->>'fence')::bigint
          OR j.expected_revision<>r.revision OR j.continuation_tick<>r.verified_tick OR j.sequence_from<>j.sequence_to
          OR b.request_sha256<>j.input_sha256 OR j.tick0<b.tick0 OR j.tick_end>b.tick0+b.frame_count
          OR jsonb_typeof(issuance)<>'object' OR issuance->>'runId' IS DISTINCT FROM r.run_id
          OR issuance->>'accountId' IS DISTINCT FROM r.user_id::text OR issuance->>'sessionId' IS DISTINCT FROM r.session_id::text
          OR issuance->>'contentFingerprint' IS DISTINCT FROM r.content_fingerprint
          OR (r.checkpoint_json IS NULL AND r.verified_tick<>0) THEN
          RAISE EXCEPTION 'private_work_unavailable';
        END IF;
        IF r.upload_protocol<>2 OR r.simulator_protocol<>1 OR r.checkpoint_schema<>2 OR r.economy_policy<>1
          OR r.artifact_sha256<>'797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9'
          OR r.source_commit<>'05f7a0a245af921fc65a99588564175c19658e38' OR r.content_fingerprint<>'cea1f88b' THEN
          RAISE EXCEPTION 'private_work_unavailable';
        END IF;
        -- Accepted batch exists durably; no client boolean supplies this fact.
        -- PR11 must stop distinct append atomically when terminal is committed.
        IF r.terminal_tick IS NOT NULL AND (to_jsonb(r)->>'terminal_accepted_sequence') IS NULL THEN RAISE EXCEPTION 'private_work_unavailable'; END IF;
        accepted_before:=r.terminal_tick IS NULL OR b.sequence<=(to_jsonb(r)->>'terminal_accepted_sequence')::int;
        RETURN jsonb_build_object('claim',c,
          'manifest',jsonb_build_object('artifact','shooter-sim','sourceCommit',r.source_commit,'sha256',r.artifact_sha256,
            'protocol',r.simulator_protocol,'contentFingerprint',r.content_fingerprint,'uploadProtocol',r.upload_protocol,
            'replayApiVersion',2,'checkpointSchema',r.checkpoint_schema,'economyPolicy',r.economy_policy),
          'issuance',issuance,'checkpoint',r.checkpoint_json,
          'batch',jsonb_build_object('protocol',2,'runId',b.run_id,'sequence',b.sequence,'tick0',b.tick0,'n',b.frame_count,'frames',b.frames,'actions',b.actions),
          'accepted',jsonb_build_object('runId',b.run_id,'sequence',b.sequence,'tick0',b.tick0,'n',b.frame_count,'sha256',b.request_sha256,
            'binding',jsonb_build_object('runId',r.run_id,'accountId',r.user_id,'sessionId',r.session_id,'day',issuance->>'day'),
            'acceptedBeforeTerminal',accepted_before),'maxWorkFrames',least(4096,j.tick_end-j.continuation_tick));
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_commit_worker_result(a uuid,w text,k text,rid text,digest text,body jsonb)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE c jsonb; ack jsonb; job game.shooter_verification_job%ROWTYPE; run game.shooter_verification_run%ROWTYPE;
      BEGIN
            c:=body->'result'->'binding';
            -- Match the scheduler lock order before evaluating the live fence.
            PERFORM 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
            SELECT * INTO job FROM game.shooter_verification_job WHERE job_id=(c->>'jobId')::uuid;
            PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=job.run_id) FOR UPDATE;
            SELECT * INTO run FROM game.shooter_verification_run WHERE run_id=job.run_id FOR UPDATE;
            SELECT * INTO job FROM game.shooter_verification_job WHERE job_id=(c->>'jobId')::uuid FOR UPDATE;
            IF NOT game.shooter_verification_fence_live(job.job_id,w,(c->>'fence')::bigint,(c->>'expectedRevision')::bigint)
              OR c->>'runId' IS DISTINCT FROM job.run_id OR c->>'accountId' IS DISTINCT FROM run.user_id::text
              OR c->>'sessionId' IS DISTINCT FROM run.session_id::text OR c->>'inputSha256' IS DISTINCT FROM job.input_sha256
              OR (c->>'initialRevision')::bigint IS DISTINCT FROM job.initial_revision OR (c->>'tick0')::int IS DISTINCT FROM job.tick0
              OR (c->>'tickEnd')::int IS DISTINCT FROM job.tick_end OR (c->>'continuationTick')::int IS DISTINCT FROM job.continuation_tick
              OR body->'manifest'->>'sha256' IS DISTINCT FROM run.artifact_sha256
              OR body->'manifest'->>'sourceCommit' IS DISTINCT FROM run.source_commit
              OR (body->'manifest'->>'economyPolicy')::int IS DISTINCT FROM run.economy_policy THEN
              ack:=jsonb_build_object('state','authorization_denied','reason','stale_or_unbound_result');
            ELSE
              -- PR11 must supply authoritative CP/revision/counter commit. PR10
              -- deliberately neither stores supplied CP nor completes a job.
              ack:=jsonb_build_object('state','pending_retryable','reason','result_commit_unavailable','pendingDependency','PR11');
            END IF;
        RETURN ack;
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_internal(a uuid,w text,k text,h text,op text,rid text,digest text,body jsonb)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE p game.shooter_verification_principal%ROWTYPE; cfg game.shooter_verification_gateway%ROWTYPE;
        old game.shooter_verification_gateway_receipt%ROWTYPE; ack jsonb; t timestamptz;
      BEGIN
        -- Lock order principal -> gateway config -> scheduler -> account -> run -> job.
        -- Preflight is only an optimization; authorization is rechecked here.
        SELECT * INTO p FROM game.shooter_verification_principal WHERE account_id=a AND worker_id=w AND key_id=k FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized'); END IF;
        SELECT * INTO cfg FROM game.shooter_verification_gateway WHERE singleton FOR UPDATE;
        t:=clock_timestamp();
        IF cfg.singleton IS NULL OR NOT cfg.enabled THEN RETURN jsonb_build_object('state','pending_retryable','reason','gateway_disabled'); END IF;
        IF p.revoked_at IS NOT NULL OR p.not_before>t OR p.expires_at<=t OR NOT op=ANY(p.scopes)
          OR NOT game.shooter_verification_hash_equal(p.token_sha256,h) THEN
          RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');
        END IF;
        IF op IS NULL OR rid IS NULL OR digest IS NULL OR rid !~ '^[A-Za-z0-9_.:@|-]{1,80}$' OR digest !~ '^[0-9a-f]{64}$' OR op NOT IN ('claim','renew','retry','result') THEN
          RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
        SELECT * INTO old FROM game.shooter_verification_gateway_receipt WHERE worker_id=w AND request_id=rid;
        IF FOUND THEN
          IF old.operation<>op OR old.request_sha256<>digest THEN RETURN jsonb_build_object('state','invalid','reason','request_conflict'); END IF;
          RETURN old.acknowledgment;
        END IF;
        -- Reserve a complete maximum20MiB response per retained receipt. No GC.
        IF cfg.retained_requests>=cfg.max_requests OR p.retained_requests>=cfg.max_principal_requests
          OR cfg.reserved_receipt_bytes+20971520>cfg.max_receipt_bytes OR p.reserved_receipt_bytes+20971520>cfg.max_principal_receipt_bytes THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','gateway_capacity'); END IF;
        BEGIN
          IF op='claim' THEN
            ack:=game.shooter_verification_claim(w);
            IF ack->>'state'='leased' THEN ack:=ack || jsonb_build_object('work',game.shooter_verification_private_work(ack->'claim',w)); END IF;
          ELSIF op='renew' THEN
            ack:=game.shooter_verification_renew((body->>'jobId')::uuid,w,(body->>'fence')::bigint,(body->>'expectedRevision')::bigint);
          ELSIF op='retry' THEN
            ack:=game.shooter_verification_retry((body->>'jobId')::uuid,w,(body->>'fence')::bigint,(body->>'expectedRevision')::bigint,body->>'reason');
          ELSE
            ack:=game.shooter_verification_commit_worker_result(a,w,k,rid,digest,body);
          END IF;
          -- A claim/renew can have waited on downstream locks across key expiry.
          -- Raising inside this subtransaction rolls back ALL queue mutations.
          IF p.expires_at<=clock_timestamp() OR p.not_before>clock_timestamp() THEN RAISE EXCEPTION 'gateway_auth_expired'; END IF;
          IF octet_length(ack::text)>20971520 THEN RAISE EXCEPTION 'private_work_unavailable'; END IF;
          INSERT INTO game.shooter_verification_gateway_receipt(account_id,worker_id,key_id,request_id,operation,request_sha256,acknowledgment,created_at)
            VALUES(a,w,k,rid,op,digest,ack,clock_timestamp());
          UPDATE game.shooter_verification_gateway SET retained_requests=retained_requests+1,reserved_receipt_bytes=reserved_receipt_bytes+20971520 WHERE singleton;
          UPDATE game.shooter_verification_principal SET retained_requests=retained_requests+1,reserved_receipt_bytes=reserved_receipt_bytes+20971520
            WHERE account_id=a AND worker_id=w AND key_id=k;
          RETURN ack;
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM='gateway_auth_expired' THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');
          ELSIF SQLERRM='private_work_unavailable' THEN RETURN jsonb_build_object('state','pending_retryable','reason','private_work_unavailable');
          ELSE RAISE; END IF;
        END;
      END; $fn$`,
  ],
});
