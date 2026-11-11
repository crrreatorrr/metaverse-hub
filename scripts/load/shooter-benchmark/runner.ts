import { performance } from 'node:perf_hooks';
import { sha256, summarizeActors, validatePlan, type ActorResult, type Assignment, type Phase, type Plan } from './contracts.ts';

export class OperationFailure extends Error {
  constructor(readonly reason: string) {
    super('benchmark operation failed');
    if (!/^[a-z0-9_:.|-]{1,80}$/.test(reason)) throw new Error('unsafe operation reason');
  }
}
export class InstrumentationFailure extends Error {
  constructor(readonly reason: string) { super('benchmark instrumentation failed'); if (!/^[a-z0-9_:.|-]{1,80}$/.test(reason)) throw new Error('unsafe instrumentation reason'); }
}
export class SutUnavailable extends OperationFailure {}
export interface Binding {
  // Derive these from actual independently authenticated server IDs.
  accountBindingHash: string;
  sessionBindingHash: string;
  runBindingHash: string;
}
export type SubmissionProgress = Pick<ActorResult, 'submittedInputSha256' | 'submittedHashMeaning' | 'submittedFrames' | 'acceptedTick' | 'verifiedTick' | 'durablyVerified' | 'payable' | 'everObservedEligible'>;
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
  // Preserve full source frames and same-body/RID retries; do not substitute an
  // in-process simulator or synthetic success oracle for the actual pipeline.
  execute(binding: Binding, assignment: Assignment, phase: Phase, signal: AbortSignal, progress: (value: SubmissionProgress) => void): Promise<Execution>;
  startBackground(signal: AbortSignal): Promise<void>;
  stopBackground(): Promise<void>;
  observe(signal: AbortSignal): Promise<void>;
}
export interface RunResult {
  actors: ActorResult[];
  summary: Record<string, unknown>;
  elapsedMs: number;
  startedMonoMs: number;
  harnessStatus: 'complete' | 'failed' | 'interrupted';
  assignmentSha256: string;
  observations: { elapsedMs: number; ok: boolean; category: 'observed' | 'sut_unavailable' | 'instrumentation_failure'; rawReason: string | null }[];
  arrivals: { phase: Phase['kind']; wave: number; plannedElapsedMs: number; actualElapsedMs: number; lagMs: number }[];
  observerFailures: number;
  instrumentationObserverFailures: number;
}
const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error('aborted')); return; }
  const done = () => { signal.removeEventListener('abort', abort); resolve(); };
  const timeout = setTimeout(done, ms);
  const abort = () => { clearTimeout(timeout); reject(new Error('aborted')); };
  signal.addEventListener('abort', abort, { once: true });
});
// Enforce the harness deadline even if an adapter accidentally ignores its
// signal. Adapter cleanup remains responsible for closing its own resources.
function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('aborted'));
    if (signal.aborted) { operation.catch(() => undefined); reject(new Error('aborted')); return; }
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function runPlan(plan: Plan, adapter: CampaignAdapter, externalSignal?: AbortSignal): Promise<RunResult> {
  validatePlan(plan);
  if (adapter.mode !== plan.mode) throw new Error('adapter mode differs from plan');
  const controller = new AbortController(), observerController = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  const timeout = setTimeout(abort, plan.maxDurationMs);
  const signal = controller.signal, start = performance.now();
  let accountingOpen = true;
  const allWork: Promise<void>[] = [];
  const actors: ActorResult[] = [], observations: RunResult['observations'] = [], arrivals: RunResult['arrivals'] = [];
  let observerFailures = 0, instrumentationObserverFailures = 0, harnessStatus: RunResult['harnessStatus'] = 'complete', wave = 0;
  const observationSignal = AbortSignal.any([signal, observerController.signal]);
  // Nonoverlapping samples include startup, preparation, full replay and drain.
  // Each read has a separate5s bound; no growing timer/promise backlog.
  const observationLoop = (async () => {
    while (!observationSignal.aborted) {
      let ok = true, category: RunResult['observations'][number]['category'] = 'observed', rawReason: string | null = null;
      try { const sampleSignal = AbortSignal.any([observationSignal, AbortSignal.timeout(5000)]); await bounded(adapter.observe(sampleSignal), sampleSignal); }
      catch (error) {
        if (observationSignal.aborted) break; ok = false; observerFailures++;
        category = error instanceof SutUnavailable ? 'sut_unavailable' : 'instrumentation_failure';
        rawReason = error instanceof OperationFailure || error instanceof InstrumentationFailure ? error.reason : 'unclassified_observer_exception';
        if (category === 'instrumentation_failure') instrumentationObserverFailures++;
      }
      observations.push({ elapsedMs: performance.now() - start, ok, category, rawReason });
      try { await sleep(1000, observationSignal); } catch { break; }
    }
  })();
  try {
    await bounded(adapter.startBackground(signal), signal);
    for (const phase of plan.phases) {
      if (signal.aborted) throw new Error('aborted');
      if (!phase.waves) { await sleep(phase.arrivalIntervalMs, signal); continue; }
      // Prepare this bounded phase before its arrival clock starts. Independent
      // bindings are checked before any finish/replay/credit; actual arrivals and
      // lag remain recorded rather than assuming perfect scheduling.
      const prepared: { wave: number; bindings: Binding[]; pending: ActorResult[] }[] = [];
      for (let i = 0; i < phase.waves; i++, wave++) {
        const waveNumber = wave;
        const bindings = await bounded(Promise.all(plan.assignments.map(a => adapter.prepare(a, waveNumber, signal))), signal);
        const pending = bindings.map((binding, actor): ActorResult => ({ ...binding, wave: waveNumber, actor, caseId: plan.assignments[actor].caseId, sourceInputSha256: plan.assignments[actor].inputSha256, sourceFrames: plan.assignments[actor].frames, submittedInputSha256: null, submittedHashMeaning: null, submittedFrames: 0, acceptedTick: 0, verifiedTick: 0, status: 'not_started', rawReason: null, attempted: false, durablyVerified: false, payable: false, everObservedEligible: false, paid: false }));
        summarizeActors([...actors, ...pending]);
        actors.push(...pending); prepared.push({ wave: waveNumber, bindings, pending });
      }
      const phaseWork: Promise<void>[] = [], phaseStart = performance.now();
      for (let i = 0; i < prepared.length; i++) {
        const target = phaseStart + i * phase.arrivalIntervalMs;
        while (performance.now() < target) await sleep(Math.max(1, Math.ceil(target - performance.now())), signal);
        const actual = performance.now();
        arrivals.push({ phase: phase.kind, wave: prepared[i].wave, plannedElapsedMs: target - start, actualElapsedMs: actual - start, lagMs: Math.max(0, actual - target) });
        const { pending, bindings } = prepared[i];
        const work = Promise.all(pending.map(async (record, actor) => {
          record.attempted = true;
          try { const execution = await bounded(adapter.execute(bindings[actor], plan.assignments[actor], phase, signal, update => {
            if (!accountingOpen || signal.aborted) return;
            if (record.everObservedEligible) update = { ...update, everObservedEligible: true };
            if (record.durablyVerified && update.submittedFrames === record.submittedFrames) update = { ...update, durablyVerified: true };
            if (update.submittedFrames < record.submittedFrames || update.acceptedTick < record.acceptedTick || update.verifiedTick < record.verifiedTick) throw new InstrumentationFailure('cursor_regression');
            summarizeActors([{ ...record, ...update }]); Object.assign(record, update);
          }), signal);
            const everObservedEligible = record.everObservedEligible || execution.payable || execution.paid;
            const durablyVerified = record.durablyVerified || execution.durablyVerified;
            Object.assign(record, execution, { everObservedEligible, durablyVerified });
          }
          catch (error) { if (!signal.aborted && !(error instanceof OperationFailure)) harnessStatus = 'failed'; record.status = signal.aborted ? 'censored' : 'operational_failure'; record.rawReason = signal.aborted ? 'harness_deadline_or_shutdown' : error instanceof OperationFailure || error instanceof InstrumentationFailure ? error.reason : 'adapter_exception_redacted'; }
        })).then(() => undefined);
        phaseWork.push(work); allWork.push(work);
      }
      await Promise.all(phaseWork);
    }
  } catch { harnessStatus = signal.aborted ? 'interrupted' : 'failed'; }
  finally {
    accountingOpen = false;
    if (signal.aborted && harnessStatus === 'complete') harnessStatus = 'interrupted';
    clearTimeout(timeout); controller.abort(); observerController.abort();
    externalSignal?.removeEventListener('abort', abort);
    await Promise.allSettled(allWork);
    await observationLoop;
    try { await bounded(adapter.stopBackground(), AbortSignal.timeout(5000)); } catch { harnessStatus = 'failed'; }
  }
  for (const actor of actors) if (actor.attempted && actor.status === 'not_started') { actor.status = 'censored'; actor.rawReason = 'harness_interrupted'; }
  const expected = plan.phases.reduce((n, p) => n + p.waves * 20, 0);
  if (actors.length !== expected || instrumentationObserverFailures) harnessStatus = 'failed';
  return { actors, summary: { ...summarizeActors(actors), plannedActors: expected, accountedActors: actors.length, unboundActors: expected - actors.length, unstartedActors: expected - actors.filter(a => a.attempted).length, observerAttempts: observations.length, observerSuccessful: observations.filter(o => o.ok).length, observerUnavailable: observations.filter(o => o.category === 'sut_unavailable').length, observerInstrumentationFailures: instrumentationObserverFailures }, elapsedMs: performance.now() - start, startedMonoMs: start, harnessStatus, assignmentSha256: sha256(JSON.stringify(plan.assignments)), observations, arrivals, observerFailures, instrumentationObserverFailures };
}
