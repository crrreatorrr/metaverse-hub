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
  observation() { return { limitBytes: this.limit, currentBytes: this.used, peakBytes: this.peak, definition: 'materialized UTF8 frame/action inputs plus retained or in-flight canonical request bodies; process RSS is separate' }; }
}
