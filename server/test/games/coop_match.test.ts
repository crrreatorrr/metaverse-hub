// H2-C authoritative Coop match: rooms, six seats, reconnect, version, malformed
// input, a full stage, and zero ledger writes. The Nakama load in
// scripts/load/coop-bots.ts repeats the live socket path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRegistrations, loadModule, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FP = 'fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72';
const PROTO = 1;
const DEVICES = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const USERS = [0, 1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const OP = { HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 10, SNAPSHOT: 11, SEATS: 12, REJECT: 13, RESUME: 14, END: 15, RELEASE: 16, PING: 17, PONG: 18, COMMAND: 19 };

function loadCoop() {
  return loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
}

function loadCoopFault() {
  return loadModule({ env: { COOP_AUTHORITATIVE: '1', HUB_FAULT_INJECT: '1' } });
}

function game(userId: string, sessionId = `s-${userId}`) {
  return { userId, sessionId, username: 'ada', vars: { scope: 'game', game: 'sproto-coop-battle', sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } };
}

function ledgerCount(mod: LoadedModule): number {
  return mod.nk.sqlCalls.filter((call) => /earn_tickets|tickets_ledger|score_best|ranked_score|wallet|leaderboard/i.test(call.sql)).length;
}

interface Room {
  mod: LoadedModule;
  m: MatchDriver;
  p: Presence;
  matchId: string;
  code: string;
  ledger: number;
}

function room(userId = USERS[0]!, sessionId = `s-${userId}`): Room {
  const mod = loadCoop();
  const ledger = ledgerCount(mod);
  const created = mod.call<{ matchId: string; code: string; rewards: number; hostTakeover: number; error?: string }>('coop.room_create', game(userId, sessionId), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  assert.equal(created.rewards, 0);
  assert.equal(created.hostTakeover, 0);
  assert.equal(created.code.length, 12);
  const p = presence(userId, 'ada', sessionId);
  const m = mod.driver(created.matchId);
  assert.equal(m.join([p], game(userId, sessionId))[0]?.accept, true);
  return { mod, m, p, matchId: created.matchId, code: created.code, ledger };
}

function hello(m: MatchDriver, p: Presence, devices: string[] = ['k1'], extra: Record<string, unknown> = {}): void {
  m.loop([{ sender: p, opCode: OP.HELLO, data: { t: 'hello', protocol: PROTO, fingerprint: FP, devices, ...extra } }]);
}

function ready(m: MatchDriver, p: Presence): void {
  m.loop([{ sender: p, opCode: OP.READY, data: { t: 'ready' } }]);
}

interface CoopState {
  phase: string;
  broken: string;
  endReason: string;
  session: {
    state: { t: number; god: boolean; mode: string; stageIdx: number; players: { lives: number; hp: number; ctrl: string; st: string }[] };
    seats: { human: boolean; accountId: string | null; device: string; generation: number }[];
    encounter: { accounts: Record<string, unknown> } | null;
  } | null;
  accounts: Record<string, { generation: number; devices: string[]; leftTick: number }>;
  lastFacts: { tickets?: number; scoreSubmitted?: number; accounts?: { accountId?: string; afk?: number; eligible?: number; slots?: number[]; downTicks?: number }[] } | null;
}

function stateOf(m: MatchDriver): CoopState {
  return m.state as CoopState;
}

function bag(mod: LoadedModule): { liveSession(id: string): CoopState['session']; releaseLive(id: string): void } {
  return mod.global.CoopMatch as { liveSession(id: string): CoopState['session']; releaseLive(id: string): void };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function exportHash(mod: LoadedModule, sim: unknown): string {
  const Sim = mod.global.Sim as { exportState(state: unknown): unknown };
  return sha256(Sim.exportState(sim));
}

/** Past the 2 s linger the handler returns null and must already have dropped the sim. */
function finishLinger(m: MatchDriver): void {
  assert.equal(m.ticks(CoopProtoLinger), false);
}

const CoopProtoLinger = 2 * 20 + 5;

/** Nakama returns a packed sim. Rebuild it the way the next callback does, so assertions see players. */
function hydrate(mod: LoadedModule, m: MatchDriver): CoopState {
  const st = m.state as CoopState & { cold?: boolean; simPacked?: unknown; stateHash?: string; matchId?: string };
  const bag = mod.global.CoopMatch as { liveSession?(id: string): NonNullable<CoopState['session']> | null };
  const held = st.matchId && bag.liveSession ? bag.liveSession(st.matchId) : null;
  if (held && held.state.players && held.state.players.length === 6) {
    st.session = held;
    st.cold = false;
    return st;
  }
  if (st.cold && st.simPacked && st.session) {
    const Sim = mod.global.Sim as { importState(data: unknown): NonNullable<CoopState['session']>['state'] };
    st.session.state = Sim.importState(st.simPacked);
    st.cold = false;
  }
  return st;
}

interface StageActor { x: number; y: number; dead?: boolean; st?: string; hp?: number; face?: number; w?: number; slot?: number; ctrl?: string; powers?: unknown[] }
interface StageSim {
  t: number;
  mode: string;
  players: StageActor[];
  enemies?: StageActor[];
  items?: { x: number; y: number; kind: string; taken?: boolean }[];
  projs?: { x: number; y: number; enemy?: boolean }[];
  boss?: StageActor | null;
}

/** The C3 golden fight policy, packed into the seat mask. */
function policyMask(sim: StageSim, slot: number, tick: number): number {
  const p = sim.players[slot];
  if (!p || p.ctrl === 'cpu' || p.st === 'dead' || p.st === 'down') return 0;
  let foe: { x: number; y: number } | null = null;
  let best = 1e9;
  for (const enemy of sim.enemies ?? []) {
    if (enemy.dead || enemy.st === 'lying') continue;
    const dist = Math.abs(enemy.x - p.x) + Math.abs(enemy.y - p.y) * 2;
    if (dist < best) { best = dist; foe = enemy; }
  }
  const boss = sim.boss;
  if (boss && (boss.hp ?? 0) > 0 && boss.st !== 'enter' && boss.st !== 'dead') {
    const dist = Math.abs(boss.x - p.x) * 0.7 + 30;
    if (!foe || dist < best) foe = { x: boss.x - (boss.face || 1) * ((boss.w || 0) * 0.45), y: boss.y };
  }
  let ufo: { x: number; y: number } | null = null;
  let power: { x: number; y: number } | null = null;
  for (const item of sim.items ?? []) {
    if (item.taken) continue;
    if (!ufo && item.kind === 'ufo') ufo = item;
    if (!power && item.kind === 'power') power = item;
  }
  let goal: { x: number; y: number } | null = null;
  const chasingFoe = !ufo && !(power && (p.powers?.length ?? 0) < 3 && p.slot === tick % 6);
  if (ufo && slot === 0) goal = ufo;
  else if (power && (p.powers?.length ?? 0) < 3 && slot === tick % 6) goal = power;
  else if (foe) goal = foe;
  let l = 0, r = 0, u = 0, d = 0, a = 0, j = 0, special = 0;
  if (!goal) r = 1;
  else {
    const dx = goal.x - p.x;
    const dy = goal.y - p.y;
    if (dx > 18) r = 1; else if (dx < -18) l = 1;
    if (dy > 6) d = 1; else if (dy < -6) u = 1;
    const near = Math.abs(dx) < (chasingFoe && goal === foe ? 54 : 16) && Math.abs(dy) < 16;
    if (near && goal === foe && tick % 8 === slot % 8) a = 1;
  }
  if ((p.powers?.length ?? 0) > 0 && tick % 240 === slot * 3) special = 1;
  if (tick % 5 === 0) {
    for (const proj of sim.projs ?? []) {
      if (proj.enemy && Math.abs(proj.y - p.y) < 12 && Math.abs(proj.x - p.x) < 40) { j = 1; break; }
    }
  }
  return l | (r << 1) | (u << 2) | (d << 3) | (a << 4) | (j << 5) | (special << 7);
}

function assertNoLedger(room: Room, label: string): void {
  assert.equal(ledgerCount(room.mod), room.ledger, label);
}

// Registration, pin RPC, and scope.
{
  const mod = loadCoop();
  const { issues } = checkRegistrations(mod.source);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.ok(mod.registered.matches.has('sproto_coop'));
  for (const id of ['coop.version', 'coop.room_create', 'coop.room_join', 'coop.queue_cancel', 'coop.resume', 'coop.metrics', 'coop.golden']) {
    assert.ok(mod.registered.rpcs.has(id), id);
  }
  const version = mod.call<{ protocol: number; fingerprint: string; rewards: number; hostTakeover: number; match: string; snapshotHz: number; error?: string }>(
    'coop.version',
    game(USERS[0]!),
    {},
  );
  assert.equal(version.protocol, PROTO);
  assert.equal(version.fingerprint, FP);
  assert.equal(version.rewards, 0);
  assert.equal(version.hostTakeover, 0);
  assert.equal(version.match, 'sproto_coop');
  assert.equal(version.snapshotHz, 10);
  assert.equal((mod.call<{ error?: string }>('coop.golden', game(USERS[0]!), { id: 'human-seed3' })).error, 'not_found');
  const faulted = loadCoopFault();
  const golden = faulted.call<{ matchId?: string; rewards?: number; error?: string }>('coop.golden', game(USERS[0]!), { id: 'human-seed3' });
  assert.equal(golden.error, undefined, JSON.stringify(golden));
  assert.equal(golden.rewards, 0);
  assert.equal(typeof golden.matchId, 'string');
  assert.equal((faulted.call<{ error?: string }>('coop.golden', game(USERS[0]!), { id: 'other' })).error, 'bad_json');
  assert.equal((mod.call<{ error?: string }>('coop.room_create', { userId: USERS[0]!, vars: { scope: 'hub' } }, {})).error, 'wrong_scope');
  assert.equal((mod.call<{ error?: string }>('coop.room_create', { userId: USERS[0]!, vars: { scope: 'game', game: 'sproto', sid: 'x' } }, {})).error, 'wrong_scope');
  assert.equal((mod.call<{ error?: string }>('coop.room_create', game(USERS[0]!), { seed: 3, stage: 4 })).error, 'rejected');
  const listed = (mod.global.HubGames as { list(): string[] }).list();
  assert.equal(listed.filter((id) => id === 'sproto-coop-battle').length, 1);
  const HubGames = mod.global.HubGames as { matchmakingAllowed(scope: string, game: string, target: string): boolean };
  assert.equal(HubGames.matchmakingAllowed('game', 'sproto-coop-battle', 'sproto-coop-battle'), true);
  assert.equal(HubGames.matchmakingAllowed('hub', '', 'sproto-coop-battle'), false);
  const source = ['coop_match.ts', 'coop_matchmaking.ts', 'coop_protocol.ts'].map((name) => readFileSync(join(root, 'server/modules/src/games', name), 'utf8')).join('\n');
  assert.equal(/nk\.sql|earn_tickets|walletUpdate|leaderboardRecord|score\.submit/.test(source), false);
}

// Private code is a locator. A second account joins. Wrong version and expiry fail.
{
  const first = room();
  const joined = first.mod.call<{ matchId: string; rewards: number; error?: string }>('coop.room_join', game(USERS[1]!), { code: first.code.toLowerCase(), v: PROTO, sim: FP });
  assert.equal(joined.matchId, first.matchId);
  assert.equal(joined.rewards, 0);
  assert.equal((first.mod.call<{ error?: string }>('coop.room_join', game(USERS[1]!), { code: first.code, v: 0 })).error, 'version_mismatch');
  assert.equal((first.mod.call<{ error?: string }>('coop.room_join', game(USERS[1]!), { code: 'not-a-code' })).error, 'room_not_found');
  const key = `sproto_coop/code:${first.code}/00000000-0000-0000-0000-000000000000`;
  const row = first.mod.nk.storage.get(key);
  assert.ok(row);
  row!.value.expiresAt = 1;
  assert.equal((first.mod.call<{ error?: string }>('coop.room_join', game(USERS[2]!), { code: first.code })).error, 'room_not_found');
  for (let i = 0; i < 8; i += 1) first.mod.call('coop.room_join', game(USERS[3]!), { code: 'ZZZZZZZZZZZZ' });
  assert.equal((first.mod.call<{ error?: string }>('coop.room_join', game(USERS[3]!), { code: 'ZZZZZZZZZZZZ' })).error, 'rate_limited');
  const other = presence(USERS[1]!, 'bea', 's-b');
  assert.equal(first.m.join([other], game(USERS[1]!, 's-b'))[0]?.accept, true);
  assert.equal(first.m.joinAttempt(presence(USERS[4]!, 'cy', 's-c'), { vars: { scope: 'hub' } }).rejectMessage, 'wrong_scope');
  assertNoLedger(first, 'room join');
}

// Quick queue: version, same account, idempotent pair, cancel, roster.
{
  const mod = loadCoop();
  const a = presence(USERS[0]!, 'ada', 'sa');
  const b = presence(USERS[1]!, 'bea', 'sb');
  const props = { game: 'sproto-coop-battle', v: String(PROTO), sim: FP };
  mod.rtBefore('MatchmakerAdd', game(USERS[0]!, 'sa'), { matchmakerAdd: { minCount: 1, maxCount: 6, stringProperties: props } });
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(USERS[0]!, 'sa'), { matchmakerAdd: { minCount: 1, maxCount: 6, stringProperties: props } }), /already_queued/);
  mod.rtBefore('MatchmakerRemove', game(USERS[0]!, 'sa'), { matchmakerRemove: { ticket: 't1' } });
  mod.rtBefore('MatchmakerRemove', game(USERS[0]!, 'sa'), { matchmakerRemove: { ticket: 't1' } });
  assert.equal((mod.call<{ ok: boolean; queued: boolean }>('coop.queue_cancel', game(USERS[0]!, 'sa'), {})).queued, false);
  assert.equal((mod.call<{ ok: boolean }>('coop.queue_cancel', game(USERS[0]!, 'sa'), {})).ok, true);
  assert.throws(() => mod.rtBefore('MatchmakerAdd', game(USERS[0]!, 'sa'), { matchmakerAdd: { minCount: 1, maxCount: 6, stringProperties: { ...props, v: '0' } } }), /version_mismatch/);
  const id = mod.matchmake([
    { presence: a, properties: props },
    { presence: b, properties: props },
  ]);
  assert.ok(id);
  assert.equal(mod.nk.matches.get(id!)?.module, 'sproto_coop');
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: b, properties: props }]), id);
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: b, properties: { ...props, v: '9' } }]), undefined);
  assert.equal(mod.matchmake([{ presence: a, properties: props }, { presence: presence(USERS[0]!, 'ada', 'other'), properties: props }]), undefined);
  const stranger = presence(USERS[2]!, 'cy', 'sc');
  const m = mod.driver(id!);
  m.join([a], game(USERS[0]!, 'sa'));
  assert.equal(m.joinAttempt(stranger, game(USERS[2]!, 'sc')).rejectMessage, 'not_in_roster');
  assert.throws(() => mod.rtBefore('MatchmakerAdd', { userId: USERS[3]!, vars: { scope: 'hub' } }, { matchmakerAdd: { minCount: 1, maxCount: 6, stringProperties: props } }), /wrong_scope/);
}

