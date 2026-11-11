import type { ActorResult } from './contracts.ts';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Protocol and DOM populations stay separate. Node monotonic observations can
// prove sampled overlap; they cannot establish20active users on every RAF frame.
export function clientOverlap(population: Record<string, unknown>, protocols: readonly ActorResult[], timings: readonly { firstRequestMonoMs: number | null; completedMonoMs: number | null }[]) {
  const actors = Array.isArray(population.actors) ? population.actors.map(object) : [];
  const client = actors[0] ?? {}, positive = object(population.positiveRecordingObserved);
  const samples = Array.isArray(positive.sampleMonoMs) ? positive.sampleMonoMs : [];
  const summary = object(population.summary);
  const clockValid = Number.isFinite(population.startedMonoMs) && Number.isFinite(population.finishedMonoMs)
    && Number(population.finishedMonoMs) >= Number(population.startedMonoMs) && samples.length >= 2 && samples.length <= 256
    && samples.every((sample, i) => typeof sample === 'number' && Number.isFinite(sample) && sample >= Number(population.startedMonoMs) && sample <= Number(population.finishedMonoMs) && (!i || sample >= samples[i - 1]));
  const validBindings = actors.length === 1 && ['accountBindingHash', 'sessionBindingHash', 'runBindingHash'].every(key => hash(client[key]));
  const disjoint = validBindings && protocols.length === 20 && protocols.every(actor => actor.accountBindingHash !== client.accountBindingHash && actor.sessionBindingHash !== client.sessionBindingHash && actor.runBindingHash !== client.runBindingHash);
  const timingValid = timings.length === 20 && timings.every(row => row.firstRequestMonoMs !== null && row.completedMonoMs !== null && Number.isFinite(row.firstRequestMonoMs) && Number.isFinite(row.completedMonoMs) && row.completedMonoMs >= row.firstRequestMonoMs);
  const counts = clockValid && timingValid ? samples.map(sample => ({ observedMonoMs: sample as number, activeProtocolActors: timings.filter(row => row.firstRequestMonoMs! <= sample && sample <= row.completedMonoMs!).length })) : [];
  const maximum = counts.length ? Math.max(...counts.map(row => row.activeProtocolActors)) : null;
  const proof = summary.accountedActors === 1 && summary.startedActors === 1 && summary.positiveRecordedActors === 1 && summary.observedMovementActors === 1 && summary.observedFireActors === 1 && summary.explicitFinishAckActors === 1 && summary.harnessStatus === 'complete';
  return { definition: 'same Node performance clock sampled positive native recording versus first actual protocol append attempt through final observed outcome; not continuous CPU execution or every-RAF concurrency',
    protocolPopulation: 20, domPopulation: 1, clockDomain: 'same_load_generator_node_performance', clockValid, protocolTimingValid: timingValid, bindingDisjoint: disjoint, positiveRecordingSamples: samples.length,
    observedConcurrency: counts, maximumObservedActiveProtocolActors: maximum, complete: proof && disjoint && clockValid && timingValid && maximum === 20 };
}
