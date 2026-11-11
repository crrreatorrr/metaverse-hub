import { safeEvent } from './safe-metrics.mjs';
const MAX_LINE=16384;
const known=new Map([
  ['Node','runtime_started'],['Server startup completed','runtime_ready'],['Startup done','runtime_ready'],
  ['JavaScript runtime modules loaded','runtime_ready'],['Go runtime modules loaded','runtime_info'],
  ['Failed to exec db query.','db_error_redacted'],['Server shutdown complete','runtime_stopped'],
]);
export class LogFilter {
  constructor(write){this.write=write;this.buffer=Buffer.alloc(MAX_LINE);this.at=0;this.dropping=false;this.counters={lines:0,redacted:0,oversized:0,unstructured:0};}
  emit(event,reason){this.write(safeEvent(event,{reason,count:this.counters.redacted}));}
  line(){
    this.counters.lines++;
    if(this.dropping){this.counters.redacted++;this.counters.oversized++;this.emit('runtime_log_dropped','oversized_line');}
    else{let value;try{value=JSON.parse(this.buffer.subarray(0,this.at).toString('utf8'));}catch{value=null;}
      const event=value&&typeof value.msg==='string'?known.get(value.msg):null;
      if(!event){this.counters.redacted++;this.counters.unstructured++;this.emit('runtime_log_dropped',value?'unknown_message':'unstructured_line');}
      else{if(event==='db_error_redacted'||['query','args','error','stack'].some(k=>Object.hasOwn(value,k)))this.counters.redacted++;
        // Never copy even allowlisted raw msg/level/ts/caller/context values.
        this.emit(event,event==='db_error_redacted'?'unsafe_fields':undefined);}
    }
    this.at=0;this.dropping=false;
  }
  push(chunk){
    let at=0;while(at<chunk.length){const end=chunk.indexOf(10,at),stop=end===-1?chunk.length:end,n=stop-at;
      if(!this.dropping){if(this.at+n>MAX_LINE){this.at=0;this.dropping=true;}else{chunk.copy(this.buffer,this.at,at,stop);this.at+=n;}}
      at=stop;if(end!==-1){this.line();at++;}else break;
    }
  }
  end(){if(this.at||this.dropping)this.line();}
}
const flags=new Set(['--name','--database.address','--logger.level','--session.token_expiry_sec','--session.refresh_token_expiry_sec','--session.encryption_key','--session.refresh_encryption_key',
  '--socket.server_key','--socket.address','--socket.port','--socket.read_timeout_ms','--socket.write_timeout_ms','--socket.max_request_size_bytes','--socket.ssl_certificate','--socket.ssl_private_key',
  '--console.username','--console.password','--console.signing_key','--console.address','--runtime.http_key','--runtime.env','--runtime.path']);
export function checkedNakamaArguments(input){
  if(!Array.isArray(input)||input.length<2||input.length>256||input.length%2!==0)throw new Error('runtime_configuration');
  const args=[],databases=[],seen=new Set();
  for(let i=0;i<input.length;i+=2){const key=input[i],value=input[i+1];
    if(!flags.has(key)||typeof value!=='string'||!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value)
      ||(seen.has(key)&&!['--database.address','--runtime.env'].includes(key)))throw new Error('runtime_configuration');
    if(key==='--runtime.path'&&value!=='/nakama/data/modules')throw new Error('runtime_configuration');
    if(key==='--socket.port'&&value!=='7350')throw new Error('runtime_configuration');
    if(key==='--socket.address'&&!['0.0.0.0','127.0.0.1'].includes(value))throw new Error('runtime_configuration');
    if(key==='--socket.ssl_certificate'||key==='--socket.ssl_private_key')throw new Error('runtime_configuration');
    args.push(key+'='+value);seen.add(key);if(key==='--database.address')databases.push(key+'='+value);
  }
  for(const key of ['--database.address','--socket.server_key','--runtime.http_key','--session.encryption_key','--session.refresh_encryption_key','--console.username','--console.password','--console.signing_key'])if(!seen.has(key))throw new Error('runtime_configuration');
  const log=['--logger.stdout=true','--logger.file=','--logger.format=json'];
  return{server:[...args,...log],migrate:['migrate','up',...databases,...log]};
}
