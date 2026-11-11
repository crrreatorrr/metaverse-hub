import assert from 'node:assert/strict';
import { UnixReplayClient } from '../ops/unix-client.mjs';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { APPROVED } from '../src/approved.mjs';
import vm from 'node:vm';
const client=new UnixReplayClient();
let health;for(let n=0;n<50;n++){health=await client.health();if(health.ready)break;await new Promise(r=>setTimeout(r,100));}
assert.equal(health.ready,true);assert.deepEqual(health.manifest,APPROVED);
if(process.argv[2]==='health'){process.stdout.write(JSON.stringify({ready:true,instanceId:health.instanceId})+'\n');process.exit(0);}
const a=loadApprovedArtifact(),issuance=JSON.parse(new vm.Script("JSON.stringify(SprotoShooterSim.buildIssuance({accountId:'account',sessionId:'session',day:'2026-11-07',runId:'run-test',canonicalBoss:'sahil',seed:7}).issuance)").runInContext(a.context));
const request={operation:'begin',manifest:APPROVED,issuance,checkpoint:null,batch:null,accepted:null,maxWorkFrames:4096,claim:{jobId:'job-test',runId:issuance.runId,accountId:issuance.accountId,sessionId:issuance.sessionId,inputSha256:'a'.repeat(64),fence:1,initialRevision:0,expectedRevision:0,tick0:0,tickEnd:1,continuationTick:0}};
const result=await client.execute(JSON.stringify(request));assert.equal(result.kind,'replayed');assert.equal(result.privateCheckpoint.v,2);assert.equal(result.publicResult.ticketsMinted,0);
assert.equal((await client.execute(JSON.stringify({...request,manifest:{...APPROVED,sha256:'0'.repeat(64)}}))).reason,'artifact_unavailable');
process.stdout.write(JSON.stringify({ready:true,kind:result.kind,checkpointBytes:Buffer.byteLength(JSON.stringify(result.privateCheckpoint)),manifest:APPROVED.sha256})+'\n');
