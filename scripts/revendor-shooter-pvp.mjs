// Re-vendor the Shooter free-arena bundle (and, when it is unchanged apart
// from the baked commit, re-pin the campaign verifier) from one sproto-shooter
// commit. One command:
//
//   node scripts/revendor-shooter-pvp.mjs <40-hex sproto-shooter commit> [--pvp-only]
//
// It fetches only that commit into a scratch directory (shallow, blob-less,
// sparse), installs the esbuild version that commit's package-lock.json pins
// into a second scratch directory, runs the commit's own
// scripts/build-server-sim.mjs, and deletes both directories afterwards.
// Then it:
//   - copies build/shooter-pvp-sim.js to server/modules/vendor/ and writes
//     shooter-pvp-sim.pin.json (the build's pin plus kind/repo/commit/sha256
//     and the golden it measured by running the bundle);
//   - updates ShooterProto.COMMIT / BUNDLE_SHA256 (tests and the load script
//     read the pin file);
//   - re-pins the campaign verifier (vendor/shooter-sim.js) to the same commit
//     when its bundle is byte-identical to the vendored one once the baked
//     commit is normalized, so the campaign pin check accepts the new shooter
//     main. A campaign bundle that changed in any other way stops the script:
//     that is a campaign re-vendor with its own review (--pvp-only skips it).
// Nothing in the repo is written until every check above has passed.
// It refuses when protocol, sim, content fingerprint, loadout hash, limits or
// the golden differ from what shooter_protocol.ts expects: those are a code
// change, not a re-vendor.
//
// After the sproto-shooter stack merges: run it with the merged main SHA, then
// node scripts/check-shooter-pvp-sim-version.mjs,
// node scripts/check-shooter-sim-version.mjs and the hub checks.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'crrreatorrr/sproto-shooter';
const VENDOR = join(root, 'server/modules/vendor');
const PROTOCOL_TS = join(root, 'server/modules/src/games/shooter_protocol.ts');
const REWARDS_TS = join(root, 'server/modules/src/games/shooter_rewards.ts');
const PLACEHOLDER = '0000000000000000000000000000000000000000';
/** "The campaign pin did not move" tripwires that spell out its sha256. */
const CAMPAIGN_TRIPWIRES = [
  'server/test/games/shooter_match.test.ts',
  'scripts/check-shooter-pvp-sim-version.mjs',
];

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function assigned(source, name) {
  const match = new RegExp(`export var ${name} = ("([^"]*)"|(\\d+))`).exec(source);
  if (!match) return undefined;
  return match[2] !== undefined ? match[2] : Number(match[3]);
}

function setVar(source, name, value) {
  const re = new RegExp(`(export var ${name} = )"[^"]*"`);
  if (!re.test(source)) fail(`no ${name} constant to update`);
  return source.replace(re, `$1"${value}"`);
}

function load(src) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'shooter-pvp-sim.js' });
  return sandbox.SprotoShooterPvp;
}

