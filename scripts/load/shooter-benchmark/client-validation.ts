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

type WorkloadReason = 'complete' | 'invalid_population' | 'invalid_binding' | 'incomplete_prefix' | 'missing_final_proof' | 'unresolved_outcome' | 'missing_payment_proof';
// This success predicate is separate from sampled overlap/instrumentation. A
// truthful service outcome can finish measurement while its workload is pending.
export function clientWorkloadCompletion(population: Record<string, unknown>): { complete: boolean; reason: WorkloadReason; accountedActors: number } {
  const actors = Array.isArray(population.actors) ? population.actors.map(object) : [];
  const accountedActors = actors.length;
  const result = (reason: WorkloadReason) => ({ complete: reason === 'complete', reason, accountedActors });
  const summary = object(population.summary);
  if (!accountedActors || accountedActors > 20 || summary.accountedActors !== accountedActors || summary.harnessStatus !== 'complete') return result('invalid_population');
  const bindings = ['accountBindingHash','sessionBindingHash','runBindingHash'];
  if (bindings.some(key => actors.some(actor => !hash(actor[key])) || new Set(actors.map(actor => actor[key])).size !== accountedActors)) return result('invalid_binding');
  for (const actor of actors) {
    const recorded = actor.recordedFrames;
    if (!Number.isSafeInteger(recorded) || Number(recorded) <= 0 || Number(recorded) > 162000
      || actor.submittedFrames !== recorded || actor.acceptedTick !== recorded || actor.verifiedTick !== recorded || !hash(actor.submittedInputSha256)) return result('incomplete_prefix');
    if (['finalPausedProof','finalCoherentProof','finishRequested','finishAckObserved','serverClosed'].some(key => actor[key] !== true)) return result('missing_final_proof');
    if (actor.paymentCensored !== false || typeof actor.status !== 'string' || !['paid','verified_nonpayable'].includes(actor.status)) return result('unresolved_outcome');
    if (actor.status === 'paid') {
      if (actor.paid !== true || actor.observedPaid !== true || actor.everObservedEligible !== true
        || actor.eligibilityState !== 'observed_eligible' || actor.paymentObservation !== 'paid') return result('missing_payment_proof');
    } else if (actor.paid !== false || actor.observedPaid !== false || actor.eligibilityState !== 'observed_nonpayable'
      || actor.paymentObservation !== 'ineligible' || typeof actor.rawReason !== 'string' || !['clear','assisted','fail','incomplete'].includes(actor.rawReason)) return result('missing_payment_proof');
  }
  return result('complete');
}
