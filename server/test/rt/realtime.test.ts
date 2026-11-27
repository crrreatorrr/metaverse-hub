// Live realtime checks against the compose stack (server/docker-compose.yml):
//   docker compose -f server/docker-compose.yml up --build -d && npm run test:rt
// Real sockets through the SDK client: plaza placement and pose propagation,
// chat guard (send/receive/history, rate limit, disallowed room), matchmaker
// scope, and NOBU scores from an unranked session through leaderboard.top.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRealtime, HubSdkError, type HubRealtime, type MatchData } from '../../../packages/hub-sdk/src/index.ts';
import { call, guest, login, psql, waitReady } from '../dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, fn: () => T | undefined | null | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function socket(token: string): HubRealtime {
  return createRealtime({ serverUrl: BASE, getToken: () => token, reconnect: false });
}

interface LiveCount { hard: number; soft: number; kinds: { duel: number; arena: number; coop: number; shooter: number; racer: number } }
/** maint.live, asked until it counts a match of `kind` or three seconds pass. Returns the last answer. */
async function liveCount(kind: keyof LiveCount['kinds']): Promise<LiveCount> {
  let live = (await call('maint.live', {})).body as unknown as LiveCount;
  for (let i = 0; i < 30 && !(live.kinds[kind] >= 1); i += 1) {
    await sleep(100);
    live = (await call('maint.live', {})).body as unknown as LiveCount;
  }
  return live;
}

let failures = 0;
const shooterFree = { pass: 0, fail: 0 };
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const free = name.startsWith('shooter-free:');
  try {
    await fn();
    console.log(`ok   ${name}`);
    if (free) shooterFree.pass += 1;
  } catch (error) {
    failures += 1;
    if (free) shooterFree.fail += 1;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}

await waitReady();

await test('three hub sockets share a shard and see each other move', async () => {
  const users = await Promise.all([guest(), guest(), guest()]);
  const rts = users.map((u) => socket(u.token));
  await Promise.all(rts.map((rt) => rt.connect()));
  const placed = await Promise.all(rts.map((rt) => rt.rpc<{ matchId: string; shard: number; room: string }>('hub.join', {})));
  assert.equal(new Set(placed.map((p) => p.matchId)).size, 1, 'least-full placement keeps a quiet server on one shard');
  assert.equal(placed[0]!.room, `hub.${placed[0]!.shard}`);
  const inbox: MatchData[][] = [[], [], []];
  const matches = [];
  for (let i = 0; i < 3; i += 1) {
    const m = await rts[i]!.joinMatch({ matchId: placed[i]!.matchId });
    m.onMessage((msg) => inbox[i]!.push(msg));
    matches.push(m);
  }
  await until('snapshot for the third joiner', () => inbox[2]!.find((m) => m.opCode === 2));
  const snap = inbox[2]!.find((m) => m.opCode === 2)!.json<{ roster: { u: string }[] }>();
  for (const u of users) assert.ok(snap.roster.some((e) => e.u === u.userId), 'roster has everyone');
  matches[0]!.send(1, [150, 178, 4200, 10, 1]);
  const delta = await until('delta with player 0', () =>
    inbox[1]!.filter((m) => m.opCode === 3).map((m) => m.json<{ p: number[][] }>()).find((d) => d.p.some((r) => r[1] === 150)),
  );
  assert.ok(delta);
  const status = await call('hub.join', {}, (await login('nobu')).gameToken);
  assert.equal(status.body.error, 'wrong_scope', 'game sessions cannot enter the plaza');
  for (const rt of rts) rt.disconnect();
});

