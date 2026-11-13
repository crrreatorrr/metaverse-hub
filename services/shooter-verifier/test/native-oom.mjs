// Actions-only fault injection. The allocator is a child, not PID 1.
// With Docker's systemd cgroup driver, systemd removes the cgroup as soon as
// init exits, and the memory.events file is gone before Docker can read
// oom_kill. PID 1 then dies 137 with OOMKilled left false. A child OOM leaves
// init and the cgroup in place, so Docker records the kill. memory.oom.group
// stays 0 so that kill does not take init with it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const name=`shooter-native-oom-${process.pid}`,image=process.argv[2]||'shooter-verifier-pr09:test';
const docker=(args,timeout=10000)=>execFileSync('docker',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const supervisor=[
  "const {spawn}=require('node:child_process');const fs=require('node:fs');",
  "process.on('SIGUSR2',()=>{const child=spawn(process.execPath,['-e','const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1))'],{stdio:'ignore'});",
  "child.on('exit',(code,signal)=>fs.writeFileSync('/tmp/child-exit',String(code)+':'+String(signal)));});",
  "process.on('SIGUSR1',()=>process.exit(137));",
  "fs.writeFileSync('/tmp/allocator-ready','ready');setInterval(()=>{},1000);",
].join('');
function cgroupDir(pid){
  const line=readFileSync(`/proc/${pid}/cgroup`,'utf8').split('\n').find(row=>row.startsWith('0::'));
  if(!line) throw new Error('cgroup_v2_path_missing');
  return `/sys/fs/cgroup${line.slice('0::'.length)}`;
}
function ensureSingleProcessOom(dir){
  const max=readFileSync(`${dir}/memory.max`,'utf8').trim();
  if(!/^[0-9]+$/.test(max)||Number(max)>64*1024*1024) throw new Error('container_memory_limit_not_applied');
  const groupFile=`${dir}/memory.oom.group`;
  if(readFileSync(groupFile,'utf8').trim()==='0') return;
  try{writeFileSync(groupFile,'0');}
  catch{execFileSync('sudo',['tee',groupFile],{input:'0\n',stdio:['pipe','ignore','pipe']});}
  if(readFileSync(groupFile,'utf8').trim()!=='0') throw new Error('oom_group_not_single_process');
}
try{
  docker(['run','-d','--name',name,'--network','none','--read-only','--memory','64m','--memory-swap','64m','--pids-limit','16','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0',
    '--tmpfs','/tmp:size=1m,noexec,nosuid,nodev','--health-cmd','test -f /tmp/allocator-ready','--health-interval','100ms','--health-timeout','1s','--health-retries','30','--entrypoint','node',image,'-e',supervisor]);
  const inspect=()=>JSON.parse(docker(['inspect','--format','{{json .State}}',name]));
  const startup=Date.now();let state=inspect();
  while(state.Health?.Status!=='healthy'&&state.Running&&Date.now()-startup<5000){await pause(50);state=inspect();}
  assert.equal(state.Running,true,'idleallocatorrunningbeforefault');assert.equal(state.Health?.Status,'healthy','DockerhealthpreconditionbeforeOOMsignal');
  const pid=Number(docker(['inspect','--format','{{.State.Pid}}',name]));
  ensureSingleProcessOom(cgroupDir(pid));
  const started=Date.now();docker(['kill','--signal','USR2',name]);
  const deadline=started+20000;
  while(!state.OOMKilled&&state.Running&&Date.now()<deadline){await pause(50);state=inspect();}
  if(state.Running) docker(['kill','--signal','USR1',name]);
  const exitCode=Number(docker(['wait',name],Math.max(1000,deadline-Date.now())));state=inspect();
  process.stdout.write(JSON.stringify({exitCode,oomKilled:state.OOMKilled,healthPrecondition:'healthy',allocationWallMs:Date.now()-started})+'\n');
  assert.equal(exitCode,137);assert.equal(state.OOMKilled,true,'actualcontainerOOMrequired');
}finally{try{docker(['rm','-f',name]);}catch{/* own throwaway container only */}}
