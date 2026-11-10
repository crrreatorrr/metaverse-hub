// Offline checks for scripts/revendor-shooter-pvp.mjs (no fetch, no npm).
//   node scripts/revendor-shooter-pvp.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkBundle, contractChangeRefused, contractDiff, hubPinOf, scrubEnv, withScratch } from './revendor-shooter-pvp.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = readFileSync(`${root}/server/modules/vendor/shooter-pvp-sim.js`, 'utf8');
const vendoredPin = JSON.parse(readFileSync(`${root}/server/modules/vendor/shooter-pvp-sim.pin.json`, 'utf8'));

// Hub keys win over whatever the fetched build's pin says.
const forged = { ...vendoredPin, kind: 'evil', repo: 'evil/repo', commit: 'f'.repeat(40), sha256: 'e'.repeat(64), golden: { tick: 1 } };
const hub = hubPinOf(forged, { commit: 'a'.repeat(40), sha256: 'b'.repeat(64), golden: { seed: 7, tick: 65 }, esbuild: '0.25.12', goja: 'g' });
assert.equal(hub.kind, 'sproto-shooter-pvp-pin');
assert.equal(hub.repo, 'crrreatorrr/sproto-shooter');
assert.equal(hub.commit, 'a'.repeat(40));
assert.equal(hub.sha256, 'b'.repeat(64));
assert.equal(hub.golden.tick, 65);

// Contract fields are compared, limits included.
assert.deepEqual(contractDiff(vendoredPin, { ...vendoredPin }), []);
assert.deepEqual(contractDiff(vendoredPin, { ...vendoredPin, limits: { ...vendoredPin.limits, futureFrames: 9 } }), ['limits']);
assert.deepEqual(contractDiff(vendoredPin, { ...vendoredPin, rewind: { ...vendoredPin.rewind, maxBackStep: 3 } }), ['rewind']);
assert.deepEqual(contractDiff(vendoredPin, { ...vendoredPin, replayVersion: 3, combatSeed: 'other' }), ['replayVersion', 'combatSeed']);
assert.equal(contractChangeRefused([], { pvpOnly: false }), false);
assert.equal(contractChangeRefused(['contentFingerprint'], { pvpOnly: false }), false);
assert.equal(contractChangeRefused(['contentFingerprint'], { pvpOnly: true }), true);
assert.equal(contractChangeRefused(['contentFingerprint', 'limits'], { pvpOnly: false }), true);

// The fetched build runs without the caller's secrets.
const env = scrubEnv({
  PATH: '/bin', HOME: '/root', HTTPS_PROXY: 'http://p', https_proxy: 'http://p', NO_PROXY: 'x', NODE_EXTRA_CA_CERTS: '/ca',
  GITHUB_TOKEN: 'secret', GH_TOKEN: 'secret', NPM_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', NAKAMA_SERVER_KEY: 'secret',
});
assert.deepEqual(Object.keys(env).sort(), ['HOME', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'NO_PROXY', 'PATH', 'https_proxy']);

// A failure inside the scratch step still removes the scratch directory.
let scratch = '';
assert.throws(() => withScratch((dir) => {
  scratch = dir;
  throw new Error('build failed');
}), /build failed/);
assert.ok(scratch && !existsSync(scratch), 'scratch directory removed after a failure');

// The vendored bundle: the mirrored golden, and a hosted-director match whose replay record verifies.
const checked = checkBundle(bundle, vendoredPin.commit);
assert.equal(checked.golden.tick, 65);
assert.equal(checked.golden.stateHash, '532a562e');
assert.equal(checked.hosted.verified, true);
assert.equal(checked.hosted.policy, 'settle');
assert.throws(() => checkBundle(bundle, 'c'.repeat(40)), /commit/);

console.log(`revendor-shooter-pvp ok (hosted ${checked.hosted.outcome}/${checked.hosted.reason} at ${checked.hosted.tick}, policy ${checked.hosted.policy})`);