await test('chat: send, receive, history, rate limit, disallowed room', async () => {
  const [a, b] = await Promise.all([guest(), guest()]);
  const ra = socket(a.token);
  const rb = socket(b.token);
  await Promise.all([ra.connect(), rb.connect()]);
  const room = `hub.${9000 + Math.floor(Math.random() * 900)}`;
  const ca = await ra.joinChat({ room });
  const cb = await rb.joinChat({ room });
  const got: string[] = [];
  cb.onMessage((m) => got.push(m.content.text));
  await ca.send({ text: '  hello   plaza  ', color: 'red' });
  await until('message at b', () => got.includes('hello plaza'));
  await assert.rejects(ca.send('hello plaza'), (e: unknown) => e instanceof HubSdkError && e.code === 'chat_duplicate');
  for (let i = 0; i < 4; i += 1) await ca.send(`line ${i}`);
  await assert.rejects(ca.send('too fast'), (e: unknown) => e instanceof HubSdkError && e.code === 'chat_rate_limited');
  const history = await cb.history({ limit: 10 });
  assert.equal(history.messages[0]!.content.text, 'line 3', 'newest first');
  assert.equal(history.messages.at(-1)!.content.text, 'hello plaza');
  assert.equal(history.messages.at(-1)!.content.color, 'red');
  await assert.rejects(ra.joinChat({ room: 'pb.trade' }), (e: unknown) => e instanceof HubSdkError && e.code === 'room_not_allowed');
  const report = await ra.rpc<{ ok: boolean }>('chat.report', { channelId: ca.id, messageId: history.messages[0]!.messageId, userId: b.userId, reason: 'test' });
  assert.equal(report.ok, true);
  ra.disconnect();
  rb.disconnect();
});

