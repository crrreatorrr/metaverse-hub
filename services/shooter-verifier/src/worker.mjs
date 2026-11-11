import { loadApprovedArtifact } from './artifacts.mjs';
import { replayText, operational, INPUT_BYTES, OUTPUT_BYTES } from './replay.mjs';
let artifact;
try { artifact = loadApprovedArtifact(); }
catch { process.send?.({ type: 'unavailable' }); process.exitCode = 1; }
if (artifact) {
  process.send?.({ type: 'ready' });
  process.on('message', (message) => {
    if (!message || message.type !== 'replay' || typeof message.text !== 'string' || Buffer.byteLength(message.text) > INPUT_BYTES) {
      process.send?.({ type: 'result', text: JSON.stringify(operational('bad_worker_request')) }); return;
    }
    let text = JSON.stringify(replayText(message.text, artifact));
    if (Buffer.byteLength(text) > OUTPUT_BYTES) text = JSON.stringify(operational('result_oversized'));
    process.send?.({ type: 'result', text });
  });
}