// Six local seats on one account, then six accounts. God, stage, score, and pause do nothing.
{
  const six = room();
  hello(six.m, six.p, DEVICES, { fighter: 'nope' });
  assert.equal(six.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'fighter');
  six.m.dispatcher.clear();
  hello(six.m, six.p, DEVICES);
  const welcome = six.m.dispatcher.sent<{ rewards: number; hostTakeover: number; yours: string[] }>(OP.WELCOME);
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0]?.body.rewards, 0);
  assert.equal(welcome[0]?.body.hostTakeover, 0);
  assert.deepEqual(welcome[0]?.body.yours, DEVICES);
  assert.equal(stateOf(six.m).session?.seats.filter((seat) => seat.human).length, 6);
  assert.equal(new Set(stateOf(six.m).session?.seats.map((seat) => seat.accountId)).size, 1);
  ready(six.m, six.p);
  assert.equal(six.m.dispatcher.sent<{ rewards: number; stageIndex: number; mode: string }>(OP.START)[0]?.body.stageIndex, 0);
  assert.equal(six.m.dispatcher.sent<{ mode: string }>(OP.START)[0]?.body.mode, 'banked');
  six.m.loop([{ sender: six.p, opCode: OP.COMMAND, data: { t: 'god' } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'stage', index: 11 } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'state', state: { hp: 1 } } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'score', score: 999 } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'earn', amount: 20 } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'pause' } }]);
  six.m.loop([{ sender: six.p, opCode: OP.INPUT, data: { t: 'snapshot', snapshot: { t: 1 } } }]);
  assert.equal(stateOf(six.m).session?.state.god, false);
  assert.equal(stateOf(six.m).session?.state.stageIdx, 0);
  const reasons = six.m.dispatcher.sent<{ reason: string }>(OP.REJECT).map((row) => row.body.reason);
  assert.ok(reasons.every((reason) => reason === 'rejected'));
  assertNoLedger(six, 'banned commands');

  const mod = loadCoop();
  const created = mod.call<{ matchId: string; code: string }>('coop.room_create', game(USERS[0]!), {});
  const m = mod.driver(created.matchId);
  const players = USERS.map((id, index) => presence(id, `p${index}`, `s-${id}`));
  for (const p of players) {
    assert.equal(m.join([p], game(p.userId, p.sessionId))[0]?.accept, true);
    hello(m, p, ['k1']);
    ready(m, p);
  }
  assert.equal(stateOf(m).session?.seats.filter((seat) => seat.human).length, 6);
  assert.equal(new Set(stateOf(m).session?.seats.map((seat) => seat.accountId).filter(Boolean)).size, 6);
  assert.equal(m.joinAttempt(presence('00000000-0000-4000-8000-000000000099', 'late', 's-late'), game('00000000-0000-4000-8000-000000000099', 's-late')).rejectMessage, 'match_full');
}

