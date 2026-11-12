// One authenticated fetch invocation per measured attempt. The shared Dup
// helper's implicit fetch-failed retry is deliberately not part of this API.
const ALLOWED = new Set(['shooter.run.append','shooter.run.submit','shooter.run.status','shooter.run.finish','shooter.room_create','shooter.room_join','shooter.metrics']);
export class BenchmarkRpcFailure extends Error {
  constructor(readonly reason: 'rpc_fixture_scope' | 'rpc_request_shape' | 'rpc_request_bound' | 'rpc_transport_failure' | 'rpc_response_read_failure' | 'rpc_response_bound' | 'rpc_response_shape') { super(reason); }
}
export async function benchmarkRpc(name: string, body: object, token: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark' || (process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350') throw new BenchmarkRpcFailure('rpc_fixture_scope');
  const timeoutMs = options.timeoutMs ?? 20000;
  if (!ALLOWED.has(name) || typeof token !== 'string' || token.length < 1 || token.length > 16384 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000) throw new BenchmarkRpcFailure('rpc_request_shape');
  let wire: string;
  try { wire = JSON.stringify(body); } catch { throw new BenchmarkRpcFailure('rpc_request_shape'); }
  if (!wire || Buffer.byteLength(wire) > 2162688) throw new BenchmarkRpcFailure('rpc_request_bound');
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
  let response: Response;
  try { response = await fetch(`http://127.0.0.1:7350/v2/rpc/${encodeURIComponent(name)}?unwrap=true`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: wire, signal }); }
  catch { throw new BenchmarkRpcFailure('rpc_transport_failure'); }
  if (!response.body) throw new BenchmarkRpcFailure('rpc_response_shape');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0, reads = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (++reads > 4096 || bytes > 65536) throw new BenchmarkRpcFailure('rpc_response_bound'); chunks.push(next.value); }
  } catch (error) { if (error instanceof BenchmarkRpcFailure) throw error; throw new BenchmarkRpcFailure('rpc_response_read_failure'); }
  finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BenchmarkRpcFailure('rpc_response_shape'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BenchmarkRpcFailure('rpc_response_shape');
  return { status: response.status, body: parsed as Record<string, unknown> };
}
