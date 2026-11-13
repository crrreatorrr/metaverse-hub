// Actions-only fault injection. Init is the process that runs out of memory.
// /bin/sleep stays in the cgroup afterwards. A second Node heap does not fit
// in the 64MB limit. On the systemd cgroup driver,
// systemd otherwise deletes memory.events as soon as init exits, and Docker
// records exit 137 with OOMKilled left false. memory.oom.group stays 0 so the
// sleeper is not killed with init and the cgroup is still there to read.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const name=`shooter-native-oom-${process.pid}`,image=process.argv[2]||'shooter-verifier-pr09:test';
const docker=(args,timeout=10000)=>execFileSync('docker',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const body=[
  "const {spawn}=require('node:child_process');const fs=require('node:fs');",
  // A second Node heap does not fit beside init inside the 64MB limit.
  "const sleeper=spawn('/bin/sleep',['3600'],{stdio:'ignore'});",
  "sleeper.on('error',()=>process.exit(1));",
  "process.on('SIGUSR2',()=>{const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1))});",
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
    '--tmpfs','/tmp:size=1m,noexec,nosuid,nodev','--health-cmd','test -f /tmp/allocator-ready','--health-interval','100ms','--health-timeout','1s','--health-retries','30','--entrypoint','node',image,'-e',body]);
  const inspect=()=>JSON.parse(docker(['inspect','--format','{{json .State}}',name]));
  const startup=Date.now();let state=inspect();
  while(state.Health?.Status!=='healthy'&&state.Running&&Date.now()-startup<5000){await pause(50);state=inspect();}
  assert.equal(state.Running,true,'idleallocatorrunningbeforefault');assert.equal(state.Health?.Status,'healthy','DockerhealthpreconditionbeforeOOMsignal');
  const pid=Number(docker(['inspect','--format','{{.State.Pid}}',name]));
  const dir=cgroupDir(pid);
  ensureSingleProcessOom(dir);
  const started=Date.now();docker(['kill','--signal','USR2',name]);
  const exitCode=Number(docker(['wait',name],20000));state=inspect();
  const observed=Date.now();while(!state.OOMKilled&&Date.now()-observed<1000){await pause(50);state=inspect();}
  let oomKill=null;try{const events=readFileSync(`${dir}/memory.events`,'utf8');oomKill=Number((/^oom_kill (\d+)$/m.exec(events)||[])[1]);}catch{/* cgroup already removed */ }
  process.stdout.write(JSON.stringify({exitCode,oomKilled:state.OOMKilled,healthPrecondition:'healthy',allocationWallMs:Date.now()-started,oomKill})+'\n');
  assert.equal(exitCode,137);assert.equal(state.OOMKilled,true,'actualcontainerOOMrequired');
}finally{try{docker(['rm','-f',name]);}catch{/* own throwaway container only */}}
