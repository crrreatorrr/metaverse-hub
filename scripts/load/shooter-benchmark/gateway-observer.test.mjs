import test from 'node:test';
import assert from 'node:assert/strict';
import { installGatewayObserver, DIAGNOSTIC_BYTES, OPERATIONS } from './gateway-observer.mjs';

const deferred = () => { let resolve;const promise = new Promise(done => { resolve = done; });return { promise, resolve }; };
function fixture(request, fetch) {
  const gatewayPrototype = { request }, metricsPrototype = { snapshot() { return { uptimeMs: 1, counters: { claims: 0 } }; } }, fetchTarget = { fetch };
  const observer = installGatewayObserver({ gatewayPrototype, metricsPrototype, fetchTarget });
  return { gatewayPrototype, metricsPrototype, fetchTarget, observer };
}
test('delegation preserves arguments, returned identity and unread response body; private fields never enter metadata', async () => {
  const body = { token: 'PRIVATE-BODY', privateCheckpoint: { secret: 'PRIVATE-CP' } }, id = 'PRIVATE-RID', dto = { state: 'verified', reason: null, token: 'PRIVATE-RETURN' };
  let requestThis, fetchThis, forwarded;
  const target = { fetch: async function (...args) { fetchThis = this;forwarded = args;return { status: 200, get body() { throw new Error('observer must never read response body'); } }; } };
  const prototype = { async request(...args) { requestThis = this;assert.deepEqual(args, ['result', body, id]);await target.fetch('https://PRIVATE-URL', { headers: { Authorization: 'PRIVATE-AUTH' }, body: 'PRIVATE-WIRE' });return dto; } };
  const originalRequest = prototype.request, originalFetch = target.fetch, metrics = { snapshot() { return { uptimeMs: 3 }; } }, originalSnapshot = metrics.snapshot;
  const observer = installGatewayObserver({ gatewayPrototype: prototype, metricsPrototype: metrics, fetchTarget: target });
  try {
    assert.equal(await prototype.request('result', body, id), dto);assert.equal(requestThis, prototype);assert.equal(fetchThis, target);
    assert.equal(forwarded[0], 'https://PRIVATE-URL');assert.equal(forwarded[1].body, 'PRIVATE-WIRE');
    const snapshot = metrics.snapshot();assert.equal(snapshot.uptimeMs, 3);
    const row = snapshot.gatewayDiagnostics.recent[0];assert.equal(row.operation, 'result');assert.equal(row.httpStatus, 200);assert.equal(row.fetchPhase, 'headers_received');assert.equal(row.state, 'verified');
    assert.ok(row.finishedMonoMs >= row.startedMonoMs && row.wallMs >= 0 && row.headersMonoMs >= row.startedMonoMs);
    assert.equal(JSON.stringify(snapshot.gatewayDiagnostics).includes('PRIVATE'), false);
  } finally { observer.restore(); }
  assert.equal(prototype.request, originalRequest);assert.equal(target.fetch, originalFetch);assert.equal(metrics.snapshot, originalSnapshot);
});
test('transport throw identity and operational timeout DTO are preserved without raw exception or abort reason', async () => {
  const failure = new Error('PRIVATE-ERROR'), parent = new AbortController();parent.abort('PRIVATE-ABORT');
  let f;
  f = fixture(async function () { return f.fetchTarget.fetch('PRIVATE-URL', { signal: parent.signal }); }, async () => { throw failure; });
  try {
    await assert.rejects(f.gatewayPrototype.request('receipt', {}, 'PRIVATE-ID'), error => error === failure);
    const row = f.observer.snapshot().recent[0];assert.equal(row.transportOutcome, 'threw');assert.equal(row.fetchPhase, 'threw');assert.equal(row.requestAborted, true);assert.equal(row.httpStatus, null);
    assert.equal(JSON.stringify(f.observer.snapshot()).includes('PRIVATE'), false);
  } finally { f.observer.restore(); }
  const dto = { kind: 'pending_retryable', reason: 'gateway_unavailable' };
  let g;
  g = fixture(async function () { try { await g.fetchTarget.fetch('PRIVATE-URL', { signal: parent.signal }); } catch { return dto; } }, async () => { throw failure; });
  try { assert.equal(await g.gatewayPrototype.request('result'), dto);const row = g.observer.snapshot().recent[0];assert.equal(row.kind, 'pending_retryable');assert.equal(row.reason, 'gateway_unavailable');assert.equal(row.transportOutcome, 'returned'); }
  finally { g.observer.restore(); }
});
test('concurrent operation correlation and active timing survive out-of-order headers without body interception', async () => {
  const claimGate = deferred(), renewGate = deferred();let f;
  f = fixture(async function (op) { await f.fetchTarget.fetch(op);return { state: 'leased' }; }, async op => { await (op === 'claim' ? claimGate.promise : renewGate.promise);return { status: op === 'claim' ? 200 : 503 }; });
  try {
    const claim = f.gatewayPrototype.request('claim'), renew = f.gatewayPrototype.request('renew');
    const live = f.observer.snapshot();assert.equal(live.inFlight, 2);assert.deepEqual(live.active.map(row => row.operation), ['claim','renew']);assert.ok(live.active.every(row => row.fetchPhase === 'awaiting_headers'));
    renewGate.resolve();await renew;claimGate.resolve();await claim;
    const rows = f.observer.snapshot().recent;assert.deepEqual(rows.map(row => [row.operation,row.httpStatus]), [['renew',503],['claim',200]]);
    assert.equal(f.observer.snapshot().byOperation.find(row => row.operation === 'renew').http5xx, 1);
  } finally { f.observer.restore(); }
});
test('ring, serialized bytes and active metadata remain bounded with explicit truncation and full aggregate counts', async () => {
  const f = fixture(async () => ({ state: 'PRIVATE-STATE', reason: ['gateway_unavailable'], kind: { token: 'PRIVATE' } }), async () => ({ status: 200 }));
  try {
    for (let i = 0; i < 400; i++) await f.gatewayPrototype.request('result');
    const snapshot = f.observer.snapshot();assert.equal(snapshot.attempts, 400);assert.equal(snapshot.completed, 400);assert.equal(snapshot.truncated, true);assert.ok(snapshot.droppedEvents > 0);assert.ok(snapshot.recent.length <= 128);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= DIAGNOSTIC_BYTES);assert.equal(snapshot.byOperation.find(row => row.operation === 'result').returned, 400);
    assert.ok(snapshot.recent.every(row => row.state === 'unknown' && row.reason === 'unknown' && row.kind === 'unknown'));assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);
  } finally { f.observer.restore(); }
  const gate = deferred(), g = fixture(async () => { await gate.promise;return {}; }, async () => ({}));
  try {
    const work = Array.from({ length: 12 }, () => g.gatewayPrototype.request('ops'));
    assert.equal(g.observer.snapshot().inFlight, 12);assert.equal(g.observer.snapshot().active.length, 8);assert.equal(g.observer.snapshot().activeOverflow, 4);assert.equal(g.observer.snapshot().truncated, true);
    gate.resolve();await Promise.all(work);assert.equal(g.observer.snapshot().completed, 12);
  } finally { g.observer.restore(); }
});
test('diagnostic projection never invokes result getters or changes a returned object', async () => {
  const dto = { get state() { throw new Error('PRIVATE-GETTER'); }, reason: 'bad_worker_checkpoint', checkpoint_json: 'PRIVATE-CP' };
  const f = fixture(async () => dto, async () => ({}));
  try {
    assert.equal(await f.gatewayPrototype.request('PRIVATE-OP'), dto);
    const snapshot = f.observer.snapshot();assert.equal(snapshot.recent[0].operation, 'unknown');assert.equal(snapshot.recent[0].state, null);assert.equal(snapshot.recent[0].reason, 'bad_worker_checkpoint');
    assert.deepEqual(snapshot.byOperation.map(row => row.operation), OPERATIONS);assert.equal(JSON.stringify(snapshot).includes('PRIVATE'), false);
  } finally { f.observer.restore(); }
});
