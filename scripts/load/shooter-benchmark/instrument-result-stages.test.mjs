import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { instrumentResultSources, requireTraceCI } from './instrument-result-stages.mjs';
import { PREFIX, STAGES, MAX_MARKERS } from './result-stage-schema.mjs';

const source = {
  internal: readFileSync(new URL('../../../server/modules/src/games/shooter_verification_internal.ts', import.meta.url), 'utf8'),
  commit: readFileSync(new URL('../../../server/modules/src/games/shooter_verification_commit.ts', import.meta.url), 'utf8'),
};
const digest = value => createHash('sha256').update(value).digest('hex');
const changed = instrumentResultSources(source);
test('pure transform preserves original input and hashes exactly both generated source strings', () => {
  assert.equal(changed.sources.length, 2);
  for (const [index, name] of ['internal','commit'].entries()) {
    assert.equal(changed.sources[index].originalSha256, digest(source[name]));
    assert.equal(changed.sources[index].instrumentedSha256, digest(changed[name]));
    assert.notEqual(changed[name], source[name]);
  }
  assert.equal(source.internal.includes(PREFIX), false);
  assert.equal((changed.internal.match(/JSON\.stringify\(parsed\.body\)/g) || []).length, 1, 'SQL body serializes exactly once');
  for (const marker of STAGES) assert.ok((changed.internal + changed.commit).includes(JSON.stringify(marker)), marker);
  assert.equal((changed.commit.match(/hash\(c\);/g) || []).length, 1);
  assert.equal((changed.commit.match(/hash\(snap\);/g) || []).length, 1);
});
test('missing or duplicate anchors in EITHER source reject the whole transformation', () => {
  assert.throws(() => instrumentResultSources({ ...source, internal: source.internal.replace('var digest=', 'var changedDigest=') }), /refused/);
  assert.throws(() => instrumentResultSources({ ...source, commit: source.commit.replace('hash(snap);', 'hash(snap); hash(snap);') }), /refused/);
  const anchor = '  export function valid(nk: nkruntime.Nakama, raw: unknown): boolean {';
  assert.throws(() => instrumentResultSources({ ...source, commit: source.commit + '\n' + anchor }), /refused/);
  assert.throws(() => instrumentResultSources(changed), /refused/, 'cannot instrument twice');
});
test('all three exact Actions gates are mandatory; truthy variants do not authorize source edits', () => {
  const env = { GITHUB_ACTIONS: 'true', HUB_SHOOTER_FIXTURE: 'benchmark', SHOOTER_BENCHMARK_RESULT_TRACE: '1' };
  requireTraceCI(env);
  for (const key of Object.keys(env)) for (const value of [undefined,'true-ish','0','']) assert.throws(() => requireTraceCI({ ...env, [key]: value }), /refused/);
});

