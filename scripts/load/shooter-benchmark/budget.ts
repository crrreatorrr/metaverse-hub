export const LEGACY_SEGMENT_FRAMES = 1024; // Fixed CI comparison parameter, not an operating recommendation.
// Tracks materialized UTF8 input/request bytes, separately from process RSS and
// server quotas. A repeated same-body retry reuses its existing reservation.
export class ByteBudget {
  private used = 0;
  private peak = 0;
  constructor(readonly limit: number) { if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid encoded body budget'); }
  reserve(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes + this.used > this.limit) throw new Error('materialized input body budget exceeded');
    this.used += bytes; this.peak = Math.max(this.peak, this.used);
    let released = false;
    return () => { if (!released) { released = true; this.used -= bytes; } };
  }
  observation() { return { limitBytes: this.limit, currentBytes: this.used, peakBytes: this.peak, definition: 'conservative UTF8 source/request reservations acquired before materialization; source-file decoding, JavaScript representation/GC overhead and process RSS are separate' }; }
}
export async function prepareReserved<T>(budget: ByteBudget, bytes: number, materialize: () => Promise<T>): Promise<{ value: T; release: () => void }> {
  const release = budget.reserve(bytes); // Must precede source decoding/awaits.
  try { return { value: await materialize(), release }; }
  catch (error) { release(); throw error; }
}
export function sourceInputReservation(frames: number, actions: number): number {
  if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(actions) || actions < 0 || actions > 131072) throw new Error('invalid source reservation');
  // Each canonical action is [tick<=162000,1];16bytes safely covers its JSON.
  return frames * 16 + actions * 16 + 2;
}
export function phaseInputReservation(assignments: readonly { frames: number; actions: number }[], waves: number): number {
  if (!Number.isSafeInteger(waves) || waves < 0 || waves > 6) throw new Error('invalid preparation wave count');
  // Entire phase prepares before launch. Allow retained source inputs AND the
  // complete request representation (legacy chunks may each add an envelope).
  return waves * assignments.reduce((sum, a) => sum + 2 * sourceInputReservation(a.frames, a.actions) + Math.ceil(a.frames / LEGACY_SEGMENT_FRAMES) * 2048, 0);
}
export function wireInputReservation(frames: number, actions: number): number {
  // The2KiB allowance covers exact bounded run/account/session binding and JSON
  // envelope. Source/action text is charged before any slice/rebound is built.
  sourceInputReservation(frames, actions);
  return frames * 16 + actions * 16 + 2048;
}
