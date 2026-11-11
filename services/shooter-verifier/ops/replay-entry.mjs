import { startReplayDaemon } from './replay-daemon.mjs';
import { safeEvent } from './safe-metrics.mjs';
let service,stopping=false;
function fatal(){process.stderr.write(safeEvent('worker_unavailable',{reason:'socket'}));process.exit(1);}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
try{service=await startReplayDaemon();process.stdout.write(safeEvent('worker_ready'));}catch{fatal();}
async function stop(){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),27000);try{await service.close();clearTimeout(timer);process.exit(0);}catch{fatal();}}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
