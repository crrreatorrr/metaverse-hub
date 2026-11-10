import { REALM_IDS } from '../src/core/realm-id';
// Hub client net layer: protocol quantisation, opcodes vs the server module,
// interpolation, RemoteWorld, and connectPlaza against the SDK mock server.
import assert from 'node:assert/strict';
import { createMockRealtimeServer, type RealtimePresence } from '@metaverse/hub-sdk';
import { loadModule } from '../../../server/test/unit/harness';
import { createInterp } from '../src/net/interp';
import { connectPlaza, sessionMatchKey } from '../src/net/plaza';
import { ANIMS, OP, TICK_RATE, byteToYaw, decodeRow, encodePose, parseDelta, parseRoster, parseSnapshot, yawToByte, zoneOf, type PoseRow } from '../src/net/protocol';
import { createRemoteWorld } from '../src/net/remoteWorld';
import { createLiveLeaderboardProvider, verseTotals } from '../src/leaderboards';
import { BOARD_META, HUB_BOARD_IDS, formatBoardScore, formatTrialMs, gameForBoard, serverBoard } from '../src/m3/types';
import { createStubLeaderboardProvider } from '../src/m3/stub';
import type { NakamaClient } from '@metaverse/hub-sdk';

// Quantisation round trip.
{
  const body = encodePose(12.345, 1.775, -42.1, Math.PI / 2, 2);
  assert.deepEqual(body, [1235, 178, -4210, 64, 2]);
  const row = decodeRow([3, ...body] as PoseRow);
  assert.equal(row.slot, 3);
  assert.ok(Math.abs(row.x - 12.35) < 1e-9);
  assert.ok(Math.abs(row.yaw - Math.PI / 2) < 0.03);
  assert.equal(yawToByte(-Math.PI / 2), 192);
  assert.equal(yawToByte(Math.PI * 2), 0);
  assert.ok(Math.abs(byteToYaw(255) - (255 / 256) * Math.PI * 2) < 1e-9);
  assert.equal(zoneOf(1.7), 'plaza');
  assert.equal(zoneOf(-298), 'bar');
  assert.equal(parseDelta({ t: 4, p: [[1, 2, 3, 4, 5, 0], [1, 'x']] })?.p.length, 1);
  assert.equal(parseSnapshot({ you: 1 }), null);
  assert.deepEqual(parseRoster({ del: [3, 'x'] }), { del: [3] });
}

// Opcodes and constants match the server module.
{
  const mod = loadModule({ noInit: true });
  const HubMatch = mod.global.HubMatch as Record<string, unknown>;
  assert.equal(HubMatch.OP_POSE, OP.POSE);
  assert.equal(HubMatch.OP_SNAPSHOT, OP.SNAPSHOT);
  assert.equal(HubMatch.OP_DELTA, OP.DELTA);
  assert.equal(HubMatch.OP_ROSTER, OP.ROSTER);
  assert.equal(HubMatch.OP_PROFILE, OP.PROFILE);
  assert.equal(HubMatch.OP_EMOTE, OP.EMOTE);
  assert.equal(HubMatch.OP_TRAVEL, OP.TRAVEL);
  assert.equal(HubMatch.TICK_RATE, TICK_RATE);
  assert.deepEqual(JSON.parse(JSON.stringify(HubMatch.ANIMS)), [...ANIMS]);
  assert.equal((HubMatch.zoneOf as (y: number) => string)(-29800), zoneOf(-298));
}

