// 0.9.0 sub-paths: together they cover every root export, and neither core nor realtime pulls in
// the mock realtime server.
import assert from 'node:assert/strict';
import * as root from '../src/index';
import * as core from '../src/entry/core';
import * as realtime from '../src/entry/realtime';
import * as mock from '../src/entry/mock';
import * as feedback from '../src/entry/feedback';
import * as progress from '../src/entry/progress';
import * as pbShop from '../src/entry/pb-shop';

const union = new Set([core, realtime, mock, feedback, progress].flatMap((m) => Object.keys(m)));
assert.deepEqual(Object.keys(root).filter((k) => !union.has(k)), [], 'every root export is on a sub-path');
for (const [name, m] of [['core', core], ['realtime', realtime]] as const) {
  assert.equal('createMockRealtimeServer' in m, false, `${name} has no mock server`);
}
assert.equal(typeof core.createHubSdk, 'function');
assert.equal(typeof progress.createProgressStore, 'function');
assert.equal(typeof pbShop.pbShopRow, 'function');
console.log('hub-sdk entries ok');
