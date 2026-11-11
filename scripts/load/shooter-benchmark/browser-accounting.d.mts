export interface ServiceOutcome {
  status: 'rejected' | 'authorization_denied' | 'service_unavailable' | 'unsupported';
  rawReason: string;
  serviceState: string;
}
export interface BrowserActorCounts {
  accountedActors: number; startedActors: number; positiveRecordedActors: number;
  observedMovementActors: number; observedFireActors: number; explicitFinishAckActors: number;
  eligible: number; observedPaid: number; paid: number; eligibleWithObservedReceipt: number;
  eligibleUnpaid: number; eligibleCensored: number; eligibilityUnknownActors: number;
  recordedCountUnknownActors: number; clientFrameEvidenceTruncatedActors: number; censoredActors: number;
  rawReasons: Record<string, number>;
}
export function boundOwnerStatus(value: unknown, runId: string): unknown;
export function safeReason(value: unknown, fallback: string): string;
export function serviceOutcome(value: unknown): ServiceOutcome | null;
export function clientStartOutcome(code: unknown, evidence?: { requestFailed?: boolean }): ServiceOutcome | null;
export function outcomeError(value: unknown): Error & { outcome: ServiceOutcome };
export function recordPaymentFacts(row: object, value: unknown, runId: string, observedAtMs: number): void;
export function successfulPaid(row: object): boolean;
export function browserActorCounts(rows: readonly object[]): BrowserActorCounts;
