// CI restore proof: only immutable approved work enters a credential-free child.
import { readFileSync } from 'node:fs';
import { ReplayPool } from '../src/process-pool.mjs';
const work=JSON.parse(readFileSync(0,'utf8'));
const pool=new ReplayPool({size:1,queue:0});
try {
  const request=(operation,checkpoint,batch=null,accepted=null)=>JSON.stringify({operation,manifest:work.manifest,issuance:work.issuance,checkpoint,batch,accepted,maxWorkFrames:work.maxWorkFrames,claim:work.claim});
  let checkpoint=work.checkpoint;
  if(!checkpoint){const r=await pool.execute(request('begin',null));if(r.kind!=='replayed'||!r.privateCheckpoint)throw new Error('restore_begin');checkpoint=r.privateCheckpoint;}
  if(!checkpoint.pending){const r=await pool.execute(request('accept',checkpoint,JSON.stringify(work.batch),work.accepted));if(r.kind!=='replayed'||!r.privateCheckpoint)throw new Error('restore_accept');checkpoint=r.privateCheckpoint;}
  const result=await pool.execute(request('step',checkpoint));
  if(result.kind!=='replayed'||!result.privateCheckpoint)throw new Error('restore_step');
  process.stdout.write(JSON.stringify(result));
} catch {process.stderr.write('approved restore continuation failed\n');process.exitCode=1;}
finally{pool.close();}
