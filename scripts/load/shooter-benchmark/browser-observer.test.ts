import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installBrowserFrameObserver, stopBrowserFrameObserver } from './browser-observer.mjs';
let callback: ((t: number) => void) | null = null, active = true;
const context = vm.createContext({
  window: { __game: { rewardedCampaign: { snapshot: () => ({ active, recording: active, paused: false }) }, perfCounters: { report: () => ({ frames: 240, p95Ms: 42 }) } } },
  performance: { now: () => 200 },
  requestAnimationFrame: (fn: (t: number) => void) => { callback = fn; return 1; }, cancelAnimationFrame: () => undefined,
});
context.install = installBrowserFrameObserver; // Invoke serialized browser code.
vm.runInContext(`(${installBrowserFrameObserver.toString()})({maxSamples:2})`, context);
const frame = (time: number) => { assert.ok(callback); (callback as (t: number) => void)(time); };
frame(0); frame(16); frame(33); active = false; frame(100); active = true; frame(200); frame(216);
const result = vm.runInContext(`(${stopBrowserFrameObserver.toString()})()`, context);
assert.deepEqual(Array.from(result.samples), [16, 17]);
assert.equal(result.observedFrames, 5);
assert.equal(result.truncated, true);
assert.equal(result.gameWindow.p95Ms, 42);
assert.equal(result.metric, 'active_recording_browser_frame_interval_ms');
console.log('read-only unique browser frame observer canaries passed; actual browser profile still requires integration');
