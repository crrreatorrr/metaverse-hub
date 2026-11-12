// The dev server's worker control (apps/hub/feedback-worker-dev.ts): status from the worker's
// lock file, one worker at most, stop by signal, and POSTs only from the panel itself.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tail, trustedPost, workerControl } from '../feedback-worker-dev';

const logDir = mkdtempSync(join(tmpdir(), 'fwd-'));
const live = new Set<number>();
const started: string[] = [];
const signals: [number, string][] = [];
const control = workerControl({
  repoRoot: '/repo',
  logDir,
  hubUrl: 'http://127.0.0.1:7350',
  isAlive: (pid) => live.has(pid),
  sleep: async () => {},
  startProcess: (logFile) => {
    started.push(logFile);
    // The worker takes its lock and writes its first line.
    live.add(4242);
    writeFileSync(join(logDir, 'worker.pid'), '4242');
    writeFileSync(logFile, 'line 1\nfeedback worker test on http://127.0.0.1:7350\n');
  },
  signal: (pid, sig) => {
    signals.push([pid, sig]);
    live.delete(pid);
  },
});

// Nothing running: stopped, and stop is a no-op.
assert.deepEqual(control.status(), { available: true, running: false, pid: null, log: '' });
assert.equal((await control.stop()).running, false);
assert.equal(signals.length, 0);

// A stale lock (dead pid) reads as stopped.
writeFileSync(join(logDir, 'worker.pid'), '999');
assert.equal(control.status().running, false);

// Start: one process, then running with its pid and log.
const up = await control.start();
assert.equal(started.length, 1);
assert.equal(started[0], join(logDir, 'worker.log'));
assert.deepEqual([up.running, up.pid], [true, 4242]);
assert.match(up.log, /feedback worker test/);

// Start again while running (or a worker started in a terminal holds the lock): no second one.
await control.start();
assert.equal(started.length, 1);

// Stop: SIGTERM to the worker, which then exits.
const down = await control.stop();
assert.deepEqual(signals, [[4242, 'SIGTERM']]);
assert.equal(down.running, false);

// The log tail keeps the last lines only.
const big = join(logDir, 'big.log');
writeFileSync(big, Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n');
const lines = tail(big, 5).split('\n');
assert.deepEqual(lines.slice(-2), ['line 98', 'line 99']);
assert.ok(lines.length <= 6);
assert.equal(tail(join(logDir, 'missing.log')), '');

// POSTs: the custom header, and our own origin when the browser sends one.
const req = (method: string, headers: Record<string, string>) => ({ method, headers: { host: '127.0.0.1:5173', ...headers } });
assert.equal(trustedPost(req('POST', { 'x-feedback-worker': '1', origin: 'http://127.0.0.1:5173' })), true);
assert.equal(trustedPost(req('POST', { 'x-feedback-worker': '1' })), true);
assert.equal(trustedPost(req('POST', { origin: 'http://127.0.0.1:5173' })), false);
assert.equal(trustedPost(req('POST', { 'x-feedback-worker': '1', origin: 'https://evil.example' })), false);
assert.equal(trustedPost(req('GET', { 'x-feedback-worker': '1' })), false);

console.log('feedback worker dev ok');
