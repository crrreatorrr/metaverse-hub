import assert from 'node:assert/strict';
import { inputCoverage, type InputSample } from './coverage.ts';
const row = (slot: number, time: number, applied: number, replacement = false): InputSample => ({ slot, matchBindingHash: `${slot}-${replacement}`, observedMonoMs: time, createdMonoMs: replacement ? 50000 : 0, replacement, seatInputs: [{ applied }, { applied }] });
const rows = Array.from({ length: 10 }, (_, slot) => [row(slot, 1000, 1), row(slot, 9000, 40), row(slot, 70000, 5, true), row(slot, 80000, 55, true)]).flat();
assert.equal(inputCoverage(rows, 0, 90000, 10).complete, true);
assert.equal(inputCoverage(rows.map(r => ({ ...r, seatInputs: [{ applied: 0 }, { applied: 0 }] })), 0, 90000, 10).complete, false, 'neutral server ticks cannot prove input traffic');
assert.equal(inputCoverage(rows.filter(r => r.slot !== 9), 0, 90000, 10).complete, false, 'surviving subset cannot hide a missing slot');
assert.equal(inputCoverage(rows.map(r => ({ ...r, replacement: false })), 0, 90000, 10).complete, false, 'must prove replacement input after short observer signal expires');
console.log('actual applied-input coverage accounting canaries passed');
