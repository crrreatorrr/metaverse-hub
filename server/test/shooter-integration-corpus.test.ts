// Input preservation gate only. Full-stack execution is a separate PR18 stage.
import assert from 'node:assert/strict';
import { integrationCases, loadFrozenTrace, reboundBatches, type TrustedActor } from './dup/shooter_verification_e2e_fixtures';

const runId = 'a0180000-0000-4000-8000-000000000001';
let cases = 0;
for (const definition of integrationCases) {
  const trace = loadFrozenTrace(definition.id);
  const actor = { runId, trace } as TrustedActor;
  for (const cadence of [120, 28800]) {
    const batches = reboundBatches(actor, cadence);
    assert.equal(batches.reduce((sum, row) => sum + row.n, 0), definition.frames);
    assert.equal(batches.map(row => row.frames).join(''), trace.frames, 'every original frame is retained');
    assert.deepEqual(batches.flatMap(row => row.actions.map(action => [row.tick0 + action[0]!, action[1]])), trace.actions);
  }
  cases += 1;
  console.log(`PASS corpus-input ${definition.id} ${definition.frames} frames, exact approved file SHA and unchanged actions`);
}
assert.equal(cases, 12);
console.log('12 input-preservation cases passed; this is not Hub/isolated-worker/browser integration evidence');
