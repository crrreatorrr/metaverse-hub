// Live realtime checks against the compose stack (server/docker-compose.yml):
//   docker compose -f server/docker-compose.yml up --build -d && npm run test:rt
// Real sockets through the SDK client: plaza placement and pose propagation,
// chat guard (send/receive/history, rate limit, disallowed room), matchmaker
// scope, and NOBU scores from an unranked session through leaderboard.top.
import assert from 'node:assert/strict';
import { createRealtime, HubSdkError, type HubRealtime, type MatchData } from '../../../packages/hub-sdk/src/index.ts';
import { call, guest, login, waitReady } from '../dup/harness.ts';

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

let failures = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
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

if (failures) {
  console.error(`${failures} realtime test(s) failed`);
  process.exit(1);
}
console.log('realtime docker tests ok');
