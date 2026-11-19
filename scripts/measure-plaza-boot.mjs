#!/usr/bin/env node
// Boot measurement for the plaza: requests, transfer bytes and time until the plaza is ready
// (documentElement.dataset.plazaReady), then again once the network is quiet.
//
//   node scripts/measure-plaza-boot.mjs [--url http://127.0.0.1:4173/hub/] [--shot out.png] [--quiet ms] [--guest] [--slow]
//
// `--url .../hub/?shot=aerial` gives a fixed camera for before/after screenshots. `--guest` mocks
// Nakama's HTTP API in the page and clicks Continue as guest, so the buildings load too.
//
// Serve a build first (`npm run preview -w @metaverse/hub`). Nakama need not run: the plaza boots
// solo when /v2 is unreachable. Numbers from headless Chromium (SwiftShader) are for comparing
// two builds on the same machine, not absolute load times.
import { createRequire } from 'node:module';

// CommonJS resolution so a global Playwright install (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('--url', 'http://127.0.0.1:4173/hub/');
const shot = opt('--shot', null);
const quietMs = Number(opt('--quiet', '4000'));
const guest = args.includes('--guest');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (args.includes('--slow')) {
  // A home connection: 80 ms round trip, 20 Mbit/s down, so request waterfalls show.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 2_500_000, uploadThroughput: 625_000 });
}

if (guest) {
  // A stand-in Nakama: enough for "Continue as guest" to close the gate and the plaza to build.
  // The socket is refused, so the plaza runs solo, which loads the same world.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256' })}.${b64({ uid: '00000000-0000-4000-8000-000000000001', exp: Math.floor(Date.now() / 1000) + 7200, vrs: {} })}.sig`;
  await page.route((u) => u.pathname.startsWith('/v2/'), (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.startsWith('/v2/account/')) body = { token, refresh_token: token };
    else if (path.endsWith('/profile.get')) body = { playerId: '00000000-0000-4000-8000-000000000001', relics: [], verse: 0, ticketsCapLeft: 0 };
    else if (path.endsWith('/verse.board')) body = { rows: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket((u) => u.pathname.startsWith('/ws'), (ws) => ws.close());
}

const reqs = new Map();
let last = Date.now();
cdp.on('Network.requestWillBeSent', (e) => {
  reqs.set(e.requestId, { url: e.request.url, bytes: 0, done: false });
  last = Date.now();
});
cdp.on('Network.loadingFinished', (e) => {
  const r = reqs.get(e.requestId);
  if (r) Object.assign(r, { bytes: e.encodedDataLength, done: true });
  last = Date.now();
});
cdp.on('Network.loadingFailed', (e) => {
  const r = reqs.get(e.requestId);
  if (r) r.done = true;
  last = Date.now();
});

function tally() {
  const list = [...reqs.values()];
  const bytes = list.reduce((sum, r) => sum + r.bytes, 0);
  const glb = list.filter((r) => /\.glb(\?|$)/.test(r.url));
  return { requests: list.length, bytes, glbRequests: glb.length, glbBytes: glb.reduce((s, r) => s + r.bytes, 0) };
}

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.documentElement.dataset.plazaReady === '1', null, { timeout: 180_000 });
const ready = { ms: Date.now() - t0, ...tally() };
let entered = null;
if (guest) {
  await page.click('#login-guest');
  await page.waitForFunction(() => !document.querySelector('#login') || document.querySelector('#login').hidden || getComputedStyle(document.querySelector('#login')).display === 'none', null, { timeout: 60_000 }).catch(() => undefined);
  entered = { ms: Date.now() - t0, ...tally() };
}
// Every plaza building placed (content.ts sets data-plaza-draws then).
let built = null;
if (guest) {
  await page.waitForFunction(() => document.documentElement.dataset.plazaDraws !== undefined, null, { timeout: 180_000 }).catch(() => undefined);
  built = { ms: Date.now() - t0, ...tally() };
}
while (Date.now() - last < quietMs) await page.waitForTimeout(250);
const quiet = { ms: Date.now() - t0, ...tally() };
if (shot) {
  // The gate covers the plaza until someone signs in; hide it for a look at the world.
  await page.addStyleTag({ content: '#login, .login, #login-art, .login-art { display: none !important; }' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot });
}
const top = [...reqs.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((r) => `${r.bytes}\t${new URL(r.url).pathname}`);
console.log(JSON.stringify({ url, ready, entered, built, quiet }));
console.log(top.join('\n'));
await browser.close();