// Malformed input is rejected. A bad frame does not get applied; neutral steps still run.
{
  const run = room();
  hello(run.m, run.p, ['k1']);
  ready(run.m, run.p);
  run.m.dispatcher.clear();
  const at = () => stateOf(run.m).session?.state.t ?? 0;
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 1, frame: at() + 1, seats: [{ slot: 0, device: 'k1', mask: 1.5 }] } }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'mask');
  run.m.loop([{
    sender: run.p,
    opCode: OP.INPUT,
    data: `{"t":"input","seq":2,"frame":${at() + 1},"seats":[{"slot":0,"device":"k1","mask":1e309}]}`,
  }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'nan');
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 3, frame: at(), seats: [{ slot: 0, device: 'k1', mask: 1 }] } }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'stale');
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 4, frame: at() + 9, seats: [{ slot: 0, device: 'k1', mask: 1 }] } }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'future');
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 5, frame: at() + 1, seats: [{ slot: 1, device: 'k1', mask: 1 }] } }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'owner');
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: '{' }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'schema');
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: 'x'.repeat(900) }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'oversized');
  const before = stateOf(run.m).session?.state.t ?? 0;
  run.m.loop([]);
  assert.ok((stateOf(run.m).session?.state.t ?? 0) >= before);
  assert.equal(stateOf(run.m).session?.state.god, false);
  assertNoLedger(run, 'malformed input');
}

