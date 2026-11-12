// Actions-only full frozen input. A private checkpoint never reaches stdout.
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { UnixReplayClient } from '../ops/unix-client.mjs';
import { APPROVED } from '../src/approved.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),client=new UnixReplayClient();
const f=JSON.parse(readFileSync(new URL('./obama-success-7.json',import.meta.url),'utf8')),segment=f.log.segments[0];assert.equal(segment.n,24000);
const batch={protocol:2,runId:f.issuance.runId,sequence:0,tick0:0,n:segment.n,frames:segment.frames,actions:segment.actions||[]};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const sha=createHash('sha256').update(JSON.stringify(stable(batch))).digest('hex');
const request={operation:'begin',manifest:APPROVED,issuance:f.issuance,checkpoint:null,batch:null,accepted:null,maxWorkFrames:4096,claim:{jobId:'active-drain-job',runId:f.issuance.runId,accountId:f.issuance.accountId,sessionId:f.issuance.sessionId,inputSha256:sha,fence:1,initialRevision:0,expectedRevision:0,tick0:0,tickEnd:segment.n,continuationTick:0}};
async function run(){const result=await client.execute(JSON.stringify(request));assert.equal(result.kind,'replayed');assert.notEqual(result.publicResult.status,'invalid');request.checkpoint=result.privateCheckpoint;request.claim={...request.claim,continuationTick:result.publicResult.verifiedInputTick,expectedRevision:request.claim.expectedRevision+1};return result;}
await run();request.operation='accept';request.batch=JSON.stringify(batch);request.accepted={runId:batch.runId,sequence:0,tick0:0,n:batch.n,sha256:sha,binding:f.log.binding,acceptedBeforeTerminal:true};await run();request.operation='step';request.batch=null;request.accepted=null;
process.stdout.write(JSON.stringify({state:'prepared',frames:24000})+'\n');
const start=Date.now();while(!existsSync('/run/shooter/drain-start')){assert.ok(Date.now()-start<10000,'bounded fault handshake');await pause(25);}
let result=await run();assert.ok(result.publicResult.verifiedInputTick>0);process.stdout.write(JSON.stringify({state:'drained_slice',verified:result.publicResult.verifiedInputTick})+'\n');
// Wait for the new daemon instance before resuming the exact pending full batch.
const deadline=Date.now()+15000;let ready=false;while(Date.now()<deadline){const health=await client.health();if(health.ready){ready=true;break;}await pause(50);}assert.equal(ready,true);
while(result.privateCheckpoint.pending)result=await run();assert.equal(result.publicResult.verifiedInputTick,24000);assert.equal(result.publicResult.ticketsMinted,0);
process.stdout.write(JSON.stringify({state:'complete',verified:24000,ticketsMinted:0})+'\n');
