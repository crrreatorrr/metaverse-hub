// PR12: payment follows the already committed PR11 result in a SECOND query.
// Never take economic/session locks inside the checkpoint transaction.
namespace ShooterVerificationSettlement {
  export function afterResult(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    worker: string, key: string, tokenHash: string, requestId: string, ack: { [key: string]: unknown }): void {
    if (ack.state !== "terminal_verified" || typeof ack.runId !== "string"
      || typeof ack.terminalRevision !== "number" || ack.terminalRevision < 1) return;
    var paid = false;
    try {
      var result = ShooterRewards.queryJson(nk,
        "SELECT game.settle_shooter_verified_result($1::uuid,$2::text,$3::text,$4::text,$5::text)::text AS result",
        [ctx.userId, worker, key, tokenHash, requestId]);
      paid = result.paid === true;
    } catch (_error) {
      // Private SQL parameters must never enter logs. The verification receipt
      // has already committed and remains the immutable RPC acknowledgment.
      logger.error("shooter deferred payment operational failure");
    }
    if (paid) HubFault.apply(ctx, nk, ctx.userId || "", "shooter.v2.after_payment_commit");
  }
}

HubSchema.register({
  id: "0055_shooter_verification_settlement",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.shooter_verification_payment_config (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      payments_enabled boolean NOT NULL DEFAULT false
    )`,
    "INSERT INTO game.shooter_verification_payment_config(singleton) VALUES(true) ON CONFLICT DO NOTHING",
    `ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS payment_ack jsonb
      CHECK(payment_ack IS NULL OR (jsonb_typeof(payment_ack)='object' AND octet_length(payment_ack::text)<=65536))`,
    `ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS payment_first_denial jsonb
      CHECK(payment_first_denial IS NULL OR (jsonb_typeof(payment_first_denial)='object' AND octet_length(payment_first_denial::text)<=2048))`,
    "ALTER TABLE game.shooter_verification_run ADD COLUMN IF NOT EXISTS payment_attempted_at timestamptz",
    `CREATE OR REPLACE FUNCTION game.settle_shooter_verified_result(a uuid,w text,k text,h text,rid text)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    <<settlement>>
    DECLARE
      principal game.shooter_verification_principal%ROWTYPE;
      gateway game.shooter_verification_gateway%ROWTYPE;
      proof game.shooter_verification_gateway_receipt%ROWTYPE;
      cfg game.shooter_verification_payment_config%ROWTYPE;
      run game.shooter_verification_run%ROWTYPE;
      legacy game.shooter_run%ROWTYPE;
      game_session_row game.game_session%ROWTYPE;
      target text; owner uuid; original_session uuid; expected bigint;
      t timestamptz; v_day date; final_day date; tries integer; clock_ready boolean:=false;
      v_response jsonb; existing_hash bytea; existing_rpc text;
      session_earned bigint; boss_used bigint; day_used bigint;
      v_balance bigint; clear_ms bigint; evidence text; idem text; why text;
    BEGIN
      -- Authorization is current, scoped and transactionally locked. A prior
      -- checkpoint receipt is authority for its own target, never an amount.
      SELECT * INTO principal FROM game.shooter_verification_principal
        WHERE account_id=a AND worker_id=w AND key_id=k FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('state','pending_retryable','reason','worker_authorization'); END IF;
      SELECT * INTO gateway FROM game.shooter_verification_gateway WHERE singleton FOR UPDATE;
      t:=clock_timestamp();
      IF principal.revoked_at IS NOT NULL OR principal.not_before>t OR principal.expires_at<=t
        OR NOT 'result'=ANY(principal.scopes) OR NOT game.shooter_verification_hash_equal(principal.token_sha256,h) THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','worker_authorization'); END IF;
      SELECT * INTO proof FROM game.shooter_verification_gateway_receipt
        WHERE worker_id=w AND request_id=rid AND account_id=a AND operation='result';
      IF NOT FOUND OR proof.acknowledgment->>'state' IS DISTINCT FROM 'terminal_verified'
        OR proof.acknowledgment->>'runId' IS NULL
        OR COALESCE(proof.acknowledgment->>'terminalRevision','')!~'^[1-9][0-9]{0,15}$' THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','uncommitted_terminal'); END IF;
      target:=proof.acknowledgment->>'runId'; expected:=(proof.acknowledgment->>'terminalRevision')::bigint;
      SELECT user_id,session_id INTO owner,original_session FROM game.shooter_verification_run WHERE run_id=target;
      IF NOT FOUND THEN RETURN jsonb_build_object('state','pending_retryable','reason','unknown_run'); END IF;
      SELECT * INTO cfg FROM game.shooter_verification_payment_config WHERE singleton FOR SHARE;
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || owner::text,0));
      SELECT * INTO game_session_row FROM game.game_session WHERE session_id=original_session FOR UPDATE;
      SELECT * INTO legacy FROM game.shooter_run WHERE run_id=target FOR UPDATE;
      SELECT * INTO run FROM game.shooter_verification_run WHERE run_id=target FOR UPDATE;
      t:=clock_timestamp();
      IF principal.expires_at<=t OR principal.not_before>t THEN RETURN jsonb_build_object('state','pending_retryable','reason','worker_authorization'); END IF;
      IF run.user_id IS DISTINCT FROM owner OR run.session_id IS DISTINCT FROM original_session
        OR legacy.user_id IS DISTINCT FROM owner OR legacy.session_id IS DISTINCT FROM original_session
        OR run.terminal_revision IS DISTINCT FROM expected THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','terminal_binding'); END IF;
      SELECT sr.response INTO v_response FROM game.shooter_receipt sr WHERE run_id=target AND user_id=owner;
      IF FOUND THEN RETURN v_response; END IF;
      IF run.payment_state IN ('authorization_denied','ineligible') AND run.payment_ack IS NOT NULL THEN RETURN run.payment_ack; END IF;
      IF run.lifecycle<>'terminal' OR run.terminal_tick IS NULL OR run.terminal_result IS NULL
        OR run.terminal_accepted_tick IS NULL OR run.verified_tick<>run.terminal_accepted_tick THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','verification_pending'); END IF;
      IF run.simulator_protocol<>1 OR run.upload_protocol<>2 OR run.checkpoint_schema<>2 OR run.economy_policy<>1
        OR run.content_fingerprint<>'cea1f88b'
        OR run.checkpoint_json->'snapshot'->'manifest'->>'sha256' IS DISTINCT FROM run.artifact_sha256
        OR run.checkpoint_json->'snapshot'->'manifest'->>'sourceCommit' IS DISTINCT FROM run.source_commit
        OR run.checkpoint_json->'firstTerminal' IS DISTINCT FROM run.terminal_result
        OR COALESCE(run.terminal_result->>'stateHash','') !~ '^[0-9a-f]{8}$'
        OR (run.terminal_result->>'simTick')::bigint IS DISTINCT FROM run.terminal_tick THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','unsupported_payment_policy'); END IF;
      IF run.terminal_outcome<>'clear' OR run.terminal_result->>'outcome' IS DISTINCT FROM 'clear'
        OR run.terminal_result->>'reason' IS DISTINCT FROM 'boss_clear' OR run.terminal_result->>'eligible' IS DISTINCT FROM 'true'
        OR run.terminal_result->>'ranked' IS DISTINCT FROM 'true' OR run.terminal_result->>'canonicalCount' IS DISTINCT FROM '1' THEN
        v_response:=jsonb_build_object('state','ineligible','reason','ineligible','paid',false,'tickets',0,'ticketsMinted',0);
        UPDATE game.shooter_verification_run SET payment_state='ineligible',payment_reason='ineligible',payment_ack=v_response,
          payment_first_denial=COALESCE(payment_first_denial,jsonb_build_object('reason','ineligible','at',clock_timestamp())),
          payment_attempted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=target;
        UPDATE game.shooter_run SET status='closed' WHERE run_id=target AND status='open';
        RETURN v_response;
      END IF;
      IF gateway.singleton IS NULL OR NOT gateway.enabled OR cfg.singleton IS NULL OR NOT cfg.payments_enabled THEN
        RETURN jsonb_build_object('state','pending_retryable','reason','payments_disabled'); END IF;
      evidence:=encode(sha256(convert_to(jsonb_build_object('domain','shooter-verified-clear-v2','runId',target,
        'terminalRevision',run.terminal_revision,'artifact',run.artifact_sha256,'terminal',run.terminal_result,
        'acceptedTick',run.terminal_accepted_tick,'inputs',(SELECT string_agg(request_sha256,':' ORDER BY sequence)
          FROM game.shooter_verification_batch WHERE run_id=target AND sequence<=run.terminal_accepted_sequence))::text,'UTF8')),'hex');
      clear_ms:=round(run.terminal_tick::numeric*1000/60)::bigint; idem:='shclr:' || target;
      BEGIN
        -- Rollbackable preparation acquires all financial unique/row locks BEFORE
        -- the final clock. Wagers can hold the wallet without the economy lock.
        INSERT INTO game.tickets_balance(user_id,game_id,balance) VALUES(owner,'sproto-shooter',0) ON CONFLICT DO NOTHING;
        SELECT b.balance INTO v_balance FROM game.tickets_balance b WHERE user_id=owner AND game_id='sproto-shooter' FOR UPDATE;
        INSERT INTO game.earn_window(user_id,bucket,day,amount) VALUES(owner,'boss:sproto-shooter:' || legacy.canonical_boss,legacy.day,0) ON CONFLICT DO NOTHING;
        SELECT e.amount INTO boss_used FROM game.earn_window e WHERE user_id=owner AND bucket='boss:sproto-shooter:' || legacy.canonical_boss AND e.day=legacy.day FOR UPDATE;
        INSERT INTO game.ranked_score(user_id,board_id,variant,value,meta,session_id)
          VALUES(owner,'shooter_story_clear_ms_v1',legacy.canonical_boss,9223372036854775807,'{}',original_session) ON CONFLICT DO NOTHING;
        PERFORM 1 FROM game.ranked_score WHERE user_id=owner AND board_id='shooter_story_clear_ms_v1' AND variant=legacy.canonical_boss FOR UPDATE;
        INSERT INTO game.idempotency(user_id,key,rpc,req_hash,response)
          VALUES(owner,idem,'tickets.earn',decode(evidence,'hex'),'{}') ON CONFLICT DO NOTHING;
        SELECT req_hash,rpc INTO existing_hash,existing_rpc FROM game.idempotency WHERE user_id=owner AND key=idem FOR UPDATE;
        IF existing_hash IS DISTINCT FROM decode(evidence,'hex') OR existing_rpc IS DISTINCT FROM 'tickets.earn' THEN
          RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='history_conflict'; END IF;
        v_day:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
        FOR tries IN 1..3 LOOP
          INSERT INTO game.earn_window(user_id,bucket,day,amount) VALUES(owner,'tickets:sproto-shooter',v_day,0) ON CONFLICT DO NOTHING;
          SELECT e.amount INTO day_used FROM game.earn_window e WHERE user_id=owner AND bucket='tickets:sproto-shooter' AND e.day=v_day FOR UPDATE;
          t:=clock_timestamp(); final_day:=(t AT TIME ZONE 'UTC')::date;
          IF final_day=v_day THEN clock_ready:=true; EXIT; END IF;
          v_day:=final_day;
        END LOOP;
        IF NOT clock_ready THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='clock_unstable'; END IF;
        IF principal.expires_at<=t OR principal.not_before>t THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='worker_authorization'; END IF;
        IF game_session_row.session_id IS NULL OR game_session_row.user_id IS DISTINCT FROM owner OR game_session_row.game_id IS DISTINCT FROM 'sproto-shooter'
          OR game_session_row.ticket_redeemed_at IS NULL OR game_session_row.state='closed' THEN
          RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='session_closed'; END IF;
        IF game_session_row.state='expired' OR game_session_row.lease_until<=t THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='session_expired'; END IF;
        IF game_session_row.state<>'open' THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='session_closed'; END IF;
        IF legacy.status<>'open' OR legacy.canonical_boss NOT IN ('sahil','obama','broccoli','glowie','tinubu') THEN
          RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='history_conflict'; END IF;
        IF EXISTS(SELECT 1 FROM game.shooter_receipt WHERE user_id=owner AND game_id='sproto-shooter'
          AND canonical_boss=legacy.canonical_boss AND game.shooter_receipt.day=legacy.day) OR boss_used>=1 THEN
          RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='already_paid'; END IF;
        IF game.session_ticket_cap()<>200 THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='unsupported_payment_policy'; END IF;
        SELECT COALESCE(sum(delta),0) INTO session_earned FROM game.tickets_ledger
          WHERE user_id=owner AND game_id='sproto-shooter' AND ref_id=original_session AND delta>0
          AND COALESCE(kind,'')<>'refund' AND reason<>'refund';
        IF session_earned+20>200 THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='session_ticket_cap'; END IF;
        IF day_used+20>1000 THEN RAISE EXCEPTION USING ERRCODE='P5DEN',MESSAGE='daily_ticket_cap'; END IF;
        UPDATE game.tickets_balance SET balance=game.tickets_balance.balance+20 WHERE user_id=owner AND game_id='sproto-shooter' RETURNING game.tickets_balance.balance INTO v_balance;
        INSERT INTO game.tickets_ledger(event_id,user_id,game_id,delta,balance_after,reason,ref_id,kind)
          VALUES(gen_random_uuid(),owner,'sproto-shooter',20,v_balance,'srv_shooter_boss_clear',original_session,'earn');
        UPDATE game.earn_window SET amount=game.earn_window.amount+20 WHERE user_id=owner AND bucket='tickets:sproto-shooter' AND game.earn_window.day=v_day;
        UPDATE game.earn_window SET amount=game.earn_window.amount+1 WHERE user_id=owner AND bucket='boss:sproto-shooter:' || legacy.canonical_boss AND game.earn_window.day=legacy.day;
        v_response:=jsonb_build_object('ok',true,'paid',true,'replay',false,'tickets',20,'balance',v_balance,
          'canonicalBoss',legacy.canonical_boss,'canonicalCount',1,'day',to_char(legacy.day,'YYYY-MM-DD'),
          'runId',target,'logDigest',evidence,'stateHash',run.terminal_result->>'stateHash','clearMs',clear_ms,
          'score',clear_ms,'boardId','shooter_story_clear_ms_v1','protocol',1,'uploadProtocol',2,'fingerprint','cea1f88b','ticketsMinted',0);
        UPDATE game.ranked_score SET value=clear_ms,
          meta=jsonb_build_object('protocol',1,'fingerprint','cea1f88b','runId',target,'stateHash',run.terminal_result->>'stateHash','version',1),
          session_id=original_session,updated_at=t
          WHERE user_id=owner AND board_id='shooter_story_clear_ms_v1' AND variant=legacy.canonical_boss AND value>clear_ms;
        INSERT INTO game.shooter_receipt(user_id,game_id,canonical_boss,day,run_id,session_id,log_digest,state_hash,clear_ms,tickets,protocol,fingerprint,response)
          VALUES(owner,'sproto-shooter',legacy.canonical_boss,legacy.day,target,original_session,evidence,run.terminal_result->>'stateHash',clear_ms,20,1,'cea1f88b',v_response);
        INSERT INTO game.shooter_digest(user_id,digest,run_id) VALUES(owner,evidence,target);
        UPDATE game.idempotency SET response=v_response WHERE user_id=owner AND key=idem;
        UPDATE game.shooter_run SET status='settled' WHERE run_id=target;
        UPDATE game.shooter_verification_run SET payment_state='paid',payment_reason=NULL,payment_ack=v_response,payment_attempted_at=t,updated_at=t WHERE run_id=target;
        RETURN v_response;
      EXCEPTION WHEN SQLSTATE 'P5DEN' THEN
        why:=SQLERRM;
      END;
      -- The subtransaction rolled back ALL preparation and money writes. Only
      -- bounded separate payment facts change; verification revision never does.
      IF why IN ('session_expired','session_closed') THEN
        v_response:=jsonb_build_object('state','authorization_denied','reason',why,'paid',false,'tickets',0,'ticketsMinted',0);
        UPDATE game.shooter_verification_run SET payment_state='authorization_denied',payment_reason=why,payment_ack=v_response,
          payment_first_denial=COALESCE(payment_first_denial,jsonb_build_object('reason',why,'at',t)),payment_attempted_at=t,updated_at=t WHERE run_id=target;
        UPDATE game.shooter_run SET status='closed' WHERE run_id=target AND status='open';
      ELSIF why='already_paid' THEN
        v_response:=jsonb_build_object('state','ineligible','reason','already_paid','paid',false,'tickets',0,'ticketsMinted',0);
        UPDATE game.shooter_verification_run SET payment_state='ineligible',payment_reason='already_paid',payment_ack=v_response,
          payment_first_denial=COALESCE(payment_first_denial,jsonb_build_object('reason',why,'at',t)),payment_attempted_at=t,updated_at=t WHERE run_id=target;
        UPDATE game.shooter_run SET status='closed' WHERE run_id=target AND status='open';
      ELSIF why IN ('session_ticket_cap','daily_ticket_cap') THEN
        v_response:=jsonb_build_object('state','payment_pending','reason','cap_exhausted','capReason',why,'paid',false,'tickets',0,'ticketsMinted',0);
        UPDATE game.shooter_verification_run SET payment_state='pending',payment_reason='cap_exhausted',payment_ack=v_response,
          payment_first_denial=COALESCE(payment_first_denial,jsonb_build_object('reason',why,'at',t)),payment_attempted_at=t,updated_at=t WHERE run_id=target;
      ELSE
        v_response:=jsonb_build_object('state','pending_retryable','reason',COALESCE(why,'payment_unavailable'),'paid',false,'tickets',0,'ticketsMinted',0);
      END IF;
      RETURN v_response;
    END; $fn$`,
  ],
});
