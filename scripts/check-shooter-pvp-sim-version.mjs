// Fail when the vendored free-arena bundle disagrees with its pin or the
// campaign pin. Shooter main must be the pin commit, or a descendant whose
// sim, protocol, content, and bundle-build files are unchanged
// (scripts/shooter-main-pin.mjs). A pin built from an unmerged sproto-shooter
// branch fails here on purpose: re-vendor from the merged main SHA with
//   node scripts/revendor-shooter-pvp.mjs <sha>
//
//   node scripts/check-shooter-pvp-sim-version.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertShooterMain } from './shooter-main-pin.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = join(root, 'server/modules/vendor/shooter-pvp-sim.js');
const pinPath = join(root, 'server/modules/vendor/shooter-pvp-sim.pin.json');
const campaignPinPath = join(root, 'server/modules/vendor/shooter-sim.pin.json');
const protocolPath = join(root, 'server/modules/src/games/shooter_protocol.ts');
const REPO = 'crrreatorrr/sproto-shooter';
const PROTOCOL = 2;
const SIM = 2;
const FINGERPRINT = '17d87c54';
const LOADOUT = '4cdfab55';
const CAMPAIGN_FINGERPRINT = '3c657fb5';
const CAMPAIGN_SHA = 'aad5daf5b63c6b71309635bd98e48d8019c8fa2ba5f4736c2a8bb3d241e9576d';
const GOLDEN = { outcome: 'draw', reason: 'double_ko', winner: null, tick: 65, stateHash: '6545ca0a' };
// The director v2 limits shooter_protocol.ts verifyRuntime() requires. A bundle
// with other limits marks every match broken (limits_mismatch).
const LIMITS = {
  frameBytes: 18, maxFramesPerSecond: 45, futureFrames: 8, maxFramesPerCursor: 9, maxHelloPerSecond: 2, maxReadyPerSecond: 2,
};
const REWIND = { maxRttMs: 1000, maxBackStep: 2 };
const REPLAY_LIMITS = { maxTicks: 2700, maxBytes: 524288 };

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function assigned(source, name) {
  const match = new RegExp(`export var ${name} = "([^"]+)"`).exec(source);
  return match ? match[1] : undefined;
}

function loadPin(text, label) {
  const pin = JSON.parse(text);
  const errors = [];
  if (pin.kind !== 'sproto-shooter-pvp-pin') errors.push(`${label} kind`);
  if (pin.repo !== REPO) errors.push(`${label} repo`);
  if (pin.artifact !== 'shooter-pvp') errors.push(`${label} artifact`);
  if (!/^[0-9a-f]{40}$/.test(String(pin.commit || ''))) errors.push(`${label} commit`);
  if (!/^[0-9a-f]{64}$/.test(String(pin.sha256 || ''))) errors.push(`${label} sha256`);
  if (pin.contentFingerprint !== FINGERPRINT) errors.push(`${label} fingerprint`);
  if (pin.loadoutHash !== LOADOUT) errors.push(`${label} loadout`);
  if (pin.protocol !== PROTOCOL || pin.sim !== SIM) errors.push(`${label} protocol`);
  const limits = pin.limits || {};
  for (const key of Object.keys(LIMITS)) if (limits[key] !== LIMITS[key]) errors.push(`${label} limits.${key}`);
  const rewind = pin.rewind || {};
  for (const key of Object.keys(REWIND)) if (rewind[key] !== REWIND[key]) errors.push(`${label} rewind.${key}`);
  const replayLimits = pin.replayLimits || {};
  for (const key of Object.keys(REPLAY_LIMITS)) if (replayLimits[key] !== REPLAY_LIMITS[key]) errors.push(`${label} replayLimits.${key}`);
  if (pin.directorState !== 3 || pin.replayVersion !== 2) errors.push(`${label} director/replay version`);
  if (pin.combatSeed !== 'sha256-commit-reveal-128' || pin.crits !== false) errors.push(`${label} combat seed`);
  if (pin.sha256 !== pin.bundleSha256) errors.push(`${label} sha256 != bundleSha256`);
  if (pin.commit !== pin.sourceCommit) errors.push(`${label} commit != sourceCommit`);
  if (pin.mintsTickets !== false || pin.stakes !== false) errors.push(`${label} economy`);
  if (pin.entry !== 'replayJSON' || pin.global !== 'SprotoShooterPvp') errors.push(`${label} entry`);
  if (pin.campaignContentFingerprint !== CAMPAIGN_FINGERPRINT || pin.campaignProtocol !== 1) errors.push(`${label} campaign`);
  const golden = pin.golden || {};
  if (golden.seed !== 7 || golden.tick !== GOLDEN.tick || golden.stateHash !== GOLDEN.stateHash || golden.reason !== GOLDEN.reason) {
    errors.push(`${label} golden`);
  }
  return { pin, errors };
}

function scripted(api) {
  const director = api.createDirector({ seed: 7, matchId: 'golden' });
  const hello = (id) => JSON.stringify({ accountId: id, protocol: PROTOCOL, sim: SIM, content: api.CONTENT_FINGERPRINT });
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
  return JSON.parse(api.replayJSON(JSON.stringify({ seed: 7, inputs })));
}