// Reconnect keeps lives. A new socket invalidates the old one. Grace then frees the seat.
{
  const run = room();
  hello(run.m, run.p, ['k1', 'k2']);
  const seated = hydrate(run.mod, run.m).session!.state.players;
  seated[0]!.lives = 1;
  seated[0]!.hp = 40;
  seated[1]!.lives = 1;
  const next = presence(USERS[0]!, 'ada', 's-next');
  assert.equal(run.m.join([next], game(USERS[0]!, 's-next'))[0]?.accept, true);
  run.m.loop([{ sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 1, frame: 1, seats: [{ slot: 0, device: 'k1', mask: 1 }] } }]);
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT).at(-1)?.body.reason, 'stale-socket');
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 1);
  hello(run.m, next);
  assert.equal(run.m.dispatcher.sent<{ generation: number; rewards: number; hostTakeover: number; acceptClientState: number }>(OP.RESUME).at(-1)?.body.generation, 2);
  assert.equal(run.m.dispatcher.sent<{ acceptClientState: number }>(OP.RESUME).at(-1)?.body.acceptClientState, 0);
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 1);
  assert.equal(hydrate(run.mod, run.m).session!.state.players[1]?.lives, 1);
  assert.equal(stateOf(run.m).broken, '');
  ready(run.m, next);
  run.m.leave([next]);
  assert.equal(hydrate(run.mod, run.m).session?.state.players[0]?.ctrl, 'cpu');
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 1);
  const back = presence(USERS[0]!, 'ada', 's-back');
  run.m.join([back], game(USERS[0]!, 's-back'));
  hello(run.m, back);
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 1);
  assert.notEqual(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 2);
  run.m.leave([back]);
  const leftAt = stateOf(run.m).accounts[USERS[0]!]!.leftTick;
  run.m.ticks(15 * 20 - 1);
  assert.equal(stateOf(run.m).session?.seats[0]?.human, true);
  const held = hydrate(run.mod, run.m).session!.state.players[0]!;
  held.lives = 1;
  held.hp = 40;
  run.m.loop([]);
  assert.ok(stateOf(run.m).phase === 'done' || stateOf(run.m).session?.seats[0]?.human === false);
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.lives, 1);
  assert.equal(hydrate(run.mod, run.m).session!.state.players[0]?.hp, 40);
  assert.ok(stateOf(run.m).accounts[USERS[0]!]!.leftTick !== leftAt || stateOf(run.m).phase === 'done');
  assertNoLedger(run, 'reconnect');
}

