#!/usr/bin/env node
// The other end of the feedback admin panel's Check button (docs/feedback.md, "Check").
//
// Runs on the owner's computer. Every FEEDBACK_POLL_SECONDS it asks the hub for a queued check
// run (feedback.admin.claim). When it gets one it starts Claude Code headless with the playbook
// in docs/feedback-check.md, sends a heartbeat every minute while the agent works, and reports
// the run done or failed with the agent's SUMMARY line. The hub allows one queued-or-running
// run, and only the worker that claimed a run may report on it, so two workers (or two presses
// of Check) never work the same notes. Canceling the run in the panel stops the agent.
//
// It also keeps each note's pull request state current: every FEEDBACK_PR_SYNC_SECONDS (30; 0
// turns it off) it asks GitHub (`gh pr view`, with the gh login on this machine) about every PR
// linked from an unresolved note and reports open, draft, merged or closed to the hub.
//
//   HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-worker.mjs
//   ... --once        claim at most one run, work it, exit
//   ... --dry-run     claim and finish runs without starting the agent (to test the wiring)
//
// A run can carry what the owner typed beside Check: a prompt, added to the playbook under "This
// run", and a model, passed to the agent as --model (FEEDBACK_MODEL is the default when the run
// names none). A prompt is an instruction to an agent on this computer from whoever holds the
// panel's login, so it is taken only from a hub on this computer unless FEEDBACK_ALLOW_PROMPT=1
// (FEEDBACK_ALLOW_PROMPT=0 refuses it everywhere). A run whose prompt is refused fails at once,
// untouched, and its summary says why.
//
// While the agent works, the worker reports what it and its subagents are doing (see
// feedback-activity.mjs) and passes on the messages the owner sends from the panel: the agent
// runs with streaming input, so it reads a message at its next step without being restarted.
// Messages follow the same rule as the prompt (a hub on this computer, or FEEDBACK_ALLOW_PROMPT=1).
//
// FEEDBACK_WORKER_NAME (default the host name), FEEDBACK_POLL_SECONDS (20), FEEDBACK_HEARTBEAT_SECONDS (60),
// FEEDBACK_MAX_MINUTES (240), FEEDBACK_AGENT (claude), FEEDBACK_PERMISSION_MODE (auto),
// FEEDBACK_MODEL (the agent's own default), FEEDBACK_ALLOW_PROMPT (see above),
// FEEDBACK_TICK_SECONDS (5: how often it reports and asks for messages),
// FEEDBACK_GAMES_DIR (the folder that holds metaverse-hub and the game repos),
// FEEDBACK_LOG_DIR (~/.feedback-worker). The login is the panel's (see feedback-rpc.mjs).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActivity } from './feedback-activity.mjs';
import { feedbackClient, feedbackConfig, listUnresolved, RpcError } from './feedback-rpc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hubRoot = resolve(here, '..');

