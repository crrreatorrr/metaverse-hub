// Independent retained05f oracle; this does not execute the actual worker lane.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { appendDigest, integrationManifest, type PublicBatch, type TrustedActor } from './shooter_verification_e2e_fixtures';
type Obj = Record<string, unknown>;
const bytes = readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${String(integrationManifest.sha256)}/shooter-sim.js`, import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), integrationManifest.sha256);
const realm = vm.createContext({}); vm.runInContext(bytes.toString('utf8'), realm);
const obj = (value: unknown): Obj => value as Obj;
export function retainedOracle(actor: TrustedActor, batch: PublicBatch): Obj {
  realm.input = JSON.stringify({ issuance: actor.issuance, manifest: integrationManifest, batch, digest: appendDigest(batch) });
  try {
    return obj(JSON.parse(vm.runInContext(`JSON.stringify((function(v){
      var api=SprotoShooterSim,m=v.manifest,c={issuance:v.issuance,manifest:{artifact:m.artifact,sourceCommit:m.sourceCommit,sha256:m.sha256,protocol:m.protocol,contentFingerprint:m.contentFingerprint},maxWorkFrames:4096};
      var out=api.beginIncrementalReplay(c),cp=out.privateCheckpoint;
      if(!cp)throw new Error('oracle_begin');
      out=api.acceptReplayBatch(JSON.stringify(v.batch),cp,Object.assign({},c,{accepted:{runId:v.batch.runId,sequence:0,tick0:0,n:v.batch.n,sha256:v.digest,binding:{accountId:v.issuance.accountId,sessionId:v.issuance.sessionId,runId:v.issuance.runId,day:v.issuance.day},acceptedBeforeTerminal:true}}));
      cp=out.privateCheckpoint;if(!cp)throw new Error('oracle_accept');
      var slices=0;
      while(cp.pending){var before=cp.accounting.verifiedFrames;out=api.stepReplaySlice(cp,c);cp=out.privateCheckpoint;
        if(!cp||cp.accounting.verifiedFrames<=before||++slices>40)throw new Error('oracle_nonprogress');}
      return cp;
    })(JSON.parse(input)))`, realm) as string));
  } finally { delete realm.input; }
}

