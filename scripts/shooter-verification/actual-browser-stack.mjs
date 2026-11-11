// Actions only: production Game/SDK/public RPCs versus retained05f, not attestation.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call, guest, num, openGame, psql, waitReady } from '../../server/test/dup/harness.ts';
import { integrationManifest, prepareTrustedActor } from '../../server/test/dup/shooter_verification_e2e_fixtures.ts';
import { ops, prepareOperations, waitUntil } from '../../server/test/dup/shooter_verification_e2e_operations.ts';
import { initActualRewardPage } from './real-browser-helper.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.HUB_SHOOTER_FIXTURE, 'integration');
const clientRoot = resolve(process.env.SHOOTER_BROWSER_CLIENT || '.ci-browser-client');
const approvedRoot = resolve(process.env.SHOOTER_APPROVED_SOURCE || '.ci-shooter');
const { chromium } = await import(pathToFileURL(resolve(clientRoot, 'node_modules/playwright/index.mjs')).href);
const { decodeFrames } = await import(pathToFileURL(resolve(approvedRoot, 'src/server/protocol.js')).href);
const { verifyStateHash } = await import(pathToFileURL(resolve(approvedRoot, 'src/sim/hash.js')).href);
const hash = value => createHash('sha256').update(value).digest('hex');
const artifact = readFileSync(resolve('services/shooter-verifier/artifacts', integrationManifest.sha256, 'shooter-sim.js'));
assert.equal(hash(artifact), integrationManifest.sha256);
const url = process.env.SHOOTER_BROWSER_URL || 'http://127.0.0.1:4173';

