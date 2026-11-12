// Finite disposable CI reservations, never deployment/operating defaults.
export const FIXTURE_MAX_RUNS = 64;
export const FIXTURE_PER_RUN_BYTES = 64 * 1024 * 1024;
export const FIXTURE_CP_SLOT_BYTES = 16 * 1024 * 1024;
export const FIXTURE_CP_RESERVED_BYTES = FIXTURE_MAX_RUNS * FIXTURE_CP_SLOT_BYTES;
export const FIXTURE_RESERVED_BYTES = FIXTURE_MAX_RUNS * FIXTURE_PER_RUN_BYTES;
export function assertFixtureCohortFits(actors: number, waves: number, runs = FIXTURE_MAX_RUNS, reservedBytes = FIXTURE_RESERVED_BYTES, checkpointBytes = FIXTURE_CP_RESERVED_BYTES): void {
  const total = actors * waves;
  if (![actors, waves, runs, reservedBytes, checkpointBytes].every(Number.isSafeInteger) || actors < 1 || waves < 1 || total > runs || total * FIXTURE_PER_RUN_BYTES > reservedBytes || total * FIXTURE_CP_SLOT_BYTES > checkpointBytes) throw new Error('fixture cohort exceeds durable admission reservation');
}
export interface FixtureCapacity {
  maxRuns: number; retainedRuns: number; maxInputBytes: number; reservedInputBytes: number;
  maxCheckpointBytes: number; reservedCheckpointBytes: number;
}
export function assertFixtureRemainingCapacity(capacity: FixtureCapacity, plannedAdditionalRuns: number): void {
  if (![...Object.values(capacity), plannedAdditionalRuns].every(value => Number.isSafeInteger(value) && value >= 0)
    || capacity.retainedRuns + plannedAdditionalRuns > capacity.maxRuns
    || capacity.reservedInputBytes + plannedAdditionalRuns * FIXTURE_PER_RUN_BYTES > capacity.maxInputBytes
    || capacity.reservedCheckpointBytes + plannedAdditionalRuns * FIXTURE_CP_SLOT_BYTES > capacity.maxCheckpointBytes) throw new Error('fixture cohort exceeds remaining durable reservation');
}
