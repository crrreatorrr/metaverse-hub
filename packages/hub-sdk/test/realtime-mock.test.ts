import assert from 'node:assert/strict';
import {
  CHAT_RULE_FIXTURES,
  HubSdkError,
  chatRuleOutcome,
  createMockRealtimeServer,
  mockLabelMatches,
  validateChatContent,
  type MatchData,
  type MatchmakerMatched,
  type MockMatchDispatcher,
  type RealtimePresence,
} from '../src/index';

async function relay(): Promise<void> {
  const server = createMockRealtimeServer();
  const a = server.connect({ userId: 'a', username: 'alice' });
  const b = server.connect({ userId: 'b', username: 'bob' });
  await Promise.all([a.connect(), b.connect()]);
  const id = server.createMatch();
  const ma = await a.joinMatch({ matchId: id });
  const mb = await b.joinMatch({ matchId: id });
  await server.flush();
  assert.deepEqual(ma.presences.map((p) => p.userId), ['b']);
  assert.deepEqual(mb.presences.map((p) => p.userId), ['a']);
  const got: MatchData[] = [];
  mb.onMessage((m) => got.push(m));
  ma.send(5, { hi: 1 });
  await server.flush();
  assert.equal(got.length, 1);
  assert.equal(got[0]!.sender?.userId, 'a');
  assert.deepEqual(got[0]!.json(), { hi: 1 });
  await ma.leave();
  await server.flush();
  assert.equal(mb.presences.length, 0);
}

interface Room { players: RealtimePresence[]; seen: number; ticks: number }

