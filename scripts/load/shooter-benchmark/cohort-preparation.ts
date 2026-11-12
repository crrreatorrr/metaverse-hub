import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Phase } from './contracts.ts';

export const PREPARATION_CONCURRENCY = 2;
const MAX_COHORTS = 6, ACTORS_PER_COHORT = 20;
const phases: Phase['kind'][] = ['background_baseline','finish_burst','cold_burst','warm_burst','retry_storm','sustained','drain'];
type Outcome = 'not_started' | 'pending' | 'prepared' | 'failed' | 'censored';
type CohortOutcome = 'pending' | 'prepared' | 'failed' | 'aborted' | 'measurement_closed';
interface ActorPreparation {
  actor: number; startedMonoMs: number | null; finishedMonoMs: number | null; censoredAtMonoMs: number | null; outcome: Outcome;
}
interface CohortEvidence {
  phase: Phase['kind']; wave: number; startedMonoMs: number; settledMonoMs: number | null; outcome: CohortOutcome;
  concurrencyLimit: 2; maximumInFlight: number; inFlightAtSettlement: number;
  counts: { started: number; prepared: number; failed: number; censored: number; notStarted: number };
  processCpu: { scope: string; userMicros: number | null; systemMicros: number | null; unavailableReason: 'unavailable' | null };
  schedulingDelay: { scope: string; resolutionMs: 20; sampleCount: number; meanMs: number | null; p95Ms: number | null; maxMs: number | null; unavailableReason: 'no_samples' | 'unavailable' | null };
  actors: ActorPreparation[];
}
export interface PreparationEvidence {
  version: 1; observer: 'bounded_trusted_fixture_preparation'; clockDomain: 'same_load_generator_node_performance';
  scope: string; concurrencyLimit: 2; closedMonoMs: number; cohorts: readonly CohortEvidence[];
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

// Limits only synthetic fixture provisioning. No campaign execution, observer
// signal, live metrics limit or phase-arrival clock is changed by this queue.
export class CohortPreparation {
  private readonly cohorts: CohortEvidence[] = [];
  private readonly stops = new Set<() => void>();
  private closed: PreparationEvidence | null = null;
  private halted = false;

