import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCoordinator } from '../ops/coordinator.mjs';
import { Journal } from '../ops/journal.mjs';
import { FrameReader,encodeFrame } from '../ops/framing.mjs';
import { APPROVED } from '../src/approved.mjs';
const credentials={url:'http://127.0.0.1:7350',workerId:'worker-recovery',keyId:'key1',token:'a'.repeat(43),accountToken:'e30.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+120})).toString('base64url')+'.signature'};
const wait=async predicate=>{const end=Date.now()+7000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.equal(!!predicate(),true,'bounded observation');};
async function fixture(t){const dir=mkdtempSync(join(tmpdir(),'shooter-recovery-')),socket=join(dir,'replay.sock');let peer;
  const server=net.createServer(s=>{peer=s;const reader=new FrameReader(v=>s.end(encodeFrame({v:1,id:v.id,result:{kind:'health',ready:true,manifest:APPROVED,asOf:Date.now()},metrics:{}})),()=>s.destroy());s.on('data',c=>reader.push(c));s.on('error',()=>{});});await new Promise(r=>server.listen(socket,r));
  t.after(async()=>{peer?.destroy();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});return{dir,socket};}
function observed(){return{state:'observed',eligible:false,authExpiresAt:new Date(Date.now()+60000).toISOString(),canExecute:true,writerReady:true,queueDepth:0,paymentPending:0};}
test('restart retains exact full result and request ID until matching durable own receipt; no new claim',async t=>{
  const f=await fixture(t),body={manifest:APPROVED,result:{kind:'replayed',privateCheckpoint:{privateState:'x'.repeat(1024*1024)},publicResult:{ticketsMinted:0}}},record={v:1,phase:'submitting',workerId:credentials.workerId,claimRequestId:'claim-persisted',requestId:'result-persisted',body};
  new Journal(f.dir).save(record);const original=globalThis.fetch,posts=[];let durable=false;
  globalThis.fetch=async(url,options)=>{const env=JSON.parse(options.body),op=new URL(url).pathname.split('.').at(-1);let value;if(op==='maintenance')value={state:'maintained',touched:0};else if(op==='ops')value=observed();else if(op==='pending')value={state:'pending_proofs',references:[]};else if(op==='receipt')value=durable?{state:'receipt_found',acknowledgment:{state:'terminal_verified'}}:{state:'receipt_missing'};else if(op==='result'){posts.push(env);value={kind:'pending_retryable',reason:'gateway_unavailable'};}else assert.fail('unexpected mutating operation '+op);return new Response(JSON.stringify(value),{status:200});};t.after(()=>{globalThis.fetch=original;});
  let service=await startCoordinator({credentials,journalDirectory:f.dir,socketPath:f.socket,healthPort:19476,pollMs:1000});await wait(()=>posts.length===1);await service.close();assert.deepEqual(new Journal(f.dir).load(),record);
  durable=false;service=await startCoordinator({credentials,journalDirectory:f.dir,socketPath:f.socket,healthPort:19476,pollMs:1000});await wait(()=>posts.length===2);durable=true;await wait(()=>service.health().journalPhase===null);await service.close();assert.equal(new Journal(f.dir).load(),null);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].requestId,'result-persisted');assert.deepEqual(posts[0].body,body);
});
test('stored terminal financial proof repairs independently with no CP journal or claim',async t=>{const f=await fixture(t),original=globalThis.fetch;let repaired=0;
  globalThis.fetch=async(url,options)=>{const env=JSON.parse(options.body),op=new URL(url).pathname.split('.').at(-1);let value;if(op==='maintenance')value={state:'maintained',touched:0};else if(op==='ops')value=observed();else if(op==='pending')value={state:'pending_proofs',references:repaired?[]:[{resultRequestId:'old-result',requestSha256:'b'.repeat(64)}]};else if(op==='repair'){assert.deepEqual(env.body,{resultRequestId:'old-result',requestSha256:'b'.repeat(64)});repaired++;value={state:'paid',paid:true};}else assert.fail('unexpected operation '+op);return new Response(JSON.stringify(value),{status:200});};t.after(()=>{globalThis.fetch=original;});const service=await startCoordinator({credentials,journalDirectory:f.dir,socketPath:f.socket,healthPort:19476,pollMs:1000});await wait(()=>repaired===1);assert.equal(service.health().ready,true);const actualNow=Date.now;try{const later=actualNow()+16000;Date.now=()=>later;assert.equal(service.health().ready,false,'stale queue/auth observation fails readiness while liveness stays available');assert.ok(service.metrics.snapshot().gatewaySampleAgeMs>=16000);}finally{Date.now=actualNow;}await service.close();assert.equal(new Journal(f.dir).load(),null);assert.equal(service.metrics.counters.paidObservations,1);});
