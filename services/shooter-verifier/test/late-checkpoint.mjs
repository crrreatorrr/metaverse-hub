// Test-only canonical late predecessor generated from the entire frozen trace.
// Never called by production RPCs and never accepts a public checkpoint.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { APPROVED } from '../src/approved.mjs';
import { replayText } from '../src/replay.mjs';
const args=JSON.parse(readFileSync(0,'utf8'));
const bytes=readFileSync(new URL('./obama-success-7.json',import.meta.url));
if(createHash('sha256').update(bytes).digest('hex')!=='290305879564ca056728554accb52d3469f1185bd2b3c68574929635767b5e77')throw new Error('frozen_fixture_mismatch');
const fixture=JSON.parse(bytes),a=loadApprovedArtifact();a.context.__args=JSON.stringify({...args,canonicalBoss:'obama',seed:7});
const issuance=JSON.parse(new vm.Script('JSON.stringify(SprotoShooterSim.buildIssuance(JSON.parse(__args)).issuance)').runInContext(a.context));
const batch={protocol:2,runId:issuance.runId,sequence:0,tick0:0,n:fixture.log.segments[0].n,frames:fixture.log.segments[0].frames,actions:fixture.log.segments[0].actions||[]};
if(batch.n!==24000)throw new Error('full_trace_required');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const sha=createHash('sha256').update(JSON.stringify(canonical(batch))).digest('hex');
const claim={jobId:'test-late-job',runId:issuance.runId,accountId:issuance.accountId,sessionId:issuance.sessionId,inputSha256:sha,fence:1,initialRevision:0,expectedRevision:0,tick0:0,tickEnd:24000,continuationTick:0};
const request={operation:'begin',manifest:APPROVED,issuance,claim,checkpoint:null,batch:null,accepted:null,maxWorkFrames:4096};
function call(){const result=replayText(JSON.stringify(request),a);if(!result.privateCheckpoint)throw new Error('late_fixture_generation_failed');request.checkpoint=result.privateCheckpoint;return result;}
call();request.operation='accept';request.batch=JSON.stringify(batch);request.accepted={runId:batch.runId,sequence:0,tick0:0,n:batch.n,sha256:sha,binding:{runId:issuance.runId,accountId:issuance.accountId,sessionId:issuance.sessionId,day:issuance.day},acceptedBeforeTerminal:true};call();
request.operation='step';request.batch=null;request.accepted=null;
while(request.checkpoint.accounting.verifiedFrames<22000){request.claim.continuationTick=request.checkpoint.accounting.verifiedFrames;request.maxWorkFrames=Math.min(4096,22000-request.claim.continuationTick);call();}
const checkpoint=request.checkpoint,text=JSON.stringify(checkpoint),checkpointBytes=Buffer.byteLength(text);
if(checkpointBytes<=262144)throw new Error('late_checkpoint_must_exceed_default_http_limit');
process.stdout.write(JSON.stringify({issuance,batch,checkpoint,checkpointBytes,checkpointSha256:createHash('sha256').update(text).digest('hex')}));
