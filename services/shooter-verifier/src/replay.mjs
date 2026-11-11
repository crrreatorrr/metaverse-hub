import vm from 'node:vm';
import { APPROVED, simulationManifest } from './approved.mjs';

export const INPUT_BYTES = 20 * 1024 * 1024;
export const OUTPUT_BYTES = 18 * 1024 * 1024;
export const WORK_FRAMES = 4096;
export const operational = (reason) => ({ kind: 'pending_retryable', reason, retryable: true });
function exact(v, keys) {
  return v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
}
export function replayText(text, artifact) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > INPUT_BYTES) return operational('request_oversized');
  let request;
  try { request = JSON.parse(text); } catch { return operational('bad_worker_request'); }
  if (!exact(request, ['operation', 'manifest', 'issuance', 'checkpoint', 'batch', 'accepted', 'maxWorkFrames', 'claim'])
    || !['begin', 'accept', 'step'].includes(request.operation)) return operational('bad_worker_request');
  if (!exact(request.manifest, Object.keys(APPROVED)) || Object.entries(APPROVED).some(([k, v]) => request.manifest[k] !== v)) return operational('artifact_unavailable');
  if (!Number.isSafeInteger(request.maxWorkFrames) || request.maxWorkFrames < 1 || request.maxWorkFrames > WORK_FRAMES
    || !request.issuance || typeof request.issuance !== 'object'
    || (request.operation === 'begin' && (request.checkpoint !== null || request.batch !== null || request.accepted !== null))
    || (request.operation === 'step' && (request.batch !== null || request.accepted !== null))
    || (request.operation === 'accept' && (typeof request.batch !== 'string' || Buffer.byteLength(request.batch) > 2162688))) return operational('bad_worker_request');
  const c = request.claim;
  const integers = ['fence', 'initialRevision', 'expectedRevision', 'tick0', 'tickEnd', 'continuationTick'];
  if (!exact(c, ['jobId', 'runId', 'accountId', 'sessionId', 'inputSha256', ...integers])
    || ['jobId', 'runId', 'accountId', 'sessionId'].some((k) => typeof c[k] !== 'string' || !/^[\x21-\x7e]{1,80}$/.test(c[k]))
    || typeof c.inputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.inputSha256)
    || integers.some((k) => !Number.isSafeInteger(c[k]) || c[k] < 0)
    || c.fence < 1 || c.expectedRevision < c.initialRevision || c.tick0 > c.continuationTick || c.continuationTick > c.tickEnd || c.tickEnd > 162000
    || ['runId', 'accountId', 'sessionId'].some((k) => c[k] !== request.issuance[k])
    || (request.operation === 'begin' ? c.continuationTick !== 0 : request.checkpoint?.accounting?.verifiedFrames !== c.continuationTick)
    || (request.operation === 'step' && request.checkpoint?.pending && request.checkpoint.pending.sha256 !== c.inputSha256)
    || (request.operation === 'accept' && request.accepted?.sha256 !== c.inputSha256)) return operational('bad_worker_binding');
  if (request.operation === 'step' && (!request.checkpoint?.pending || c.continuationTick >= c.tickEnd)) return operational('bad_worker_binding');
  if (request.operation === 'accept') {
    let batch;
    try { batch = JSON.parse(request.batch); } catch { return operational('bad_worker_request'); }
    if (!batch || !Number.isSafeInteger(batch.tick0) || !Number.isSafeInteger(batch.n) || batch.n < 1
      || c.tick0 < batch.tick0 || c.tickEnd > batch.tick0 + batch.n || c.continuationTick >= c.tickEnd) return operational('bad_worker_binding');
  }
  if (request.checkpoint?.pending) {
    const pending = request.checkpoint.pending;
    if (!pending.batch || !Number.isSafeInteger(pending.batch.tick0) || !Number.isSafeInteger(pending.batch.n)
      || c.tick0 < pending.batch.tick0 || c.tickEnd > pending.batch.tick0 + pending.batch.n) return operational('bad_worker_binding');
  }
  // Parse inside the simulator realm so strict plain-object checks remain valid.
  // No caller-provided function, clock, path or code can cross this boundary.
  artifact.context.__requestText = JSON.stringify({ ...request, manifest: simulationManifest() });
  try {
    const text = new vm.Script(`(() => {
      const r = JSON.parse(__requestText);
      const ctx = { issuance:r.issuance, manifest:r.manifest, maxWorkFrames:r.maxWorkFrames };
      if (r.operation === 'accept') ctx.accepted = r.accepted;
      if (r.operation === 'step') ctx.maxWorkFrames = Math.min(ctx.maxWorkFrames, r.claim.tickEnd-r.claim.continuationTick);
      const result = r.operation === 'begin' ? SprotoShooterSim.beginIncrementalReplay(ctx)
        : r.operation === 'accept' ? SprotoShooterSim.acceptReplayBatch(r.batch,r.checkpoint,ctx)
        : SprotoShooterSim.stepReplaySlice(r.checkpoint,ctx);
      return JSON.stringify({ kind:'replayed', binding:r.claim, privateCheckpoint:result.privateCheckpoint,
        publicResult:JSON.parse(SprotoShooterSim.publicReplayJSON(result)) });
    })()`).runInContext(artifact.context, { timeout: 16000 });
    if (Buffer.byteLength(text) > OUTPUT_BYTES) return operational('result_oversized');
    return JSON.parse(text);
  } catch (error) { return operational(error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'execution_timeout' : 'execution_failure'); }
  finally { delete artifact.context.__requestText; }
}
