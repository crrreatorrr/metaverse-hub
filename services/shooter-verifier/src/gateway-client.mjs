import { randomUUID } from 'node:crypto';
import { operational } from './replay.mjs';
const LIMIT = 20 * 1024 * 1024;
const MAX_RESPONSE_CHUNKS = 4096;
const ID = /^[A-Za-z0-9_.:@|-]{1,80}$/;
const validID = (value) => typeof value === 'string' && ID.test(value);
export function gatewayURL(value) {
  const url = new URL(value);
  if (url.protocol === 'http:' && !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/|$)/i.test(String(value))) throw new Error('unsafe_gateway_url');
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('unsafe_gateway_url');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}
export class GatewayClient {
  #auth;
  #accountToken;
  constructor({ url = 'http://127.0.0.1:7350', workerId, keyId, token, accountToken, timeoutMs = 10000 }) {
    this.url = gatewayURL(url);
    if (!validID(workerId) || !validID(keyId) || !/^[A-Za-z0-9_-]{43}$/.test(token || '')
      || typeof accountToken !== 'string' || accountToken.length > 8192 || !accountToken
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 20000) throw new Error('bad_gateway_configuration');
    this.#auth = { workerId, keyId, token }; this.#accountToken = accountToken; this.timeoutMs = timeoutMs;
  }
  async request(operation, body, requestId) {
    if (requestId === undefined && operation !== 'claim') requestId = randomUUID();
    if (!['claim', 'renew', 'retry', 'result'].includes(operation) || !validID(requestId)) return operational('bad_gateway_request');
    // Coordinator-owned plain JSON only; replay children receive no credentials.
    let text;
    try { text = JSON.stringify({ ...this.#auth, requestId, body }); } catch { return operational('bad_gateway_request'); }
    if (Buffer.byteLength(text) > (operation === 'result' ? LIMIT : 4096)) return operational('request_oversized');
    const url = new URL(this.url); url.pathname = url.pathname.replace(/\/$/, '') + `/v2/rpc/shooter.internal.${operation}`; url.search = 'unwrap=true';
    try {
      const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${this.#accountToken}`, 'Content-Type': 'application/json' }, body: text });
      if (!response.ok || !response.body) return operational('gateway_unavailable');
      if (Number(response.headers.get('content-length') || 0) > LIMIT) { await response.body.cancel(); return operational('response_oversized'); }
      const reader = response.body.getReader(), chunks = []; let bytes = 0, reads = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        // Bound metadata/CPU even for tiny or zero-byte stream fragments.
        if (++reads > MAX_RESPONSE_CHUNKS) { await reader.cancel(); return operational('response_stream_limit'); }
        bytes += value.byteLength;
        if (bytes > LIMIT) { await reader.cancel(); return operational('response_oversized'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return operational('gateway_unavailable'); }
  }
  claim(requestId) { return this.request('claim', {}, requestId); }
  renew(claim, requestId) { return this.request('renew', { jobId: claim.jobId, fence: claim.fence, expectedRevision: claim.expectedRevision }, requestId); }
  retry(claim, reason, requestId) { return this.request('retry', { jobId: claim.jobId, fence: claim.fence, expectedRevision: claim.expectedRevision, reason }, requestId); }
  result(manifest, result, requestId) { return this.request('result', { manifest, result }, requestId); }
  async replayClaim(ack, pool) {
    if (ack?.state !== 'leased' || !ack.work || !ack.claim || (!Number.isFinite(Date.parse(ack.leaseUntil)) || Date.parse(ack.leaseUntil) <= Date.now())) return operational('stale_claim');
    // A stored claim acknowledgment is historical. Recheck its exact live fence
    // before executing; never silently substitute another job/current checkpoint.
    const live = await this.renew(ack.claim);
    if (live.state !== 'leased' || (!Number.isFinite(Date.parse(live.leaseUntil)) || Date.parse(live.leaseUntil) <= Date.now())) return operational('stale_claim');
    const w = ack.work;
    let checkpoint = w.checkpoint;
    const base = { manifest: w.manifest, issuance: w.issuance, claim: w.claim, maxWorkFrames: w.maxWorkFrames };
    async function run(operation) {
      const request = { ...base, operation, checkpoint, batch: operation === 'accept' ? JSON.stringify(w.batch) : null, accepted: operation === 'accept' ? w.accepted : null };
      const result = await pool.execute(JSON.stringify(request));
      if (result.kind === 'replayed') checkpoint = result.privateCheckpoint;
      return result;
    }
    let result;
    if (!checkpoint) { result = await run('begin'); if (!checkpoint) return result; }
    if (!checkpoint.pending) { result = await run('accept'); if (!checkpoint) return result; }
    result = await run('step');
    return result;
  }
}
