// Re-vendor the Shooter free-arena bundle (and, when it is unchanged apart
// from the baked commit, re-pin the campaign verifier) from one sproto-shooter
// commit. One command:
//
//   node scripts/revendor-shooter-pvp.mjs <40-hex sproto-shooter commit> [--pvp-only]
//
// It fetches only that commit into a scratch directory (shallow, blob-less,
// sparse), installs the esbuild version that commit's package-lock.json pins
// into a second scratch directory, runs the commit's own
// scripts/build-server-sim.mjs, and deletes the scratch directory afterwards,
// also when a step fails. The fetched code runs with a scrubbed environment:
// PATH, HOME, locale, temp dir, proxy and CA variables only, no tokens or keys.
// Then it:
//   - refuses when the build's contract differs from the vendored pin
//     (protocol, sim, loadout, input limits, rewind, replay limits, director
//     state, replay version, combat seed scheme, crits, lead-in): those are a
//     code change, not a re-vendor. A full re-vendor may adopt a new content
//     fingerprint and golden from shooter main. --pvp-only still refuses both;
//   - runs the bundle: the mirrored sim golden must match shooter_protocol.ts,
//     and a scripted hosted-director match must end with a RESULT whose replay
//     record verifies with policy "settle";
//   - copies build/shooter-pvp-sim.js to server/modules/vendor/ and writes
//     shooter-pvp-sim.pin.json (the build's pin, then the hub's own keys on top);
//   - updates ShooterProto.COMMIT / BUNDLE_SHA256 (tests and the load script
//     read the pin file);
//   - re-pins the campaign verifier (vendor/shooter-sim.js) to the same commit
//     when its bundle is byte-identical to the vendored one once the baked
//     commit is normalized, so the campaign pin check accepts the new shooter
//     main. A campaign bundle that changed in any other way stops the script:
//     that is a campaign re-vendor with its own review (--pvp-only skips it).
// Nothing in the repo is written until every check above has passed.
//
// After the sproto-shooter stack merges: run it with the merged main SHA, then
// node scripts/check-shooter-pvp-sim-version.mjs,
// node scripts/check-shooter-sim-version.mjs and the hub checks.
// Offline tests: node scripts/revendor-shooter-pvp.test.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
/** Pin fields that are the wire/sim contract. A re-vendor must not change any of them. */
const CONTRACT = [
  'protocol', 'sim', 'contentFingerprint', 'loadoutHash', 'limits', 'rewind', 'replayLimits',
  'directorState', 'replayVersion', 'combatSeed', 'crits', 'leadInTicks', 'global', 'entry',
];
/** A full re-vendor from shooter main may adopt this field. --pvp-only may not. */
const FULL_REVENDOR_MOVES = new Set(['contentFingerprint']);
/** Literals of the old PvP fingerprint and golden hash, updated with the pin. */
const PVP_PIN_FILES = [
  'scripts/check-shooter-pvp-sim-version.mjs',
  'scripts/load/shooter-bots.ts',
  'scripts/load/shooter-acceptance.ts',
  'server/test/games/shooter_match.test.ts',
  'server/test/games/shooter_review.test.ts',
  'server/test/games/shooter_wagers.test.ts',
  'server/test/dup/shooter_match.ts',
  'server/test/rt/realtime.test.ts',
  'docs/two-game-release.md',
];
/** Environment the fetched build may see. */
const ENV_KEEP = /^(PATH|HOME|LANG|LC_ALL|TMPDIR|TEMP|TMP|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|ALL_PROXY|all_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|GIT_SSL_CAINFO|npm_config_cafile|NPM_CONFIG_CAFILE)$/;

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Only PATH, HOME, locale, temp, proxy and CA variables: no tokens reach the fetched code. */
export function scrubEnv(env = process.env) {
  const out = {};
  for (const key of Object.keys(env)) if (ENV_KEEP.test(key) && env[key] !== undefined) out[key] = env[key];
  return out;
}

