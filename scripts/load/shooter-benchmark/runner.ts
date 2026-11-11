import { performance } from 'node:perf_hooks';
import { sha256, summarizeActors, validatePlan, type ActorResult, type Assignment, type Phase, type Plan } from './contracts.ts';

export interface Binding {
  // These hashes must derive from actual independently authenticated server IDs.
  accountBindingHash: string;
  sessionBindingHash: string;
  runBindingHash: string;
}
export interface Execution {
  status: ActorResult['status'];
  rawReason: string | null;
  durablyVerified: boolean;
  payable: boolean;
  paid: boolean;
}
export interface CampaignAdapter {
  readonly mode: Plan['mode'];
  prepare(assignment: Assignment, wave: number, signal: AbortSignal): Promise<Binding>;
  // Adapter must preserve source frames and same-body/RID retry identity. This is
  // a full operation, not an in-process simulator or synthetic success oracle.
  execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal): Promise<Execution>;
  startBackground(signal: AbortSignal): Promise<void>;
  stopBackground(): Promise<void>;
  observe(signal: AbortSignal): Promise<void>;
}
export interface RunResult {
  actors: ActorResult[];
  summary: Record<string, unknown>;
  elapsedMs: number;
  harnessStatus: 'complete' | 'failed' | 'interrupted';
  assignmentSha256: string;
  observerFailures: number;
}
const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error('aborted')); return; }
  const done = () => { signal.removeEventListener('abort', abort); resolve(); };
  const timeout = setTimeout(done, ms);
  const abort = () => { clearTimeout(timeout); reject(new Error('aborted')); };
  signal.addEventListener('abort', abort, { once: true });
});
export async function runPlan(plan: Plan, adapter: CampaignAdapter, externalSignal?: AbortSignal): Promise<RunResult> {
  validatePlan(plan);
  if (adapter.mode !== plan.mode) throw new Error('adapter mode differs from plan');
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timeout = setTimeout(abort, plan.maxDurationMs);
  const signal = controller.signal, start = performance.now();
  const actors: ActorResult[] = [];
  let observerFailures = 0, harnessStatus: RunResult['harnessStatus'] = 'complete', wave = 0;
  // Prepare every binding before a wave starts; preparation is not a finish
  // barrier substitute. If authentication fails the harness fails, never makes
  // up user/session/run IDs or reports the cohort as 20 completed actors.
  try {
    await adapter.startBackground(signal);
    for (const phase of plan.phases) {
      if (signal.aborted) throw new Error('aborted');
      if (!phase.waves) { await sleep(phase.arrivalIntervalMs, signal); continue; }
      const phaseWork: Promise<void>[] = [];
      const phaseStart = performance.now();
      for (let i = 0; i < phase.waves; i++, wave++) {
        const waitMs = phaseStart + i * phase.arrivalIntervalMs - performance.now();
        if (waitMs > 0) await sleep(waitMs, signal);
        const waveNumber = wave;
        const bindings = await Promise.all(plan.assignments.map(a => adapter.prepare(a, waveNumber, signal)));
        // Validate actual binding uniqueness BEFORE expensive replay/credit. The
        // all-actor check also rejects reuse between waves and phases.
        const pending = bindings.map((binding, actor): ActorResult => ({ ...binding, wave: waveNumber, actor, caseId: plan.assignments[actor].caseId, inputSha256: plan.assignments[actor].inputSha256, frames: plan.assignments[actor].frames, status: 'not_started', rawReason: null, attempted: false, durablyVerified: false, payable: false, paid: false }));
        summarizeActors([...actors, ...pending]);
        actors.push(...pending);
        phaseWork.push(Promise.all(pending.map(async (record, actor) => {
          record.attempted = true;
          try { Object.assign(record, await adapter.execute(bindings[actor], plan.assignments[actor], phase, signal)); }
          catch { record.status = signal.aborted ? 'censored' : 'operational_failure'; record.rawReason = signal.aborted ? 'harness_deadline_or_shutdown' : 'adapter_exception_redacted'; }
        })).then(() => undefined));
        // Launch sustained waves at their declared arrivals, while prior waves
        // remain active; completion-paced arrivals would hide queue growth.
        try { await adapter.observe(signal); } catch { observerFailures++; }
      }
      await Promise.all(phaseWork);
    }
  } catch { harnessStatus = signal.aborted ? 'interrupted' : 'failed'; }
  finally {
    clearTimeout(timeout); externalSignal?.removeEventListener('abort', abort);
    try { await adapter.stopBackground(); } catch { harnessStatus = 'failed'; }
  }
  // Missing waves are explicit incomplete coverage. No throughput/capacity
  // conclusion is derived by this runner; caller reconciles planned actor count.
  const expected = plan.phases.reduce((n, p) => n + p.waves * 20, 0);
  if (actors.length !== expected || observerFailures) harnessStatus = 'failed';
  return { actors, summary: { ...summarizeActors(actors), plannedActors: expected, accountedActors: actors.length, unstartedActors: expected - actors.length }, elapsedMs: performance.now() - start, harnessStatus, assignmentSha256: sha256(JSON.stringify(plan.assignments)), observerFailures };
}