await test('matchmaker scope: hub sessions only for hub-scope games', async () => {
  const hub = await guest();
  const rt = socket(hub.token);
  await rt.connect();
  await assert.rejects(
    rt.addMatchmaker({ query: '+properties.game:sproto', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto' } }),
    (e: unknown) => e instanceof HubSdkError && e.code === 'wrong_scope',
  );
  const ok = await rt.addMatchmaker({ query: '+properties.game:sproto-fighter', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto-fighter', wager: '0', sim: 'rt-test' } });
  assert.ok(ok.ticket, 'Sproto Fighter still matchmakes on the hub session');
  await rt.removeMatchmaker(ok.ticket);
  rt.disconnect();
});

// A duel's label has a game and no kind, so the drain tells it by the game (games/maint.ts).
await test('maint.live counts a live duel as a hard match', async () => {
  const [a, b] = await Promise.all([guest(), guest()]);
  const ra = socket(a.token);
  const rb = socket(b.token);
  await Promise.all([ra.connect(), rb.connect()]);
  try {
    const matched: string[] = [];
    ra.onMatchmakerMatched((m) => matched.push(m.matchId ?? ''));
    const ticket = { query: '+properties.game:sproto-fighter', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto-fighter', wager: '0', sim: 'rt-test' } };
    await Promise.all([ra.addMatchmaker(ticket), rb.addMatchmaker(ticket)]);
    // Nakama's matchmaker runs on an interval (15 s by default).
    const matchId = await until('a duel from the matchmaker', () => matched[0], 45_000);
    const before = (await call('maint.live', {})).body as unknown as LiveCount;
    await ra.joinMatch({ matchId });
    await rb.joinMatch({ matchId });
    const live = await liveCount('duel');
    assert.ok(live.kinds.duel >= 1 && live.hard >= 1, JSON.stringify(live));
    assert.ok(live.soft <= before.soft, `the duel is not counted as soft: ${JSON.stringify(before)} then ${JSON.stringify(live)}`);
  } finally {
    ra.disconnect();
    rb.disconnect();
  }
});

psql(`UPDATE game.server_flags SET state = 'on', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
await sleep(6500);

await test('shooter-free: guests play one seat and delayed inputs move no tickets', async () => {
  const ada = await login('sproto-shooter');
  const bea = await login('sproto-shooter');
  const hub = await guest();
  const hubRt = socket(hub.token);
  await hubRt.connect();
  await assert.rejects(
    hubRt.addMatchmaker({ query: '+properties.game:sproto-shooter +properties.mode:free +properties.protocol:2 +properties.content:e749d2fd', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto-shooter', mode: 'free', protocol: '2', sim: '2', content: 'e749d2fd' } }),
    (error: unknown) => error instanceof HubSdkError && error.code === 'wrong_scope',
  );
  hubRt.disconnect();
  const created = await call('shooter.room_create', {}, ada.gameToken);
  assert.equal(created.body.stake, 0);
  assert.equal(created.body.ticketsMinted, 0);
  const matchId = String(created.body.matchId);
  const joined = await call('shooter.room_join', { code: created.body.code }, bea.gameToken);
  assert.equal(joined.body.matchId, matchId);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  const hello = (userId: string) => ({ accountId: userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  ma.send(1, hello(ada.hub.userId));
  mb.send(1, hello(bea.hub.userId));
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(4, { accountId: ada.hub.userId });
  mb.send(4, { accountId: bea.hub.userId });
  const phase = await until('live', () => mail.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
  assert.equal(phase.json<{ ticketsMinted: number; stakes: boolean }>().ticketsMinted, 0);
  assert.equal(phase.json<{ stakes: boolean }>().stakes, false);
  for (const delay of [100, 200]) {
    await sleep(delay + (delay === 100 ? 15 : 35));
    const snap = mail.filter((msg) => msg.opCode === 7).at(-1);
    assert.ok(snap, 'snapshot during delayed input');
    assert.equal(snap.json<{ ticketsMinted: number }>().ticketsMinted, 0);
  }
  const balance = await call('tickets.balance', { game: 'sproto-shooter' }, ada.gameToken);
  assert.equal(balance.body.balance, 0);
  // A deploy drain waits for this match. Nakama lists a match by its label, about a second after it is made.
  const live = await liveCount('shooter');
  assert.ok(live.kinds.shooter >= 1 && live.hard >= 1, JSON.stringify(live));
  ra.disconnect();
  rb.disconnect();
});

/** Protocol 2 INPUT: 18 bytes, seq u32 + frame i32, then a neutral wish with no rewind claim. */
function freeInput(seq: number, frame: number): Uint8Array {
  const bytes = new Uint8Array(18);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, seq, true);
  view.setInt32(4, frame, true);
  return bytes;
}

await test('shooter-free: forged result and claim-winner are rejected', async () => {
  const ada = await login('sproto-shooter');
  const bea = await login('sproto-shooter');
  const created = await call('shooter.room_create', {}, ada.gameToken);
  const matchId = String(created.body.matchId);
  await call('shooter.room_join', { code: created.body.code, v: 2, sim: 2, content: 'e749d2fd' }, bea.gameToken);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  ma.send(1, { accountId: ada.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(4, { accountId: ada.hub.userId });
  mb.send(4, { accountId: bea.hub.userId });
  await until('live', () => mail.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
  ma.send(8, { winner: 0, outcome: 'ko', claimWinner: true });
  ma.send(4, { accountId: ada.hub.userId, winner: 0, earnTickets: 20 });
  const rejected = await until('client_result', () => mail.find((msg) => msg.opCode === 3 && msg.json<{ reason?: string }>().reason === 'client_result'));
  assert.equal(rejected.json<{ ticketsMinted: number }>().ticketsMinted, 0);
  await sleep(200);
  assert.equal(mail.some((msg) => msg.opCode === 8), false);
  const balance = await call('tickets.balance', { game: 'sproto-shooter' }, ada.gameToken);
  assert.equal(balance.body.balance, 0);
  ra.disconnect();
  rb.disconnect();
});

await test('shooter-free: injected and wrong-seat input are rejected', async () => {
  const ada = await login('sproto-shooter');
  const bea = await login('sproto-shooter');
  const created = await call('shooter.room_create', {}, ada.gameToken);
  const matchId = String(created.body.matchId);
  await call('shooter.room_join', { code: created.body.code }, bea.gameToken);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  ma.send(1, { accountId: ada.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(7, { winner: 1, hp: 0 });
  ma.send(1, { accountId: bea.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  const reasons = await until('wrong sender', () => {
    const found = mail.filter((msg) => msg.opCode === 3).map((msg) => msg.json<{ reason?: string }>().reason);
    return found.includes('wrong_sender') ? found : undefined;
  });
  assert.ok(reasons.includes('malformed') || reasons.includes('client_result'), JSON.stringify(reasons));
  assert.ok(reasons.includes('wrong_sender'), JSON.stringify(reasons));
  assert.equal(mail.some((msg) => msg.opCode === 8), false);
  ra.disconnect();
  rb.disconnect();
});

await test('shooter-free: oversized and out-of-order frames are rejected', async () => {
  const ada = await login('sproto-shooter');
  const bea = await login('sproto-shooter');
  const created = await call('shooter.room_create', {}, ada.gameToken);
  const matchId = String(created.body.matchId);
  await call('shooter.room_join', { code: created.body.code }, bea.gameToken);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  ma.send(1, { accountId: ada.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 2, sim: 2, content: 'e749d2fd' });
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(4, { accountId: ada.hub.userId });
  mb.send(4, { accountId: bea.hub.userId });
  const snap = await until('snapshot', () => mail.find((msg) => msg.opCode === 7));
  const tick = snap.json<{ tick: number }>().tick;
  ma.send(6, new Uint8Array(80));
  // Protocol 2 allows sequence gaps; a sequence number that goes backwards is rejected.
  ma.send(6, freeInput(9, tick + 1));
  ma.send(6, freeInput(5, tick + 2));
  ma.send(6, new Uint8Array([1, 2, 3]));
  const reasons = await until('malformed and sequence', () => {
    const found = mail.filter((msg) => msg.opCode === 3).map((msg) => msg.json<{ reason?: string }>().reason);
    return found.includes('malformed') && found.includes('sequence') ? found : undefined;
  });
  assert.ok(reasons.includes('malformed') && reasons.includes('sequence'), JSON.stringify(reasons));
  ra.disconnect();
  rb.disconnect();
});

await test('shooter-free: protocol, sim, and content mismatch are rejected', async () => {
  const ada = await login('sproto-shooter');
  const rt = socket(ada.gameToken);
  await rt.connect();
  await assert.rejects(
    rt.addMatchmaker({
      query: '+properties.game:sproto-shooter +properties.mode:free +properties.protocol:2 +properties.content:e749d2fd',
      minCount: 2,
      maxCount: 2,
      stringProperties: { game: 'sproto-shooter', mode: 'free', protocol: '9', sim: '2', content: 'e749d2fd' },
    }),
    (error: unknown) => error instanceof HubSdkError && error.code === 'version_mismatch',
  );
  const bad = await call('shooter.room_create', { content: 'deadbeef' }, ada.gameToken);
  assert.equal(bad.body.error, 'version_mismatch');
  const created = await call('shooter.room_create', {}, ada.gameToken);
  const matchId = String(created.body.matchId);
  const joined = await rt.joinMatch({ matchId });
  const mail: MatchData[] = [];
  joined.onMessage((msg) => mail.push(msg));
  joined.send(1, { accountId: ada.hub.userId, protocol: 2, sim: 9, content: 'e749d2fd' });
  const rejected = await until('version', () => mail.find((msg) => msg.opCode === 3));
  assert.equal(rejected.json<{ reason?: string; ticketsMinted?: number }>().reason, 'version');
  assert.equal(rejected.json<{ ticketsMinted?: number }>().ticketsMinted, 0);
  rt.disconnect();
});

psql(`UPDATE game.server_flags SET state = 'off', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);

await test('NOBU score from an unranked session shows in leaderboard.top (ms); god mode posts nothing', async () => {
  const session = await login('nobu');
  const value = 15000 + Math.floor(Math.random() * 1000);
  const posted = await call('score.submit', { boardId: 'nobu_trial_time', value, meta: { level: 1 } }, session.gameToken);
  assert.deepEqual(posted.body, { accepted: true, posted: true, value, order: 'asc' });
  const top = await call('leaderboard.top', { boardId: 'nobu_trial_time', variant: '1' }, session.hub.token);
  assert.equal((top.body.me as { value?: number }).value, value);
  const god = await call('score.submit', { boardId: 'nobu_trial_time', value: 15000, meta: { level: 2, godMode: true } }, session.gameToken);
  assert.deepEqual(god.body, { accepted: false, reason: 'god_mode' });
  const level2 = await call('leaderboard.top', { boardId: 'nobu_trial_time', variant: '2' }, session.hub.token);
  assert.equal(level2.body.me, null);
});

// Sproto Racer online races (games/racer_match.ts): the vendored match host on the real runtime.
// The racer_online flag has no seeded row, and with no row nothing opens.
const RACER_PIN = JSON.parse(readFileSync(new URL('../../modules/vendor/racer-sim.pin.json', import.meta.url), 'utf8')) as { netVersion: string; simVersion: string };
const racerSim = (() => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../../modules/vendor/racer-sim.js', import.meta.url), 'utf8'), context);
  return vm.runInContext('RacerSim', context) as {
    contentManifest(): { cars: { id: string }[]; drivers: string[] };
    api(): { controlsToIntentFrame(tick: number, controls: object): object; encodeIntentFrame(frame: object): Uint8Array };
  };
})();
const RACER_OP = { HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 5, LOBBY: 9, PING: 10, PONG: 11, INPUTS: 14, KEYFRAME: 17, SEAT: 18, ERROR: 19 };
const racerVersions = { version: RACER_PIN.netVersion, simVersion: RACER_PIN.simVersion };
const racerTicket = {
  query: `+properties.game:sproto-racer +properties.version:${RACER_PIN.netVersion} +properties.simVersion:${RACER_PIN.simVersion} +properties.mode:race`,
  minCount: 2,
  maxCount: 6,
  stringProperties: { game: 'sproto-racer', mode: 'race', ...racerVersions },
};
const racerHello = (extra: Record<string, unknown> = {}) => {
  const content = racerSim.contentManifest();
  return { v: RACER_PIN.netVersion, sim: RACER_PIN.simVersion, car: content.cars[0]!.id, driver: content.drivers[0]!, ...extra };
};
/** INPUT: seat, one frame, then the 12-byte frame for `tick` with the throttle held. */
function racerInput(seat: number, tick: number): Uint8Array {
  const api = racerSim.api();
  const bytes = new Uint8Array(14);
  bytes[0] = seat;
  bytes[1] = 1;
  bytes.set(api.encodeIntentFrame(api.controlsToIntentFrame(tick, { throttle: 1, steer: 0 })), 2);
  return bytes;
}

// A stack that already ran this suite still has the row; start from none again.
if (psql(`DELETE FROM game.server_flags WHERE key = 'racer_online' RETURNING key`).includes('racer_online')) await sleep(6500);

await test('racer: with the flag off no room opens', async () => {
  const ada = await login('sproto-racer');
  const version = await call('racer.version', {}, ada.gameToken);
  assert.equal(version.body.simVersion, RACER_PIN.simVersion, 'the runtime loaded the pinned bundle');
  assert.equal(version.body.enabled, false);
  assert.equal((await call('racer.room_create', racerVersions, ada.gameToken)).body.error, 'online_off');
  const rt = socket(ada.gameToken);
  await rt.connect();
  await assert.rejects(rt.addMatchmaker(racerTicket), (e: unknown) => e instanceof HubSdkError);
  rt.disconnect();
  assert.equal((await call('racer.version', {}, (await guest()).token)).body.error, 'wrong_scope', 'a plaza session is not a game session');
});

psql(`INSERT INTO game.server_flags (key, state) VALUES ('racer_online', 'on') ON CONFLICT (key) DO UPDATE SET state = 'on', allowlist = '{}', percent = 0, updated_at = now()`);
await sleep(6500);

await test('racer: a private room races, a dropped player comes back', async () => {
  const ada = await login('sproto-racer');
  const bea = await login('sproto-racer');
  const cy = await login('sproto-racer');
  assert.equal((await call('racer.version', {}, ada.gameToken)).body.enabled, true);
  const created = await call('racer.room_create', { game: 'sproto-racer', ...racerVersions, courseId: 'track02', mode: 'race', maxSeats: 2 }, ada.gameToken);
  assert.equal(created.body.error, undefined, JSON.stringify(created.body));
  const matchId = String(created.body.matchId);
  const joined = await call('racer.room_join', { game: 'sproto-racer', code: created.body.code, ...racerVersions }, bea.gameToken);
  assert.equal(joined.body.matchId, matchId);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  const rc = socket(cy.gameToken);
  await Promise.all([ra.connect(), rb.connect(), rc.connect()]);
  await assert.rejects(rc.joinMatch({ matchId }), 'finding the match id is not an invitation');
  rc.disconnect();
  const mailA: MatchData[] = [];
  const mailB: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mailA.push(msg));
  mb.onMessage((msg) => mailB.push(msg));
  ma.send(RACER_OP.HELLO, racerHello({ name: 'admin <script>' }));
  mb.send(RACER_OP.HELLO, racerHello());
  const welcome = (await until('welcome', () => mailA.find((msg) => msg.opCode === RACER_OP.WELCOME))).json<{ sim: string; phase: string; room: { courseId: string } }>();
  assert.equal(welcome.sim, RACER_PIN.simVersion);
  assert.equal(welcome.phase, 'lobby');
  assert.equal(welcome.room.courseId, 'track02');
  const lobby = (await until('both in the lobby', () => mailA.filter((msg) => msg.opCode === RACER_OP.LOBBY).map((msg) => msg.json<{ players: { name: string }[] }>()).find((l) => l.players.length === 2)));
  assert.ok(lobby.players.every((p) => /^[A-Za-z0-9 _.-]{1,24}$/.test(p.name)), `hub names, cleaned: ${JSON.stringify(lobby.players.map((p) => p.name))}`);
  assert.ok(!lobby.players.some((p) => p.name.includes('admin')), 'the name in HELLO is not used');

  ma.send(RACER_OP.READY, { ready: true });
  mb.send(RACER_OP.READY, { ready: true });
  const startMsg = await until('start', () => mailA.find((msg) => msg.opCode === RACER_OP.START));
  const startedAt = Date.now();
  const start = startMsg.json<{ serverTick: number; you: number; race: { startTick: number; courseId: string; seats: { kind: string }[] } }>();
  assert.equal(start.race.courseId, 'track02');
  assert.deepEqual(start.race.seats.map((s) => s.kind), ['remote', 'remote', 'ai', 'ai', 'ai', 'ai']);
  // Each player holds the throttle, every input stamped a tenth of a second ahead of the server's tick.
  const raceTick = () => Math.floor(start.serverTick + ((Date.now() - startedAt) * 60) / 1000) - start.race.startTick;
  const seatB = (await until('start for the second player', () => mailB.find((msg) => msg.opCode === RACER_OP.START))).json<{ you: number }>().you;
  let driving = true;
  const pump = setInterval(() => {
    const tick = raceTick() + 6;
    if (!driving || tick < 0) return;
    ma.send(RACER_OP.INPUT, racerInput(start.you, tick));
    mb.send(RACER_OP.INPUT, racerInput(seatB, tick));
  }, 16);
  try {
    await until('one hundred relayed input batches', () => mailA.filter((msg) => msg.opCode === RACER_OP.INPUTS).length >= 100, 12_000);
    assert.ok(mailA.filter((msg) => msg.opCode === RACER_OP.INPUTS).every((msg) => msg.data.length >= 7), 'binary batches');
    assert.equal(mailA.filter((msg) => msg.opCode === RACER_OP.ERROR).length, 0);
    ma.send(RACER_OP.PING, new Uint8Array([7, 0, 0, 0]));
    const pong = await until('pong', () => mailA.find((msg) => msg.opCode === RACER_OP.PONG));
    assert.deepEqual([...pong.data.slice(0, 4)], [7, 0, 0, 0]);

    // The second player's socket drops: the AI takes the kart. A new socket gets the whole race state back.
    driving = false;
    rb.disconnect();
    const handed = await until('seat handed to the AI', () => mailA.find((msg) => msg.opCode === RACER_OP.SEAT));
    assert.deepEqual([...handed.data.slice(0, 2)], [seatB, 0]);
    const rb2 = socket(bea.gameToken);
    await rb2.connect();
    const back: MatchData[] = [];
    const mb2 = await rb2.joinMatch({ matchId });
    mb2.onMessage((msg) => back.push(msg));
    mb2.send(RACER_OP.HELLO, racerHello());
    const again = (await until('welcome back', () => back.find((msg) => msg.opCode === RACER_OP.WELCOME))).json<{ phase: string; you: number }>();
    assert.equal(again.phase, 'race');
    assert.equal(again.you, seatB);
    const chunk = await until('the full state', () => back.find((msg) => msg.opCode === RACER_OP.KEYFRAME));
    assert.ok(chunk.data.length > 4 && chunk.data.length <= 4096, `keyframe chunk of ${chunk.data.length} bytes`);

    const metrics = await call('racer.metrics', { matchId });
    const loop = metrics.body.loopMs as { count: number; mean: number; max: number; overBudget: number; recentP99: number };
    const host = metrics.body.host as Record<string, number>;
    console.log(`     racer loop: ${loop.count} loops, mean ${loop.mean} ms, recent p99 ${loop.recentP99} ms, max ${loop.max} ms, over budget ${loop.overBudget}`);
    assert.equal(metrics.body.phase, 'race');
    assert.ok(host.inputFrames! > 200, `input frames taken: ${host.inputFrames}`);
    assert.equal(host.rejectedMalformed, 0);
    assert.equal(host.rejectedSeat, 0);
    assert.equal(host.rejectedThrown, 0);
    assert.ok(loop.mean < 8, `mean loop ${loop.mean} ms`);
    assert.equal((await call('racer.metrics', { matchId }, ada.gameToken)).body.error, 'unauthorized');
    // A deploy drain waits for this race.
    const live = await liveCount('racer');
    assert.ok(live.kinds.racer >= 1 && live.hard >= 1, JSON.stringify(live));
    const count = await call('racer.online_count', { game: 'sproto-racer' }, ada.gameToken);
    assert.ok(Number(count.body.count) >= 2, JSON.stringify(count.body));
    rb2.disconnect();
  } finally {
    clearInterval(pump);
    ra.disconnect();
  }
});

await test('racer: a quick-race pair is given a public room', async () => {
  const ada = await login('sproto-racer');
  const bea = await login('sproto-racer');
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  await assert.rejects(ra.addMatchmaker({ ...racerTicket, stringProperties: { ...racerTicket.stringProperties, simVersion: 'feedfacefeedface' } }), (e: unknown) => e instanceof HubSdkError);
  const matched: string[] = [];
  ra.onMatchmakerMatched((m) => matched.push(m.matchId ?? ''));
  await Promise.all([ra.addMatchmaker(racerTicket), rb.addMatchmaker(racerTicket)]);
  // Nakama's matchmaker runs on an interval (15 s by default).
  const matchId = await until('a room from the matchmaker', () => matched[0], 45_000);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  ma.send(RACER_OP.HELLO, racerHello());
  const welcome = (await until('welcome', () => mail.find((msg) => msg.opCode === RACER_OP.WELCOME))).json<{ phase: string; room: { maxHumans: number } }>();
  assert.equal(welcome.phase, 'lobby');
  assert.equal(welcome.room.maxHumans, 6);
  // The game's own search finds the room while it has places. A label is searchable about a second after it changes.
  const query = `+label.kind:sproto_racer +label.open:T +label.version:${RACER_PIN.netVersion} +label.simVersion:${RACER_PIN.simVersion} +label.mode:race +label.players:<6`;
  let listed: { label: string } | undefined;
  for (let i = 0; i < 50 && !listed; i += 1) {
    listed = (await rb.listMatches({ query })).find((m) => m.matchId === matchId && JSON.parse(m.label).players === 1);
    if (!listed) await sleep(100);
  }
  assert.ok(listed, 'the room is in the search with its one player counted');
  const found = await rb.joinMatchByQuery({ query, maxSize: 6, pick: 'fullest' });
  assert.equal(found?.matchId, matchId);
  assert.deepEqual(await rb.listMatches({ query: `${query} +label.players:<1` }), [], 'the player count in the label is a number the search can compare');
  ra.disconnect();
  rb.disconnect();
});

// Leave the flags table as it was found: the duplication suite checks the seeded rows exactly.
psql(`DELETE FROM game.server_flags WHERE key = 'racer_online'`);

console.log('\nRealtime suite');
console.log(`shooter-free: ${shooterFree.pass} pass, ${shooterFree.fail} fail`);
if (shooterFree.fail > 0 || shooterFree.pass === 0) {
  console.error('shooter-free category missing or failed');
  process.exit(1);
}
if (failures) {
  console.error(`${failures} realtime test(s) failed`);
  process.exit(1);
}
console.log('realtime docker tests ok');
