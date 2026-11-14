// Fail when the vendored Coop simulation disagrees with its pin, with the
// fingerprints the match requires, or with Sproto-Coop-Battle. main.
//
//   node scripts/check-coop-sim-version.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = join(root, 'server/modules/vendor/coop-sim.js');
const pinPath = join(root, 'server/modules/vendor/coop-sim.pin.json');
const protoPath = join(root, 'server/modules/src/games/coop_protocol.ts');
const matchPath = join(root, 'server/modules/src/games/coop_match.ts');
const REPO = 'crrreatorrr/Sproto-Coop-Battle.';
const FILES = ['public/js/manifest.js', 'public/js/sim.js', 'public/js/ai.js', 'public/js/net-protocol.js'];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function assigned(source, name) {
  const string = new RegExp(`export var ${name} = "([^"]+)"`).exec(source);
  if (string) return string[1];
  const number = new RegExp(`export var ${name} = (\\d+);`).exec(source);
  return number ? Number(number[1]) : undefined;
}

function loadPin(text, label) {
  const pin = JSON.parse(text);
  const errors = [];
  if (pin.kind !== 'sproto-coop-battle-sim-pin') errors.push(`${label} kind`);
  if (pin.repo !== REPO) errors.push(`${label} repo`);
  if (!/^[0-9a-f]{40}$/.test(String(pin.commit || ''))) errors.push(`${label} commit`);
  if (!/^[0-9a-f]{64}$/.test(String(pin.sha256 || ''))) errors.push(`${label} sha256`);
  if (!/^[0-9a-f]{64}$/.test(String(pin.fingerprint || ''))) errors.push(`${label} fingerprint`);
  if (pin.protocol !== 1 || pin.protocolVersion !== 1) errors.push(`${label} protocol`);
  if (pin.sha256 !== pin.bundleSha256) errors.push(`${label} sha256 != bundleSha256`);
  if (pin.fingerprint !== pin.contentSha256) errors.push(`${label} fingerprint != contentSha256`);
  if (pin.gameId !== 'sproto-coop-battle') errors.push(`${label} gameId`);
  if (pin.stateVersion !== 1 || pin.simHz !== 60 || pin.loopHz !== 20 || pin.substeps !== 3) errors.push(`${label} loop`);
  if (pin.snapshotHz !== 10 || pin.snapshotMaxHz !== 15 || pin.reconnectGraceMs !== 15000) errors.push(`${label} rates`);
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

  const proto = readFileSync(protoPath, 'utf8');
  const match = readFileSync(matchPath, 'utf8');
  if (pin) {
    for (const name of ['REPO', 'COMMIT', 'BUNDLE_SHA256', 'FINGERPRINT']) {
      const key = name === 'BUNDLE_SHA256' ? 'sha256' : name.toLowerCase();
      if (assigned(proto, name) !== pin[key]) errors.push(`CoopProto.${name} != pin ${key}`);
    }
    if (assigned(proto, 'PROTOCOL') !== pin.protocol) errors.push('CoopProto.PROTOCOL != pin protocol');
    if (assigned(proto, 'GAME_ID') !== pin.gameId) errors.push('CoopProto.GAME_ID != pin gameId');
  }
  if (!proto.includes('=== FINGERPRINT') || !proto.includes('=== PROTOCOL')) errors.push('runtime version compare is missing');
  if (!match.includes('version_mismatch') || !match.includes('versionsMatch')) errors.push('HELLO does not reject a version mismatch');
  if (!match.includes('hostTakeover: 0') || !/rewards:\s*0/.test(match)) errors.push('match does not force zero rewards and no host takeover');

  const sandbox = { console: { log() {} } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle.toString('utf8'), sandbox, { filename: 'coop-sim.js' });
  const api = sandbox.CoopProtocol;
  if (!api || !sandbox.Sim || !sandbox.SproAI || !sandbox.MANIFEST) errors.push('bundle did not export Sim, SproAI, CoopProtocol, and MANIFEST');
  else {
    if (api.PROTOCOL_VERSION !== 1 || api.LIMITS.loopHz !== 20 || api.LIMITS.substeps !== 3 || api.LIMITS.simHz !== 60) errors.push('bundle limits != 60/20/3');
    if (api.LIMITS.snapshotHz !== 10 || api.LIMITS.snapshotMaxHz !== 15 || api.LIMITS.reconnectGraceMs !== 15000) errors.push('bundle snapshot or reconnect contract');
    if (api.LIMITS.maxSeats !== 4) errors.push('bundle seat cap');
    const content = sha256(JSON.stringify(api.contentManifest(sandbox.MANIFEST)));
    if (pin && content !== pin.fingerprint) errors.push(`content fingerprint ${content} != pin ${pin.fingerprint}`);
    const banked = api.createMatch({ mode: 'banked', seed: 1, stage: 3 });
    if (banked.ok) errors.push('banked create accepted a client stage');
    const session = api.createMatch({ mode: 'banked', seed: 3, matchId: 'pin-check' });
    if (!session.ok) errors.push(`banked create failed: ${session.reason}`);
    else {
      for (const kind of ['god', 'stage', 'state', 'seed', 'earn', 'score']) {
        const result = api.command(session.session, { t: kind }, 1);
        if (result.ok || result.reason !== 'rejected') errors.push(`banked ${kind} was not rejected`);
      }
      const facts = api.terminalFacts(session.session);
      if (facts.tickets !== 0 || facts.scoreSubmitted !== 0) errors.push('terminal facts are not zero');
    }
  }
  return { errors, pin, hash };
}

