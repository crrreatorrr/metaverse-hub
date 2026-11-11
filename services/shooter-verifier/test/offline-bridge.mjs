// Actions-only actual Docker namespace/credential/filesystem boundary proof.
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const image=process.argv[2]||'shooter-operations:test',name=`shooter-offline-${process.pid}`,dir=mkdtempSync(join(tmpdir(),'shooter-socket-'));
const docker=(args,timeout=30000)=>execFileSync('docker',args,{encoding:'utf8',timeout,stdio:['ignore','pipe','pipe']}).trim();
const mount=['--mount',`type=bind,source=${dir},target=/run/shooter`];
try{
  docker(['run','--rm','--network','none','--user','0',...mount,'--entrypoint','chown',image,'1000:1000','/run/shooter']);
  docker(['run','-d','--name',name,'--network','none','--read-only','--memory','512m','--memory-swap','512m','--pids-limit','32','--cpus','2','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/tmp:size=8m,uid=1000,gid=1000,mode=0700',...mount,image]);
  const inspect=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.ReadonlyRootfs,true);assert.equal(inspect.HostConfig.Memory,512*1024*1024);assert.equal(inspect.HostConfig.PidsLimit,32);assert.equal(inspect.HostConfig.NanoCpus,2000000000);assert.deepEqual(inspect.HostConfig.CapDrop,['ALL']);
  assert.equal(inspect.Mounts.some(m=>m.Destination==='/run/secrets'||m.Destination==='/var/lib/shooter-journal'),false);
  const client=mode=>JSON.parse(docker(['run','--rm','--read-only','--memory','384m','--pids-limit','24','--cap-drop','ALL','--security-opt','no-new-privileges',...mount,'--entrypoint','node',image,'services/shooter-verifier/test/offline-bridge-client.mjs',...(mode?[mode]:[])],40000));
  assert.equal(client().kind,'replayed');
  docker(['exec',name,'node','-e',"const fs=require('fs'),assert=require('assert/strict');assert.equal(fs.existsSync('/run/secrets/shooter-worker.json'),false);assert.equal(fs.existsSync('/var/lib/shooter-journal/current.json'),false);assert.throws(()=>fs.writeFileSync('/app/should-fail','x'),e=>e.code==='EROFS');assert.equal(Object.keys(process.env).some(k=>/TOKEN|PASSWORD|DATABASE|WALLET|SECRET/.test(k)),false);const n=require('net').connect({host:'1.1.1.1',port:443});n.setTimeout(1000);n.on('connect',()=>process.exit(2));n.on('error',()=>process.exit(0));n.on('timeout',()=>process.exit(0));"]);
  docker(['exec',name,'node','-e',"const f=require('fs');const p=f.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).find(x=>{try{return f.readFileSync('/proc/'+x+'/cmdline','utf8').split('\\0').some(a=>a.endsWith('/src/worker.mjs'))}catch{return false}});if(!p)process.exit(2);process.kill(Number(p),'SIGKILL');"]);
  assert.equal(client('health').ready,true,'bounded daemon restart after actual worker crash');
  docker(['stop','--time','28',name]);assert.equal(JSON.parse(docker(['inspect','--format','{{json .State}}',name])).ExitCode,0);
  process.stdout.write(JSON.stringify({offlineBoundary:'passed',workerRestart:'passed',drain:'passed'})+'\n');
}finally{try{docker(['rm','-f',name]);}catch{}try{docker(['run','--rm','--network','none','--user','0',...mount,'--entrypoint','chown',image,`${process.getuid()}:${process.getgid()}`,'/run/shooter']);}catch{}rmSync(dir,{recursive:true,force:true});}