// Lobby idle cancels. Snapshots are render-only. Shutdown checkpoints and resume keeps lives.
{
  const idle = room();
  hello(idle.m, idle.p, ['k1']);
  idle.m.ticks(30 * 20);
  const ended = idle.m.dispatcher.sent<{ reason: string; rewards: number; hostTakeover: number }>(OP.END);
  assert.equal(ended.at(-1)?.body.reason, 'room_expired');
  assert.equal(ended.at(-1)?.body.rewards, 0);
  assert.equal(ended.at(-1)?.body.hostTakeover, 0);

  const run = room();
  hello(run.m, run.p, ['k1']);
  ready(run.m, run.p);
  run.m.loop([
    { sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 1, frame: 1, seats: [{ slot: 0, device: 'k1', mask: 2 }] } },
    { sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 2, frame: 2, seats: [{ slot: 0, device: 'k1', mask: 2 }] } },
    { sender: run.p, opCode: OP.INPUT, data: { t: 'input', seq: 3, frame: 3, seats: [{ slot: 0, device: 'k1', mask: 2 }] } },
  ]);
  const snap = run.m.dispatcher.sent<{ kind: string; restart: number; protocol: number }>(OP.SNAPSHOT).at(-1);
  assert.ok(snap);
  assert.equal(snap?.body.kind, 'sproto-coop-battle-snapshot');
  assert.equal(snap?.body.restart, 0);
  assert.equal(snap?.body.protocol, PROTO);
  const tick = stateOf(run.m).session!.state.t;
  const wounded = hydrate(run.mod, run.m).session!.state.players[0]!;
  wounded.lives = 1;
  wounded.hp = 40;
  run.m.terminate(1);
  const shutdown = run.m.dispatcher.sent<{ reason: string; hostTakeover: number; rewards: number; resume: string; acceptClientState: number }>(OP.END).at(-1);
  assert.equal(shutdown?.body.reason, 'server_shutdown');
  assert.equal(shutdown?.body.hostTakeover, 0);
  assert.equal(shutdown?.body.rewards, 0);
  assert.equal(shutdown?.body.resume, 'server');
  assert.equal(shutdown?.body.acceptClientState, 0);
  assert.equal((run.mod.call<{ error?: string }>('coop.resume', game(USERS[0]!), { matchId: run.matchId, state: { hp: 100 } })).error, 'rejected');
  const resumed = run.mod.call<{ matchId: string; rewards: number; hostTakeover: number; error?: string }>('coop.resume', game(USERS[0]!), { matchId: run.matchId });
  assert.equal(resumed.error, undefined, JSON.stringify(resumed));
  assert.equal(resumed.rewards, 0);
  assert.equal(resumed.hostTakeover, 0);
  assert.notEqual(resumed.matchId, run.matchId);
  const again = run.mod.call<{ matchId: string }>('coop.resume', game(USERS[0]!), { matchId: run.matchId });
  assert.equal(again.matchId, resumed.matchId);
  const next = run.mod.driver(resumed.matchId);
  assert.equal(stateOf(next).session?.state.t, tick);
  assert.equal(hydrate(run.mod, next).session?.state.players[0]?.lives, 1);
  assert.equal(hydrate(run.mod, next).session?.state.players[0]?.hp, 40);
  assert.equal(stateOf(next).session?.state.god, false);
  assertNoLedger(run, 'resume');
}

