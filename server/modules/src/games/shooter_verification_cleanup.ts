// PR17: dormant, scoped operational tools. No operator RPC is registered.
namespace ShooterVerificationCleanup {
  function stable(v: unknown): string {
    if (v===null || typeof v!=="object") return JSON.stringify(v);
    if (Array.isArray(v)) return "["+v.map(stable).join(",")+"]";
    var o=v as {[key:string]:unknown};
    return "{"+Object.keys(o).sort().map(function(k){return JSON.stringify(k)+":"+stable(o[k]);}).join(",")+"}";
  }
  export function operate(ctx:nkruntime.Context,nk:nkruntime.Nakama,payload:string,operation:string):string {
    if (!ctx.userId || !/^[0-9a-f-]{36}$/.test(ctx.userId)) return JSON.stringify({state:"authorization_denied"});
    if (["inspect","reap","requeue","certify","retire"].indexOf(operation)<0 || !payload || payload.length>4096 || nk.stringToBinary(payload).byteLength>4096) return JSON.stringify({state:"invalid",reason:"malformed"});
    try {
      var b=JSON.parse(payload) as {[key:string]:unknown};
      if (Object.keys(b).length!==5 || ["body","keyId","operatorId","requestId","token"].some(function(k){return !Object.prototype.hasOwnProperty.call(b,k);}) || typeof b.operatorId!=="string" || typeof b.keyId!=="string" || typeof b.requestId!=="string"
        || !/^[A-Za-z0-9_.:@|-]{1,80}$/.test(b.operatorId) || !/^[A-Za-z0-9_.:@|-]{1,80}$/.test(b.keyId) || !/^[A-Za-z0-9_.:@|-]{1,80}$/.test(b.requestId)
        || typeof b.token!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(b.token) || !b.body || typeof b.body!=="object" || Array.isArray(b.body)) return JSON.stringify({state:"invalid",reason:"malformed"});
      var result=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_maintain($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::jsonb)::text AS result",
        [ctx.userId,b.operatorId,b.keyId,nk.sha256Hash("shooter-operator-v1\n"+b.token),operation,b.requestId,nk.sha256Hash(operation+"\n"+stable(b.body)),JSON.stringify(b.body)]);
      return JSON.stringify(result);
    } catch (_e) { return JSON.stringify({state:"pending_retryable",reason:"operator_unavailable"}); }
  }
}

