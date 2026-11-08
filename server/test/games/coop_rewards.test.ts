// H3-C: Coop boss eligibility is server-owned. One account, six seats, one
// award. God Mode, AFK, late join, and CPU takeover do not pay. The golden
// fight stays on its existing zero-reward path.
import assert from 'node:assert/strict';
import { loadModule, presence, type LoadedModule, type MatchDriver } from '../unit/harness';

const USER = '00000000-0000-4000-8000-000000000000';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const FP = 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e';
const OP = { HELLO: 1, READY: 3 };

function game(userId = USER) {
  return { userId, sessionId: `s-${userId}`, username: 'ada', vars: { scope: 'game', game: 'sproto-coop-battle', sid: SID } };
}

function loadCoop() {
  return loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
}

interface CoopState {
  phase: string;
  session: {
    state: { t: number; god: boolean; mode: string; stageIdx: number; players: { ctrl: string }[]; boss?: { st?: string; t?: number; hp?: number } | null };
    seats: { human: boolean }[];
    encounter: { accounts: Record<string, { neutralAlive: number; presentAtStart?: boolean }> } | null;
  } | null;
  released: Record<string, number>;
  payFacts: { accounts: { slots: number; accountId: string }[]; assistance: string; god: number } | null;
  hubSid: Record<string, string>;
}

function stateOf(m: MatchDriver): CoopState {
  return m.state as CoopState;
}

function hydrate(mod: LoadedModule, m: MatchDriver): CoopState {
  const st = m.state as CoopState & { cold?: boolean; simPacked?: unknown };
  if (st.cold && st.simPacked && st.session) {
    const Sim = mod.global.Sim as { importState(data: unknown): CoopState['session'] extends infer S ? S extends { state: infer T } ? T : never : never };
    st.session.state = Sim.importState(st.simPacked) as CoopState['session'] extends infer S ? S extends { state: infer T } ? T : never : never;
    st.cold = false;
  }
  return st;
}

function settles(mod: LoadedModule) {
  return mod.nk.sqlCalls.filter((call) => call.sql.includes('SELECT game.settle_coop_clear'));
}

function start(mod: LoadedModule, userId = USER) {
  const created = mod.call<{ matchId: string; error?: string }>('coop.room_create', game(userId), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  const m = mod.driver(created.matchId);
  const p = presence(userId, 'ada', `s-${userId}`);
  assert.equal(m.join([p], game(userId))[0]?.accept, true);
  m.loop([{ sender: p, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: DEVICES } }]);
  m.loop([{ sender: p, opCode: OP.READY, data: { t: 'ready' } }]);
  assert.equal(stateOf(m).phase, 'playing');
  return { m, p };
}

function killBoss(mod: LoadedModule, m: MatchDriver): void {
  const live = hydrate(mod, m);
  const boss = {
    bi: 0, phase: 1, hp: 0, maxHp: 100, x: 10, y: 10, z: 0, face: -1,
    st: 'dead', t: 200, row: 0, w: 40, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0,
  };
  (live.session!.state as { boss?: unknown; mode: string }).boss = boss;
  live.session!.state.mode = 'play';
  m.loop([]);
}

const mod = loadCoop();
const CoopRewards = mod.global.CoopRewards as {
  PAY: number;
  SWEEP: number;
  BOSSES: string[];
  BOARD_ID: string;
  BANKED_REASON: string;
  BANKED_EVENT: string;
  decide(row: { accountId: string; slots: number; presentAtStart: number; nonNeutral: number; neutralAlive: number; downTicks: number }, gates: { practice: boolean; god: boolean; stageSelect: boolean; released: boolean; knownBoss: boolean }, afkAlive: number): { eligible: boolean; reason: string };
  clientBlocked(name: string): boolean;
};
const gates = { practice: false, god: false, stageSelect: false, released: false, knownBoss: true };
const present = { accountId: USER, slots: 6, presentAtStart: 1, nonNeutral: 4, neutralAlive: 0, downTicks: 0 };

