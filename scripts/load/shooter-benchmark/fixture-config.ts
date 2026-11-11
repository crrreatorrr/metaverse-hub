// Finite disposable CI reservations, never deployment/operating defaults.
export const FIXTURE_MAX_RUNS = 64;
export const FIXTURE_PER_RUN_BYTES = 64 * 1024 * 1024;
export const FIXTURE_RESERVED_BYTES = FIXTURE_MAX_RUNS * FIXTURE_PER_RUN_BYTES;
export function assertFixtureCohortFits(actors: number, waves: number, runs = FIXTURE_MAX_RUNS, reservedBytes = FIXTURE_RESERVED_BYTES): void {
  const total = actors * waves;
  if (![actors, waves, runs, reservedBytes].every(Number.isSafeInteger) || actors < 1 || waves < 1 || total > runs || total * FIXTURE_PER_RUN_BYTES > reservedBytes) throw new Error('fixture cohort exceeds durable admission reservation');
}
