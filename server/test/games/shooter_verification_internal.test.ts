import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';
const USER='a0530000-0000-4000-8000-000000000001';
const request={workerId:'worker',keyId:'key1',token:'a'.repeat(43),requestId:'request',body:{}};
{
  const m=loadModule();m.nk.sqlCalls.length=0;
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{vars:{scope:'worker'}},request).state,'authorization_denied');
  assert.equal(m.nk.sqlCalls.length,0,'nohttpkey/JWTvarsserviceauthority');
  m.nk.onSql('SELECT jsonb_build_object(\'ready\'',()=>[{result:'{"ready":false,"enabled":true}'}]);
  assert.equal(m.call<Record<string,unknown>>('shooter.internal.claim',{userId:USER,vars:{scope:'worker'}},{huge:'x'.repeat(21000000)}).state,'authorization_denied');
  assert.equal(m.nk.sqlCalls.length,1,'accountallowlistbeforelargeparse/authbody');
}
{
  const m=loadModule();m.nk.onSql('SELECT jsonb_build_object(\'ready\'',()=>[{result:'{"ready":true,"enabled":true}'}]);
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
