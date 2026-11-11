import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { guest, openGame, call, psql, psqlAsync, num, sleep, type GameLogin } from './harness.ts';
import { fixture as paymentFixture, isolate as paymentIsolate, enable as paymentEnable, retry as paymentRetry, payment, receipt } from './shooter_verification_settlement.ts';

type Obj=Record<string,unknown>;
type Test=(category:string,name:string,fn:()=>Promise<void>)=>Promise<void>;
const SHA='797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9';
const SOURCE='05f7a0a245af921fc65a99588564175c19658e38';
const MANIFEST={artifact:'shooter-sim',sourceCommit:SOURCE,sha256:SHA,protocol:1,contentFingerprint:'cea1f88b',uploadProtocol:2,replayApiVersion:2,checkpointSchema:2,economyPolicy:1};
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`,import.meta.url),'utf8'),context);
function object(v:unknown):Obj { return v as Obj; }
function sql(v:string):string { return v.replace(/'/g,"''"); }
function sim(code:string,value:unknown):Obj {
  context.__input=JSON.stringify(value);
  try { return object(JSON.parse(vm.runInContext(`JSON.stringify((function(v){${code}})(JSON.parse(__input)))`,context) as string)); }
  finally { delete context.__input; }
}
const CONFIG=`UPDATE game.shooter_verification_admission SET new_runs_enabled=true,max_global_runs=10000,max_account_runs=100,max_global_bytes=1099511627776,max_account_bytes=1073741824,max_global_batches=10000000,max_account_batches=100000,global_appends_per_minute=100000,account_appends_per_minute=10000;
 UPDATE game.shooter_verification_scheduler SET claims_enabled=true,max_leased=10,max_account_leased=1,max_jobs=100000,max_account_jobs=10000,max_attempts_retained=1000000,max_account_attempts_retained=100000,max_checkpoint_bytes=1099511627776,max_account_checkpoint_bytes=1073741824,lease_seconds=60,attempt_seconds=120,attempt_limit=10,retry_base_seconds=1,retry_max_seconds=4,slice_ticks=4096;
 UPDATE game.shooter_verification_gateway SET enabled=true,global_attempts_per_minute=1000000,account_attempts_per_minute=100000,max_requests=100000,max_principal_requests=10000,max_receipt_bytes=1099511627776,max_principal_receipt_bytes=107374182400;
 UPDATE game.shooter_verification_payment_config SET payments_enabled=true`;
async function isolate():Promise<void> { psql(`UPDATE game.shooter_verification_job SET state='quarantined',lease_owner=NULL,lease_until=NULL,attempt_deadline=NULL WHERE state IN ('ready','leased','retry_wait');
 UPDATE game.shooter_verification_run SET lifecycle='invalid' WHERE lifecycle IN ('open','sealed','terminal','expired','quarantined'); ${CONFIG}`);
 await service(); }
async function login():Promise<GameLogin> { return openGame((await guest()).token,'sproto-shooter'); }
function enroll(s:GameLogin):void { psql(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${s.hub.userId}')`); }
async function issue(s:GameLogin,key=randomUUID()):Promise<Obj> { return object((await call('shooter.run.issue',{key,canonicalBoss:'sahil'},s.gameToken)).body); }
async function finish(s:GameLogin,run:string,sequence=-1,tick=0):Promise<Obj> {
  return object((await call('shooter.run.finish',{protocol:2,runId:run,lastSequence:sequence,lastTick:tick},s.gameToken)).body);
}
async function status(s:GameLogin,run:string):Promise<Obj> { return object((await call('shooter.run.status',{runId:run},s.hub.token)).body); }
async function append(s:GameLogin,run:string):Promise<Obj> { return object((await call('shooter.run.append',{protocol:2,runId:run,sequence:0,tick0:0,n:1,frames:Buffer.alloc(12).toString('base64'),actions:[]},s.gameToken)).body); }
async function fixture():Promise<{s:GameLogin;ack:Obj;run:string}> {
  const s=await login(); enroll(s); const ack=await issue(s); assert.equal(ack.state,'issued',JSON.stringify(ack));
  return {s,ack,run:String(ack.runId)};
}
async function waitLock(name:string):Promise<void> {
  const deadline=Date.now()+5000;
  while (!num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`)) {
    assert.ok(Date.now()<deadline,'lock holder entered sleep'); await sleep(20);
  }
}
async function service():Promise<(op:string,body:unknown)=>Promise<Obj>> {
  const principal=await guest(),worker=`lifecycle-${randomUUID()}`,key='one',token=randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(`shooter-worker-token-v1\n${token}`).digest('hex');
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${worker}','${principal.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${principal.userId}','${worker}','${key}','${hash}',ARRAY['claim','renew','retry','result'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes')`);
  const request=async(op:string,body:unknown):Promise<Obj>=>object((await call(`shooter.internal.${op}`,{workerId:worker,keyId:key,token,requestId:randomUUID(),body},principal.token)).body);
  return request;
}
async function drain(run:string):Promise<void> {
  const request=await service();
  const claimed=await request('claim',{}); assert.equal(claimed.state,'leased',JSON.stringify(claimed));
  const work=object(claimed.work); assert.equal(object(work.claim).runId,run);
  const result=sim(`var m=v.manifest,api=SprotoShooterSim,c={issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},maxWorkFrames:v.maxWorkFrames};
    var cp=v.checkpoint||api.beginIncrementalReplay(c).privateCheckpoint;
    if(!cp.pending)cp=api.acceptReplayBatch(JSON.stringify(v.batch),cp,Object.assign({},c,{accepted:v.accepted})).privateCheckpoint;
    var out=api.stepReplaySlice(cp,c);return {kind:'replayed',binding:v.claim,privateCheckpoint:out.privateCheckpoint,publicResult:JSON.parse(api.publicReplayJSON(out))};`,work);
  const committed=await request('result',{manifest:MANIFEST,result}); assert.equal(committed.state,'verified',JSON.stringify(committed));
}