/** The mirrored sim golden: seed 7, both seats walk forward firing, 180 ticks. */
function golden(api) {
  const director = api.createDirector({ seed: 7, matchId: 'golden' });
  const hello = (id) => JSON.stringify({ accountId: id, protocol: api.PVP_PROTOCOL_VERSION, sim: api.PVP_SIM_VERSION, content: api.CONTENT_FINGERPRINT });
  director.handle({ userId: 'a', sessionId: 'sa' }, 1, hello('a'), 0);
  director.handle({ userId: 'b', sessionId: 'sb' }, 1, hello('b'), 0);
  director.handle({ userId: 'a', sessionId: 'sa' }, 4, JSON.stringify({ accountId: 'a' }), 0);
  director.handle({ userId: 'b', sessionId: 'sb' }, 4, JSON.stringify({ accountId: 'b' }), 0);
  const yaws = [director.sim.players[0].yaw, director.sim.players[1].yaw];
  const inputs = [];
  for (let i = 0; i < 180; i++) {
    inputs.push(yaws.map((yaw) => ({
      yaw, pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, sprint: false, jump: false, dash: false, reload: false, slot: 0,
    })));
  }
  const out = JSON.parse(api.replayJSON(JSON.stringify({ seed: 7, inputs })));
  return { seed: 7, outcome: out.outcome, reason: out.reason, winner: out.winner, tick: out.tick, stateHash: out.stateHash };
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const pvpOnly = args.includes('--pvp-only');
const commit = String(args.find((arg) => !arg.startsWith('--')) || '');
if (!/^[0-9a-f]{40}$/.test(commit)) fail('usage: node scripts/revendor-shooter-pvp.mjs <40-hex sproto-shooter commit> [--pvp-only]');

const work = mkdtempSync(join(tmpdir(), 'shooter-revendor-'));
const clone = join(work, 'src');
const tools = join(work, 'tools');
let built;
try {
  mkdirSync(clone);
  run('git', ['init', '-q'], clone);
  run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`], clone);
  run('git', ['config', 'core.sparseCheckout', 'true'], clone);
  writeFileSync(join(clone, '.git/info/sparse-checkout'), '/src/\n/scripts/\n/package.json\n/package-lock.json\n');
  run('git', ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', commit], clone);
  run('git', ['checkout', '-q', 'FETCH_HEAD'], clone);
  const head = run('git', ['rev-parse', 'HEAD'], clone).trim();
  if (head !== commit) fail(`fetched ${head}, wanted ${commit}`);
  const lock = JSON.parse(readFileSync(join(clone, 'package-lock.json'), 'utf8'));
  const esbuild = lock.packages && lock.packages['node_modules/esbuild'] ? lock.packages['node_modules/esbuild'].version : '';
  if (!/^\d+\.\d+\.\d+$/.test(esbuild)) fail('package-lock.json pins no esbuild version');
  mkdirSync(tools);
  writeFileSync(join(tools, 'package.json'), '{"private":true}\n');
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', `esbuild@${esbuild}`], tools);
  mkdirSync(join(clone, 'node_modules'));
  symlinkSync(join(tools, 'node_modules/esbuild'), join(clone, 'node_modules/esbuild'), 'dir');
  run(process.execPath, ['scripts/build-server-sim.mjs'], clone);
  built = {
    esbuild,
    pvp: readFileSync(join(clone, 'build/shooter-pvp-sim.js'), 'utf8'),
    pvpPin: JSON.parse(readFileSync(join(clone, 'build/shooter-pvp-sim.pin.json'), 'utf8')),
    campaign: readFileSync(join(clone, 'build/shooter-sim.js'), 'utf8'),
    campaignPin: JSON.parse(readFileSync(join(clone, 'build/shooter-sim.pin.json'), 'utf8')),
  };
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ---- free arena
const writes = [];
const pin = built.pvpPin;
if (pin.sourceCommit !== commit) fail(`build pinned ${pin.sourceCommit}`);
if (sha256(built.pvp) !== pin.bundleSha256) fail('build pin sha256 does not match its bundle');
let proto = readFileSync(PROTOCOL_TS, 'utf8');
const want = {
  protocol: assigned(proto, 'PROTOCOL'),
  sim: assigned(proto, 'SIM'),
  contentFingerprint: assigned(proto, 'FINGERPRINT'),
  loadoutHash: assigned(proto, 'LOADOUT_HASH'),
};
for (const key of Object.keys(want)) {
  if (pin[key] !== want[key]) fail(`${key} ${pin[key]} != shooter_protocol.ts ${want[key]}: a contract change, not a re-vendor`);
}
const api = load(built.pvp);
if (!api || api.SOURCE_COMMIT !== commit) fail('bundle does not bake the commit');
const measured = golden(api);
const goldenTick = assigned(proto, 'GOLDEN_TICK');
const goldenHash = assigned(proto, 'GOLDEN_HASH');
if (measured.tick !== goldenTick || measured.stateHash !== goldenHash) {
  fail(`golden ${measured.tick} ${measured.stateHash} != shooter_protocol.ts ${goldenTick} ${goldenHash}`);
}
const oldPin = JSON.parse(readFileSync(join(VENDOR, 'shooter-pvp-sim.pin.json'), 'utf8'));
const hubPin = {
  kind: 'sproto-shooter-pvp-pin',
  repo: REPO,
  commit,
  sha256: pin.bundleSha256,
  ...pin,
  golden: measured,
  esbuild: built.esbuild,
  goja: oldPin.goja,
  node: '>=22',
};
proto = setVar(proto, 'COMMIT', commit);
proto = setVar(proto, 'BUNDLE_SHA256', pin.bundleSha256);
writes.push([join(VENDOR, 'shooter-pvp-sim.js'), built.pvp]);
writes.push([join(VENDOR, 'shooter-pvp-sim.pin.json'), `${JSON.stringify(hubPin, null, 2)}\n`]);
writes.push([PROTOCOL_TS, proto]);
console.log(`pvp: ${commit} ${pin.bundleSha256} protocol ${pin.protocol} sim ${pin.sim} content ${pin.contentFingerprint} golden ${measured.tick} ${measured.stateHash}`);

// ---- campaign verifier: re-pin only when nothing but the baked commit moved
const campaignPinPath = join(VENDOR, 'shooter-sim.pin.json');
const campaignPin = JSON.parse(readFileSync(campaignPinPath, 'utf8'));
const vendoredCampaign = readFileSync(join(VENDOR, 'shooter-sim.js'), 'utf8');
const normalize = (src, at) => src.split(at).join(PLACEHOLDER);
if (pvpOnly) {
  console.log('campaign: skipped (--pvp-only)');
} else if (campaignPin.commit === commit) {
  console.log('campaign: already pinned to this commit');
} else if (normalize(vendoredCampaign, campaignPin.commit) !== normalize(built.campaign, commit)) {
  fail(`campaign bundle changed at ${commit} beyond the baked commit: re-vendor it separately, or pass --pvp-only (nothing was written)`);
} else {
  const cSha = sha256(built.campaign);
  const next = { ...campaignPin, commit, sourceCommit: commit, sha256: cSha, bundleSha256: cSha, bundleBytes: Buffer.byteLength(built.campaign) };
  let rewards = readFileSync(REWARDS_TS, 'utf8');
  rewards = setVar(rewards, 'COMMIT', commit);
  rewards = setVar(rewards, 'BUNDLE_SHA256', cSha);
  writes.push([join(VENDOR, 'shooter-sim.js'), built.campaign]);
  writes.push([campaignPinPath, `${JSON.stringify(next, null, 2)}\n`]);
  writes.push([REWARDS_TS, rewards]);
  // The "campaign pin did not move" tripwires name its sha256.
  for (const rel of CAMPAIGN_TRIPWIRES) {
    const file = join(root, rel);
    const text = readFileSync(file, 'utf8');
    if (!text.includes(campaignPin.sha256)) fail(`${rel} does not name the campaign sha256`);
    writes.push([file, text.split(campaignPin.sha256).join(cSha)]);
  }
  console.log(`campaign: re-pinned ${campaignPin.commit} -> ${commit} (${cSha}), bundle unchanged apart from the commit`);
}

for (const [file, text] of writes) writeFileSync(file, text);
console.log('next: node scripts/check-shooter-pvp-sim-version.mjs && node scripts/check-shooter-sim-version.mjs && npm test');