function checkLocal() {
  const errors = [];
  const bundle = readFileSync(bundlePath);
  const hash = sha256(bundle);
  let pin = null;
  try {
    const loaded = loadPin(readFileSync(pinPath, 'utf8'), 'pin');
    pin = loaded.pin;
    errors.push(...loaded.errors);
  } catch (error) {
    errors.push(`could not read pin: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pin && hash !== pin.sha256) errors.push(`bundle sha256 ${hash} != pin ${pin.sha256}`);
  if (pin && bundle.length !== pin.bundleBytes) errors.push('bundle bytes');
  if (!bundle.includes(Buffer.from(pin ? pin.commit : ''))) errors.push('bundle does not bake the pinned commit');

  const campaign = JSON.parse(readFileSync(campaignPinPath, 'utf8'));
  if (campaign.fingerprint !== CAMPAIGN_FINGERPRINT || campaign.sha256 !== CAMPAIGN_SHA || campaign.protocol !== 1) {
    errors.push('campaign pin moved');
  }
  if (campaign.entry !== 'verifyRun') errors.push('campaign entry');

  const source = readFileSync(protocolPath, 'utf8');
  if (pin) {
    if (assigned(source, 'COMMIT') !== pin.commit) errors.push('ShooterProto.COMMIT != pin commit');
    if (assigned(source, 'BUNDLE_SHA256') !== pin.sha256) errors.push('ShooterProto.BUNDLE_SHA256 != pin sha256');
    if (assigned(source, 'FINGERPRINT') !== pin.contentFingerprint) errors.push('ShooterProto.FINGERPRINT != pin');
    if (assigned(source, 'LOADOUT_HASH') !== pin.loadoutHash) errors.push('ShooterProto.LOADOUT_HASH != pin');
    if (assigned(source, 'REPO') !== pin.repo) errors.push('ShooterProto.REPO != pin repo');
    if (assigned(source, 'CAMPAIGN_FINGERPRINT') !== CAMPAIGN_FINGERPRINT) errors.push('campaign fingerprint constant');
  }
  if (!source.includes(`export var PROTOCOL = ${PROTOCOL};`) || !source.includes(`export var SIM = ${SIM};`)) errors.push('protocol constant');
  if (!source.includes(`export var GOLDEN_TICK = ${GOLDEN.tick};`) || assigned(source, 'GOLDEN_HASH') !== GOLDEN.stateHash) errors.push('golden constant');
  if (!source.includes('export var MATCH_NAME = "sproto_shooter_free"')) errors.push('match name');
  if (source.includes('sproto_arena') || source.includes('sproto_duel')) errors.push('fighter match id reused');

  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle.toString('utf8'), sandbox, { filename: 'shooter-pvp-sim.js' });
  const api = sandbox.SprotoShooterPvp;
  if (!api || typeof api.replayJSON !== 'function' || typeof api.createHostedDirector !== 'function' || typeof api.restoreDirector !== 'function') {
    errors.push('bundle did not export replayJSON, createHostedDirector and restoreDirector');
  } else {
    if (api.PVP_PROTOCOL_VERSION !== PROTOCOL || api.PVP_SIM_VERSION !== SIM) errors.push('bundle protocol');
    if (api.OP.PING !== 10 || api.OP.PONG !== 11) errors.push('bundle PING/PONG opcodes');
    for (const key of Object.keys(LIMITS)) if (api.INPUT_LIMITS[key] !== LIMITS[key]) errors.push(`bundle limits.${key}`);
    let threw = false;
    try {
      api.createHostedDirector({ spawnSeed: 7, matchId: 'm' });
    } catch {
      threw = true;
    }
    if (!threw) errors.push('createHostedDirector accepted a missing combat seed');
    const hosted = api.createHostedDirector({ spawnSeed: 7, combatSeed: 'ab'.repeat(16), matchId: 'm' });
    if (hosted.combatSeedDerived !== false) errors.push('hosted director derived its combat seed');
    if (api.SOURCE_COMMIT !== (pin && pin.commit)) errors.push(`bundle commit ${api.SOURCE_COMMIT}`);
    if (api.CONTENT_FINGERPRINT !== FINGERPRINT) errors.push(`bundle fingerprint ${api.CONTENT_FINGERPRINT}`);
    if (api.LOADOUT_HASH !== LOADOUT) errors.push(`bundle loadout ${api.LOADOUT_HASH}`);
    const economy = api.ECONOMY || {};
    if (economy.mintsTickets !== false || economy.stakes !== false || economy.wagerMayCreateTickets !== false || economy.ticketsMintedByArtifact !== 0) {
      errors.push('bundle economy can mint or stake');
    }
    const forged = JSON.parse(api.replayJSON('{"seed":1,"inputs":[null]}'));
    if (forged.ticketsMinted !== 0) errors.push('replay minted');
    const nan = JSON.parse(api.replayJSON('{"seed":NaN}'));
    if (nan.ok !== false || nan.ticketsMinted !== 0) errors.push('NaN replay was accepted');
    const golden = scripted(api);
    if (golden.outcome !== GOLDEN.outcome || golden.reason !== GOLDEN.reason || golden.winner !== null || golden.tick !== GOLDEN.tick || golden.stateHash !== GOLDEN.stateHash || golden.ticketsMinted !== 0) {
      errors.push(`golden ${golden.outcome} ${golden.reason} ${golden.tick} ${golden.stateHash}`);
    }
  }
  return { errors, pin, hash };
}

const local = checkLocal();
if (local.errors.length || !local.pin) {
  for (const error of local.errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}
try {
  const main = await assertShooterMain(local.pin.commit);
  if (main.same) console.log(`Shooter main ${main.main} matches pvp pin`);
  else console.log(`Shooter main ${main.main} is ahead of pin ${local.pin.commit} with no sim source changes (${main.files.length} other files)`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error('A pin from an unmerged sproto-shooter branch fails here. Re-vendor from merged main: node scripts/revendor-shooter-pvp.mjs <sha>');
  process.exit(1);
}
console.log(`PASS: shooter-pvp-sim ${local.hash} protocol ${local.pin.protocol} sim ${local.pin.sim} fingerprint ${local.pin.contentFingerprint}`);
