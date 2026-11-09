// Marina Anchor (Coop stage 1) and Dragon Scale (Shooter Wave Mode wave 1): migration 0042, the
// client event path, and the banked Coop grant in CoopMatch.applyPay. The grant is earn-once in SQL
// (game.claim_event_relic); this file checks who the match asks for it and that Tickets stay apart.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type LoadedModule, type MatchDriver } from '../unit/harness';

const USER = '00000000-0000-4000-8000-000000000000';
const SECOND = '00000000-0000-4000-8000-000000000001';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const FP = 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e';
const OP = { HELLO: 1, READY: 3 };
const RELICS = ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale'];

function coopCtx(userId = USER, sid = SID) {
  return { userId, sessionId: `s-${userId}`, username: 'ada', vars: { scope: 'game', game: 'sproto-coop-battle', sid } };
}

function loadCoop() {
  return loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
}

interface CoopState {
  phase: string;
  matchId?: string;
  session: {
    state: { t: number; god: boolean; mode: string; boss?: unknown };
    encounter: { canonicalBossId: string } | null;
  } | null;
  released: Record<string, number>;
}

function stateOf(m: MatchDriver): CoopState {
  return m.state as CoopState;
}

function live(mod: LoadedModule, m: MatchDriver): CoopState {
  const st = stateOf(m);
  const bag = mod.global.CoopMatch as { liveSession?(id: string): CoopState['session'] };
  const held = st.matchId && bag.liveSession ? bag.liveSession(st.matchId) : null;
  if (held) st.session = held;
  return st;
}

function start(mod: LoadedModule, userId = USER, sid = SID) {
  const created = mod.call<{ matchId: string; error?: string }>('coop.room_create', coopCtx(userId, sid), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  const m = mod.driver(created.matchId);
  const p = presence(userId, 'ada', `s-${userId}`);
  assert.equal(m.join([p], coopCtx(userId, sid))[0]?.accept, true);
  m.loop([{ sender: p, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: DEVICES } }]);
  m.loop([{ sender: p, opCode: OP.READY, data: { t: 'ready' } }]);
  assert.equal(stateOf(m).phase, 'playing');
  return { m, p };
}

function killBoss(mod: LoadedModule, m: MatchDriver): void {
  const st = live(mod, m);
  (st.session!.state as { boss?: unknown }).boss = {
    bi: 0, phase: 1, hp: 0, maxHp: 100, x: 10, y: 10, z: 0, face: -1,
    st: 'dead', t: 200, row: 0, w: 40, cycle: 0, flash: 0, tx: 0, ty: 0, hitCd: 0, adds: 0,
  };
  st.session!.state.mode = 'play';
  m.loop([]);
}

function grants(mod: LoadedModule) {
  return mod.nk.sqlCalls.filter((call) => call.sql.startsWith('SELECT COALESCE(game.claim_event_relic('));
}

function settles(mod: LoadedModule) {
  return mod.nk.sqlCalls.filter((call) => call.sql.includes('SELECT game.settle_coop_clear'));
}

/** First call grants, later calls return '' like the SQL ON CONFLICT DO NOTHING. */
function fakeClaims(mod: LoadedModule): Set<string> {
  const owned = new Set<string>();
  mod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  mod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":false,"tickets":0,"sealed":true}' }]);
  mod.nk.onSql(/game\.claim_event_relic/, (args) => {
    const user = String(args[0]);
    if (owned.has(user)) return [{ relic: '' }];
    owned.add(user);
    return [{ relic: 'marina_anchor' }];
  });
  return owned;
}

