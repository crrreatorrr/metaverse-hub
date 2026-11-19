// pb_world gives the PB host the optional hub-parity I/O (handoff §3.3 item 4): loadProfile,
// getRelics, reportEvent and submitScore. The vendored bundle may not call them yet; a newer
// one feature-detects them. Here the host is wrapped to capture the I/O it is given.
import assert from 'node:assert/strict';
import { loadModule, plain } from '../unit/harness';

const A = '11111111-1111-4111-8111-111111111111';
const SID_A = '33333333-3333-4333-8333-333333333333';

const mod = loadModule();
const PbSim = mod.global.PbSim as { createWorldHost: (opts: { io: Record<string, unknown> }) => unknown };
const real = PbSim.createWorldHost;
let io: Record<string, (...args: unknown[]) => unknown> | null = null;
PbSim.createWorldHost = (opts) => {
  io = opts.io as typeof io;
  return real(opts);
};

const events: unknown[][] = [];
mod.nk.onSql(/FROM game\.relic_claim WHERE user_id = \$1::uuid/, () => [{ result: JSON.stringify(['genesis_shard', 'cones_tip']) }]);
mod.nk.onSql(/game\.apply_event/, (args) => {
  events.push(args as unknown[]);
  return [{ result: JSON.stringify({ granted: 'genesis_shard' }) }];
});
mod.nk.onSql(/game\.submit_score|INSERT INTO game\.leaderboard|game\.post_score/, () => [{ result: JSON.stringify({ posted: true, value: 1234 }) }]);

mod.call('pb.worlds', { userId: A, vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID_A } });
assert.ok(io, 'the world host was created with an I/O object');
const hostIo = io as Record<string, (...args: unknown[]) => unknown>;
for (const name of ['loadProfile', 'getRelics', 'reportEvent', 'submitScore']) assert.equal(typeof hostIo[name], 'function', name);

const who = { userId: A, sid: SID_A };
assert.deepEqual(plain(hostIo.getRelics!(who)), ['genesis_shard', 'cones_tip']);
const profile = hostIo.loadProfile!(who) as { relics: string[]; effects: Record<string, unknown> };
assert.deepEqual(plain(profile.relics), ['genesis_shard', 'cones_tip']);
assert.equal(typeof profile.effects, 'object');

const granted = hostIo.reportEvent!(who, 'pb.quest_complete', { questId: 'tutorial', tick: 10 }, 'k-1') as { granted?: string };
assert.equal(granted.granted, 'genesis_shard');
assert.equal(events.length, 1);
assert.deepEqual([events[0]![0], events[0]![1], events[0]![2], events[0]![3]], [A, SID_A, 'peoples-bitcoin', 'pb.quest_complete']);

assert.deepEqual(plain(hostIo.submitScore!(who, 'nobu_trial_time', 1, {})), { error: 'bad_board' }, "another game's board is refused");
const score = hostIo.submitScore!(who, 'pb_total_xp', 1234, {}) as { accepted?: boolean; error?: string };
assert.equal(typeof score, 'object');
assert.ok(score.accepted === true || typeof score.error === 'string', JSON.stringify(score));
console.log('pb host io ok');