async function realSession(login) {
  console.log('::add-mask::' + login.gameToken); console.log('::add-mask::' + login.hub.token);
  const profile = (await call('profile.get', {}, login.gameToken)).body;
  assert.equal(typeof profile.playerId, 'string');
  const stored = JSON.parse(psql(`SELECT jsonb_build_object('ranked',ranked,'effects',effects)::text FROM game.game_session WHERE session_id='${login.sessionId}'`));
  return { game: 'sproto-shooter', playerId: profile.playerId, sid: login.sessionId, token: login.gameToken,
    ranked: stored.ranked, effects: stored.effects, relics: profile.relics || [], ticketsCapLeft: profile.ticketsCapLeft };
}
async function installCapture(page, commands = null) {
  await page.evaluate(({ commands }) => {
    const game = window.__game;
    const capture = { frames: [], actions: [], firstWall: null, lastWall: null, nativeRafCallbacks: 0, error: null };
    window.__integrationCapture = capture;
    const raf = () => { capture.nativeRafCallbacks++; requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    const configure = game.configureCanonicalRewardCommands.bind(game);
    game.configureCanonicalRewardCommands = function(options) {
      if (!options.enabled) return configure(options);
      const record = options.record;
      return configure({ ...options, record(frame, tick) {
        const result = record(frame, tick);
        if (result === undefined || result === true) {
          if (tick !== capture.frames.length || capture.frames.length >= 9634) throw new Error('integration_capture_bound');
          const wall = performance.now(); if (capture.firstWall === null) capture.firstWall = wall; capture.lastWall = wall;
          capture.frames.push(frame.frames);
          for (const action of frame.actions) capture.actions.push([tick + action[0], action[1]]);
        }
        return result;
      }});
    };
    if (commands) {
      const original = game.input.buildCommand.bind(game.input);
      game.input.buildCommand = tick => {
        if (!game.rewardedCampaign.snapshot().recording) return original(tick);
        if (!commands[tick]) throw new Error('integration_pinned_input_exhausted');
        return commands[tick]; // Legal command provider; no state/entity/health mutations.
      };
    }
  }, { commands });
}
async function safeSnapshot(page) {
  return page.evaluate(() => {
    const game = window.__game, c = window.__integrationCapture;
    return { snapshot: game.rewardedCampaign.snapshot(), tick: game.state.tick, nextId: game.state.nextId,
      rng: JSON.parse(JSON.stringify(game.state.rng)), state: JSON.parse(JSON.stringify(game.state)),
      captured: { frames: c.frames.join(''), actions: c.actions, n: c.frames.length, wallMs: c.lastWall - c.firstWall,
        nativeRafCallbacks: c.nativeRafCallbacks }, failed: !!game.canonicalRewardFailure, crashed: game.crash.total > 0 };
  });
}
async function assertStoredProof(runId, state, pageHelper, expectedFrames) {
  const captured = state.captured;
  assert.equal(captured.n, expectedFrames); assert.equal(state.tick, expectedFrames);
  assert.equal(state.failed, false); assert.equal(state.crashed, false);
  assert.ok(captured.nativeRafCallbacks > 0, 'actual renderer/native RAF ran');
  // An ordinary live lead guard is exercised: no source clock aging in A/C.
  assert.ok(captured.wallMs >= Math.max(0, (expectedFrames - 1) * 1000 / 60 - 1000));
  await waitUntil(() => num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${runId}'`) === expectedFrames, 90000, 'actual browser transport persisted every recorded frame');
  await waitUntil(() => num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${runId}'`) === expectedFrames, 180000, 'actual offline coordinator verified the complete browser input');
  const privateState = JSON.parse(psql(`SELECT jsonb_build_object('stateHash',terminal_result->>'stateHash','state',checkpoint_json->'snapshot'->'state','accounting',checkpoint_json->'accounting')::text FROM game.shooter_verification_run WHERE run_id='${runId}'`));
  assert.equal(verifyStateHash(privateState.state), verifyStateHash(state.state), 'retained05f actual service state hash agrees with actual Game');
  assert.deepEqual(privateState.state.rng, state.rng); assert.equal(privateState.state.nextId, state.nextId);
  assert.equal(privateState.accounting.acceptedFrames, expectedFrames); assert.equal(privateState.accounting.verifiedFrames, expectedFrames);
  const batches = pageHelper.capturedAppends().map(entry => entry.body).filter(body => body.runId === runId);
  const unique = new Map();
  for (const batch of batches) {
    const digest = hash(JSON.stringify(batch));
    if (unique.has(batch.sequence)) assert.equal(unique.get(batch.sequence).digest, digest, 'retry preserved exact append body');
    else unique.set(batch.sequence, { body: batch, digest });
  }
  const ordered = [...unique.values()].map(entry => entry.body).sort((a, b) => a.sequence - b.sequence);
  let cursor = 0; const wireActions = [];
  for (const [sequence, body] of ordered.entries()) {
    assert.equal(body.sequence, sequence); assert.equal(body.tick0, cursor);
    for (const action of body.actions) wireActions.push([cursor + action[0], action[1]]);
    cursor += body.n;
  }
  assert.equal(cursor, expectedFrames);
  assert.equal(hash(ordered.map(body => body.frames).join('')), hash(captured.frames), 'actual RPC bytes equal exact Game canonical recorder bytes');
  assert.equal(hash(JSON.stringify(wireActions)), hash(JSON.stringify(captured.actions)));
  return { stateHash: verifyStateHash(state.state), ticks: expectedFrames, wallMs: Math.round(captured.wallMs), nativeRafCallbacks: captured.nativeRafCallbacks };
}

await waitReady(); await prepareOperations();
ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']);
await waitUntil(() => {
  try { return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '-e', "fetch('http://127.0.0.1:9476/ready').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))"])).ready === true; }
  catch { return false; }
}, 60000, 'actual coordinator/offline daemon ready');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  // A: genuine public random seed and real DOM input; incomplete is a valid result.
  const login = await openGame((await guest()).token, 'sproto-shooter');
  psql(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${login.hub.userId}')`);
  const a = await initActualRewardPage({ browser, url, session: await realSession(login) });
  try {
    await installCapture(a.page); await a.start({ boss: 'sahil' });
    await a.page.keyboard.down('KeyW'); await a.page.mouse.move(180, 110); await a.page.mouse.down();
    await a.page.waitForFunction(() => window.__game.rewardedCampaign.snapshot().recordedTick >= 120, null, { timeout: 180000 });
    await a.page.keyboard.up('KeyW'); await a.page.mouse.up(); await a.page.keyboard.press('Escape');
    const state = await safeSnapshot(a.page); assert.ok(state.snapshot.runId);
    const observedCommands = decodeFrames(state.captured.frames, state.captured.n, state.captured.actions).commands;
    assert.ok(observedCommands?.some(command => command.moveZ !== 0), 'real DOM movement reached recorded canonical input');
    await a.page.locator('[data-reward-status]').click(); await a.page.locator('[data-reward-action="back"]').click();
    const proof = await assertStoredProof(state.snapshot.runId, state, a, state.captured.n);
    console.log('PASS actual-browser public random-seed DOM prefix/finish retained05f parity ' + JSON.stringify(proof));
  } finally { await a.close(); }

  // C: trusted server-issued fixed seed, actual public idempotent issue and full UI.
  const cLogin = await openGame((await guest()).token, 'sproto-shooter');
  const key = randomUUID(), actor = await prepareTrustedActor('sahil-success-7', cLogin, { key });
  assert.equal(actor.fixture.ageMs, 0);
  const decoded = decodeFrames(actor.trace.frames, actor.trace.definition.frames, actor.trace.actions);
  assert.ok(decoded.commands && decoded.commands.length === 9634);
  const commands = decoded.commands;
  const c = await initActualRewardPage({ browser, url, session: await realSession(cLogin) });
  try {
    await installCapture(c.page, commands);
    await c.start({ boss: 'sahil', beforeStart: async () => c.page.evaluate(key => {
      const original = crypto.randomUUID.bind(crypto);
      crypto.randomUUID = () => { crypto.randomUUID = original; return key; };
    }, key) });
    await c.page.waitForFunction(() => window.__game.rewardedCampaign.snapshot().phase === 'ended', null, { timeout: 2100000 });
    const state = await safeSnapshot(c.page);
    assert.equal(state.snapshot.runId, actor.runId); assert.equal(state.captured.n, 9634);
    assert.equal(hash(state.captured.frames), hash(actor.trace.frames));
    assert.equal(hash(JSON.stringify(state.captured.actions)), hash(JSON.stringify(actor.trace.actions)));
    const proof = await assertStoredProof(actor.runId, state, c, 9634);
    await waitUntil(() => num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`) === 1, 90000, 'actual full clear pays once through normal settlement');
    assert.equal(num(`SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${cLogin.hub.userId}' AND reason='srv_shooter_boss_clear'`), 20);
    console.log('PASS actual-browser trusted-server Sahil7 full9634/render/nativeRAF/transport/retained05f/paid20 ' + JSON.stringify(proof));
    console.log('Browser wall cadence is measured above; CI software rendering is not intended-host capacity, human-control feel or browser attestation.');
  } finally { await c.close(); }
} finally { await browser.close(); ops(['stop', '-t', '40', 'coordinator', 'replay']); }
