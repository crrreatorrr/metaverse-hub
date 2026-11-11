import { summarizeActors, type ActorResult, type Measurement } from './contracts.ts';
const SHA = /^[a-f0-9]{64}$/;
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(`invalid benchmark report: ${reason}`); }
function object(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value), 'object required'); return value as Record<string, unknown>; }
// Semantic companion to results.schema.json. JSON Schema alone cannot establish
// unique real bindings, reconciled numerators or absence of a CI capacity claim.
export function validateResult(value: unknown): void {
  const report = object(value);
  check(report.schemaVersion === 1, 'schema version');
  check(report.authority === 'ci_advisory', 'target-host authority not implemented');
  check(report.productionCapacityConclusion === null && report.approvalReference === null, 'CI capacity claim');
  const source = object(report.provenance);
  for (const key of ['artifactSha256', 'corpusManifestSha256', 'assignmentSha256', 'configurationSha256']) check(typeof source[key] === 'string' && SHA.test(source[key] as string), `missing source ${key}`);
  for (const key of ['hubGitSha', 'gameGitSha']) check(typeof source[key] === 'string' && /^[a-f0-9]{40}$/.test(source[key] as string), `missing source ${key}`);
  check(Array.isArray(source.images) && source.images.length >= 4 && source.images.every(image => typeof object(image).digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(object(image).digest as string)), 'actual image identities required');
  check(Array.isArray(report.hosts) && report.hosts.length > 0, 'host provenance');
  for (const hostValue of report.hosts) { const host = object(hostValue); check(host.region === null ? host.regionEvidence === null : typeof host.regionEvidence === 'string' && host.regionEvidence.length > 0, 'verified region evidence required'); }
  check(Array.isArray(report.actors), 'actors required');
  const actors = report.actors as ActorResult[], summary = object(report.summary), computed = summarizeActors(actors);
  for (const key of ['attempted', 'durablyVerified', 'payable', 'paid', 'pending', 'censored']) check(summary[key] === computed[key], `summary ${key} denominator`);
  check(typeof summary.plannedActors === 'number' && typeof summary.accountedActors === 'number' && typeof summary.unstartedActors === 'number' && summary.accountedActors === actors.length && summary.accountedActors + summary.unstartedActors === summary.plannedActors, 'all planned actors accounted');
  if (summary.harnessStatus === 'complete') {
    check(summary.unstartedActors === 0 && actors.length >= 20 && actors.length % 20 === 0, 'complete independent cohort');
    const waves = new Map<number, number>(); for (const actor of actors) waves.set(actor.wave, (waves.get(actor.wave) ?? 0) + 1);
    check([...waves.values()].every(count => count === 20), 'each wave has20 independently bound actors');
  }
  const measurements = object(report.measurements);
  for (const key of ['cpu', 'wall', 'queue', 'memory', 'gc', 'sql', 'checkpointBytes', 'rewardDelay', 'clientFrame', 'matchTick']) {
    const metric = object(measurements[key]) as unknown as Measurement;
    check(typeof metric.unit === 'string' && typeof metric.observer === 'string' && Number.isInteger(metric.sampleCount) && metric.sampleCount >= 0, `metric ${key} provenance`);
    if (metric.value === null) check(typeof metric.unavailableReason === 'string' && metric.unavailableReason.length > 0 && metric.sampleCount === 0, `metric ${key} null reason`);
  }
  // Reports are data-only, with a strict output ceiling and no raw checkpoints,
  // inputs or credential fields. Reject before writing/uploading any artifact.
  const scan = (entry: unknown, depth: number): void => {
    check(depth <= 24, 'bounded nesting');
    if (Array.isArray(entry)) { check(entry.length <= 20000, 'bounded array'); for (const child of entry) scan(child, depth + 1); }
    else if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) {
      check(!/^(token|accountToken|authorization|password|secret|privateCheckpoint|checkpoint_json|rawInputs|log)$/i.test(key), 'private field in report');
      check(!(key === 'frames' && typeof child === 'string'), 'raw frame payload in report');
      scan(child, depth + 1);
    } else if (typeof entry === 'string') check(entry.length <= 4096 && !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(entry), 'unbounded string or credential');
  };
  scan(report, 0);
  check(Buffer.byteLength(JSON.stringify(report)) <= 8 * 1024 * 1024, 'report bytes exceed8MiB');
}
