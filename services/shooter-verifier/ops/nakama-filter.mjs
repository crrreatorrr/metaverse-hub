// This profile owns PID1. No child stdout/stderr bypasses the fixed event filter.
import { spawn } from 'node:child_process';
import { openSync,readFileSync,fstatSync,closeSync,constants } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { checkedNakamaArguments,LogFilter } from './redact-log.mjs';
import { safeEvent } from './safe-metrics.mjs';
export function readinessStatus({alive,stopping,lastHealthyAt},now=Date.now()) {
  return alive&&!stopping&&lastHealthyAt>0&&now-lastHealthyAt>=0&&now-lastHealthyAt<3000;
}
export async function runFilteredNakama({configFile='/run/nakama-launch.json',healthPort=9477}={}) {
  const emit=(event,fields)=>process.stdout.write(safeEvent(event,fields));
  let stopping=false,child=null,alive=false,lastHealthyAt=0,probing=false,probe=null,killTimer=null;
  const filters=[];
  const status=()=>({alive,ready:readinessStatus({alive,stopping,lastHealthyAt}),draining:stopping,logs:filters.map(f=>({...f.counters}))});
  const server=http.createServer({maxHeaderSize:4096},(req,res)=>{
    if(req.method!=='GET'||!['/health','/ready','/metrics'].includes(req.url)){res.writeHead(404);res.end('{}');return;}
    const body=status();res.setHeader('content-type','application/json');
    res.statusCode=(req.url==='/ready'?!body.ready:req.url==='/health'?!alive:false)?503:200;
    res.end(JSON.stringify(body));
  });
  server.maxConnections=4;server.maxHeadersCount=16;server.requestTimeout=1000;server.headersTimeout=1000;server.keepAliveTimeout=100;
  let args;
  try {
    const fd=openSync(configFile,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {const st=fstatSync(fd);if(!st.isFile()||(st.mode&0o077)!==0||st.size>65536)throw new Error();
      const cfg=JSON.parse(readFileSync(fd,'utf8'));
      if(!cfg||Object.keys(cfg).length!==1||!Array.isArray(cfg.serverArgs))throw new Error();
      args=checkedNakamaArguments(cfg.serverArgs);
    } finally {closeSync(fd);}
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(healthPort,'127.0.0.1',resolve);});
  } catch {emit('runtime_failed',{reason:'configuration'});server.close();return{code:1};}
  const stop=()=>{if(stopping)return;stopping=true;lastHealthyAt=0;probe?.destroy();child?.kill('SIGTERM');
    killTimer=setTimeout(()=>child?.kill('SIGKILL'),10000);killTimer.unref();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  // One bounded fixed-origin probe. Readiness expires if the loop stalls.
  const check=()=>{
    if(probing||!alive||stopping)return;probing=true;
    const request=http.get({hostname:'127.0.0.1',port:7350,path:'/healthcheck',timeout:750,maxHeaderSize:4096},res=>{
      let size=0;res.on('data',c=>{size+=c.length;if(size>1024)res.destroy();});
      res.once('end',()=>{if(res.statusCode===200&&size<=1024&&alive&&!stopping)lastHealthyAt=Date.now();else lastHealthyAt=0;});
      res.once('error',()=>{lastHealthyAt=0;});
    });
    probe=request;const deadline=setTimeout(()=>request.destroy(),750);
    request.once('timeout',()=>request.destroy());
    request.once('error',()=>{lastHealthyAt=0;});
    request.once('close',()=>{clearTimeout(deadline);probing=false;probe=null;});
  };
  const launch=argv=>new Promise(resolve=>{
    child=spawn('/nakama/nakama',argv,{env:{},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr]){let waiting=false;
      const filter=new LogFilter(text=>{if(!process.stdout.write(text)&&!waiting){waiting=true;stream.pause();process.stdout.once('drain',()=>{waiting=false;stream.resume();});}});filters.push(filter);
      stream.on('data',c=>filter.push(c));stream.on('end',()=>filter.end());}
    child.once('spawn',()=>{if(stopping)child.kill('SIGTERM');});
    child.once('error',()=>{alive=false;lastHealthyAt=0;});
    child.once('exit',()=>{alive=false;lastHealthyAt=0;});
    // close waits for both filtered pipes, including final partial lines.
    child.once('close',code=>resolve(code===0?0:1));
  });
  let timer=null,code=1;
  try {
    code=await launch(args.migrate);
    if(code===0&&!stopping){emit('runtime_started');const launched=launch(args.server);
      alive=true;timer=setInterval(check,1000);check();code=await launched;}
  } catch {emit('runtime_failed',{reason:'startup'});code=1;}
  finally {
    alive=false;lastHealthyAt=0;if(timer)clearInterval(timer);if(killTimer)clearTimeout(killTimer);probe?.destroy();
    emit(code===0||stopping?'runtime_stopped':'runtime_failed');server.close();server.closeAllConnections();
    process.off('SIGTERM',stop);process.off('SIGINT',stop);
  }
  return{code};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==2){process.stdout.write(safeEvent('runtime_failed',{reason:'configuration'}));process.exitCode=1;}
  else runFilteredNakama().then(result=>{process.exitCode=result.code;},()=>{process.stdout.write(safeEvent('runtime_failed'));process.exitCode=1;});
}
