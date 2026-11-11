import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { PREFIX, STAGES } from './result-stage-schema.mjs';
import { LIMITS, createResultStageParser, collectResultStages } from './result-stage-collector.mjs';

const tag = 'a'.repeat(64), container = 'b'.repeat(64), secret = 'PRIVATE_CP_TOKEN_QUERY_MUST_NOT_SURVIVE';
const marker = (stage = STAGES[0], start = '100', end = '120') => `${PREFIX}|${tag}|${stage}|${start}|${end}`;
const line = (msg = marker(), extra = {}) => Buffer.from(JSON.stringify({ msg, ...extra }) + '\n');
const safe = evidence => { const text = JSON.stringify(evidence); assert.ok(!text.includes(secret)); assert.ok(Buffer.byteLength(text) <= LIMITS.outputBytes); return evidence; };

test('fragmented stdout/stderr JSON emits only closed marker fields', () => {
  const parser = createResultStageParser(), input = line(marker(), { token: secret, args: [secret], error: secret, traceTag: secret, elapsedMs: secret });
  parser.push(input.subarray(0, 11)); parser.push(line(marker(STAGES[1])), 'stderr'); parser.push(input.subarray(11));
  const value = safe(parser.finish());
  assert.equal(value.records.length, 2);
  assert.deepEqual(value.records[1], { traceTag: tag, stage: STAGES[0], startedWallMs: 100, observedWallMs: 120, elapsedMs: 20, clockReason: null });
  assert.equal(value.counts.acceptedRecords, 2);
  assert.equal(value.state, 'observed');
});

test('oversized whole line cannot smuggle a valid marker suffix', () => {
  const parser = createResultStageParser();
  parser.push(Buffer.alloc(LIMITS.lineBytes + 1, 32)); parser.push(line()); parser.push(line());
  const value = safe(parser.finish());
  assert.equal(value.counts.oversizedLines, 1); assert.equal(value.records.length, 1);
});

test('rejects malformed marker tokens, enums, timestamp types and unsafe counts', () => {
  const parser = createResultStageParser();
  for (const message of [marker() + '|extra', marker('toString'), marker('__proto__'), marker(secret), marker(STAGES[0], '-1'),
    marker(STAGES[0], '1.5'), marker(STAGES[0], 'NaN'), marker(STAGES[0], '9007199254740992'), marker(STAGES[0], '01'),
    marker().replace(tag, tag.toUpperCase()), { private: secret }, null]) parser.push(line(message));
  parser.push(Buffer.from(JSON.stringify({ other: marker(), token: secret }) + '\n'));
  parser.push(Buffer.from(JSON.stringify([marker()]) + '\n')); parser.push(Buffer.from(secret + '\n'));
  parser.push(line()); const value = safe(parser.finish());
  assert.equal(value.records.length, 1); assert.equal(value.counts.rejectedLines, 15);
});

test('all shared stage enums accepted; wall rollback remains explicit unknown elapsed', () => {
  const parser = createResultStageParser();
  for (const stage of STAGES) parser.push(line(marker(stage, '120', '100')));
  const value = safe(parser.finish()); assert.equal(value.records.length, STAGES.length);
  for (const record of value.records) { assert.equal(record.elapsedMs, null); assert.equal(record.clockReason, 'server_wall_clock_rollback'); }
});

test('empty/newline flood has a separate CPU line bound and cannot promote a suffix', () => {
  const parser = createResultStageParser(); parser.push(line());
  const flood = Buffer.concat([Buffer.alloc(LIMITS.lines, 10), line()]);
  assert.equal(parser.push(flood, 'stderr'), false);
  const value = safe(parser.finish());
  assert.equal(value.reason, 'line_bound'); assert.equal(value.truncated, true);
  assert.equal(value.counts.lines, LIMITS.lines); assert.equal(value.counts.rejectedLines, LIMITS.lines - 1);
  assert.equal(value.records.length, 1); assert.equal(parser.push(line()), false);
  assert.match(value.scope, /last4096Dockerloglines_only; earlier_history_omission_unknown/);
});