{
  assert.equal(CoopRewards.BOSSES.length, 12);
  assert.equal(CoopRewards.PAY, 20);
  assert.equal(CoopRewards.SWEEP, 240);
  const clear = CoopRewards.decide(present, gates, 300);
  assert.equal(clear.eligible, true);
  assert.equal(clear.reason, 'clear');
  const downed = CoopRewards.decide({ ...present, nonNeutral: 0, downTicks: 800, neutralAlive: 0 }, gates, 300);
  assert.equal(downed.reason, 'clear', 'downed support is not a damage miss');
  assert.equal(CoopRewards.decide({ ...present, nonNeutral: 0, neutralAlive: 300, downTicks: 0 }, gates, 300).reason, 'afk');
  assert.equal(CoopRewards.decide({ ...present, presentAtStart: 0 }, gates, 300).reason, 'late_join');
  assert.equal(CoopRewards.decide(present, { ...gates, released: true }, 300).reason, 'cpu_takeover');
  assert.equal(CoopRewards.decide(present, { ...gates, god: true }, 300).reason, 'god_mode');
  assert.equal(CoopRewards.decide(present, { ...gates, practice: true }, 300).reason, 'practice');
  assert.equal(CoopRewards.decide(present, { ...gates, stageSelect: true }, 300).reason, 'stage_select');
  assert.equal(CoopRewards.decide(present, { ...gates, knownBoss: false }, 300).reason, 'unknown_boss');
  assert.equal(CoopRewards.decide({ ...present, slots: 1 }, gates, 300).reason, 'clear');
}

{
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  const ids = all.map((row) => row.id);
  assert.equal(ids.some((id) => id.startsWith('0036_')), false);
  assert.equal(ids.some((id) => id.startsWith('0038_')), false);
  assert.ok(ids.indexOf('0041_coop_boss_receipt') > ids.indexOf('0040_shooter_boss_receipt'));
  const sql = all.find((row) => row.id === '0041_coop_boss_receipt')!.statements.join('\n');
  for (const boss of CoopRewards.BOSSES) assert.ok(sql.includes(`'${boss}'`), boss);
  assert.equal(sql.includes('event_rule'), false);
  assert.equal(sql.includes('game_session_game'), false);
  assert.equal(sql.includes('vcoin'), false);
  assert.match(sql, /tickets = 20/);
  assert.match(sql, /coop_stage_clear_ms_v1/);
  assert.match(sql, /shooter_story_clear_ms_v1/);
  assert.equal(sql.includes('p_slots *'), false);
  assert.equal(sql.includes('p_phase'), false);
  assert.match(sql, /phasesAreOneClear', 1/);
  const shooter = all.find((row) => row.id === '0040_shooter_boss_receipt')!.statements.join('\n');
  assert.match(shooter, /srv_shooter_boss_clear/);
}

{
  const ctx = { userId: USER, vars: { scope: 'game', game: 'sproto-coop-battle', sid: SID, ranked: '0' } };
  const earn = mod.call<{ error?: string }>('tickets.earn', ctx, { amount: 20, reason: CoopRewards.BANKED_REASON, key: 'k1' });
  assert.equal(earn.error, 'server_reason');
  const named = mod.call<{ error?: string }>('tickets.earn', ctx, { amount: 20, reason: CoopRewards.BANKED_EVENT, key: 'k2' });
  assert.equal(named.error, 'server_reason');
  const event = mod.call<{ error?: string; tickets?: number }>('session.event', ctx, { eventId: CoopRewards.BANKED_EVENT, key: 'k3', data: { boss: '01-marina-bront' } });
  assert.equal(event.error, 'server_reason');
  assert.equal(event.tickets, undefined);
  const score = mod.call<{ error?: string }>('score.submit', ctx, { boardId: CoopRewards.BOARD_ID, value: 10, meta: {} });
  assert.equal(score.error, 'bad_board');
  assert.throws(
    () => mod.call('session.event', ctx, { eventId: 'sproto.boss_defeated', key: 'k4', data: { boss: 'sahil' } }),
    /empty_result/,
    'Duel boss events still reach SQL',
  );
  const economy = mod.global.HubEconomy as { earn(nk: unknown, who: { userId: string; sid: string; game: string }, amount: number, reason: string, key: string): { error?: string } };
  assert.equal(economy.earn(mod.nk, { userId: USER, sid: SID, game: 'sproto-coop-battle' }, 20, CoopRewards.BANKED_REASON, 'k5').error, 'server_reason');
}

{
  const run = start(mod);
  assert.equal(stateOf(run.m).hubSid[USER], SID);
  mod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  mod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":true,"tickets":20,"sealed":true,"reason":"clear"}' }]);
  killBoss(mod, run.m);
  const calls = settles(mod);
  assert.equal(calls.length, 1);
  const args = calls[0]!.args;
  assert.equal(args[0], USER);
  assert.equal(args[1], SID);
  assert.equal(args[4], '01-marina-bront');
  assert.equal(args[5], '2026-11-08');
  assert.equal(args[8], 1);
  assert.equal(args[9], 'clear');
  assert.equal(args[10], 6);
  assert.equal(args[13], 'all_human');
  assert.equal(stateOf(run.m).payFacts?.assistance, 'all_human');
  run.m.loop([]);
  assert.equal(settles(mod).length, 1);
}

{
  const godMod = loadCoop();
  const run = start(godMod);
  godMod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  godMod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":false,"tickets":0,"sealed":true,"reason":"god_mode"}' }]);
  const live = hydrate(godMod, run.m);
  live.session!.state.god = true;
  killBoss(godMod, run.m);
  const call = settles(godMod).at(-1);
  assert.ok(call, 'god mode still seals a zero');
  assert.equal(call?.args[8], 0);
  assert.equal(call?.args[9], 'god_mode');
}

{
  const lateMod = loadCoop();
  const created = lateMod.call<{ matchId: string }>('coop.room_create', game(), {});
  const m = lateMod.driver(created.matchId);
  const first = presence(USER, 'ada', 's-a');
  const secondId = '00000000-0000-4000-8000-000000000001';
  const second = presence(secondId, 'bea', 's-b');
  m.join([first], game());
  m.loop([{ sender: first, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: ['k1'] } }]);
  m.loop([{ sender: first, opCode: OP.READY, data: { t: 'ready' } }]);
  m.ticks(5);
  m.join([second], { userId: secondId, sessionId: 's-b', username: 'bea', vars: { scope: 'game', game: 'sproto-coop-battle', sid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } });
  m.loop([{ sender: second, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: ['k2'] } }]);
  lateMod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  lateMod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":false,"sealed":true,"tickets":0}' }]);
  killBoss(lateMod, m);
  const calls = settles(lateMod);
  const late = calls.find((row) => row.args[0] === secondId);
  const early = calls.find((row) => row.args[0] === USER);
  assert.equal(late?.args[9], 'late_join');
  assert.equal(late?.args[8], 0);
  assert.equal(early?.args[9], 'clear');
  assert.equal(early?.args[10], 1);
}