// One account, six seats, the golden fight policy, seed 3, until the stage ends.
{
  const mod = loadCoop();
  const ledger = ledgerCount(mod);
  const matchId = (mod.nk.matchCreate as (name: string, params: Record<string, string>) => string)('sproto_coop', {
    private: '1', seed: '3', seedSource: 'server',
  });
  const m = mod.driver(matchId);
  const p = presence(USERS[0]!, 'ada', 's-stage');
  assert.equal(m.join([p], game(USERS[0]!, 's-stage'))[0]?.accept, true);
  hello(m, p, DEVICES);
  ready(m, p);
  let seq = 1;
  let mode = 'play';
  const started = Date.now();
  for (let i = 0; i < 5000 && mode === 'play'; i += 1) {
    const sim = hydrate(mod, m).session!.state as unknown as StageSim;
    const base = sim.t;
    const seatsFor = (tick: number) => DEVICES.map((device, slot) => ({ slot, device, mask: policyMask(sim, slot, tick) }));
    m.loop([0, 1, 2].map((offset) => ({
      sender: p,
      opCode: OP.INPUT,
      data: { t: 'input', seq: seq++, frame: base + 1 + offset, seats: seatsFor(base + offset) },
    })));
    mode = stateOf(m).session?.state.mode || stateOf(m).phase;
    if (stateOf(m).phase === 'done') break;
  }
  const finalMode = stateOf(m).session?.state.mode || stateOf(m).endReason;
  const facts = stateOf(m).lastFacts;
  const externalTick = stateOf(m).session?.state.t;
  const externalHash = (stateOf(m) as { stateHash?: string }).stateHash || '';
  console.log(`six-seat stage mode=${finalMode} tick=${externalTick} hash=${externalHash} ms=${Date.now() - started}`);
  assert.equal(finalMode, 'gameover');
  assert.equal(externalTick, 10347);
  assert.equal(externalHash, '0ace8b5604e871232143b85a8ae035b9054de908604adcd1f557acdc9998ed96');
  assert.equal(facts?.tickets ?? 0, 0);
  assert.equal(facts?.scoreSubmitted ?? 0, 0);
  assert.equal(facts?.accounts?.length, 1);
  assert.equal(facts?.accounts?.[0]?.slots?.length, 6);
  assert.equal(ledgerCount(mod), ledger);

  const packed = loadCoop();
  const packedLedger = ledgerCount(packed);
  const packedId = (packed.nk.matchCreate as (name: string, params: Record<string, string>) => string)('sproto_coop', {
    private: '1', seed: '3', seedSource: 'server', golden: 'human-seed3',
  });
  const packedMatch = packed.driver(packedId);
  let packedMode = 'play';
  const packedStarted = Date.now();
  for (let i = 0; i < 5000 && packedMode === 'play'; i += 1) {
    packedMatch.loop([]);
    packedMode = stateOf(packedMatch).session?.state.mode || stateOf(packedMatch).phase;
    if (stateOf(packedMatch).phase === 'done') break;
  }
  const packedTick = stateOf(packedMatch).session?.state.t;
  const packedHash = (stateOf(packedMatch) as { stateHash?: string }).stateHash || '';
  console.log(`golden driver mode=${stateOf(packedMatch).endReason} tick=${packedTick} hash=${packedHash} ms=${Date.now() - packedStarted}`);
  assert.equal(packedTick, 10347);
  assert.equal(stateOf(packedMatch).endReason, 'gameover');
  assert.equal(packedHash, externalHash);
  assert.equal(ledgerCount(packed), packedLedger);
}

