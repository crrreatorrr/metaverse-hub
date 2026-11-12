import assert from 'node:assert/strict';
import { inputCoverage, oneShotCoverage, shortInputCoverage, type InputSample } from './coverage.ts';
const row = (slot: number, time: number, applied: number, replacement = false): InputSample => ({ slot, matchBindingHash: `${slot}-${replacement}`, observedMonoMs: time, createdMonoMs: replacement ? 50000 : 0, replacement, seatInputs: [{ applied }, { applied }] });
const rows = Array.from({ length: 10 }, (_, slot) => [row(slot, 1000, 1), row(slot, 9000, 40), row(slot, 70000, 5, true), row(slot, 80000, 55, true)]).flat();
assert.equal(inputCoverage(rows, 0, 90000, 10).complete, true);
assert.equal(inputCoverage(rows.map(r => ({ ...r, seatInputs: [{ applied: 0 }, { applied: 0 }] })), 0, 90000, 10).complete, false, 'neutral server ticks cannot prove input traffic');
assert.equal(inputCoverage(rows.filter(r => r.slot !== 9), 0, 90000, 10).complete, false, 'surviving subset cannot hide a missing slot');
assert.equal(inputCoverage(rows.map(r => ({ ...r, replacement: false })), 0, 90000, 10).complete, false, 'must prove replacement input after short observer signal expires');
console.log('actual applied-input coverage accounting canaries passed');

const partial = { attempted: 10, observed: 6, pendingSlots: [6, 7, 8, 9], closure: 'measurement_window_closed' };
const frozen: Readonly<typeof partial>[] = [];
const close = oneShotCoverage(() => partial, value => frozen.push(value));
close(); partial.observed = 10; partial.pendingSlots.length = 0; close();
assert.equal(frozen.length, 1);
assert.equal(frozen[0].attempted, 10);
assert.equal(frozen[0].observed, 6);
assert.deepEqual(frozen[0].pendingSlots, [6, 7, 8, 9]);
assert.ok(Object.isFrozen(frozen[0]));
console.log('in-flight measurement closure retains partial denominators and ignores late completion');

assert.equal(shortInputCoverage(rows, 10).complete, true);
assert.equal(shortInputCoverage(rows.map(row => ({ ...row, seatInputs: [{ applied: 0 }, { applied: 0 }] })), 10).complete, false);
assert.equal(shortInputCoverage(rows.filter(row => row.slot !== 9), 10).complete, false);
