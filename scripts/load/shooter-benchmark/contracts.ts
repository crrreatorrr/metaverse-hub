import { createHash } from 'node:crypto';

export type Mode = 'legacy_full_goja' | 'legacy_segmented_goja' | 'bounded_v8_same_host' | 'bounded_v8_remote';
export type Profile = 'trusted_fixture_time_aged' | 'public_browser_real_time';
export interface CorpusCase {
  id: string;
  boss: string;
  seed: number;
  frames: number;
  fixtureSha256: string;
  legacyInputEnvelopeSha256: string;
}
export interface Corpus {
  corpusSourceCommit: string;
  approvedManifest: { sha256: string };
  cases: CorpusCase[];
}
export interface Assignment {
  actor: number;
  caseId: string;
  caseSha256: string;
  inputSha256: string;
  boss: string;
  seed: number;
  frames: number;
  behavior: 'complete' | 'abandon';
}
export interface Phase {
  kind: 'background_baseline' | 'cold_burst' | 'warm_burst' | 'retry_storm' | 'sustained' | 'drain';
  waves: number;
  arrivalIntervalMs: number;
}
export interface Plan {
  schemaVersion: 1;
  authority: 'ci_advisory';
  profile: Profile;
  mode: Mode;
  seed: string;
  actorsPerWave: 20;
  maxDurationMs: number;
  maxQueuedBytes: number;
  requestRetryLimit: number;
  legacyReplayBudgetMs: 15000;
  assignments: Assignment[];
  phases: Phase[];
  background: { hubUsers: number; freePvpMatches: number; movementHz: number };
  source: { corpusCommit: string; artifactSha256: string; corpusSha256: string };
  productionCapacityConclusion: null;
}
export type ActorStatus = 'not_started' | 'paid' | 'verified_nonpayable' | 'payment_pending' | 'authorization_denied' | 'abandoned' | 'timeout' | 'operational_failure' | 'unsupported' | 'censored';
export interface ActorResult {
  wave: number;
  actor: number;
  accountBindingHash: string;
  sessionBindingHash: string;
  runBindingHash: string;
  caseId: string;
  sourceInputSha256: string;
  sourceFrames: number;
  submittedInputSha256: string | null;
  submittedHashMeaning: string | null;
  submittedFrames: number;
  acceptedTick: number;
  verifiedTick: number;
  status: ActorStatus;
  rawReason: string | null;
  attempted: boolean;
  durablyVerified: boolean;
  payable: boolean;
  everObservedEligible: boolean;
  paid: boolean;
}
export interface Measurement {
  value: number | number[] | Record<string, unknown> | null;
  unit: string;
  observer: string;
  clockDomain: string | null;
  unavailableReason: string | null;
  sampleCount: number;
}
const SHA = /^[a-f0-9]{64}$/;
const EXPECTED_CASES = [
  'sahil-success-7', 'sahil-success-11', 'sahil-fail-7', 'sahil-assisted-9',
  'obama-success-7', 'obama-success-11', 'broccoli-success-7', 'broccoli-success-11',
  'glowie-success-7', 'glowie-success-11', 'tinubu-success-7', 'tinubu-success-11',
] as const;
// These are assignment identities, not expected outcomes. No reroll or winner selection.
const EXTRA_CASES = ['sahil-success-7', 'obama-success-7', 'broccoli-success-11', 'glowie-success-11', 'tinubu-success-11', 'sahil-fail-7', 'sahil-assisted-9', 'obama-success-11'];
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`benchmark contract: ${message}`);
}
export function makePlan(corpus: Corpus, corpusBytes: Uint8Array, seed: string, mode: Mode = 'bounded_v8_same_host'): Plan {
  invariant(seed.length > 0 && seed.length <= 128, 'seed required and bounded');
  invariant(corpus.cases.length === 12, 'all 12 corpus cases required');
  const cases = new Map(corpus.cases.map(c => [c.id, c]));
  invariant(cases.size === 12 && EXPECTED_CASES.every(id => cases.has(id)), 'exact corpus identities required');
  invariant(cases.get('sahil-success-7')?.frames === 9634, 'full Sahil9634 required');
  invariant(cases.get('obama-success-7')?.frames === 24000, 'full Obama24000 required');
  invariant(SHA.test(corpus.approvedManifest.sha256), 'approved artifact SHA required');
  invariant(/^[a-f0-9]{40}$/.test(corpus.corpusSourceCommit), 'corpus source commit required');
  const assignments = [...EXPECTED_CASES, ...EXTRA_CASES].map((id, actor): Assignment => {
    const c = cases.get(id)!;
    invariant(SHA.test(c.fixtureSha256) && SHA.test(c.legacyInputEnvelopeSha256), 'case byte and input hashes required');
    invariant(Number.isSafeInteger(c.frames) && c.frames > 0 && c.frames <= 24000, 'bounded complete frame count');
    return { actor, caseId: c.id, caseSha256: c.fixtureSha256, inputSha256: c.legacyInputEnvelopeSha256, boss: c.boss, seed: c.seed, frames: c.frames, behavior: actor === 19 ? 'abandon' : 'complete' };
  });
  const plan: Plan = {
    schemaVersion: 1, authority: 'ci_advisory', profile: 'trusted_fixture_time_aged', mode, seed,
    actorsPerWave: 20, maxDurationMs: 900000, maxQueuedBytes: 64 * 1024 * 1024,
    requestRetryLimit: 3, legacyReplayBudgetMs: 15000, assignments,
    phases: [
      { kind: 'background_baseline', waves: 0, arrivalIntervalMs: 10000 },
      { kind: 'cold_burst', waves: 1, arrivalIntervalMs: 0 },
      { kind: 'warm_burst', waves: 1, arrivalIntervalMs: 0 },
      { kind: 'retry_storm', waves: 1, arrivalIntervalMs: 0 },
      { kind: 'sustained', waves: 3, arrivalIntervalMs: 10000 },
      { kind: 'drain', waves: 0, arrivalIntervalMs: 60000 },
    ],
    background: { hubUsers: 20, freePvpMatches: 10, movementHz: 10 },
    source: { corpusCommit: corpus.corpusSourceCommit, artifactSha256: corpus.approvedManifest.sha256, corpusSha256: sha256(corpusBytes) },
    productionCapacityConclusion: null,
  };
  validatePlan(plan);
  return plan;
}
export function validatePlan(plan: Plan): void {
  invariant(plan.authority === 'ci_advisory' && plan.productionCapacityConclusion === null, 'CI cannot claim capacity');
  invariant(plan.mode !== 'bounded_v8_remote', 'remote execution requires separately authorized tooling');
  invariant(plan.actorsPerWave === 20 && plan.assignments.length === 20, '20 independent assignments per wave');
  invariant(plan.maxDurationMs > 0 && plan.maxDurationMs <= 900000, 'duration outside tooling hard maximum');
  invariant(plan.maxQueuedBytes > 0 && plan.maxQueuedBytes <= 64 * 1024 * 1024, 'queued bytes outside tooling hard maximum');
  invariant(plan.maxQueuedBytes >= Math.max(...plan.assignments.map(a => a.frames * 16 + 2048)), 'body budget cannot hold the largest full source request');
  invariant(plan.requestRetryLimit >= 0 && plan.requestRetryLimit <= 3, 'retry budget outside tooling hard maximum');
  invariant(plan.legacyReplayBudgetMs === 15000, 'legacy budget must remain 15 seconds');
  invariant(plan.phases.reduce((n, p) => n + p.waves, 0) <= 6, 'too many waves');
  invariant(plan.phases.every(p => Number.isSafeInteger(p.waves) && p.waves >= 0 && p.arrivalIntervalMs >= 0), 'invalid phase bounds');
  invariant(new Set(plan.assignments.map(a => a.actor)).size === 20, 'duplicate assignment slots');
  invariant(plan.assignments.some(a => a.caseId === 'sahil-success-7' && a.frames === 9634), 'missing long Sahil');
  invariant(plan.assignments.some(a => a.caseId === 'obama-success-7' && a.frames === 24000), 'missing full Obama');
  invariant(plan.background.hubUsers >= 0 && plan.background.hubUsers <= 20 && plan.background.freePvpMatches >= 0 && plan.background.freePvpMatches <= 10, 'background bound exceeded');
}
export function summarizeActors(actors: readonly ActorResult[]): Record<string, unknown> {
  const accounts = new Set<string>(), sessions = new Set<string>(), runs = new Set<string>();
  const slots = new Set<string>();
  const rawReasonCounts: Record<string, number> = {};
  for (const a of actors) {
    invariant(SHA.test(a.accountBindingHash) && SHA.test(a.sessionBindingHash) && SHA.test(a.runBindingHash), 'missing binding hashes');
    invariant(!accounts.has(a.accountBindingHash) && !sessions.has(a.sessionBindingHash) && !runs.has(a.runBindingHash), 'reused account/session/run binding');
    accounts.add(a.accountBindingHash); sessions.add(a.sessionBindingHash); runs.add(a.runBindingHash);
    const slot = `${a.wave}:${a.actor}`;
    invariant(!slots.has(slot), 'duplicate wave slot'); slots.add(slot);
    invariant(Number.isSafeInteger(a.sourceFrames) && a.sourceFrames > 0 && SHA.test(a.sourceInputSha256), 'source frame identity');
    invariant(Number.isSafeInteger(a.submittedFrames) && a.submittedFrames >= 0 && a.submittedFrames <= a.sourceFrames, 'submitted frame accounting');
    invariant(a.submittedFrames === 0 ? a.submittedInputSha256 === null : typeof a.submittedInputSha256 === 'string' && SHA.test(a.submittedInputSha256) && typeof a.submittedHashMeaning === 'string', 'submitted input identity');
    invariant(Number.isSafeInteger(a.acceptedTick) && Number.isSafeInteger(a.verifiedTick) && a.verifiedTick >= 0 && a.verifiedTick <= a.acceptedTick && a.acceptedTick <= a.submittedFrames, 'accepted/verified cursor accounting');
    invariant(!a.everObservedEligible || a.submittedFrames > 0 && a.verifiedTick > 0, 'eligible milestone requires observed positive verified input');
    invariant(!a.durablyVerified || a.submittedFrames > 0 && a.verifiedTick === a.submittedFrames, 'durable status must cover submitted prefix');
    invariant(!a.paid || (a.payable && a.everObservedEligible && a.submittedFrames > 0 && a.durablyVerified && a.attempted && a.status === 'paid'), 'paid actor lacks durable eligible result');
    invariant(!a.everObservedEligible || a.submittedFrames > 0 && a.verifiedTick > 0, 'eligible milestone requires observed positive verified input');
    invariant(!a.durablyVerified || a.attempted, 'verification without attempt');
    invariant(!['timeout', 'operational_failure', 'unsupported', 'censored', 'abandoned', 'not_started'].includes(a.status) || !a.paid, 'failure cannot count as paid throughput');
    const reason = `${a.status}:${a.rawReason ?? 'unspecified'}`;
    rawReasonCounts[reason] = (rawReasonCounts[reason] ?? 0) + 1;
  }
  const count = (p: (a: ActorResult) => boolean) => actors.filter(p).length;
  return { attempted: count(a => a.attempted), durablyVerified: count(a => a.durablyVerified), payable: count(a => a.payable), eligible: count(a => a.everObservedEligible), eligibleUnpaid: count(a => a.everObservedEligible && !a.paid), eligibleCensored: count(a => a.everObservedEligible && !a.paid && a.status === 'censored'), paid: count(a => a.paid), pending: count(a => a.status === 'payment_pending'), censored: count(a => a.status === 'censored'), rawReasonCounts, sourceFrames: actors.reduce((n, a) => n + a.sourceFrames, 0), submittedFrames: actors.reduce((n, a) => n + a.submittedFrames, 0), acceptedFrames: actors.reduce((n, a) => n + a.acceptedTick, 0), verifiedFrames: actors.reduce((n, a) => n + a.verifiedTick, 0), fullSourceActorsVerified: count(a => a.verifiedTick === a.sourceFrames) };
}
export function unobserved(unit: string, observer: string, reason: string): Measurement {
  invariant(reason.length > 0, 'null metric needs reason');
  return { value: null, unit, observer, clockDomain: null, unavailableReason: reason, sampleCount: 0 };
}
export function quantiles(values: readonly number[], unit: string, observer: string): Measurement {
  if (!values.length) return unobserved(unit, observer, 'no observed samples');
  invariant(values.every(v => Number.isFinite(v) && v >= 0), 'invalid latency sample');
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { value: { p50: q(.5), p95: q(.95), p99: q(.99), max: sorted[sorted.length - 1], method: 'nearest_rank' }, unit, observer, clockDomain: 'monotonic_elapsed', unavailableReason: null, sampleCount: values.length };
}
