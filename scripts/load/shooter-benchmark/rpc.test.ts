import assert from 'node:assert/strict';
import { benchmarkRpc, BenchmarkRpcFailure } from './rpc.ts';
const originalFetch = globalThis.fetch, originalFixture = process.env.HUB_SHOOTER_FIXTURE;
process.env.HUB_SHOOTER_FIXTURE = 'benchmark';
let attempts = 0;
try {
  globalThis.fetch = async () => { attempts++; throw new Error('fetch failed: private URL and credentials must not escape'); };
  await assert.rejects(benchmarkRpc('shooter.run.append', {}, 'unit-only-token'), error => error instanceof BenchmarkRpcFailure && error.reason === 'rpc_transport_failure' && !error.message.includes('private'));
  assert.equal(attempts, 1, 'transport loss must not add an uncounted HTTP retry');
  globalThis.fetch = async (url, init) => {
    attempts++; assert.equal(String(url), 'http://127.0.0.1:7350/v2/rpc/shooter.run.append?unwrap=true');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer unit-only-token');
    assert.equal(init!.body, JSON.stringify({ runId: 'bound-test-run' })); assert.equal(init!.redirect, 'error');
    return new Response(JSON.stringify({ state: 'received' }), { status: 200 });
  };
  assert.equal((await benchmarkRpc('shooter.run.append', { runId: 'bound-test-run' }, 'unit-only-token')).body.state, 'received');
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } }));
  await assert.rejects(benchmarkRpc('shooter.run.status', {}, 'unit-only-token'), error => error instanceof BenchmarkRpcFailure && error.reason === 'rpc_response_bound');
  assert.equal(cancelled, true, 'oversized response stream is cancelled');
  globalThis.fetch = async () => new Response('not-json');
  await assert.rejects(benchmarkRpc('shooter.run.status', {}, 'unit-only-token'), error => error instanceof BenchmarkRpcFailure && error.reason === 'rpc_response_shape');
} finally { globalThis.fetch = originalFetch; if (originalFixture === undefined) delete process.env.HUB_SHOOTER_FIXTURE; else process.env.HUB_SHOOTER_FIXTURE = originalFixture; }
console.log('one-shot transport failure, exact authenticated envelope and bounded-response canaries passed');
