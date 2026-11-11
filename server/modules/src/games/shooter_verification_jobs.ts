// PR08: trusted, unused queue helpers. No service/public RPC is registered here.
// PR10 owns scoped transport authentication; PR11 owns authoritative advancement.
namespace ShooterVerificationJobs {
  export function claim(nk: nkruntime.Nakama, owner: string): { [key: string]: unknown } {
    return ShooterRewards.queryJson(nk, "SELECT game.shooter_verification_claim($1::text)::text AS result", [owner]);
  }
  export function renew(nk: nkruntime.Nakama, job: string, owner: string, fence: number, revision: number): { [key: string]: unknown } {
    return ShooterRewards.queryJson(nk, "SELECT game.shooter_verification_renew($1::uuid,$2::text,$3::bigint,$4::bigint)::text AS result", [job, owner, fence, revision]);
  }
  export function retry(nk: nkruntime.Nakama, job: string, owner: string, fence: number, revision: number, reason: string): { [key: string]: unknown } {
    return ShooterRewards.queryJson(nk, "SELECT game.shooter_verification_retry($1::uuid,$2::text,$3::bigint,$4::bigint,$5::text)::text AS result", [job, owner, fence, revision, reason]);
  }
}

HubSchema.register({
  id: "0052_shooter_verification_jobs",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_scheduler (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      claims_enabled boolean NOT NULL DEFAULT false,
      max_leased integer CHECK (max_leased BETWEEN 1 AND 10000),
      max_account_leased integer CHECK (max_account_leased BETWEEN 1 AND 100),
      max_jobs bigint CHECK (max_jobs BETWEEN 1 AND 10000000),
      max_account_jobs bigint CHECK (max_account_jobs BETWEEN 1 AND 1000000),
      max_attempts_retained bigint CHECK (max_attempts_retained BETWEEN 1 AND 100000000),
      max_account_attempts_retained bigint CHECK (max_account_attempts_retained BETWEEN 1 AND 10000000),
      max_checkpoint_bytes bigint CHECK (max_checkpoint_bytes BETWEEN 16777216 AND 1099511627776),
      max_account_checkpoint_bytes bigint CHECK (max_account_checkpoint_bytes BETWEEN 16777216 AND 1099511627776),
      lease_seconds integer CHECK (lease_seconds BETWEEN 1 AND 300),
      attempt_seconds integer CHECK (attempt_seconds BETWEEN 1 AND 900),
      attempt_limit integer CHECK (attempt_limit BETWEEN 1 AND 100),
      retry_base_seconds integer CHECK (retry_base_seconds BETWEEN 1 AND 300),
      retry_max_seconds integer CHECK (retry_max_seconds BETWEEN 1 AND 3600),
      slice_ticks integer CHECK (slice_ticks BETWEEN 1 AND 4096),
      retained_jobs bigint NOT NULL DEFAULT 0 CHECK (retained_jobs>=0),
      retained_attempts bigint NOT NULL DEFAULT 0 CHECK (retained_attempts>=0),
      reserved_checkpoint_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_checkpoint_bytes>=0),
      CHECK (NOT claims_enabled OR (max_leased IS NOT NULL AND max_account_leased IS NOT NULL
        AND max_jobs IS NOT NULL AND max_account_jobs IS NOT NULL AND max_attempts_retained IS NOT NULL
        AND max_account_attempts_retained IS NOT NULL AND max_checkpoint_bytes IS NOT NULL
        AND max_account_checkpoint_bytes IS NOT NULL AND lease_seconds IS NOT NULL AND attempt_seconds IS NOT NULL
        AND attempt_limit IS NOT NULL AND retry_base_seconds IS NOT NULL AND retry_max_seconds IS NOT NULL AND slice_ticks IS NOT NULL
        AND lease_seconds<=attempt_seconds AND retry_base_seconds<=retry_max_seconds))
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_scheduler_account (
      user_id uuid PRIMARY KEY,
      last_claim_at timestamptz,
      last_considered_at timestamptz,
      retained_jobs bigint NOT NULL DEFAULT 0 CHECK (retained_jobs>=0),
      retained_attempts bigint NOT NULL DEFAULT 0 CHECK (retained_attempts>=0),
      reserved_checkpoint_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_checkpoint_bytes>=0)
    )`,
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS checkpoint_slot_reserved boolean NOT NULL DEFAULT false",
    "ALTER TABLE game.shooter_verification_job ADD COLUMN IF NOT EXISTS initial_revision bigint",
    "ALTER TABLE game.shooter_verification_job ADD COLUMN IF NOT EXISTS continuation_tick integer",
    "ALTER TABLE game.shooter_verification_job ADD COLUMN IF NOT EXISTS attempt_deadline timestamptz",
    "UPDATE game.shooter_verification_job SET initial_revision=expected_revision,continuation_tick=tick0 WHERE initial_revision IS NULL OR continuation_tick IS NULL",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_job_binding()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP='INSERT' THEN
        NEW.initial_revision:=NEW.expected_revision;
        NEW.continuation_tick:=NEW.tick0;
      ELSE
        IF ROW(NEW.job_id,NEW.run_id,NEW.sequence_from,NEW.sequence_to,NEW.tick0,NEW.tick_end,NEW.initial_revision,NEW.input_sha256,NEW.max_attempts)
          IS DISTINCT FROM ROW(OLD.job_id,OLD.run_id,OLD.sequence_from,OLD.sequence_to,OLD.tick0,OLD.tick_end,OLD.initial_revision,OLD.input_sha256,OLD.max_attempts)
          OR NEW.continuation_tick<OLD.continuation_tick OR NEW.expected_revision<OLD.expected_revision
          OR NEW.fencing_token<OLD.fencing_token OR NEW.attempts<OLD.attempts
          OR (OLD.state='leased' AND NEW.state='leased' AND NEW.fencing_token=OLD.fencing_token AND NEW.attempt_deadline IS DISTINCT FROM OLD.attempt_deadline)
          OR (OLD.verified_ack IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
          RAISE EXCEPTION 'shooter_verification_job_binding_immutable';
        END IF;
      END IF;
      IF NEW.initial_revision IS NULL OR NEW.continuation_tick IS NULL OR NEW.initial_revision<0 OR NEW.continuation_tick<NEW.tick0 OR NEW.continuation_tick>NEW.tick_end
        OR NEW.expected_revision<NEW.initial_revision THEN RAISE EXCEPTION 'shooter_verification_job_continuation'; END IF;
      IF NEW.state='leased' AND (NEW.attempt_deadline IS NULL OR NEW.lease_until>NEW.attempt_deadline) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='shooter_verification_attempt_deadline';
      END IF;
      RETURN NEW;
    END; $fn$`,
    `DO $trigger$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_job'::regclass AND tgname='shooter_verification_job_binding') THEN
        CREATE TRIGGER shooter_verification_job_binding BEFORE INSERT OR UPDATE ON game.shooter_verification_job
          FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_job_binding();
      END IF;
    END; $trigger$`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_attempt (
      job_id uuid NOT NULL REFERENCES game.shooter_verification_job(job_id),
      fencing_token bigint NOT NULL CHECK (fencing_token>0),
      lease_owner text NOT NULL CHECK (lease_owner ~ '^[A-Za-z0-9_.:@|-]{1,80}$'),
      predecessor_revision bigint NOT NULL CHECK (predecessor_revision>=0),
      continuation_tick integer NOT NULL CHECK (continuation_tick BETWEEN 0 AND 162000),
      claimed_at timestamptz NOT NULL,
      attempt_deadline timestamptz NOT NULL CHECK (attempt_deadline>claimed_at),
      PRIMARY KEY (job_id,fencing_token)
    )`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_attempt_result (
      job_id uuid NOT NULL,
      fencing_token bigint NOT NULL,
      state text NOT NULL CHECK (state IN ('lease_expired','retryable','partial','completed','invalid')),
      reason text NOT NULL CHECK (reason ~ '^[a-z0-9_]{1,80}$'),
      result_revision bigint CHECK (result_revision>=0),
      resolved_tick integer CHECK (resolved_tick BETWEEN 0 AND 162000),
      checkpoint_sha256 text CHECK (checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (job_id,fencing_token),
      FOREIGN KEY (job_id,fencing_token) REFERENCES game.shooter_verification_attempt(job_id,fencing_token)
    )`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_attempt_immutable()
    RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'shooter_verification_attempt_immutable'; END; $fn$`,
    `DO $trigger$ DECLARE name text; BEGIN
      FOREACH name IN ARRAY ARRAY['shooter_verification_attempt','shooter_verification_attempt_result'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=('game.'||name)::regclass AND tgname='shooter_verification_attempt_immutable') THEN
          EXECUTE format('CREATE TRIGGER shooter_verification_attempt_immutable BEFORE UPDATE OR DELETE ON game.%I FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_attempt_immutable()',name);
        END IF;
      END LOOP;
    END; $trigger$`,
    "CREATE INDEX IF NOT EXISTS shooter_verification_jobs_owner ON game.shooter_verification_run(user_id,verified_tick,issued_at,run_id) WHERE lifecycle IN ('open','sealed','expired','terminal')",
    // Backfill counters once; never reset retained evidence on reboot.
    "UPDATE game.shooter_verification_run SET checkpoint_slot_reserved=true WHERE checkpoint_json IS NOT NULL",
    `INSERT INTO game.shooter_verification_scheduler(singleton,retained_jobs,reserved_checkpoint_bytes)
      SELECT true,(SELECT count(*) FROM game.shooter_verification_job),count(*)*16777216 FROM game.shooter_verification_run WHERE checkpoint_slot_reserved ON CONFLICT(singleton) DO NOTHING`,
    `INSERT INTO game.shooter_verification_scheduler_account(user_id,retained_jobs,reserved_checkpoint_bytes)
      SELECT r.user_id,count(j.job_id),count(DISTINCT r.run_id) FILTER(WHERE r.checkpoint_slot_reserved)*16777216 FROM game.shooter_verification_run r LEFT JOIN game.shooter_verification_job j USING(run_id)
      GROUP BY r.user_id ON CONFLICT(user_id) DO NOTHING`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_claim(p_owner text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_scheduler%ROWTYPE; a game.shooter_verification_scheduler_account%ROWTYPE;
      r game.shooter_verification_run%ROWTYPE; j game.shooter_verification_job%ROWTYPE; b game.shooter_verification_batch%ROWTYPE;
      candidate record; t timestamptz; jid uuid; delay_seconds integer;
    BEGIN
      IF p_owner IS NULL OR p_owner!~'^[A-Za-z0-9_.:@|-]{1,80}$' THEN RETURN jsonb_build_object('state','refused','reason','bad_worker'); END IF;
      -- All decisions use this short lock; it is never held during replay.
      SELECT * INTO c FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
      IF NOT FOUND OR NOT c.claims_enabled THEN RETURN jsonb_build_object('state','pending_retryable','reason','workers_disabled'); END IF;
      t:=clock_timestamp();
      -- One lazy candidate per account is ordered by least recently served user.
      -- Expired leases participate even at capacity, so crashes cannot strand slots.
      FOR candidate IN
        SELECT eligible.run_id FROM (SELECT DISTINCT ON (rr.user_id) rr.run_id,rr.user_id,rr.issued_at,aa.last_considered_at FROM game.shooter_verification_run rr
        LEFT JOIN game.shooter_verification_scheduler_account aa ON aa.user_id=rr.user_id
        WHERE rr.lifecycle IN ('open','sealed','expired','terminal') AND rr.verified_tick<rr.accepted_tick
          AND NOT EXISTS (SELECT 1 FROM game.shooter_verification_job bad WHERE bad.run_id=rr.run_id AND bad.state='quarantined')
          AND NOT EXISTS (SELECT 1 FROM game.shooter_verification_job busy WHERE busy.run_id=rr.run_id
            AND (busy.state='leased' AND busy.lease_until>t OR busy.state='retry_wait' AND busy.next_attempt_at>t))
        ORDER BY rr.user_id,rr.issued_at,rr.run_id) eligible
        ORDER BY eligible.last_considered_at NULLS FIRST,eligible.issued_at,eligible.run_id LIMIT 256
      LOOP
        INSERT INTO game.shooter_verification_scheduler_account(user_id) SELECT user_id FROM game.shooter_verification_run WHERE run_id=candidate.run_id ON CONFLICT DO NOTHING;
        SELECT * INTO a FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT user_id FROM game.shooter_verification_run WHERE run_id=candidate.run_id) FOR UPDATE;
        SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=candidate.run_id FOR UPDATE;
        t:=clock_timestamp();
        UPDATE game.shooter_verification_scheduler_account SET last_considered_at=t WHERE user_id=r.user_id;
        SELECT * INTO j FROM game.shooter_verification_job WHERE run_id=r.run_id AND state IN ('ready','leased','retry_wait') FOR UPDATE;
        IF FOUND AND j.state='leased' THEN
          IF j.lease_until>t THEN CONTINUE; END IF;
          INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason)
            VALUES(j.job_id,j.fencing_token,'lease_expired','lease_expired') ON CONFLICT DO NOTHING;
          IF j.attempts>=j.max_attempts THEN
            UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error='attempts_exhausted',updated_at=t WHERE job_id=j.job_id;
            UPDATE game.shooter_verification_run SET lifecycle='quarantined',updated_at=t WHERE run_id=r.run_id;
          ELSE
            delay_seconds:=LEAST(c.retry_max_seconds,c.retry_base_seconds*power(2,LEAST(j.attempts-1,16)))::integer;
            UPDATE game.shooter_verification_job SET state='retry_wait',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error='lease_expired',next_attempt_at=t+make_interval(secs=>delay_seconds),updated_at=t WHERE job_id=j.job_id;
          END IF;
          CONTINUE;
        END IF;
        IF j.job_id IS NOT NULL AND (j.continuation_tick<>r.verified_tick OR j.expected_revision<>r.revision) THEN
          UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error='predecessor_mismatch',updated_at=t WHERE job_id=j.job_id;
          UPDATE game.shooter_verification_run SET lifecycle='quarantined',updated_at=t WHERE run_id=r.run_id;
          CONTINUE;
        END IF;
        IF (SELECT count(*) FROM game.shooter_verification_job WHERE state='leased' AND lease_until>t)>=c.max_leased
          OR (SELECT count(*) FROM game.shooter_verification_job x JOIN game.shooter_verification_run y USING(run_id) WHERE y.user_id=r.user_id AND x.state='leased' AND x.lease_until>t)>=c.max_account_leased THEN CONTINUE; END IF;
        IF c.retained_attempts>=c.max_attempts_retained OR a.retained_attempts>=c.max_account_attempts_retained THEN CONTINUE; END IF;
        IF NOT r.checkpoint_slot_reserved THEN
          IF c.reserved_checkpoint_bytes+16777216>c.max_checkpoint_bytes OR a.reserved_checkpoint_bytes+16777216>c.max_account_checkpoint_bytes THEN CONTINUE; END IF;
        END IF;
        SELECT * INTO b FROM game.shooter_verification_batch WHERE run_id=r.run_id AND tick0<=r.verified_tick AND tick0+frame_count>r.verified_tick;
        IF NOT FOUND THEN CONTINUE; END IF;
        IF j.job_id IS NULL THEN
          IF c.retained_jobs>=c.max_jobs OR a.retained_jobs>=c.max_account_jobs THEN CONTINUE; END IF;
          jid:=gen_random_uuid();
          INSERT INTO game.shooter_verification_job(job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state)
            VALUES(jid,r.run_id,b.sequence,b.sequence,r.verified_tick,LEAST(b.tick0+b.frame_count,r.verified_tick+c.slice_ticks),r.revision,b.request_sha256,c.attempt_limit,'ready') RETURNING * INTO j;
          UPDATE game.shooter_verification_scheduler SET retained_jobs=retained_jobs+1 WHERE singleton;
          UPDATE game.shooter_verification_scheduler_account SET retained_jobs=retained_jobs+1 WHERE user_id=r.user_id;
        END IF;
        IF j.attempts>=j.max_attempts THEN
          UPDATE game.shooter_verification_job SET state='quarantined',last_error='attempts_exhausted',updated_at=t WHERE job_id=j.job_id;
          UPDATE game.shooter_verification_run SET lifecycle='quarantined',updated_at=t WHERE run_id=r.run_id; CONTINUE;
        END IF;
        IF NOT r.checkpoint_slot_reserved THEN
          UPDATE game.shooter_verification_run SET checkpoint_slot_reserved=true WHERE run_id=r.run_id;
          UPDATE game.shooter_verification_scheduler SET reserved_checkpoint_bytes=reserved_checkpoint_bytes+16777216 WHERE singleton;
          UPDATE game.shooter_verification_scheduler_account SET reserved_checkpoint_bytes=reserved_checkpoint_bytes+16777216 WHERE user_id=r.user_id;
        END IF;
        UPDATE game.shooter_verification_job SET state='leased',fencing_token=fencing_token+1,attempts=attempts+1,lease_owner=p_owner,
          lease_until=t+make_interval(secs=>c.lease_seconds),attempt_deadline=t+make_interval(secs=>c.attempt_seconds),updated_at=t
          WHERE job_id=j.job_id RETURNING * INTO j;
        INSERT INTO game.shooter_verification_attempt(job_id,fencing_token,lease_owner,predecessor_revision,continuation_tick,claimed_at,attempt_deadline)
          VALUES(j.job_id,j.fencing_token,p_owner,j.expected_revision,j.continuation_tick,t,j.attempt_deadline);
        UPDATE game.shooter_verification_scheduler SET retained_attempts=retained_attempts+1 WHERE singleton;
        UPDATE game.shooter_verification_scheduler_account SET retained_attempts=retained_attempts+1,last_claim_at=t WHERE user_id=r.user_id;
        RETURN jsonb_build_object('state','leased','claim',jsonb_build_object(
          'jobId',j.job_id,'runId',r.run_id,'accountId',r.user_id,'sessionId',r.session_id,'fence',j.fencing_token,
          'initialRevision',j.initial_revision,'expectedRevision',j.expected_revision,'inputSha256',j.input_sha256,
          'tick0',j.tick0,'tickEnd',j.tick_end,'continuationTick',j.continuation_tick),
          'leaseUntil',j.lease_until,'attemptDeadline',j.attempt_deadline);
      END LOOP;
      RETURN jsonb_build_object('state','pending_retryable','reason','no_capacity_or_ready_work');
    END; $fn$`,
    // Shared predicate for renew, retry and future PR11 success/failure commits.
    // Call only while holding scheduler -> account -> run -> job locks.
    `CREATE OR REPLACE FUNCTION game.shooter_verification_fence_live(p_job uuid,p_owner text,p_fence bigint,p_revision bigint)
    RETURNS boolean LANGUAGE sql VOLATILE AS $fn$
      SELECT EXISTS(SELECT 1 FROM game.shooter_verification_job j JOIN game.shooter_verification_run r USING(run_id)
        WHERE j.job_id=p_job AND j.state='leased' AND j.lease_owner=p_owner AND j.fencing_token=p_fence
          AND r.lifecycle IN ('open','sealed','expired','terminal') AND j.expected_revision=p_revision AND r.revision=p_revision AND r.verified_tick=j.continuation_tick
          AND j.lease_until>clock_timestamp() AND j.attempt_deadline>clock_timestamp())
    $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_renew(p_job uuid,p_owner text,p_fence bigint,p_revision bigint)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_scheduler%ROWTYPE; j game.shooter_verification_job%ROWTYPE; t timestamptz;
    BEGIN
      SELECT * INTO c FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT r.user_id FROM game.shooter_verification_job x JOIN game.shooter_verification_run r USING(run_id) WHERE x.job_id=p_job) FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_run WHERE run_id=(SELECT run_id FROM game.shooter_verification_job WHERE job_id=p_job) FOR UPDATE;
      SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=p_job FOR UPDATE;
      IF NOT game.shooter_verification_fence_live(p_job,p_owner,p_fence,p_revision) THEN RETURN jsonb_build_object('state','stale','reason','stale_lease'); END IF;
      t:=clock_timestamp();
      UPDATE game.shooter_verification_job SET lease_until=LEAST(j.attempt_deadline,t+make_interval(secs=>c.lease_seconds)),updated_at=t WHERE job_id=p_job RETURNING * INTO j;
      RETURN jsonb_build_object('state','leased','leaseUntil',j.lease_until,'attemptDeadline',j.attempt_deadline);
    END; $fn$`,
    `CREATE OR REPLACE FUNCTION game.shooter_verification_retry(p_job uuid,p_owner text,p_fence bigint,p_revision bigint,p_reason text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE c game.shooter_verification_scheduler%ROWTYPE; j game.shooter_verification_job%ROWTYPE; t timestamptz; delay_seconds integer;
    BEGIN
      IF p_reason IS NULL OR p_reason NOT IN ('execution_timeout','worker_crash','artifact_unavailable','checkpoint_export_failure','database_issue') THEN RETURN jsonb_build_object('state','refused','reason','bad_retry_reason'); END IF;
      SELECT * INTO c FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_scheduler_account WHERE user_id=(SELECT r.user_id FROM game.shooter_verification_job x JOIN game.shooter_verification_run r USING(run_id) WHERE x.job_id=p_job) FOR UPDATE;
      PERFORM 1 FROM game.shooter_verification_run WHERE run_id=(SELECT run_id FROM game.shooter_verification_job WHERE job_id=p_job) FOR UPDATE;
      SELECT * INTO j FROM game.shooter_verification_job WHERE job_id=p_job FOR UPDATE;
      IF NOT game.shooter_verification_fence_live(p_job,p_owner,p_fence,p_revision) THEN RETURN jsonb_build_object('state','stale','reason','stale_lease'); END IF;
      t:=clock_timestamp();
      INSERT INTO game.shooter_verification_attempt_result(job_id,fencing_token,state,reason) VALUES(p_job,p_fence,'retryable',p_reason);
      delay_seconds:=LEAST(c.retry_max_seconds,c.retry_base_seconds*power(2,LEAST(j.attempts-1,16)))::integer;
      UPDATE game.shooter_verification_job SET state=CASE WHEN attempts>=max_attempts THEN 'quarantined' ELSE 'retry_wait' END,
        lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL,last_error=p_reason,next_attempt_at=t+make_interval(secs=>delay_seconds),updated_at=t
        WHERE job_id=p_job RETURNING * INTO j;
      IF j.state='quarantined' THEN UPDATE game.shooter_verification_run SET lifecycle='quarantined',updated_at=t WHERE run_id=j.run_id; END IF;
      RETURN jsonb_build_object('state','pending_retryable','reason',CASE WHEN j.state='quarantined' THEN 'attempts_exhausted' ELSE p_reason END,'quarantined',j.state='quarantined','nextAttemptAt',j.next_attempt_at);
    END; $fn$`,
  ],
});
