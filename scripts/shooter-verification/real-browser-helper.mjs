import { createHash } from 'node:crypto';

// Test-only observer/bootstrap for the production Shooter page. It never mocks
// an RPC, imports state, changes Game/recorder callbacks or chooses a run seed.
// Callers supply genuine server credentials privately; do not enable HAR/trace.
const GAME = 'sproto-shooter';
const MAX_APPEND_BYTES = 2162688;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_BATCHES = 256, MAX_ATTEMPTS = 4096, MAX_EVENTS = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new Error(code); };

function cachedSession(value) {
  if (!value || value.game !== GAME || !UUID.test(value.playerId) || !UUID.test(value.sid)
    || typeof value.ranked !== 'boolean' || typeof value.token !== 'string'
    || !value.token || value.token.length > 32768
    || (value.refreshToken !== undefined && (typeof value.refreshToken !== 'string' || value.refreshToken.length > 32768))) fail('invalid_browser_session');
  const effects = value.effects ?? {}, relics = value.relics ?? [];
  if (!effects || typeof effects !== 'object' || Array.isArray(effects) || Object.keys(effects).length > 128
    || Object.entries(effects).some(([key, item]) => key.length > 80 || !['boolean', 'number', 'string'].includes(typeof item)
      || (typeof item === 'number' && !Number.isFinite(item)) || (typeof item === 'string' && item.length > 256))
    || !Array.isArray(relics) || relics.length > 256 || relics.some((item) => typeof item !== 'string' || item.length > 80)
    || (value.ticketsCapLeft !== undefined && (!Number.isSafeInteger(value.ticketsCapLeft) || value.ticketsCapLeft < 0))) fail('invalid_browser_session');
  // Preserve genuine server cache fields; no arbitrary caller graphs or authority claims.
  return { game: GAME, playerId: value.playerId, sid: value.sid, ranked: value.ranked,
    token: value.token, ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}),
    effects: { ...effects }, relics: [...relics], ticketsCapLeft: value.ticketsCapLeft ?? 0 };
}

function operation(request) {
  // Keep an allowlisted label, never a URL/query/hash or request headers.
  try {
    const path = new URL(request.url()).pathname;
    const match = /^\/v2\/rpc\/(profile\.get|shooter\.run\.(?:issue|append|finish|status))$/.exec(path);
    return match?.[1] || (path === '/v2/account/authenticate/custom' ? 'ticket_redeem' : null);
  } catch { return null; }
}

function appendBody(text) {
  const body = JSON.parse(text);
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'actions,frames,n,protocol,runId,sequence,tick0'
    || body.protocol !== 2 || !UUID.test(body.runId)
    || !Number.isSafeInteger(body.sequence) || body.sequence < 0 || body.sequence >= 4096
    || !Number.isSafeInteger(body.tick0) || body.tick0 < 0
    || !Number.isSafeInteger(body.n) || body.n < 1 || body.n > 28800 || body.tick0 + body.n > 162000
    || typeof body.frames !== 'string' || body.frames.length !== body.n * 16 || !/^[A-Za-z0-9+/]+$/.test(body.frames)
    || !Array.isArray(body.actions) || body.actions.length > 32
    || body.actions.some((row) => !Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0])
      || row[0] < 0 || row[0] >= body.n || row[1] !== 1)) fail('malformed_append_capture');
  // Same alphabetical wire contract, independently constructed from observed
  // primitive fields. This is capture/digest evidence, not a replay oracle.
  const canonical = JSON.stringify({ actions: body.actions, frames: body.frames, n: body.n,
    protocol: 2, runId: body.runId, sequence: body.sequence, tick0: body.tick0 });
  if (text !== canonical) fail('noncanonical_append_wire');
  return body;
}

/** session is a legitimate SDK cached DTO, or ticket is a genuine #t launch.
 * Fresh context only. contextOptions may explicitly choose a measured viewport;
 * timeoutMs is a caller-owned boot/start deadline, not a simulation speed knob.
 * beforeStart runs immediately before the real final DOM click. CI drivers may
 * install their reviewed one-shot UUID fixture there; this helper has no such
 * override. capturedAppends returns bounded observed wire, never credentials.
 */