const uuid = '11111111-1111-4111-8111-111111111111';
const manifest = { artifact: 'shooter-sim', sourceCommit: '05f7a0a245af921fc65a99588564175c19658e38', sha256: '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9', protocol: 1, contentFingerprint: 'cea1f88b', uploadProtocol: 2, replayApiVersion: 2, checkpointSchema: 2, economyPolicy: 1 };
const payload = JSON.stringify({ workerId: 'PRIVATE-WORKER', keyId: 'PRIVATE-KEY', token: 'a'.repeat(43), requestId: 'PRIVATE-REQUEST', body: {
  manifest, result: { kind: 'replayed', privateCheckpoint: null,
    binding: { jobId: uuid, runId: uuid, accountId: uuid, sessionId: uuid, inputSha256: 'b'.repeat(64), fence: 1, initialRevision: 0, expectedRevision: 0, tick0: 0, tickEnd: 1, continuationTick: 0 },
    publicResult: { version: 2, status: 'pending_retryable', reason: 'worker_crash', retryable: true, eligible: false, ranked: false, ticketsMinted: 0, terminal: null } },
} });
function runtime(internal, { loggingThrows = false, queryThrows = null, preflight = 'ready', markMany = false, clock = null } = {}) {
  const lines = [], queries = [];
  const context = vm.createContext({
    Date: clock ? { now: clock } : Date,
    ShooterRewards: { queryJson(_nk, sql, args) {
      queries.push({ sql, args });
      if (queryThrows) throw queryThrows;
      if (sql.includes('gateway_preflight')) return { state: preflight };
      if (sql.includes("'authorized'")) return { authorized: true };
      return { state: 'verified', ticketsMinted: 0 };
    } },
    ShooterVerificationCommit: { valid(_nk, _body, marker) { if (markMany && marker) for (let i = 0; i < 80; i++) marker('checkpoint_envelope_hash_begin');return true; } },
    HubFault: { apply() {} }, ShooterVerificationSettlement: { afterResult() {} },
  });
  const output = ts.transpileModule(internal, { compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None }, reportDiagnostics: true });
  assert.deepEqual(output.diagnostics, []);
  vm.runInContext(output.outputText, context);
  const nk = { uuidv4: () => 'independent-synthetic-tag-input', sha256Hash: () => 'c'.repeat(64), stringToBinary: value => Buffer.from(value) };
  const logger = { info(value) { if (loggingThrows) throw new Error('PRIVATE-LOG-FAILURE');lines.push(value); }, error() {} };
  return { lines, queries, invoke: (op = 'result', body = payload, ctx = { userId: uuid }) => context.ShooterVerificationInternal.call(ctx, logger, nk, body, op) };
}
test('instrumented call preserves real plain-JSON result, SQL args and logging-failure behavior', () => {
  const plain = runtime(source.internal), traced = runtime(changed.internal), brokenLogger = runtime(changed.internal, { loggingThrows: true });
  const expected = plain.invoke();
  assert.equal(traced.invoke(), expected);assert.equal(brokenLogger.invoke(), expected);
  assert.equal(JSON.stringify(traced.queries), JSON.stringify(plain.queries));
  assert.ok(traced.lines.length > 0);
  for (const line of traced.lines) {
    const [prefix, tag, stage, started, observed, extra] = line.split('|');
    assert.equal(prefix, PREFIX);assert.match(tag, /^[a-f0-9]{64}$/);assert.ok(STAGES.includes(stage));assert.equal(extra, undefined);
    assert.ok(Number.isSafeInteger(Number(started)) && Number(observed) >= Number(started));
    assert.equal(line.includes('PRIVATE'), false);assert.equal(line.includes(uuid), false);
  }
  assert.equal(traced.lines.at(-1).split('|')[2], 'call_exit');
});
test('early returns and original throw identity survive finally; other operations emit no result markers', () => {
  const traced = runtime(changed.internal), plain = runtime(source.internal);
  assert.equal(traced.invoke('result', payload, {}), plain.invoke('result', payload, {}));
  assert.deepEqual(traced.lines.map(line => line.split('|')[2]), ['rpc_enter','call_exit']);
  const failure = new Error('PRIVATE-QUERY-FAILURE'), failed = runtime(changed.internal, { queryThrows: failure, loggingThrows: true });
  assert.throws(() => failed.invoke(), error => error === failure);
  const failedVisible = runtime(changed.internal, { queryThrows: failure });
  assert.throws(() => failedVisible.invoke(), error => error === failure);assert.equal(failedVisible.lines.at(-1).split('|')[2], 'call_exit');
  const renewal = runtime(changed.internal);renewal.invoke('renew');assert.deepEqual(renewal.lines, []);
  const denied = runtime(changed.internal, { preflight: 'pending_retryable' });denied.invoke();
  assert.deepEqual(denied.lines.map(line => line.split('|')[2]), ['rpc_enter','preflight_done','call_exit']);
});
test('the marker limit is local to each invocation and cannot turn into unbounded per-node logging', () => {
  const traced = runtime(changed.internal, { markMany: true });
  assert.equal(JSON.parse(traced.invoke()).state, 'verified');assert.equal(traced.lines.length, MAX_MARKERS);
  traced.invoke();assert.equal(traced.lines.length, 2 * MAX_MARKERS);
});

test('clock rollback remains visible as raw safe timestamps for collector classification', () => {
  let calls = 0;
  const traced = runtime(changed.internal, { clock: () => ++calls === 1 ? 1000 : 900 });
  traced.invoke();assert.ok(traced.lines.length > 0);
  for (const line of traced.lines) { const fields = line.split('|');assert.equal(fields[3], '1000');assert.equal(fields[4], '900'); }
});
