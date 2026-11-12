export interface SafeCleanup { state: 'closed' | 'forced' | 'unconfirmed'; gracefulBudgetMs: number; killBudgetMs: number; }
export interface RecordingObservation { observedMonoMs: number; recordedFrames: number; runBindingHash: string; }
export interface ClientProbeResult extends Record<string, unknown> {
  preparedMonoMs: number; startedMonoMs: number; finishedMonoMs: number;
  actors: Record<string, unknown>[]; summary: Record<string, unknown>; rawFrameRecords: Record<string, unknown>[];
  positiveRecordingObserved: { firstMonoMs: number | null; lastMonoMs: number | null; samples: number;
    sampleMonoMs: number[]; sampleLimit: number; truncated: boolean; clockDomain: string; meaning: string };
}
export interface SingleDomClient {
  binding: { accountBindingHash: string; sessionBindingHash: string }; preparedMonoMs: number;
  start(signal: AbortSignal, onRecordingStarted?: (observation: RecordingObservation) => void): Promise<ClientProbeResult>;
  close(): Promise<SafeCleanup>;
}
export function prepareSingleDomClient(options: { root: string }): Promise<SingleDomClient>;
