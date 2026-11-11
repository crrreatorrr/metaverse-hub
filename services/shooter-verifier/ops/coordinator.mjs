import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { GatewayClient,requestDigest } from '../src/gateway-client.mjs';
import { APPROVED } from '../src/approved.mjs';
import { Journal } from './journal.mjs';
import { UnixReplayClient } from './unix-client.mjs';
import { Metrics,safeEvent } from './safe-metrics.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sameManifest=value=>value&&Object.keys(APPROVED).length===Object.keys(value).length&&Object.entries(APPROVED).every(([k,v])=>value[k]===v);
// One durable operation and one replay at a time. Network renewals remain on the
// coordinator event loop while CPU work runs in the separate offline container.
export async function startCoordinator({credentials,journalDirectory='/var/lib/shooter-journal',socketPath='/run/shooter/replay.sock',healthPort=9476,pollMs=5000}={}){
  if(!credentials||!Number.isSafeInteger(pollMs)||pollMs<1000||pollMs>60000||!Number.isInteger(healthPort)||healthPort<1024||healthPort>65535)throw new Error('coordinator_configuration');
  let accountExpiresAt=0;try{const parts=credentials.accountToken.split('.');const claims=JSON.parse(Buffer.from(parts[1]||'','base64url').toString('utf8'));if(Number.isSafeInteger(claims.exp)&&claims.exp>0)accountExpiresAt=claims.exp*1000;}catch{/* Unobserved credential expiry fails readiness closed. */}
  const gateway=new GatewayClient(credentials),journal=new Journal(journalDirectory),metrics=new Metrics();
  const replay=new UnixReplayClient({socketPath,onMetrics:value=>metrics.execution(value)});
  let record=journal.load(),stopping=false,blocked=false,offline=null,lastOps=0,lastRepair=0,lastMaintenance=0,inFlight=false,paymentCursor=null;
  if(record&&record.workerId!==credentials.workerId)throw new Error('journal_identity');
  if(record)metrics.add('journalRecoveries');
  const save=value=>{journal.save(value);record=value;};
  const clear=()=>{journal.clear();record=null;};
  function health(){const now=Date.now(),g=metrics.gateway;return{ready:!stopping&&!blocked&&offline?.ready===true&&sameManifest(offline.manifest)&&typeof offline.asOf==='number'&&Number.isFinite(offline.asOf)&&now-offline.asOf>=-1000&&now-offline.asOf<15000&&!!g&&now-g.observedAt<15000&&g.canExecute&&g.writerReady&&g.authExpiresAt>now+1000&&accountExpiresAt>now+1000,draining:stopping,blocked,busy:inFlight,journalPhase:record?.phase||null,asOf:now};}
  const server=createServer((req,res)=>{if(req.method!=='GET'||!['/health','/ready','/metrics'].includes(req.url)){res.writeHead(404);res.end();return;}const state=health();res.writeHead(req.url==='/ready'&&!state.ready?503:200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(req.url==='/metrics'?metrics.snapshot():state));});
  server.maxConnections=8;server.maxRequestsPerSocket=1;server.requestTimeout=2000;server.headersTimeout=2000;
  await new Promise((resolve,reject)=>{server.once('error',()=>reject(new Error('health_socket')));server.listen(healthPort,'127.0.0.1',resolve);});
  async function proof(operation,id,body){const response=await gateway.receipt(operation,id,requestDigest(operation,body));if(response.state==='receipt_conflict'){blocked=true;return null;}return response.state==='receipt_found'?response.acknowledgment:null;}
  async function submit(){
    const operation=record.phase==='submitting'?'result':'retry',id=record.requestId,body=record.body;
    let durable=await proof(operation,id,body);
    if(!durable){if(blocked)return;await gateway.request(operation,body,id);durable=await proof(operation,id,body);}
    if(durable){if(durable.state==='verified')metrics.add('verified');if(durable.state==='terminal_verified')metrics.add('terminal');if(durable.state==='invalid_gameplay')metrics.add('invalid');clear();}
    else metrics.add('rpcFailures');
  }
  async function work(){
    if(record?.phase==='submitting'||record?.phase==='retrying'){await submit();return;}
    if(!record){if(!health().ready||!metrics.gateway?.eligible)return;save({v:1,phase:'claiming',workerId:credentials.workerId,claimRequestId:randomUUID()});}
    const ack=await gateway.claim(record.claimRequestId);
    if(ack.state!=='leased'){
      const durable=await proof('claim',record.claimRequestId,{});if(durable)clear();else metrics.add('rpcFailures');return;
    }
    if(ack.workState!=='ready'||!ack.work||typeof ack.work!=='object'||!ack.claim||typeof ack.claim!=='object'){
      if(ack.workState==='stale')clear();else metrics.add('rpcFailures');return;
    }
    if(!sameManifest(ack.work.manifest)){metrics.add('artifactMismatches');blocked=true;return;}
    save({v:1,phase:'replaying',workerId:credentials.workerId,claimRequestId:record.claimRequestId});metrics.add('claims');
    // At most one renewal in flight. Its outcome is checked before publishing;
    // a lost renewal never grants authority to commit a different fence.
    let renewing=null,lost=false,timer=null,finished=false,renewals=0;
    const schedule=live=>{if(finished)return;if(typeof live.leaseUntil!=='string'){lost=true;return;}const remaining=Date.parse(live.leaseUntil)-Date.now();if(!Number.isFinite(remaining)||remaining<=0){lost=true;return;}timer=setTimeout(renew,Math.max(250,Math.min(5000,Math.floor(remaining/3))));};
    const renew=()=>{if(finished||renewing)return;if(++renewals>32){lost=true;return;}renewing=gateway.renew(ack.claim).then(value=>{if(value.state!=='leased')lost=true;else schedule(value);}).finally(()=>{renewing=null;});};
    let result;try{result=await gateway.replayClaim(ack,replay,{onLease:schedule});}finally{finished=true;clearTimeout(timer);if(renewing)await renewing;}
    if(lost){metrics.add('rpcFailures');return;}
    if(result?.kind==='replayed'){
      save({v:1,phase:'submitting',workerId:credentials.workerId,claimRequestId:record.claimRequestId,requestId:randomUUID(),body:{manifest:ack.work.manifest,result}});
    }else{
      const reason=result?.reason==='execution_timeout'?'execution_timeout':result?.reason==='artifact_unavailable'?'artifact_unavailable':'worker_crash';
      if(reason==='execution_timeout')metrics.add('timeouts');metrics.add('retries');
      save({v:1,phase:'retrying',workerId:credentials.workerId,claimRequestId:record.claimRequestId,requestId:randomUUID(),body:{jobId:ack.claim.jobId,fence:ack.claim.fence,expectedRevision:ack.claim.expectedRevision,reason}});
    }
    await submit();
  }
  async function observe(){
    const now=Date.now();if(now-lastMaintenance>=60000){lastMaintenance=now;await gateway.maintenance();}
    if(now-lastOps>=pollMs){lastOps=now;offline=await replay.health();metrics.observeGateway(await gateway.ops());}
    if(now-lastRepair>=pollMs){lastRepair=now;const pending=await gateway.pending(paymentCursor);if(pending.state==='pending_proofs'&&Array.isArray(pending.references)){let attempted=0;for(const reference of pending.references.slice(0,4)){if(stopping)break;if(!reference||typeof reference.resultRequestId!=='string'||!/^[A-Za-z0-9_.:@|-]{1,80}$/.test(reference.resultRequestId)||typeof reference.requestSha256!=='string'||!/^[0-9a-f]{64}$/.test(reference.requestSha256)){metrics.add('rpcFailures');continue;}const value=await gateway.repair(reference.resultRequestId,reference.requestSha256);attempted++;metrics.add('paymentRepairs');if(value.paid===true)metrics.add('paidObservations');if(['authorization_denied','ineligible'].includes(value.state))metrics.add('paymentDenials');if(typeof reference.createdAt==='string')paymentCursor={afterCreatedAt:reference.createdAt,afterRequestId:reference.resultRequestId};}if(attempted===pending.references.length&&!pending.truncated)paymentCursor=null;}}
  }
  const loop=(async()=>{process.stdout.write(safeEvent('coordinator_started'));while(!stopping){try{await observe();if(!blocked){inFlight=true;try{await work();}finally{inFlight=false;}}}catch{blocked=true;process.stdout.write(safeEvent('coordinator_quarantined',{reason:'journal'}));}if(!stopping)await delay(pollMs);}process.stdout.write(safeEvent('coordinator_stopped'));})();
  async function close(){stopping=true;await loop;await new Promise(resolve=>server.close(resolve));}
  return{close,health,metrics,loop};
}