// AFK and downed facts stay unpaid. Two accounts can input the same frame.
{
  const run = room();
  hello(run.m, run.p, ['k1']);
  ready(run.m, run.p);
  run.m.ticks(200);
  const afk = stateOf(run.m).lastFacts;
  const CoopProtocol = run.mod.global.CoopProtocol as { participationFacts(session: unknown): { tickets: number; accounts: { afk: number; presentAtStart: number; downTicks: number }[] } };
  const afkFacts = CoopProtocol.participationFacts(hydrate(run.mod, run.m).session);
  assert.equal(afkFacts.tickets, 0);
  assert.equal(afkFacts.accounts[0]?.presentAtStart, 1);
  assert.equal(afkFacts.accounts[0]?.afk, 1);
  assert.equal(afk?.tickets ?? 0, 0);

  const down = room();
  hello(down.m, down.p, ['k1']);
  ready(down.m, down.p);
  for (let i = 0; i < 200; i += 1) {
    hydrate(down.mod, down.m).session!.state.players[0]!.st = 'down';
    down.m.loop([]);
  }
  const downFacts = CoopProtocol.participationFacts(hydrate(down.mod, down.m).session);
  assert.equal(downFacts.accounts[0]?.afk, 0);
  assert.ok((downFacts.accounts[0]?.downTicks ?? 0) > 0);
  assert.equal(downFacts.tickets, 0);

  const mod = loadCoop();
  const created = mod.call<{ matchId: string }>('coop.room_create', game(USERS[0]!), {});
  const m = mod.driver(created.matchId);
  const a = presence(USERS[0]!, 'ada', 'sa');
  const b = presence(USERS[1]!, 'bea', 'sb');
  m.join([a], game(USERS[0]!, 'sa'));
  m.join([b], game(USERS[1]!, 'sb'));
  hello(m, a, ['k1']);
  hello(m, b, ['k1']);
  ready(m, a);
  ready(m, b);
  m.loop([
    { sender: a, opCode: OP.INPUT, data: { t: 'input', seq: 1, frame: 1, seats: [{ slot: 0, device: 'k1', mask: 2 }] } },
    { sender: b, opCode: OP.INPUT, data: { t: 'input', seq: 1, frame: 1, seats: [{ slot: 1, device: 'k1', mask: 1 }] } },
  ]);
  const both = (mod.global.CoopProtocol as { participationFacts(session: unknown): { tickets: number; accounts: unknown[] } }).participationFacts(hydrate(mod, m).session);
  assert.equal(both.accounts.length, 2);
  assert.equal(both.tickets, 0);
  assert.equal(stateOf(m).session?.state.god, false);
}

// Version mismatch never starts the sim.
{
  const run = room();
  hello(run.m, run.p, ['k1'], { protocol: 0, fingerprint: 'deadbeef' });
  assert.equal(run.m.dispatcher.sent<{ reason: string }>(OP.REJECT)[0]?.body.reason, 'version_mismatch');
  assert.equal(run.m.dispatcher.sent(OP.WELCOME).length, 0);
  assert.equal(stateOf(run.m).session?.seats.some((seat) => seat.human), false);
  run.m.loop([{ sender: run.p, opCode: OP.PING, data: { t: 'ping', c: 7 } }]);
  assert.equal(run.m.dispatcher.sent<{ c: number; rewards: number }>(OP.PONG)[0]?.body.c, 7);
  assertNoLedger(run, 'version');
}

// The in-VM sim is released when the fight ends, when everyone leaves, on
// matchTerminate, and when the step fails. A soak of many matches stays empty.
{
  const ended = room();
  hello(ended.m, ended.p, ['k1']);
  ready(ended.m, ended.p);
  assert.ok(bag(ended.mod).liveSession(ended.matchId));
  hydrate(ended.mod, ended.m).session!.state.mode = 'gameover';
  ended.m.loop([]);
  assert.equal(stateOf(ended.m).endReason, 'gameover');
  assert.ok(bag(ended.mod).liveSession(ended.matchId));
  finishLinger(ended.m);
  assert.equal(bag(ended.mod).liveSession(ended.matchId), null);

  const left = room();
  hello(left.m, left.p, ['k1']);
  ready(left.m, left.p);
  left.m.leave([left.p]);
  assert.equal(left.m.ticks(15 * 20 + 5), true);
  assert.equal(stateOf(left.m).endReason, 'abandoned');
  assert.ok(bag(left.mod).liveSession(left.matchId));
  finishLinger(left.m);
  assert.equal(bag(left.mod).liveSession(left.matchId), null);

  const stopped = room();
  hello(stopped.m, stopped.p, ['k1']);
  ready(stopped.m, stopped.p);
  stopped.m.terminate(1);
  assert.equal(stopped.m.dispatcher.sent<{ reason: string }>(OP.END).at(-1)?.body.reason, 'server_shutdown');
  assert.equal(bag(stopped.mod).liveSession(stopped.matchId), null);

  const faulted = room();
  hello(faulted.m, faulted.p, ['k1']);
  ready(faulted.m, faulted.p);
  (stateOf(faulted.m) as CoopState & { broken: string }).broken = 'test';
  faulted.m.loop([]);
  assert.equal(stateOf(faulted.m).endReason, 'sim_fault');
  assert.ok(bag(faulted.mod).liveSession(faulted.matchId));
  finishLinger(faulted.m);
  assert.equal(bag(faulted.mod).liveSession(faulted.matchId), null);

  const soak = loadCoop();
  const gc = (globalThis as { gc?: () => void }).gc;
  const heap = () => {
    gc?.();
    return process.memoryUsage().heapUsed;
  };
  const wave = () => {
    const ids: string[] = [];
    for (let n = 0; n < 40; n += 1) {
      const matchId = (soak.nk.matchCreate as (name: string, params: Record<string, string>) => string)('sproto_coop', {
        private: '1', seed: '3', seedSource: 'server',
      });
      const driver = soak.driver(matchId);
      const seat = presence(USERS[n % USERS.length]!, 'ada', `soak-${n}`);
      driver.join([seat], game(USERS[n % USERS.length]!, `soak-${n}`));
      hello(driver, seat, ['k1']);
      ready(driver, seat);
      driver.ticks(8);
      driver.terminate(0);
      ids.push(matchId);
    }
    for (const id of ids) assert.equal(bag(soak).liveSession(id), null);
  };
  wave();
  const afterFirst = heap();
  wave();
  wave();
  const afterLast = heap();
  if (gc) assert.ok(afterLast < afterFirst + 8 * 1024 * 1024, `heap ${afterFirst} -> ${afterLast}`);
  console.log(`coop sim soak heap ${afterFirst} -> ${afterLast} gc=${Boolean(gc)}`);
}