// Interpolation: 150 ms behind, short-arc yaw, snap over 5 m.
{
  const it = createInterp(150);
  const out = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  assert.equal(it.sample(0, out), null);
  assert.equal(it.poseHoldMs(0), 0);
  it.push(1000, { x: 0, y: 0, z: 0, yaw: 6.2, anim: 1 });
  it.push(1100, { x: 1, y: 0, z: 0, yaw: 0.1, anim: 1 });
  it.sample(1200, out);
  assert.ok(Math.abs(out.x - 0.5) < 1e-9);
  assert.ok(out.yaw > 6.2 || out.yaw < 0.1, `short arc, got ${out.yaw}`);
  assert.equal(it.poseHoldMs(1250), 0);
  assert.equal(it.poseHoldMs(1251), 1);
  assert.equal(it.poseHoldMs(1400), 150);
  assert.equal(it.poseHoldMs(1401), 151);
  it.push(1200, { x: 40, y: 0, z: 0, yaw: 0, anim: 0 });
  it.sample(1250, out);
  assert.equal(out.x, 40, 'teleports snap');
}

// A 0.025 m/s walk sends a changed centimetre every 400 ms.
{
  const it = createInterp();
  const push = (at: number, x: number, anim: number) => it.push(at, { x, y: 0, z: 0, yaw: 0, anim });
  push(0, 0, 1);
  it.push(200, { x: 0, y: 0, z: 0, yaw: 0.05, anim: 1 });
  push(400, 0.01, 1);
  it.push(500, { x: 0.01, y: 0, z: 0, yaw: 0.1, anim: 1 });
  assert.ok(Math.abs((it.slowGroundSpeed(799) ?? 0) - 0.025) < 1e-9);
  assert.equal(it.slowGroundSpeed(951), undefined, 'stop holding after the expected next sample');
  push(800, 0.02, 1);
  assert.ok(Math.abs((it.slowGroundSpeed(1199) ?? 0) - 0.025) < 1e-9);
  push(1200, 0.02, 0);
  assert.equal(it.slowGroundSpeed(1200), undefined, 'an explicit idle ends the cadence estimate');
  it.clear();
  assert.equal(it.slowGroundSpeed(1300), undefined);
}

// RemoteWorld: snapshot excludes self, roster add/upd/del, deltas feed interp.
{
  const w = createRemoteWorld();
  let notified = 0;
  w.onRoster(() => {
    notified += 1;
  });
  w.applySnapshot({ t: 1, you: 0, shard: 2, roster: [
    { s: 0, u: 'me', n: 'me', c: '', st: '', pt: '', r: [], g: '', away: false },
    { s: 1, u: 'b', n: 'bob', c: 'wizard', st: '', pt: '', r: [], g: '', away: false },
  ], p: [[1, 100, 178, 0, 0, 0]] }, 0);
  assert.equal(w.players.size, 1);
  assert.equal(w.shard, 2);
  assert.deepEqual(w.selfRelics, []);
  w.applyRoster({ upd: [{ s: 0, u: 'me', n: 'me', c: '', st: '', pt: '', r: ['dragon_scale'], g: '', away: false }] });
  assert.deepEqual(w.selfRelics, ['dragon_scale']);
  assert.equal(w.byUser('me'), null);
  w.applyRoster({ add: [{ s: 2, u: 'c', n: 'cy', c: '', st: '', pt: '', r: [], g: '', away: false }] });
  w.applyRoster({ upd: [{ s: 1, u: 'b', n: 'bob', c: 'wizard', st: '', pt: '', r: [], g: 'nobu', away: true }] });
  assert.equal(w.byUser('b')?.game, 'nobu');
  assert.equal(w.presentCount(), 1);
  w.applyRoster({ del: [2] });
  assert.equal(w.byUser('c'), null);
  w.applyDelta({ t: 2, p: [[1, 200, 178, 0, 0, 1]] }, 100);
  assert.equal(w.byUser('b')?.interp.latest()?.x, 2);
  assert.equal(notified, 5);
}

