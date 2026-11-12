import { openSync,readFileSync,fstatSync,closeSync,constants } from 'node:fs';
import { startCoordinator } from './coordinator.mjs';
import { safeEvent } from './safe-metrics.mjs';
function credentials(){let fd;try{fd=openSync('/run/secrets/shooter-worker.json',constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>16384)throw new Error('invalid');const value=JSON.parse(readFileSync(fd,'utf8'));if(!value||Object.keys(value).sort().join(',')!=='accountToken,keyId,token,url,workerId')throw new Error('invalid');return value;}finally{if(fd!==undefined)closeSync(fd);}}
let service,stopping=false;
function fatal(){process.stderr.write(safeEvent('coordinator_quarantined',{reason:'configuration'}));process.exit(1);}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
try{service=await startCoordinator({credentials:credentials()});}catch{fatal();}
async function stop(){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),40000);try{await service.close();clearTimeout(timer);process.exit(0);}catch{fatal();}}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