/** The contract fields that differ between two pins. */
export function contractDiff(oldPin, newPin) {
  return CONTRACT.filter((key) => JSON.stringify(oldPin[key]) !== JSON.stringify(newPin[key]));
}

/** True when this re-vendor must stop instead of adopting the new pin. */
export function contractChangeRefused(changed, { pvpOnly }) {
  if (!changed.length) return false;
  if (pvpOnly) return true;
  return changed.some((key) => !FULL_REVENDOR_MOVES.has(key));
}

/** The build's pin with the hub's keys on top: the fetched build cannot name its own commit or sha. */
export function hubPinOf(buildPin, { commit, sha256: sha, golden, esbuild, goja }) {
  return {
    ...buildPin,
    kind: 'sproto-shooter-pvp-pin',
    repo: REPO,
    commit,
    sourceCommit: commit,
    sha256: sha,
    bundleSha256: sha,
    golden,
    esbuild,
    goja,
    node: '>=22',
  };
}

/** Run `fn(dir)` in a fresh scratch directory that is always removed. */
export function withScratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'shooter-revendor-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function load(src) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'shooter-pvp-sim.js' });
  return sandbox.SprotoShooterPvp;
}

function forward(yaw) {
  return { yaw, pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, sprint: false, jump: false, dash: false, reload: false, slot: 0 };
}

/**
 * Run the bundle: the mirrored sim golden (seed 7, both seats walk forward firing, 180 ticks),
 * and a hosted-director match driven the same way on a 30 Hz clock until RESULT, whose
 * replay record must verify with policy "settle". Throws on any disagreement.
 */
export function checkBundle(src, commit) {
  const api = load(src);
  if (!api || typeof api.createHostedDirector !== 'function') throw new Error('bundle has no createHostedDirector');
  if (api.SOURCE_COMMIT !== commit) throw new Error(`bundle bakes commit ${api.SOURCE_COMMIT}, not ${commit}`);
  const probe = api.createDirector({ seed: 7, matchId: 'golden' });
  const hello = (id) => JSON.stringify({ accountId: id, protocol: api.PVP_PROTOCOL_VERSION, sim: api.PVP_SIM_VERSION, content: api.CONTENT_FINGERPRINT });
  probe.handle({ userId: 'a', sessionId: 'sa' }, 1, hello('a'), 0);
  probe.handle({ userId: 'b', sessionId: 'sb' }, 1, hello('b'), 0);
  probe.handle({ userId: 'a', sessionId: 'sa' }, 4, '{"accountId":"a"}', 0);
  probe.handle({ userId: 'b', sessionId: 'sb' }, 4, '{"accountId":"b"}', 0);
  const yaws = [probe.sim.players[0].yaw, probe.sim.players[1].yaw];
  const inputs = [];
  for (let i = 0; i < 180; i++) inputs.push(yaws.map(forward));
  const out = JSON.parse(api.replayJSON(JSON.stringify({ seed: 7, inputs })));
  const golden = { seed: 7, outcome: out.outcome, reason: out.reason, winner: out.winner, tick: out.tick, stateHash: out.stateHash };

  const hosted = api.createHostedDirector({
    spawnSeed: 7, combatSeed: '5eed00c0ffee5eed00c0ffee5eed0042', matchId: 'revendor-check', accounts: ['a', 'b'],
  });
  if (hosted.combatSeedDerived !== false) throw new Error('hosted director derived its combat seed');
  let now = 1000;
  hosted.handle({ userId: 'a', sessionId: 'sa' }, 1, hello('a'), now);
  hosted.handle({ userId: 'b', sessionId: 'sb' }, 1, hello('b'), now);
  hosted.handle({ userId: 'a', sessionId: 'sa' }, 4, '{"accountId":"a"}', now);
  hosted.handle({ userId: 'b', sessionId: 'sb' }, 4, '{"accountId":"b"}', now);
  const hostedYaws = [hosted.sim.players[0].yaw, hosted.sim.players[1].yaw];
  for (let i = 0; i < 600 && !hosted.result; i++) {
    now += 1000 / 30;
    const frame = hosted.sim.tick;
    ['a', 'b'].forEach((id, k) => {
      hosted.handle({ userId: id, sessionId: `s${id}` }, 6, api.encodeInput({ seq: i + 1, frame, ...forward(hostedYaws[k]) }), now);
    });
    hosted.advance(now);
  }
  if (!hosted.result) throw new Error('hosted director never reached RESULT');
  const receipt = JSON.parse(api.replayJSON(hosted.replayRecord()));
  const policy = receipt.verdict ? receipt.verdict.policy : null;
  if (receipt.verified !== true || policy !== 'settle') {
    throw new Error(`hosted replay ${receipt.verified} ${policy} ${JSON.stringify(receipt.mismatch || [])}`);
  }
  return {
    api,
    golden,
    hosted: { outcome: hosted.result.outcome, reason: hosted.result.reason, tick: hosted.result.tick, verified: receipt.verified, policy },
  };
}