// A shutdown checkpoint and an in-place rehydrate both rebuild the live sim from exportState.
{
  const run = room();
  hello(run.m, run.p, ['k1']);
  ready(run.m, run.p);
  run.m.ticks(30);
  const wounded = hydrate(run.mod, run.m).session!.state.players[0]!;
  wounded.lives = 1;
  wounded.hp = 40;
  run.m.terminate(1);
  const shutdown = run.m.dispatcher.sent<{ stateHash: string; reason: string }>(OP.END).at(-1);
  assert.equal(shutdown?.body.reason, 'server_shutdown');
  assert.equal(bag(run.mod).liveSession(run.matchId), null);
  const resumed = run.mod.call<{ matchId: string; error?: string }>('coop.resume', game(USERS[0]!), { matchId: run.matchId });
  assert.equal(resumed.error, undefined, JSON.stringify(resumed));
  const saved = run.mod.nk.storage.get(`sproto_coop/ckpt:${run.matchId}/00000000-0000-0000-0000-000000000000`);
  assert.ok(saved);
  const exported = saved.value['exported'];
  assert.equal(sha256(exported), shutdown?.body.stateHash);
  const Sim = run.mod.global.Sim as { importState(data: unknown): { players: { ctrl: string }[] }; exportState(state: unknown): unknown };
  assert.equal(sha256(Sim.exportState(Sim.importState(exported))), shutdown?.body.stateHash);
  const next = run.mod.driver(resumed.matchId);
  const rebuilt = hydrate(run.mod, next).session!;
  assert.equal(rebuilt.state.players.length, 6);
  assert.equal(rebuilt.state.players[0]?.lives, 1);
  assert.equal(rebuilt.state.players[0]?.hp, 40);
  assert.equal(rebuilt.state.players[0]?.ctrl, 'cpu');
  const packedPlayers = (exported as { state: { players: { ctrl: string }[] } }).state.players;
  const livePlayers = rebuilt.state.players as { ctrl: string }[];
  for (let i = 0; i < packedPlayers.length; i += 1) livePlayers[i]!.ctrl = packedPlayers[i]!.ctrl;
  assert.equal(exportHash(run.mod, rebuilt.state), shutdown?.body.stateHash);
  assert.equal(stateOf(next).session?.state.t, stateOf(run.m).session?.state.t);

  const again = room();
  hello(again.m, again.p, ['k1']);
  ready(again.m, again.p);
  again.m.ticks(12);
  const live = hydrate(again.mod, again.m).session!.state as { events?: unknown[] };
  if (live.events) live.events.length = 0;
  const snap = SimExport(again.mod, live);
  const hash = exportHash(again.mod, live);
  bag(again.mod).releaseLive(again.matchId);
  const parked = again.m.state as { simPacked: unknown; cold: boolean; phase: string; doneTick: number };
  parked.simPacked = snap;
  parked.cold = true;
  parked.phase = 'done';
  parked.doneTick = 1_000_000_000;
  again.m.loop([]);
  const restored = hydrate(again.mod, again.m).session!;
  assert.equal(restored.state.players.length, 6);
  assert.equal(exportHash(again.mod, restored.state), hash);
  assert.ok(bag(again.mod).liveSession(again.matchId));
}

function SimExport(mod: LoadedModule, sim: unknown): unknown {
  return (mod.global.Sim as { exportState(state: unknown): unknown }).exportState(sim);
}

console.log('coop_match tests ok');
