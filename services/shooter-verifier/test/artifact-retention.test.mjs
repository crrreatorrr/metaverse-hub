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
test('retained byte or pin corruption refuses execution before simulator loading', () => {
  const dir = `../artifacts/${APPROVED.sha256}/`;
  const bundle = new URL(`${dir}shooter-sim.js`, import.meta.url);
  const pin = new URL(`${dir}shooter-sim.pin.json`, import.meta.url);
  const originalBytes = readFileSync(bundle), originalPin = readFileSync(pin);
  try {
    const tampered = Buffer.from(originalBytes); tampered[tampered.length - 1] ^= 1;
    writeFileSync(bundle, tampered);
    assert.throws(() => loadApprovedArtifact(), /artifact_unavailable/);
    writeFileSync(bundle, originalBytes);
    const wrong = JSON.parse(originalPin); wrong.checkpointSchema = 999;
    writeFileSync(pin, JSON.stringify(wrong));
    assert.throws(() => loadApprovedArtifact(), /artifact_unavailable/);
  } finally { writeFileSync(bundle, originalBytes); writeFileSync(pin, originalPin); }
});