{
  const afkMod = loadCoop();
  const run = start(afkMod, USER);
  const row = hydrate(afkMod, run.m).session?.encounter?.accounts[USER];
  assert.ok(row);
  row.neutralAlive = 400;
  (row as { nonNeutral?: number }).nonNeutral = 0;
  afkMod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  afkMod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":false,"sealed":true,"tickets":0,"reason":"afk"}' }]);
  killBoss(afkMod, run.m);
  const call = settles(afkMod).at(-1);
  assert.equal(call?.args[9], 'afk');
  assert.equal(call?.args[8], 0);
}

{
  const cpuMod = loadCoop();
  const run = start(cpuMod);
  hydrate(cpuMod, run.m);
  stateOf(run.m).released[USER] = 1;
  cpuMod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  cpuMod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":false,"sealed":true,"tickets":0}' }]);
  killBoss(cpuMod, run.m);
  const call = settles(cpuMod).at(-1);
  assert.equal(call?.args[9], 'cpu_takeover');
}

{
  const grace = loadCoop();
  const run = start(grace);
  const before = hydrate(grace, run.m).session?.encounter?.accounts[USER]?.neutralAlive ?? 0;
  run.m.leave([run.p]);
  run.m.ticks(8);
  const after = hydrate(grace, run.m).session?.encounter?.accounts[USER]?.neutralAlive ?? 0;
  assert.equal(after, before, 'reconnect grace does not add AFK time');
  assert.equal(settles(grace).length, 0);
}

console.log('coop rewards ok');