function assigned(source, name) {
  const match = new RegExp(`export var ${name} = ("([^"]*)"|(\\d+))`).exec(source);
  if (!match) return undefined;
  return match[2] !== undefined ? match[2] : Number(match[3]);
}

function probeCampaign(src, commit) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'shooter-sim.js' });
  const api = sandbox.SprotoShooterSim;
  if (!api || typeof api.contentFingerprintOf !== 'function' || typeof api.buildIssuance !== 'function') {
    throw new Error('campaign bundle has no verifier');
  }
  if (api.SOURCE_COMMIT !== commit) throw new Error(`campaign bundle bakes ${api.SOURCE_COMMIT}, not ${commit}`);
  if (api.PROTOCOL_VERSION !== 1) throw new Error(`campaign protocol ${api.PROTOCOL_VERSION}, expected 1`);
  const fingerprint = api.contentFingerprintOf();
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) throw new Error(`bad campaign fingerprint ${fingerprint}`);
  const economy = api.ECONOMY || {};
  if (economy.mintsTickets !== false || economy.ticketsMintedByArtifact !== 0 || economy.wagerMayCreateTickets !== false) {
    throw new Error('campaign bundle can mint');
  }
  const issuance = { accountId: 'a', sessionId: 'b', day: '2026-11-07', runId: 'c', seed: 1 };
  const obama = api.buildIssuance({ ...issuance, canonicalBoss: 'obamaDuo' });
  if (obama.ok || obama.reason !== 'obama_is_one' || obama.ticketsMinted !== 0) throw new Error('obamaDuo was not rejected');
  const agent = api.buildIssuance({ ...issuance, canonicalBoss: 'agent' });
  if (agent.ok || agent.reason !== 'glowie_not_agent' || agent.ticketsMinted !== 0) throw new Error('agent was not kept off glowie');
  const sahil = api.buildIssuance({ ...issuance, canonicalBoss: 'sahil' });
  if (!sahil.ok || sahil.ticketsMinted !== 0) throw new Error(`sahil issuance was not payable (${sahil.reason || 'no reason'})`);
  return { fingerprint, protocol: 1 };
}

function setVar(source, name, value) {
  const re = new RegExp(`(export var ${name} = )"[^"]*"`);
  if (!re.test(source)) throw new Error(`no ${name} constant to update`);
  return source.replace(re, `$1"${value}"`);
}

function setNum(source, name, value) {
  const re = new RegExp(`(export var ${name} = )\\d+`);
  if (!re.test(source)) throw new Error(`no ${name} constant to update`);
  return source.replace(re, `$1${value}`);
}