// connectPlaza against the SDK mock: hub.join placement, SNAPSHOT, throttled POSE, TRAVEL.
{
  const server = createMockRealtimeServer();
  const received: { opCode: number; body: unknown }[] = [];
  const members: RealtimePresence[] = [];
  server.registerMatch('hub', {
    init: () => ({ state: {} }),
    join: (_s, presences, d) => {
      members.push(...presences);
      d.broadcast(OP.SNAPSHOT, { t: 0, you: 0, shard: 1, roster: [{ s: 0, u: 'a', n: 'alice', c: '', st: '', pt: '', r: [], g: '', away: false }, { s: 1, u: 'zed', n: 'zed', c: '', st: '', pt: '', r: [], g: '', away: false }], p: [[1, 0, 178, 0, 0, 0]] }, presences);
    },
    loop: (_s, msgs, d) => {
      for (const m of msgs) received.push({ opCode: m.opCode, body: JSON.parse(new TextDecoder().decode(m.data)) });
      d.broadcast(OP.DELTA, { t: 1, p: [[1, 500, 178, 0, 0, 1]] });
    },
  });
  const hub = server.createMatch('hub');
  const asked: unknown[] = [];
  server.registerRpc('hub.join', (_ctx, body) => {
    asked.push(body);
    return { matchId: hub, shard: 1, room: 'hub.1' };
  });
  let t = 0;
  const statuses: string[] = [];
  const plaza = await connectPlaza({ realm: 'plaza', getToken: () => 'unused', realtime: server.connect({ userId: 'a', username: 'alice' }), now: () => t, onStatus: (s) => statuses.push(s) });
  await server.flush();
  assert.equal(plaza.shard, 1);
  assert.equal(plaza.room, 'hub.1');
  assert.equal(plaza.world.players.size, 1);
  plaza.sendPose(1, 1.775, 2, 0, 1);
  plaza.sendPose(1.1, 1.775, 2, 0, 1);
  t = 50;
  plaza.sendPose(1.2, 1.775, 2, 0, 1);
  t = 120;
  plaza.sendPose(1.3, 1.775, 2, 0, 1);
  t = 240;
  plaza.sendPose(1.3, 1.775, 2, 0, 1);
  plaza.travel('nobu');
  await server.flush();
  server.tick();
  await server.flush();
  const poses = received.filter((r) => r.opCode === OP.POSE).map((r) => r.body);
  assert.deepEqual(poses, [[100, 178, 200, 0, 1], [130, 178, 200, 0, 1]], 'throttled to 10/s and unchanged poses skipped');
  assert.deepEqual(received.find((r) => r.opCode === OP.TRAVEL)?.body, { game: 'nobu' });
  assert.equal(plaza.world.byUser('zed')?.interp.latest()?.x, 5);
  assert.ok(statuses.includes('online'));
  plaza.close();
  void members;
  assert.deepEqual(asked[0], {}, 'plaza placement omits realm');
}

