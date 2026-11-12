// feedback-worker.mjs: the run summary, the worker name, the prompt, and the shared RPC client's
// re-login when the admin token expires.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROMPT_MARK, describeEvent, envNumber, prStateOf, syncPullRequests, promptFor, releaseWorkerLock, stopLeftoverAgent, summaryOf, takeWorkerLock, workerName } from './feedback-worker.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// Numbers from the environment: junk falls back to the default instead of a 1 ms loop.
assert.equal(envNumber('20s', 20, 5), 20);
assert.equal(envNumber(undefined, 60, 2), 60);
assert.equal(envNumber('', 60, 2), 60);
assert.equal(envNumber('1', 20, 5), 5);
assert.equal(envNumber('90', 20, 5), 90);

// The real playbook carries the mark that identifies a leftover feedback agent.
{
  const hubRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.ok(promptFor({ id: 1, requestedBy: '333', requestedAt: 'now', noteCount: 1 }, { hubRoot, gamesDir: '/g' }).startsWith(PROMPT_MARK));
}

// A leftover agent is stopped only when its worker is gone and its pid still runs the feedback agent.
{
  const logDir = mkdtempSync(join(tmpdir(), 'fw-pid-'));
  const file = join(logDir, 'agent.pid');
  const save = (worker) => writeFileSync(file, JSON.stringify({ pgid: 999999, agent: '/usr/local/bin/claude', runId: 3, worker }));
  const dead = () => false;
  assert.equal(await stopLeftoverAgent({ logDir }), 0); // no file
  // Its worker is alive (a second worker starting beside it): not a leftover, file kept.
  save(424242);
  assert.equal(await stopLeftoverAgent({ logDir }, () => `claude -p ${PROMPT_MARK}`, (pid) => pid === 424242), 0);
  assert.ok(existsSync(file));
  // Pid reused by something else, or by an interactive claude: left alone, run still reported.
  save(424242);
  assert.equal(await stopLeftoverAgent({ logDir }, () => '/Applications/Safari.app/Contents/MacOS/Safari\n', dead), 3);
  save(424242);
  assert.equal(await stopLeftoverAgent({ logDir }, () => 'claude --resume\n', dead), 3);
  save(424242);
  assert.equal(await stopLeftoverAgent({ logDir }, () => { throw new Error('no such process'); }, dead), 3); // gone
  assert.ok(!existsSync(file));
}

// One worker per log folder.
{
  const logDir = mkdtempSync(join(tmpdir(), 'fw-lock-'));
  assert.equal(takeWorkerLock({ logDir }), 0);
  assert.equal(readFileSync(join(logDir, 'worker.pid'), 'utf8'), String(process.pid));
  writeFileSync(join(logDir, 'worker.pid'), '424242');
  assert.equal(takeWorkerLock({ logDir }, (pid) => pid === 424242), 424242); // live other worker
  assert.equal(takeWorkerLock({ logDir }, () => false), 0); // stale lock taken over
  releaseWorkerLock({ logDir });
  assert.ok(!existsSync(join(logDir, 'worker.pid')));
}

// Pull request states from GitHub.
assert.equal(prStateOf({ state: 'MERGED', isDraft: false }), 'merged');
assert.equal(prStateOf({ state: 'CLOSED' }), 'closed');
assert.equal(prStateOf({ state: 'OPEN', isDraft: true }), 'draft');
assert.equal(prStateOf({ state: 'OPEN', isDraft: false }), 'open');
assert.equal(prStateOf({}), '');

// The sync asks GitHub once per PR (several notes may share one) and reports what it learned;
// a PR GitHub cannot answer for is skipped, not reported wrong.
{
  const A = 'https://github.com/o/r/pull/1';
  const B = 'https://github.com/o/r/pull/2';
  const C = 'https://github.com/o/r/pull/3';
  const notes = { open: [{ id: 'X-1', prUrl: '', createdAt: '1' }], in_progress: [{ id: 'X-2', prUrl: A, createdAt: '2' }], fixed: [{ id: 'X-3', prUrl: A, createdAt: '3' }, { id: 'X-4', prUrl: B, createdAt: '4' }, { id: 'X-5', prUrl: C, createdAt: '5' }] };
  const sent = [];
  const client = {
    rpc: async (id, body) => {
      if (id === 'feedback.admin.list') return { items: body.offset ? [] : notes[body.status], total: notes[body.status].length, counts: {} };
      sent.push(body);
      return { ok: true };
    },
  };
  const asked = [];
  const view = async (url) => {
    asked.push(url);
    if (url === C) throw new Error('Could not resolve to a PullRequest');
    return url === A ? { state: 'MERGED' } : { state: 'OPEN', isDraft: true };
  };
  const prs = await syncPullRequests(client, view);
  assert.deepEqual(asked, [A, B, C]);
  assert.deepEqual(prs, [{ url: A, state: 'merged' }, { url: B, state: 'draft' }]);
  assert.deepEqual(sent, [{ prs }]);
}

// The agent's stream as readable progress; subagent steps carry the subagent's description.
{
  const agents = new Map();
  const say = (content, parent = null) => describeEvent({ type: 'assistant', parent_tool_use_id: parent, message: { content } }, agents);
  assert.deepEqual(say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List unresolved feedback notes' } }]), ['Bash: List unresolved feedback notes']);
  assert.deepEqual(say([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Fix HUB-0001 in metaverse-hub', prompt: 'x' } }]), ['started subagent: Fix HUB-0001 in metaverse-hub']);
  assert.deepEqual(say([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.ts' } }], 'a1'), ['[Fix HUB-0001 in metaverse-hub] Read: /a/b.ts']);
  assert.deepEqual(say([{ type: 'tool_use', id: 't3', name: 'SubagentHandback', input: { message: 'done' } }], 'a1'), ['[Fix HUB-0001 in metaverse-hub] finished']);
  assert.deepEqual(say([{ type: 'text', text: '  Both notes\n are in progress. ' }]), ['says: Both notes are in progress.']);
  assert.deepEqual(say([{ type: 'thinking', thinking: 'hm' }]), []);
  assert.deepEqual(describeEvent({ type: 'system', subtype: 'init' }, agents), []);
  assert.ok(say([{ type: 'text', text: 'x'.repeat(500) }])[0].length <= 'says: '.length + 160);
}

console.log('feedback worker ok');
