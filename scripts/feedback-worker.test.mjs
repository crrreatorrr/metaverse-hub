// feedback-worker.mjs: the run summary, the worker name, the prompt, and the shared RPC client's
// re-login when the admin token expires.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptFor, summaryOf, workerName } from './feedback-worker.mjs';
import { feedbackClient } from './feedback-rpc.mjs';

// Summary: the last SUMMARY: line onward, else the tail; exit codes show on failures.
assert.equal(summaryOf('working...\nSUMMARY: old\nmore\nSUMMARY: 2 resolved, 1 open\nPRs: x', 0), '2 resolved, 1 open\nPRs: x');
assert.equal(summaryOf('', 0), 'The agent finished without a summary.');
assert.equal(summaryOf('boom', 1), 'Exit code 1. boom');
assert.equal(summaryOf('SUMMARY: 0 resolved', 1), '0 resolved');
assert.equal(summaryOf('x'.repeat(700), 0).length, 600);
assert.ok(summaryOf(`SUMMARY: ${'y'.repeat(3000)}`, 0).length <= 1900);

// Worker names fit the server's pattern.
assert.equal(workerName("Ken's MacBook Pro.local"), 'Ken-s-MacBook-Pro.local');
assert.equal(workerName(''), 'feedback-worker');
assert.match(workerName('a'.repeat(200)), /^[A-Za-z0-9._:@-]{1,64}$/);

// The prompt is the playbook plus this run's facts.
{
  const root = mkdtempSync(join(tmpdir(), 'fw-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'feedback-check.md'), '# Playbook\n');
  const prompt = promptFor({ id: 7, requestedBy: '333', requestedAt: '2026-11-12T20:00:00Z', noteCount: 3 }, { hubRoot: root, gamesDir: '/games' });
  assert.match(prompt, /^# Playbook/);
  assert.match(prompt, /Check run: #7, asked by 333 .* 3 notes/);
  assert.match(prompt, /Branch slug for every repo you change: feedback-check-7/);
  assert.match(prompt, /Games folder \(your working directory\): \/games/);
}

// The client logs in once, adds the token, and logs in again when the token expires.
{
  const calls = [];
  let tokens = 0;
  let expireNext = false;
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const reply = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
    if (url.includes('/authenticate/device')) return reply({ token: 'session' });
    if (url.includes('feedback.admin.login')) return reply({ token: `t${++tokens}` });
    if (expireNext) {
      expireNext = false;
      return reply({ error: 'unauthorized' });
    }
    return reply({ ok: true, run: null, token: body.token });
  };
  const cache = join(mkdtempSync(join(tmpdir(), 'fw-cache-')), 'login.json');
  const config = { base: 'http://hub', serverKey: 'k', user: '333', pass: '333', device: 'd', cache };
  const client = feedbackClient(config, fake);
  assert.equal((await client.rpc('feedback.admin.claim', { worker: 'w' })).token, 't1');
  expireNext = true;
  assert.equal((await client.rpc('feedback.admin.claim', { worker: 'w' })).token, 't2');
  assert.equal(calls.filter((c) => c.url.includes('feedback.admin.login')).length, 2);
  // An expired saved login is not reused.
  const logins = () => calls.filter((c) => c.url.includes('feedback.admin.login')).length;
  assert.equal((await feedbackClient(config, fake).rpc('feedback.admin.runs')).token, 't3');
  // A live saved login is reused by the next process: no new login.
  const live = `333:${Math.floor(Date.now() / 1000) + 3600}.mac`;
  writeFileSync(cache, JSON.stringify({ bearer: 'Bearer session', token: live }));
  const before = logins();
  assert.equal((await feedbackClient(config, fake).rpc('feedback.admin.runs')).token, live);
  assert.equal(logins(), before);
  assert.ok(calls.every((c) => c.url.startsWith('http://hub/')));
}

console.log('feedback worker ok');
