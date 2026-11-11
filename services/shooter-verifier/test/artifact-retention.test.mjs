import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApprovedArtifact } from '../src/artifacts.mjs';
import { APPROVED } from '../src/approved.mjs';
test('updating current Nakama vendor cannot retire previously approved replay bytes', () => {
  const vendor = new URL('../../../server/modules/vendor/shooter-sim.js', import.meta.url);
  const original = readFileSync(vendor);
  try {
    writeFileSync(vendor, '// a newer current pin must not replace retained worker bytes\n');
    assert.equal(loadApprovedArtifact().api.SOURCE_COMMIT, APPROVED.sourceCommit);
  } finally { writeFileSync(vendor, original); }
});