async function fetchText(url, token) {
  const headers = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'metaverse-hub-coop-sim-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  return { status: response.status, text: await response.text() };
}

async function fetchBytes(url, token) {
  const headers = { 'User-Agent': 'metaverse-hub-coop-sim-check', Accept: 'application/vnd.github.raw' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
}

async function readPinAt(ref) {
  const api = `https://api.github.com/repos/${REPO}/contents/build/coop-sim.pin.json?ref=${encodeURIComponent(ref)}`;
  const raw = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref)}/build/coop-sim.pin.json`;
  const token = process.env.GITHUB_TOKEN || '';
  let last = 'no response';
  for (const auth of token ? [token, ''] : ['']) {
    try {
      const result = await fetchText(api, auth);
      if (result.status === 200 && result.text.includes('bundleSha256')) return result.text;
      last = `GitHub API HTTP ${result.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    try {
      const result = await fetchText(raw, '');
      if (result.status === 200 && result.text.includes('bundleSha256')) return result.text;
      last = `raw GitHub HTTP ${result.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`could not read Coop pin at ${ref} (${last})`);
}

function sameBundle(body, pin) {
  return body.bundleSha256 === pin.sha256 && body.contentSha256 === pin.fingerprint && body.protocolVersion === pin.protocol
    && body.simHz === 60 && body.loopHz === 20 && body.substeps === 3 && body.snapshotHz === 10 && body.snapshotMaxHz === 15;
}

async function checkUpstream(pin) {
  for (const rel of FILES) {
    const raw = `https://raw.githubusercontent.com/${REPO}/${pin.commit}/${rel}`;
    const result = await fetchBytes(raw, '');
    if (result.status !== 200) throw new Error(`${rel} at ${pin.commit} HTTP ${result.status}`);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const hash = sha256(result.bytes);
    if (hash !== pin.files[name]) throw new Error(`${name} sha256 ${hash} != pin ${pin.files[name]}`);
  }
  const pinned = JSON.parse(await readPinAt(pin.commit));
  if (!sameBundle(pinned, pin)) throw new Error(`upstream ${pin.commit} bundle ${pinned.bundleSha256} != vendored ${pin.sha256}`);
  const main = JSON.parse(await readPinAt('main'));
  if (!sameBundle(main, pin)) throw new Error(`Coop main bundle ${main.bundleSha256} protocol ${main.protocolVersion} != vendored ${pin.sha256} protocol ${pin.protocol}`);
  console.log(`Coop main ${main.bundleSha256} matches pin ${pin.commit}`);
}

const local = checkLocal();
if (local.errors.length || !local.pin) {
  for (const error of local.errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}
try {
  await checkUpstream(local.pin);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log(`PASS: coop-sim ${local.hash} protocol ${local.pin.protocol} fingerprint ${local.pin.fingerprint}`);
