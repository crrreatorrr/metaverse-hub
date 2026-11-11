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
