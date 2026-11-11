import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';

const user='a0560000-0000-4000-8000-000000000001',sid='a0560000-0000-4000-8000-000000000002',run='a0560000-0000-4000-8000-000000000003';
const ctx={userId:user,vars:{scope:'game',game:'sproto-shooter',sid}};
const body={protocol:2,runId:run,lastSequence:-1,lastTick:0};
{
  const m=loadModule(),captured:unknown[][]=[];
  const ack={...body,state:'sealed',sealedAt:'2026-11-11T00:00:00Z'};
  m.nk.onSql('game.shooter_verification_finish',(args)=>{captured.push(args);return [{result:JSON.stringify(ack)}];});
  assert.deepEqual(m.call('shooter.run.finish',ctx,body),ack);
  assert.deepEqual(captured,[[user,sid,run,-1,0]],'only original auth and accepted highwater reach SQL');
  for (const value of [{...body,checkpoint:{}},{...body,outcome:'clear'},{...body,lastSequence:0},{...body,lastTick:1},{...body,lastTick:0.5},{...body,protocol:1}]) {
    assert.equal(m.call<Record<string,unknown>>('shooter.run.finish',ctx,value).state,'invalid');
  }
  assert.equal(captured.length,1);
  assert.equal(m.call<Record<string,unknown>>('shooter.run.finish',{userId:user},body).state,'authorization_denied');
}
{
  const m=loadModule();
  assert.ok(m.registered.rpcs.has('shooter.run.issue')); assert.ok(m.registered.rpcs.has('shooter.run.finish'));
  m.nk.sqlCalls.length=0;
  const response=m.call<Record<string,unknown>>('shooter.run.finish',ctx,{...body,lastTick:Infinity});
  assert.equal(response.state,'invalid');
  assert.ok(!m.nk.sqlCalls.some(c=>/settle_shooter|shooter_verification_commit|shooter_verification_finish/.test(c.sql)));
}
console.log('v2 finish exact-envelope, original-session binding and no-client-result tests ok');
