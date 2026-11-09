// Fail when the vendored Shooter verifier disagrees with its pin or the
// campaign contract. Shooter main must be the pin commit, or a descendant
// whose sim, protocol, content, and bundle-build files are unchanged.
//
//   node scripts/check-shooter-sim-version.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertShooterMain } from './shooter-main-pin.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = join(root, 'server/modules/vendor/shooter-sim.js');
const pinPath = join(root, 'server/modules/vendor/shooter-sim.pin.json');
const sourcePath = join(root, 'server/modules/src/games/shooter_rewards.ts');
const runsPath = join(root, 'server/modules/src/games/shooter_runs.ts');
const REPO = 'crrreatorrr/sproto-shooter';
const FINGERPRINT = '3c657fb5';

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
  if (pin.kind !== 'sproto-shooter-sim-pin') errors.push(`${label} kind`);
  if (pin.repo !== REPO) errors.push(`${label} repo`);
  if (!/^[0-9a-f]{40}$/.test(String(pin.commit || ''))) errors.push(`${label} commit`);
  if (!/^[0-9a-f]{64}$/.test(String(pin.sha256 || ''))) errors.push(`${label} sha256`);
  if (pin.fingerprint !== FINGERPRINT) errors.push(`${label} fingerprint`);
  if (pin.protocol !== 1 || pin.protocolVersion !== 1) errors.push(`${label} protocol`);
  if (pin.sha256 !== pin.bundleSha256) errors.push(`${label} sha256 != bundleSha256`);
  if (pin.fingerprint !== pin.contentFingerprint) errors.push(`${label} fingerprint != contentFingerprint`);
  if (pin.commit !== pin.sourceCommit) errors.push(`${label} commit != sourceCommit`);
  if (pin.gameId !== 'sproto-shooter') errors.push(`${label} gameId`);
  if (pin.mintsTickets !== false) errors.push(`${label} mintsTickets`);
  if (pin.entry !== 'verifyRun' || pin.jsonEntry !== 'verifyRunJSON') errors.push(`${label} entry`);
  return { pin, errors };
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
  if (!bundle.includes(Buffer.from(pin ? pin.commit : ''))) errors.push('bundle does not bake the pinned commit');

  const source = readFileSync(sourcePath, 'utf8');
  const runs = readFileSync(runsPath, 'utf8');
  if (pin) {
    if (assigned(source, 'COMMIT') !== pin.commit) errors.push('ShooterRewards.COMMIT != pin commit');
    if (assigned(source, 'BUNDLE_SHA256') !== pin.sha256) errors.push('ShooterRewards.BUNDLE_SHA256 != pin sha256');
    if (assigned(source, 'FINGERPRINT') !== pin.fingerprint) errors.push('ShooterRewards.FINGERPRINT != pin fingerprint');
    if (assigned(source, 'REPO') !== pin.repo) errors.push('ShooterRewards.REPO != pin repo');
  }
  if (!source.includes('export var PROTOCOL = 1')) errors.push('protocol constant');
  if (!runs.includes('verifyRuntime') || !runs.includes('seenDigests') || !runs.includes('payable')) {
    errors.push('submit does not check the pin before verify');
  }
  if (!source.includes("tickets = 20") && !source.includes('tickets = 20')) errors.push('settlement amount is not fixed at 20');
  if (source.includes("event_type") && source.includes('sproto-shooter') && source.includes('INSERT INTO game.event_rule')) {
    errors.push('shooter migration inserts an event_rule');
  }

  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle.toString('utf8'), sandbox, { filename: 'shooter-sim.js' });
  const api = sandbox.SprotoShooterSim;
  if (!api || typeof api.verifyRun !== 'function' || typeof api.buildIssuance !== 'function') {
    errors.push('bundle did not export verifyRun and buildIssuance');
  } else {
    if (api.PROTOCOL_VERSION !== 1) errors.push('bundle protocol');
    if (api.SOURCE_COMMIT !== (pin && pin.commit)) errors.push(`bundle commit ${api.SOURCE_COMMIT}`);
    const fingerprint = api.contentFingerprintOf();
    if (fingerprint !== FINGERPRINT) errors.push(`bundle fingerprint ${fingerprint}`);
    const economy = api.ECONOMY || {};
    if (economy.mintsTickets !== false || economy.ticketsMintedByArtifact !== 0 || economy.wagerMayCreateTickets !== false) {
      errors.push('bundle economy can mint');
    }
    const forged = api.buildIssuance({ canonicalBoss: 'obamaDuo', accountId: 'a', sessionId: 'b', day: '2026-11-07', runId: 'c', seed: 1 });
    if (forged.ok || forged.reason !== 'obama_is_one' || forged.ticketsMinted !== 0) errors.push('obamaDuo was not rejected');
    const agent = api.buildIssuance({ canonicalBoss: 'agent', accountId: 'a', sessionId: 'b', day: '2026-11-07', runId: 'c', seed: 1 });
    if (agent.ok || agent.reason !== 'glowie_not_agent' || agent.ticketsMinted !== 0) errors.push('agent was not kept off glowie');
    const bad = JSON.parse(api.verifyRunJSON('{"log":{"v":2},"ctx":{}}'));
    if (bad.ok || bad.ticketsMinted !== 0) errors.push('unsupported log minted or was accepted');
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
  if (main.same) console.log(`Shooter main ${main.main} matches pin`);
  else console.log(`Shooter main ${main.main} is ahead of pin ${local.pin.commit} with no sim source changes (${main.files.length} other files)`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log(`PASS: shooter-sim ${local.hash} protocol ${local.pin.protocol} fingerprint ${local.pin.fingerprint}`);