// Migration 0042: the next id, every Relic in both checks, game_beaten widened, two live rules.
{
  const mod = loadModule();
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = plain(HubSchema.all());
  const ids = all.map((row) => row.id);
  const m = all.find((row) => row.id === '0042_coop_shooter_relics');
  assert.ok(m, 'migration 0042 registered');
  assert.equal(ids.indexOf('0042_coop_shooter_relics'), ids.indexOf('0041_coop_boss_receipt') + 1);
  assert.equal(ids.at(-1), '0042_coop_shooter_relics');
  const sql = m.statements.join('\n');
  const list = RELICS.map((id) => `'${id}'`).join(', ');
  assert.ok(sql.includes(`relic_claim_known CHECK (relic_id IN (${list}))`), 'relic_claim_known');
  assert.ok(sql.includes(`relic_claim_pending_known CHECK (relic_id IN (${list}))`), 'relic_claim_pending_known');
  assert.match(sql, /game_beaten_game CHECK \(game_id IN \('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle'\)\)/);
  assert.match(sql, /\('sproto-coop-battle', 'coop\.stage_clear', 'marina_anchor', NULL, NULL, NULL, '\{"stage":1\}'::jsonb, NULL, '', false\)/);
  assert.match(sql, /\('sproto-shooter', 'shooter\.wave_clear', 'dragon_scale', NULL, NULL, NULL, '\{"wave":1\}'::jsonb, NULL, '', false\)/);
  assert.match(sql, /ON CONFLICT \(game_id, event_type, rule_key\) DO NOTHING/);
  assert.equal(/boss_clear/.test(sql), false, 'server-only boss events get no client rule');
  assert.equal(/tickets_ledger|earn_tickets|take_ticket_credit/.test(sql), false);
  const StageRelics = mod.global.StageRelics as Record<string, unknown>;
  assert.equal(StageRelics.COOP_RELIC, 'marina_anchor');
  assert.equal(StageRelics.SHOOTER_RELIC, 'dragon_scale');
  assert.equal(StageRelics.COOP_BOSS, (mod.global.CoopRewards as { BOSSES: string[] }).BOSSES[0]);
}

// Client reports reach game.apply_event (not refused as server reasons), God Mode flag included.
{
  const mod = loadModule();
  mod.nk.onSql(/apply_event/, (args) => {
    const data = JSON.parse(String(args[4])) as Record<string, unknown>;
    if (args[2] === 'sproto-coop-battle' && args[3] === 'coop.stage_clear' && data.stage === 1) return [{ result: '{"granted":"marina_anchor","granted_items":[]}' }];
    if (args[2] === 'sproto-shooter' && args[3] === 'shooter.wave_clear' && data.wave === 1) return [{ result: '{"granted":"dragon_scale","granted_items":[]}' }];
    return [{ result: '{"granted_items":[]}' }];
  });
  const ctx = (game: string) => ({ userId: USER, vars: { scope: 'game', game, sid: SID, ranked: '0' } });
  const coop = mod.call<{ granted?: string; error?: string }>('session.event', ctx('sproto-coop-battle'), { eventId: 'coop.stage_clear', key: 'c1', data: { stage: 1, godMode: true } });
  assert.equal(coop.error, undefined);
  assert.equal(coop.granted, 'marina_anchor');
  const shooter = mod.call<{ granted?: string; error?: string }>('session.event', ctx('sproto-shooter'), { eventId: 'shooter.wave_clear', key: 's1', data: { wave: 1, godMode: true } });
  assert.equal(shooter.granted, 'dragon_scale');
  assert.equal(mod.call<{ error?: string }>('session.event', ctx('sproto-coop-battle'), { eventId: 'coop.boss_clear', key: 'c2', data: { stage: 1 } }).error, 'server_reason');
  const storage = mod.nk.storage.get(`metaverse/game_beaten:sproto-coop-battle/${USER}`) as { value?: { relicId?: string } } | undefined;
  assert.equal(storage?.value?.relicId, 'marina_anchor');
}

