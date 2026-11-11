// Invoked only by the ephemeral Nakama/Postgres Actions fixture. Credentials
// arrive through stdin and never appear in arguments, output or replay env.
import { readFileSync } from 'node:fs';
import { GatewayClient } from '../src/gateway-client.mjs';
import { ReplayPool } from '../src/process-pool.mjs';
const config=JSON.parse(readFileSync(0,'utf8'));
const client=new GatewayClient(config),pool=new ReplayPool();
try {
  const ack=await client.claim(config.requestId);
  const result=await client.replayClaim(ack,pool);
  const submitted=result.kind==='replayed'?await client.result(ack.work.manifest,result):null;
  process.stdout.write(JSON.stringify({...(result.kind!=='replayed'?{claimState:ack.state,claimReason:ack.reason,workState:ack.workState,workReason:ack.workReason,reason:result.reason}:{}),runId:ack.claim?.runId,kind:result.kind,verified:result.publicResult?.verifiedInputTick,
    status:result.publicResult?.status,checkpointBytes:result.privateCheckpoint?Buffer.byteLength(JSON.stringify(result.privateCheckpoint)):0,receivedCheckpointBytes:ack.work?.checkpoint?Buffer.byteLength(JSON.stringify(ack.work.checkpoint)):0,submitState:submitted?.state,submitReason:submitted?.reason}));
} catch {
  process.stdout.write(JSON.stringify({failure:'test_gateway_failure'}));process.exitCode=1;
} finally {pool.close();}
