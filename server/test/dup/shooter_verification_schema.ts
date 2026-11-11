// Real PostgreSQL constraints. This runs only on the suite's throwaway Compose
// database; fixture inserts are rolled back and never touch payment functions.
import assert from 'node:assert/strict';
import { psql, compose, waitReady, num } from './harness.ts';
import { fileChecksum, migrationIds } from './migrations.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
const ID = '0050_shooter_verification_queue';
const USER = 'd0500000-0000-4000-8000-000000000001';
const SESSION = 'd0500000-0000-4000-8000-000000000002';
const JOB = 'd0500000-0000-4000-8000-000000000003';
const RUN = 'dup-verification-schema';
const HISTORY = `${RUN}-settled`;
const ECONOMY = `SELECT md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY seq) FROM game.tickets_ledger t),''))
  ||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY run_id) FROM game.shooter_receipt t),''))
  ||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY user_id,game_id) FROM game.tickets_balance t),''))`;
const TEST_ADMISSION = `UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000`;
const metadata = `(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)`;
const values = `('${RUN}','${USER}','${SESSION}',1,1,1,repeat('a',64),repeat('b',40),'cea1f88b',now(),now()+interval '45 minutes')`;
const legacy = `INSERT INTO game.shooter_run (run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
  VALUES ('${RUN}','${USER}','${SESSION}','dup-schema',current_date,'sahil',7,'{}')`;
const batch = `INSERT INTO game.shooter_verification_batch
  (run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,authorized_lease_until)
  VALUES ('${RUN}',0,0,4,repeat('A',64),64,'[]',0,repeat('c',64),'{}',now()+interval '1 minute')`;
const job = `INSERT INTO game.shooter_verification_job
  (job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state)
  VALUES ('${JOB}','${RUN}',0,0,0,1,0,repeat('d',64),3,'ready')`;

function expectRefused(statement: string, state: string): string {
  // A PL/pgSQL exception subtransaction rolls back exactly the rejected write.
  return `BEGIN ${statement}; RAISE EXCEPTION USING ERRCODE='P9999', MESSAGE='expected SQLSTATE ${state}';
    EXCEPTION WHEN SQLSTATE '${state}' THEN NULL; END;`;
}