// Banked stage-1 clear grants once per account, with no Ticket call of its own.
{
  const mod = loadCoop();
  const owned = fakeClaims(mod);
  const run = start(mod);
  killBoss(mod, run.m);
  const calls = grants(mod);
  assert.equal(calls.length, 1);
  assert.deepEqual([...calls[0]!.args].slice(0, 4), [USER, SID, 'sproto-coop-battle', 'coop.stage_clear']);
  assert.deepEqual(JSON.parse(String(calls[0]!.args[4])), { stage: 1, banked: true });
  assert.ok(owned.has(USER));
  assert.equal(settles(mod).length, 1, 'Tickets still settle separately');
  run.m.loop([]);
  run.m.loop([]);
  assert.equal(grants(mod).length, 1, 'a settled encounter does not ask again');
  assert.equal(mod.nk.sqlCalls.filter((call) => !call.sql.startsWith('DO ') && /earn_tickets|take_ticket_credit/.test(call.sql)).length, 0);
}

// God Mode refuses Tickets but still grants the Anchor.
{
  const mod = loadCoop();
  fakeClaims(mod);
  const run = start(mod);
  live(mod, run.m).session!.state.god = true;
  killBoss(mod, run.m);
  assert.equal(settles(mod).at(-1)?.args[9], 'god_mode');
  assert.equal(grants(mod).length, 1);
}

// AFK and late join miss Tickets but still clear stage 1 with the team.
{
  const mod = loadCoop();
  fakeClaims(mod);
  const created = mod.call<{ matchId: string }>('coop.room_create', coopCtx(), {});
  const m = mod.driver(created.matchId);
  const first = presence(USER, 'ada', 's-a');
  const second = presence(SECOND, 'bea', 's-b');
  m.join([first], coopCtx());
  m.loop([{ sender: first, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: ['k1'] } }]);
  m.loop([{ sender: first, opCode: OP.READY, data: { t: 'ready' } }]);
  m.ticks(5);
  m.join([second], coopCtx(SECOND, SID2));
  m.loop([{ sender: second, opCode: OP.HELLO, data: { t: 'hello', protocol: 1, fingerprint: FP, devices: ['k2'] } }]);
  killBoss(mod, m);
  const late = settles(mod).find((row) => row.args[0] === SECOND);
  assert.equal(late?.args[9], 'late_join');
  const users = grants(mod).map((row) => row.args[0]).sort();
  assert.deepEqual(users, [USER, SECOND]);
  assert.equal(grants(mod).find((row) => row.args[0] === SECOND)?.args[1], SID2);
}

// A seat released to the CPU does not earn it.
{
  const mod = loadCoop();
  fakeClaims(mod);
  const run = start(mod);
  live(mod, run.m);
  stateOf(run.m).released[USER] = 1;
  killBoss(mod, run.m);
  assert.equal(settles(mod).at(-1)?.args[9], 'cpu_takeover');
  assert.equal(grants(mod).length, 0);
}

// Other stages grant nothing.
{
  const mod = loadCoop();
  fakeClaims(mod);
  const run = start(mod);
  live(mod, run.m).session!.encounter!.canonicalBossId = '02-last-light-vela';
  killBoss(mod, run.m);
  assert.equal(settles(mod).at(-1)?.args[4], '02-last-light-vela');
  assert.equal(grants(mod).length, 0);
}

// A failed Relic grant does not block the Ticket settle.
{
  const mod = loadCoop();
  mod.nk.onSql(/AT TIME ZONE/, () => [{ day: '2026-11-08' }]);
  mod.nk.onSql(/settle_coop_clear/, () => [{ result: '{"ok":true,"paid":true,"tickets":20,"sealed":true,"reason":"clear"}' }]);
  mod.nk.onSql(/game\.claim_event_relic/, () => {
    throw new Error('relic_claim down');
  });
  const run = start(mod);
  killBoss(mod, run.m);
  assert.equal(grants(mod).length, 1);
  assert.equal(settles(mod).length, 1);
  assert.equal(settles(mod)[0]!.args[9], 'clear');
}

console.log('stage relics ok');