// Bar screen: NOBU pages per level in ms, verse pages from verse.board.
{
  assert.deepEqual(HUB_BOARD_IDS.filter((id) => id.startsWith('nobu_trial_time:')), [
    'nobu_trial_time:1v2', 'nobu_trial_time:2v2', 'nobu_trial_time:3v2',
    'nobu_trial_time:4', 'nobu_trial_time:6', 'nobu_trial_time:5',
    'nobu_trial_time:1', 'nobu_trial_time:2', 'nobu_trial_time:3',
  ], 'wall cycles current layouts before Classic');
  const stub = createStubLeaderboardProvider();
  for (const level of ['1', '2', '3'] as const) {
    const current = `nobu_trial_time:${level}v2` as const, classic = `nobu_trial_time:${level}` as const;
    assert.equal(BOARD_META[current].title, `NOBU · LEVEL ${level}`);
    assert.equal(BOARD_META[classic].title, `NOBU · LEVEL ${level} CLASSIC`);
    assert.equal(gameForBoard(current), 'nobu');
    const oldPage = await stub.load(classic), newPage = await stub.load(current);
    assert.deepEqual(newPage.rows.map((r) => r.score), oldPage.rows.map((r) => Math.round(r.score * 1.72)));
  }
  for (const [level, floor] of [['4', 24000], ['6', 30000], ['5', 21000]] as const) {
    const id = `nobu_trial_time:${level}` as const;
    assert.equal(gameForBoard(id), 'nobu');
    assert.equal(BOARD_META[id].title, `NOBU · LEVEL ${level}`);
    assert.deepEqual(serverBoard(id), { board: 'nobu_trial_time', variant: level });
    const page = await stub.load(id);
    assert.equal(page.order, 'asc'); assert.equal(page.rows.length, 10);
    assert.ok(page.rows.every(row => Number.isInteger(row.score) && row.score >= floor));
    assert.deepEqual(page.rows.map(row => row.score), page.rows.map(row => row.score).sort((a, b) => a - b));
  }
  assert.equal(formatTrialMs(83456), '1:23.45');
  assert.equal(formatTrialMs(15000), '0:15.00');
  assert.equal(formatBoardScore('nobu_trial_time:2', 61009), '1:01.00');
  assert.equal(formatBoardScore('hpos10i_act_time', 61.5), '1:01.50');
  assert.deepEqual(serverBoard('nobu_trial_time:3'), { board: 'nobu_trial_time', variant: '3' });
  assert.equal(serverBoard('verse_total'), null);
  const calls: { id: string; body: object }[] = [];
  const client: NakamaClient = {
    authenticateDevice: async () => ({ token: '', userId: '' }),
    async rpc<T>(id: string, body: object): Promise<T> {
      calls.push({ id, body });
      if (id === 'leaderboard.top') return { rows: [{ userId: 'u1', name: 'cone-kid', value: 41230, rank: 1 }] } as T;
      return { rows: [{ name: 'a', userId: 'ua', gameId: 'nobu', lifetime: 5 }, { name: 'a', userId: 'ua', gameId: 'sproto', lifetime: 7 }, { name: 'b', userId: 'ub', gameId: 'nobu', lifetime: 9 }] } as T;
    },
  };
  const provider = createLiveLeaderboardProvider(client, () => 'tok');
  const nobu = await provider.load('nobu_trial_time:2');
  assert.deepEqual(calls[0], { id: 'leaderboard.top', body: { boardId: 'nobu_trial_time', limit: 10, variant: '2' } });
  assert.equal(nobu.rows[0]!.score, 41230);
  assert.equal(nobu.order, 'asc');
  for (const variant of ['1v2', '2v2', '3v2', '4', '6', '5'] as const) {
    const page = await provider.load(`nobu_trial_time:${variant}`);
    assert.deepEqual(calls.at(-1), { id: 'leaderboard.top', body: { boardId: 'nobu_trial_time', limit: 10, variant } });
    assert.equal(page.title, `NOBU · LEVEL ${variant[0]}`);
    assert.equal(page.rows[0]!.score, 41230);
  }
  const total = await provider.load('verse_total');
  assert.deepEqual(total.rows.map((r) => [r.name, r.score, r.rank]), [['a', 12, 1], ['b', 9, 2]]);
  const byNobu = await provider.load('verse_by_game_nobu');
  assert.deepEqual(byNobu.rows.map((r) => r.name), ['b', 'a']);
  assert.equal(calls.filter((c) => c.id === 'verse.board').length, 1, 'verse rows cached');
}

// Review fix (HUB-W-1-01): Verse totals group by userId, so two players whose names
// clean to the same string stay two rows. Rows without a userId still group by name.
{
  const rows = [
    { userId: 'u1', name: 'ada', gameId: 'nobu', lifetime: 5 },
    { userId: 'u2', name: 'ada', gameId: 'nobu', lifetime: 4 },
    { userId: 'u1', name: 'ada', gameId: 'sproto', lifetime: 2 },
    { name: 'old', gameId: 'nobu', lifetime: 1 },
    { name: 'old', gameId: 'pb', lifetime: 1 },
  ];
  assert.deepEqual(verseTotals(rows).map((r) => [r.playerId, r.name, r.score]), [['u1', 'ada', 7], ['u2', 'ada', 4], ['old', 'old', 2]], 'verse totals by userId');
  assert.deepEqual(verseTotals(rows, 'nobu').map((r) => [r.playerId, r.score]), [['u1', 5], ['u2', 4], ['old', 1]], 'verse totals for one game');
}

