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
//   HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-worker.mjs
//   ... --once        claim at most one run, work it, exit
//   ... --dry-run     claim and finish runs without starting the agent (to test the wiring)
//
// FEEDBACK_WORKER_NAME (default the host name), FEEDBACK_POLL_SECONDS (20), FEEDBACK_HEARTBEAT_SECONDS (60),
// FEEDBACK_MAX_MINUTES (240), FEEDBACK_AGENT (claude), FEEDBACK_PERMISSION_MODE (auto),
// FEEDBACK_GAMES_DIR (the folder that holds metaverse-hub and the game repos),
// FEEDBACK_LOG_DIR (~/.feedback-worker). The login is the panel's (see feedback-rpc.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackClient, feedbackConfig, RpcError } from './feedback-rpc.mjs';

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
 * The run summary for the panel: the agent's last "SUMMARY:" line and what follows it, else the
 * tail of its output. At most 1,900 characters (the server keeps 2,000).
 */
export function summaryOf(output, code) {
  const text = String(output ?? '').replace(/\r/g, '');
  const at = text.lastIndexOf('SUMMARY:');
  let summary = at >= 0 ? text.slice(at + 'SUMMARY:'.length) : text.slice(-600);
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

/** The prompt for one run: the playbook plus this run's facts. */
export function promptFor(run, ctx) {
  const playbook = readFileSync(join(ctx.hubRoot, 'docs', 'feedback-check.md'), 'utf8');
  return [
    playbook,
    '',
    '## This run',
    '',
    `- Check run: #${run.id}, asked by ${run.requestedBy} at ${run.requestedAt}, ${run.noteCount} notes not resolved when asked.`,
    `- Games folder (your working directory): ${ctx.gamesDir}`,
    `- Admin CLI: node ${join(ctx.hubRoot, 'scripts', 'feedback-admin.mjs')} (HUB_URL and the login are already in your environment).`,
    `- Branch slug for every repo you change: feedback-check-${run.id}`,
    '',
    'Work the notes now, following the playbook above. End with the SUMMARY line.',
  ].join('\n');
}

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops the agent and everything it started; quiet when the group is already gone. */
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already exited.
  }
}

/** Stops the agent of the run in hand, if any (set while a run is worked). */
let current = null;
let quitting = false;

async function work(run, client, opts) {
  const { worker } = opts;
  log(`run #${run.id} claimed (${run.noteCount} notes)`);
  if (opts.dryRun) {
    await client.rpc('feedback.admin.run', { id: run.id, worker, state: 'done', summary: 'Dry run: the worker claimed this run and did not start the agent.' });
    log(`run #${run.id} finished (dry run)`);
    return;
  }

  mkdirSync(opts.logDir, { recursive: true });
  const logPath = join(opts.logDir, `run-${run.id}.log`);
  const logFile = createWriteStream(logPath, { flags: 'a' });
  const args = ['-p', promptFor(run, opts), '--permission-mode', opts.permissionMode, '--add-dir', opts.hubRoot];
  const child = spawn(opts.agent, args, {
    cwd: opts.gamesDir,
    env: { ...process.env, FEEDBACK_RUN_ID: String(run.id), HUB_URL: opts.config.base, NAKAMA_SERVER_KEY: opts.config.serverKey },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops the shells and tools it started.
    detached: true,
  });
  let output = '';
  const keep = (chunk) => {
    output = (output + chunk.toString()).slice(-20000);
    logFile.write(chunk);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  log(`run #${run.id}: agent started (pid ${child.pid}), log ${logPath}`);

  let stopped = '';
  const stop = (why) => {
    if (stopped) return;
    stopped = why;
    log(`run #${run.id}: stopping the agent (${why})`);
    killGroup(child, 'SIGTERM');
    setTimeout(() => killGroup(child, 'SIGKILL'), 15000).unref();
  };
  current = stop;
  const deadline = setTimeout(() => stop(`no result after ${opts.maxMinutes} minutes`), opts.maxMinutes * 60000);
  const beat = setInterval(() => {
    client.rpc('feedback.admin.run', { id: run.id, worker }).catch((error) => {
      // Canceled in the panel, or failed as stale: someone else owns these notes now.
      if (error instanceof RpcError && error.code === 'not_running') stop('the run was canceled or taken over');
      else log(`run #${run.id}: heartbeat failed: ${error.message}`);
    });
  }, opts.heartbeatMs);

  const code = await new Promise((done) => {
    child.on('error', (error) => {
      keep(Buffer.from(`\n${opts.agent} could not start: ${error.message}\n`));
      done(127);
    });
    // 'exit', not 'close': a tool the agent left behind may hold the pipes open.
    child.on('exit', (c, signal) => {
      killGroup(child, 'SIGTERM');
      setTimeout(() => done(c ?? (signal ? 143 : 1)), 500);
    });
  });
  current = null;
  clearInterval(beat);
  clearTimeout(deadline);
  logFile.end();
  if (stopped === 'the run was canceled or taken over') {
    log(`run #${run.id}: stopped, not reporting (${stopped})`);
    return;
  }
  const state = code === 0 && !stopped ? 'done' : 'failed';
  const summary = stopped ? `Stopped: ${stopped}. ${summaryOf(output, code)}` : summaryOf(output, code);
  try {
    await client.rpc('feedback.admin.run', { id: run.id, worker, state, summary: summary.slice(0, 1990) });
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
    pollMs: Math.max(5, Number(env.FEEDBACK_POLL_SECONDS ?? 20)) * 1000,
    heartbeatMs: Math.max(2, Number(env.FEEDBACK_HEARTBEAT_SECONDS ?? 60)) * 1000,
    maxMinutes: Math.max(5, Number(env.FEEDBACK_MAX_MINUTES ?? 240)),
    agent: env.FEEDBACK_AGENT ?? 'claude',
    permissionMode: env.FEEDBACK_PERMISSION_MODE ?? 'auto',
    hubRoot,
    gamesDir: gamesDir(env),
    logDir: env.FEEDBACK_LOG_DIR ?? join(homedir(), '.feedback-worker'),
  };
  const client = feedbackClient(config);
  log(`feedback worker ${opts.worker} on ${config.base}, games in ${opts.gamesDir}${opts.dryRun ? ' (dry run)' : ''}`);
  // Ctrl-C or a service stop: stop the agent, report the run failed, then exit.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (quitting) process.exit(130);
      quitting = true;
      if (current) current('the worker was stopped');
      else process.exit(0);
    });
  }
  for (;;) {
    let run = null;
    try {
      run = (await client.rpc('feedback.admin.claim', { worker: opts.worker })).run;
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
