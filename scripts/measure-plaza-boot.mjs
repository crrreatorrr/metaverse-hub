#!/usr/bin/env node
// Boot measurement for the plaza: requests, transfer bytes and time until the plaza is ready
// (documentElement.dataset.plazaReady), then again once the network is quiet.
//
//   node scripts/measure-plaza-boot.mjs [--url http://127.0.0.1:4173/hub/] [--bar] [--shot out.png]
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

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

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
while (Date.now() - last < quietMs) await page.waitForTimeout(250);
const quiet = { ms: Date.now() - t0, ...tally() };
if (shot) await page.screenshot({ path: shot });
const top = [...reqs.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((r) => `${r.bytes}\t${new URL(r.url).pathname}`);
console.log(JSON.stringify({ url, ready, quiet }, null, 2));
console.log(top.join('\n'));
await browser.close();
