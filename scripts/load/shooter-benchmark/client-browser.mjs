// One additional real DOM client. The orchestrator owns the separate20 whole
// protocol actors/background. Preparation authenticates only; no campaign is
// issued until the once-only first-execute hook calls start().
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { call, guest, openGame, psql, sqlId } from '../../../server/test/dup/harness.ts';
import { initActualRewardPage } from '../../shooter-verification/real-browser-helper.mjs';
import { runSinglePublicBrowser } from './public-browsers.mjs';
import { benchmarkRpc } from './rpc.ts';
import { boundOwnerStatus, serviceOutcome, outcomeError } from './browser-accounting.mjs';
const exec = promisify(execFile), hash = value => createHash('sha256').update(value).digest('hex');
const APPROVED = '7360d7e601ae7033c41a0b21c02df1ba77721a10';
async function bounded(work, ms) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('single_client_operation_deadline')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function cpuSnapshot(browser) {
  let session;
  try {
    session = await bounded(browser.newBrowserCDPSession(), 1000);
    const value = await bounded(session.send('SystemInfo.getProcessInfo'), 1000);
    if (!Array.isArray(value.processInfo) || value.processInfo.length > 256) throw new Error('invalid_cpu_projection');
    return value.processInfo.map(row => {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.type !== 'string' || !/^[a-zA-Z_]{1,40}$/.test(row.type)
        || !Number.isFinite(row.cpuTime) || row.cpuTime < 0) throw new Error('invalid_cpu_projection');
      return { id: row.id, type: row.type, cpuTime: row.cpuTime };
    });
  } catch { return null; }
  finally { if (session) await bounded(session.detach(), 1000).catch(() => {}); }
}
function cpuEvidence(before, after) {
  const common = { observer: 'Chromium_CDP_SystemInfo.getProcessInfo', unit: 'cpu_seconds',
    scope: 'owned browser process endpoint counters during single DOM start through prefix/verification drain; excludes Node generator and server containers',
    complete: false, reason: 'Process lifecycle is not tracked; exited/new/intermediate process CPU remains unknown. Never a complete client CPU total.' };
  if (!before || !after) return { ...common, value: null, unavailableReason: 'bounded_owned_browser_cpu_endpoint_unavailable' };
  const earlier = new Map(before.map(row => [row.id, row])), byType = {}, stable = new Set();
  for (const row of after) {
    const old = earlier.get(row.id);
    if (!old || old.type !== row.type || row.cpuTime < old.cpuTime) continue;
    stable.add(row.id); byType[row.type] = (byType[row.type] || 0) + row.cpuTime - old.cpuTime;
  }
  return { ...common, value: { stableProcessCpuSecondsLowerBoundByType: byType }, stableProcesses: stable.size,
    startProcesses: before.length, endProcesses: after.length, lostOrChangedProcesses: before.filter(row => !stable.has(row.id)).length,
    newOrChangedProcesses: after.filter(row => !stable.has(row.id)).length, unavailableReason: null };
}
export async function prepareSingleDomClient({ root }) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark'
    || !/^\/tmp\/shooter-benchmark-[a-zA-Z0-9_-]+$/.test(root || '')
    || (process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350') !== 'http://127.0.0.1:7350') throw new Error('disposable_single_dom_profile_required');
  let prepareStage = 'source_check';
  let server = null, browser = null, handle = null, startJob = null, closeJob = null;
  const close = () => {
    if (closeJob) return closeJob;
    closeJob = (async () => {
      if (!server) return { state: 'closed', gracefulBudgetMs: 5000, killBudgetMs: 2000 };
      const child = server.process();
      try {
        await bounded(server.close(), 5000);
        return { state: 'closed', gracefulBudgetMs: 5000, killBudgetMs: 2000 };
      } catch {
        try { child?.kill('SIGKILL'); } catch { /* confirmation below */ }
        try { await bounded(server.kill(), 2000); } catch { /* bounded fallback */ }
        const confirmed = !!child && (child.exitCode !== null || child.signalCode !== null);
        return { state: confirmed ? 'forced' : 'unconfirmed', gracefulBudgetMs: 5000, killBudgetMs: 2000 };
      }
    })();
    return closeJob;
  };
  try {
    const clientRoot = resolve(process.env.SHOOTER_BROWSER_CLIENT || '.ci-browser-client');
    const expected = process.env.SHOOTER_BROWSER_EXPECTED_SOURCE || APPROVED;
    if (expected !== APPROVED) throw new Error('unreviewed_single_dom_source');
    const clientSha = (await exec('git', ['-C', clientRoot, 'rev-parse', 'HEAD'], { timeout: 5000, maxBuffer: 1024 })).stdout.trim();
    const dirty = (await exec('git', ['-C', clientRoot, 'status', '--porcelain', '--untracked-files=no'], { timeout: 5000, maxBuffer: 65536 })).stdout.trim();
    if (clientSha !== expected || dirty) throw new Error('single_dom_source_not_clean_exact');
    prepareStage = 'authenticate_account';
    const account = await guest(); console.log('::add-mask::' + account.token);
    prepareStage = 'open_original_session';
    const login = await openGame(account.token, 'sproto-shooter'); console.log('::add-mask::' + login.gameToken);
    prepareStage = 'validate_profile';
    const profile = await call('profile.get', {}, login.gameToken, { timeoutMs: 10000 });
    if (profile.status !== 200 || profile.body.playerId !== account.userId) throw new Error('single_dom_profile_failed');
    const fields = JSON.parse(psql(`SELECT jsonb_build_object('ranked',ranked,'effects',effects)::text FROM game.game_session WHERE session_id='${sqlId(login.sessionId)}' AND user_id='${sqlId(account.userId)}'`));
    psql(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${sqlId(account.userId)}') ON CONFLICT DO NOTHING`);
    const actor = { accountBindingHash: hash(account.userId), sessionBindingHash: hash(login.sessionId), boss: 'sahil',
      session: { game: 'sproto-shooter', playerId: account.userId, sid: login.sessionId, token: login.gameToken,
        ranked: fields.ranked, effects: fields.effects, relics: profile.body.relics || [], ticketsCapLeft: profile.body.ticketsCapLeft } };
    const { chromium } = await import(pathToFileURL(resolve(clientRoot, 'node_modules/playwright/index.mjs')).href);
    const { decodeFrames } = await import(pathToFileURL(resolve(clientRoot, 'src/server/protocol.js')).href);
    prepareStage = 'launch_browser';
    server = await chromium.launchServer({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    prepareStage = 'connect_browser';
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 10000 });
    const url = process.env.SHOOTER_BROWSER_URL || 'http://127.0.0.1:4173';
    prepareStage = 'sdk_title_bootstrap';
    handle = await initActualRewardPage({ browser, url, session: actor.session, contextOptions: { viewport: { width: 640, height: 480 } }, timeoutMs: 90000 });
    const preparedMonoMs = performance.now();
    const binding = Object.freeze({ accountBindingHash: actor.accountBindingHash, sessionBindingHash: actor.sessionBindingHash });
    return { binding, preparedMonoMs, close,
      start(signal, onRecordingStarted = null) {
        if (startJob) return startJob;
        if (closeJob) throw new Error('single_dom_client_closed');
        startJob = (async () => {
          const startedMonoMs = performance.now(), before = await cpuSnapshot(browser);
          const population = await runSinglePublicBrowser({ browser, url, actors: [actor], preparedHandle: handle,
            readOwnerStatus: async (_i, runId, oneSignal) => {
              const response = await benchmarkRpc('shooter.run.status', { runId }, login.gameToken, { signal: AbortSignal.any([oneSignal, AbortSignal.timeout(10000)]) });
              if ([429, 503].includes(response.status)) throw outcomeError({ state: 'pending_retryable', reason: `http_${response.status}` });
              if (!response.body.received && serviceOutcome(response.body)) throw outcomeError(response.body);
              if (response.status !== 200) throw new Error('owner_status_unavailable');
              return boundOwnerStatus(response.body, runId);
            }, decodeFrames, signal, onRecordingStarted, maxDurationMs: 900000, prefixTicks: 120, maxRecordingMs: 30000,
            paymentObservationMs: 120000, viewport: { width: 640, height: 480 } });
          const finishedMonoMs = performance.now(), after = await cpuSnapshot(browser);
          return { ...population, preparedMonoMs, startedMonoMs, finishedMonoMs,
            populationRole: 'additional21st_public_prefix_not_one_of_twenty_full_protocol_actors',
            clientSourceCommit: clientSha, clockDomain: 'node_performance_monotonic',
            positiveRecordingObserved: population.actors[0].positiveRecordingObserved,
            clientCpu: cpuEvidence(before, after) };
        })();
        return startJob;
      },
    };
  } catch {
    const cleanup = await close();
    const error = new Error('single_dom_prepare_failed'); error.cleanup = cleanup; error.stage = prepareStage; throw error;
  }
}