HubSchema.register({
  id:"0057_shooter_verification_retention",
  statements:[
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_retention_config(
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
      max_operations bigint CHECK(max_operations BETWEEN 1 AND 1000000),max_operator_operations bigint CHECK(max_operator_operations BETWEEN 1 AND 100000),
      max_audit_bytes bigint CHECK(max_audit_bytes BETWEEN 65536 AND 1099511627776),max_operator_audit_bytes bigint CHECK(max_operator_audit_bytes BETWEEN 65536 AND 1099511627776),
      operations_per_minute integer CHECK(operations_per_minute BETWEEN 1 AND 100000),operator_operations_per_minute integer CHECK(operator_operations_per_minute BETWEEN 1 AND 10000),
      minimum_retention_seconds integer CHECK(minimum_retention_seconds BETWEEN 0 AND 31536000),
      retained_operations bigint NOT NULL DEFAULT 0 CHECK(retained_operations>=0),reserved_audit_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_audit_bytes>=0),
      rate_window timestamptz NOT NULL DEFAULT clock_timestamp(),rate_count integer NOT NULL DEFAULT 0 CHECK(rate_count>=0),
      CHECK(NOT enabled OR(max_operations IS NOT NULL AND max_operator_operations IS NOT NULL AND max_audit_bytes IS NOT NULL
        AND max_operator_audit_bytes IS NOT NULL AND operations_per_minute IS NOT NULL AND operator_operations_per_minute IS NOT NULL AND minimum_retention_seconds IS NOT NULL))
    )`,
    "INSERT INTO game.shooter_verification_retention_config(singleton) VALUES(true) ON CONFLICT DO NOTHING",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_operator(
      operator_id text PRIMARY KEY CHECK(operator_id~'^[A-Za-z0-9_.:@|-]{1,80}$'),account_id uuid NOT NULL,UNIQUE(operator_id,account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_operator_key(
      operator_id text NOT NULL,account_id uuid NOT NULL,key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9_.:@|-]{1,80}$'),
      token_sha256 text NOT NULL CHECK(token_sha256~'^[0-9a-f]{64}$'),scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 5 AND scopes<@ARRAY['inspect','reap','requeue','certify','retire']::text[]),
      not_before timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>not_before),revoked_at timestamptz,
      PRIMARY KEY(operator_id,key_id),FOREIGN KEY(operator_id,account_id) REFERENCES game.shooter_verification_operator(operator_id,account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_operator_usage(
      operator_id text PRIMARY KEY REFERENCES game.shooter_verification_operator(operator_id),
      retained_operations bigint NOT NULL DEFAULT 0 CHECK(retained_operations>=0),reserved_audit_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_audit_bytes>=0),
      rate_window timestamptz NOT NULL DEFAULT clock_timestamp(),rate_count integer NOT NULL DEFAULT 0 CHECK(rate_count>=0)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_operator_audit(
      audit_id uuid NOT NULL UNIQUE,operator_id text NOT NULL,account_id uuid NOT NULL,key_id text NOT NULL,request_id text NOT NULL CHECK(request_id~'^[A-Za-z0-9_.:@|-]{1,80}$'),
      operation text NOT NULL CHECK(operation IN('inspect','reap','requeue','certify','retire')),request_sha256 text NOT NULL CHECK(request_sha256~'^[0-9a-f]{64}$'),
      acknowledgment jsonb NOT NULL CHECK(jsonb_typeof(acknowledgment)='object' AND octet_length(acknowledgment::text)<=65536),recorded_at timestamptz NOT NULL,
      PRIMARY KEY(operator_id,request_id),FOREIGN KEY(operator_id,key_id) REFERENCES game.shooter_verification_operator_key(operator_id,key_id),
      FOREIGN KEY(operator_id,account_id) REFERENCES game.shooter_verification_operator(operator_id,account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_restore_proof(
      proof_id uuid PRIMARY KEY,audit_id uuid NOT NULL REFERENCES game.shooter_verification_operator_audit(audit_id) DEFERRABLE INITIALLY DEFERRED,
      run_id text NOT NULL REFERENCES game.shooter_verification_run(run_id),revision bigint NOT NULL CHECK(revision>0),verified_tick integer NOT NULL CHECK(verified_tick BETWEEN 1 AND 162000),
      checkpoint_sha256 text NOT NULL CHECK(checkpoint_sha256~'^[0-9a-f]{64}$'),artifact_sha256 text NOT NULL CHECK(artifact_sha256~'^[0-9a-f]{64}$'),source_commit text NOT NULL CHECK(source_commit~'^[0-9a-f]{40}$'),
      backup_id text NOT NULL CHECK(backup_id~'^[A-Za-z0-9_.:@|-]{1,80}$'),backup_sha256 text NOT NULL CHECK(backup_sha256~'^[0-9a-f]{64}$'),restore_receipt_sha256 text NOT NULL CHECK(restore_receipt_sha256~'^[0-9a-f]{64}$'),
      certified_at timestamptz NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS shooter_verification_restore_run ON game.shooter_verification_restore_proof(run_id,revision,verified_tick)",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_recovery_grant(
      job_id uuid NOT NULL REFERENCES game.shooter_verification_job(job_id),grant_number integer NOT NULL CHECK(grant_number BETWEEN 1 AND 4),
      extra_attempts integer NOT NULL CHECK(extra_attempts BETWEEN 1 AND 8),budget_after integer NOT NULL CHECK(budget_after BETWEEN 1 AND 32),
      attempts_at_grant integer NOT NULL CHECK(attempts_at_grant>=0),fence_at_grant bigint NOT NULL CHECK(fence_at_grant>=0),revision_at_grant bigint NOT NULL CHECK(revision_at_grant>=0),
      audit_id uuid NOT NULL UNIQUE REFERENCES game.shooter_verification_operator_audit(audit_id) DEFERRABLE INITIALLY DEFERRED,granted_at timestamptz NOT NULL,
      PRIMARY KEY(job_id,grant_number)
    )`,
    "ALTER TABLE game.shooter_verification_job ADD COLUMN recovery_budget integer NOT NULL DEFAULT 0 CHECK(recovery_budget BETWEEN 0 AND 32)",
    "ALTER TABLE game.shooter_verification_job ADD COLUMN recovery_grants integer NOT NULL DEFAULT 0 CHECK(recovery_grants BETWEEN 0 AND 4)",
    "ALTER TABLE game.shooter_verification_job DROP CONSTRAINT shooter_verification_job_attempts",
    "ALTER TABLE game.shooter_verification_job ADD CONSTRAINT shooter_verification_job_attempts CHECK(attempts<=max_attempts+recovery_budget AND(state<>'leased' OR(attempts>0 AND fencing_token>0)))",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_recovery_budget_guard()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF ROW(NEW.recovery_budget,NEW.recovery_grants) IS DISTINCT FROM ROW(OLD.recovery_budget,OLD.recovery_grants) THEN
          IF NEW.recovery_budget<=OLD.recovery_budget OR NEW.recovery_grants<>OLD.recovery_grants+1 OR NOT EXISTS(
            SELECT 1 FROM game.shooter_verification_recovery_grant g WHERE g.job_id=OLD.job_id AND g.grant_number=NEW.recovery_grants
              AND g.budget_after=NEW.recovery_budget AND g.extra_attempts=NEW.recovery_budget-OLD.recovery_budget
              AND g.attempts_at_grant=OLD.attempts AND g.fence_at_grant=OLD.fencing_token AND g.revision_at_grant=OLD.expected_revision) THEN
            RAISE EXCEPTION 'shooter_recovery_budget_unaudited'; END IF;
        END IF;
        RETURN NEW;
      END; $fn$`,
    `CREATE TRIGGER shooter_verification_recovery_budget_guard BEFORE UPDATE ON game.shooter_verification_job
      FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_recovery_budget_guard()`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_retention_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'shooter_retention_evidence_immutable'; END; $fn$`,
    `DO $triggers$ DECLARE n text; BEGIN
      FOREACH n IN ARRAY ARRAY['operator','operator_audit','restore_proof','recovery_grant'] LOOP
        EXECUTE format('CREATE TRIGGER shooter_retention_evidence_immutable BEFORE UPDATE OR DELETE ON game.%I FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_retention_immutable()','shooter_verification_'||n);
      END LOOP;
    END; $triggers$`,
    // Original attempt ceilings are immutable. Only these reviewed decision
    // sites use the additional audited hard-bounded budget; any drift fails boot.
    `DO $budget$ DECLARE x record; src text; i integer; p integer; BEGIN
      FOR x IN SELECT * FROM(VALUES
        ('game.shooter_verification_claim(text)',ARRAY['j.attempts>=j.max_attempts'],ARRAY['j.attempts>=(j.max_attempts+j.recovery_budget)'],ARRAY[2]),
        ('game.shooter_verification_retry(uuid,text,bigint,bigint,text)',ARRAY['attempts>=max_attempts'],ARRAY['attempts>=(max_attempts+recovery_budget)'],ARRAY[1]),
        ('game.shooter_verification_retry(uuid,text,bigint,bigint,text,text)',ARRAY['j.attempts>=j.max_attempts'],ARRAY['j.attempts>=(j.max_attempts+j.recovery_budget)'],ARRAY[1]),
        ('game.shooter_verification_commit_worker_result(uuid,text,text,text,text,jsonb)',ARRAY['attempts>=max_attempts','job.attempts>=job.max_attempts'],ARRAY['attempts>=(max_attempts+recovery_budget)','job.attempts>=(job.max_attempts+job.recovery_budget)'],ARRAY[1,1])
      )v(signature,anchors,replacements,counts) LOOP
        src:=pg_get_functiondef(x.signature::regprocedure);
        FOR i IN 1..array_length(x.anchors,1) LOOP
          IF length(src)-length(replace(src,x.anchors[i],''))<>length(x.anchors[i])*x.counts[i] THEN
            RAISE EXCEPTION 'shooter recovery budget anchor missing or ambiguous: %',x.signature; END IF;
          src:=replace(src,x.anchors[i],x.replacements[i]);
        END LOOP;
        p:=position('BEGIN' IN src); IF p=0 THEN RAISE EXCEPTION 'shooter recovery body missing'; END IF;
        src:=substr(src,1,p+4)||E'\n-- shooter_recovery_budget_v1\n'||substr(src,p+5); EXECUTE src;
      END LOOP;
    END; $budget$`,
    "ALTER TABLE game.shooter_verification_batch ADD COLUMN payload_retired_at timestamptz",
    "ALTER TABLE game.shooter_verification_batch ALTER COLUMN frames DROP NOT NULL",
    "ALTER TABLE game.shooter_verification_batch ALTER COLUMN actions DROP NOT NULL",
    "ALTER TABLE game.shooter_verification_batch ADD CONSTRAINT shooter_verification_payload_retirement CHECK((frames IS NULL)=(actions IS NULL) AND(frames IS NULL)=(payload_retired_at IS NOT NULL))",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_payload_retirement(
      run_id text NOT NULL,sequence integer NOT NULL,proof_id uuid NOT NULL REFERENCES game.shooter_verification_restore_proof(proof_id),
      audit_id uuid NOT NULL REFERENCES game.shooter_verification_operator_audit(audit_id) DEFERRABLE INITIALLY DEFERRED,
      request_sha256 text NOT NULL CHECK(request_sha256~'^[0-9a-f]{64}$'),frame_bytes integer NOT NULL CHECK(frame_bytes BETWEEN 1 AND 2097152),action_bytes integer NOT NULL CHECK(action_bytes BETWEEN 2 AND 65536),
      retired_at timestamptz NOT NULL,acknowledgment jsonb NOT NULL CHECK(octet_length(acknowledgment::text)<=2048),PRIMARY KEY(run_id,sequence),
      FOREIGN KEY(run_id,sequence) REFERENCES game.shooter_verification_batch(run_id,sequence)
    )`,
    `CREATE TRIGGER shooter_retention_evidence_immutable BEFORE UPDATE OR DELETE ON game.shooter_verification_payload_retirement
      FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_retention_immutable()`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_batch_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
        IF TG_OP='UPDATE' THEN
        IF OLD.frames IS NOT NULL AND NEW.frames IS NULL AND NEW.actions IS NULL AND NEW.payload_retired_at IS NOT NULL
          AND to_jsonb(NEW)-ARRAY['frames','actions','payload_retired_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['frames','actions','payload_retired_at']
          AND EXISTS(SELECT 1 FROM game.shooter_verification_payload_retirement e JOIN game.shooter_verification_restore_proof p USING(proof_id)
            WHERE e.run_id=OLD.run_id AND e.sequence=OLD.sequence AND e.request_sha256=OLD.request_sha256 AND e.retired_at=NEW.payload_retired_at
              AND e.frame_bytes=OLD.encoded_bytes AND e.action_bytes=octet_length(OLD.actions::text) AND p.run_id=OLD.run_id AND p.verified_tick>=OLD.tick0+OLD.frame_count) THEN
          RETURN NEW;
        END IF; END IF;
        RAISE EXCEPTION 'shooter_verification_batch_immutable';
      END; $fn$`,
    "ALTER TABLE game.shooter_verification_admission ADD COLUMN retained_action_payload_bytes bigint NOT NULL DEFAULT 0 CHECK(retained_action_payload_bytes>=0 AND retained_action_payload_bytes<=retained_batches*65536)",
    "ALTER TABLE game.shooter_verification_admission_account ADD COLUMN retained_action_payload_bytes bigint NOT NULL DEFAULT 0 CHECK(retained_action_payload_bytes>=0 AND retained_action_payload_bytes<=retained_batches*65536)",
    "ALTER TABLE game.shooter_verification_admission ADD COLUMN retired_frame_bytes bigint NOT NULL DEFAULT 0 CHECK(retired_frame_bytes>=0)",
    "ALTER TABLE game.shooter_verification_admission_account ADD COLUMN retired_frame_bytes bigint NOT NULL DEFAULT 0 CHECK(retired_frame_bytes>=0)",
    "UPDATE game.shooter_verification_admission SET retained_action_payload_bytes=(SELECT COALESCE(sum(octet_length(actions::text)),0) FROM game.shooter_verification_batch) WHERE singleton",
    `UPDATE game.shooter_verification_admission_account a SET retained_action_payload_bytes=(SELECT COALESCE(sum(octet_length(b.actions::text)),0)
      FROM game.shooter_verification_batch b JOIN game.shooter_verification_run r USING(run_id) WHERE r.user_id=a.user_id)`,
    // Keep the historical implementation/0056 sticky-auth patch intact under
    // a private alias. The wrapper preserves retries after payload retirement.
    "ALTER FUNCTION game.shooter_verification_append(uuid,uuid,text,integer,integer,integer,text,jsonb,text) RENAME TO shooter_verification_append_payload_v1",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_append(p_user uuid,p_session uuid,p_run text,p_sequence integer,p_tick0 integer,p_n integer,p_frames text,p_actions jsonb,p_digest text)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE b game.shooter_verification_batch%ROWTYPE;r game.shooter_verification_run%ROWTYPE;s game.game_session%ROWTYPE;
        result jsonb;t timestamptz;had boolean;action_bytes integer;
      BEGIN
        PERFORM 1 FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
        PERFORM 1 FROM game.shooter_verification_admission_account WHERE user_id=p_user FOR UPDATE;
        SELECT * INTO s FROM game.game_session WHERE session_id=p_session AND user_id=p_user FOR UPDATE;
        SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run AND user_id=p_user AND session_id=p_session FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid','reason','unknown_run'); END IF;
        SELECT * INTO b FROM game.shooter_verification_batch WHERE run_id=p_run AND sequence=p_sequence;had:=FOUND;
        IF had AND b.payload_retired_at IS NOT NULL THEN
          t:=clock_timestamp();
          IF s.session_id IS NULL OR s.state<>'open' OR s.lease_until<=t OR s.ticket_redeemed_at IS NULL OR r.upload_deadline<=t THEN
            PERFORM game.shooter_verification_touch(p_user,p_run);
            SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=p_run;
          END IF;
          IF r.session_invalidated_reason IS NOT NULL THEN RETURN jsonb_build_object('state','authorization_denied','reason',r.session_invalidated_reason); END IF;
          IF s.session_id IS NULL OR s.game_id<>'sproto-shooter' OR s.state<>'open' OR s.ticket_redeemed_at IS NULL THEN RETURN jsonb_build_object('state','authorization_denied','reason','session_closed'); END IF;
          IF s.lease_until<=t THEN RETURN jsonb_build_object('state','authorization_denied','reason','session_expired'); END IF;
          IF r.upload_deadline<=t THEN RETURN jsonb_build_object('state','authorization_denied','reason','upload_expired'); END IF;
          IF p_digest=b.request_sha256 AND p_tick0=b.tick0 AND p_n=b.frame_count AND octet_length(p_frames)=b.encoded_bytes
            AND jsonb_typeof(p_actions)='array' AND jsonb_array_length(p_actions)=b.action_count THEN RETURN b.received_ack; END IF;
          RETURN jsonb_build_object('state','invalid','reason','sequence_conflict');
        END IF;
        result:=game.shooter_verification_append_payload_v1(p_user,p_session,p_run,p_sequence,p_tick0,p_n,p_frames,p_actions,p_digest);
        IF NOT had AND result->>'state'='received' THEN
          action_bytes:=octet_length(p_actions::text);
          UPDATE game.shooter_verification_admission SET retained_action_payload_bytes=retained_action_payload_bytes+action_bytes WHERE singleton;
          UPDATE game.shooter_verification_admission_account SET retained_action_payload_bytes=retained_action_payload_bytes+action_bytes WHERE user_id=p_user;
        END IF;
        RETURN result;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state','pending_retryable','reason','database_issue');
      END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_maintain(actor uuid,op_id text,key text,token_hash text,operation text,rid text,digest text,body jsonb)
      RETURNS jsonb LANGUAGE plpgsql AS $fn$
      DECLARE principal game.shooter_verification_operator_key%ROWTYPE;cfg game.shooter_verification_retention_config%ROWTYPE;
        usage game.shooter_verification_operator_usage%ROWTYPE;old game.shooter_verification_operator_audit%ROWTYPE;
        r game.shooter_verification_run%ROWTYPE;j game.shooter_verification_job%ROWTYPE;b game.shooter_verification_batch%ROWTYPE;
        proof game.shooter_verification_restore_proof%ROWTYPE;evidence game.shooter_verification_payload_retirement%ROWTYPE;
        aid uuid:=gen_random_uuid();pid uuid;item record;t timestamptz;ack jsonb;target text;did integer:=0;extra integer;delay_seconds integer;
      BEGIN
        SELECT * INTO principal FROM game.shooter_verification_operator_key WHERE operator_id=op_id AND key_id=key AND account_id=actor FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','authorization_denied','reason','operator_authorization'); END IF;
        t:=clock_timestamp();
        IF principal.revoked_at IS NOT NULL OR principal.not_before>t OR principal.expires_at<=t OR NOT operation=ANY(principal.scopes)
          OR NOT game.shooter_verification_hash_equal(principal.token_sha256,token_hash) THEN RETURN jsonb_build_object('state','authorization_denied','reason','operator_authorization'); END IF;
        SELECT * INTO cfg FROM game.shooter_verification_retention_config WHERE singleton FOR UPDATE;
        IF NOT cfg.enabled THEN RETURN jsonb_build_object('state','pending_retryable','reason','retention_disabled'); END IF;
        IF operation NOT IN('inspect','reap','requeue','certify','retire') OR rid IS NULL OR rid!~'^[A-Za-z0-9_.:@|-]{1,80}$'
          OR digest IS NULL OR digest!~'^[0-9a-f]{64}$' OR body IS NULL OR jsonb_typeof(body)<>'object' OR octet_length(body::text)>4096 THEN
          RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
        SELECT * INTO old FROM game.shooter_verification_operator_audit WHERE operator_id=op_id AND request_id=rid;
        IF FOUND THEN
          IF old.operation<>operation OR old.request_sha256<>digest THEN RETURN jsonb_build_object('state','invalid','reason','request_conflict'); END IF;
          RETURN old.acknowledgment;
        END IF;
        INSERT INTO game.shooter_verification_operator_usage(operator_id) VALUES(op_id) ON CONFLICT DO NOTHING;
        SELECT * INTO usage FROM game.shooter_verification_operator_usage WHERE operator_id=op_id FOR UPDATE;
        t:=clock_timestamp();
        IF cfg.rate_window+interval '1 minute'<=t THEN cfg.rate_window:=t;cfg.rate_count:=0; END IF;
        IF usage.rate_window+interval '1 minute'<=t THEN usage.rate_window:=t;usage.rate_count:=0; END IF;
        IF cfg.rate_count>=cfg.operations_per_minute OR usage.rate_count>=cfg.operator_operations_per_minute THEN RETURN jsonb_build_object('state','pending_retryable','reason','operator_rate_limited'); END IF;
        UPDATE game.shooter_verification_retention_config SET rate_window=cfg.rate_window,rate_count=cfg.rate_count+1 WHERE singleton;
        UPDATE game.shooter_verification_operator_usage SET rate_window=usage.rate_window,rate_count=usage.rate_count+1 WHERE operator_id=op_id;
        IF cfg.retained_operations>=cfg.max_operations OR usage.retained_operations>=cfg.max_operator_operations
          OR cfg.reserved_audit_bytes+65536>cfg.max_audit_bytes OR usage.reserved_audit_bytes+65536>cfg.max_operator_audit_bytes THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','operator_capacity'); END IF;
        BEGIN
          IF operation='inspect' THEN
            IF body-ARRAY['runId']<>'{}'::jsonb OR NOT body?'runId' THEN RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
            SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=body->>'runId';
            IF NOT FOUND THEN ack:=jsonb_build_object('state','invalid','reason','unknown_run');
            ELSE
              ack:=jsonb_build_object('state','inspected','runId',r.run_id,'revision',r.revision,'lifecycle',r.lifecycle,
                'acceptedTick',r.accepted_tick,'verifiedTick',r.verified_tick,'simulationTick',r.simulation_tick,'paymentState',r.payment_state,'operationalReason',r.operational_reason,
                'jobs',(SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') FROM(SELECT job_id,state,tick0,tick_end,continuation_tick,expected_revision,attempts,max_attempts,recovery_budget,recovery_grants,fencing_token,last_error
                  FROM game.shooter_verification_job WHERE run_id=r.run_id ORDER BY created_at DESC,job_id LIMIT 32)q));
            END IF;
          ELSIF operation='reap' THEN
            IF body-ARRAY['limit']<>'{}'::jsonb OR COALESCE(body->>'limit','')!~'^[0-9]{1,2}$' OR (body->>'limit')::int NOT BETWEEN 1 AND 32 THEN RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
            PERFORM 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
            FOR item IN SELECT job_id,run_id FROM game.shooter_verification_job WHERE state='leased' AND lease_until<=clock_timestamp() ORDER BY lease_until,job_id LIMIT (body->>'limit')::int LOOP
              PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=item.run_id) FOR UPDATE;
              SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=item.run_id FOR UPDATE;
              SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=item.job_id FOR UPDATE;t:=clock_timestamp();
              IF j.state<>'leased' OR j.lease_until>t THEN CONTINUE; END IF;
              INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason) VALUES(j.job_id,j.fencing_token,'lease_expired','lease_expired') ON CONFLICT DO NOTHING;
              SELECT LEAST(retry_max_seconds,retry_base_seconds*power(2,LEAST(j.attempts-1,16)))::int INTO delay_seconds FROM game.shooter_verification_scheduler WHERE singleton;
              UPDATE game.shooter_verification_job SET state=CASE WHEN attempts>=max_attempts+recovery_budget THEN 'quarantined' ELSE 'retry_wait' END,
                lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,next_attempt_at=t+make_interval(secs=>delay_seconds),last_error='lease_expired',updated_at=t WHERE job_id=j.job_id;
              IF j.attempts>=j.max_attempts+j.recovery_budget THEN UPDATE game.shooter_verification_run SET lifecycle=CASE WHEN lifecycle IN('open','sealed','quarantined') THEN 'quarantined' ELSE lifecycle END,
                operational_reason='attempts_exhausted',updated_at=t WHERE run_id=r.run_id; END IF;
              did:=did+1;
            END LOOP;
            ack:=jsonb_build_object('state','reaped','count',did);
          ELSE
            IF operation='requeue' THEN
              IF body-ARRAY['jobId','expectedRevision','expectedTick','extraAttempts']<>'{}'::jsonb OR NOT(body?&ARRAY['jobId','expectedRevision','expectedTick','extraAttempts']) THEN RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
              SELECT run_id INTO target FROM game.shooter_verification_job WHERE job_id=(body->>'jobId')::uuid;
            ELSE target:=body->>'runId'; END IF;
            IF operation='retire' THEN
              PERFORM 1 FROM game.shooter_verification_admission WHERE singleton FOR UPDATE;
              PERFORM 1 FROM game.shooter_verification_admission_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=target) FOR UPDATE;
            END IF;
            PERFORM 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
            PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=target) FOR UPDATE;
            SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=target FOR UPDATE;t:=clock_timestamp();
            IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid','reason','unknown_run'); END IF;
            IF (body->>'expectedRevision')::bigint IS DISTINCT FROM r.revision THEN RETURN jsonb_build_object('state','pending_retryable','reason','revision_conflict'); END IF;
            IF operation='requeue' THEN
              SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=(body->>'jobId')::uuid FOR UPDATE;extra:=(body->>'extraAttempts')::int;
              IF j.state<>'quarantined' OR r.lifecycle='invalid' OR j.expected_revision<>r.revision OR j.continuation_tick<>r.verified_tick
                OR (body->>'expectedTick')::int IS DISTINCT FROM r.verified_tick OR r.verified_tick>=j.tick_end THEN
                RETURN jsonb_build_object('state','pending_retryable','reason','predecessor_conflict'); END IF;
              IF extra NOT BETWEEN 1 AND 8 OR j.recovery_grants>=4 OR j.recovery_budget+extra>32 THEN RETURN jsonb_build_object('state','pending_retryable','reason','recovery_budget_exhausted'); END IF;
              IF r.checkpoint_json IS NOT NULL AND r.checkpoint_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.checkpoint_json::text,'UTF8')),'hex') THEN RETURN jsonb_build_object('state','pending_retryable','reason','checkpoint_unavailable'); END IF;
              INSERT INTO game.shooter_verification_recovery_grant(job_id,grant_number,extra_attempts,budget_after,attempts_at_grant,fence_at_grant,revision_at_grant,audit_id,granted_at)
                VALUES(j.job_id,j.recovery_grants+1,extra,j.recovery_budget+extra,j.attempts,j.fencing_token,r.revision,aid,t);
              UPDATE game.shooter_verification_job SET recovery_budget=recovery_budget+extra,recovery_grants=recovery_grants+1,state='ready',next_attempt_at=t,last_error=NULL,updated_at=t WHERE job_id=j.job_id;
              UPDATE game.shooter_verification_run SET lifecycle=CASE WHEN lifecycle IN('open','sealed','quarantined') THEN CASE WHEN upload_deadline<=t OR admission_closed_reason IS NOT NULL OR session_invalidated_reason IS NOT NULL THEN 'expired' ELSE 'sealed' END ELSE lifecycle END,
                sealed_sequence=COALESCE(sealed_sequence,accepted_sequence),sealed_tick=COALESCE(sealed_tick,accepted_tick),operational_reason=NULL,updated_at=t WHERE run_id=r.run_id;
              ack:=jsonb_build_object('state','requeued','jobId',j.job_id,'runId',r.run_id,'attempts',j.attempts,'fence',j.fencing_token,'originalMaxAttempts',j.max_attempts,'recoveryBudget',j.recovery_budget+extra,'grantNumber',j.recovery_grants+1);
            ELSIF operation='certify' THEN
              IF body-ARRAY['runId','expectedRevision','checkpointSha256','backupId','backupSha256','restoreReceiptSha256']<>'{}'::jsonb OR NOT(body?&ARRAY['runId','expectedRevision','checkpointSha256','backupId','backupSha256','restoreReceiptSha256']) THEN RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
              IF r.checkpoint_json IS NULL OR r.verified_tick<1 OR body->>'checkpointSha256' IS DISTINCT FROM r.checkpoint_sha256
                OR r.checkpoint_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.checkpoint_json::text,'UTF8')),'hex')
                OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_attempt_result a JOIN game.shooter_verification_job x USING(job_id)
                  WHERE x.run_id=r.run_id AND a.result_revision=r.revision AND a.checkpoint_sha256=r.checkpoint_sha256 AND a.state IN('partial','completed') AND a.acknowledgment IS NOT NULL) THEN
                RETURN jsonb_build_object('state','pending_retryable','reason','unproven_checkpoint'); END IF;
              pid:=gen_random_uuid();
              INSERT INTO game.shooter_verification_restore_proof(proof_id,audit_id,run_id,revision,verified_tick,checkpoint_sha256,artifact_sha256,source_commit,backup_id,backup_sha256,restore_receipt_sha256,certified_at)
                VALUES(pid,aid,r.run_id,r.revision,r.verified_tick,r.checkpoint_sha256,r.artifact_sha256,r.source_commit,body->>'backupId',body->>'backupSha256',body->>'restoreReceiptSha256',t);
              ack:=jsonb_build_object('state','certified','proofId',pid,'runId',r.run_id,'revision',r.revision,'verifiedTick',r.verified_tick,'checkpointSha256',r.checkpoint_sha256);
            ELSE
              IF body-ARRAY['runId','sequence','expectedRevision','proofId']<>'{}'::jsonb OR NOT(body?&ARRAY['runId','sequence','expectedRevision','proofId']) THEN RETURN jsonb_build_object('state','invalid','reason','malformed'); END IF;
              SELECT * INTO b FROM game.shooter_verification_batch WHERE run_id=r.run_id AND sequence=(body->>'sequence')::int FOR UPDATE;
              IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid','reason','unknown_batch'); END IF;
              SELECT * INTO evidence FROM game.shooter_verification_payload_retirement WHERE run_id=r.run_id AND sequence=b.sequence;
              IF FOUND THEN ack:=evidence.acknowledgment;
              ELSE
                SELECT * INTO proof FROM game.shooter_verification_restore_proof WHERE proof_id=(body->>'proofId')::uuid;
                IF NOT FOUND OR proof.run_id<>r.run_id OR proof.artifact_sha256<>r.artifact_sha256 OR proof.source_commit<>r.source_commit
                  OR proof.revision>r.revision OR proof.verified_tick<b.tick0+b.frame_count OR r.verified_tick<b.tick0+b.frame_count
                  OR b.accepted_at+make_interval(secs=>cfg.minimum_retention_seconds)>t OR r.checkpoint_json IS NULL
                  OR r.checkpoint_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.checkpoint_json::text,'UTF8')),'hex')
                  OR NOT EXISTS(SELECT 1 FROM game.shooter_verification_attempt_result a JOIN game.shooter_verification_job x USING(job_id)
                    WHERE x.run_id=r.run_id AND x.sequence_from=b.sequence AND x.sequence_to=b.sequence AND x.tick_end=b.tick0+b.frame_count
                      AND a.state='completed' AND a.resolved_tick=b.tick0+b.frame_count AND a.checkpoint_sha256 IS NOT NULL AND a.acknowledgment IS NOT NULL) THEN
                  RETURN jsonb_build_object('state','pending_retryable','reason','retention_proof_required'); END IF;
                ack:=jsonb_build_object('state','payload_retired','runId',r.run_id,'sequence',b.sequence,'frameBytes',b.encoded_bytes,'actionBytes',octet_length(b.actions::text),'proofId',proof.proof_id);
                INSERT INTO game.shooter_verification_payload_retirement(run_id,sequence,proof_id,audit_id,request_sha256,frame_bytes,action_bytes,retired_at,acknowledgment)
                  VALUES(r.run_id,b.sequence,proof.proof_id,aid,b.request_sha256,b.encoded_bytes,octet_length(b.actions::text),t,ack);
                UPDATE game.shooter_verification_batch SET frames=NULL,actions=NULL,payload_retired_at=t WHERE run_id=r.run_id AND sequence=b.sequence;
                UPDATE game.shooter_verification_admission SET retained_bytes=retained_bytes-b.encoded_bytes,retired_frame_bytes=retired_frame_bytes+b.encoded_bytes,
                  retained_action_payload_bytes=retained_action_payload_bytes-octet_length(b.actions::text) WHERE singleton;
                UPDATE game.shooter_verification_admission_account SET retained_bytes=retained_bytes-b.encoded_bytes,retired_frame_bytes=retired_frame_bytes+b.encoded_bytes,
                  retained_action_payload_bytes=retained_action_payload_bytes-octet_length(b.actions::text) WHERE user_id=r.user_id;
              END IF;
            END IF;
          END IF;
          IF principal.expires_at<=clock_timestamp() OR principal.not_before>clock_timestamp() THEN RAISE EXCEPTION 'operator_auth_expired'; END IF;
          INSERT INTO game.shooter_verification_operator_audit(audit_id,operator_id,account_id,key_id,request_id,operation,request_sha256,acknowledgment,recorded_at)
            VALUES(aid,op_id,actor,key,rid,operation,digest,ack,clock_timestamp());
          UPDATE game.shooter_verification_retention_config SET retained_operations=retained_operations+1,reserved_audit_bytes=reserved_audit_bytes+65536 WHERE singleton;
          UPDATE game.shooter_verification_operator_usage SET retained_operations=retained_operations+1,reserved_audit_bytes=reserved_audit_bytes+65536 WHERE operator_id=op_id;
          RETURN ack;
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM='operator_auth_expired' THEN RETURN jsonb_build_object('state','authorization_denied','reason','operator_authorization'); END IF;
          RETURN jsonb_build_object('state','pending_retryable','reason','operator_unavailable');
        END;
      END; $fn$`,
  ],
});