export async function runShooterVerificationSchema(test: TestFn): Promise<void> {
  await test('shooter-verification', 'schema is discovered and fresh boot applied the exact migration', async () => {
    assert.equal(migrationIds().filter((id) => id === ID).length, 1);
    assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${ID}'`), fileChecksum(ID));
    assert.equal(num(`SELECT count(*) FROM pg_tables WHERE schemaname='game' AND tablename IN ('shooter_verification_run','shooter_verification_batch','shooter_verification_job')`), 3);
    assert.equal(num(`SELECT count(*) FROM pg_indexes WHERE schemaname='game' AND indexname IN ('shooter_verification_active_account','shooter_verification_batch_start','shooter_verification_job_active_chain','shooter_verification_job_claim','shooter_verification_job_reclaim')`), 5);
  });

  await test('shooter-verification', 'schema constraints reject duplicate history, changed identity and unsafe jobs', async () => {
    const baseline = psql(ECONOMY);
    psql(`BEGIN; ${TEST_ADMISSION}; ${legacy}; INSERT INTO game.shooter_verification_run ${metadata} VALUES ${values};
      ${batch};
      INSERT INTO game.shooter_verification_batch SELECT run_id,1,4,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,accepted_at,authorized_lease_until
        FROM game.shooter_verification_batch WHERE run_id='${RUN}' AND sequence=0;
      UPDATE game.shooter_verification_run SET accepted_sequence=1,accepted_batches=2,accepted_tick=8,accepted_bytes=128 WHERE run_id='${RUN}';
      ${job};
      DO $checks$ BEGIN
        ${expectRefused(`INSERT INTO game.shooter_verification_batch SELECT * FROM game.shooter_verification_batch WHERE run_id='${RUN}'`, '23505')}
        ${expectRefused(`UPDATE game.shooter_verification_batch SET frames='AQAAAAAAAAAAAAAA' WHERE run_id='${RUN}'`, 'P0001')}
        ${expectRefused(`DELETE FROM game.shooter_verification_batch WHERE run_id='${RUN}'`, 'P0001')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET user_id='d0500000-0000-4000-8000-000000000099' WHERE run_id='${RUN}'`, '23503')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET verified_tick=9 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET accepted_bytes=67108865 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET artifact_sha256='not-a-hash' WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`INSERT INTO game.shooter_verification_batch (run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,authorized_lease_until) VALUES ('${RUN}',2,2,1,repeat('A',2097153),2097153,'[]',0,repeat('f',64),'{}',now()+interval '1 minute')`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_job SET state='leased' WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_job SET attempts=4 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`INSERT INTO game.shooter_verification_job (job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state) VALUES ('d0500000-0000-4000-8000-000000000004','${RUN}',1,1,4,5,0,repeat('e',64),3,'ready')`, '23505')}
      END; $checks$;
      -- A committed work slice can advance within the first public batch while
      -- verified_sequence=-1 and verified_batches=0 remain truthful.
      UPDATE game.shooter_verification_run SET revision=1,verified_tick=1,simulation_tick=1,verified_bytes=16 WHERE run_id='${RUN}';
      UPDATE game.shooter_verification_job SET state='completed',verified_ack='{}' WHERE job_id='${JOB}';
      INSERT INTO game.shooter_verification_job
        (job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state)
        VALUES ('d0500000-0000-4000-8000-000000000005','${RUN}',0,0,1,2,1,repeat('f',64),3,'ready');
      DO $partial$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM game.shooter_verification_run WHERE run_id='${RUN}' AND verified_tick=1 AND simulation_tick=1 AND verified_sequence=-1 AND verified_batches=0) THEN
          RAISE EXCEPTION 'partial-first-batch progress was not persisted';
        END IF;
        IF (SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${RUN}' AND sequence_from=0 AND sequence_to=0) <> 2 THEN
          RAISE EXCEPTION 'successive work slices inside the same batch were not persisted';
        END IF;
      END; $partial$;
      ROLLBACK;`);
    assert.equal(psql(ECONOMY), baseline, 'DDL constraints must not pay or change historical balances');
  });

  await test('shooter-verification', 'schema upgrade preserves legacy rows and a repeated boot preserves checksums', async () => {
    // Only safe on the pristine new queue. Future versions with live fixtures
    // must adapt this test instead of discarding retained verification evidence.
    for (const name of ['job', 'batch', 'run']) assert.equal(num(`SELECT count(*) FROM game.shooter_verification_${name}`), 0);
    const v2Ids = migrationIds().filter((id) => /^[0-9]+_shooter_(verification|verified|v2)_/.test(id));
    const v2SqlIds = v2Ids.map((id) => "'" + id.replace(/'/g, "''") + "'").join(',');

    assert.ok(v2Ids.includes(ID));
    // Trusted synthetic historical DB fixture, not a forged client reward.
    // Keep receipt, balance, ledger and idempotency evidence mutually consistent.
    psql(`INSERT INTO game.shooter_run (run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json,status)
      VALUES ('${HISTORY}','${USER}','${SESSION}','dup-schema-history',current_date,'sahil',7,'{}','settled');
      INSERT INTO game.tickets_balance (user_id,game_id,balance) VALUES ('${USER}','sproto-shooter',20);
      INSERT INTO game.tickets_ledger (event_id,user_id,game_id,delta,balance_after,reason,ref_id,kind)
        VALUES ('d0500000-0000-4000-8000-000000000006','${USER}','sproto-shooter',20,20,'srv_shooter_boss_clear','${SESSION}','earn');
      INSERT INTO game.shooter_receipt (user_id,game_id,canonical_boss,day,run_id,session_id,log_digest,state_hash,clear_ms,tickets,protocol,fingerprint,response)
        VALUES ('${USER}','sproto-shooter','sahil',current_date,'${HISTORY}','${SESSION}',repeat('a',64),'12345678',1000,20,1,'cea1f88b','{"paid":true,"tickets":20}');
      INSERT INTO game.idempotency (user_id,key,rpc,req_hash,response)
        VALUES ('${USER}','shclr:${HISTORY}','tickets.earn',decode(repeat('b',64),'hex'),'{"paid":true,"tickets":20}');`);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${HISTORY}'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${USER}' AND delta=20`), 1);
    assert.equal(num(`SELECT balance FROM game.tickets_balance WHERE user_id='${USER}' AND game_id='sproto-shooter'`), 20);
    const ledger = psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations WHERE id NOT IN (${v2SqlIds}) ORDER BY id`);
    const economy = psql(ECONOMY);
    compose(['stop', 'nakama']);
    try {
      psql(`${legacy}; DROP TABLE IF EXISTS game.shooter_verification_payment_config,game.shooter_verification_gateway_rate,game.shooter_verification_gateway_receipt,game.shooter_verification_principal,game.shooter_verification_worker,game.shooter_verification_gateway,game.shooter_verification_attempt_result,game.shooter_verification_attempt,game.shooter_verification_scheduler_account,game.shooter_verification_scheduler,game.shooter_verification_job,game.shooter_verification_batch,game.shooter_verification_run,game.shooter_verification_admission_account,game.shooter_verification_admission;
        DELETE FROM game.schema_migrations WHERE id IN (${v2SqlIds});`);

    } finally {
      compose(['up', '-d', 'nakama']);
      await waitReady();
    }
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE run_id='${RUN}' AND user_id='${USER}' AND session_id='${SESSION}'`), 1);
    assert.equal(psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations WHERE id NOT IN (${v2SqlIds}) ORDER BY id`), ledger);

    for (const id of v2Ids) assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${id}'`), fileChecksum(id));
    const applied = psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations ORDER BY id`);
    compose(['restart', 'nakama']);
    await waitReady();
    assert.equal(psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations ORDER BY id`), applied, 'repeat boot must not reapply migrations');
    assert.equal(psql(ECONOMY), economy);
    psql(`DELETE FROM game.shooter_run WHERE run_id='${RUN}'`);
  });
}
