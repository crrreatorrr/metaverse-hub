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

await test('shooter-free: guests play one seat and delayed inputs move no tickets', async () => {
  const ada = await login('sproto-shooter');
  const bea = await login('sproto-shooter');
  const hub = await guest();
  const hubRt = socket(hub.token);
  await hubRt.connect();
  await assert.rejects(
    hubRt.addMatchmaker({ query: '+properties.game:sproto-shooter +properties.mode:free +properties.protocol:1', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto-shooter', mode: 'free', protocol: '1', sim: '1', content: 'f5949631' } }),
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
  const hello = (userId: string) => ({ accountId: userId, protocol: 1, sim: 1, content: 'f5949631' });
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
  ra.disconnect();
  rb.disconnect();
});

function freeInput(seq: number, frame: number): Uint8Array {
  const bytes = new Uint8Array(16);
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
  await call('shooter.room_join', { code: created.body.code, v: 1, sim: 1, content: 'f5949631' }, bea.gameToken);
  const ra = socket(ada.gameToken);
  const rb = socket(bea.gameToken);
  await Promise.all([ra.connect(), rb.connect()]);
  const mail: MatchData[] = [];
  const ma = await ra.joinMatch({ matchId });
  const mb = await rb.joinMatch({ matchId });
  ma.onMessage((msg) => mail.push(msg));
  ma.send(1, { accountId: ada.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
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
  ma.send(1, { accountId: ada.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(7, { winner: 1, hp: 0 });
  ma.send(1, { accountId: bea.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
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
  ma.send(1, { accountId: ada.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
  mb.send(1, { accountId: bea.hub.userId, protocol: 1, sim: 1, content: 'f5949631' });
  await until('welcome', () => mail.find((msg) => msg.opCode === 2));
  ma.send(4, { accountId: ada.hub.userId });
  mb.send(4, { accountId: bea.hub.userId });
  const snap = await until('snapshot', () => mail.find((msg) => msg.opCode === 7));
  const tick = snap.json<{ tick: number }>().tick;
  ma.send(6, new Uint8Array(80));
  ma.send(6, freeInput(9, tick));
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
      query: '+properties.game:sproto-shooter +properties.mode:free +properties.protocol:1',
      minCount: 2,
      maxCount: 2,
      stringProperties: { game: 'sproto-shooter', mode: 'free', protocol: '9', sim: '1', content: 'f5949631' },
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
  joined.send(1, { accountId: ada.hub.userId, protocol: 1, sim: 9, content: 'f5949631' });
  const rejected = await until('version', () => mail.find((msg) => msg.opCode === 3));
  assert.equal(rejected.json<{ reason?: string; ticketsMinted?: number }>().reason, 'version');
  assert.equal(rejected.json<{ ticketsMinted?: number }>().ticketsMinted, 0);
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
