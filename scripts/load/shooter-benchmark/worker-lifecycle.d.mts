export class WorkerLifecycleFailure extends Error { readonly reason: string; constructor(reason: string); }
export interface ReplayCounters {
  daemonInstanceId: string;
  workerInstance: string;
  completed: number;
  requests: number;
  processStarts: number;
  restarts: number;
  operationalFailures: number;
}
export interface ReuseEvidence {
  operations: number;
  coldFirstOperations: number;
  reusedOperations: number;
  reusedFraction: number | null;
  naturalRecycles: number;
  initialChildPreviouslyUsed: boolean;
  firstOperation: 'not_observed' | 'observed_reused_child' | 'first_operation_in_child';
  osPageCache: 'unknown';
}
export function replayReuseEvidence(before: ReplayCounters, after: ReplayCounters): ReuseEvidence;
export function createWorkerLifecycle(options: {
  composeArgs: readonly string[];
  readHealth(signal: AbortSignal): Promise<Record<string, unknown>>;
  readMetrics(signal: AbortSignal): Promise<Record<string, unknown>>;
  credentialPath?: '/run/secrets/shooter-worker.json';
  journalDirectory?: '/var/lib/shooter-journal';
}): {
  prepareCold(signal?: AbortSignal): Promise<Record<string, unknown>>;
  assertWarm(signal?: AbortSignal): Promise<Record<string, unknown>>;
  observe(signal?: AbortSignal): Promise<Record<string, unknown>>;
};
