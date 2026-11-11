// PR11 replaces only the PR10 authenticated result hook. No economic writer.
HubSchema.register({
  id: "0054_shooter_verification_commit",
  statements: [
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS terminal_revision bigint CHECK (terminal_revision>=0)",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS terminal_accepted_sequence integer CHECK (terminal_accepted_sequence BETWEEN 0 AND 4095)",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS terminal_accepted_tick integer CHECK (terminal_accepted_tick BETWEEN 1 AND 162000)",
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS checkpoint_bytes integer NOT NULL DEFAULT 0 CHECK (checkpoint_bytes BETWEEN 0 AND 16777216)",
    "ALTER TABLE game.shooter_verification_attempt_result ADD COLUMN IF NOT EXISTS result_sha256 text CHECK (result_sha256 ~ '^[0-9a-f]{64}$')",
    "ALTER TABLE game.shooter_verification_attempt_result ADD COLUMN IF NOT EXISTS acknowledgment jsonb CHECK (jsonb_typeof(acknowledgment)='object' AND octet_length(acknowledgment::text)<=65536)",
    // Result retries retain their own canonical body digest and original ack.
    // This overload leaves the applied0052 body unchanged.
    `CREATE OR REPLACE FUNCTION game.shooter_verification_retry(p_job uuid,p_owner text,p_fence bigint,p_revision bigint,p_reason text,p_result_sha text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE cfg game.shooter_verification_scheduler%ROWTYPE; j game.shooter_verification_job%ROWTYPE;
      t timestamptz; delay_seconds integer; ack jsonb; exhausted boolean;
    BEGIN
      SELECT * INTO cfg FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT r.user_id FROM game.shooter_verification_job x JOIN game.shooter_verification_run r USING(run_id) WHERE x.job_id=p_job) FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_run WHERE run_id=(SELECT run_id FROM game.shooter_verification_job WHERE job_id=p_job) FOR UPDATE;
      SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=p_job FOR UPDATE;
      IF NOT game.shooter_verification_fence_live(p_job,p_owner,p_fence,p_revision) THEN RETURN jsonb_build_object('state','stale','reason','stale_lease'); END IF;
      IF p_reason NOT IN ('execution_timeout','worker_crash','artifact_unavailable','checkpoint_export_failure','database_issue')
        OR p_result_sha IS NULL OR p_result_sha!~'^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state','refused','reason','bad_retry_reason'); END IF;
      t:=clock_timestamp(); exhausted:=j.attempts>=j.max_attempts;
      delay_seconds:=LEAST(cfg.retry_max_seconds,cfg.retry_base_seconds*power(2,LEAST(j.attempts-1,16)))::integer;
      ack:=jsonb_build_object('state','pending_retryable','reason',CASE WHEN exhausted THEN 'attempts_exhausted' ELSE p_reason END,
        'quarantined',exhausted,'nextAttemptAt',t+make_interval(secs=>delay_seconds));
      INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason,result_sha256,acknowledgment)
        VALUES(p_job,p_fence,'retryable',p_reason,p_result_sha,ack);
      UPDATE game.shooter_verification_job SET state=CASE WHEN exhausted THEN 'quarantined' ELSE 'retry_wait' END,
        lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error=p_reason,next_attempt_at=t+make_interval(secs=>delay_seconds),updated_at=t WHERE job_id=p_job;
      IF exhausted THEN
        UPDATE game.shooter_verification_run SET lifecycle=CASE WHEN lifecycle IN ('open','sealed','quarantined') THEN 'quarantined' ELSE lifecycle END,
          operational_reason='attempts_exhausted',updated_at=t WHERE run_id=j.run_id;
      END IF;
      RETURN ack;
    END; $fn$`,
    // Replacing one current checkpoint consumes its already reserved PR08 slot;
    // attempt receipts retain only fixed identity/counters/hash and bounded ack.
    `CREATE OR REPLACE FUNCTION game.shooter_verification_commit_worker_result(a uuid,w text,k text,rid text,digest text,body jsonb)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE cfg game.shooter_verification_scheduler%ROWTYPE; job game.shooter_verification_job%ROWTYPE;
      run game.shooter_verification_run%ROWTYPE; batch game.shooter_verification_batch%ROWTYPE;
      prior game.shooter_verification_attempt_result%ROWTYPE; account game.shooter_verification_scheduler_account%ROWTYPE;
      c jsonb; cp jsonb; accounting jsonb; pub jsonb; terminal jsonb; issuance jsonb; manifest jsonb; expected_pending jsonb;
      t timestamptz; vf integer; sf integer; vb integer; va integer; aa integer; ab integer; af integer; cpbytes integer;
      cp_sha text; result_sha text; ack jsonb; delay_seconds integer; partial boolean; verdict text; reason text;
    BEGIN
      -- Invoked only by PR10's principal-locked, current-key authenticated outer
      -- transaction. That wrapper rechecks actual expiry after downstream waits,
      -- rolling back this entire hook before writing its immutable request ack.
      c:=body->'result'->'binding'; cp:=body->'result'->'privateCheckpoint'; pub:=body->'result'->'publicResult';
      SELECT * INTO cfg FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
      SELECT * INTO job FROM game.shooter_verification_job WHERE job_id=(c->>'jobId')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('state','authorization_denied','reason','stale_or_unbound_result'); END IF;
      SELECT * INTO account FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=job.run_id) FOR UPDATE;
      SELECT * INTO run FROM game.shooter_verification_run WHERE run_id=job.run_id FOR UPDATE;
      SELECT * INTO job FROM game.shooter_verification_job WHERE job_id=(c->>'jobId')::uuid FOR UPDATE;
      result_sha:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
      SELECT * INTO prior FROM game.shooter_verification_attempt_result WHERE job_id=job.job_id AND fencing_token=(c->>'fence')::bigint;
      IF FOUND AND prior.result_sha256=result_sha AND prior.acknowledgment IS NOT NULL
        AND EXISTS (SELECT 1 FROM game.shooter_verification_attempt WHERE job_id=job.job_id AND fencing_token=(c->>'fence')::bigint AND lease_owner=w) THEN
        RETURN prior.acknowledgment;
      END IF;
      IF c->>'runId' IS DISTINCT FROM job.run_id OR c->>'accountId' IS DISTINCT FROM run.user_id::text
        OR c->>'sessionId' IS DISTINCT FROM run.session_id::text OR c->>'inputSha256' IS DISTINCT FROM job.input_sha256
        OR (c->>'initialRevision')::bigint IS DISTINCT FROM job.initial_revision OR (c->>'tick0')::int IS DISTINCT FROM job.tick0
        OR (c->>'tickEnd')::int IS DISTINCT FROM job.tick_end OR (c->>'continuationTick')::int IS DISTINCT FROM job.continuation_tick
        OR NOT game.shooter_verification_fence_live(job.job_id,w,(c->>'fence')::bigint,(c->>'expectedRevision')::bigint) THEN
        RETURN jsonb_build_object('state','authorization_denied','reason','stale_or_unbound_result');
      END IF;
      SELECT * INTO batch FROM game.shooter_verification_batch WHERE run_id=run.run_id AND sequence=job.sequence_from;
      SELECT issuance_json::jsonb INTO issuance FROM game.shooter_run WHERE run_id=run.run_id AND user_id=run.user_id AND session_id=run.session_id;
      manifest:=jsonb_build_object('artifact','shooter-sim','sourceCommit',run.source_commit,'sha256',run.artifact_sha256,
        'protocol',run.simulator_protocol,'contentFingerprint',run.content_fingerprint,'uploadProtocol',run.upload_protocol,
        'replayApiVersion',2,'checkpointSchema',run.checkpoint_schema,'economyPolicy',run.economy_policy);
      IF body->'manifest' IS DISTINCT FROM manifest OR job.sequence_from<>job.sequence_to
        OR batch.request_sha256 IS DISTINCT FROM job.input_sha256 OR job.tick0<batch.tick0 OR job.tick_end>batch.tick0+batch.frame_count
        OR issuance->>'runId' IS DISTINCT FROM run.run_id OR issuance->>'accountId' IS DISTINCT FROM run.user_id::text
        OR issuance->>'sessionId' IS DISTINCT FROM run.session_id::text THEN
        RETURN jsonb_build_object('state','authorization_denied','reason','stale_or_unbound_result');
      END IF;
      t:=clock_timestamp(); verdict:=pub->>'status'; reason:=pub->>'reason';
      IF verdict='invalid' AND run.terminal_tick IS NOT NULL THEN
        RETURN game.shooter_verification_retry(job.job_id,w,job.fencing_token,job.expected_revision,'worker_crash',result_sha);
      END IF;
      IF verdict='invalid' AND reason NOT IN ('teleport','god_mode','debug','injected_inventory') THEN
        RETURN game.shooter_verification_retry(job.job_id,w,job.fencing_token,job.expected_revision,'worker_crash',result_sha);
      END IF;
      IF verdict='invalid' THEN
        -- A deterministic invalid worker verdict is distinct from infrastructure
        -- failure and can close only this live predecessor/fence. No payout.
        IF cp IS DISTINCT FROM 'null'::jsonb OR reason IS NULL OR reason!~'^[a-z0-9_]{1,80}$' THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_result'); END IF;
        ack:=jsonb_build_object('state','invalid_gameplay','reason',reason,'runId',run.run_id,'revision',run.revision+1,'ticketsMinted',0);
        INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason,result_revision,resolved_tick,result_sha256,acknowledgment)
          VALUES(job.job_id,job.fencing_token,'invalid',reason,run.revision+1,run.verified_tick,result_sha,ack);
        UPDATE game.shooter_verification_job SET state='cancelled',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error=reason,updated_at=t WHERE job_id=job.job_id;
        UPDATE game.shooter_verification_run SET lifecycle='invalid',revision=revision+1,operational_reason=NULL,updated_at=t WHERE run_id=run.run_id;
        RETURN ack;
      END IF;
      IF cp IS NULL OR cp='null'::jsonb THEN
        RETURN game.shooter_verification_retry(job.job_id,w,job.fencing_token,job.expected_revision,
          CASE WHEN reason IN ('execution_timeout','worker_crash','artifact_unavailable','checkpoint_export_failure','database_issue') THEN reason ELSE 'worker_crash' END,result_sha);
      END IF;
      accounting:=cp->'accounting'; terminal:=cp->'firstTerminal';
      -- SQL independently checks critical server binding and cumulative history.
      -- Full bounded JSON/schema/corruption validation occurs in trusted runtime
      -- before this hook; source/private hashes are corruption checks, not auth.
      IF cp->>'v'<>'2' OR cp->'issuance' IS DISTINCT FROM issuance
        OR cp->'snapshot'->>'v'<>'1'
        OR cp->'snapshot'->'manifest' IS DISTINCT FROM manifest-ARRAY['uploadProtocol','replayApiVersion','checkpointSchema','economyPolicy']
        OR cp->'snapshot'->'binding' IS DISTINCT FROM jsonb_build_object('runId',run.run_id,'accountId',run.user_id,'sessionId',run.session_id,'day',issuance->>'day')
        OR pub->>'version'<>'2' OR pub->>'ticketsMinted'<>'0' THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      vf:=(accounting->>'verifiedFrames')::int; sf:=(accounting->>'simFrames')::int;
      vb:=(accounting->>'verifiedBatches')::int; va:=(accounting->>'verifiedActions')::int;
      af:=(accounting->>'acceptedFrames')::int; ab:=(accounting->>'batches')::int; aa:=(accounting->>'actions')::int;
      IF vf=run.verified_tick THEN
        RETURN game.shooter_verification_retry(job.job_id,w,job.fencing_token,job.expected_revision,
          CASE WHEN reason IN ('execution_timeout','checkpoint_export_failure') THEN reason ELSE 'worker_crash' END,result_sha);
      END IF;
      IF vf IS NULL OR sf IS NULL OR vb IS NULL OR va IS NULL OR af IS NULL OR ab IS NULL OR aa IS NULL
        OR vf<=run.verified_tick OR vf>job.tick_end OR vf>run.accepted_tick OR sf<run.simulation_tick OR sf>vf
        OR af<>batch.tick0+batch.frame_count OR af>run.accepted_tick OR ab<>batch.sequence+1
        OR vb<>CASE WHEN vf=batch.tick0+batch.frame_count THEN batch.sequence+1 ELSE batch.sequence END
        OR (accounting->>'framesTextBytes')::bigint<>af::bigint*16 OR (accounting->>'verifiedFramesTextBytes')::bigint<>vf::bigint*16
        OR aa<>CASE WHEN run.checkpoint_json IS NULL THEN batch.action_count
          WHEN (run.checkpoint_json->'accounting'->>'batches')::int=batch.sequence+1 THEN (run.checkpoint_json->'accounting'->>'actions')::int
          ELSE (run.checkpoint_json->'accounting'->>'actions')::int+batch.action_count END
        OR va<>run.verified_actions+(SELECT count(*) FROM jsonb_array_elements(batch.actions) x WHERE batch.tick0+(x->>0)::int>=run.verified_tick AND batch.tick0+(x->>0)::int<vf)
        OR (cp->'snapshot'->'counters'->>'frames')::int<>vf OR (cp->'snapshot'->'counters'->>'segments')::int<>vb
        OR (cp->'snapshot'->'state'->>'tick')::int<>sf
        OR (pub->>'verifiedInputTick')::int<>vf OR (pub->>'simulationTick')::int<>sf
        OR (pub->>'acceptedInputTick')::int<>af OR (pub->>'acceptedBatches')::int<>ab
        OR (pub->>'verifiedBatches')::int<>vb OR (pub->>'actions')::int<>aa OR (pub->>'verifiedActions')::int<>va THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      IF vf=batch.tick0+batch.frame_count THEN
        IF cp->'pending' IS DISTINCT FROM 'null'::jsonb THEN RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      ELSE
        expected_pending:=jsonb_build_object('batch',jsonb_build_object('protocol',2,'runId',batch.run_id,'sequence',batch.sequence,'tick0',batch.tick0,'n',batch.frame_count,'frames',batch.frames,'actions',batch.actions),
          'cursor',vf-batch.tick0,'sha256',batch.request_sha256);
        IF cp->'pending' IS DISTINCT FROM expected_pending THEN RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      END IF;
      IF run.terminal_tick IS NOT NULL THEN
        IF terminal IS DISTINCT FROM run.terminal_result OR sf<>run.terminal_tick OR batch.sequence>run.terminal_accepted_sequence
          OR cp->'snapshot'->'state' IS DISTINCT FROM run.checkpoint_json->'snapshot'->'state'
          OR cp->'snapshot'->'campaignCheckpoints' IS DISTINCT FROM run.checkpoint_json->'snapshot'->'campaignCheckpoints'
          OR cp->'snapshot'->'parts' IS DISTINCT FROM run.checkpoint_json->'snapshot'->'parts' THEN
          RETURN jsonb_build_object('state','pending_retryable','reason','terminal_regression'); END IF;
      ELSIF terminal='null'::jsonb THEN
        IF sf<>vf OR pub->'terminal' IS DISTINCT FROM 'null'::jsonb THEN RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      ELSE
        IF terminal IS NULL OR terminal->>'outcome' NOT IN ('clear','assisted','fail')
          OR (terminal->>'simTick')::int<>sf OR (terminal->>'inputFrame')::int<>sf OR sf<=run.simulation_tick
          OR pub->'terminal' IS DISTINCT FROM terminal-'parts' THEN RETURN jsonb_build_object('state','pending_retryable','reason','bad_worker_checkpoint'); END IF;
      END IF;
      cpbytes:=octet_length(cp::text);
      IF NOT run.checkpoint_slot_reserved OR cpbytes>16777216 THEN
        RETURN game.shooter_verification_retry(job.job_id,w,job.fencing_token,job.expected_revision,'checkpoint_export_failure',result_sha); END IF;
      cp_sha:=encode(sha256(convert_to(cp::text,'UTF8')),'hex');
      partial:=vf<job.tick_end;
      ack:=jsonb_build_object('state',CASE WHEN terminal<>'null'::jsonb THEN 'terminal_verified' ELSE 'verified' END,
        'runId',run.run_id,'revision',run.revision+1,'verifiedTick',vf,'simulationTick',sf,'verifiedSequence',vb-1,
        'jobComplete',NOT partial,'terminalRevision',CASE WHEN terminal<>'null'::jsonb THEN COALESCE(run.terminal_revision,run.revision+1) ELSE NULL END,'ticketsMinted',0);
      INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason,result_revision,resolved_tick,checkpoint_sha256,result_sha256,acknowledgment)
        VALUES(job.job_id,job.fencing_token,CASE WHEN partial THEN 'partial' ELSE 'completed' END,
          CASE WHEN partial THEN 'partial_progress' ELSE 'range_verified' END,run.revision+1,vf,cp_sha,result_sha,ack);
      UPDATE game.shooter_verification_run SET revision=revision+1,verified_tick=vf,simulation_tick=sf,verified_sequence=vb-1,
        verified_batches=vb,verified_bytes=vf::bigint*16,verified_actions=va,checkpoint_json=cp,checkpoint_sha256=cp_sha,checkpoint_bytes=cpbytes,
        payment_state=CASE WHEN run.terminal_tick IS NULL AND terminal<>'null'::jsonb THEN CASE WHEN terminal->>'outcome'='clear' AND terminal->>'eligible'='true' THEN 'pending' ELSE 'ineligible' END ELSE payment_state END,
        payment_reason=CASE WHEN run.terminal_tick IS NULL AND terminal<>'null'::jsonb THEN CASE WHEN terminal->>'outcome'='clear' AND terminal->>'eligible'='true' THEN NULL ELSE 'ineligible' END ELSE payment_reason END,
        terminal_revision=CASE WHEN terminal<>'null'::jsonb THEN COALESCE(terminal_revision,revision+1) ELSE terminal_revision END,
        terminal_tick=CASE WHEN terminal<>'null'::jsonb THEN sf ELSE terminal_tick END,
        terminal_outcome=CASE WHEN terminal<>'null'::jsonb THEN terminal->>'outcome' ELSE terminal_outcome END,
        terminal_result=CASE WHEN terminal<>'null'::jsonb THEN terminal ELSE terminal_result END,
        terminal_accepted_sequence=CASE WHEN terminal<>'null'::jsonb THEN COALESCE(terminal_accepted_sequence,accepted_sequence) ELSE terminal_accepted_sequence END,
        terminal_accepted_tick=CASE WHEN terminal<>'null'::jsonb THEN COALESCE(terminal_accepted_tick,accepted_tick) ELSE terminal_accepted_tick END,
        lifecycle=CASE WHEN terminal<>'null'::jsonb THEN 'terminal' ELSE lifecycle END,operational_reason=NULL,updated_at=t
        WHERE run_id=run.run_id;
      IF partial THEN
        delay_seconds:=LEAST(cfg.retry_max_seconds,cfg.retry_base_seconds*power(2,LEAST(job.attempts-1,16)))::integer;
        UPDATE game.shooter_verification_job SET state=CASE WHEN attempts>=max_attempts THEN 'quarantined' ELSE 'retry_wait' END,
          expected_revision=run.revision+1,continuation_tick=vf,lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,
          next_attempt_at=t+make_interval(secs=>delay_seconds),last_error='partial_progress',updated_at=t WHERE job_id=job.job_id;
        IF job.attempts>=job.max_attempts THEN
          UPDATE game.shooter_verification_run SET lifecycle=CASE WHEN lifecycle IN ('open','sealed','quarantined') THEN 'quarantined' ELSE lifecycle END,
            operational_reason='attempts_exhausted' WHERE run_id=run.run_id;
        END IF;
      ELSE
        UPDATE game.shooter_verification_job SET state='completed',expected_revision=run.revision+1,continuation_tick=vf,
          verified_ack=ack,lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error=NULL,updated_at=t WHERE job_id=job.job_id;
      END IF;
      RETURN ack;
    END; $fn$`,
  ],
});
