// Dev only: lets the feedback admin panel (/admin/) see, start and stop the feedback worker
// (scripts/feedback-worker.mjs, docs/feedback.md "Check") on this computer.
//
// The dev server runs on the owner's machine, so it can start the worker there. The worker runs
// detached, writes to <log dir>/worker.log and outlives a dev-server restart. Its own lock file
// (<log dir>/worker.pid) says whether one runs, wherever it was started, and keeps it to one.
// Production serves /admin/ from Caddy, which has none of this: the panel then shows how to
// start the worker by hand.
//
//   GET  /__feedback/worker         → {available, running, pid, log}
//   POST /__feedback/worker/start   → starts it unless one runs
//   POST /__feedback/worker/stop    → stops it (the worker stops its agent and reports the run)
//
// POSTs must carry `X-Feedback-Worker: 1` and come from the dev server's own origin, so another
// site open in the browser cannot start or stop it.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface WorkerStatus {
  available: true;
  running: boolean;
  pid: number | null;
  log: string;
}

export interface WorkerControlOptions {
  repoRoot: string;
  logDir: string;
  hubUrl: string;
  isAlive?: (pid: number) => boolean;
  startProcess?: (logFile: string) => void;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The last `lines` lines of a file, reading at most its last 32 KB. */
export function tail(file: string, lines = 40): string {
  try {
    const size = statSync(file).size;
    const length = Math.min(size, 32768);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    return buffer.toString('utf8').split('\n').slice(-lines - 1).join('\n').trimEnd();
  } catch {
    return '';
  }
}

export function workerControl(opts: WorkerControlOptions) {
  const isAlive = opts.isAlive ?? alive;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const signal = opts.signal ?? ((pid: number, sig: NodeJS.Signals) => process.kill(pid, sig));
  const logFile = join(opts.logDir, 'worker.log');
  const startProcess =
    opts.startProcess ??
    ((file: string) => {
      const fd = openSync(file, 'a');
      try {
        const child = spawn(process.execPath, [join(opts.repoRoot, 'scripts', 'feedback-worker.mjs')], {
          cwd: opts.repoRoot,
          env: { ...process.env, HUB_URL: opts.hubUrl, FEEDBACK_LOG_DIR: opts.logDir },
          detached: true,
          stdio: ['ignore', fd, fd],
        });
        child.unref();
      } finally {
        closeSync(fd);
      }
    });

  const runningPid = (): number | null => {
    try {
      const pid = Number(readFileSync(join(opts.logDir, 'worker.pid'), 'utf8'));
      return pid > 1 && isAlive(pid) ? pid : null;
    } catch {
      return null;
    }
  };

  const status = (): WorkerStatus => {
    const pid = runningPid();
    return { available: true, running: pid !== null, pid, log: tail(logFile) };
  };

  return {
    status,
    /** Starts the worker unless one runs, then waits up to 5 s for it to take its lock. */
    async start(): Promise<WorkerStatus> {
      if (runningPid() !== null) return status();
      mkdirSync(opts.logDir, { recursive: true });
      startProcess(logFile);
      for (let i = 0; i < 50 && runningPid() === null; i++) await sleep(100);
      return status();
    },
    /** Asks the worker to stop (it stops its agent and reports the run) and waits up to 20 s. */
    async stop(): Promise<WorkerStatus> {
      const pid = runningPid();
      if (pid === null) return status();
      signal(pid, 'SIGTERM');
      for (let i = 0; i < 200 && isAlive(pid); i++) await sleep(100);
      return status();
    },
  };
}

/** A POST the panel itself sent: the custom header and, when the browser sends one, our origin. */
export function trustedPost(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  if (req.method !== 'POST' || req.headers['x-feedback-worker'] !== '1') return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host}`;
}

export function feedbackWorkerDev(hubUrl: string): Plugin {
  return {
    name: 'feedback-worker-dev',
    apply: 'serve',
    configureServer(server) {
      const control = workerControl({
        repoRoot: resolve(__dirname, '..', '..'),
        logDir: process.env.FEEDBACK_LOG_DIR ?? join(homedir(), '.feedback-worker'),
        hubUrl,
      });
      const send = (res: ServerResponse, code: number, body: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      server.middlewares.use('/__feedback/worker', (req: IncomingMessage, res: ServerResponse) => {
        const action = (req.url ?? '/').split('?')[0];
        if (req.method === 'GET' && (action === '/' || action === '')) return send(res, 200, control.status());
        if (!trustedPost(req)) return send(res, 403, { error: 'forbidden' });
        const run = action === '/start' ? control.start() : action === '/stop' ? control.stop() : null;
        if (!run) return send(res, 404, { error: 'not_found' });
        run.then(
          (status) => send(res, 200, status),
          (error: unknown) => send(res, 500, { error: String((error as Error)?.message ?? error) }),
        );
      });
    },
  };
}