test('record, serialized byte and scan limits retain explicit dropped/truncated counts', () => {
  const parser = createResultStageParser();
  for (let i = 0; i < 1600; i++) parser.push(line(marker(STAGES[0], '9007199254740991', '0')));
  const value = safe(parser.finish());
  assert.ok(value.records.length <= LIMITS.records); assert.equal(value.counts.acceptedRecords, 1600);
  assert.equal(value.counts.droppedRecords, 1600 - value.records.length); assert.equal(value.truncated, true);
  const scan = createResultStageParser(), chunk = Buffer.alloc(1024 * 1024, 32);
  for (let i = 0; i < 15; i++) assert.equal(scan.push(chunk), true);
  assert.equal(scan.push(chunk), false); assert.equal(scan.push(line()), false);
  const limited = safe(scan.finish()); assert.equal(limited.reason, 'scan_bound'); assert.equal(limited.truncated, true);
  assert.equal(limited.counts.scannedBytes, LIMITS.scanBytes); assert.equal(limited.records.length, 0);
});

async function withGate(callback) {
  const keys = ['GITHUB_ACTIONS','HUB_SHOOTER_FIXTURE','SHOOTER_BENCHMARK_RESULT_TRACE'];
  const previous = keys.map(key => process.env[key]);
  [process.env.GITHUB_ACTIONS, process.env.HUB_SHOOTER_FIXTURE, process.env.SHOOTER_BENCHMARK_RESULT_TRACE] = ['true','benchmark','1'];
  try { return await callback(); } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
}
function child() {
  const value = new EventEmitter(); value.stdout = new PassThrough(); value.stderr = new PassThrough(); value.kills = [];
  value.kill = signal => { value.kills.push(signal); return true; }; value.unref = () => {};
  return value;
}

test('host collector uses fixed Docker command and never copies private stderr/errors', async () => withGate(async () => {
  const proc = child(); let invocation;
  const value = await collectResultStages(container, { spawnImpl: (...args) => {
    invocation = args; queueMicrotask(() => { proc.stderr.write(Buffer.from(secret + '\n')); proc.stdout.write(line()); proc.emit('close', 0); }); return proc;
  } });
  assert.deepEqual(invocation, ['docker', ['logs','--tail','4096',container], { stdio: ['ignore','pipe','pipe'], shell: false }]);
  assert.equal(safe(value).records.length, 1); assert.equal(value.reason, 'complete');
  const errorChild = child();
  const failed = await collectResultStages(container, { spawnImpl: () => { queueMicrotask(() => errorChild.emit('error', new Error(secret))); return errorChild; } });
  assert.equal(safe(failed).reason, 'spawn_failure'); assert.deepEqual(errorChild.kills, ['SIGKILL']);
  const thrown = await collectResultStages(container, { spawnImpl: () => { throw new Error(secret); } });
  assert.equal(safe(thrown).reason, 'spawn_failure');
}));

test('gate and invalid container refuse spawning; unsuccessful Docker exit stays unavailable', async () => withGate(async () => {
  const never = () => { throw new Error('must_not_spawn'); };
  assert.equal((await collectResultStages(container + ';bad', { spawnImpl: never })).reason, 'invalid_container');
  process.env.SHOOTER_BENCHMARK_RESULT_TRACE = '0';
  assert.equal((await collectResultStages(container, { spawnImpl: never })).reason, 'not_enabled');
  process.env.SHOOTER_BENCHMARK_RESULT_TRACE = '1';
  const proc = child();
  const result = await collectResultStages(container, { spawnImpl: () => { queueMicrotask(() => { proc.stderr.write(line()); proc.emit('close', 1); }); return proc; } });
  assert.equal(safe(result).state, 'unavailable'); assert.equal(result.reason, 'docker_failure');
}));

test('collection scan bound kills only Docker client and safely freezes partial evidence', async () => withGate(async () => {
  const proc = child();
  const result = await collectResultStages(container, { spawnImpl: () => {
    queueMicrotask(() => { proc.stdout.write(line()); const chunk = Buffer.alloc(1024 * 1024, 32); for (let i = 0; i < 17 && !proc.kills.length; i++) proc.stdout.write(chunk); }); return proc;
  } });
  assert.equal(safe(result).reason, 'scan_bound'); assert.deepEqual(proc.kills, ['SIGKILL']); assert.equal(result.records.length, 1);
}));

test('collection hard deadline does not wait for child close or expose errors', async () => withGate(async () => {
  const proc = child(); const result = await collectResultStages(container, { spawnImpl: () => proc });
  assert.equal(safe(result).reason, 'collection_timeout'); assert.deepEqual(proc.kills, ['SIGKILL']);
}));
