export interface InputSample {
  slot: number;
  matchBindingHash: string;
  observedMonoMs: number;
  createdMonoMs: number;
  replacement: boolean;
  seatInputs: { applied: number }[];
}
// Server tick counts are insufficient: both real seats must keep applying new
// input during early/late intervals, including replacement games after their
// creating observation's5s signal has expired.
export function inputCoverage(rows: readonly InputSample[], startedMonoMs: number, elapsedMs: number, slots: number) {
  const growth = (items: readonly InputSample[], span: number): boolean => {
    const groups = new Map<string, InputSample[]>();
    for (const row of items) { const group = groups.get(row.matchBindingHash) ?? []; group.push(row); groups.set(row.matchBindingHash, group); }
    return [...groups.values()].some(group => {
      const sorted = [...group].sort((a, b) => a.observedMonoMs - b.observedMonoMs), first = sorted[0], last = sorted[sorted.length - 1];
      return last.observedMonoMs - first.observedMonoMs >= span && first.seatInputs.length === 2 && last.seatInputs.length === 2 && last.seatInputs.every((seat, i) => seat.applied > first.seatInputs[i].applied);
    });
  };
  const perSlot = Array.from({ length: slots }, (_, slot) => {
    const samples = rows.filter(r => r.slot === slot);
    return { slot, samples: samples.length, earlyInputGrowth: growth(samples.filter(r => r.observedMonoMs - startedMonoMs <= elapsedMs / 3), 6000), lateInputGrowth: growth(samples.filter(r => r.observedMonoMs - startedMonoMs >= elapsedMs * 2 / 3), 6000) };
  });
  const replacementAfterObserverDeadline = growth(rows.filter(r => r.replacement && r.observedMonoMs - r.createdMonoMs >= 6000), 1000);
  return { definition: 'authoritative applied input counters for both seats, not server loop ticks', perSlot, replacementAfterObserverDeadline, complete: perSlot.every(s => s.earlyInputGrowth && s.lateInputGrowth) && replacementAfterObserverDeadline };
}

// Freeze a partial sample once, including an in-flight window closure. A late
// RPC may finish cleanup, but cannot change the retained sample or denominator.
export function oneShotCoverage<T extends Record<string, unknown>>(read: () => T, retain: (value: Readonly<T>) => void): () => void {
  let closed = false;
  return () => { if (closed) return; closed = true; retain(Object.freeze(structuredClone(read()))); };
}

export function shortInputCoverage(rows: readonly InputSample[], slots: number) {
  const perSlot = Array.from({ length: slots }, (_, slot) => {
    const samples = rows.filter(row => row.slot === slot);
    const proven = samples.some(first => samples.some(last => last.matchBindingHash === first.matchBindingHash
      && last.observedMonoMs - first.observedMonoMs >= 1000 && first.seatInputs.length === 2 && last.seatInputs.length === 2
      && last.seatInputs.every((seat, i) => seat.applied > first.seatInputs[i].applied)));
    return { slot, observedSamples: samples.length, bothSeatAppliedGrowth: proven };
  });
  return { scope: 'at_least_one_second_actual_both_seat_input_growth_per_slot', perSlot, complete: perSlot.every(slot => slot.bothSeatAppliedGrowth) };
}
