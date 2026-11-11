// PR06: unused durable structures for protocol-v2 verification. No RPC, worker,
// issuance or payment path writes these tables yet. Legacy reward tables stay
// authoritative. Applied migrations must never be edited after publication.
HubSchema.register({
  id: "0050_shooter_verification_queue",
  statements: [
    // Bind metadata to the existing run's exact owner and original session.
    "CREATE UNIQUE INDEX IF NOT EXISTS shooter_run_identity ON game.shooter_run (run_id, user_id, session_id)",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_run (
      run_id text PRIMARY KEY,
      user_id uuid NOT NULL,
      session_id uuid NOT NULL,
      upload_protocol integer NOT NULL DEFAULT 2 CHECK (upload_protocol = 2),
      simulator_protocol integer NOT NULL CHECK (simulator_protocol > 0),
      checkpoint_schema integer NOT NULL CHECK (checkpoint_schema > 0),
      economy_policy integer NOT NULL CHECK (economy_policy > 0),
      artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
      source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
      content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{8}$'),
      revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
      accepted_sequence integer NOT NULL DEFAULT -1 CHECK (accepted_sequence BETWEEN -1 AND 4095),
      verified_sequence integer NOT NULL DEFAULT -1 CHECK (verified_sequence BETWEEN -1 AND accepted_sequence),
      accepted_tick integer NOT NULL DEFAULT 0 CHECK (accepted_tick BETWEEN 0 AND 162000),
      verified_tick integer NOT NULL DEFAULT 0 CHECK (verified_tick BETWEEN 0 AND accepted_tick),
      simulation_tick integer NOT NULL DEFAULT 0 CHECK (simulation_tick BETWEEN 0 AND verified_tick),
      accepted_bytes bigint NOT NULL DEFAULT 0 CHECK (accepted_bytes BETWEEN 0 AND 67108864),
      verified_bytes bigint NOT NULL DEFAULT 0 CHECK (verified_bytes BETWEEN 0 AND accepted_bytes),
      accepted_actions integer NOT NULL DEFAULT 0 CHECK (accepted_actions BETWEEN 0 AND 131072),
      verified_actions integer NOT NULL DEFAULT 0 CHECK (verified_actions BETWEEN 0 AND accepted_actions),
      accepted_batches integer NOT NULL DEFAULT 0 CHECK (accepted_batches = accepted_sequence + 1),
      verified_batches integer NOT NULL DEFAULT 0 CHECK (verified_batches = verified_sequence + 1),
      lifecycle text NOT NULL DEFAULT 'open' CHECK (lifecycle IN ('open', 'sealed', 'terminal', 'expired', 'invalid', 'quarantined')),
      payment_state text NOT NULL DEFAULT 'none' CHECK (payment_state IN ('none', 'pending', 'paid', 'ineligible', 'authorization_denied')),
      payment_reason text CHECK (payment_reason IS NULL OR octet_length(payment_reason) <= 80),
      sealed_sequence integer CHECK (sealed_sequence BETWEEN -1 AND 4095),
      sealed_tick integer CHECK (sealed_tick BETWEEN 0 AND 162000),
      terminal_tick integer CHECK (terminal_tick BETWEEN 0 AND simulation_tick),
      terminal_outcome text CHECK (terminal_outcome IN ('clear', 'assisted', 'fail', 'fled', 'incomplete')),
      terminal_result jsonb CHECK (terminal_result IS NULL OR (jsonb_typeof(terminal_result) = 'object' AND octet_length(terminal_result::text) <= 65536)),
      checkpoint_json jsonb CHECK (checkpoint_json IS NULL OR (jsonb_typeof(checkpoint_json) = 'object' AND octet_length(checkpoint_json::text) <= 16777216)),
      checkpoint_sha256 text CHECK (checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
      issued_at timestamptz NOT NULL DEFAULT now(),
      upload_deadline timestamptz NOT NULL,
      last_accepted_at timestamptz,
      resolved_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shooter_verification_run_identity FOREIGN KEY (run_id, user_id, session_id)
        REFERENCES game.shooter_run (run_id, user_id, session_id),
      CONSTRAINT shooter_verification_run_deadline CHECK (upload_deadline > issued_at AND upload_deadline <= issued_at + interval '45 minutes'),
      CONSTRAINT shooter_verification_run_empty CHECK ((accepted_sequence = -1) = (accepted_tick = 0)),
      CONSTRAINT shooter_verification_run_verified_empty CHECK (verified_tick > 0 OR verified_sequence = -1),
      CONSTRAINT shooter_verification_run_seal CHECK ((sealed_sequence IS NULL) = (sealed_tick IS NULL)),
      CONSTRAINT shooter_verification_run_sealed_range CHECK (sealed_sequence IS NULL OR (sealed_sequence = accepted_sequence AND sealed_tick = accepted_tick)),
      CONSTRAINT shooter_verification_run_terminal CHECK ((terminal_tick IS NULL) = (terminal_outcome IS NULL) AND (terminal_tick IS NULL) = (terminal_result IS NULL)),
      CONSTRAINT shooter_verification_run_terminal_tick CHECK (terminal_tick IS NULL OR terminal_tick = simulation_tick),
      CONSTRAINT shooter_verification_run_checkpoint CHECK ((checkpoint_json IS NULL) = (checkpoint_sha256 IS NULL)),
      CONSTRAINT shooter_verification_run_resolved CHECK (resolved_at IS NULL OR (resolved_at >= issued_at AND lifecycle NOT IN ('open', 'sealed', 'quarantined')))
    )`,
    // Expiry releases admission but does not discard accepted work or evidence.
    "CREATE UNIQUE INDEX IF NOT EXISTS shooter_verification_active_account ON game.shooter_verification_run (user_id) WHERE lifecycle IN ('open', 'sealed', 'quarantined')",
    "CREATE INDEX IF NOT EXISTS shooter_verification_status_owner ON game.shooter_verification_run (user_id, issued_at DESC, run_id)",
    "CREATE INDEX IF NOT EXISTS shooter_verification_expiry ON game.shooter_verification_run (upload_deadline, run_id) WHERE lifecycle IN ('open', 'sealed')",
    "CREATE INDEX IF NOT EXISTS shooter_verification_unresolved ON game.shooter_verification_run (updated_at, run_id) WHERE resolved_at IS NULL",
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_batch (
      run_id text NOT NULL REFERENCES game.shooter_verification_run (run_id),
      sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 4095),
      tick0 integer NOT NULL CHECK (tick0 BETWEEN 0 AND 161999),
      frame_count integer NOT NULL CHECK (frame_count BETWEEN 1 AND 28800),
      frames text NOT NULL CHECK (octet_length(frames) BETWEEN 1 AND 2097152),
      encoded_bytes integer NOT NULL CHECK (encoded_bytes = octet_length(frames)),
      actions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) <= 32 AND octet_length(actions::text) <= 65536),
      action_count integer NOT NULL CHECK (action_count = jsonb_array_length(actions)),
      request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
      received_ack jsonb NOT NULL CHECK (jsonb_typeof(received_ack) = 'object' AND octet_length(received_ack::text) <= 65536),
      accepted_at timestamptz NOT NULL DEFAULT now(),
      authorized_lease_until timestamptz NOT NULL,
      PRIMARY KEY (run_id, sequence),
      CONSTRAINT shooter_verification_batch_end CHECK (tick0 + frame_count <= 162000),
      CONSTRAINT shooter_verification_batch_live_acceptance CHECK (authorized_lease_until > accepted_at)
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS shooter_verification_batch_start ON game.shooter_verification_batch (run_id, tick0)",
    `CREATE OR REPLACE FUNCTION game.shooter_verification_batch_immutable()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'shooter_verification_batch_immutable';
    END;
    $fn$`,
    `DO $trigger$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'game.shooter_verification_batch'::regclass AND tgname = 'shooter_verification_batch_immutable') THEN
        CREATE TRIGGER shooter_verification_batch_immutable BEFORE UPDATE OR DELETE
        ON game.shooter_verification_batch FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_batch_immutable();
      END IF;
    END;
    $trigger$`,
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_job (
      job_id uuid PRIMARY KEY,
      run_id text NOT NULL REFERENCES game.shooter_verification_run (run_id),
      sequence_from integer NOT NULL CHECK (sequence_from BETWEEN 0 AND 4095),
      sequence_to integer NOT NULL CHECK (sequence_to BETWEEN sequence_from AND 4095),
      tick0 integer NOT NULL CHECK (tick0 BETWEEN 0 AND 161999),
      tick_end integer NOT NULL CHECK (tick_end > tick0 AND tick_end <= 162000),
      expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
      input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
      state text NOT NULL DEFAULT 'blocked' CHECK (state IN ('blocked', 'ready', 'leased', 'retry_wait', 'completed', 'quarantined', 'cancelled')),
      fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
      lease_owner text CHECK (lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9_.:@|-]{1,80}$'),
      lease_until timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text CHECK (last_error IS NULL OR octet_length(last_error) <= 80),
      verified_ack jsonb CHECK (verified_ack IS NULL OR (jsonb_typeof(verified_ack) = 'object' AND octet_length(verified_ack::text) <= 65536)),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (run_id, sequence_from) REFERENCES game.shooter_verification_batch (run_id, sequence),
      FOREIGN KEY (run_id, sequence_to) REFERENCES game.shooter_verification_batch (run_id, sequence),
      CONSTRAINT shooter_verification_job_lease CHECK ((state = 'leased') = (lease_owner IS NOT NULL) AND (state = 'leased') = (lease_until IS NOT NULL)),
      CONSTRAINT shooter_verification_job_attempts CHECK (attempts <= max_attempts AND (state <> 'leased' OR (attempts > 0 AND fencing_token > 0))),
      CONSTRAINT shooter_verification_job_ack CHECK ((state = 'completed') = (verified_ack IS NOT NULL))
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS shooter_verification_job_range ON game.shooter_verification_job (run_id, sequence_from, sequence_to, tick0, tick_end)",
    "CREATE UNIQUE INDEX IF NOT EXISTS shooter_verification_job_active_chain ON game.shooter_verification_job (run_id) WHERE state IN ('ready', 'leased', 'retry_wait')",
    "CREATE INDEX IF NOT EXISTS shooter_verification_job_claim ON game.shooter_verification_job (next_attempt_at, created_at, run_id) WHERE state IN ('ready', 'retry_wait')",
    "CREATE INDEX IF NOT EXISTS shooter_verification_job_reclaim ON game.shooter_verification_job (lease_until, run_id) WHERE state = 'leased'",
    "CREATE INDEX IF NOT EXISTS shooter_verification_job_history ON game.shooter_verification_job (run_id, created_at, job_id)",
  ],
});