function replaceLiteral(writes, rel, from, to) {
  if (from === to) return;
  const file = join(root, rel);
  const already = writes.find((row) => row[0] === file);
  const text = already ? already[1] : readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${rel} does not name ${from}`);
  const next = text.split(from).join(to);
  if (already) already[1] = next;
  else writes.push([file, next]);
}

function run(cmd, args, cwd, env) {
  return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Fetch `commit`, build it with its pinned esbuild, and return the build outputs. */
function fetchAndBuild(commit) {
  const env = scrubEnv();
  return withScratch((work) => {
    const clone = join(work, 'src');
    const tools = join(work, 'tools');
    mkdirSync(clone);
    run('git', ['init', '-q'], clone, env);
    run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`], clone, env);
    run('git', ['config', 'core.sparseCheckout', 'true'], clone, env);
    writeFileSync(join(clone, '.git/info/sparse-checkout'), '/src/\n/scripts/\n/package.json\n/package-lock.json\n');
    run('git', ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', commit], clone, env);
    run('git', ['checkout', '-q', 'FETCH_HEAD'], clone, env);
    const head = run('git', ['rev-parse', 'HEAD'], clone, env).trim();
    if (head !== commit) throw new Error(`fetched ${head}, wanted ${commit}`);
    const lock = JSON.parse(readFileSync(join(clone, 'package-lock.json'), 'utf8'));
    const esbuild = lock.packages && lock.packages['node_modules/esbuild'] ? lock.packages['node_modules/esbuild'].version : '';
    if (!/^\d+\.\d+\.\d+$/.test(esbuild)) throw new Error('package-lock.json pins no esbuild version');
    mkdirSync(tools);
    writeFileSync(join(tools, 'package.json'), '{"private":true}\n');
    run('npm', ['install', '--no-audit', '--no-fund', '--silent', `esbuild@${esbuild}`], tools, env);
    mkdirSync(join(clone, 'node_modules'));
    symlinkSync(join(tools, 'node_modules/esbuild'), join(clone, 'node_modules/esbuild'), 'dir');
    run(process.execPath, ['scripts/build-server-sim.mjs'], clone, env);
    return {
      esbuild,
      pvp: readFileSync(join(clone, 'build/shooter-pvp-sim.js'), 'utf8'),
      pvpPin: JSON.parse(readFileSync(join(clone, 'build/shooter-pvp-sim.pin.json'), 'utf8')),
      campaign: readFileSync(join(clone, 'build/shooter-sim.js'), 'utf8'),
    };
  });
}