export async function initActualRewardPage({ browser, url, session, ticket,
  contextOptions = {}, timeoutMs = 90000 } = {}) {
  if (!browser?.newContext || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90000
    || (!!session === !!ticket) || contextOptions.recordHar) fail('invalid_browser_bootstrap');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash
    || [...target.searchParams.keys()].some((key) => !['stats'].includes(key))) fail('invalid_game_url');
  if (ticket && (typeof ticket !== 'string' || ticket.length > 32768)) fail('invalid_launch_ticket');
  const cache = session ? cachedSession(session) : null;
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, ...contextOptions });
  const page = await context.newPage();
  const events = [], appends = new Map();
  let attempts = 0, captureBytes = 0, captureError = null, profileValidated = false, ticketValidated = false;
  let consoleErrors = 0, pageErrors = 0, observedEvents = 0;
  function event(value) { observedEvents++; if (events.length < MAX_EVENTS) events.push(value); }
  function requestCapture(request) {
    if (operation(request) !== 'shooter.run.append' || request.method() !== 'POST' || captureError) return;
    try {
      if (++attempts > MAX_ATTEMPTS) fail('append_attempt_capture_limit');
      const text = request.postData();
      if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_APPEND_BYTES) fail('append_capture_body_limit');
      const body = appendBody(text), key = `${body.runId}:${body.sequence}`, digest = sha(text);
      const old = appends.get(key);
      if (old) {
        if (old.wire !== text || old.digest !== digest) fail('append_retry_wire_changed');
        old.attempts++; return;
      }
      const bytes = Buffer.byteLength(text);
      if (appends.size >= MAX_BATCHES || captureBytes + bytes > MAX_CAPTURE_BYTES) fail('append_capture_retention_limit');
      captureBytes += bytes;
      appends.set(key, { wire: text, digest, attempts: 1 });
    } catch (error) {
      captureError = ['append_attempt_capture_limit', 'append_capture_body_limit', 'append_retry_wire_changed',
        'append_capture_retention_limit', 'noncanonical_append_wire', 'malformed_append_capture'].includes(error.message)
        ? error.message : 'malformed_append_capture';
    }
  }
  function responseCapture(response) {
    const op = operation(response.request());
    if (!op) return;
    const status = response.status();
    event({ kind: 'response', op, status });
    if (op === 'profile.get' && status >= 200 && status < 300) profileValidated = true;
    if (op === 'ticket_redeem' && status >= 200 && status < 300) ticketValidated = true;
  }
  page.on('request', requestCapture);
  page.on('response', responseCapture);
  page.on('requestfailed', (request) => { const op = operation(request); if (op) event({ kind: 'request_failed', op }); });
  // Raw console/pageerror strings can contain WebSocket ?token= credentials.
  // Record categories/counts only, including errors caught by Game's crashguard.
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors++; });
  page.on('pageerror', () => { pageErrors++; });
  try {
    if (cache) await context.addInitScript(({ origin, dto }) => {
      if (location.origin === origin) sessionStorage.setItem('hub:sproto-shooter:session', JSON.stringify(dto));
    }, { origin: target.origin, dto: cache });
    if (ticket) target.hash = `t=${encodeURIComponent(ticket)}`;
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForFunction((expected) => {
      const g = window.__game;
      return !!g?.rewardedCampaign && g.hub.connected && g.hub.bankable && !g.hub.error
        && (!expected || g.hub.playerId === expected) && !location.hash.includes('t=');
    }, cache?.playerId || null, { timeout: timeoutMs });
    if (cache ? !profileValidated : !ticketValidated) fail('server_boot_validation_not_observed');
    const readSnapshot = () => page.evaluate(() => window.__game.rewardedCampaign.snapshot());
    const capturedAppends = () => {
      if (captureError) fail(captureError);
      return [...appends.values()].map((row) => ({ body: JSON.parse(row.wire), wire: row.wire,
        digest: row.digest, attempts: row.attempts }));
    };
    const safeDiagnostics = async () => ({ boot: { profileValidated, ticketValidated },
      capture: { attempts, uniqueBatches: appends.size, bytes: captureBytes, error: captureError },
      consoleErrors, pageErrors, observedEvents, retainedEventLimit: MAX_EVENTS, events: events.map((row) => ({ ...row })),
      game: await page.evaluate(() => {
        const g = window.__game;
        if (!g) return { initialized: false };
        return { initialized: true, reward: g.rewardedCampaign?.snapshot() || null,
          tick: g.state?.tick, visibility: document.visibilityState,
          viewport: { width: innerWidth, height: innerHeight, canvasWidth: g.renderer.canvas.width, canvasHeight: g.renderer.canvas.height },
          crash: { halted: g.crash.halted, total: g.crash.total, consecutive: g.crash.consecutive },
          perfWindow: { seconds: 5, maximumFrames: 240, report: g.perfCounters.report(5, performance.now()) } };
      }) });
    return { context, page, readSnapshot, capturedAppends, safeDiagnostics,
      async start({ boss = 'sahil', beforeStart = null } = {}) {
        if (!['sahil', 'obama', 'broccoli', 'glowie', 'tinubu'].includes(boss)
          || (beforeStart !== null && typeof beforeStart !== 'function')) fail('invalid_browser_start');
        await page.locator('[data-go="rewarded"]').click();
        await page.locator('[data-reward-boss]').selectOption(boss);
        if (beforeStart) await beforeStart(page);
        await page.locator('[data-reward-start]').click();
        await page.waitForFunction(() => window.__game.rewardedCampaign.snapshot().active, null, { timeout: timeoutMs });
        return readSnapshot();
      },
      async close() { page.off('request', requestCapture); page.off('response', responseCapture); await context.close(); },
    };
  } catch {
    await context.close().catch(() => {});
    // Playwright exception text may embed the navigation #t ticket. The caller
    // gets a stable safe failure category, never the raw underlying exception.
    fail('actual_reward_browser_boot_failed');
  }
}
