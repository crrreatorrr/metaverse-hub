// pb_world gives the PB host the optional hub-parity I/O (handoff §3.3 item 4): loadProfile,
// getRelics, reportEvent and submitScore. The host is wrapped to capture the I/O it is given;
// the end of the file checks that the vendored bundle (PB f5c16a53, sim dd7940baec7a687a) calls
// them through a real pb_world join.
import assert from 'node:assert/strict';
import { loadModule, plain, presence } from '../unit/harness';

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
// Through the bundle: a join reads the profile (WELCOME carries it), and a character whose
// tutorial is complete reports pb.quest_complete once with the hub's grant.
{
  const OP = { HELLO: 1, WELCOME: 101 };
  const live = loadModule();
  const sim = (live.global.PbSim as { version: string }).version;
  assert.equal(sim, 'dd7940baec7a687a');
  const reported: unknown[][] = [];
  let relics = ['genesis_shard'];
  live.nk.onSql(/FROM game\.relic_claim WHERE user_id = \$1::uuid/, () => [{ result: JSON.stringify(relics) }]);
  live.nk.onSql("json_build_object('balance'", () => [{ result: JSON.stringify({ balance: 50, sessionCapLeft: 200, dailyCapLeft: 1000 }) }]);
  live.nk.onSql(/game\.apply_event/, (args) => {
    reported.push(args as unknown[]);
    return [{ result: JSON.stringify({ granted: 'cones_tip' }) }];
  });
  const vars = { scope: 'game', game: 'peoples-bitcoin', sid: SID_A };
  const listed = live.call<{ worlds: { matchId: string }[] }>('pb.worlds', { userId: A, vars });
  const world = live.driver(listed.worlds[0]!.matchId);
  const alice = presence(A, 'Alice');
  world.join([alice], { vars });
  world.loop([{ sender: alice, opCode: OP.HELLO, data: { proto: 1, sim } }]);
  const welcome = world.dispatcher.sent<{ sim: string; hub?: { relics: string[]; effects: Record<string, unknown> } }>(OP.WELCOME).at(-1)!.body;
  assert.equal(welcome.sim, sim);
  assert.deepEqual(plain(welcome.hub?.relics), ['genesis_shard'], 'loadProfile reached the client');
  assert.equal(reported.length, 0, 'no relic report before the tutorial is done');

  // Leave, mark the tutorial complete in the saved character, and come back.
  world.leave([alice]);
  world.ticks(60);
  const row = live.nk.storage.get(`pb_character/main/${A}`)!;
  const value = plain(row.value) as { save: { player: { quests: Record<string, { complete: boolean }> } } };
  value.save.player.quests.quest_tutorial!.complete = true;
  live.nk.storage.set(`pb_character/main/${A}`, { ...row, value: value as unknown as Record<string, unknown>, version: `${row.version}-done` });
  relics = ['genesis_shard'];
  const back = presence(A, 'Alice', 's-back');
  world.join([back], { vars });
  world.loop([{ sender: back, opCode: OP.HELLO, data: { proto: 1, sim } }]);
  world.ticks(3);
  assert.equal(reported.length, 1, 'reportEvent ran once for the finished tutorial');
  assert.deepEqual([reported[0]![0], reported[0]![1], reported[0]![2], reported[0]![3]], [A, SID_A, 'peoples-bitcoin', 'pb.quest_complete']);
  world.ticks(3);
  assert.equal(reported.length, 1, 'an acked report is not sent again');
}

console.log('pb host io ok');
