// Lossless bounded metadata encodings. Fixed columns cannot conceal arbitrary
// private RPC/credential fields from the report's recursive privacy validator.
const HASH = /^[a-f0-9]{64}$/;
export interface CheckpointSample { observedAt: string; sizes: Record<string, unknown>[]; }
function cpRow(row: Record<string, unknown>): string {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 3 || !Object.keys(row).every(key => ['runBindingHash','canonicalJsonBytes','jsonbDatumBytes'].includes(key))
    || typeof row.runBindingHash !== 'string' || !HASH.test(row.runBindingHash)
    || ![row.canonicalJsonBytes,row.jsonbDatumBytes].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) throw new Error('checkpoint metadata codec shape');
  return row.runBindingHash;
}
export function checkpointChanges(samples: readonly CheckpointSample[]) {
  const previous = new Map<string, Record<string, unknown>>();
  return { encoding: 'checkpoint_size_changes_v1', ordering: 'run-keyed sets; original SQL row order has no measurement meaning', samples: samples.map(sample => {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample) || Object.keys(sample).length !== 2 || !Object.keys(sample).every(key => ['observedAt','sizes'].includes(key)) || typeof sample.observedAt !== 'string' || sample.observedAt.length !== 24 || !Number.isFinite(Date.parse(sample.observedAt)) || new Date(sample.observedAt).toISOString() !== sample.observedAt || !Array.isArray(sample.sizes)) throw new Error('checkpoint sample codec shape');
    const current = new Map<string, Record<string, unknown>>(), changes: Record<string, unknown>[] = [];
    for (const row of sample.sizes) { const id = cpRow(row); if (current.has(id)) throw new Error('duplicate checkpoint metadata row'); current.set(id, row);
      const prior = previous.get(id); if (!prior || prior.canonicalJsonBytes !== row.canonicalJsonBytes || prior.jsonbDatumBytes !== row.jsonbDatumBytes) changes.push({ ...row }); }
    const removedRunBindingHashes = [...previous.keys()].filter(id => !current.has(id));
    previous.clear(); for (const [id, row] of current) previous.set(id, row);
    return { observedAt: sample.observedAt, observedCount: sample.sizes.length, changes, removedRunBindingHashes };
  }) };
}
export function restoreCheckpointSamples(encoded: ReturnType<typeof checkpointChanges>): CheckpointSample[] {
  const current = new Map<string, Record<string, unknown>>();
  return encoded.samples.map(sample => { for (const id of sample.removedRunBindingHashes) current.delete(id); for (const row of sample.changes) current.set(cpRow(row), row);
    if (current.size !== sample.observedCount) throw new Error('checkpoint metadata count mismatch');
    return { observedAt: sample.observedAt, sizes: [...current.values()].map(row => ({ ...row })).sort((a, b) => String(a.runBindingHash).localeCompare(String(b.runBindingHash))) };
  });
}
const columns = ['slot','matchBindingHash','startedMonoMs','finishedMonoMs','elapsedMs','stage','outcome','httpStatus'] as const;
const signalDefinition = 'parent_sampler_shared_5s_readonly_observation_budget';
export function metricReadColumns(reads: readonly Readonly<Record<string, unknown>>[]) {
  const keys = [...columns, 'signalDefinition'];
  const rows = reads.map(row => {
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key as typeof keys[number])) || row.signalDefinition !== signalDefinition
      || !Number.isInteger(row.slot) || Number(row.slot) < 0 || Number(row.slot) > 9 || typeof row.matchBindingHash !== 'string' || !HASH.test(row.matchBindingHash)
      || ![row.startedMonoMs,row.finishedMonoMs,row.elapsedMs].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      || typeof row.stage !== 'string' || !['rpc_pending','response_validation','completed'].includes(row.stage)
      || typeof row.outcome !== 'string' || !['pending','transport_exception','response_received','confirmed_match_end','observed','measurement_window_closed','sample_signal_aborted'].includes(row.outcome)
      || !(row.httpStatus === null || Number.isInteger(row.httpStatus) && Number(row.httpStatus) >= 100 && Number(row.httpStatus) <= 599)) throw new Error('metric read codec shape');
    return columns.map(key => row[key]);
  });
  return { encoding: 'metric_read_columns_v1', columns: [...columns], signalDefinition, rows };
}
export function restoreMetricReads(encoded: ReturnType<typeof metricReadColumns>): Record<string, unknown>[] {
  return encoded.rows.map(row => ({ ...Object.fromEntries(encoded.columns.map((key, i) => [key, row[i]])), signalDefinition: encoded.signalDefinition }));
}
