import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { encodeFrame,FrameReader,exact,ipcId } from './framing.mjs';
import { operational } from '../src/replay.mjs';
export class UnixReplayClient {
  constructor({socketPath='/run/shooter/replay.sock',timeoutMs=25000,onMetrics=()=>{}}={}){
    if(typeof socketPath!=='string'||socketPath.length>100||!socketPath.startsWith('/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>25000)throw new Error('bad_ipc_configuration');
    this.path=socketPath;this.timeout=timeoutMs;this.onMetrics=onMetrics;
  }
  request(op,request=null){
    const id=randomUUID();let frame;try{frame=encodeFrame({v:1,id,op,request});}catch{return Promise.resolve(operational('ipc_oversized'));}
    return new Promise(resolve=>{
      let done=false;const socket=net.createConnection({path:this.path});
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
      const timer=setTimeout(()=>finish(operational('ipc_timeout')),this.timeout);
      const reader=new FrameReader(value=>{
        if(!exact(value,['v','id','result','metrics'])||value.v!==1||!ipcId(value.id)||value.id!==id){finish(operational('ipc_protocol_failure'));return;}
        if(!value.result||typeof value.result!=='object'||Array.isArray(value.result)){finish(operational('ipc_protocol_failure'));return;}
        try{this.onMetrics(value.metrics);}catch{finish(operational('ipc_protocol_failure'));return;}finish(value.result);
      },()=>finish(operational('ipc_protocol_failure')));
      socket.on('connect',()=>socket.write(frame));socket.on('data',c=>reader.push(c));socket.on('end',()=>reader.end());
      socket.on('error',()=>finish(operational('ipc_unavailable')));socket.on('close',()=>{if(!done)finish(operational('ipc_unavailable'));});
    });
  }
  health(){return this.request('health');}
  execute(text){let request;try{request=JSON.parse(text);}catch{return Promise.resolve(operational('bad_worker_request'));}return this.request('replay',request);}
}