console.log('hub net tests ok');

// Per-realm storage and every fresh placement, including one after a match ends.
{
  assert.equal(sessionMatchKey('plaza'), 'hub:plaza:match', 'session_key_is_per_realm');
  assert.equal(sessionMatchKey('sandbox'), 'hub:plaza:match:sandbox');
  const values = new Map([['hub:plaza:match', 'plaza-old'], ['hub:plaza:match:sandbox', 'sandbox-old']]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  const server = createMockRealtimeServer();
  let ending = false;
  server.registerMatch('realm', { init: () => ({ state: {} }), loop: (_s, _m, d) => { if (ending) { ending = false; d.end(); } } });
  const asks: { realm?: string; prefer?: string }[] = [];
  server.registerRpc('hub.join', (_ctx, body) => {
    asks.push(body as { realm?: string; prefer?: string });
    return { matchId: server.createMatch('realm'), shard: 1, room: 'hub.sandbox.1' };
  });
  const rt = server.connect({ userId: 'realm-user' });
  const realm = await connectPlaza({ realm: 'sandbox', realtime: rt, getToken: () => '' });
  assert.deepEqual(asks[0], { prefer: 'sandbox-old', realm: 'sandbox' });
  assert.equal(values.get('hub:plaza:match'), 'plaza-old', 'sandbox does not replace the plaza preference');
  server.drop('realm-user');
  await server.flush(); await new Promise(resolve => setTimeout(resolve, 10)); await server.flush();
  assert.equal(realm.room, 'hub.sandbox.1', 'reconnect_keeps_realm');
  ending = true; server.tick(); await server.flush();
  for (let i=0; i<20 && asks.length<2; i++) { await new Promise(resolve => setTimeout(resolve, 1)); await server.flush(); }
  assert.ok(asks.length >= 2, 'ended match triggers fresh realm placement');
  assert.ok(asks.every(ask => ask.realm === 'sandbox'), 'every re-placement retains realm');
  realm.close();
  if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage');
}

// A fixed-window placement limit is a wait, followed by a retry after the window.
{
  const server = createMockRealtimeServer(); const matchId = server.createMatch();
  let attempts = 0; const statuses: string[] = []; const delays: number[] = [];
  server.registerRpc('hub.join', () => ++attempts === 1 ? { error: 'rate_limited' } : { matchId, shard: 1, room: 'hub.sandbox.1' });
  let release!: () => void; const windowElapsed = new Promise<void>(resolve => { release = resolve; });
  const connecting = connectPlaza({ realm: 'sandbox', realtime: server.connect({ userId: 'limited' }), getToken: () => '', onStatus: s => statuses.push(s), wait: ms => { delays.push(ms); return windowElapsed; } });
  await server.flush(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(delays, [60000]);
  assert.equal(attempts, 1, 'no retry before the limit window');
  assert.ok(statuses.includes('waiting'), 'rate_limited_shows_wait_message');
  assert.ok(!statuses.includes('offline'));
  release(); const realm = await connecting;
  assert.equal(attempts, 2); assert.equal(realm.room, 'hub.sandbox.1'); realm.close();
}

// Client/server zone decisions agree throughout each realm's valid bands.
{
  const mod = loadModule({ noInit: true });
  const table = mod.global.HubRealms as { get(id: string): unknown; zoneOf(realm: unknown, y: number): string };
  for (const realm of ['plaza', 'sandbox'] as const) {
    for (const y of [-300, -250, -50, -4, 1.775, 40]) assert.equal(zoneOf(y, realm), table.zoneOf(table.get(realm), y * 100));
  }
}

// Every client route is backed by an allow-listed server realm.
{
  const mod = loadModule({ noInit: true });
  const table = mod.global.HubRealms as { get(id: string): unknown };
  for (const id of REALM_IDS) assert.ok(table.get(id), `client realm ${id} exists on server`);
}
