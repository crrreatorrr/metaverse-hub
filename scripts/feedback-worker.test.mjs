// feedback-worker.mjs: the run summary, the worker name, the prompt, and the shared RPC client's
// re-login when the admin token expires.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { ACTIVITY_MAX, createActivity } from './feedback-activity.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROMPT_MARK, PROMPT_REFUSED, WORKER_VERSION, agentArgs, inputLine, ownerMessage, replayedText, describeEvent, envNumber, modelFor, prStateOf, promptAllowed, syncPullRequests, promptFor, releaseWorkerLock, stopLeftoverAgent, summaryOf, takeWorkerLock, work, workerName } from './feedback-worker.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feedbackClient } from './feedback-rpc.mjs';

// Summary: the last SUMMARY: line onward, else the tail; exit codes show on failures.
assert.equal(summaryOf('working...\nSUMMARY: old\nmore\nSUMMARY: 2 resolved, 1 open\nPRs: x', 0), '2 resolved, 1 open\nPRs: x');
// Only a line that starts with SUMMARY: is one, and it ends with its paragraph: a later remark
// that mentions "SUMMARY:" (a stop hook has the agent confirm it is done) does not replace it.
assert.equal(
  summaryOf('SUMMARY: 1 resolved, PINEAPPLE.\nPRs: x\n\nEverything is done.\n1. ran the playbook and ended with a `SUMMARY:` line. Done.\n2. No errors.', 0),
  '1 resolved, PINEAPPLE.\nPRs: x',
);
assert.equal(summaryOf('work\n**SUMMARY:** 3 resolved\n\nbye', 0), '3 resolved');
assert.equal(summaryOf('work\n> `SUMMARY: 2 open`', 0), '2 open');
assert.equal(summaryOf('the SUMMARY: line comes later', 0), 'the SUMMARY: line comes later');
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
  assert.match(prompt, /Branch slug for each issue: feedback-check-7-<note id in lower case>, e.g. feedback-check-7-hub-0001/);
  assert.match(prompt, /Games folder \(your working directory\): \/games/);
  assert.doesNotMatch(prompt, /owner-prompt/);

  // The owner's prompt for the run follows the run's facts, word for word, after the playbook.
  const ctx = { hubRoot: root, gamesDir: '/games', permissionMode: 'auto' };
  const run = { id: 8, requestedBy: '333', requestedAt: '2026-11-21T09:00:00Z', noteCount: 5, prompt: '  Only the Open World notes.\nSkip anything about art.  ', model: 'opus' };
  const steered = promptFor(run, ctx);
  assert.match(steered, /^# Playbook/);
  assert.match(steered, /### The owner's prompt\n\n.*\n\n<owner-prompt>\nOnly the Open World notes\.\nSkip anything about art\.\n<\/owner-prompt>\n\nWork the notes now/);
  assert.doesNotMatch(promptFor({ ...run, prompt: '   ' }, ctx), /owner-prompt/);

  // The model picked in the panel goes to the agent as --model; none picked falls back to the
  // worker's FEEDBACK_MODEL, then to the agent's own default (no --model at all).
  const args = agentArgs(run, ctx);
  // The brief is not an argument: it goes to the agent's input, where the owner's messages follow.
  assert.ok(!args.includes(steered));
  assert.deepEqual(args.slice(0, 6), ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json']);
  assert.ok(args.includes('--replay-user-messages'));
  // The mark that identifies a leftover feedback agent in the process list is still on the command line.
  assert.ok(args[args.indexOf('--append-system-prompt') + 1].includes(PROMPT_MARK));
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /check run #8/);
  assert.deepEqual(args.slice(-2), ['--model', 'opus']);
  assert.equal(args.filter((a) => a === '--model').length, 1);
  assert.deepEqual(agentArgs({ ...run, model: '' }, { ...ctx, model: 'sonnet' }).slice(-2), ['--model', 'sonnet']);
  assert.ok(!agentArgs({ ...run, model: '' }, ctx).includes('--model'));
  assert.equal(modelFor({ model: 'claude-opus-5-5[1m]' }, {}), 'claude-opus-5-5[1m]');
  // Nothing that could be read as another option or more than one word reaches the command line.
  for (const bad of ['--dangerously-skip-permissions', 'opus --permission-mode bypassPermissions', '', 'x'.repeat(65), 7, null]) {
    assert.equal(modelFor({ model: bad }, {}), '', String(bad));
    assert.equal(modelFor({ model: bad }, { model: 'haiku' }), 'haiku', String(bad));
  }
}

// A prompt is an instruction to an agent on this computer: taken from a hub on this computer,
// and from another one only when the owner said so.
{
  assert.equal(promptAllowed({}, 'http://127.0.0.1:7350'), true);
  assert.equal(promptAllowed({}, 'http://localhost:7350'), true);
  assert.equal(promptAllowed({}, 'http://[::1]:7350'), true);
  assert.equal(promptAllowed({}, 'https://hub.example.com'), false);
  assert.equal(promptAllowed({}, 'https://localhost.example.com'), false);
  assert.equal(promptAllowed({}, 'not a url'), false);
  assert.equal(promptAllowed({ FEEDBACK_ALLOW_PROMPT: '1' }, 'https://hub.example.com'), true);
  assert.equal(promptAllowed({ FEEDBACK_ALLOW_PROMPT: '0' }, 'http://127.0.0.1:7350'), false);
  assert.equal(promptAllowed({ FEEDBACK_ALLOW_PROMPT: 'yes' }, 'https://hub.example.com'), false);

  // A run whose prompt is refused fails at once with the reason, and no agent is started
  // (`agent` here is a program that does not exist: starting it would report exit code 127).
  const sent = [];
  const client = { rpc: async (id, body) => void sent.push([id, body]) };
  const opts = { worker: 'mac', dryRun: false, allowPrompt: false, agent: '/nonexistent/feedback-agent', logDir: join(tmpdir(), 'fw-never-made') };
  await work({ id: 11, noteCount: 2, prompt: 'Only HUB-0001', model: '' }, client, opts);
  assert.deepEqual(sent, [['feedback.admin.run', { id: 11, worker: 'mac', state: 'failed', summary: PROMPT_REFUSED }]]);
  assert.ok(PROMPT_REFUSED.length <= 2000);
  // The version the hub asks of a worker before it hands out a run with a prompt or a model.
  assert.equal(WORKER_VERSION, 3);
  assert.ok(!existsSync(opts.logDir));
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

// The activity report: the lead's step, each subagent with its state, the latest steps, the
// pull requests and the cost, from the stream's own events (shapes as Claude Code 2.1 sends them).
{
  let clock = Date.parse('2026-11-21T16:00:00Z');
  const a = createActivity(() => new Date((clock += 1000)));
  const lead = (content) => a.apply({ type: 'assistant', parent_tool_use_id: null, message: { content } });
  const sub = (parent, content) => a.apply({ type: 'assistant', parent_tool_use_id: parent, message: { content } });
  assert.ok(a.take()); // a first report, even when empty
  assert.equal(a.take(), ''); // nothing changed since
  lead([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List unresolved feedback notes' } }]);
  a.apply({ type: 'system', subtype: 'task_summary', detail: 'Listing unresolved feedback notes' });
  lead([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Fix HUB-0001 menu overlap', subagent_type: 'general-purpose', prompt: 'Notes HUB-0001 and HUB-0004. Never read SHOOTER-0002.' } }]);
  lead([{ type: 'tool_use', id: 'a2', name: 'Agent', input: { description: 'Verify WORLD-0003 floating Pepe', prompt: 'x' } }]);
  a.apply({ type: 'system', subtype: 'task_started', task_id: 'k1', tool_use_id: 'a1', task_type: 'local_agent', description: 'Fix HUB-0001 menu overlap' });
  a.apply({ type: 'system', subtype: 'task_started', task_id: 'b9', tool_use_id: 't9', task_type: 'local_bash', description: 'a shell command, not an agent' });
  a.apply({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'k1', task_type: 'local_agent' }, { task_id: 'k2', task_type: 'local_agent' }] });
  sub('a1', [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/menu.ts' } }]);
  a.apply({ type: 'system', subtype: 'task_progress', task_id: 'k1', tool_use_id: 'a1', subagent_type: 'general-purpose', usage: { total_tokens: 47742, tool_uses: 6, duration_ms: 2121 } });
  a.apply({ type: 'system', subtype: 'task_progress', task_id: 'k2', tool_use_id: 'a2', subagent_type: 'general-purpose', usage: { total_tokens: 900, tool_uses: 1 } });
  a.apply({ type: 'system', subtype: 'code_change_published', provider: 'github', url: 'https://github.com/o/r/pull/7', action: 'created' });
  a.apply({ type: 'system', subtype: 'code_change_published', provider: 'github', url: 'https://github.com/o/r/pull/7', action: 'updated' });
  assert.equal(a.working(), 2);
  let now = JSON.parse(a.take());
  assert.deepEqual(now.lead, { step: 'Bash: List unresolved feedback notes', steps: 3, status: 'Listing unresolved feedback notes' });
  assert.deepEqual(now.agents.map((g) => [g.name, g.state, g.step, g.tools, g.notes]), [
    ['Verify WORLD-0003 floating Pepe', 'working', 'Starting', 1, ['WORLD-0003']],
    ['Fix HUB-0001 menu overlap', 'working', 'Read: /a/menu.ts', 6, ['HUB-0001', 'HUB-0004', 'SHOOTER-0002']],
  ]);
  assert.equal(now.agents[1].kind, 'general-purpose');
  assert.equal(now.agents[1].tokens, 47742);
  assert.deepEqual(now.prs, ['https://github.com/o/r/pull/7']);
  assert.equal(now.result, null);
  assert.ok(now.feed.some((f) => f.who === 'Fix HUB-0001 menu overlap' && f.text === 'Read: /a/menu.ts'));
  assert.ok(now.feed.some((f) => f.who === '' && f.text === 'started subagent: Fix HUB-0001 menu overlap'));

  // A subagent ends by its report, by the stream's task events, or when it is stopped; the first ending stands.
  sub('a1', [{ type: 'tool_use', id: 't3', name: 'SubagentHandback', input: { message: 'HUB-0001 fixed, PR open' } }]);
  a.apply({ type: 'system', subtype: 'task_updated', task_id: 'k1', patch: { status: 'completed', end_time: 1795274189355 } });
  a.apply({ type: 'system', subtype: 'task_updated', task_id: 'k2', patch: { status: 'killed' } });
  a.apply({ type: 'system', subtype: 'task_notification', task_id: 'k2', status: 'completed' });
  a.apply({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
  a.apply({ type: 'result', subtype: 'success', total_cost_usd: 3.25, num_turns: 9, duration_ms: 61000 });
  a.note('owner', 'message #4 read by the agent');
  assert.equal(a.working(), 0);
  now = a.snapshot();
  assert.deepEqual(now.agents.map((g) => [g.name, g.state, g.step]), [
    ['Verify WORLD-0003 floating Pepe', 'stopped', 'Starting'],
    ['Fix HUB-0001 menu overlap', 'done', 'Reported: HUB-0001 fixed, PR open'],
  ]);
  assert.deepEqual(now.result, { ok: true, cost: 3.25, turns: 9, ms: 61000 });
  assert.deepEqual(now.feed.at(-1), { t: now.feed.at(-1).t, who: 'owner', text: 'message #4 read by the agent' });

  // A finished subagent the lead sends back to work (SendMessage) is working again: the same
  // task starts anew under the SendMessage call's id, and its steps carry that id.
  a.apply({ type: 'system', subtype: 'task_started', task_id: 'k1', tool_use_id: 'm1', task_type: 'local_agent', description: 'Fix HUB-0001 menu overlap' });
  assert.equal(a.working(), 1);
  sub('m1', [{ type: 'tool_use', id: 't7', name: 'Bash', input: { description: 'Second pass on the menu' } }]);
  now = a.snapshot();
  assert.equal(now.agents.length, 2);
  assert.deepEqual([now.agents[0].name, now.agents[0].state, now.agents[0].step, now.agents[0].ended, now.agents[0].notes], ['Fix HUB-0001 menu overlap', 'working', 'Bash: Second pass on the menu', '', ['HUB-0001', 'HUB-0004', 'SHOOTER-0002']]);
  assert.ok(now.feed.some((f) => f.who === 'Fix HUB-0001 menu overlap' && f.text === 'resumed'));
  a.apply({ type: 'system', subtype: 'task_notification', task_id: 'k1', tool_use_id: 'm1', status: 'completed' });
  assert.equal(a.working(), 0);
  assert.equal(a.snapshot().agents.find((g) => g.name === 'Fix HUB-0001 menu overlap').state, 'done');
  // A subagent whose step arrives after its ending was resumed too, even without the task event.
  sub('a2', [{ type: 'tool_use', id: 't8', name: 'Read', input: { file_path: '/b.ts' } }]);
  assert.equal(a.snapshot().agents.find((g) => g.name === 'Verify WORLD-0003 floating Pepe').state, 'working');
  a.apply({ type: 'system', subtype: 'task_updated', task_id: 'k2', patch: { status: 'completed' } });
  assert.equal(a.working(), 0);

  // The stream's own count of running subagents holds the run open even without their events.
  const b = createActivity();
  b.apply({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'z', task_type: 'local_agent' }] });
  assert.equal(b.working(), 1);
  b.finish(true);
  assert.equal(b.working(), 0);
  // Events it does not know change nothing, and a long run stays under the hub's limit.
  for (const junk of [null, 7, {}, { type: 'system', subtype: 'thinking_tokens' }, { type: 'user', message: { content: 'x' } }, { type: 'assistant' }]) b.apply(junk);
  for (let i = 0; i < 300; i++) {
    b.apply({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: `g${i}`, name: 'Agent', input: { description: `Fix HUB-${String(i).padStart(4, '0')} ${'x'.repeat(200)}`, prompt: 'p' } }] } });
    b.apply({ type: 'assistant', parent_tool_use_id: `g${i}`, message: { content: [{ type: 'tool_use', id: `s${i}`, name: 'Bash', input: { description: 'y'.repeat(500) } }] } });
  }
  const big = b.take();
  assert.ok(big.length <= ACTIVITY_MAX, String(big.length));
  assert.ok(JSON.parse(big).agents.length <= 40);
}

// The agent's input: one JSON line per message; the owner's carry their number, which is how
// the replayed copy says the agent has read it.
{
  assert.deepEqual(JSON.parse(inputLine('hi\nthere')), { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi\nthere' }] } });
  assert.ok(inputLine('x').endsWith('\n') && !inputLine('a\nb').slice(0, -1).includes('\n'));
  const text = ownerMessage({ id: 12, body: '  Skip HUB-0002.\nStart with the crash.  ' });
  assert.match(text, /^Owner message #12 \(from the feedback admin panel, while you work\):\n\nSkip HUB-0002\.\nStart with the crash\.$/);
  assert.equal(replayedText({ type: 'user', isReplay: true, message: { content: [{ type: 'text', text }] } }), text);
  assert.equal(replayedText({ type: 'user', isReplay: true, message: { content: text } }), text);
  // A tool result is a user event too, and not a replay.
  assert.equal(replayedText({ type: 'user', message: { content: [{ type: 'text', text }] } }), '');
  assert.equal(replayedText({ type: 'assistant', isReplay: true, message: { content: [{ type: 'text', text }] } }), '');
}

// A whole run against a stand-in agent that speaks the stream: the brief arrives on its input,
// the owner's message follows while it works, its replay marks the message read, and once the
// agent has finished and no message waits, its input closes and the run is reported done.
{
  const dir = mkdtempSync(join(tmpdir(), 'fw-live-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'feedback-check.md'), `${PROMPT_MARK}\n`);
  const agent = join(dir, 'agent.mjs');
  writeFileSync(
    agent,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const got = [];
const out = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const lead = (content) => out({ type: 'assistant', parent_tool_use_id: null, message: { content } });
createInterface({ input: process.stdin }).on('line', (line) => {
  const text = JSON.parse(line).message.content[0].text;
  got.push(text);
  writeFileSync(${JSON.stringify(join(dir, 'input.json'))}, JSON.stringify({ argv: process.argv.slice(2), got }));
  out({ type: 'user', isReplay: true, message: { content: [{ type: 'text', text }] } });
  if (got.length === 1) {
    lead([{ type: 'tool_use', id: 't1', name: 'Bash', input: { description: 'List unresolved feedback notes' } }]);
    lead([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Fix HUB-0002 door', prompt: 'p' } }]);
  } else {
    out({ type: 'assistant', parent_tool_use_id: 'a1', message: { content: [{ type: 'tool_use', id: 't2', name: 'SubagentHandback', input: { message: 'stopped as asked' } }] } });
    lead([{ type: 'text', text: 'SUMMARY: 0 resolved, HUB-0002 skipped as the owner asked.' }]);
    out({ type: 'result', subtype: 'success', result: 'SUMMARY: 0 resolved, HUB-0002 skipped as the owner asked.', total_cost_usd: 0.5, num_turns: 2, duration_ms: 900 });
  }
}).on('close', () => process.exit(0));
`,
  );
  chmodSync(agent, 0o755);
  const calls = [];
  let read = false;
  const client = {
    rpc: async (id, body) => {
      calls.push([id, body]);
      // As the hub does: the owner's message comes with every heartbeat from when the agent has
      // started work until the worker reports it read. The agent must still get it only once.
      if ((body.seen ?? []).includes(7)) read = true;
      if (!body.state && !read && existsSync(join(dir, 'input.json'))) return { ok: true, messages: [{ id: 7, body: 'Skip HUB-0002.', by: '333' }] };
      return { ok: true, messages: [] };
    },
  };
  const opts = { worker: 'mac', dryRun: false, allowPrompt: true, agent, permissionMode: 'auto', hubRoot: dir, gamesDir: dir, logDir: join(dir, 'log'), heartbeatMs: 60000, tickMs: 40, idleCloseMs: 60000, maxMinutes: 5, model: '', config: { base: 'http://127.0.0.1:7350', serverKey: 'k' } };
  await work({ id: 21, requestedBy: '333', requestedAt: 'now', noteCount: 2, prompt: '', model: 'haiku' }, client, opts);

  const input = JSON.parse(readFileSync(join(dir, 'input.json'), 'utf8'));
  assert.equal(input.got.length, 2);
  assert.ok(input.got[0].startsWith(PROMPT_MARK));
  assert.equal(input.got[1], ownerMessage({ id: 7, body: 'Skip HUB-0002.' }));
  assert.deepEqual(input.argv.slice(-2), ['--model', 'haiku']);
  const last = calls.at(-1)[1];
  assert.equal(last.state, 'done');
  assert.equal(last.summary, '0 resolved, HUB-0002 skipped as the owner asked.');
  // The message was reported read, in a heartbeat or with the final report.
  assert.ok(calls.some(([, body]) => (body.seen ?? []).includes(7)));
  assert.ok(!calls.some(([, body]) => (body.missed ?? []).length));
  const report = JSON.parse(last.activity);
  assert.equal(report.lead.step, 'Bash: List unresolved feedback notes');
  assert.deepEqual(report.agents.map((g) => [g.name, g.state, g.notes]), [['Fix HUB-0002 door', 'done', ['HUB-0002']]]);
  assert.deepEqual(report.result, { ok: true, cost: 0.5, turns: 2, ms: 900 });
  assert.ok(report.feed.some((f) => f.who === 'owner' && f.text === 'message #7 read by the agent'));
  // While the agent worked, heartbeats carried the report too, for the panel's live view.
  assert.ok(calls.some(([, body]) => !body.state && body.activity && JSON.parse(body.activity).agents.length === 1));

  // A worker that passes no messages on says so when it claims, closes the agent's input after
  // the brief, and hands a message it is given anyway back as missed.
  const calls2 = [];
  let handed2 = false;
  const client2 = {
    rpc: async (id, body) => {
      calls2.push([id, body]);
      if (!body.state && !handed2) {
        handed2 = true;
        return { ok: true, messages: [{ id: 9, body: 'too late', by: '333' }] };
      }
      return { ok: true, messages: [] };
    },
  };
  writeFileSync(
    agent,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const got = [];
createInterface({ input: process.stdin }).on('line', (line) => got.push(line)).on('close', () => {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'SUMMARY: read ' + got.length + ' message' }) + '\\n');
    process.exit(0);
  }, 300);
});
`,
  );
  await work({ id: 22, requestedBy: '333', requestedAt: 'now', noteCount: 1, prompt: '', model: '' }, client2, { ...opts, allowPrompt: false, heartbeatMs: 50 });
  assert.equal(calls2.at(-1)[1].summary, 'read 1 message');
  assert.ok(calls2.some(([, body]) => (body.missed ?? []).includes(9)));
  assert.ok(!calls2.some(([, body]) => (body.seen ?? []).length));
}

// A hub from before the live view refuses a heartbeat that carries a report (it is too long for
// it). The worker then reports without one, so its heartbeats and its result still arrive.
{
  const dir = mkdtempSync(join(tmpdir(), 'fw-old-hub-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'feedback-check.md'), `${PROMPT_MARK}\n`);
  const agent = join(dir, 'agent.mjs');
  writeFileSync(
    agent,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).once('line', () => {
  process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { description: 'List notes' } }] } }) + '\\n');
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'SUMMARY: 1 resolved' }) + '\\n');
  }, 150);
}).on('close', () => process.exit(0));
`,
  );
  chmodSync(agent, 0o755);
  const { RpcError } = await import('./feedback-rpc.mjs');
  const calls = [];
  const client = {
    rpc: async (id, body) => {
      calls.push({ ...body });
      if (body.activity) throw new RpcError('/v2/rpc/feedback.admin.run', 'bad_json', 'bad_json');
      return { ok: true, run: {} }; // an older hub answers without `messages`
    },
  };
  const opts = { worker: 'mac', dryRun: false, allowPrompt: true, agent, permissionMode: 'auto', hubRoot: dir, gamesDir: dir, logDir: join(dir, 'log'), heartbeatMs: 60000, tickMs: 40, idleCloseMs: 60000, maxMinutes: 5, model: '', config: { base: 'http://127.0.0.1:7350', serverKey: 'k' } };
  await work({ id: 23, requestedBy: '333', requestedAt: 'now', noteCount: 1, prompt: '', model: '' }, client, opts);
  // One refused heartbeat, then none carries a report again, and the result arrives.
  assert.equal(calls.filter((body) => body.activity).length, 1);
  assert.ok(calls.findIndex((body) => body.activity) < calls.findIndex((body) => !body.activity && body.summary === 'Working: Bash: List notes'));
  assert.deepEqual(calls.at(-1), { id: 23, worker: 'mac', state: 'done', summary: '1 resolved', seen: [], missed: [] });
}

console.log('feedback worker ok');
