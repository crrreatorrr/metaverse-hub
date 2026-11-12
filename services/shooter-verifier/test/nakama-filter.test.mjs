import test from 'node:test';
import assert from 'node:assert/strict';
import { LogFilter,checkedNakamaArguments } from '../ops/redact-log.mjs';
import { readinessStatus } from '../ops/nakama-filter.mjs';
const required=['--database.address','postgres:secret@postgres:5432/nakama','--socket.server_key','secret','--runtime.http_key','secret','--session.encryption_key','secret','--session.refresh_encryption_key','secret','--console.username','admin','--console.password','secret','--console.signing_key','secret'];
test('whole-line JSON whitelist never forwards fields, malformed chunks or oversized tails',()=>{
  const output=[],f=new LogFilter(v=>output.push(v)),marker='PRIVATE_CHECKPOINT_MARKER';
  const input=Buffer.from(JSON.stringify({msg:'Node',query:marker,args:[marker],caller:marker})+'\n'+JSON.stringify({msg:'Failed to exec db query.',error:marker})+'\n'+marker+'\n'+JSON.stringify({msg:marker})+'\n');
  for(let i=0;i<input.length;i+=7)f.push(input.subarray(i,i+7));
  f.push(Buffer.alloc(100000,65));f.push(Buffer.from('\n'));f.push(Buffer.from('{"msg":"Node","args":"'+marker+'"}'));f.end();
  assert.equal(output.length,6);assert.ok(!output.join('').includes(marker));
  for(const line of output){const o=JSON.parse(line);assert.ok(Object.keys(o).every(k=>['at','event','reason','count'].includes(k)));}
  assert.equal(f.counters.oversized,1);assert.ok(output.some(v=>v.includes('db_error_redacted')));
  assert.equal(f.buffer.length,16384);assert.equal(f.at,0);
});
test('configuration forbids logger/config/command bypass and duplicate scalar flags',()=>{
  const good=checkedNakamaArguments(required);
  assert.equal(good.migrate[0],'migrate');assert.ok(good.server.includes('--logger.file='));
  for(const pair of [['--config','/secret'],['--logger.stdout','false'],['--logger.file','/tmp/raw'],['--logger.format','text'],['--runtime.path','/tmp/code'],['--socket.port','1234'],['--socket.ssl_certificate','/tmp/cert'],['--name','x\nsecret']])assert.throws(()=>checkedNakamaArguments([...required,...pair]));
  assert.throws(()=>checkedNakamaArguments([...required,'--console.username','other']));
  assert.throws(()=>checkedNakamaArguments(['migrate','up']));
});
test('readiness needs fresh actual health, live child, no drain and no future timestamp',()=>{
  const s={alive:true,stopping:false,lastHealthyAt:10000};
  assert.equal(readinessStatus({...s,lastHealthyAt:0},10000),false);
  assert.equal(readinessStatus(s,10001),true);assert.equal(readinessStatus(s,13000),false);
  assert.equal(readinessStatus({...s,alive:false},10001),false);
  assert.equal(readinessStatus({...s,stopping:true},10001),false);
  assert.equal(readinessStatus(s,9999),false);
});
