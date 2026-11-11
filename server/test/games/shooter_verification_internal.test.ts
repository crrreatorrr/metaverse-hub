import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';
const USER='a0530000-0000-4000-8000-000000000001';
const request={workerId:'worker',keyId:'key1',token:'a'.repeat(43),requestId:'request',body:{}};
{
  const m=loadModule();m.nk.sqlCalls.length=0;
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{vars:{scope:'worker'}},request).state,'authorization_denied');
  assert.equal(m.nk.sqlCalls.length,0,'nohttpkey/JWTvarsserviceauthority');
  m.nk.onSql('game.shooter_verification_gateway_preflight',()=>[{result:'{"state":"authorization_denied","reason":"unauthorized"}'}]);
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER,vars:{scope:'worker'}},{huge:'x'.repeat(21000000)}).state,'authorization_denied');
  assert.equal(m.nk.sqlCalls.length,1,'accountallowlistbeforelargeparse/authbody');
}
{
  const m=loadModule();m.nk.onSql('game.shooter_verification_gateway_preflight',()=>[{result:'{"state":"ready"}'}]);
  m.nk.onSql('SELECT jsonb_build_object(\'authorized\'',()=>[{result:'{"authorized":true}'}]);
  const calls:unknown[][]=[];m.nk.onSql('SELECT game.shooter_verification_internal',(args)=>{calls.push(args);return[{result:'{"state":"pending_retryable"}'}];});
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER},request).state,'pending_retryable');
  assert.equal(calls.length,1);assert.equal(calls[0]![0],USER);assert.ok(!JSON.stringify(calls).includes(request.token),'rawtokenneverpassedSQL');
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER},{...request,body:{amount:20}}).reason,'malformed');
  assert.equal(calls.length,1);
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.result',{userId:USER},{...request,body:{manifest:{},result:{paymentAmount:20}}}).reason,'malformed');
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER},{...request,huge:'x'.repeat(5000)}).reason,'oversized');
}
console.log('scopedworkerRPCcheapauth/bounds/redactiontestsok');

{
  const m=loadModule();m.nk.onSql('game.shooter_verification_gateway_preflight',()=>[{result:'{"state":"pending_retryable","reason":"rate_limited"}'}]);
  m.nk.sqlCalls.length=0;
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.result',{userId:USER},{huge:'x'.repeat(21000000)}).reason,'rate_limited');
  assert.equal(m.nk.sqlCalls.length,1,'durableaccount/globalattemptgatebeforelargeJSONparse');
}
{
  const m=loadModule();m.nk.onSql('game.shooter_verification_gateway_preflight',()=>[{result:'{"state":"ready"}'}]);
  m.nk.onSql('SELECT jsonb_build_object(\'authorized\'',()=>[{result:'{"authorized":true}'}]);
  const ack={state:'leased',claim:{jobId:'job-reference'},leaseUntil:'historical',attemptDeadline:'historical'};
  m.nk.onSql('SELECT game.shooter_verification_internal',()=>[{result:JSON.stringify(ack)}]);
  const reads:unknown[][]=[];
  m.nk.onSql('SELECT game.shooter_verification_private_response',(args)=>{reads.push(args);return[{result:'{"work":null,"workState":"authorization_denied","workReason":"unauthorized"}'}];});
  const reply=m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER},request);
  assert.equal(reply.work,null);assert.equal(reply.workState,'authorization_denied');assert.equal(reply.state,'leased','originalacksubsetremainshistorical');
  assert.equal(reads.length,1);assert.equal(reads[0]!.length,6);assert.equal(reads[0]![4],request.requestId);
  assert.ok(!JSON.stringify(reads).includes(request.token),'readqueryhasfingerprintnotrawcredential');
  assert.ok(!JSON.stringify(reads).includes('privateCheckpoint'),'readquerytakesonlyidentityandimmutablereference');
}
