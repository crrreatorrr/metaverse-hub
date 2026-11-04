// Hub client net layer: protocol quantisation, opcodes vs the server module,
// interpolation, RemoteWorld, and connectPlaza against the SDK mock server.
import assert from 'node:assert/strict';
import { createMockRealtimeServer, type RealtimePresence } from '@metaverse/hub-sdk';
import { loadModule } from '../../../server/test/unit/harness';
import { createInterp } from '../src/net/interp';
import { connectPlaza } from '../src/net/plaza';
import { ANIMS, OP, TICK_RATE, byteToYaw, decodeRow, encodePose, parseDelta, parseRoster, parseSnapshot, yawToByte, zoneOf, type PoseRow } from '../src/net/protocol';
import { createRemoteWorld } from '../src/net/remoteWorld';
import { createLiveLeaderboardProvider } from '../src/leaderboards';
import { formatBoardScore, formatTrialMs, serverBoard } from '../src/m3/types';
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
  it.push(1000, { x: 0, y: 0, z: 0, yaw: 6.2, anim: 1 });
  it.push(1100, { x: 1, y: 0, z: 0, yaw: 0.1, anim: 1 });
  it.sample(1200, out);
  assert.ok(Math.abs(out.x - 0.5) < 1e-9);
  assert.ok(out.yaw > 6.2 || out.yaw < 0.1, `short arc, got ${out.yaw}`);
  it.push(1200, { x: 40, y: 0, z: 0, yaw: 0, anim: 0 });
  it.sample(1250, out);
  assert.equal(out.x, 40, 'teleports snap');
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
  w.applyRoster({ add: [{ s: 2, u: 'c', n: 'cy', c: '', st: '', pt: '', r: [], g: '', away: false }] });
  w.applyRoster({ upd: [{ s: 1, u: 'b', n: 'bob', c: 'wizard', st: '', pt: '', r: [], g: 'nobu', away: true }] });
  assert.equal(w.byUser('b')?.game, 'nobu');
  assert.equal(w.presentCount(), 1);
  w.applyRoster({ del: [2] });
  assert.equal(w.byUser('c'), null);
  w.applyDelta({ t: 2, p: [[1, 200, 178, 0, 0, 1]] }, 100);
  assert.equal(w.byUser('b')?.interp.latest()?.x, 2);
  assert.equal(notified, 4);
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
  const plaza = await connectPlaza({ getToken: () => 'unused', realtime: server.connect({ userId: 'a', username: 'alice' }), now: () => t, onStatus: (s) => statuses.push(s) });
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
  void asked;
}

// Bar screen: NOBU pages per level in ms, verse pages from verse.board.
{
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
  const total = await provider.load('verse_total');
  assert.deepEqual(total.rows.map((r) => [r.name, r.score, r.rank]), [['a', 12, 1], ['b', 9, 2]]);
  const byNobu = await provider.load('verse_by_game_nobu');
  assert.deepEqual(byNobu.rows.map((r) => r.name), ['b', 'a']);
  assert.equal(calls.filter((c) => c.id === 'verse.board').length, 1, 'verse rows cached');
}

console.log('hub net tests ok');