export async function runShooterVerificationLifecycle(test:Test):Promise<void> {
  await test('shooter-lifecycle','default-empty cohort preserves legacy and sticky enrollment cannot opt out',async()=>{
    await isolate(); const s=await login(),key=randomUUID(),old=await issue(s,key);
    assert.equal(old.ok,true); assert.equal(old.protocol,undefined);
    enroll(s); assert.deepEqual(await issue(s,key),{...old,replay:true},'already-issued legacy key retains original version');
    psql('UPDATE game.shooter_verification_admission SET new_runs_enabled=false');
    const pending=await issue(s); assert.equal(pending.state,'pending_retryable');
    const forged=object((await call('shooter.run.issue',{key:randomUUID(),canonicalBoss:'sahil',protocol:1},s.gameToken)).body);
    assert.notEqual(forged.ok,true); assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id='${s.hub.userId}'`),1);
    assert.throws(()=>psql(`DELETE FROM game.shooter_verification_cohort WHERE user_id='${s.hub.userId}'`),/shooter_cohort_sticky/);
  });
  await test('shooter-lifecycle','canonical issuance starts approved retained worker and key retries do not reserve twice',async()=>{
    await isolate(); const s=await login(); enroll(s); const key=randomUUID();
    const results=await Promise.all([issue(s,key),issue(s,key)]); assert.deepEqual(results[0],results[1]);
    const ack=results[0]!; assert.deepEqual(ack.manifest,MANIFEST); assert.equal(ack.state,'issued');
    const start=sim('var m=v.manifest,out=SprotoShooterSim.beginIncrementalReplay({issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint}});return JSON.parse(SprotoShooterSim.publicReplayJSON(out));',{issuance:ack.issuance,manifest:MANIFEST});
    assert.equal(start.status,'verified'); assert.equal(start.ticketsMinted,0);
    assert.equal(num(`SELECT retained_runs FROM game.shooter_verification_admission_account WHERE user_id='${s.hub.userId}'`),1);
    assert.equal(Date.parse(String(ack.uploadDeadline))-Date.parse(String(ack.issuedAt)),2700000);
    psql('UPDATE game.shooter_verification_admission SET new_runs_enabled=false'); assert.deepEqual(await issue(s,key),ack);
    assert.equal((await finish(s,String(ack.runId))).state,'sealed','stop-new still permits drain/finish');
  });
  await test('shooter-lifecycle','capacity failure rolls back both run rows and reservation',async()=>{
    await isolate(); const s=await login(); enroll(s);
    psql('UPDATE game.shooter_verification_admission SET max_global_runs=retained_runs');
    const before=num('SELECT retained_runs FROM game.shooter_verification_admission');
    assert.equal((await issue(s)).state,'pending_retryable');
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id='${s.hub.userId}'`),0);
    assert.equal(num('SELECT retained_runs FROM game.shooter_verification_admission'),before);
  });
  await test('shooter-lifecycle','finish acknowledgment survives retries and empty closure never simulates or pays',async()=>{
    await isolate(); const {s,run}=await fixture(),ack=await finish(s,run); assert.equal(ack.state,'sealed');
    assert.deepEqual(await finish(s,run),ack); assert.equal((await finish(s,run,0,1)).reason,'seal_conflict');
    const view=await status(s,run); assert.deepEqual(view.sealAck,ack); assert.equal(object(view.terminal).outcome,'incomplete');
    assert.equal(view.revision,0); assert.equal(object(view.payment).state,'ineligible');
    assert.equal(psql(`SELECT checkpoint_json IS NULL FROM game.shooter_verification_run WHERE run_id='${run}'`),'t');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${run}'`),0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`),0);
  });
  await test('shooter-lifecycle','append/finish race seals exactly its accepted highwater and retains all bytes',async()=>{
    await isolate(); const {s,run}=await fixture();
    const [received,sealed]=await Promise.all([append(s,run),finish(s,run)]);
    if (received.state==='received') { assert.equal(sealed.reason,'seal_conflict'); assert.equal((await finish(s,run,0,1)).state,'sealed'); }
    else { assert.equal(received.reason,'run_closed'); assert.equal(sealed.state,'sealed'); }
    assert.equal(num(`SELECT accepted_batches FROM game.shooter_verification_run WHERE run_id='${run}'`),received.state==='received'?1:0);
  });
  await test('shooter-lifecycle','sealed accepted input drains through actual worker then closes incomplete without synthetic CP terminal',async()=>{
    await isolate(); const {s,run}=await fixture(); assert.equal((await append(s,run)).state,'received');
    assert.equal((await finish(s,run,0,1)).state,'sealed'); const revision=num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${run}'`);
    await drain(run); const view=await status(s,run); assert.equal(object(view.terminal).outcome,'incomplete');
    assert.equal(view.revision,revision+1,'only actual worker progress changes revision');
    assert.equal(psql(`SELECT checkpoint_json->'firstTerminal' FROM game.shooter_verification_run WHERE run_id='${run}'`),'null');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${run}'`),1);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${run}'`),0);
  });
  await test('shooter-lifecycle','missing finish expires admission, retains work and cannot revive with renewed session',async()=>{
    await isolate(); const {s,run}=await fixture(); assert.equal((await append(s,run)).state,'received');
    const original=psql(`SELECT lease_until::text FROM game.game_session WHERE session_id='${s.sessionId}'`);
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${s.sessionId}'`);
    const expired=await status(s,run); assert.equal(expired.state,'expired'); assert.equal(expired.authorization,'session_expired');
    const retained=num('SELECT reserved_bytes FROM game.shooter_verification_admission');
    psql(`UPDATE game.game_session SET lease_until='${original}' WHERE session_id='${s.sessionId}'`);
    assert.equal((await finish(s,run,0,1)).state,'authorization_denied'); assert.equal((await append(s,run)).state,'authorization_denied');
    await drain(run); assert.equal(object((await status(s,run)).terminal).outcome,'incomplete');
    assert.equal(num('SELECT reserved_bytes FROM game.shooter_verification_admission'),retained);
  });
  await test('shooter-lifecycle','observed session close keeps its denial reason after a reopened database lease',async()=>{
    await isolate(); const {s,run}=await fixture();
    psql(`UPDATE game.game_session SET state='closed' WHERE session_id='${s.sessionId}'`);
    assert.equal((await status(s,run)).authorization,'session_closed');
    psql(`UPDATE game.game_session SET state='open' WHERE session_id='${s.sessionId}'`);
    assert.equal((await finish(s,run)).reason,'session_closed');
    assert.equal((await append(s,run)).reason,'session_closed');
    assert.equal((await status(s,run)).authorization,'session_closed');
  });
  await test('shooter-lifecycle','session authorization is sampled after blocked finish lock and no replacement session can bind',async()=>{
    await isolate(); const {s,run}=await fixture();
    const name=`lifecycle-${randomUUID()}`;
    const holder=psqlAsync(`SET application_name='${name}'; BEGIN; UPDATE game.game_session SET lease_until=clock_timestamp()+interval '1 second' WHERE session_id='${s.sessionId}'; SELECT pg_sleep(2); COMMIT;`);
    await waitLock(name); assert.equal((await finish(s,run)).state,'authorization_denied'); await holder;
    const another=await openGame(s.hub.token,'sproto-shooter');
    assert.equal((await finish(another,run)).reason,'unknown_run');
    assert.equal(psql(`SELECT seal_ack IS NULL FROM game.shooter_verification_run WHERE run_id='${run}'`),'t');
  });
  await test('shooter-lifecycle','new issuance checks session clock after economy lock wait and leaves no orphan',async()=>{
    await isolate(); const s=await login(); enroll(s); const name=`issue-${randomUUID()}`;
    const holder=psqlAsync(`SET application_name='${name}'; BEGIN;
      SELECT pg_advisory_xact_lock(hashtextextended('economy:' || '${s.hub.userId}',0));
      UPDATE game.game_session SET lease_until=clock_timestamp()+interval '1 second' WHERE session_id='${s.sessionId}';
      SELECT pg_sleep(2); COMMIT;`);
    await waitLock(name); assert.equal((await issue(s)).reason,'session_expired'); await holder;
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id='${s.hub.userId}'`),0);
    assert.equal(num(`SELECT retained_runs FROM game.shooter_verification_admission_account WHERE user_id='${s.hub.userId}'`),0);
  });
  await test('shooter-lifecycle','worker polling closes abandoned empty runs and skips locked maintenance candidates',async()=>{
    await isolate(); const {s,run}=await fixture(),request=await service(),name=`reap-${randomUUID()}`;
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${s.sessionId}'`);
    const holder=psqlAsync(`SET application_name='${name}'; BEGIN; SELECT 1 FROM game.game_session WHERE session_id='${s.sessionId}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;`);
    await waitLock(name); const skipped=await request('claim',{}); assert.equal(skipped.reason,'no_capacity_or_ready_work');
    assert.equal(num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep'`),1,'claim response returned while maintenance candidate remains locked');
    assert.equal(psql(`SELECT lifecycle FROM game.shooter_verification_run WHERE run_id='${run}'`),'open','NOWAIT skips locked candidate');
    await holder; assert.equal((await request('claim',{})).reason,'no_capacity_or_ready_work');
    assert.equal(psql(`SELECT lifecycle||':'||terminal_outcome FROM game.shooter_verification_run WHERE run_id='${run}'`),'terminal:incomplete','no browser finish/status needed');
    assert.equal(num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${run}'`),0);
  });
  await test('shooter-lifecycle','input deadline expiry releases the active slot without deleting accepted evidence',async()=>{
    await isolate(); const {s,run}=await fixture(); assert.equal((await append(s,run)).state,'received');
    // Synthetic clock-age fixture uses one transaction timestamp for the exact
    // historical45min constraint; authorization still uses actual current time.
    psql(`UPDATE game.shooter_verification_run SET issued_at=now()-interval '46 minutes',upload_deadline=now()-interval '1 minute' WHERE run_id='${run}'`);
    const next=await issue(s); assert.equal(next.state,'issued'); assert.notEqual(next.runId,run);
    const old=await status(s,run); assert.equal(old.state,'expired'); assert.equal(old.authorization,'upload_expired');
    assert.equal(psql(`SELECT session_invalidated_reason IS NULL FROM game.shooter_verification_run WHERE run_id='${run}'`),'t','input expiry is not session revocation');
    assert.equal((await append(s,run)).reason,'upload_expired');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${run}'`),1);
    await drain(run); assert.equal(object((await status(s,run)).terminal).outcome,'incomplete');
  });
  await test('shooter-lifecycle','expiry preserves quarantined work and its support reason while releasing admission',async()=>{
    await isolate(); const {s,run}=await fixture(); assert.equal((await append(s,run)).state,'received');
    const job=randomUUID();
    psql(`INSERT INTO game.shooter_verification_job(job_id,run_id,sequence_from,sequence_to,tick0,tick_end,expected_revision,input_sha256,state,max_attempts)
      VALUES('${job}','${run}',0,0,0,1,0,'${'a'.repeat(64)}','quarantined',1);
      UPDATE game.shooter_verification_run SET lifecycle='quarantined',operational_reason='attempts_exhausted' WHERE run_id='${run}';
      UPDATE game.shooter_verification_run SET issued_at=now()-interval '46 minutes',upload_deadline=now()-interval '1 minute' WHERE run_id='${run}'`);
    assert.equal((await issue(s)).state,'issued');
    const old=await status(s,run); assert.equal(old.state,'expired'); assert.equal(object(old.operational).supportRequired,true);
    assert.equal(old.terminal,null); assert.equal(psql(`SELECT state FROM game.shooter_verification_job WHERE job_id='${job}'`),'quarantined');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${run}'`),1);
  });
  await test('shooter-lifecycle','stale canonical UTC day is rejected without orphan issuance',async()=>{
    await isolate(); const s=await login(); enroll(s); const run=randomUUID();
    const stale=sim('return SprotoShooterSim.buildIssuance(v).issuance;',{accountId:s.hub.userId,sessionId:s.sessionId,runId:run,day:'2000-01-01',canonicalBoss:'sahil',seed:7});
    const result=JSON.parse(psql(`SELECT game.issue_shooter_verification_run('${s.hub.userId}','${s.sessionId}','stale','${run}','2000-01-01','sahil',7,'${sql(JSON.stringify(stale))}')::text`)) as Obj;
    assert.equal(result.reason,'issuance_day_changed'); assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE run_id='${run}'`),0);
  });
  await test('shooter-lifecycle','legacy/cohort version race is serialized without mixed rows',async()=>{
    await isolate(); const s=await login(),key=randomUUID();
    const [issued]=await Promise.all([issue(s,key),psqlAsync(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${s.hub.userId}')`)]);
    const retry=await issue(s,key);
    if (issued.ok===true) { assert.equal(retry.ok,true); assert.equal(retry.protocol,undefined); }
    else { assert.equal(retry.protocol,2); }
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id='${s.hub.userId}' AND idem_key='${key}'`),1);
  });
  await test('shooter-lifecycle','known scheduler and receipt saturation refuses new reservations',async()=>{
    await isolate(); const s=await login(); enroll(s);
    psql(`INSERT INTO game.shooter_verification_scheduler_account(user_id) VALUES('${s.hub.userId}')`);
    for (const [table,column,limit,where] of [
      ['shooter_verification_scheduler','retained_jobs','max_jobs','singleton'],
      ['shooter_verification_scheduler','retained_attempts','max_attempts_retained','singleton'],
      ['shooter_verification_scheduler','reserved_checkpoint_bytes','max_checkpoint_bytes','singleton'],
      ['shooter_verification_scheduler_account','retained_jobs','10000',`user_id='${s.hub.userId}'`],
      ['shooter_verification_scheduler_account','retained_attempts','100000',`user_id='${s.hub.userId}'`],
      ['shooter_verification_scheduler_account','reserved_checkpoint_bytes','1073741824',`user_id='${s.hub.userId}'`],
      ['shooter_verification_gateway','retained_requests','max_requests','singleton'],
      ['shooter_verification_gateway','reserved_receipt_bytes','max_receipt_bytes','singleton'],
    ]) {
      const before=psql(`SELECT ${column}::text FROM game.${table} WHERE ${where}`);
      psql(`UPDATE game.${table} SET ${column}=${limit} WHERE ${where}`);
      assert.equal((await issue(s)).reason,'verification_capacity',`${table}.${column}`);
      psql(`UPDATE game.${table} SET ${column}=${before} WHERE ${where}`);
    }
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id='${s.hub.userId}'`),0);
    assert.equal(num(`SELECT retained_runs FROM game.shooter_verification_admission_account WHERE user_id='${s.hub.userId}'`),0);
  });
  await test('shooter-lifecycle','new issuance requires a live registered full-scope worker with response headroom',async()=>{
    await isolate(); const s=await login(); enroll(s);
    psql('UPDATE game.shooter_verification_principal SET revoked_at=clock_timestamp()');
    assert.equal((await issue(s)).reason,'verification_capacity');
    await service(); psql("UPDATE game.shooter_verification_principal SET scopes=ARRAY['claim','result'] WHERE revoked_at IS NULL");
    assert.equal((await issue(s)).reason,'verification_capacity','renew/retry required by coordinator');
    psql("UPDATE game.shooter_verification_principal SET scopes=ARRAY['claim','renew','retry','result'],reserved_receipt_bytes=107374182400 WHERE revoked_at IS NULL");
    assert.equal((await issue(s)).reason,'verification_capacity');
    await service(); assert.equal((await issue(s)).state,'issued');
  });
  await test('shooter-lifecycle','SQL issuance binds canonical header to exact owner/session/day/boss and seed',async()=>{
    await isolate(); const s=await login(); enroll(s); const run=randomUUID();
    const day=psql("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text");
    const canonical=sim('return SprotoShooterSim.buildIssuance(v).issuance;',{accountId:s.hub.userId,sessionId:s.sessionId,runId:run,day,canonicalBoss:'sahil',seed:7});
    for (const change of [{seed:8},{accountId:randomUUID()},{sessionId:randomUUID()},{runId:randomUUID()},{day:'2000-01-01'},{canonicalBoss:'obama'},{loadout:'custom'},{protocol:2},{maxFrames:162001},{extra:true}]) {
      const issuance={...canonical,...change};
      const result=JSON.parse(psql(`SELECT game.issue_shooter_verification_run('${s.hub.userId}','${s.sessionId}','binding','${run}','${day}','sahil',7,'${sql(JSON.stringify(issuance))}')::text`)) as Obj;
      assert.equal(result.reason,'issuance_mismatch',JSON.stringify(change));
    }
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE run_id='${run}'`),0);
  });
  await test('shooter-lifecycle','timely accepted clear can pay after input deadline with original live session',async()=>{
    paymentIsolate(); const f=await paymentFixture(); assert.equal(receipt(f),null);
    psql(`UPDATE game.shooter_verification_run SET issued_at=now()-interval '46 minutes',upload_deadline=now()-interval '1 minute' WHERE run_id='${f.run}';
      SELECT game.shooter_verification_touch('${f.login.hub.userId}','${f.run}')`);
    assert.equal(psql(`SELECT admission_closed_reason FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'upload_deadline');
    assert.equal(psql(`SELECT session_invalidated_reason IS NULL FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'t');
    paymentEnable(); await paymentRetry(f); assert.equal(receipt(f)?.paid,true); assert.equal(receipt(f)?.tickets,20);
  });
  await test('shooter-lifecycle','observed session expiry after input closure durably denies payment despite later renewed lease',async()=>{
    paymentIsolate(); const f=await paymentFixture(); assert.equal(receipt(f),null);
    const lease=psql(`SELECT lease_until::text FROM game.game_session WHERE session_id='${f.login.sessionId}'`);
    psql(`UPDATE game.shooter_verification_run SET issued_at=now()-interval '46 minutes',upload_deadline=now()-interval '1 minute' WHERE run_id='${f.run}';
      SELECT game.shooter_verification_touch('${f.login.hub.userId}','${f.run}');
      UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${f.login.sessionId}';
      SELECT game.shooter_verification_touch('${f.login.hub.userId}','${f.run}');
      UPDATE game.game_session SET lease_until='${lease}' WHERE session_id='${f.login.sessionId}'`);
    assert.equal(psql(`SELECT admission_closed_reason FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'upload_deadline');
    assert.equal(psql(`SELECT session_invalidated_reason FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'session_expired');
    paymentEnable(); await paymentRetry(f); assert.equal(receipt(f),null);
    assert.equal(payment(f).state,'authorization_denied'); assert.equal(payment(f).reason,'session_expired');
  });
}
