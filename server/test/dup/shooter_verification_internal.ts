import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guest, openGame, call, psql, psqlAsync, num, sleep, type Guest } from './harness.ts';
type TestFn = (category:string,name:string,fn:()=>Promise<void>)=>Promise<void>;
type Row = Record<string,unknown>;
const SHA='797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9';
const ROOT=new URL('../../../services/shooter-verifier/artifacts/'+SHA+'/',import.meta.url);
const q=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
const CONFIG=`UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=100000,account_attempts_per_minute=10000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400;
 UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=1000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=1000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1073741824,max_account_checkpoint_bytes=67108864,lease_seconds=30,attempt_seconds=120,attempt_limit=3,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096`;
function isolate():void { psql(`UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL WHERE state IN ('ready','leased','retry_wait');UPDATE game.shooter_verification_run SET lifecycle='invalid' WHERE lifecycle IN ('open','sealed','expired','terminal','quarantined');${CONFIG}`); }
function hash(s:string):string {return createHash('sha256').update(s).digest('hex');}
async function principal(scopes=['claim','renew','retry','result']):Promise<{account:Guest;workerId:string;keyId:string;token:string}> {
  const account=await guest(),workerId='worker-'+crypto.randomUUID(),keyId='key1',token=randomBytes(32).toString('base64url');
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${workerId}','${account.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${account.userId}','${workerId}','${keyId}','${hash('shooter-worker-token-v1\n'+token)}',ARRAY[${scopes.map(q).join(',')}],clock_timestamp()-interval '1 second',clock_timestamp()+interval '5 minutes')`);
  return {account,workerId,keyId,token};
}
type Principal=Awaited<ReturnType<typeof principal>>;
function env(p:Principal,body:object={},requestId=crypto.randomUUID()):Row {return {workerId:p.workerId,keyId:p.keyId,token:p.token,requestId,body};}
async function rpc(p:Principal,op:string,body:object={},rid?:string):Promise<Row> {return (await call('shooter.internal.'+op,env(p,body,rid),p.account.token)).body as Row;}
async function fixture():Promise<string> {
  const player=await guest(),login=await openGame(player.token,'sproto-shooter'),run=crypto.randomUUID();
  const context=vm.createContext({});vm.runInContext(readFileSync(new URL('shooter-sim.js',ROOT),'utf8'),context);
  context.args=JSON.stringify({accountId:player.userId,sessionId:login.sessionId,runId:run,day:psql('SELECT current_date::text'),seed:7,canonicalBoss:'sahil'});
  const issuance=vm.runInContext('JSON.stringify(SprotoShooterSim.buildIssuance(JSON.parse(args)).issuance)',context) as string;
  psql(`INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES('${run}','${player.userId}','${login.sessionId}','internal:${run}',current_date,'sahil',7,${q(issuance)});
    INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES('${run}','${player.userId}','${login.sessionId}',1,2,1,'${SHA}','05f7a0a245af921fc65a99588564175c19658e38','cea1f88b',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '43 minutes');`);
  const appended=await call('shooter.run.append',{protocol:2,runId:run,sequence:0,tick0:0,n:8,frames:Buffer.alloc(96).toString('base64'),actions:[]},login.gameToken);
  assert.equal((appended.body as Row).state,'received',JSON.stringify(appended)); return run;
}
function workerResult(work:Row):Row {
  const context=vm.createContext({});vm.runInContext(readFileSync(new URL('shooter-sim.js',ROOT),'utf8'),context);context.text=JSON.stringify(work);
  return JSON.parse(vm.runInContext(`(()=>{const w=JSON.parse(text),m=w.manifest,ctx={issuance:w.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},accepted:w.accepted,maxWorkFrames:w.maxWorkFrames};
    let r=SprotoShooterSim.beginIncrementalReplay(ctx);r=SprotoShooterSim.acceptReplayBatch(JSON.stringify(w.batch),r.privateCheckpoint,ctx);r=SprotoShooterSim.stepReplaySlice(r.privateCheckpoint,ctx);
    return JSON.stringify({kind:'replayed',binding:w.claim,privateCheckpoint:r.privateCheckpoint,publicResult:JSON.parse(SprotoShooterSim.publicReplayJSON(r))});})()`,context) as string) as Row;
}
async function waitLock(marker:string):Promise<void> {
  for(let i=0;i<25;i++){if(num(`SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE ${q('%'+marker+'%')} AND wait_event='PgSleep'`)>0)return;await sleep(50);}
  throw new Error('fixture lock not acquired');
}
async function waitGatewayBlocked():Promise<void> {
  for(let i=0;i<25;i++){if(num("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%SELECT game.shooter_verification_internal(%' AND wait_event_type='Lock'")>0)return;await sleep(50);}
  throw new Error('gateway did not block on downstream lock');
}
export async function runShooterVerificationInternal(test:TestFn):Promise<void> {
  await test('shooter-internal','gateway defaults off, has no production principals, and denies HTTP admin-key-only/ordinary account callers',async()=>{
    assert.equal(psql('SELECT enabled::text FROM game.shooter_verification_gateway'),'false');assert.equal(num('SELECT count(*) FROM game.shooter_verification_principal'),0);
    assert.equal(((await call('shooter.internal.claim',{})).body as Row).state,'authorization_denied');
    const g=await guest();assert.equal(((await call('shooter.internal.claim',{token:'x'.repeat(43)},g.token)).body as Row).state,'authorization_denied');
  });
  await test('shooter-internal','scoped principal auth rejects forged worker/key/token and expired/revoked credentials; rotation is explicit',async()=>{
    isolate();const p=await principal();
    for(const patch of [{workerId:'forged'},{keyId:'unknown'},{token:'x'.repeat(43)}])assert.equal(((await call('shooter.internal.claim',{...env(p),...patch},p.account.token)).body as Row).state,'authorization_denied');
    assert.equal(((await call('shooter.internal.claim',env(p))).body as Row).state,'authorization_denied','adminHTTPkey plus servicebearer still lacks boundaccountidentity');
    const other=await guest();assert.equal(((await call('shooter.internal.claim',env(p),other.token)).body as Row).state,'authorization_denied');
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE worker_id='${p.workerId}'`);
    assert.equal((await rpc(p,'claim')).state,'authorization_denied');
    const token2=randomBytes(32).toString('base64url');
    psql(`INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
      VALUES('${p.account.userId}','${p.workerId}','key2','${hash('shooter-worker-token-v1\n'+token2)}',ARRAY['claim'],clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 minute')`);
    const rotated={...p,keyId:'key2',token:token2};assert.notEqual((await rpc(rotated,'claim')).state,'authorization_denied');
    assert.equal((await rpc(rotated,'renew',{jobId:crypto.randomUUID(),fence:1,expectedRevision:0})).state,'authorization_denied');
    psql(`UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp() WHERE worker_id='${p.workerId}' AND key_id='key2'`);
    assert.equal((await rpc(rotated,'claim')).state,'authorization_denied');
  });
  await test('shooter-internal','logical worker ownership cannot be duplicated across accounts even during concurrent provisioning',async()=>{
    isolate();const a=await guest(),b=await guest(),worker='worker-'+crypto.randomUUID();
    const provision=(account:string,key:string)=>psqlAsync(`BEGIN;INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${worker}','${account}');
      INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
      VALUES('${account}','${worker}','${key}','${'a'.repeat(64)}',ARRAY['claim'],clock_timestamp(),clock_timestamp()+interval '1 minute');COMMIT;`);
    const results=await Promise.allSettled([provision(a.userId,'key-a'),provision(b.userId,'key-b')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_worker WHERE worker_id='${worker}'`),1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_principal WHERE worker_id='${worker}'`),1);
    const owner=psql(`SELECT account_id::text FROM game.shooter_verification_worker WHERE worker_id='${worker}'`),other=owner===a.userId?b.userId:a.userId;
    const conflicting=await Promise.allSettled([psqlAsync(`INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
      VALUES('${other}','${worker}','other-key','${'b'.repeat(64)}',ARRAY['claim'],clock_timestamp(),clock_timestamp()+interval '1 minute')`)]);
    assert.equal(conflicting[0]!.status,'rejected','registryFKrejectsseconddifferentaccountkey');
  });
  await test('shooter-internal','real network coordinator claims, renews, replays in isolated process and commits a verified checkpoint',async()=>{
    isolate();const p=await principal(),run=await fixture();
    const text=execFileSync(process.execPath,[fileURLToPath(new URL('../../../services/shooter-verifier/test/live-gateway.mjs',import.meta.url))],{
      input:JSON.stringify({url:process.env.NAKAMA_URL||'http://127.0.0.1:7350',workerId:p.workerId,keyId:p.keyId,token:p.token,accountToken:p.account.token,requestId:crypto.randomUUID()}),
      encoding:'utf8',timeout:60000,maxBuffer:1024*1024,env:{NODE_ENV:'test'},
    });
    const result=JSON.parse(text) as Row;
    assert.deepEqual(result,{runId:run,kind:'replayed',verified:8,status:'verified',submitState:'verified'});
    assert.equal(num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${run}'`),1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'`),3);
  });
  await test('shooter-internal','lost claim response is an immutable bounded receipt, never a second claim or changing checkpoint',async()=>{
    isolate();const p=await principal(),run=await fixture(),rid=crypto.randomUUID();
    const first=await rpc(p,'claim',{},rid);assert.equal(first.state,'leased',JSON.stringify(first));const claim=first.claim as Row,work=first.work as Row;
    assert.equal(claim.runId,run);assert.equal((work.issuance as Row).runId,run);assert.equal((work.batch as Row).sequence,0);assert.equal((work.accepted as Row).acceptedBeforeTerminal,true);
    const retry=await rpc(p,'claim',{},rid);assert.deepEqual(retry,first);assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt WHERE job_id='${claim.jobId}'`),1);
    assert.equal((await rpc(p,'renew',{jobId:claim.jobId,fence:claim.fence,expectedRevision:claim.expectedRevision},rid)).reason,'request_conflict');
    const released=await rpc(p,'retry',{jobId:claim.jobId,fence:claim.fence,expectedRevision:claim.expectedRevision,reason:'worker_crash'});assert.equal(released.state,'pending_retryable');
    assert.deepEqual(await rpc(p,'claim',{},rid),first,'historical receipt cannot silently become a new attempt');
    assert.equal((await rpc(p,'renew',{jobId:claim.jobId,fence:claim.fence,expectedRevision:claim.expectedRevision})).state,'stale');
    assert.equal(num(`SELECT reserved_receipt_bytes FROM game.shooter_verification_principal WHERE worker_id='${p.workerId}'`),3*20971520);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`),0);
  });
  await test('shooter-internal','lost claim remains the same attempt across key rotation and original-key revocation',async()=>{
    isolate();const p=await principal();await fixture();await fixture();const rid=crypto.randomUUID();
    const first=await rpc(p,'claim',{},rid);assert.equal(first.state,'leased');
    const token2=randomBytes(32).toString('base64url');
    psql(`UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp() WHERE worker_id='${p.workerId}' AND key_id='key1';
      INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
      VALUES('${p.account.userId}','${p.workerId}','key2','${hash('shooter-worker-token-v1\n'+token2)}',ARRAY['claim','renew'],clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 minute')`);
    const replacement={...p,keyId:'key2',token:token2};
    assert.deepEqual(await rpc(replacement,'claim',{},rid),first);
    assert.equal((await rpc(p,'claim',{},rid)).state,'authorization_denied');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE lease_owner='${p.workerId}' AND state='leased'`),1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}' AND request_id='${rid}'`),1);
    assert.equal(psql(`SELECT key_id FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}' AND request_id='${rid}'`),'key1','originalcredentialauditretained');
    assert.equal(num(`SELECT reserved_receipt_bytes FROM game.shooter_verification_principal WHERE worker_id='${p.workerId}' AND key_id='key2'`),0,'recoverydoesnotduplicatereservation');
  });
  await test('shooter-internal','result authentication binds digest/fence/manifest before the PR11 checkpoint hook and never pays',async()=>{
    isolate();const p=await principal(),run=await fixture(),ack=await rpc(p,'claim'),work=ack.work as Row,result=workerResult(work);
    assert.equal((result.publicResult as Row).status,'verified');const body={manifest:work.manifest,result};
    const first=await rpc(p,'result',body);assert.equal(first.state,'verified',JSON.stringify(first));
    assert.equal(num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${run}'`),1);assert.equal(psql(`SELECT checkpoint_json IS NULL FROM game.shooter_verification_run WHERE run_id='${run}'`),'f');
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`),0);
    const bad=structuredClone(body);(bad.result.binding as Row).inputSha256='b'.repeat(64);assert.equal((await rpc(p,'result',bad)).reason,'stale_or_unbound_result');
    const extra={...body,result:{...result,paymentAmount:20}};assert.equal((await rpc(p,'result',extra)).reason,'malformed');
    const claim=ack.claim as Row;await rpc(p,'retry',{jobId:claim.jobId,fence:claim.fence,expectedRevision:claim.expectedRevision,reason:'worker_crash'});
    assert.deepEqual(await rpc(p,'result',body),first,'exact committed result recovers its immutable acknowledgment after lease release');
  });
  await test('shooter-internal','count and conservative byte reservations stop overload atomically and keep receipts immutable',async()=>{
    isolate();const p=await principal();await rpc(p,'claim');psql('UPDATE game.shooter_verification_gateway SET max_principal_requests=1,max_principal_receipt_bytes=20971520');
    assert.equal((await rpc(p,'claim')).reason,'gateway_capacity');assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'`),1);
    assert.equal(num(`SELECT reserved_receipt_bytes FROM game.shooter_verification_principal WHERE worker_id='${p.workerId}'`),20971520);
    psql(`DO $x$ BEGIN BEGIN DELETE FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'; RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'shooter_gateway_receipt_immutable' THEN RAISE; END IF; END; END; $x$`);
  });
  await test('shooter-internal','malformed and wrong-token attempts consume durable global/account budget before large parsing',async()=>{
    isolate();const p=await principal();
    psql(`UPDATE game.shooter_verification_gateway SET global_attempts_per_minute=100000,account_attempts_per_minute=2;
      DELETE FROM game.shooter_verification_gateway_rate WHERE account_id='${p.account.userId}'`);
    assert.equal(((await call('shooter.internal.result',{...env(p),body:{amount:20}},p.account.token)).body as Row).reason,'malformed');
    assert.equal(((await call('shooter.internal.claim',{...env(p),token:'x'.repeat(43)},p.account.token)).body as Row).state,'authorization_denied');
    assert.equal(((await call('shooter.internal.result',{huge:'x'.repeat(21000000)},p.account.token)).body as Row).reason,'rate_limited');
    assert.equal(num(`SELECT attempts FROM game.shooter_verification_gateway_rate WHERE account_id='${p.account.userId}'`),2);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'`),0);
    // Global saturation also stops a different authorized account before parsing.
    const other=await principal();psql('UPDATE game.shooter_verification_gateway SET global_attempts_per_minute=1,rate_window=clock_timestamp(),rate_attempts=1');
    assert.equal((await rpc(other,'claim')).reason,'rate_limited');
    assert.equal(num(`SELECT attempts FROM game.shooter_verification_gateway_rate WHERE account_id='${other.account.userId}'`),0);
  });
  await test('shooter-internal','key expiry during downstream lock wait rolls back claim, attempt and receipt',async()=>{
    isolate();const p=await principal(),run=await fixture();
    psql(`UPDATE game.shooter_verification_principal SET expires_at=clock_timestamp()+interval '2 seconds' WHERE worker_id='${p.workerId}'`);
    const blocker=psqlAsync("BEGIN;SELECT 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;SELECT pg_sleep(3) /* gateway-expiry-lock */;COMMIT;");
    await waitLock('gateway-expiry-lock');const request=rpc(p,'claim');await waitGatewayBlocked();const [reply]=await Promise.all([request,blocker]);
    assert.equal(reply.state,'authorization_denied');assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt a JOIN game.shooter_verification_job j USING(job_id) WHERE j.run_id='${run}'`),0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'`),0);
  });
  await test('shooter-internal','concurrent revocation linearizes before blocked mutation and refuses authority',async()=>{
    isolate();const p=await principal(),run=await fixture();
    const blocker=psqlAsync(`BEGIN;UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp() WHERE worker_id='${p.workerId}';SELECT pg_sleep(2) /* gateway-revoke-lock */;COMMIT;`);
    await waitLock('gateway-revoke-lock');const request=rpc(p,'claim');await waitGatewayBlocked();const [reply]=await Promise.all([request,blocker]);
    assert.equal(reply.state,'authorization_denied');assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${run}' AND state='leased'`),0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${p.workerId}'`),0);
  });
}
