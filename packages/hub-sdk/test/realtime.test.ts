import assert from 'node:assert/strict';
import {
  HubSdkError,
  createHubSdk,
  createRealtime,
  errorCodeFromMessage,
  memoryKeyValue,
  realtimeFromSdk,
  type MatchCloseReason,
  type MatchData,
  type MatchmakerMatched,
  type RealtimeState,
} from '../src/index';
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../src/realtime/protocol';

type Sent = Record<string, unknown> & { cid?: string };

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  url: string;
  sent: Sent[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Sent);
  }
  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(env: object): void {
    this.onmessage?.({ data: JSON.stringify(env) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: 'gone' });
  }
  last(key: string): Sent | undefined {
    return [...this.sent].reverse().find((e) => key in e);
  }
}

function fakeTimers() {
  let id = 0;
  const queue: { id: number; fn: () => void; ms: number }[] = [];
  return {
    queue,
    timers: {
      setTimeout: ((fn: () => void, ms?: number) => {
        id += 1;
        queue.push({ id, fn, ms: ms ?? 0 });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: ((handle: unknown) => {
        const i = queue.findIndex((t) => t.id === (handle as number));
        if (i >= 0) queue.splice(i, 1);
      }) as unknown as typeof clearTimeout,
    },
    /** Runs the earliest timer (by delay). */
    runNext(): number {
      queue.sort((a, b) => a.ms - b.ms);
      const next = queue.shift();
      if (!next) throw new Error('no timer');
      next.fn();
      return next.ms;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function jwt(uid: string, usn: string): string {
  return `e30.${Buffer.from(JSON.stringify({ uid, usn })).toString('base64url')}.sig`;
}

async function protocolBasics(): Promise<void> {
  const text = 'héllo ✓ 🐕';
  assert.equal(utf8Decode(base64ToBytes(bytesToBase64(utf8Encode(text)))), text);
  assert.equal(errorCodeFromMessage('Error: room_not_allowed at rtBeforeChannelJoin (index.js:37:199(22))', 'x'), 'room_not_allowed');
  assert.equal(errorCodeFromMessage('chat_muted', 'x'), 'chat_muted');
  assert.equal(errorCodeFromMessage('Some Words', 'x'), 'x');
  assert.equal(errorCodeFromMessage(undefined, 'x'), 'x');
}

async function connectAndMatch(): Promise<void> {
  FakeSocket.all = [];
  const t = fakeTimers();
  const tokens: string[] = [];
  const states: RealtimeState[] = [];
  const rt = createRealtime({
    serverUrl: 'https://hub.test',
    getToken: () => {
      const tok = jwt('u1', 'alice');
      tokens.push(tok);
      return tok;
    },
    WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket,
    timers: t.timers,
    requestTimeoutMs: 1000,
    reconnect: { baseDelayMs: 100, maxDelayMs: 1000 },
  });
  rt.onState((s) => states.push(s));
  const connecting = rt.connect();
  await tick();
  const ws = FakeSocket.all[0]!;
  assert.match(ws.url, /^wss:\/\/hub\.test\/ws\?lang=en&status=false&token=/);
  ws.open();
  await connecting;
  assert.equal(rt.state, 'open');
  assert.equal(rt.self?.userId, 'u1');
  assert.equal(rt.self?.username, 'alice');

  // cid correlation: two in flight, answered out of order.
  const a = rt.joinMatch({ matchId: 'm1.node' }, { k: 'v' });
  await tick();
  const joinEnv = ws.last('match_join')!;
  assert.deepEqual(joinEnv.match_join, { match_id: 'm1.node', metadata: { k: 'v' } });
  const rpc = rt.rpc<{ ok: boolean }>('hub.ping', { a: 1 });
  await tick();
  const rpcEnv = ws.last('rpc')!;
  assert.deepEqual(rpcEnv.rpc, { id: 'hub.ping', payload: '{"a":1}' });
  ws.serverSend({ cid: rpcEnv.cid, rpc: { id: 'hub.ping', payload: '{"ok":true}' } });
  assert.deepEqual(await rpc, { ok: true });
  ws.serverSend({
    cid: joinEnv.cid,
    match: {
      match_id: 'm1.node',
      authoritative: true,
      label: '{"kind":"hub"}',
      size: 2,
      presences: [{ user_id: 'u2', session_id: 's2', username: 'bob' }, { user_id: 'u1', session_id: 's1', username: 'alice' }],
      self: { user_id: 'u1', session_id: 's1', username: 'alice' },
    },
  });
  const match = await a;
  assert.equal(match.label, '{"kind":"hub"}');
  assert.deepEqual(match.presences.map((p) => p.userId), ['u2']);
  assert.equal(rt.self?.sessionId, 's1');

  // send(): synchronous enqueue with each encoding.
  const before = ws.sent.length;
  const ret = match.send(1, { x: 1 });
  assert.equal(ret, undefined);
  match.send(2, 'hé');
  match.send(3, new Uint8Array([1, 2, 255]), { to: [match.presences[0]!], reliable: false });
  match.send(4);
  assert.equal(ws.sent.length, before + 4, 'send writes to the socket synchronously');
  const [s1, s2, s3, s4] = ws.sent.slice(before).map((e) => e.match_data_send as Record<string, unknown>);
  assert.equal(s1!.op_code, '1');
  assert.equal(utf8Decode(base64ToBytes(String(s1!.data))), '{"x":1}');
  assert.equal(utf8Decode(base64ToBytes(String(s2!.data))), 'hé');
  assert.deepEqual([...base64ToBytes(String(s3!.data))], [1, 2, 255]);
  assert.deepEqual(s3!.presences, [{ user_id: 'u2', session_id: 's2', username: 'bob' }]);
  assert.equal(s3!.reliable, false);
  assert.equal(s4!.data, '');

  const got: MatchData[] = [];
  match.onMessage((m) => got.push(m));
  ws.serverSend({ match_data: { match_id: 'm1.node', op_code: '7', data: bytesToBase64(utf8Encode('{"p":[1]}')), reliable: true } });
  ws.serverSend({ match_data: { match_id: 'm1.node', presence: { user_id: 'u2', session_id: 's2', username: 'bob' }, op_code: '8', data: '' } });
  assert.equal(got[0]!.opCode, 7);
  assert.equal(got[0]!.sender, null);
  assert.deepEqual(got[0]!.json(), { p: [1] });
  assert.equal(got[1]!.sender?.username, 'bob');

  const presenceEvents: number[] = [];
  match.onPresence((e) => presenceEvents.push(e.joins.length - e.leaves.length));
  ws.serverSend({ match_presence_event: { match_id: 'm1.node', joins: [{ user_id: 'u3', session_id: 's3', username: 'cy' }] } });
  ws.serverSend({ match_presence_event: { match_id: 'm1.node', leaves: [{ user_id: 'u2', session_id: 's2', username: 'bob' }] } });
  assert.deepEqual(presenceEvents, [1, -1]);
  assert.deepEqual(match.presences.map((p) => p.userId), ['u3']);

  // Timeout: an unanswered request rejects with rt_timeout.
  const slow = rt.rpc('hub.slow');
  await tick();
  const timeoutMs = t.runNext();
  assert.equal(timeoutMs, 1000);
  await assert.rejects(slow, (e: unknown) => e instanceof HubSdkError && e.code === 'rt_timeout');

  // Error envelopes map to HubSdkError codes.
  const bad = rt.joinChat({ room: 'nope' });
  await tick();
  ws.serverSend({ cid: ws.last('channel_join')!.cid, error: { code: 0, message: 'Error: room_not_allowed at rtBeforeChannelJoin (index.js:37:199(22))' } });
  await assert.rejects(bad, (e: unknown) => e instanceof HubSdkError && e.code === 'room_not_allowed');
  const full = rt.joinMatch({ matchId: 'm2.node' });
  await tick();
  ws.serverSend({ cid: ws.last('match_join')!.cid, error: { code: 5, message: 'full' } });
  await assert.rejects(full, (e: unknown) => e instanceof HubSdkError && e.code === 'match_rejected:full');
  const missing = rt.joinMatch({ matchId: 'm3.node' });
  await tick();
  ws.serverSend({ cid: ws.last('match_join')!.cid, error: { code: 4, message: 'Match not found' } });
  await assert.rejects(missing, (e: unknown) => e instanceof HubSdkError && e.code === 'match_not_found');
  const rpcErr = rt.rpc('hub.join');
  await tick();
  ws.serverSend({ cid: ws.last('rpc')!.cid, rpc: { id: 'hub.join', payload: '{"error":"wrong_scope","message":"wrong_scope"}' } });
  await assert.rejects(rpcErr, (e: unknown) => e instanceof HubSdkError && e.code === 'wrong_scope');
  const loose: string[] = [];
  rt.onError((e) => loose.push(e.code));
  ws.serverSend({ error: { code: 3, message: 'Error: chat_muted at x' } });
  assert.deepEqual(loose, ['chat_muted']);

  // Matchmaker.
  const matched: MatchmakerMatched[] = [];
  rt.onMatchmakerMatched((m) => matched.push(m));
  const add = rt.addMatchmaker({ query: '+properties.game:sproto', minCount: 2, maxCount: 2, stringProperties: { game: 'sproto' } });
  await tick();
  const mmEnv = ws.last('matchmaker_add')!;
  assert.deepEqual(mmEnv.matchmaker_add, { query: '+properties.game:sproto', min_count: 2, max_count: 2, string_properties: { game: 'sproto' }, numeric_properties: {} });
  ws.serverSend({ cid: mmEnv.cid, matchmaker_ticket: { ticket: 'T1' } });
  const { ticket } = await add;
  assert.equal(ticket, 'T1');

  // Reconnect: drop the socket with a pending request and live match/channel/ticket.
  const chat = rt.joinChat({ room: 'hub.1' });
  await tick();
  ws.serverSend({ cid: ws.last('channel_join')!.cid, channel: { id: '2...hub.1', presences: [], self: { user_id: 'u1', session_id: 's1', username: 'alice' } } });
  const channel = await chat;
  assert.equal(channel.id, '2...hub.1');
  const rejoined: number[] = [];
  const closes: MatchCloseReason[] = [];
  match.onRejoin(() => rejoined.push(1));
  match.onClose((r) => closes.push(r));
  const inflight = rt.rpc('hub.inflight');
  await tick();
  const tokenCount = tokens.length;
  ws.drop();
  await assert.rejects(inflight, (e: unknown) => e instanceof HubSdkError && e.code === 'rt_disconnected');
  assert.equal(rt.state, 'reconnecting');
  const backoff = t.runNext();
  assert.ok(backoff >= 0 && backoff <= 100, `first backoff ${backoff} within base`);
  await tick();
  assert.equal(tokens.length, tokenCount + 1, 'getToken is called again before reconnecting');
  const ws2 = FakeSocket.all[1]!;
  ws2.open();
  await tick();
  assert.equal(rt.state, 'open');
  const rejoin = ws2.last('match_join')!;
  assert.deepEqual(rejoin.match_join, { match_id: 'm1.node', metadata: { k: 'v' } });
  ws2.serverSend({ cid: rejoin.cid, match: { match_id: 'm1.node', presences: [], self: { user_id: 'u1', session_id: 's9', username: 'alice' } } });
  await tick();
  assert.deepEqual(rejoined, [1]);
  assert.equal(match.self.sessionId, 's9');
  const chatRejoin = ws2.last('channel_join')!;
  assert.deepEqual(chatRejoin.channel_join, { target: 'hub.1', type: 1, persistence: true, hidden: false });
  ws2.serverSend({ cid: chatRejoin.cid, channel: { id: '2...hub.1', presences: [] } });
  await tick();
  const mmRe = ws2.last('matchmaker_add')!;
  ws2.serverSend({ cid: mmRe.cid, matchmaker_ticket: { ticket: 'T2' } });
  await tick();
  ws2.serverSend({ matchmaker_matched: { ticket: 'T2', match_id: 'arena.node', users: [], self: { presence: { user_id: 'u1' } } } });
  assert.equal(matched[0]!.ticket, 'T1', 'matched maps the re-added ticket back to the original');
  assert.equal(matched[0]!.matchId, 'arena.node');
  assert.equal(matched[0]!.token, null);

  // A second drop where the rejoin fails closes the handle with rejoin_failed.
  const add2 = rt.addMatchmaker({ query: '*', minCount: 2, maxCount: 2 });
  await tick();
  ws2.serverSend({ cid: ws2.last('matchmaker_add')!.cid, matchmaker_ticket: { ticket: 'T3' } });
  await add2;
  ws2.drop();
  const second = t.runNext();
  assert.ok(second <= 200, `second backoff ${second} within base*2`);
  await tick();
  const ws3 = FakeSocket.all[2]!;
  ws3.open();
  await tick();
  ws3.serverSend({ cid: ws3.last('match_join')!.cid, error: { code: 4, message: 'Match not found' } });
  await tick();
  assert.deepEqual(closes, ['rejoin_failed']);
  await tick();
  ws3.serverSend({ cid: ws3.last('channel_join')!.cid, channel: { id: '2...hub.1', presences: [] } });
  await tick();
  ws3.serverSend({ cid: ws3.last('matchmaker_add')!.cid, matchmaker_ticket: { ticket: 'T4' } });
  await tick();
  const removing = rt.removeMatchmaker('T3');
  await tick();
  const rm = ws3.last('matchmaker_remove')!;
  assert.deepEqual(rm.matchmaker_remove, { ticket: 'T4' }, 'removeMatchmaker(original) removes the current server ticket');
  ws3.serverSend({ cid: rm.cid });
  await removing;

  // disconnect() closes for good: no reconnect timer.
  rt.disconnect();
  assert.equal(rt.state, 'closed');
  assert.equal(t.queue.length, 0);
  assert.ok(states.includes('reconnecting'));
  await tick();
  assert.equal(FakeSocket.all.length, 3, 'no new socket after disconnect()');
}

async function chatHistory(): Promise<void> {
  FakeSocket.all = [];
  const pages: string[] = [];
  const rt = createRealtime({
    serverUrl: 'http://hub.test',
    getToken: () => jwt('u1', 'alice'),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      pages.push(String(url));
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${jwt('u1', 'alice')}`);
      const cursor = new URL(String(url)).searchParams.get('cursor');
      const msg = (id: string) => ({ channel_id: '2...hub.1', message_id: id, sender_id: 'u2', username: 'bob', content: '{"text":"hi","color":"red"}', create_time: '2026-11-04T10:00:00Z', persistent: true });
      return new Response(JSON.stringify(cursor ? { messages: [msg('m1')] } : { messages: [msg('m3'), msg('m2')], next_cursor: 'c1' }));
    }) as typeof fetch,
  });
  const p = rt.connect();
  await tick();
  FakeSocket.all[0]!.open();
  await p;
  const join = rt.joinChat({ room: 'hub.1' });
  await tick();
  const ws = FakeSocket.all[0]!;
  ws.serverSend({ cid: ws.last('channel_join')!.cid, channel: { id: '2...hub.1', presences: [{ user_id: 'u2', session_id: 's2', username: 'bob' }] } });
  const channel = await join;
  assert.equal(channel.presences.length, 1);
  const first = await channel.history({ limit: 2 });
  assert.match(pages[0]!, /^http:\/\/hub\.test\/v2\/channel\/2\.\.\.hub\.1\?limit=2&forward=false$/);
  assert.deepEqual(first.messages.map((m) => m.messageId), ['m3', 'm2']);
  assert.equal(first.messages[0]!.content.color, 'red');
  assert.equal(first.messages[0]!.createdAt, Date.parse('2026-11-04T10:00:00Z'));
  assert.equal(first.cursor, 'c1');
  const second = await channel.history({ limit: 2, cursor: first.cursor });
  assert.equal(second.cursor, null);
  const sending = channel.send({ text: 'yo', color: 'cyan' });
  await tick();
  const send = ws.last('channel_message_send')!;
  assert.deepEqual(send.channel_message_send, { channel_id: '2...hub.1', content: '{"text":"yo","color":"cyan"}' });
  ws.serverSend({ cid: send.cid, channel_message_ack: { channel_id: '2...hub.1', message_id: 'm4' } });
  assert.deepEqual(await sending, { messageId: 'm4' });
  const seen: string[] = [];
  channel.onMessage((m) => seen.push(m.content.text));
  ws.serverSend({ channel_message: { channel_id: '2...hub.1', message_id: 'm4', sender_id: 'u1', username: 'alice', content: '{"text":"yo"}' } });
  assert.deepEqual(seen, ['yo']);
  rt.disconnect();
}

async function noReconnectWhenDisabled(): Promise<void> {
  FakeSocket.all = [];
  const t = fakeTimers();
  const rt = createRealtime({
    serverUrl: 'http://hub.test',
    getToken: () => jwt('u1', 'a'),
    WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket,
    timers: t.timers,
    reconnect: false,
  });
  const p = rt.connect();
  await tick();
  FakeSocket.all[0]!.open();
  await p;
  FakeSocket.all[0]!.drop();
  assert.equal(rt.state, 'closed');
  assert.equal(t.queue.length, 0);
}

async function fromSdk(): Promise<void> {
  const sdk = createHubSdk({ local: memoryKeyValue(), session: memoryKeyValue(), readHash: () => '' });
  await sdk.init('nobu');
  assert.equal(realtimeFromSdk(sdk), null, 'standalone has no realtime');
}

await protocolBasics();
await connectAndMatch();
await chatHistory();
await noReconnectWhenDisabled();
await fromSdk();
console.log('hub-sdk realtime tests ok');
