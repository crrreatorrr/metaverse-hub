// When may sproto-shooter main move past the vendored campaign pin? Mocked
// GitHub compare responses; no network.
import assert from 'node:assert/strict';
import { COMPARE_FILE_LIMIT, decideShooterPin, feedsCampaignBundle } from './shooter-pin-drift.mjs';

const PIN = '5ccaf82a04c8e4233b257b71194ad82d8fd5f022';
const MAIN = '667bfbfa571341bf66380a3efe198b285af2d76e';
const INPUTS = ['src/server/verify.js', 'src/sim/simulate.js', 'src/core/rng.js', 'src/data/serverManifest.js'];

function compare(files, extra = {}) {
  return {
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
    merge_base_commit: { sha: PIN },
    files: files.map((f) => (typeof f === 'string' ? { filename: f, status: 'modified' } : f)),
    ...extra,
  };
}

function decide(over = {}) {
  return decideShooterPin({ pinCommit: PIN, mainSha: MAIN, compare: compare([]), bundleInputs: INPUTS, strict: false, ...over });
}

// Main is the pin: passes in both modes and needs no compare.
for (const strict of [false, true]) {
  const same = decideShooterPin({ pinCommit: PIN, mainSha: PIN, compare: null, bundleInputs: INPUTS, strict });
  assert.equal(same.ok, true);
  assert.equal(same.case, 'pin-is-main');
}

// The real 5ccaf82...667bfbf range: renderer split plus docs. Nothing feeds the bundle.
const rendererSplit = [
  'CODEX_PLAN.md', 'src/audio/sfx.js', 'src/game/Game.js', 'src/game/eventCoverage.js', 'src/game/feel.js',
  'src/render/assets.js', 'src/render/renderer.js', 'src/render/frame/present.js', 'src/save/profile.js',
  'tests/fixtures/asset-manifest.json', 'tests/presentation.test.js', 'tests/renderSplit.test.js',
];
const ok = decide({ compare: compare(rendererSplit) });
assert.equal(ok.ok, true, ok.message);
assert.equal(ok.case, 'ancestor-unchanged');
assert.match(ok.message, /2 commit/);

// --strict keeps the old rule: any move of main fails.
const strict = decide({ compare: compare(rendererSplit), strict: true });
assert.equal(strict.ok, false);
assert.equal(strict.case, 'strict-mismatch');

// A recorded bundle input changed: fail and name it.
const edited = decide({ compare: compare(['README.md', 'src/sim/simulate.js']) });
assert.equal(edited.ok, false);
assert.equal(edited.case, 'bundle-sources-changed');
assert.deepEqual(edited.offending, ['src/sim/simulate.js']);

// Conservative prefixes: a file the bundle does not import today still counts.
for (const path of ['src/sim/newThing.js', 'src/data/levels/new.js', 'src/server/extra.js', 'src/core/eventBus.js']) {
  assert.equal(decide({ compare: compare([path]) }).ok, false, path);
}
// Build tooling and resolver config count anywhere.
for (const path of ['scripts/build-server-sim.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'src/render/jsconfig.json', 'src/x/package.json']) {
  assert.equal(decide({ compare: compare([path]) }).ok, false, path);
}
// The free 1v1 arena is a separate export; its own folder does not feed the campaign bundle...
assert.equal(decide({ compare: compare(['src/sim/pvp/rules.js', 'src/net/socket.js']) }).ok, true);
// ...unless the campaign bundle starts importing from it, which the recorded inputs catch.
assert.equal(decide({ compare: compare(['src/sim/pvp/shared.js']), bundleInputs: [...INPUTS, 'src/sim/pvp/shared.js'] }).ok, false);

// A rename or delete of an input counts by its old name.
const moved = decide({ compare: compare([{ filename: 'src/old/verify.js', previous_filename: 'src/server/verify.js', status: 'renamed' }]) });
assert.equal(moved.ok, false);
assert.deepEqual(moved.offending, ['src/server/verify.js -> src/old/verify.js']);
assert.equal(decide({ compare: compare([{ filename: 'src/core/rng.js', status: 'removed' }]) }).ok, false);

// The pin must be an ancestor of main.
for (const status of ['behind', 'diverged']) {
  const result = decide({ compare: compare([], { status }) });
  assert.equal(result.ok, false);
  assert.equal(result.case, 'not-ancestor');
}
assert.equal(decide({ compare: compare([], { merge_base_commit: { sha: 'f'.repeat(40) } }) }).case, 'not-ancestor');

// A compare GitHub truncated, or none at all, cannot prove anything.
const many = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => `docs/n${i}.md`);
assert.equal(decide({ compare: compare(many) }).case, 'unverifiable');
assert.equal(decide({ compare: null }).case, 'unverifiable');
assert.equal(decide({ compare: { status: 'ahead', merge_base_commit: { sha: PIN } } }).case, 'unverifiable');

// No recorded inputs in the pin: refuse rather than guess.
assert.equal(decide({ bundleInputs: [] }).case, 'unverifiable');

assert.equal(feedsCampaignBundle('README.md', INPUTS), false);
assert.equal(feedsCampaignBundle('src/sim/simulate.js', INPUTS), true);

console.log('shooter pin drift ok');
