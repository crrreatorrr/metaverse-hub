import assert from 'node:assert/strict';
import { sha256, summarizeActors, unobserved, type ActorResult } from './contracts.ts';
import { validateResult } from './result-validation.ts';
const actors: ActorResult[] = Array.from({ length: 20 }, (_, actor) => ({ wave: 0, actor, accountBindingHash: sha256(`a${actor}`), sessionBindingHash: sha256(`s${actor}`), runBindingHash: sha256(`r${actor}`), caseId: 'source-case', sourceInputSha256: sha256('input'), sourceFrames: 24000, submittedFrames: 24000, submittedInputSha256: sha256('submitted'), submittedHashMeaning: 'test_only', acceptedTick: 24000, verifiedTick: 0, status: 'timeout', rawReason: 'legacy_cpu_budget', attempted: true, durablyVerified: false, payable: false, everObservedEligible: false, paid: false }));
const metrics = Object.fromEntries(['cpu', 'wall', 'queue', 'memory', 'gc', 'sql', 'checkpointBytes', 'rewardDelay', 'clientFrame', 'matchTick'].map(key => [key, unobserved('ms', 'test_only', 'synthetic validation fixture')]));
const report = { schemaVersion: 1, authority: 'ci_advisory', productionCapacityConclusion: null, approvalReference: null,
  provenance: { hubGitSha: 'a'.repeat(40), gameGitSha: 'b'.repeat(40), artifactSha256: sha256('artifact'), corpusManifestSha256: sha256('corpus'), assignmentSha256: sha256('assignment'), configurationSha256: sha256('config'), images: Array.from({ length: 4 }, (_, i) => ({ role: `role${i}`, digest: `sha256:${sha256(`image${i}`)}` })) },
  hosts: [{ region: null, regionEvidence: null }], actors,
  summary: { ...summarizeActors(actors), plannedActors: 20, accountedActors: 20, unstartedActors: 0, harnessStatus: 'complete' }, measurements: metrics,
};
validateResult(report); // A complete harness may truthfully record all failures.
assert.throws(() => validateResult({ ...report, productionCapacityConclusion: { users: 20 } }), /CI capacity/);
assert.throws(() => validateResult({ ...report, summary: { ...report.summary, paid: 20 } }), /denominator/);
assert.throws(() => validateResult({ ...report, hosts: [{ region: 'guessed-region', regionEvidence: null }] }), /region/);
assert.throws(() => validateResult({ ...report, measurements: { ...metrics, gc: { ...metrics.gc, unavailableReason: null } } }), /null reason/);
assert.throws(() => validateResult({ ...report, evidence: { accountToken: 'secret' } }), /private field/);
assert.throws(() => validateResult({ ...report, actors: [actors[0], ...actors.slice(1).map(a => ({ ...a, accountBindingHash: actors[0].accountBindingHash }))] }), /reused/);
console.log('result accounting/provenance/privacy canaries passed; no capacity evidence');
