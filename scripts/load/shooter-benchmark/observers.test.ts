import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { coordinatorSample } from './observers.ts';

let oversized = true;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  if (oversized) {
    // Chunked response without Content-Length must still be bounded before
    // accumulating the full body. No credential/raw checkpoint fixture needed.
    for (let i = 0; i < 20; i++) response.write('x'.repeat(8192));
    response.end();
  } else response.end(JSON.stringify({ uptimeMs: 1, counters: { claims: 0 }, lastExecution: null, gateway: null }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  await assert.rejects(coordinatorSample(url, AbortSignal.timeout(1000)), /exceeds bound/);
  oversized = false;
  const observed = await coordinatorSample(url, AbortSignal.timeout(1000));
  assert.equal(observed.metrics.uptimeMs, 1);
  await assert.rejects(coordinatorSample('https://example.com', AbortSignal.timeout(1000)), /loopback/);
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
console.log('bounded safe metrics tests passed; no benchmark execution');