export function revendor(commit, { pvpOnly = false, build = fetchAndBuild } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('usage: node scripts/revendor-shooter-pvp.mjs <40-hex sproto-shooter commit> [--pvp-only]');
  const built = build(commit);
  const writes = [];

  // ---- free arena
  const pin = built.pvpPin;
  const sha = sha256(built.pvp);
  if (pin.sourceCommit !== commit) throw new Error(`build pinned ${pin.sourceCommit}`);
  if (sha !== pin.bundleSha256) throw new Error('build pin sha256 does not match its bundle');
  const oldPin = JSON.parse(readFileSync(join(VENDOR, 'shooter-pvp-sim.pin.json'), 'utf8'));
  const changed = contractDiff(oldPin, pin);
  if (contractChangeRefused(changed, { pvpOnly })) {
    throw new Error(`contract changed (${changed.join(', ')}): a code change, not a re-vendor`);
  }
  let proto = readFileSync(PROTOCOL_TS, 'utf8');
  const oldFingerprint = assigned(proto, 'FINGERPRINT');
  const oldGoldenHash = assigned(proto, 'GOLDEN_HASH');
  if (changed.includes('contentFingerprint')) proto = setVar(proto, 'FINGERPRINT', pin.contentFingerprint);
  for (const [key, name] of [['protocol', 'PROTOCOL'], ['sim', 'SIM'], ['contentFingerprint', 'FINGERPRINT'], ['loadoutHash', 'LOADOUT_HASH']]) {
    if (pin[key] !== assigned(proto, name)) throw new Error(`${key} ${pin[key]} != shooter_protocol.ts ${name}`);
  }
  const checked = checkBundle(built.pvp, commit);
  if (pvpOnly && (checked.golden.tick !== assigned(proto, 'GOLDEN_TICK') || checked.golden.stateHash !== oldGoldenHash)) {
    throw new Error(`golden ${checked.golden.tick} ${checked.golden.stateHash} != shooter_protocol.ts`);
  }
  if (checked.golden.tick !== assigned(proto, 'GOLDEN_TICK')) proto = setNum(proto, 'GOLDEN_TICK', checked.golden.tick);
  if (checked.golden.stateHash !== oldGoldenHash) proto = setVar(proto, 'GOLDEN_HASH', checked.golden.stateHash);
  const hubPin = hubPinOf(pin, { commit, sha256: sha, golden: checked.golden, esbuild: built.esbuild, goja: oldPin.goja });
  proto = setVar(proto, 'COMMIT', commit);
  proto = setVar(proto, 'BUNDLE_SHA256', sha);
  writes.push([join(VENDOR, 'shooter-pvp-sim.js'), built.pvp]);
  writes.push([join(VENDOR, 'shooter-pvp-sim.pin.json'), `${JSON.stringify(hubPin, null, 2)}\n`]);
  writes.push([PROTOCOL_TS, proto]);
  if (oldFingerprint !== pin.contentFingerprint) {
    for (const rel of PVP_PIN_FILES) replaceLiteral(writes, rel, oldFingerprint, pin.contentFingerprint);
  }
  if (oldGoldenHash !== checked.golden.stateHash) {
    for (const rel of ['scripts/check-shooter-pvp-sim-version.mjs', 'scripts/revendor-shooter-pvp.test.mjs', 'server/test/games/shooter_match.test.ts', 'docs/two-game-release.md']) {
      replaceLiteral(writes, rel, oldGoldenHash, checked.golden.stateHash);
    }
  }
  const lines = [`pvp: ${commit} ${sha} protocol ${pin.protocol} sim ${pin.sim} content ${pin.contentFingerprint} golden ${checked.golden.tick} ${checked.golden.stateHash}; hosted ${checked.hosted.outcome}/${checked.hosted.reason} replay ${checked.hosted.policy}`];

  // ---- campaign verifier
  const campaignPinPath = join(VENDOR, 'shooter-sim.pin.json');
  const campaignPin = JSON.parse(readFileSync(campaignPinPath, 'utf8'));
  const vendoredCampaign = readFileSync(join(VENDOR, 'shooter-sim.js'), 'utf8');
  const normalize = (src, at) => src.split(at).join(PLACEHOLDER);
  if (pvpOnly) {
    lines.push('campaign: skipped (--pvp-only)');
  } else if (campaignPin.commit === commit) {
    lines.push('campaign: already pinned to this commit');
  } else if (normalize(vendoredCampaign, campaignPin.commit) !== normalize(built.campaign, commit)) {
    const probed = probeCampaign(built.campaign, commit);
    const cSha = sha256(built.campaign);
    const next = {
      ...campaignPin,
      commit,
      sourceCommit: commit,
      sha256: cSha,
      bundleSha256: cSha,
      bundleBytes: Buffer.byteLength(built.campaign),
      fingerprint: probed.fingerprint,
      contentFingerprint: probed.fingerprint,
      protocol: probed.protocol,
      protocolVersion: probed.protocol,
    };
    let rewards = readFileSync(REWARDS_TS, 'utf8');
    rewards = setVar(rewards, 'COMMIT', commit);
    rewards = setVar(rewards, 'BUNDLE_SHA256', cSha);
    rewards = setVar(rewards, 'FINGERPRINT', probed.fingerprint);
    writes.push([join(VENDOR, 'shooter-sim.js'), built.campaign]);
    writes.push([campaignPinPath, `${JSON.stringify(next, null, 2)}\n`]);
    writes.push([REWARDS_TS, rewards]);
    const pvpFile = writes.find((row) => row[0].endsWith('shooter-pvp-sim.pin.json'));
    if (pvpFile) {
      const pvpPin = JSON.parse(pvpFile[1]);
      pvpPin.campaignContentFingerprint = probed.fingerprint;
      pvpPin.campaignProtocol = probed.protocol;
      pvpFile[1] = `${JSON.stringify(pvpPin, null, 2)}\n`;
    }
    const protoWrite = writes.find((row) => row[0] === PROTOCOL_TS);
    if (!protoWrite) throw new Error('pvp pin write did not include shooter_protocol.ts');
    protoWrite[1] = setVar(protoWrite[1], 'CAMPAIGN_FINGERPRINT', probed.fingerprint);
    for (const rel of CAMPAIGN_TRIPWIRES) {
      const file = join(root, rel);
      const already = writes.find((row) => row[0] === file);
      const text = already ? already[1] : readFileSync(file, 'utf8');
      if (!text.includes(campaignPin.sha256)) throw new Error(`${rel} does not name the campaign sha256`);
      const nextText = text.split(campaignPin.sha256).join(cSha).split(campaignPin.fingerprint).join(probed.fingerprint);
      if (already) already[1] = nextText;
      else writes.push([file, nextText]);
    }
    const fingerprintFiles = [
      'scripts/check-shooter-sim-version.mjs',
      'scripts/load/shooter-bots.ts',
      'server/modules/src/games/shooter_rewards.ts',
    ];
    for (const rel of fingerprintFiles) {
      const file = join(root, rel);
      const text = readFileSync(file, 'utf8');
      if (!text.includes(campaignPin.fingerprint)) throw new Error(`${rel} does not name the campaign fingerprint`);
      const already = writes.find((row) => row[0] === file);
      const base = already ? already[1] : text;
      const nextText = base.split(campaignPin.fingerprint).join(probed.fingerprint);
      if (already) already[1] = nextText;
      else writes.push([file, nextText]);
    }
    lines.push(`campaign: rebaked ${campaignPin.commit} -> ${commit} fingerprint ${campaignPin.fingerprint} -> ${probed.fingerprint} (${cSha})`);
  } else {
    const cSha = sha256(built.campaign);
    const next = { ...campaignPin, commit, sourceCommit: commit, sha256: cSha, bundleSha256: cSha, bundleBytes: Buffer.byteLength(built.campaign) };
    let rewards = readFileSync(REWARDS_TS, 'utf8');
    rewards = setVar(rewards, 'COMMIT', commit);
    rewards = setVar(rewards, 'BUNDLE_SHA256', cSha);
    writes.push([join(VENDOR, 'shooter-sim.js'), built.campaign]);
    writes.push([campaignPinPath, `${JSON.stringify(next, null, 2)}\n`]);
    writes.push([REWARDS_TS, rewards]);
    for (const rel of CAMPAIGN_TRIPWIRES) {
      const file = join(root, rel);
      const already = writes.find((row) => row[0] === file);
      const text = already ? already[1] : readFileSync(file, 'utf8');
      if (!text.includes(campaignPin.sha256)) throw new Error(`${rel} does not name the campaign sha256`);
      const nextText = text.split(campaignPin.sha256).join(cSha);
      if (already) already[1] = nextText;
      else writes.push([file, nextText]);
    }
    lines.push(`campaign: re-pinned ${campaignPin.commit} -> ${commit} (${cSha}), bundle unchanged apart from the commit`);
  }

  for (const [file, text] of writes) writeFileSync(file, text);
  return lines;
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const args = process.argv.slice(2);
  try {
    const lines = revendor(String(args.find((arg) => !arg.startsWith('--')) || ''), { pvpOnly: args.includes('--pvp-only') });
    for (const line of lines) console.log(line);
    console.log('next: node scripts/check-shooter-pvp-sim-version.mjs && node scripts/check-shooter-sim-version.mjs && npm test');
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
