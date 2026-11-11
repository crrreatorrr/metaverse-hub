// Separate Actions-only browser lane. Existing ci.ts prepare owns finite stack
// configuration/principal creation; this entry never deploys or changes flags.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call, guest, openGame, psql, waitReady, sqlId } from '../../../server/test/dup/harness.ts';
import { integrationManifest } from '../../../server/test/dup/shooter_verification_e2e_fixtures.ts';
import { startBrowserBackground } from './browser-background.ts';
import { hostObservation } from './observers.ts';
import { boundOwnerStatus, serviceOutcome, outcomeError } from './browser-accounting.mjs';
import { runPublicBrowserCohort } from './public-browsers.mjs';
const exec = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
const APPROVED_CLIENT = '91bd4d79e4429b9bbfb017d92106bea7a9445b5a';
let observers = null, backgroundResult = null;
let browser = null, browserServer = null, shutdownObservation = null, hardExitRequired = false, reportPath = null, framePath = null, setupSucceeded = 0, observedResult = null;
const startedAt = new Date().toISOString();
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('browser_cleanup_deadline')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stopOwnedBrowser() {
  const child = browserServer?.process();
  try {
    await within(browserServer ? browserServer.close() : browser?.close() || Promise.resolve(), 5000);
    return { state: 'closed', gracefulBudgetMs: 5000, killBudgetMs: 2000 };
  } catch {
    // This process was launched exclusively for this disposable profile. Never
    // print its WS endpoint; kill the owned process if graceful close stalls.
    try { child?.kill('SIGKILL'); } catch { /* confirmation below remains honest */ }
    try { if (browserServer) await within(browserServer.kill(), 2000); } catch { /* bounded fallback */ }
    const exited = !!child && (child.exitCode !== null || child.signalCode !== null);
    if (!exited) hardExitRequired = true;
    return { state: exited ? 'forced' : 'unconfirmed', gracefulBudgetMs: 5000, killBudgetMs: 2000 };
  }
}

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark'
    || (process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350') throw new Error('disposable_browser_lane_required');
  const root = process.env.SHOOTER_OPS_CI_DIRECTORY;
  if (!root || !isAbsolute(root) || !/^\/tmp\/shooter-benchmark-[a-zA-Z0-9_-]+$/.test(root)) throw new Error('disposable_browser_directory_required');
  reportPath = join(root, 'browser-benchmark-report.json'); framePath = join(root, 'browser-frame-intervals.json');
  await waitReady();
  // Require the prepared, still-identical disposable Hub/database. Do not
  // silently measure fresh containers or a differently configured service.
  const compose = async args => (await exec('docker', ['compose', '-f', 'server/docker-compose.yml', ...args], { timeout: 10000, maxBuffer: 65536 })).stdout.trim();
  const original = JSON.parse(await readFile(join(root, 'stack-identities.json'), 'utf8'));
  if (original.nakama !== await compose(['ps', '-q', 'nakama']) || original.postgres !== await compose(['ps', '-q', 'postgres'])) throw new Error('prepared_stack_identity_changed');
  const clientRoot = resolve(process.env.SHOOTER_BROWSER_CLIENT || '.ci-browser-client');
  const expected = process.env.SHOOTER_BROWSER_EXPECTED_SOURCE || APPROVED_CLIENT;
  if (!/^[0-9a-f]{40}$/.test(expected)) throw new Error('reviewed_browser_source_required');
  const clientSha = (await exec('git', ['-C', clientRoot, 'rev-parse', 'HEAD'], { timeout: 5000, maxBuffer: 1024 })).stdout.trim();
  if (clientSha !== expected || (await exec('git', ['-C', clientRoot, 'status', '--porcelain', '--untracked-files=no'], { timeout: 5000, maxBuffer: 65536 })).stdout.trim()) throw new Error('browser_source_not_exact_clean_revision');
  const { chromium } = await import(pathToFileURL(resolve(clientRoot, 'node_modules/playwright/index.mjs')).href);
  // Decode only observed submitted wires for DOM-control coverage; no command
  // generator, state import or current-source replay is installed in the page.
  const { decodeFrames } = await import(pathToFileURL(resolve(clientRoot, 'src/server/protocol.js')).href);
  const setup = await Promise.allSettled(Array.from({ length: 20 }, async (_, i) => {
    const account = await guest(); console.log('::add-mask::' + account.token);
    const login = await openGame(account.token, 'sproto-shooter'); console.log('::add-mask::' + login.gameToken);
    const result = await call('profile.get', {}, login.gameToken, { timeoutMs: 10000 });
    if (result.status !== 200 || result.body.playerId !== account.userId) throw new Error('browser_actor_profile_failed');
    const stored = JSON.parse(psql(`SELECT jsonb_build_object('ranked',ranked,'effects',effects)::text FROM game.game_session WHERE session_id='${sqlId(login.sessionId)}' AND user_id='${sqlId(account.userId)}'`));
    // CI-only sticky enrollment selects the public server-owned version. No
    // client protocol/seed/run/state fixture or forced outcome is supplied.
    psql(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${sqlId(account.userId)}') ON CONFLICT DO NOTHING`);
    setupSucceeded++;
    return { accountBindingHash: hash(account.userId), sessionBindingHash: hash(login.sessionId),
      boss: ['sahil', 'obama', 'broccoli', 'glowie', 'tinubu'][i % 5],
      session: { game: 'sproto-shooter', playerId: account.userId, sid: login.sessionId, token: login.gameToken,
        ranked: stored.ranked, effects: stored.effects, relics: result.body.relics || [], ticketsCapLeft: result.body.ticketsCapLeft },
      // Private closure-only credential. Deleted before constructing artifacts.
      loginToken: login.gameToken };
  }));
  const actors = setup.filter(item => item.status === 'fulfilled').map(item => item.value);
  if (actors.length !== 20) throw new Error('twenty_legitimate_sessions_not_created');
  browserServer = await chromium.launchServer({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 10000 });
  const tokens = actors.map(actor => actor.loginToken); actors.forEach(actor => { delete actor.loginToken; });
  observers = await startBrowserBackground(root);
  const result = await runPublicBrowserCohort({ browser, url: process.env.SHOOTER_BROWSER_URL || 'http://127.0.0.1:4173', actors, decodeFrames, signal: observers.signal,
    maxDurationMs: 900000, prefixTicks: 120, maxRecordingMs: 30000, paymentObservationMs: 120000,
    viewport: { width: 640, height: 480 },
    readOwnerStatus: async (i, runId, signal) => {
      const response = await call('shooter.run.status', { runId }, tokens[i], { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      if ([429, 503].includes(response.status)) throw outcomeError({ state: 'pending_retryable', reason: `http_${response.status}` });
      if (!response.body.received && serviceOutcome(response.body)) throw outcomeError(response.body);
      if (response.status !== 200) throw new Error('owner_status_unavailable');
      boundOwnerStatus(response.body, runId);
      if (!response.body.received || !response.body.verified) throw new Error('owner_status_unavailable');
      return response.body;
    } });
  const rawFrames = result.rawFrameRecords; delete result.rawFrameRecords; observedResult = result;
  backgroundResult = await observers.finish();
  if (backgroundResult.summary.harnessStatus !== 'complete') result.summary.harnessStatus = 'failed';
  const actorCoverageComplete = result.summary.startedActors === 20 && result.summary.positiveRecordedActors === 20
    && result.summary.observedMovementActors === 20 && result.summary.observedFireActors === 20 && result.summary.explicitFinishAckActors === 20;
  result.summary.workloadStatus = actorCoverageComplete && backgroundResult.summary.workloadStatus === 'complete' ? 'complete' : 'degraded';
  shutdownObservation = await stopOwnedBrowser();
  if (shutdownObservation.state !== 'closed') result.summary.harnessStatus = 'failed';
  const pin = JSON.parse(await readFile('server/modules/vendor/shooter-sim.pin.json', 'utf8'));
  const configuration = psql("SELECT jsonb_build_object('admission',(SELECT to_jsonb(c) FROM game.shooter_verification_admission c),'scheduler',(SELECT to_jsonb(c) FROM game.shooter_verification_scheduler c),'gateway',(SELECT to_jsonb(c) FROM game.shooter_verification_gateway c),'payment',(SELECT to_jsonb(c) FROM game.shooter_verification_payment_config c))::text");
  const report = { schemaVersion: 1, benchmarkId: `ci-browser-${process.env.GITHUB_RUN_ID}`, startedAt,
    provenance: { clientGitSha: clientSha, inputCodecSource: clientSha, hubGitSha: (await exec('git', ['rev-parse', 'HEAD'], { timeout: 5000, maxBuffer: 1024 })).stdout.trim(), retainedSimulation: integrationManifest, currentLegacyArtifact: pin,
      configurationSha256: hash(configuration), configuration: JSON.parse(configuration), originalStackIdentities: original },
    hosts: [await hostObservation()], ...result, browserShutdown: shutdownObservation, backgroundTraffic: backgroundResult,
    measurementLimits: { serverCpuMemoryQueue: 'Recorded in backgroundTraffic at its observed scopes; no per-request attribution or production-capacity inference.',
      sqlGc: 'Per-query wall time and runtime GC remain unavailable, with explicit reasons in backgroundTraffic.measurements.',
      normalTraffic: 'Actual20Hub/10freePvP global-run background and independent observer; short-prefix partial growth/end coverage cannot substitute for sustained replacement rounds.',
      publicPrefix: '120 actual recorded ticks OR30000ms active-wall bound, whichever first, or a legitimate earlier local terminal; no seed reroll.',
      finalProof: 'Immutable recorded count sampled while actual status DOM pauses play, then normal Back requests finish; owner status and observed wire are compared against that fixed count.',
      recordedInputHash: 'Unknown: Game/recorder observer is deliberately not installed. Submitted wire hash is observed independently.',
      requiredElsewhere: 'PR18 full9634 real Game/retained-service lane and full24000 bounded corpus cases remain mandatory; this prefix profile cannot replace them.' } };
  const frameText = JSON.stringify({ clockDomain: 'browser_raf_timestamp', scope: 'active_recording', perActorSampleLimit: 4096, actors: rawFrames });
  const reportText = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(frameText) + Buffer.byteLength(reportText) > 8 * 1024 * 1024) throw new Error('browser_report_evidence_limit');
  await writeFile(framePath, frameText, { flag: 'wx', mode: 0o600 });
  await writeFile(reportPath, reportText, { flag: 'wx', mode: 0o600 });
  console.log(`Actual public-browser prefix profile: ${result.summary.startedActors}/20 started, ${result.summary.positiveRecordedActors}/20 recorded, ${result.summary.observedMovementActors}/20 observed movement; ${result.summary.harnessStatus}; no production capacity conclusion`);
  if (result.summary.harnessStatus !== 'complete' || result.summary.workloadStatus !== 'complete' || result.summary.startedActors !== 20 || result.summary.positiveRecordedActors !== 20 || result.summary.observedMovementActors !== 20 || result.summary.observedFireActors !== 20 || result.summary.explicitFinishAckActors !== 20) process.exitCode = 1;
} catch {
  if (observers && !backgroundResult) {
    try { backgroundResult = await observers.finish(); }
    catch { backgroundResult = { summary: { harnessStatus: 'failed', rawReason: 'background_finish_failed' } }; }
  }
  // Never stringify harness/Playwright errors: they may embed real JWTs or URLs.
  if (reportPath) await writeFile(reportPath, JSON.stringify({ schemaVersion: 1, authority: 'ci_advisory', profile: 'twenty_public_browser_bounded_prefix', productionCapacityConclusion: null,
    startedAt, setup: { plannedActorAttempts: 20, actualSessionDTOsCreated: setupSucceeded },
    ...(observedResult || {}), backgroundTraffic: backgroundResult || { summary: { harnessStatus: 'not_observed' } }, summary: { ...observedResult?.summary, harnessStatus: 'failed', rawReason: 'bounded_browser_ci_operation_failed' } }) + '\n', { flag: 'wx', mode: 0o600 }).catch(() => {});
  console.error('Bounded actual-browser CI controller failed; inspect safe report only.'); process.exitCode = 1;
} finally {
  if (observers && !backgroundResult) {
    try { backgroundResult = await observers.finish(); } catch { process.exitCode = 1; }
  }
  if (!shutdownObservation && (browserServer || browser)) shutdownObservation = await stopOwnedBrowser();
  if (shutdownObservation && shutdownObservation.state !== 'closed') process.exitCode = 1;
}
// An unconfirmed owned-browser shutdown cannot leave this CI controller alive
// indefinitely. Artifacts above remain failure-labelled; this is not success.
if (hardExitRequired) process.exit(1);