/** A worker name the server accepts: letters, digits and . _ : @ - only, up to 64. */
export function workerName(raw) {
  const name = String(raw ?? '')
    .replace(/[^A-Za-z0-9._:@-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return name || 'feedback-worker';
}

/**
 * The run summary for the panel: the last line of the agent's that starts with "SUMMARY:" and
 * the rest of its paragraph, else the tail of its output. At most 1,900 characters (the server
 * keeps 2,000). Only a line that starts with it counts (markup such as ** before it allowed): what
 * the agent says after its summary, when a stop hook or the owner's message has it speak again,
 * often mentions "SUMMARY:" in passing.
 */
export function summaryOf(output, code) {
  const text = String(output ?? '').replace(/\r/g, '');
  let at = -1;
  for (const match of text.matchAll(/^[ \t>*_`#-]*SUMMARY:/gm)) at = match.index + match[0].length;
  let summary = at >= 0 ? text.slice(at).split(/\n[ \t]*\n/)[0].replace(/^[*_`]+|[*_`]+$/g, '') : text.slice(-600);
  summary = summary.replace(/\n{3,}/g, '\n\n').trim();
  if (!summary) summary = code === 0 ? 'The agent finished without a summary.' : 'The agent stopped without output.';
  if (code !== 0 && at < 0) summary = `Exit code ${code}. ${summary}`;
  return summary.length > 1900 ? `${summary.slice(0, 1899)}…` : summary;
}

/** The repo folder that holds metaverse-hub and the game repos. */
export function gamesDir(env = process.env) {
  if (env.FEEDBACK_GAMES_DIR) return resolve(env.FEEDBACK_GAMES_DIR);
  try {
    // From a worktree, the main checkout's parent: git-common-dir is <games>/metaverse-hub/.git.
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: hubRoot, encoding: 'utf8' }).trim();
    return dirname(dirname(common));
  } catch {
    return dirname(hubRoot);
  }
}

/**
 * Sent with every claim. 2: this worker reads a run's prompt and model. The hub fails a run that
 * carries either when a worker without it asks, so what the owner typed is never dropped silently.
 * 3: it also reports the agents' activity and passes the owner's messages on.
 */
export const WORKER_VERSION = 3;

/** The owner's prompt of a run, trimmed; '' when the run has none. */
const ownerPrompt = (run) => (typeof run?.prompt === 'string' ? run.prompt.trim() : '');

/** The prompt for one run: the playbook plus this run's facts and, if any, the owner's prompt. */
export function promptFor(run, ctx) {
  const playbook = readFileSync(join(ctx.hubRoot, 'docs', 'feedback-check.md'), 'utf8');
  const owner = ownerPrompt(run);
  return [
    playbook,
    '',
    '## This run',
    '',
    `- Check run: #${run.id}, asked by ${run.requestedBy} at ${run.requestedAt}, ${run.noteCount} notes not resolved when asked.`,
    `- Games folder (your working directory): ${ctx.gamesDir}`,
    `- Admin CLI: node ${join(ctx.hubRoot, 'scripts', 'feedback-admin.mjs')} (HUB_URL and the login are already in your environment).`,
    `- Branch slug for each issue: feedback-check-${run.id}-<note id in lower case>, e.g. feedback-check-${run.id}-hub-0001`,
    ...(owner
      ? ['', "### The owner's prompt", '', 'The owner typed this beside Check for this run. Read "The owner\'s prompt" in the playbook above, then follow it:', '', '<owner-prompt>', owner, '</owner-prompt>']
      : []),
    '',
    'Work the notes now, following the playbook above. End with the SUMMARY line.',
  ].join('\n');
}

/** A model name safe to pass as one argument: an alias ("opus") or a full name. Same shape as the server's. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;

/** The model for a run: the one picked in the panel, else the worker's FEEDBACK_MODEL, else '' (the agent's own default). */
export function modelFor(run, opts) {
  for (const model of [run?.model, opts?.model]) if (typeof model === 'string' && MODEL.test(model)) return model;
  return '';
}

/**
 * The agent's arguments for one run. The brief (promptFor) is not among them: it is the first
 * message on the agent's input, so later ones, the owner's, can follow it there.
 */
export function agentArgs(run, opts) {
  const args = [
    '-p',
    // stream-json out: every step arrives as it happens, so this terminal, the run log and the
    // panel can show what the agent is doing instead of nothing until it ends.
    '--output-format', 'stream-json', '--verbose',
    // stream-json in: the agent reads a new message at its next step. Replayed messages tell the
    // worker which ones it has read.
    '--input-format', 'stream-json', '--replay-user-messages',
    '--permission-mode', opts.permissionMode,
    '--add-dir', opts.hubRoot,
    // Carries PROMPT_MARK, which is how a leftover agent is recognised in the process list.
    '--append-system-prompt',
    `The feedback worker started you for check run #${run.id}. Your brief, "${PROMPT_MARK}", is your first message. ` +
      'A later message that starts with "Owner message #" is from the owner, sent from the feedback admin panel while you work.',
  ];
  const model = modelFor(run, opts);
  if (model) args.push('--model', model);
  return args;
}

/** One message for the agent's input (`--input-format stream-json`). */
export const inputLine = (text) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;

/** The owner's message as the agent gets it. The number is how its replay is recognised. */
export const ownerMessage = (message) => `Owner message #${message.id} (from the feedback admin panel, while you work):\n\n${String(message.body ?? '').trim()}`;

/** The text of a message the agent's stream replays (`--replay-user-messages`), else ''. */
export function replayedText(event) {
  if (event?.type !== 'user' || !event.isReplay) return '';
  const content = event.message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : '';
}

/**
 * May a run's prompt reach the agent? Yes from a hub on this computer, where only its owner can
 * press Check. From any other hub only with FEEDBACK_ALLOW_PROMPT=1: there the prompt comes from
 * whoever holds the panel's login. FEEDBACK_ALLOW_PROMPT=0 refuses it everywhere.
 */
export function promptAllowed(env, base) {
  if (env.FEEDBACK_ALLOW_PROMPT === '1') return true;
  if (env.FEEDBACK_ALLOW_PROMPT === '0') return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
  } catch {
    return false;
  }
}

export const PROMPT_REFUSED =
  'Not started: this check carries a prompt, and this worker does not take prompts from a hub on another computer. ' +
  'To allow them, start the worker with FEEDBACK_ALLOW_PROMPT=1 (change the panel password first: whoever can sign in to the panel can then instruct the agent on this computer). ' +
  'Or press Check again with the prompt box empty.';

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A number from the environment; the default when it is missing or not a number. */
export function envNumber(value, fallback, min) {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? Math.max(min, n) : fallback;
}

/** GitHub's answer for one PR (`gh pr view --json state,isDraft`) → the hub's PR state. */
export function prStateOf(view) {
  const state = String(view?.state ?? '').toUpperCase();
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return view.isDraft ? 'draft' : 'open';
  return '';
}

const ghView = (url) =>
  new Promise((done, failed) =>
    execFile('gh', ['pr', 'view', url, '--json', 'state,isDraft'], { timeout: 30000 }, (error, stdout) => {
      if (error) failed(error);
      else done(JSON.parse(stdout));
    }),
  );

/** Asks GitHub about every PR linked from an unresolved note and reports the states. */
export async function syncPullRequests(client, view = ghView) {
  const { items } = await listUnresolved(client.rpc);
  const urls = [...new Set(items.map((n) => n.prUrl).filter(Boolean))];
  const prs = [];
  for (const url of urls) {
    try {
      const state = prStateOf(await view(url));
      if (state) prs.push({ url, state });
    } catch (error) {
      log(`could not read ${url} from GitHub: ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
  for (let i = 0; i < prs.length; i += 200) await client.rpc('feedback.admin.prstate', { prs: prs.slice(i, i + 200) });
  return prs;
}

/** Signals a process group; quiet when it is already gone. */
function killGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Already exited.
  }
}

/**
 * The agent of the last run, kept on disk while it runs (with the worker that started it). If
 * that worker died without stopping it (SIGKILL, a crash, a power cut), the next start stops the
 * agent before claiming anything, so two agents never work the notes at once.
 */
function pidFile(opts) {
  return join(opts.logDir, 'agent.pid');
}

/** Marks the prompt the worker passes, so only a feedback agent is ever taken for a leftover. */
export const PROMPT_MARK = '# Feedback check playbook';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * One worker per log folder (one per machine by default): → the pid of a live worker that holds
 * the lock, or 0 once this process holds it.
 */
export function takeWorkerLock(opts, isAlive = alive) {
  const file = join(opts.logDir, 'worker.pid');
  try {
    const other = Number(readFileSync(file, 'utf8'));
    if (other > 1 && other !== process.pid && isAlive(other)) return other;
  } catch {
    // No lock yet.
  }
  writeFileSync(file, String(process.pid));
  return 0;
}

export function releaseWorkerLock(opts) {
  const file = join(opts.logDir, 'worker.pid');
  try {
    if (Number(readFileSync(file, 'utf8')) === process.pid) rmSync(file, { force: true });
  } catch {
    // Gone.
  }
}

const psCommand = (pid) => execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });

/** → the run id the last worker left unfinished (0 if none); stops its agent if it still runs. */
export async function stopLeftoverAgent(opts, ps = psCommand, isAlive = alive) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(pidFile(opts), 'utf8'));
  } catch {
    return 0;
  }
  // The worker that wrote it is still at work: its agent is not a leftover.
  if (Number(saved.worker) > 1 && Number(saved.worker) !== process.pid && isAlive(Number(saved.worker))) return 0;
  rmSync(pidFile(opts), { force: true });
  const runId = Number(saved.runId) || 0;
  const pgid = Number(saved.pgid);
  let command = '';
  try {
    command = pgid > 1 ? ps(pgid) : '';
  } catch {
    // Gone already.
  }
  // Only the feedback agent itself: a pid the system gave to anything else, an interactive
  // claude session included, is left alone.
  if (command.includes(basename(String(saved.agent))) && command.includes(PROMPT_MARK)) {
    log(`stopping the agent left from run #${runId} (pid ${pgid})`);
    killGroup(pgid, 'SIGTERM');
    for (let i = 0; i < 50 && isAlive(pgid); i++) await sleep(100);
    if (isAlive(pgid)) killGroup(pgid, 'SIGKILL');
  }
  return runId;
}

const short = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * One event of the agent's stream (`claude -p --output-format stream-json`) → readable progress
 * lines. A subagent's steps carry its description, e.g. "[Fix HUB-0001 in metaverse-hub] Bash:
 * Run the tests". `agents` remembers each subagent's description by its tool call id.
 */
export function describeEvent(event, agents) {
  const lines = [];
  if (event?.type !== 'assistant' || !Array.isArray(event.message?.content)) return lines;
  const who = event.parent_tool_use_id ? `[${agents.get(event.parent_tool_use_id) ?? 'subagent'}] ` : '';
  for (const part of event.message.content) {
    if (part.type === 'tool_use') {
      const input = part.input ?? {};
      if (part.name === 'Agent' || part.name === 'Task') {
        agents.set(part.id, short(input.description || 'subagent', 60));
        lines.push(`${who}started subagent: ${short(input.description || input.prompt, 100)}`);
      } else if (part.name === 'SubagentHandback') {
        lines.push(`${who}finished`);
      } else {
        lines.push(`${who}${part.name}: ${short(input.description || input.command || input.file_path || input.pattern || input.url || '', 110)}`);
      }
    } else if (part.type === 'text' && part.text?.trim()) {
      lines.push(`${who}says: ${short(part.text, 160)}`);
    }
  }
  return lines;
}

/** The run in hand: its stop(), and the agent's process group while it runs. */
let current = null;
let agentGroup = 0;
let quitting = false;

export async function work(run, client, opts) {
  const { worker } = opts;
  const model = modelFor(run, opts);
  log(`run #${run.id} claimed (${run.noteCount} notes${model ? `, model ${model}` : ''}${ownerPrompt(run) ? ', with a prompt from the owner' : ''})`);
  if (opts.dryRun) {
    await client.rpc('feedback.admin.run', { id: run.id, worker, state: 'done', summary: 'Dry run: the worker claimed this run and did not start the agent.' });
    log(`run #${run.id} finished (dry run)`);
    return;
  }
  if (ownerPrompt(run) && !opts.allowPrompt) {
    // Failed, not run without it: a prompt that narrows the run must never be dropped silently.
    try {
      await client.rpc('feedback.admin.run', { id: run.id, worker, state: 'failed', summary: PROMPT_REFUSED });
    } catch (error) {
      log(`run #${run.id}: could not report failed: ${error.message}`);
    }
    log(`run #${run.id} failed: its prompt was refused (FEEDBACK_ALLOW_PROMPT is not 1 and the hub is not on this computer)`);
    return;
  }

  mkdirSync(opts.logDir, { recursive: true });
  const logPath = join(opts.logDir, `run-${run.id}.log`);
  const logFile = createWriteStream(logPath, { flags: 'a' });
  logFile.on('error', (error) => log(`run #${run.id}: cannot write ${logPath}: ${error.message}`));
  const child = spawn(opts.agent, agentArgs(run, opts), {
    cwd: opts.gamesDir,
    env: { ...process.env, FEEDBACK_RUN_ID: String(run.id), HUB_URL: opts.config.base, NAKAMA_SERVER_KEY: opts.config.serverKey },
    stdio: ['pipe', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops the shells and tools it started.
    detached: true,
  });
  // The agent's input: the brief first, then the owner's messages for as long as it is open.
  // Closing it does not stop the agent: it finishes what it and its subagents have in hand.
  let inputOpen = true;
  const closeInput = (why) => {
    if (!inputOpen) return;
    inputOpen = false;
    child.stdin.end();
    log(`run #${run.id}: no more messages for the agent (${why})`);
  };
  child.stdin.on('error', () => {
    inputOpen = false; // The agent is gone or never read its input.
  });
  child.stdin.write(inputLine(promptFor(run, opts)));
  if (!opts.allowPrompt) closeInput('this worker passes none on');
  const activity = createActivity();
  /** The owner's messages written to the agent and not read by it yet; read; never to be read. */
  const awaiting = new Set();
  const seen = new Set();
  const missed = new Set();
  /** Has the lead's turn ended with nothing started since? Then the agent is waiting for input. */
  let turnOver = false;
  let lastEventAt = Date.now();
  // The agent's own words (not its subagents'), for the SUMMARY line at the end.
  let output = '';
  const said = (text) => {
    output = `${output}\n${text}`.slice(-20000);
  };
  const keep = (chunk) => {
    said(chunk.toString());
    logFile.write(chunk);
  };
  const rawFile = createWriteStream(join(opts.logDir, `run-${run.id}.jsonl`), { flags: 'a' });
  rawFile.on('error', () => {});
  const agents = new Map();
  let step = '';
  let pending = '';
  child.stdout.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        keep(`${line}\n`); // not the stream (an older agent, or a stand-in): keep it as text
        continue;
      }
      rawFile.write(`${line}\n`);
      lastEventAt = Date.now();
      activity.apply(event);
      if (event.type === 'assistant' && !event.parent_tool_use_id) {
        turnOver = false;
        for (const part of event.message?.content ?? []) if (part.type === 'text') said(part.text);
      }
      if (event.type === 'result') {
        turnOver = true;
        if (typeof event.result === 'string') said(event.result);
      }
      const replayed = /^Owner message #(\d+)/.exec(replayedText(event));
      if (replayed && awaiting.delete(Number(replayed[1]))) {
        seen.add(Number(replayed[1]));
        turnOver = false;
        activity.note('owner', `message #${replayed[1]} read by the agent`);
        log(`run #${run.id}: the agent read the owner's message #${replayed[1]}`);
      }
      for (const text of describeEvent(event, agents)) {
        step = text;
        log(`run #${run.id}: ${text}`);
        logFile.write(`[${new Date().toISOString()}] ${text}\n`);
      }
    }
  });
  child.stderr.on('data', keep);
  log(`run #${run.id}: agent started (pid ${child.pid}), log ${logPath}`);
  if (child.pid) {
    agentGroup = child.pid;
    writeFileSync(pidFile(opts), JSON.stringify({ pgid: child.pid, agent: opts.agent, runId: run.id, worker: process.pid }));
  }

  let stopped = '';
  let exited = false;
  const stop = (why) => {
    // After the agent exited its pid may belong to another program: never signal it then.
    if (stopped || exited) return;
    stopped = why;
    log(`run #${run.id}: stopping the agent (${why})`);
    killGroup(child.pid, 'SIGTERM');
    setTimeout(() => {
      if (!exited) killGroup(child.pid, 'SIGKILL');
    }, 15000).unref();
  };
  current = stop;
  const deadline = setTimeout(() => stop(`no result after ${opts.maxMinutes} minutes`), opts.maxMinutes * 60000);
  // The panel shows the latest step as the run's summary until the final one replaces it, and
  // the activity report beside it. A heartbeat also brings the owner's new messages, so a worker
  // that passes them on asks every few seconds; one that does not asks only when it has news.
  let shown = '';
  let lastBeat = Date.now();
  let beating = false;
  /** Asked the hub for messages once more since the agent went idle, and got none. */
  let lastCall = false;
  /**
   * A hub from before the live view refuses a heartbeat as long as one with a report
   * (`bad_json`). Its heartbeats must still get through, or it fails the run as stale: after the
   * first refusal the worker reports to it without the activity.
   */
  let reports = true;
  const send = async (body) => {
    if (!reports) delete body.activity;
    try {
      return await client.rpc('feedback.admin.run', body);
    } catch (error) {
      if (!(error instanceof RpcError && error.code === 'bad_json' && body.activity)) throw error;
      reports = false;
      log(`run #${run.id}: this hub is older than the worker and takes no live report; the panel shows the latest step only`);
      delete body.activity;
      return client.rpc('feedback.admin.run', body);
    }
  };
  const tick = async () => {
    if (beating || exited) return;
    const progress = step && step !== shown ? `Working: ${step}` : '';
    const report = reports ? activity.take() : '';
    const idle = inputOpen && turnOver && awaiting.size === 0 && activity.working() === 0;
    const due = Date.now() - lastBeat >= opts.heartbeatMs;
    if (!progress && !report && !seen.size && !missed.size && !due && !inputOpen) return;
    beating = true;
    shown = step;
    lastBeat = Date.now();
    const body = { id: run.id, worker };
    if (progress) body.summary = progress;
    if (report) body.activity = report;
    const acked = { seen: [...seen], missed: [...missed] };
    if (acked.seen.length) body.seen = acked.seen;
    if (acked.missed.length) body.missed = acked.missed;
    try {
      const answer = await send(body);
      for (const id of acked.seen) seen.delete(id);
      for (const id of acked.missed) missed.delete(id);
      const messages = Array.isArray(answer?.messages) ? answer.messages : [];
      for (const message of messages) {
        if (inputOpen && !exited) {
          child.stdin.write(inputLine(ownerMessage(message)));
          awaiting.add(Number(message.id));
          log(`run #${run.id}: passed the owner's message #${message.id} to the agent`);
        } else {
          missed.add(Number(message.id));
          log(`run #${run.id}: the owner's message #${message.id} came too late for the agent`);
        }
      }
      // The agent has finished and nothing waits for it: one more ask for messages, then its
      // input closes and it exits. A message that arrives after that is reported as missed.
      if (messages.length) lastCall = false;
      else if (idle && inputOpen && turnOver && awaiting.size === 0 && activity.working() === 0) {
        if (lastCall) closeInput('the agent has finished');
        else lastCall = true;
      } else lastCall = false;
    } catch (error) {
      // Canceled in the panel, or failed as stale: someone else owns these notes now.
      if (error instanceof RpcError && error.code === 'not_running') stop('the run was canceled or taken over');
      else log(`run #${run.id}: heartbeat failed: ${error.message}`);
    } finally {
      beating = false;
    }
    // Should the count of working subagents ever be wrong, a silent stream settles it.
    if (inputOpen && turnOver && awaiting.size === 0 && Date.now() - lastEventAt > opts.idleCloseMs) closeInput(`nothing from the agent for ${Math.round(opts.idleCloseMs / 1000)} s after it finished`);
  };
  const beat = setInterval(() => void tick(), Math.min(opts.heartbeatMs, opts.tickMs));

  const code = await new Promise((done) => {
    child.on('error', (error) => {
      keep(Buffer.from(`\n${opts.agent} could not start: ${error.message}\n`));
      done(127);
    });
    // 'exit', not 'close': a tool the agent left behind may hold the pipes open.
    child.on('exit', (c, signal) => {
      // Stop what the agent left running, then let its pid go.
      killGroup(child.pid, 'SIGTERM');
      setTimeout(() => {
        killGroup(child.pid, 'SIGKILL');
        exited = true;
        done(c ?? (signal ? 143 : 1));
      }, 500);
    });
  });
  current = null;
  agentGroup = 0;
  inputOpen = false;
  rmSync(pidFile(opts), { force: true });
  clearInterval(beat);
  clearTimeout(deadline);
  activity.finish(code === 0);
  logFile.end();
  rawFile.end();
  if (stopped === 'the run was canceled or taken over') {
    log(`run #${run.id}: stopped, not reporting (${stopped})`);
    return;
  }
  const state = code === 0 && !stopped ? 'done' : 'failed';
  const summary = stopped ? `Stopped: ${stopped}. ${summaryOf(output, code)}` : summaryOf(output, code);
  try {
    // With the last report, so the panel keeps what each agent did, the pull requests and the cost.
    await send({ id: run.id, worker, state, summary: summary.slice(0, 1990), activity: JSON.stringify(activity.snapshot()), seen: [...seen], missed: [...missed, ...awaiting] });
  } catch (error) {
    log(`run #${run.id}: could not report ${state}: ${error.message}`);
  }
  log(`run #${run.id} ${state}: ${summary.split('\n')[0]}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const env = process.env;
  const config = feedbackConfig(env);
  const opts = {
    config,
    once: argv.includes('--once'),
    dryRun: argv.includes('--dry-run'),
    worker: workerName(env.FEEDBACK_WORKER_NAME ?? hostname()),
    pollMs: envNumber(env.FEEDBACK_POLL_SECONDS, 20, 5) * 1000,
    heartbeatMs: envNumber(env.FEEDBACK_HEARTBEAT_SECONDS, 60, 2) * 1000,
    maxMinutes: envNumber(env.FEEDBACK_MAX_MINUTES, 240, 5),
    prSyncMs: env.FEEDBACK_PR_SYNC_SECONDS === '0' ? 0 : envNumber(env.FEEDBACK_PR_SYNC_SECONDS, 30, 15) * 1000,
    agent: env.FEEDBACK_AGENT ?? 'claude',
    permissionMode: env.FEEDBACK_PERMISSION_MODE ?? 'auto',
    model: env.FEEDBACK_MODEL ?? '',
    allowPrompt: promptAllowed(env, config.base),
    // How often the worker reports and asks for the owner's messages, and how long a finished
    // agent may stay silent before its input is closed whatever the subagent count says.
    tickMs: envNumber(env.FEEDBACK_TICK_SECONDS, 5, 1) * 1000,
    idleCloseMs: envNumber(env.FEEDBACK_IDLE_CLOSE_SECONDS, 180, 10) * 1000,
    hubRoot,
    gamesDir: gamesDir(env),
    logDir: env.FEEDBACK_LOG_DIR ?? join(homedir(), '.feedback-worker'),
  };
  const client = feedbackClient(config);
  log(`feedback worker ${opts.worker} on ${config.base}, games in ${opts.gamesDir}${opts.dryRun ? ' (dry run)' : ''}`);
  if (!opts.allowPrompt) log('prompts typed beside Check are refused: this hub is on another computer and FEEDBACK_ALLOW_PROMPT is not 1');
  mkdirSync(opts.logDir, { recursive: true });
  const other = takeWorkerLock(opts);
  if (other) {
    console.error(`Another feedback worker is already running (pid ${other}). One per machine is enough.`);
    process.exit(1);
  }
  const leftover = opts.dryRun ? 0 : await stopLeftoverAgent(opts);
  if (leftover) {
    // Close that run now instead of leaving it to the 30-minute stale check.
    await client
      .rpc('feedback.admin.run', { id: leftover, worker: opts.worker, state: 'failed', summary: 'The worker stopped before the agent finished. Press Check to start again.' })
      .then(() => log(`run #${leftover} reported failed (the last worker stopped mid-run)`))
      .catch(() => {});
  }
  // Ctrl-C, a closed terminal or a service stop: stop the agent, report the run failed, exit.
  // A second signal does not wait: it kills the agent's group at once.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (quitting) process.exit(130);
      quitting = true;
      if (current) current('the worker was stopped');
      else process.exit(0);
    });
  }
  // Any other way out (a crash, process.exit above): never leave the agent running behind us.
  process.on('exit', () => {
    if (agentGroup) killGroup(agentGroup, 'SIGKILL');
    releaseWorkerLock(opts);
  });
  if (opts.prSyncMs) {
    // Beside the runs, never blocked by one: a merge shows in the panel within a sync.
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const prs = await syncPullRequests(client);
        if (prs.length) log(`pull requests: ${prs.map((p) => `${p.url.replace('https://github.com/', '')} ${p.state}`).join(', ')}`);
      } catch (error) {
        log(`pull request sync failed: ${error.message}`);
      } finally {
        syncing = false;
      }
    };
    await sync();
    setInterval(sync, opts.prSyncMs).unref();
  }
  for (;;) {
    let run = null;
    try {
      run = (await client.rpc('feedback.admin.claim', { worker: opts.worker, v: WORKER_VERSION, prompts: opts.allowPrompt })).run;
    } catch (error) {
      log(`claim failed: ${error.message}`);
    }
    if (run) await work(run, client, opts);
    if (opts.once || quitting) return;
    await sleep(opts.pollMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
}
