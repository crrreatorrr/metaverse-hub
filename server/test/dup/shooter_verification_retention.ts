import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { guest, openGame, call, psql, psqlAsync, num, sleep, compose, waitReady, type GameLogin } from './harness.ts';
import { isolate as baseIsolate, fixture as paymentFixture, receipt, retry as paymentRetry, enable as enablePayments } from './shooter_verification_settlement.ts';

type Test=(category:string,name:string,fn:()=>Promise<void>)=>Promise<void>;
type Obj=Record<string,unknown>;
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const SHA='ab175aae2000991fae582e7c2ee0c1fea952488e89a6888b96eda9c7e0ee2e1e';
const SOURCE='7db4fc4f93333f3977da2159771a060f344b6ea0';
const MANIFEST={artifact:'shooter-sim',sourceCommit:SOURCE,sha256:SHA,protocol:1,contentFingerprint:'73c6eb0f',uploadProtocol:2,replayApiVersion:2,checkpointSchema:2,economyPolicy:1};
const context=vm.createContext({});const bytes=readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`,import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),SHA);vm.runInContext(bytes.toString('utf8'),context);
const obj=(v:unknown)=>v as Obj;const q=(v:string)=>"'"+v.replace(/'/g,"''")+"'";
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function stable(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const o=v as Obj;return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',')+'}';}
function sim(value:unknown):Obj {context.input=JSON.stringify(value);try{return obj(JSON.parse(vm.runInContext('JSON.stringify(SprotoShooterSim.buildIssuance(JSON.parse(input)).issuance)',context) as string));}finally{delete context.input;}}
const CONFIG=`UPDATE game.shooter_verification_retention_config SET enabled=true,max_operations=100000,max_operator_operations=10000,max_audit_bytes=107374182400,max_operator_audit_bytes=10737418240,operations_per_minute=100000,operator_operations_per_minute=10000,minimum_retention_seconds=0`;
function isolate():void {baseIsolate();psql(CONFIG);}
function data(sql:string,database='nakama'):string {
  return execFileSync('docker',['compose','-f','server/docker-compose.yml','exec','-T','postgres','psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-q','-t','-A'],{cwd:ROOT,input:sql,encoding:'utf8',timeout:30000,maxBuffer:22*1024*1024}).trim();
}
async function operator(scopes=['inspect','reap','requeue','certify','retire']) {
  const login=await guest(),id='operator-'+randomUUID(),key='one',token=randomBytes(32).toString('base64url');
  const tokenHash=hash('shooter-operator-v1\n'+token);
  psql(`INSERT INTO game.shooter_verification_operator(operator_id,account_id) VALUES('${id}','${login.userId}');
    INSERT INTO game.shooter_verification_operator_key(operator_id,account_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${id}','${login.userId}','${key}','${tokenHash}',ARRAY[${scopes.map(q).join(',')}],now()-interval '1 minute',now()+interval '20 minutes')`);
  return {login,id,key,tokenHash};
}
type Operator=Awaited<ReturnType<typeof operator>>;
function op(p:Operator,operation:string,body:Obj,rid=randomUUID(),database='nakama'):Obj {
  return obj(JSON.parse(data(`SELECT game.shooter_verification_maintain('${p.login.userId}','${p.id}','${p.key}','${p.tokenHash}','${operation}','${rid}','${hash(operation+'\n'+stable(body))}',${q(JSON.stringify(body))}::jsonb)::text`,database)));
}
async function opAsync(p:Operator,operation:string,body:Obj,rid=randomUUID()):Promise<Obj> {
  const text=await psqlAsync(`SELECT game.shooter_verification_maintain('${p.login.userId}','${p.id}','${p.key}','${p.tokenHash}','${operation}','${rid}','${hash(operation+'\n'+stable(body))}',${q(JSON.stringify(body))}::jsonb)::text`);
  return obj(JSON.parse(text));
}
async function worker() {
  const login=await guest(),id='restore-'+randomUUID(),key='one',token=randomBytes(32).toString('base64url'),tokenHash=hash('shooter-worker-token-v1\n'+token);
  psql(`INSERT INTO game.shooter_verification_worker(worker_id,account_id) VALUES('${id}','${login.userId}');
    INSERT INTO game.shooter_verification_principal(account_id,worker_id,key_id,token_sha256,scopes,not_before,expires_at)
    VALUES('${login.userId}','${id}','${key}','${tokenHash}',ARRAY['claim','renew','retry','result'],now()-interval '1 minute',now()+interval '20 minutes')`);
  return {login,id,key,token,tokenHash};
}
type Worker=Awaited<ReturnType<typeof worker>>;
async function rpc(w:Worker,operation:string,body:Obj,rid=randomUUID()):Promise<Obj> {return obj((await call('shooter.internal.'+operation,{workerId:w.id,keyId:w.key,token:w.token,requestId:rid,body},w.login.token)).body);}
function sqlRpc(w:Worker,operation:string,body:Obj,database:string,rid=randomUUID()):Obj {
  return obj(JSON.parse(data(`SELECT game.shooter_verification_internal('${w.login.userId}','${w.id}','${w.key}','${w.tokenHash}','${operation}','${rid}','${hash(operation+'\n'+stable(body))}',${q(JSON.stringify(body))}::jsonb)::text`,database)));
}
async function seed(n=10,login?:GameLogin,frames?:string) {
  const s=login||await openGame((await guest()).token,'sproto-shooter'),run=randomUUID();
  const issuance=sim({accountId:s.hub.userId,sessionId:s.sessionId,runId:run,day:psql('SELECT current_date::text'),canonicalBoss:'sahil',seed:7});
  psql(`INSERT INTO game.shooter_run(run_id,user_id,session_id,idem_key,day,canonical_boss,seed,issuance_json)
    VALUES('${run}','${s.hub.userId}','${s.sessionId}','retain:${run}',${q(String(issuance.day))},'sahil',7,${q(JSON.stringify(issuance))});
    INSERT INTO game.shooter_verification_run(run_id,user_id,session_id,simulator_protocol,checkpoint_schema,economy_policy,artifact_sha256,source_commit,content_fingerprint,issued_at,upload_deadline)
    VALUES('${run}','${s.hub.userId}','${s.sessionId}',1,2,1,'${SHA}','${SOURCE}','73c6eb0f',now()-interval '20 minutes',now()+interval '25 minutes')`);
  const input={protocol:2,runId:run,sequence:0,tick0:0,n,frames:frames||Buffer.alloc(n*12).toString('base64'),actions:[]};
  assert.equal(obj((await call('shooter.run.append',input,s.gameToken)).body).state,'received');
  return {s,run,input,w:await worker(),last:null as {body:Obj;rid:string}|null};
}
type Fixture=Awaited<ReturnType<typeof seed>>;
function externalReplay(work:Obj):Obj {
  return obj(JSON.parse(execFileSync(process.execPath,[join(ROOT,'services/shooter-verifier/test/restore-continuation.mjs')],{cwd:ROOT,input:JSON.stringify(work),encoding:'utf8',timeout:60000,maxBuffer:20*1024*1024,env:{NODE_ENV:'test'}})));
}
async function claimWork(f:Fixture,database='nakama'):Promise<Obj> {
  const rid=randomUUID();let ack:Obj;let work:Obj;
  if(database==='nakama'){ack=await rpc(f.w,'claim',{},rid);assert.equal(ack.state,'leased',JSON.stringify(ack));work=obj(ack.work);}
  else {
    ack=sqlRpc(f.w,'claim',{},database,rid);assert.equal(ack.state,'leased',JSON.stringify(ack));
    const projection=obj(JSON.parse(data(`SELECT game.shooter_verification_private_response('${f.w.login.userId}','${f.w.id}','${f.w.key}','${f.w.tokenHash}','${rid}','${hash('claim\n{}')}')::text`,database)));work=obj(projection.work);
  }
  assert.equal(obj(work.claim).runId,f.run);return work;
}
async function step(f:Fixture,database='nakama'):Promise<Obj> {
  const work=await claimWork(f,database),result=externalReplay(work),body={manifest:MANIFEST,result};
  const rid=randomUUID();
  const out=database==='nakama'?await rpc(f.w,'result',body,rid):sqlRpc(f.w,'result',body,database,rid);
  if(database==='nakama')f.last={body,rid};
  assert.ok(['verified','terminal_verified'].includes(String(out.state)),JSON.stringify(out));return out;
}
function snapshot(run:string,database='nakama'):Obj {
  return obj(JSON.parse(psql(`SELECT jsonb_build_object('revision',revision,'verifiedTick',verified_tick,'simulationTick',simulation_tick,'sequence',verified_sequence,
    'acceptedTick',accepted_tick,'acceptedBytes',accepted_bytes,'verifiedBytes',verified_bytes,'acceptedActions',accepted_actions,'verifiedActions',verified_actions,
    'checkpointSha256',checkpoint_sha256,'terminal',terminal_result,'terminalRevision',terminal_revision,'paymentState',payment_state)::text FROM game.shooter_verification_run WHERE run_id='${run}'`,database)));
}
function finance(database='nakama'):string {return psql(`SELECT md5(COALESCE((SELECT string_agg(to_jsonb(t)::text,'' ORDER BY seq) FROM game.tickets_ledger t),''))||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text,'' ORDER BY run_id) FROM game.shooter_receipt t),''))`,database);}
async function waitLock(marker:string):Promise<void>{const deadline=Date.now()+5000;while(!num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${marker}' AND wait_event='PgSleep'`)){assert.ok(Date.now()<deadline);await sleep(20);}}
function backup(name:string):{path:string;sha:string} {
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.HUB_RECOVERY_FIXTURE,'retention-restore');
  const path=join(tmpdir(),`shooter-retention-${name}-${randomUUID()}.dump`);
  const dump=execFileSync('docker',['compose','-f','server/docker-compose.yml','exec','-T','postgres','pg_dump','-U','postgres','-d','nakama','-Fc','--no-owner'],{cwd:ROOT,timeout:60000,maxBuffer:64*1024*1024});
  writeFileSync(path,dump,{mode:0o600});return {path,sha:hash(dump)};
}
function restore(archive:{path:string},database:string):void {
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.HUB_RECOVERY_FIXTURE,'retention-restore');assert.match(database,/^shooter_restore_[a-z]+$/);
  assert.equal(num(`SELECT count(*) FROM pg_database WHERE datname='${database}'`),0,'never replace an existing database');psql(`CREATE DATABASE ${database}`);
  execFileSync('docker',['compose','-f','server/docker-compose.yml','exec','-T','postgres','pg_restore','-U','postgres','-d',database,'--clean','--if-exists','--no-owner','--exit-on-error'],{cwd:ROOT,input:readFileSync(archive.path),timeout:60000,maxBuffer:1024*1024});
}
export async function runShooterVerificationRetention(test:Test):Promise<void> {
  await test('shooter-retention','operator tools default off, remain unregistered, and reject ordinary credentials and wrong scopes',async()=>{
    assert.equal(psql('SELECT enabled::text FROM game.shooter_verification_retention_config'),'false');
    const p=await operator(['inspect']);assert.equal(op(p,'inspect',{runId:randomUUID()}).reason,'retention_disabled');
    psql(CONFIG);assert.equal(op(p,'reap',{limit:1}).state,'authorization_denied');
    const outsider=await guest();assert.equal(op({...p,login:outsider},'inspect',{runId:randomUUID()}).state,'authorization_denied');
    const wrong={...p,tokenHash:'0'.repeat(64)};assert.equal(op(wrong,'inspect',{runId:randomUUID()}).state,'authorization_denied');
    psql(`UPDATE game.shooter_verification_operator_key SET revoked_at=now() WHERE operator_id='${p.id}'`);assert.equal(op(p,'inspect',{runId:randomUUID()}).state,'authorization_denied');
    assert.ok(!/registerRpc\([^\n]*shooter.*(?:retire|requeue|operator|certify)/i.test(readFileSync(join(ROOT,'server/modules/src/main.ts'),'utf8')));
  });
  await test('shooter-retention','operational requeue grants are audited finite additions and never reset attempts fences or original max',async()=>{
    isolate();psql('UPDATE game.shooter_verification_scheduler SET attempt_limit=1');const f=await seed(1),p=await operator();
    const first=await rpc(f.w,'claim',{});const id=String(obj(first.claim).jobId);await rpc(f.w,'retry',{jobId:id,fence:1,expectedRevision:0,reason:'worker_crash'});
    for(let grant=1;grant<=4;grant++){
      const body={jobId:id,expectedRevision:0,expectedTick:0,extraAttempts:8},rid=randomUUID();const acknowledged=op(p,'requeue',body,rid);
      assert.equal(acknowledged.state,'requeued',JSON.stringify(acknowledged));assert.deepEqual(op(p,'requeue',body,rid),acknowledged);
      assert.equal(op(p,'inspect',{runId:f.run},rid).reason,'request_conflict');
      for(let i=0;i<8;i++){
        const leased=await rpc(f.w,'claim',{});assert.equal(leased.state,'leased',JSON.stringify(leased));const c=obj(leased.claim);
        assert.equal(Number(c.fence),1+(grant-1)*8+i+1);assert.equal(await rpc(f.w,'renew',{jobId:id,fence:1,expectedRevision:0}).then(v=>v.state),'stale');
        const result=await rpc(f.w,'retry',{jobId:id,fence:c.fence,expectedRevision:0,reason:'execution_timeout'});assert.equal(result.state,'pending_retryable');
        // Only the disposable fixture advances backoff eligibility. Real clock
        // expiry/renewal/backoff remain exercised by the unchanged lease matrix.
        psql(`UPDATE game.shooter_verification_job SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE job_id='${id}'`);
      }
    }
    assert.equal(op(p,'requeue',{jobId:id,expectedRevision:0,expectedTick:0,extraAttempts:1}).reason,'recovery_budget_exhausted');
    assert.equal(psql(`SELECT attempts||':'||fencing_token||':'||max_attempts||':'||recovery_budget||':'||recovery_grants FROM game.shooter_verification_job WHERE job_id='${id}'`),'33:33:1:32:4');
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt WHERE job_id='${id}'`),33);assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result WHERE job_id='${id}'`),33);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_recovery_grant WHERE job_id='${id}'`),4);
    assert.equal(psql(`SELECT accepted_tick||':'||verified_tick||':'||payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'1:0:none');
  });
  await test('shooter-retention','expired accepted work and new account slot survive requeue without payment or upload revival',async()=>{
    isolate();psql('UPDATE game.shooter_verification_scheduler SET attempt_limit=1');const old=await seed(1),p=await operator();const first=await rpc(old.w,'claim',{}),c=obj(first.claim);
    await rpc(old.w,'retry',{jobId:c.jobId,fence:c.fence,expectedRevision:0,reason:'worker_crash'});
    psql(`UPDATE game.game_session SET state='expired',lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${old.s.sessionId}'`);
    await call('shooter.run.status',{runId:old.run},old.s.hub.token);const freshLogin=await openGame(old.s.hub.token,'sproto-shooter');const current=await seed(1,freshLogin);
    assert.equal(op(p,'requeue',{jobId:c.jobId,expectedRevision:0,expectedTick:0,extraAttempts:1}).state,'requeued');
    assert.equal(psql(`SELECT lifecycle FROM game.shooter_verification_run WHERE run_id='${old.run}'`),'expired');assert.equal(psql(`SELECT lifecycle FROM game.shooter_verification_run WHERE run_id='${current.run}'`),'open');
    const before=psql(`SELECT frames FROM game.shooter_verification_batch WHERE run_id='${old.run}'`);
    assert.equal(op(p,'retire',{runId:old.run,sequence:0,expectedRevision:0,proofId:randomUUID()}).reason,'retention_proof_required');
    assert.equal(psql(`SELECT frames FROM game.shooter_verification_batch WHERE run_id='${old.run}'`),before);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${old.run}'`),0);
    assert.equal(obj((await call('shooter.run.append',old.input,old.s.gameToken)).body).state,'authorization_denied');
  });
  await test('shooter-retention','expired leases reap finitely while inspection redacts private state and immutable audit survives restart',async()=>{
    isolate();const f=await seed(1),p=await operator();const claimed=await rpc(f.w,'claim',{}),c=obj(claimed.claim);
    psql(`UPDATE game.shooter_verification_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id='${c.jobId}'`);
    const reaped=op(p,'reap',{limit:1});assert.equal(reaped.count,1);assert.equal(op(p,'reap',{limit:1}).count,0);
    const view=op(p,'inspect',{runId:f.run});assert.equal(view.state,'inspected');assert.ok(!JSON.stringify(view).includes('privateCheckpoint'));assert.ok(!JSON.stringify(view).includes('frames'));
    const before=psql(`SELECT md5(string_agg(to_jsonb(a)::text,'' ORDER BY audit_id)) FROM game.shooter_verification_operator_audit a`);
    compose(['restart','nakama']);await waitReady();assert.equal(psql(`SELECT md5(string_agg(to_jsonb(a)::text,'' ORDER BY audit_id)) FROM game.shooter_verification_operator_audit a`),before);
    psql(`DO $t$ BEGIN BEGIN DELETE FROM game.shooter_verification_operator_audit WHERE operator_id='${p.id}'; RAISE EXCEPTION 'missing immutability'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'shooter_retention_evidence_immutable' THEN RAISE; END IF; END; END; $t$`);
  });
  await test('shooter-retention','actual backup restore and approved continuation permit only redundant verified payload retirement',async()=>{
    isolate();const trace=JSON.parse(readFileSync(join(ROOT,'server/test/games/fixtures/sahil-success.json'),'utf8')) as {log:{segments:{n:number;frames:string;actions:number[][]}[]}};
    const wire=trace.log.segments[0]!;assert.equal(wire.n,9634);assert.equal(wire.actions.length,0);
    const f=await seed(4096,undefined,wire.frames.slice(0,4096*16)),p=await operator();
    const second={protocol:2,runId:f.run,sequence:1,tick0:4096,n:wire.n-4096,frames:wire.frames.slice(4096*16),actions:[]};
    assert.equal(obj((await call('shooter.run.append',second,f.s.gameToken)).body).state,'received');
    await step(f);const initial=snapshot(f.run),money=finance();assert.equal(initial.verifiedTick,4096);const received=psql(`SELECT received_ack::text FROM game.shooter_verification_batch WHERE run_id='${f.run}' AND sequence=0`);
    const files:{path:string;sha:string}[]=[];const databases:string[]=[];
    try{
      const a=backup('before');files.push(a);restore(a,'shooter_restore_a');databases.push('shooter_restore_a');
      assert.deepEqual(snapshot(f.run,'shooter_restore_a'),initial);assert.equal(finance('shooter_restore_a'),money);
      while(Number(psql(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`,'shooter_restore_a'))<9634)await step(f,'shooter_restore_a');
      const control=snapshot(f.run,'shooter_restore_a');assert.equal(control.verifiedTick,9634);assert.equal(obj(control.terminal).outcome,'clear');
      const proof=op(p,'certify',{runId:f.run,expectedRevision:initial.revision,checkpointSha256:initial.checkpointSha256,backupId:'ci-before',backupSha256:a.sha,restoreReceiptSha256:hash(stable({initial,control,money}))});
      assert.equal(proof.state,'certified',JSON.stringify(proof));
      let body={runId:f.run,sequence:0,expectedRevision:initial.revision,proofId:proof.proofId};const rid=randomUUID();
      const beforeBytes=num(`SELECT retained_bytes FROM game.shooter_verification_admission_account WHERE user_id='${f.s.hub.userId}'`);
      const work=await claimWork(f),result=externalReplay(work);
      const holding=psqlAsync("SET application_name='retention-commit-race';BEGIN;SELECT 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;SELECT pg_sleep(2);COMMIT;");await waitLock('retention-commit-race');
      const [cleanup,committed]=await Promise.all([opAsync(p,'retire',body,rid),rpc(f.w,'result',{manifest:MANIFEST,result})]);await holding;
      assert.equal(committed.verifiedTick,8192,JSON.stringify(committed));
      let retired=cleanup;
      if(cleanup.state!=='payload_retired'){assert.equal(cleanup.reason,'revision_conflict');body={...body,expectedRevision:2};retired=op(p,'retire',body,rid);}
      assert.equal(retired.state,'payload_retired',JSON.stringify(retired));assert.deepEqual(op(p,'retire',body,rid),retired);const currentBody={...body,expectedRevision:2};assert.deepEqual(op(p,'retire',currentBody),retired);
      assert.equal(num(`SELECT retained_bytes FROM game.shooter_verification_admission_account WHERE user_id='${f.s.hub.userId}'`),beforeBytes-4096*16);
      assert.equal(psql(`SELECT (frames IS NULL AND actions IS NULL)::text FROM game.shooter_verification_batch WHERE run_id='${f.run}' AND sequence=0`),'true');
      assert.equal(psql(`SELECT received_ack::text FROM game.shooter_verification_batch WHERE run_id='${f.run}' AND sequence=0`),received);
      assert.deepEqual(obj((await call('shooter.run.append',f.input,f.s.gameToken)).body),JSON.parse(received));
      assert.equal(obj((await call('shooter.run.append',{...f.input,actions:[[0,1]]},f.s.gameToken)).body).reason,'sequence_conflict');
      assert.equal(op(p,'retire',{...currentBody,sequence:1}).reason,'retention_proof_required');
      const b=backup('retired');files.push(b);restore(b,'shooter_restore_b');databases.push('shooter_restore_b');
      assert.equal(psql(`SELECT frames IS NULL FROM game.shooter_verification_batch WHERE run_id='${f.run}' AND sequence=0`,'shooter_restore_b'),'t');
      while(Number(psql(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`,'shooter_restore_b'))<9634)await step(f,'shooter_restore_b');
      assert.deepEqual(snapshot(f.run,'shooter_restore_b'),control,'restored retired prefix continues solely from complete CP and retained suffix');
      while(num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${f.run}'`)<9634)await step(f);
      assert.deepEqual(snapshot(f.run),control);assert.equal(finance(),money);assert.equal(finance('shooter_restore_b'),money);
      assert.deepEqual(op(p,'retire',body,rid),retired,'historical cleanup ack survives later verification revisions');
      assert.equal(psql(`SELECT frames FROM game.shooter_verification_batch WHERE run_id='${f.run}' AND sequence=1`),second.frames);
      assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${f.run}'`),0);
      enablePayments();assert.ok(f.last);await rpc(f.w,'result',f.last.body,f.last.rid);
      assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${f.run}'`),1,'retired raw prefix does not remove authoritative settlement evidence');
      const paid=finance();assert.deepEqual(op(p,'retire',body,rid),retired);assert.equal(finance(),paid,'cleanup never changes paid receipt/ledger evidence');
      psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=false');
    }finally{for(const database of databases)psql(`DROP DATABASE ${database} WITH(FORCE)`);for(const file of files)rmSync(file.path,{force:true});}
  });
  await test('shooter-retention','operator audit quota and lock-wait expiry never mutate a quarantined job',async()=>{
    isolate();psql('UPDATE game.shooter_verification_scheduler SET attempt_limit=1');const f=await seed(1),p=await operator();const first=await rpc(f.w,'claim',{}),c=obj(first.claim);await rpc(f.w,'retry',{jobId:c.jobId,fence:c.fence,expectedRevision:0,reason:'worker_crash'});
    psql(`UPDATE game.shooter_verification_operator_key SET expires_at=clock_timestamp()+interval '2 seconds' WHERE operator_id='${p.id}'`);
    const blocker=psqlAsync("SET application_name='retention-key-expiry';BEGIN;SELECT 1 FROM game.shooter_verification_scheduler WHERE singleton FOR UPDATE;SELECT pg_sleep(3);COMMIT;");await waitLock('retention-key-expiry');
    const pending=opAsync(p,'requeue',{jobId:c.jobId,expectedRevision:0,expectedTick:0,extraAttempts:1});
    const deadline=Date.now()+5000;while(!num("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%SELECT game.shooter_verification_maintain(%' AND wait_event_type='Lock'")){assert.ok(Date.now()<deadline,'operator reached downstream lock');await sleep(20);}
    const result=await pending;await blocker;assert.equal(result.state,'authorization_denied');
    assert.equal(num(`SELECT recovery_budget FROM game.shooter_verification_job WHERE job_id='${c.jobId}'`),0);assert.equal(num(`SELECT count(*) FROM game.shooter_verification_recovery_grant WHERE job_id='${c.jobId}'`),0);
    const limited=await operator();psql('UPDATE game.shooter_verification_retention_config SET max_operator_operations=1,max_operator_audit_bytes=65536');
    op(limited,'inspect',{runId:f.run});assert.equal(op(limited,'requeue',{jobId:c.jobId,expectedRevision:0,expectedTick:0,extraAttempts:1}).reason,'operator_capacity');
  });
  await test('shooter-retention','pending payment and permanent terminal denial retain every financial receipt and evidence row',async()=>{
    isolate();const f=await paymentFixture('sahil-success-7');const p=await operator();assert.equal(receipt(f),null);
    const before=finance();const cp=psql(`SELECT checkpoint_sha256 FROM game.shooter_verification_run WHERE run_id='${f.run}'`);
    assert.equal(op(p,'retire',{runId:f.run,sequence:0,expectedRevision:3,proofId:randomUUID()}).reason,'retention_proof_required');
    assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'pending');
    psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${f.login.sessionId}'`);await call('shooter.run.status',{runId:f.run},f.login.hub.token);
    enablePayments();await paymentRetry(f);psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=false');
    assert.equal(psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${f.run}'`),'authorization_denied');
    assert.equal(finance(),before);assert.equal(psql(`SELECT checkpoint_sha256 FROM game.shooter_verification_run WHERE run_id='${f.run}'`),cp);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_attempt_result a JOIN game.shooter_verification_job j USING(job_id) WHERE j.run_id='${f.run}'`),f.submissions.length);
    assert.ok(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${f.worker.workerId}'`)>0);
  });
}
