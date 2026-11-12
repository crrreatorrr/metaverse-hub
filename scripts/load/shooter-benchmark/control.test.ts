import assert from 'node:assert/strict';
import { runLifetimeControl, countPlannedCoordinatorUnavailable } from './control.ts';
const lifetime = new AbortController(), observation = new AbortController();
let steps = 0, active = 0, maximumActive = 0, first!: () => void, second!: () => void;
const one = new Promise<void>(resolve => { first = resolve; }), two = new Promise<void>(resolve => { second = resolve; });
const run = runLifetimeControl(lifetime.signal, 1, async () => {
  active++; maximumActive = Math.max(maximumActive, active); steps++;
  if (steps === 1) first(); if (steps === 2) second();
  await Promise.resolve(); active--; return true;
});
let failure!: ReturnType<typeof setTimeout>;
const deadline = new Promise<never>((_resolve, reject) => { failure = setTimeout(() => { lifetime.abort(); reject(new Error('control progress deadline')); }, 1000); });
try { await one; observation.abort(); await Promise.race([two, deadline]); } finally { lifetime.abort(); clearTimeout(failure); await run; }
assert.equal(observation.signal.aborted, true);
assert.ok(steps >= 2, 'control continues after the independent observer expires');
assert.equal(maximumActive, 1, 'replacement/control rounds cannot overlap');
assert.equal(active, 0);
console.log('independent lifetime control and nonoverlap canaries passed');

const interval = [{ startedWallMs: 100, finishedWallMs: 200, completed: true }];
const unavailable = { category: 'sut_unavailable', rawReason: 'coordinator_metrics_read_unavailable', sourceSampleWallMs: 150 };
assert.equal(countPlannedCoordinatorUnavailable([unavailable], interval), 1);
assert.equal(countPlannedCoordinatorUnavailable([{ ...unavailable, sourceSampleWallMs: 250 }], interval), 0);
assert.equal(countPlannedCoordinatorUnavailable([{ ...unavailable, category: 'instrumentation_failure', rawReason: 'observer_sample_deadline' }], interval), 0, 'unrelated five-second read deadline stays a failure inside control window');
assert.equal(countPlannedCoordinatorUnavailable([unavailable], [{ ...interval[0], completed: false }]), 0);
assert.equal(countPlannedCoordinatorUnavailable([{ ...unavailable, sourceSampleWallMs: null }], interval), 0);