  prepare<T, R>(items: readonly T[], operation: (item: T, index: number) => Promise<R>, meta: { phase: Phase['kind']; wave: number; signal: AbortSignal }): Promise<R[]> {
    if (this.closed || this.halted || this.stops.size || this.cohorts.length >= MAX_COHORTS || items.length !== ACTORS_PER_COHORT
      || !phases.includes(meta.phase) || !Number.isSafeInteger(meta.wave) || meta.wave < 0 || meta.wave >= MAX_COHORTS) return Promise.reject(new Error('cohort_preparation_bounds'));
    const row: CohortEvidence = { phase: meta.phase, wave: meta.wave, startedMonoMs: performance.now(), settledMonoMs: null, outcome: 'pending',
      concurrencyLimit: PREPARATION_CONCURRENCY, maximumInFlight: 0, inFlightAtSettlement: 0,
      counts: { started: 0, prepared: 0, failed: 0, censored: 0, notStarted: ACTORS_PER_COHORT },
      processCpu: { scope: 'whole_load_generator_process_during_cohort_interval; includes_other_activity; not_preparation_CPU_attribution', userMicros: null, systemMicros: null, unavailableReason: 'unavailable' },
      schedulingDelay: { scope: 'Node_monitorEventLoopDelay_scheduling_interval; includes20ms_resolution_baseline; not_CPU_attribution', resolutionMs: 20, sampleCount: 0, meanMs: null, p95Ms: null, maxMs: null, unavailableReason: 'unavailable' },
      actors: items.map((_, actor) => ({ actor, startedMonoMs: null, finishedMonoMs: null, censoredAtMonoMs: null, outcome: 'not_started' })) };
    this.cohorts.push(row);
    let cpu: NodeJS.CpuUsage | null = null, histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
    try { cpu = process.cpuUsage(); } catch { /* Observation is optional; no raw error. */ }
    try { histogram = monitorEventLoopDelay({ resolution: 20 }); histogram.enable(); } catch { /* Optional scheduling evidence. */ }
    let next = 0, inFlight = 0, actualInFlight = 0, completed = 0, stopped = false;
    const values: R[] = new Array(items.length);
    return new Promise<R[]>((resolve, reject) => {
      const finish = (outcome: CohortOutcome, error?: unknown) => {
        if (stopped) return;
        stopped = true; meta.signal.removeEventListener('abort', abort); this.stops.delete(close);
        if (outcome !== 'prepared') this.halted = true;
        const now = performance.now(); row.settledMonoMs = now; row.outcome = outcome; row.inFlightAtSettlement = actualInFlight;
        for (const actor of row.actors) if (actor.outcome === 'pending') { actor.outcome = 'censored'; actor.censoredAtMonoMs = now; }
        row.counts = { started: row.actors.filter(actor => actor.startedMonoMs !== null).length, prepared: row.actors.filter(actor => actor.outcome === 'prepared').length,
          failed: row.actors.filter(actor => actor.outcome === 'failed').length, censored: row.actors.filter(actor => actor.outcome === 'censored').length,
          notStarted: row.actors.filter(actor => actor.outcome === 'not_started').length };
        try {
          if (cpu) { const usage = process.cpuUsage(cpu); row.processCpu = { ...row.processCpu, userMicros: usage.user, systemMicros: usage.system, unavailableReason: null }; }
        } catch { /* Keep explicit unavailable. */ }
        try {
          if (histogram) {
            histogram.disable(); const count = histogram.count;
            row.schedulingDelay = { ...row.schedulingDelay, sampleCount: count, meanMs: count ? histogram.mean / 1e6 : null,
              p95Ms: count ? histogram.percentile(95) / 1e6 : null, maxMs: count ? histogram.max / 1e6 : null, unavailableReason: count ? null : 'no_samples' };
          }
        } catch { /* Keep explicit unavailable. */ }
        if (outcome === 'prepared') resolve(values); else reject(error ?? new Error('aborted'));
      };
      const abort = () => finish('aborted', new Error('aborted'));
      const close = () => finish('measurement_closed', new Error('aborted'));
      this.stops.add(close); meta.signal.addEventListener('abort', abort, { once: true });
      const launch = () => {
        while (!stopped && !meta.signal.aborted && inFlight < PREPARATION_CONCURRENCY && next < items.length) {
          const index = next++, actor = row.actors[index];
          inFlight++;
          // Deferring invocation captures synchronous throws and gives both
          // slots their own handled promises without a third queued start.
          Promise.resolve().then(() => {
            if (stopped || meta.signal.aborted) throw new Error('aborted');
            actor.startedMonoMs = performance.now(); actor.outcome = 'pending'; actualInFlight++;
            row.maximumInFlight = Math.max(row.maximumInFlight, actualInFlight);
            return operation(items[index], index);
          }).then(value => {
            if (stopped) return;
            inFlight--; actualInFlight--; if (meta.signal.aborted) { abort(); return; }
            actor.finishedMonoMs = performance.now(); actor.outcome = 'prepared'; values[index] = value; completed++;
            if (completed === items.length) finish('prepared'); else launch();
          }, error => {
            if (stopped) return;
            inFlight--; if (actor.startedMonoMs !== null) actualInFlight--;
            if (actor.startedMonoMs !== null) actor.finishedMonoMs = performance.now();
            actor.outcome = meta.signal.aborted ? actor.startedMonoMs === null ? 'not_started' : 'censored' : 'failed';
            if (meta.signal.aborted) actor.censoredAtMonoMs = actor.finishedMonoMs;
            finish(meta.signal.aborted ? 'aborted' : 'failed', error);
          });
        }
      };
      if (meta.signal.aborted) abort(); else launch();
    });
  }

  close(): PreparationEvidence {
    if (this.closed) return this.closed;
    for (const stop of [...this.stops]) stop();
    this.closed = freeze(structuredClone({ version: 1 as const, observer: 'bounded_trusted_fixture_preparation' as const,
      clockDomain: 'same_load_generator_node_performance' as const, scope: 'trusted_fixture_setup_only; assignments_preserved; actual_campaign_execution_concurrency_unchanged; censored_inflight_requests_may_finish_after_queue_settlement',
      concurrencyLimit: PREPARATION_CONCURRENCY as 2, closedMonoMs: performance.now(), cohorts: this.cohorts }));
    return this.closed;
  }
}
