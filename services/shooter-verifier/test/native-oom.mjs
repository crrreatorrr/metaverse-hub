// Actions-only fault injection. Synchronize Docker monitoring before allocation.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const name=`shooter-native-oom-${process.pid}`,image=process.argv[2]||'shooter-verifier-pr09:test';
const docker=(args,timeout=10000)=>execFileSync('docker',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
  docker(['run','-d','--name',name,'--network','none','--read-only','--memory','64m','--memory-swap','64m','--pids-limit','16','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0',
    '--tmpfs','/tmp:size=1m,noexec,nosuid,nodev','--health-cmd','test -f /tmp/allocator-ready','--health-interval','100ms','--health-timeout','1s','--health-retries','30','--entrypoint','node',image,'-e',
    "process.on('SIGUSR2',()=>{const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1))});require('node:fs').writeFileSync('/tmp/allocator-ready','ready');setInterval(()=>{},1000)"]);
  const inspect=()=>JSON.parse(docker(['inspect','--format','{{json .State}}',name]));
  const startup=Date.now();let state=inspect();
  while(state.Health?.Status!=='healthy'&&state.Running&&Date.now()-startup<5000){await pause(50);state=inspect();}
  assert.equal(state.Running,true,'idleallocatorrunningbeforefault');assert.equal(state.Health?.Status,'healthy','DockerhealthpreconditionbeforeOOMsignal');
  const started=Date.now();docker(['kill','--signal','USR2',name]);
  const exitCode=Number(docker(['wait',name],20000));state=inspect();
  const observed=Date.now();while(!state.OOMKilled&&Date.now()-observed<1000){await pause(50);state=inspect();}
  process.stdout.write(JSON.stringify({exitCode,oomKilled:state.OOMKilled,healthPrecondition:'healthy',allocationWallMs:Date.now()-started})+'\n');
  assert.equal(exitCode,137);assert.equal(state.OOMKilled,true,'actualcontainerOOMrequired');
}finally{try{docker(['rm','-f',name]);}catch{/* own throwaway container only */}}
