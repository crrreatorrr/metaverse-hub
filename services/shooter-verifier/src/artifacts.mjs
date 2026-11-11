import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { APPROVED, ECONOMY, equalJSON } from './approved.mjs';

// Neither a request nor an environment variable selects a path, URL or module.
const bundleURL = new URL(`../artifacts/${APPROVED.sha256}/shooter-sim.js`, import.meta.url);
const pinURL = new URL(`../artifacts/${APPROVED.sha256}/shooter-sim.pin.json`, import.meta.url);
export function loadApprovedArtifact() {
  const bytes = readFileSync(bundleURL);
  if (bytes.length > 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== APPROVED.sha256) throw new Error('artifact_unavailable');
  const pin = JSON.parse(readFileSync(pinURL, 'utf8'));
  if (pin.sourceCommit !== APPROVED.sourceCommit || pin.bundleSha256 !== APPROVED.sha256
    || pin.bundleBytes !== bytes.length || pin.protocol !== APPROVED.protocol
    || pin.contentFingerprint !== APPROVED.contentFingerprint || pin.uploadProtocol !== APPROVED.uploadProtocol
    || pin.replayApiVersion !== APPROVED.replayApiVersion || pin.checkpointSchema !== APPROVED.checkpointSchema) throw new Error('artifact_unavailable');
  // vm is namespace separation, NOT a security boundary. The approved code runs
  // inside a separately resource-limited OS process/container.
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(bytes.toString('utf8'), { filename: 'approved-shooter-sim.js' }).runInContext(context, { timeout: 2000 });
  const api = context.SprotoShooterSim;
  if (!api || api.SOURCE_COMMIT !== APPROVED.sourceCommit || api.PROTOCOL_VERSION !== APPROVED.protocol
    || api.contentFingerprintOf() !== APPROVED.contentFingerprint || api.UPLOAD_PROTOCOL_VERSION !== APPROVED.uploadProtocol
    || api.REPLAY_API_VERSION !== APPROVED.replayApiVersion || api.INCREMENTAL_CHECKPOINT_SCHEMA_VERSION !== APPROVED.checkpointSchema
    || !equalJSON(api.ECONOMY, ECONOMY)
    || ['beginIncrementalReplay', 'acceptReplayBatch', 'stepReplaySlice', 'publicReplayJSON'].some((key) => typeof api[key] !== 'function')) throw new Error('artifact_unavailable');
  return { context, api };
}
