// GitHub-only, disposable test image. Never prints the private payload or logs.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync,spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { replayText } from '../src/replay.mjs';
import { APPROVED } from '../src/approved.mjs';
import { safeEvent } from '../ops/safe-metrics.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true','driver fault is CI-only');
assert.equal(process.env.NAKAMA_FILTER_TARGET,'nakama-filter-fixture','requires test-only image target');
const vars=Object.fromEntries(readFileSync('server/.env','utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
const compose=['compose','--env-file','server/.env','-f','services/shooter-verifier/ops/nakama-filter.compose.yml'];
const docker=args=>execFileSync('docker',[...compose,...args],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}).trim();
if(process.argv[2]==='diagnose'){
  // Independently revalidate diagnostic output even if the wrapper itself
  // failed before it could filter. Never print arbitrary captured log bytes.
  const id=docker(['ps','-aq','nakama']);
  if(id){const logs=spawnSync('docker',['logs',id],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
    for(const line of (String(logs.stdout||'')+String(logs.stderr||'')).split('\n').slice(0,1000)){
      let event;try{event=JSON.parse(line);}catch{event={event:'runtime_log_dropped',reason:'unstructured_line'};}
      process.stdout.write(safeEvent(event?.event,{reason:event?.reason,count:event?.count}));
    }
  }else process.stdout.write(safeEvent('runtime_failed',{reason:'startup'}));
}else if(process.argv[2]==='config'){
  assert.equal(process.argv.length,3);
  const serverArgs=['--name','filtered-ci','--database.address',`postgres:${vars.POSTGRES_PASSWORD}@postgres:5432/nakama`,
    '--logger.level','INFO','--socket.server_key',vars.NAKAMA_SERVER_KEY,'--runtime.http_key',vars.NAKAMA_HTTP_KEY,
    '--session.encryption_key',vars.NAKAMA_SESSION_ENCRYPTION_KEY,'--session.refresh_encryption_key',vars.NAKAMA_REFRESH_ENCRYPTION_KEY,
    '--console.username',vars.NAKAMA_CONSOLE_USERNAME,'--console.password',vars.NAKAMA_CONSOLE_PASSWORD,'--console.signing_key',vars.NAKAMA_CONSOLE_SIGNING_KEY,
    '--socket.max_request_size_bytes','23068672'];
  for(const key of ['TICKET_HMAC_KEY','RECOVERY_PEPPER','AUDIT_KEY'])serverArgs.push('--runtime.env',`${key}=${vars[key]}`);
  writeFileSync(process.env.NAKAMA_LAUNCH_FILE,JSON.stringify({serverArgs}),{mode:0o600});
}else{
  assert.equal(process.argv.length,2);
  const sql=text=>docker(['exec','-T','postgres','psql','-U','postgres','-d','nakama','-v','ON_ERROR_STOP=1','-q','-t','-A','-c',text]);
  const id=docker(['ps','-q','nakama']);
  const readLogs=()=>{const logs=spawnSync('docker',['logs',id],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});assert.equal(logs.status,0);return logs.stdout+logs.stderr;};
  const artifact=loadApprovedArtifact();
  artifact.context.issueInput=JSON.stringify({accountId:randomUUID(),sessionId:randomUUID(),runId:randomUUID(),day:'2026-11-11',canonicalBoss:'sahil',seed:7});
  const issuance=JSON.parse(new vm.Script('JSON.stringify(SprotoShooterSim.buildIssuance(JSON.parse(issueInput)).issuance)').runInContext(artifact.context));
  const result=replayText(JSON.stringify({operation:'begin',manifest:APPROVED,issuance,claim:{jobId:randomUUID(),runId:issuance.runId,accountId:issuance.accountId,sessionId:issuance.sessionId,inputSha256:'a'.repeat(64),fence:1,initialRevision:0,expectedRevision:0,tick0:0,tickEnd:1,continuationTick:0},checkpoint:null,batch:null,accepted:null,maxWorkFrames:1}),artifact);
  assert.ok(result.privateCheckpoint,'must pass an actual approved-artifact private checkpoint');
  const markers=[];
  async function driverFault(body,caseName){
    const marker=body.probeMarker;markers.push(marker);
    const wire=JSON.stringify(body),bindBytes=Buffer.byteLength(wire),encodedArgsBytes=Buffer.byteLength(JSON.stringify([wire]));
    const matches=caseName==='small_marker'
      ? line=>line.event==='db_error_redacted'
      : line=>line.event==='runtime_log_dropped'&&line.reason==='oversized_line';
    if(caseName==='approved_checkpoint')assert.ok(encodedArgsBytes>16384,'genuine approved checkpoint arguments must exceed the whole-line limit');
    else assert.ok(encodedArgsBytes<1024,'small bind must exercise the parsed known-message path');
    const baseline=readLogs().trim().split('\n').map(line=>JSON.parse(line)).filter(matches).length;
    const pending=fetch('http://127.0.0.1:7350/v2/rpc/test.filter.driver?unwrap=true&http_key='+encodeURIComponent(vars.NAKAMA_HTTP_KEY),{
      method:'POST',headers:{'content-type':'application/json'},body:wire,signal:AbortSignal.timeout(45000),
    }).then(async r=>{await r.arrayBuffer();return r.status;});
    const end=Date.now()+10000;let pid='';
    while(Date.now()<end){pid=sql("SELECT pid FROM pg_stat_activity WHERE application_name='filter-driver-fixture' AND wait_event='PgSleep' LIMIT 1");if(pid)break;await new Promise(r=>setTimeout(r,100));}
    assert.match(pid,/^[0-9]+$/,'real private-argument query must reach backend sleep');
    assert.equal(sql('SELECT pg_terminate_backend('+pid+')'),'t','terminate the actual active backend');
    assert.ok((await pending)>=400,'the uncaught driver failure must reach Nakama');
    // Allow bounded stdout pipe drain before checking the actual Docker sink.
    await new Promise(r=>setTimeout(r,300));const text=readLogs();
    for(const value of markers)assert.ok(!text.includes(value),'Docker logs must omit sensitivity markers');
    for(const secret of [vars.POSTGRES_PASSWORD,vars.NAKAMA_HTTP_KEY,vars.NAKAMA_SESSION_ENCRYPTION_KEY])assert.ok(!text.includes(secret),'Docker logs must omit launch credentials');
    const lines=text.trim().split('\n').map(line=>JSON.parse(line)),events=lines.filter(matches);
    assert.ok(events.length>baseline,'actual driver fault must add its specific redaction event');
    assert.ok(events.slice(baseline).every(line=>Number.isSafeInteger(line.count)&&line.count>0),'new fault events must record positive redaction counts');
    for(const line of lines)assert.ok(Object.keys(line).every(key=>['at','event','reason','count'].includes(key)),'no raw query/args/error fields may reach Docker logs');
    assert.ok(!text.includes('privateCheckpoint')&&!text.includes('private_checkpoint')&&!text.includes('pg_sleep'),'no query or checkpoint shape reaches sink');
    console.log(JSON.stringify({case:caseName,bindBytes,encodedArgsBytes,newSpecificRedactions:events.length-baseline,passed:true}));
  }
  await driverFault({probeMarker:'PRIVATE_SMALL_PROBE_'+randomUUID()},'small_marker');
  // The synthetic marker accompanies the genuine unchanged checkpoint. No
  // verifier result or public payment assertion is fabricated by this test.
  await driverFault({privateCheckpoint:result.privateCheckpoint,probeMarker:'PRIVATE_CP_PROBE_'+randomUUID()},'approved_checkpoint');
  console.log('PASS two actual Nakama backend terminations: parsed small bind and oversized approved checkpoint remain marker-free');
}