async function authoritative(): Promise<void> {
  const server = createMockRealtimeServer();
  server.registerMatch<Room>('room', {
    init: (params) => ({ state: { players: [], seen: 0, ticks: 0 }, label: JSON.stringify({ kind: 'room', open: true, max: Number(params.max ?? 2) }) }),
    joinAttempt: (state, presence) => (state.players.length >= 2 && !state.players.some((p) => p.userId === presence.userId) ? { accept: false, reason: 'full' } : { accept: true }),
    join: (state, presences, d) => {
      state.players.push(...presences);
      d.broadcast(2, { welcome: presences[0]!.userId }, presences);
    },
    leave: (state, presences) => {
      state.players = state.players.filter((p) => !presences.some((q) => q.sessionId === p.sessionId));
    },
    loop: (state, messages, d: MockMatchDispatcher, tick) => {
      state.ticks = tick;
      for (const m of messages) {
        state.seen += 1;
        d.broadcast(3, { echo: new TextDecoder().decode(m.data), from: m.sender.userId });
      }
      if (state.seen >= 2) d.setLabel(JSON.stringify({ kind: 'room', open: false }));
    },
  });
  const id = server.createMatch('room', { max: '2' });
  const clients = ['a', 'b', 'c'].map((u) => server.connect({ userId: u }));
  await Promise.all(clients.map((c) => c.connect()));
  const welcome: unknown[] = [];
  const ha = await clients[0]!.joinMatch({ matchId: id });
  ha.onMessage((m) => welcome.push(m.json()));
  const hb = await clients[1]!.joinMatch({ matchId: id });
  await server.flush();
  await assert.rejects(clients[2]!.joinMatch({ matchId: id }), (e: unknown) => e instanceof HubSdkError && e.code === 'match_rejected:full');
  const echoes: unknown[] = [];
  const hbWelcome: unknown[] = [];
  // Messages that arrived before the first subscriber are delivered to it (the welcome).
  hb.onMessage((m) => (m.opCode === 3 ? echoes : hbWelcome).push(m.json()));
  assert.deepEqual(hbWelcome, [{ welcome: 'b' }]);
  ha.send(1, 'one');
  hb.send(1, 'two');
  await server.flush();
  assert.equal(echoes.length, 0, 'authoritative messages wait for the loop');
  server.tick();
  await server.flush();
  assert.deepEqual(echoes, [{ echo: 'one', from: 'a' }, { echo: 'two', from: 'b' }]);
  assert.equal(server.matchesByLabel((l) => !!l && mockLabelMatches(l, '+label.open:F')).length, 1);
  const listed = await clients[2]!.listMatches({ query: '+label.kind:room +label.open:F' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.size, 2);
  assert.equal((await clients[2]!.listMatches({ query: '+label.open:T' })).length, 0);
  assert.equal(await clients[2]!.joinMatchByQuery({ query: '+label.kind:room', maxSize: 2 }), null);
  void welcome;
}

async function matchmaking(): Promise<void> {
  const server = createMockRealtimeServer();
  server.registerMatch('duel', { init: () => ({ state: {} }) });
  server.onMatchmakerMatched((entries) => (entries[0]!.request.stringProperties?.game === 'sproto' ? server.createMatch('duel') : null));
  const a = server.connect({ userId: 'a' });
  const b = server.connect({ userId: 'b' });
  await Promise.all([a.connect(), b.connect()]);
  const matched: MatchmakerMatched[] = [];
  a.onMatchmakerMatched((m) => matched.push(m));
  b.onMatchmakerMatched((m) => matched.push(m));
  const req = { query: '+properties.game:sproto', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto' } };
  const ta = await a.addMatchmaker(req);
  await server.flush();
  assert.equal(matched.length, 0);
  await b.addMatchmaker(req);
  await server.flush();
  assert.equal(matched.length, 2);
  assert.equal(matched[0]!.ticket, ta.ticket);
  assert.ok(matched[0]!.matchId);
  assert.equal(matched[0]!.users.length, 2);
  const h = await a.joinMatch({ matchId: matched[0]!.matchId! });
  assert.ok(h.matchId);

  // Default grouping: a relay match by token.
  const c = server.connect({ userId: 'c' });
  const d = server.connect({ userId: 'd' });
  await Promise.all([c.connect(), d.connect()]);
  const relayed: MatchmakerMatched[] = [];
  c.onMatchmakerMatched((m) => relayed.push(m));
  await c.addMatchmaker({ query: '*', minCount: 2, maxCount: 2, stringProperties: { game: 'pb' } });
  await d.addMatchmaker({ query: '*', minCount: 2, maxCount: 2, stringProperties: { game: 'pb' } });
  await server.flush();
  assert.equal(relayed[0]!.matchId, null);
  const viaToken = await c.joinMatch({ token: relayed[0]!.token! });
  assert.ok(viaToken.matchId);
}

async function chatAndRpc(): Promise<void> {
  let now = 1_000_000;
  const server = createMockRealtimeServer({ now: () => now });
  server.allowRooms(/^hub\.\d{1,4}$/);
  server.registerRpc('hub.join', (ctx) => ({ matchId: server.createMatch(), who: ctx.userId }));
  server.registerRpc('hub.boom', () => {
    throw new Error('wrong_scope');
  });
  const a = server.connect({ userId: 'a', username: 'alice' });
  const b = server.connect({ userId: 'b', username: 'bob' });
  await Promise.all([a.connect(), b.connect()]);
  await assert.rejects(a.joinChat({ room: 'pb.trade' }), (e: unknown) => e instanceof HubSdkError && e.code === 'room_not_allowed');
  const ca = await a.joinChat({ room: 'hub.1' });
  const cb = await b.joinChat({ room: 'hub.1' });
  assert.equal(ca.id, cb.id);
  const lines: string[] = [];
  cb.onMessage((m) => lines.push(`${m.username}:${m.content.text}`));
  await ca.send({ text: '  hello   world ', color: 'red', extra: 'dropped' });
  await server.flush();
  assert.deepEqual(lines, ['alice:hello world']);
  await assert.rejects(ca.send('hello world'), (e: unknown) => e instanceof HubSdkError && e.code === 'chat_duplicate');
  for (let i = 0; i < 4; i += 1) await ca.send(`line ${i}`);
  await assert.rejects(ca.send('one more'), (e: unknown) => e instanceof HubSdkError && e.code === 'chat_rate_limited');
  now += 1500;
  await ca.send('after refill');
  await assert.rejects(ca.send({ text: '   ' }), (e: unknown) => e instanceof HubSdkError && e.code === 'chat_empty');
  const page = await cb.history({ limit: 3 });
  assert.deepEqual(page.messages.map((m) => m.content.text), ['after refill', 'line 3', 'line 2']);
  assert.ok(page.cursor);
  const rest = await cb.history({ limit: 10, cursor: page.cursor });
  assert.equal(rest.messages.length, 3);
  assert.equal(rest.cursor, null);

  const placed = await a.joinViaRpc('hub.join', {});
  assert.ok(placed.matchId);
  await assert.rejects(a.rpc('hub.boom'), (e: unknown) => e instanceof HubSdkError && e.code === 'wrong_scope');
}

async function dropAndRejoin(): Promise<void> {
  const server = createMockRealtimeServer();
  const joins: string[] = [];
  server.registerMatch<{ n: number }>('hub', {
    init: () => ({ state: { n: 0 } }),
    join: (state, presences) => {
      state.n += 1;
      joins.push(presences[0]!.sessionId);
    },
  });
  const id = server.createMatch('hub');
  const a = server.connect({ userId: 'a' });
  await a.connect();
  const h = await a.joinMatch({ matchId: id }, { shard: '1' });
  const chat = await a.joinChat({ room: 'hub.1' });
  const states: string[] = [];
  a.onState((s) => states.push(s));
  let rejoined = 0;
  h.onRejoin(() => {
    rejoined += 1;
  });
  const firstSession = h.self.sessionId;
  server.drop('a');
  await server.flush();
  assert.deepEqual(states, ['reconnecting', 'open']);
  assert.equal(rejoined, 1);
  assert.notEqual(h.self.sessionId, firstSession);
  assert.equal(joins.length, 2);
  await chat.send('still here');
  a.disconnect();
  assert.equal(a.state, 'closed');
}

function chatFixtures(): void {
  for (const row of CHAT_RULE_FIXTURES) {
    assert.equal(chatRuleOutcome(validateChatContent(row.raw)), row.expect, row.raw.slice(0, 40));
  }
}

chatFixtures();
await relay();
await authoritative();
await matchmaking();
await chatAndRpc();
await dropAndRejoin();
console.log('hub-sdk realtime mock tests ok');
