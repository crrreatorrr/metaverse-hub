import type { Buffer } from 'node:buffer';
export interface ResultStageRecord {
  traceTag: string; stage: string; startedWallMs: number; observedWallMs: number;
  elapsedMs: number | null; clockReason: 'server_wall_clock_rollback' | null;
}
export interface ResultStageEvidence {
  version: 1; observer: 'ci_result_stage_v1'; state: 'observed' | 'unavailable'; reason: string;
  clockDomain: string; scope: string; tailLinesRequested: number; truncated: boolean;
  counts: { scannedBytes: number; lines: number; oversizedLines: number; rejectedLines: number; acceptedRecords: number; droppedRecords: number };
  records: ResultStageRecord[];
}
export const LIMITS: Readonly<{ lineBytes: number; lines: number; scanBytes: number; records: number; outputBytes: number; timeoutMs: number }>;
export function createResultStageParser(): { push(chunk: Buffer, source?: 'stdout' | 'stderr'): boolean; finish(reason?: string): ResultStageEvidence };
export function collectResultStages(containerId: string): Promise<ResultStageEvidence>;
