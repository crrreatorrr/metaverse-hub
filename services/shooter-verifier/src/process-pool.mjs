import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INPUT_BYTES, OUTPUT_BYTES, operational } from './replay.mjs';

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const within = (v, low, high) => Number.isSafeInteger(v) && v >= low && v <= high;
// Coordinator holds no simulator state. Only bounded JSON strings cross IPC.
export class ReplayPool {
  constructor({ size = 1, queue = 4, wallMs = 20000 } = {}) {
    if (!within(size, 1, 4) || !within(queue, 0, 16) || !within(wallMs, 100, 20000)) throw new Error('bad_pool_limits');
    this.size = size; this.queueLimit = queue; this.wallMs = wallMs;
    this.waiting = []; this.slots = []; this.closed = false;
    this.completed=0;this.failures=0;this.processStarts=0;this.lastMetrics=null;
    for (let i = 0; i < size; i++) this.start(i);
  }
  start(index) {
    if (this.closed) return;
    this.processStarts++;
    const child = spawn('/usr/bin/prlimit', ['--cpu=120:120', '--nofile=64:64', '--', process.execPath,
      '--max-old-space-size=192', '--disable-proto=throw', worker], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
    });
    const slot = { child, ready: false, task: null, jobs: 0, dead: false };
    this.slots[index] = slot;
    slot.timer = setTimeout(() => this.fail(slot, 'worker_start_timeout'), 5000);
    child.on('error', () => this.fail(slot, 'worker_unavailable'));
    child.on('exit', () => this.fail(slot, 'worker_crash'));
    child.on('message', (message) => {
      if (slot.dead) return;
      if (message?.type === 'ready' && !slot.ready && !slot.task) {
        clearTimeout(slot.timer); slot.ready = true; this.dispatch(); return;
      }
      if (message?.type === 'unavailable') { this.fail(slot, 'artifact_unavailable'); return; }
      if (message?.type !== 'result' || !slot.task || typeof message.text !== 'string'
        || Buffer.byteLength(message.text) > OUTPUT_BYTES) { this.fail(slot, 'worker_protocol_failure'); return; }
      let result;
      try { result = JSON.parse(message.text); } catch { this.fail(slot, 'worker_protocol_failure'); return; }
      clearTimeout(slot.timer);
      this.completed++;
      const m=message.metrics;
      if(m&&['cpuUserMicros','cpuSystemMicros','wallMs','rssBytes','heapUsedBytes'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])&&m[k]>=0&&m[k]<=Number.MAX_SAFE_INTEGER)) this.lastMetrics={cpuUserMicros:m.cpuUserMicros,cpuSystemMicros:m.cpuSystemMicros,wallMs:m.wallMs,rssBytes:m.rssBytes,heapUsedBytes:m.heapUsedBytes,finishedAt:typeof m.finishedAt==='number'&&Number.isFinite(m.finishedAt)?m.finishedAt:null};
      const task = slot.task; slot.task = null; slot.jobs++;
      task.resolve(result);
      if (slot.jobs >= 16) { slot.dead = true; child.kill('SIGKILL'); this.start(index); }
      this.dispatch();
    });
  }
  fail(slot, reason) {
    if (slot.dead) return;
    slot.dead = true; this.failures++; clearTimeout(slot.timer); slot.child.kill('SIGKILL');
    slot.task?.resolve(operational(reason)); slot.task = null;
    // No unbounded restart/crash loop. A new pool is an explicit coordinator
    // recovery action; queued callers receive an operational response.
    if (this.slots.every((s) => s.dead)) {
      for (const task of this.waiting.splice(0)) task.resolve(operational(reason));
    } else this.dispatch();
  }
  dispatch() {
    for (const slot of this.slots) {
      if (!slot.ready || slot.dead || slot.task || !this.waiting.length) continue;
      const task = this.waiting.shift(); slot.task = task;
      slot.timer = setTimeout(() => this.fail(slot, 'execution_timeout'), this.wallMs);
      slot.child.send({ type: 'replay', text: task.text }, (error) => { if (error) this.fail(slot, 'worker_crash'); });
    }
  }
  execute(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > INPUT_BYTES) return Promise.resolve(operational('request_oversized'));
    if (this.closed) return Promise.resolve(operational('pool_closed'));
    if (this.slots.every((s) => s.dead)) return Promise.resolve(operational('worker_unavailable'));
    const available = this.slots.filter((s) => !s.dead && !s.task).length;
    if (this.waiting.length >= this.queueLimit + available) return Promise.resolve(operational('queue_full'));
    return new Promise((resolve) => { this.waiting.push({ text, resolve }); this.dispatch(); });
  }
  stats() {return{completed:this.completed,operationalFailures:this.failures,processStarts:this.processStarts,lastExecution:this.lastMetrics};}
  close() {
    this.closed = true;
    for (const task of this.waiting.splice(0)) task.resolve(operational('pool_closed'));
    for (const slot of this.slots) {
      slot.dead = true; clearTimeout(slot.timer); slot.task?.resolve(operational('pool_closed'));
      slot.task = null; slot.child.kill('SIGKILL');
    }
  }
}
