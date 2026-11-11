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
const ECONOMY = `SELECT md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY seq) FROM game.tickets_ledger t),''))
  ||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY run_id) FROM game.shooter_receipt t),''))
  ||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text, '' ORDER BY user_id,game_id) FROM game.tickets_balance t),''))`;
const metadata = `(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)`;
const values = `('${RUN}','${USER}','${SESSION}',1,1,1,repeat('a',64),repeat('b',40),'cea1f88b',now(),now()+interval '45 minutes')`;
const legacy = `INSERT INTO game.shooter_run (run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
  VALUES ('${RUN}','${USER}','${SESSION}','dup-schema',current_date,'sahil',7,'{}')`;
const batch = `INSERT INTO game.shooter_verification_batch
  (run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,authorized_lease_until)
  VALUES ('${RUN}',0,0,1,'AAAAAAAAAAAAAAAA',16,'[]',0,repeat('c',64),'{}',now()+interval '1 minute')`;
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
    psql(`BEGIN; ${legacy}; INSERT INTO game.shooter_verification_run ${metadata} VALUES ${values};
      ${batch};
      INSERT INTO game.shooter_verification_batch SELECT run_id,1,1,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,accepted_at,authorized_lease_until
        FROM game.shooter_verification_batch WHERE run_id='${RUN}' AND sequence=0;
      ${job};
      DO $checks$ BEGIN
        ${expectRefused(`INSERT INTO game.shooter_verification_batch SELECT * FROM game.shooter_verification_batch WHERE run_id='${RUN}'`, '23505')}
        ${expectRefused(`UPDATE game.shooter_verification_batch SET frames='AQAAAAAAAAAAAAAA' WHERE run_id='${RUN}'`, 'P0001')}
        ${expectRefused(`DELETE FROM game.shooter_verification_batch WHERE run_id='${RUN}'`, 'P0001')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET user_id='d0500000-0000-4000-8000-000000000099' WHERE run_id='${RUN}'`, '23503')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET verified_tick=1 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET accepted_bytes=67108865 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_run SET artifact_sha256='not-a-hash' WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`INSERT INTO game.shooter_verification_batch (run_id,sequence,tick0,frame_count,frames,encoded_bytes,actions,action_count,request_sha256,received_ack,authorized_lease_until) VALUES ('${RUN}',2,2,1,repeat('A',2097153),2097153,'[]',0,repeat('f',64),'{}',now()+interval '1 minute')`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_job SET state='leased' WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`UPDATE game.shooter_verification_job SET attempts=4 WHERE run_id='${RUN}'`, '23514')}
        ${expectRefused(`INSERT INTO game.shooter_verification_job (job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,max_attempts,state) VALUES ('d0500000-0000-4000-8000-000000000004','${RUN}',1,1,1,2,0,repeat('e',64),3,'ready')`, '23505')}
      END; $checks$;
      ROLLBACK;`);
    assert.equal(psql(ECONOMY), baseline, 'DDL constraints must not pay or change historical balances');
  });

  await test('shooter-verification', 'schema upgrade preserves legacy rows and a repeated boot preserves checksums', async () => {
    // Only safe on the pristine new queue. Future versions with live fixtures
    // must adapt this test instead of discarding retained verification evidence.
    for (const name of ['job', 'batch', 'run']) assert.equal(num(`SELECT count(*) FROM game.shooter_verification_${name}`), 0);
    assert.equal(migrationIds().at(-1), ID, 'upgrade fixture must be updated when a later migration is added');
    const ledger = psql(`SELECT id||':'||checksum FROM game.schema_migrations WHERE id<>'${ID}' ORDER BY id`);
    const economy = psql(ECONOMY);
    compose(['stop', 'nakama']);
    try {
      psql(`${legacy}; DROP TABLE game.shooter_verification_job,game.shooter_verification_batch,game.shooter_verification_run;
        DELETE FROM game.schema_migrations WHERE id='${ID}';`);
    } finally {
      compose(['up', '-d', 'nakama']);
      await waitReady();
    }
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE run_id='${RUN}' AND user_id='${USER}' AND session_id='${SESSION}'`), 1);
    assert.equal(psql(`SELECT id||':'||checksum FROM game.schema_migrations WHERE id<>'${ID}' ORDER BY id`), ledger);
    assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${ID}'`), fileChecksum(ID));
    const applied = psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations ORDER BY id`);
    compose(['restart', 'nakama']);
    await waitReady();
    assert.equal(psql(`SELECT id||':'||checksum||':'||applied_at::text FROM game.schema_migrations ORDER BY id`), applied, 'repeat boot must not reapply migrations');
    assert.equal(psql(ECONOMY), economy);
    psql(`DELETE FROM game.shooter_run WHERE run_id='${RUN}'`);
  });
}
