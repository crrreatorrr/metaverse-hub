// Copy Sproto Racer's server bundle into the hub and move the pin with it.
//
//   node scripts/revendor-racer.mjs <path to a Sproto-Racer checkout>
//
// The checkout must hold the bundle it committed: build/racer-sim.js and build/racer-sim.pin.json
// as `npm run build:server-sim` wrote them there, unchanged since the commit. This script copies
// the bundle to server/modules/vendor/racer-sim.js, writes server/modules/vendor/racer-sim.pin.json
// (the game's pin plus the repo, the commit that last changed the bundle, and the wire version the
// bundle reports), and rewrites the four pinned constants in
// server/modules/src/games/racer_protocol.ts. It builds nothing and deploys nothing.
// server/test/games/racer_match.test.ts then checks that the three agree and that the bundle
// still races to the game's own smoke hash.
//
// A client on another simulation version is refused at HELLO, so the game build that players load
// and this bundle have to go live together.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'crrreatorrr/Sproto-Racer';
const vendorBundle = join(root, 'server/modules/vendor/racer-sim.js');
const vendorPin = join(root, 'server/modules/vendor/racer-sim.pin.json');
const protocol = join(root, 'server/modules/src/games/racer_protocol.ts');

function fail(message) {
  console.error(`revendor-racer: ${message}`);
  process.exit(1);
}

const from = process.argv[2];
if (!from) fail('usage: node scripts/revendor-racer.mjs <path to a Sproto-Racer checkout>');
const game = resolve(from);
const git = (...args) => execFileSync('git', ['-C', game, ...args], { encoding: 'utf8' }).trim();

let bundle;
let gamePin;
try {
  bundle = readFileSync(join(game, 'build/racer-sim.js'), 'utf8');
  gamePin = JSON.parse(readFileSync(join(game, 'build/racer-sim.pin.json'), 'utf8'));
} catch (error) {
  fail(`cannot read the bundle and its pin in ${game}: ${error.message}`);
}
if (git('status', '--porcelain', '--', 'build/racer-sim.js', 'build/racer-sim.pin.json')) {
  fail('build/racer-sim.js or its pin has uncommitted changes there. Commit the bundle in the game first.');
}
const commit = git('log', '-1', '--format=%H', '--', 'build/racer-sim.js');
if (!/^[0-9a-f]{40}$/.test(commit)) fail('no commit holds build/racer-sim.js');

const sha256 = createHash('sha256').update(bundle, 'utf8').digest('hex');
if (gamePin.game !== 'sproto-racer') fail(`the pin is for ${gamePin.game}`);
if (gamePin.bundleSha256 !== sha256) fail(`the bundle hashes to ${sha256} but its pin says ${gamePin.bundleSha256}`);
const header = /^var RACER_SIM_VERSION = '([0-9a-f]{16})';\n/.exec(bundle);
if (!header || header[1] !== gamePin.simVersion) fail('the bundle header and the pin name different simulation versions');

// What the bundle itself reports, in a bare context as Nakama gives it.
const context = vm.createContext({});
vm.runInContext(bundle, context, { filename: 'racer-sim.js' });
const info = vm.runInContext('RacerSim.netInfo()', context);
if (info.simVersion !== gamePin.simVersion) fail(`the bundle reports simulation ${info.simVersion}`);
if (info.tickRate !== 60) fail(`the bundle ticks at ${info.tickRate} Hz; the match is registered at 60`);
if (info.op.HELLO !== 1 || info.op.ERROR !== 19) fail('the HELLO or ERROR opcode moved; update racer_protocol.ts by hand');

const pin = {
  kind: 'sproto-racer-sim-pin',
  repo: REPO,
  commit,
  bundlePath: 'build/racer-sim.js',
  bundleBytes: Buffer.byteLength(bundle, 'utf8'),
  game: gamePin.game,
  netVersion: info.netVersion,
  simVersion: gamePin.simVersion,
  bundleSha256: sha256,
  contentSha256: gamePin.contentSha256,
  smokeHash240: gamePin.smokeHash240,
};

let source = readFileSync(protocol, 'utf8');
for (const [name, value] of [['COMMIT', commit], ['BUNDLE_SHA256', sha256], ['SIM_VERSION', pin.simVersion], ['NET_VERSION', pin.netVersion]]) {
  const line = new RegExp(`(export var ${name} = ")[^"]*(";)`);
  if (!line.test(source)) fail(`racer_protocol.ts has no ${name} constant`);
  source = source.replace(line, `$1${value}$2`);
}

writeFileSync(vendorBundle, bundle);
writeFileSync(vendorPin, `${JSON.stringify(pin, null, 2)}\n`);
writeFileSync(protocol, source);
console.log(`racer-sim ${pin.simVersion} (wire ${pin.netVersion}) from ${REPO}@${commit.slice(0, 8)}, ${pin.bundleBytes} bytes`);
console.log('Now run: npx tsx server/test/games/racer_match.test.ts');
