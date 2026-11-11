import net from 'node:net';
import { lstatSync,unlinkSync,chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ReplayPool } from '../src/process-pool.mjs';
import { APPROVED } from '../src/approved.mjs';
import { operational } from '../src/replay.mjs';
import { encodeFrame,FrameReader,exact,ipcId } from './framing.mjs';
const limits={clients:2,requestMs:25000,restarts:3,restartWindowMs:60000};
export async function startReplayDaemon({socketPath='/run/shooter/replay.sock'}={}){
  if(typeof socketPath!=='string'||!socketPath.startsWith('/')||socketPath.length>100)throw new Error('bad_socket_path');
  // Never unlink an active peer or an unexpected file/symlink.
  let previous;try{previous=lstatSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw new Error('socket_unavailable');}
  if(previous){if(!previous.isSocket()||previous.isSymbolicLink())throw new Error('socket_unavailable');
    const active=await new Promise(resolve=>{const c=net.createConnection({path:socketPath});const t=setTimeout(()=>{c.destroy();resolve(true);},200);c.on('connect',()=>{clearTimeout(t);c.destroy();resolve(true);});c.on('error',()=>{clearTimeout(t);resolve(false);});});
    if(active)throw new Error('socket_in_use');unlinkSync(socketPath);
  }
  let pool=new ReplayPool({size:1,queue:0}),busy=false,draining=false,restartBudgetUsed=0,starts=1,lastPoolStarts=1,restartAt=Date.now(),requests=0;
  const id=randomUUID(),peers=new Set();
  const ready=()=>!draining&&pool.slots.some(s=>s.ready&&!s.dead);
  const metrics=()=>{const stats=pool.stats();starts+=Math.max(0,stats.processStarts-lastPoolStarts);lastPoolStarts=stats.processStarts;return{instanceId:id,requests,restarts:starts-1,busy,clients:peers.size,...stats};};
  const server=net.createServer(socket=>{
    if(draining||peers.size>=limits.clients){socket.destroy();return;}peers.add(socket);
    const timer=setTimeout(()=>socket.destroy(),limits.requestMs);
    const send=value=>{try{socket.end(encodeFrame(value));}catch{socket.destroy();}};
    const reader=new FrameReader(async message=>{
      if(!exact(message,['v','id','op','request'])||message.v!==1||!ipcId(message.id)||!['health','replay'].includes(message.op)){socket.destroy();return;}
      if(message.op==='health'){
        send({v:1,id:message.id,result:{kind:'health',instanceId:id,ready:ready(),draining,manifest:APPROVED,asOf:Date.now()},metrics:metrics()});return;
      }
      if(busy||!ready()){send({v:1,id:message.id,result:operational(draining?'worker_draining':'worker_unavailable'),metrics:metrics()});return;}
      busy=true;requests++;
      try{const result=await pool.execute(JSON.stringify(message.request));send({v:1,id:message.id,result,metrics:metrics()});}
      catch{send({v:1,id:message.id,result:operational('worker_unavailable'),metrics:metrics()});}
      finally{busy=false;}
    },()=>socket.destroy());
    socket.on('data',c=>reader.push(c));socket.on('end',()=>reader.end());socket.on('error',()=>{});
    socket.on('close',()=>{clearTimeout(timer);peers.delete(socket);});
  });
  await new Promise((resolve,reject)=>{server.once('error',()=>reject(new Error('socket_listen_failure')));server.listen(socketPath,resolve);});chmodSync(socketPath,0o600);
  const inode=lstatSync(socketPath);
  const monitor=setInterval(()=>{
    if(draining||busy||pool.slots.some(s=>!s.dead))return;
    if(Date.now()-restartAt>=limits.restartWindowMs){restartAt=Date.now();restartBudgetUsed=0;}
    if(restartBudgetUsed>=limits.restarts)return;metrics();pool.close();pool=new ReplayPool({size:1,queue:0});starts++;lastPoolStarts=1;restartBudgetUsed++;
  },1000);
  async function close(){draining=true;clearInterval(monitor);server.close();
    const deadline=Date.now()+limits.requestMs;while(busy&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
    pool.close();for(const peer of peers)peer.destroy();
    try{const now=lstatSync(socketPath);if(now.ino===inode.ino&&now.dev===inode.dev)unlinkSync(socketPath);}catch{ /* fixed socket only */ }
  }
  return{close,health:()=>({ready:ready(),draining,metrics:metrics()}),server};
}
