// In-memory Nakama realtime server for game unit tests. Clients from
// `connect()` are the real `createRealtime` client over a fake WebSocket, so
// tests exercise the same envelope handling the browser does.
import { HubSdkError } from '../errors';
import { CHAT_RATE, takeChatToken, validateChatContent } from './chatRules';
import { createRealtime } from './client';
import {
  base64ToBytes,
  bytesToBase64,
  encodePayload,
  presenceToWire,
  type WireChannelMessage,
  type WirePresence,
} from './protocol';
import type { HubRealtime, MatchListing, MatchmakerRequest, RealtimePresence } from './types';

export interface MockMatchDispatcher {
  broadcast(opCode: number, data: string | Uint8Array | object, to?: readonly RealtimePresence[] | null, sender?: RealtimePresence | null): void;
  kick(presences: readonly RealtimePresence[]): void;
  setLabel(label: string): void;
  end(): void;
}
export interface MockMatchHandler<S = unknown> {
  init(params: Record<string, string>): { state: S; label?: string };
  joinAttempt?(state: S, presence: RealtimePresence, metadata: Record<string, string>): { accept: boolean; reason?: string };
  join?(state: S, presences: RealtimePresence[], d: MockMatchDispatcher): void;
  leave?(state: S, presences: RealtimePresence[], d: MockMatchDispatcher): void;
  loop?(state: S, messages: { sender: RealtimePresence; opCode: number; data: Uint8Array }[], d: MockMatchDispatcher, tick: number): void;
}
export interface MockMatchmakerEntry { ticket: string; presence: RealtimePresence; request: MatchmakerRequest }
export interface MockRealtimeServer {
  /** A client for this user; connect() resolves immediately. */
  connect(user: { userId: string; username?: string }): HubRealtime;
  registerMatch<S>(name: string, handler: MockMatchHandler<S>): void;
  /** No name = relay match (messages fan out to other presences). Returns matchId. */
  createMatch(name?: string, params?: Record<string, string>): string;
  /** Default: groups tickets with equal stringProperties.game into minCount and creates a relay match. Return a matchId to use an authoritative one. */
  onMatchmakerMatched(fn: (entries: MockMatchmakerEntry[]) => string | null | void): void;
  registerRpc(id: string, fn: (ctx: { userId: string }, body: unknown) => unknown): void;
  /** Rooms accepted by joinChat; default all. Mirrors the server allowlist. */
  allowRooms(pattern: RegExp): void;
  /** Runs loop() of authoritative mock matches. */
  tick(count?: number): void;
  /** Resolves when all queued deliveries ran (delivery is async via microtasks). */
  flush(): Promise<void>;
  /** Simulate a dropped socket; the client goes reconnecting → open and re-joins. */
  drop(userId: string): void;
  matchesByLabel(query?: (label: string | null) => boolean): MatchListing[];
}

interface Conn {
  ws: FakeSocketLike;
  presence: RealtimePresence;
  matches: Set<string>;
  channels: Set<string>;
  open: boolean;
}

interface FakeSocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface MockMatch {
  id: string;
  name: string | null;
  handler: MockMatchHandler<unknown> | null;
  state: unknown;
  label: string | null;
  members: Map<string, Conn>; // sessionId → conn
  queue: { sender: RealtimePresence; opCode: number; data: Uint8Array }[];
  tick: number;
  ended: boolean;
}

interface MockChannel {
  id: string;
  members: Map<string, Conn>;
  history: WireChannelMessage[];
}

type Env = Record<string, unknown> & { cid?: string };

function wire(p: RealtimePresence): WirePresence {
  return presenceToWire(p);
}

/** `+label.kind:hub +label.open:T +label.players:<90` against a JSON label. Terms without `+` are ignored. */
export function mockLabelMatches(label: string | null, query: string): boolean {
  if (!query.trim()) return true;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = label ? (JSON.parse(label) as Record<string, unknown>) : {};
  } catch {
    return false;
  }
  for (const term of query.trim().split(/\s+/)) {
    const m = /^([+-]?)label\.([A-Za-z0-9_]+):(.*)$/.exec(term);
    if (!m) continue;
    const [, sign, key, rawValue] = m;
    if (sign !== '+' && sign !== '-') continue;
    const actual = parsed[key!];
    let ok: boolean;
    const value = rawValue!;
    if (value.startsWith('<') || value.startsWith('>')) {
      const n = Number(value.slice(value.startsWith('<=') || value.startsWith('>=') ? 2 : 1));
      const a = Number(actual);
      if (value.startsWith('<=')) ok = a <= n;
      else if (value.startsWith('>=')) ok = a >= n;
      else if (value.startsWith('<')) ok = a < n;
      else ok = a > n;
    } else if (value === 'T' || value === 'F') {
      ok = actual === (value === 'T');
    } else {
      ok = String(actual) === value;
    }
    if (sign === '+' && !ok) return false;
    if (sign === '-' && ok) return false;
  }
  return true;
}

export function createMockRealtimeServer(options?: { now?: () => number }): MockRealtimeServer {
  const now = options?.now ?? (() => Date.now());
  let pending = 0;
  let seq = 0;
  const conns = new Set<Conn>();
  const handlers = new Map<string, MockMatchHandler<unknown>>();
  const matches = new Map<string, MockMatch>();
  const relayTokens = new Map<string, string>();
  const rpcs = new Map<string, (ctx: { userId: string }, body: unknown) => unknown>();
  const roomPatterns: RegExp[] = [];
  const channels = new Map<string, MockChannel>();
  const buckets = new Map<string, string>();
  const lastText = new Map<string, { text: string; at: number }>();
  const tickets: { ticket: string; conn: Conn; request: MatchmakerRequest }[] = [];
  let matchedFn: ((entries: MockMatchmakerEntry[]) => string | null | void) | null = null;
  const usernames = new Map<string, string>();

  function schedule(fn: () => void): void {
    pending += 1;
    queueMicrotask(() => {
      try {
        fn();
      } finally {
        pending -= 1;
      }
    });
  }

  /** Server → client frames arrive as separate macrotasks, like WebSocket message events. */
  function push(conn: Conn, env: Env): void {
    const text = JSON.stringify(env);
    pending += 1;
    setTimeout(() => {
      try {
        if (conn.open && conn.ws.readyState === 1) conn.ws.onmessage?.({ data: text });
      } finally {
        pending -= 1;
      }
    }, 0);
  }

  function errorReply(conn: Conn, cid: string | undefined, code: number, message: string): void {
    push(conn, { cid, error: { code, message } });
  }

  function dispatcherFor(match: MockMatch): MockMatchDispatcher {
    return {
      broadcast(opCode, data, to, sender) {
        const bytes = encodePayload(data);
        const targets = to ? [...match.members.values()].filter((c) => to.some((p) => p.sessionId === c.presence.sessionId)) : [...match.members.values()];
        const body: Record<string, unknown> = { match_id: match.id, op_code: String(opCode), data: bytesToBase64(bytes), reliable: true };
        if (sender) body.presence = wire(sender);
        for (const c of targets) push(c, { match_data: body });
      },
      kick(presences) {
        for (const p of presences) {
          const c = match.members.get(p.sessionId);
          if (!c) continue;
          push(c, { match_presence_event: { match_id: match.id, leaves: [wire(c.presence)] } });
          removeFromMatch(match, c);
        }
      },
      setLabel(label) {
        match.label = label;
      },
      end() {
        if (match.ended) return;
        match.ended = true;
        for (const c of match.members.values()) {
          push(c, { match_ended: { match_id: match.id } });
          c.matches.delete(match.id);
        }
        match.members.clear();
        matches.delete(match.id);
      },
    };
  }

  function removeFromMatch(match: MockMatch, conn: Conn): void {
    if (!match.members.delete(conn.presence.sessionId)) return;
    conn.matches.delete(match.id);
    for (const other of match.members.values()) {
      push(other, { match_presence_event: { match_id: match.id, leaves: [wire(conn.presence)] } });
    }
    if (match.handler?.leave) match.handler.leave(match.state, [conn.presence], dispatcherFor(match));
  }

  function newMatch(name: string | null, params: Record<string, string>): MockMatch {
    seq += 1;
    const id = `mock-${seq}.mock`;
    const handler = name ? handlers.get(name) ?? null : null;
    if (name && !handler) throw new HubSdkError('match_not_found', `No mock match handler "${name}"`);
    const init = handler ? handler.init(params) : { state: null, label: undefined };
    const match: MockMatch = {
      id,
      name,
      handler,
      state: init.state,
      label: init.label ?? null,
      members: new Map(),
      queue: [],
      tick: 0,
      ended: false,
    };
    matches.set(id, match);
    return match;
  }

  function joinMatch(conn: Conn, cid: string | undefined, body: Record<string, unknown>): void {
    let matchId = typeof body.match_id === 'string' ? body.match_id : '';
    if (!matchId && typeof body.token === 'string') matchId = relayTokens.get(body.token) ?? '';
    const match = matches.get(matchId);
    if (!match || match.ended) {
      errorReply(conn, cid, 4, 'Match not found');
      return;
    }
    const metadata = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, string>;
    if (match.handler?.joinAttempt) {
      const verdict = match.handler.joinAttempt(match.state, conn.presence, metadata);
      if (!verdict.accept) {
        errorReply(conn, cid, 5, verdict.reason ?? 'rejected');
        return;
      }
    }
    const others = [...match.members.values()].map((c) => wire(c.presence));
    match.members.set(conn.presence.sessionId, conn);
    conn.matches.add(match.id);
    push(conn, {
      cid,
      match: {
        match_id: match.id,
        authoritative: !!match.handler,
        label: match.label ?? undefined,
        size: match.members.size,
        presences: others,
        self: wire(conn.presence),
      },
    });
    for (const other of match.members.values()) {
      if (other === conn) continue;
      push(other, { match_presence_event: { match_id: match.id, joins: [wire(conn.presence)] } });
    }
    if (match.handler?.join) match.handler.join(match.state, [conn.presence], dispatcherFor(match));
  }

  function dataSend(conn: Conn, body: Record<string, unknown>): void {
    const match = matches.get(String(body.match_id ?? ''));
    if (!match || !match.members.has(conn.presence.sessionId)) return;
    const opCode = Number(body.op_code ?? 0);
    const bytes = typeof body.data === 'string' ? base64ToBytes(body.data) : new Uint8Array(0);
    if (match.handler) {
      match.queue.push({ sender: conn.presence, opCode, data: bytes });
      return;
    }
    const to = Array.isArray(body.presences) ? (body.presences as WirePresence[]) : null;
    for (const other of match.members.values()) {
      if (other === conn) continue;
      if (to && !to.some((p) => p.session_id === other.presence.sessionId)) continue;
      push(other, {
        match_data: { match_id: match.id, presence: wire(conn.presence), op_code: String(opCode), data: body.data ?? '', reliable: body.reliable !== false },
      });
    }
  }

  function tryMatchmake(): void {
    const groups = new Map<string, typeof tickets>();
    for (const t of tickets) {
      const game = t.request.stringProperties?.game ?? '';
      const list = groups.get(game) ?? [];
      list.push(t);
      groups.set(game, list);
    }
    for (const list of groups.values()) {
      const need = list[0]!.request.minCount;
      const picked: typeof tickets = [];
      for (const t of list) {
        if (picked.some((p) => p.conn.presence.userId === t.conn.presence.userId)) continue;
        picked.push(t);
        if (picked.length >= need) break;
      }
      if (picked.length < need) continue;
      for (const p of picked) tickets.splice(tickets.indexOf(p), 1);
      const entries: MockMatchmakerEntry[] = picked.map((p) => ({ ticket: p.ticket, presence: p.conn.presence, request: p.request }));
      const chosen = matchedFn ? matchedFn(entries) : null;
      let matchId: string | null = null;
      let token: string | null = null;
      if (typeof chosen === 'string' && chosen) {
        matchId = chosen;
      } else {
        const relay = newMatch(null, {});
        seq += 1;
        token = `mock-token-${seq}`;
        relayTokens.set(token, relay.id);
      }
      const users = picked.map((p) => ({
        presence: wire(p.conn.presence),
        string_properties: p.request.stringProperties ?? {},
        numeric_properties: p.request.numericProperties ?? {},
      }));
      picked.forEach((p, i) => {
        const body: Record<string, unknown> = { ticket: p.ticket, users, self: users[i] };
        if (matchId) body.match_id = matchId;
        if (token) body.token = token;
        push(p.conn, { matchmaker_matched: body });
      });
    }
  }

  function channelIdFor(conn: Conn, target: string, type: number): string {
    if (type === 2) {
      const [a, b] = [conn.presence.userId, target].sort();
      return `4.${a}.${b}.`;
    }
    if (type === 3) return `3.${target}..`;
    return `2...${target}`;
  }

  function joinChannel(conn: Conn, cid: string | undefined, body: Record<string, unknown>): void {
    const target = String(body.target ?? '');
    const type = Number(body.type ?? 1);
    if (type === 1 && roomPatterns.length && !roomPatterns.some((p) => p.test(target))) {
      errorReply(conn, cid, 0, 'Error: room_not_allowed at mockChannelJoin (mock)');
      return;
    }
    const id = channelIdFor(conn, target, type);
    const channel = channels.get(id) ?? { id, members: new Map(), history: [] };
    channels.set(id, channel);
    const others = [...channel.members.values()].filter((c) => c !== conn).map((c) => wire(c.presence));
    channel.members.set(conn.presence.sessionId, conn);
    conn.channels.add(id);
    push(conn, { cid, channel: { id, presences: others, self: wire(conn.presence) } });
    for (const other of channel.members.values()) {
      if (other !== conn) push(other, { channel_presence_event: { channel_id: id, joins: [wire(conn.presence)] } });
    }
  }

  function leaveChannel(conn: Conn, id: string): void {
    const channel = channels.get(id);
    conn.channels.delete(id);
    if (!channel || !channel.members.delete(conn.presence.sessionId)) return;
    for (const other of channel.members.values()) {
      push(other, { channel_presence_event: { channel_id: id, leaves: [wire(conn.presence)] } });
    }
  }

  function sendChat(conn: Conn, cid: string | undefined, body: Record<string, unknown>): void {
    const channel = channels.get(String(body.channel_id ?? ''));
    if (!channel || !channel.members.has(conn.presence.sessionId)) {
      errorReply(conn, cid, 3, 'Error: channel_not_joined at mock');
      return;
    }
    const checked = validateChatContent(String(body.content ?? ''));
    if (!checked.ok) {
      errorReply(conn, cid, 0, `Error: ${checked.code} at mockChannelMessageSend (mock)`);
      return;
    }
    const at = now();
    const userId = conn.presence.userId;
    const bucket = takeChatToken(buckets.get(userId) ?? null, at, CHAT_RATE.refillMs);
    if (!bucket.allowed) {
      buckets.set(userId, bucket.state);
      errorReply(conn, cid, 0, 'Error: chat_rate_limited at mockChannelMessageSend (mock)');
      return;
    }
    const last = lastText.get(userId);
    if (last && last.text === checked.content.text && at - last.at < CHAT_RATE.duplicateWindowMs) {
      errorReply(conn, cid, 0, 'Error: chat_duplicate at mockChannelMessageSend (mock)');
      return;
    }
    buckets.set(userId, bucket.state);
    lastText.set(userId, { text: checked.content.text, at });
    seq += 1;
    const message: WireChannelMessage = {
      channel_id: channel.id,
      message_id: `msg-${seq}`,
      sender_id: userId,
      username: conn.presence.username,
      content: JSON.stringify(checked.content),
      create_time: new Date(at).toISOString(),
      persistent: true,
    };
    channel.history.push(message);
    push(conn, { cid, channel_message_ack: { channel_id: channel.id, message_id: message.message_id } });
    for (const member of channel.members.values()) push(member, { channel_message: message });
  }

  function callRpc(conn: Conn, cid: string | undefined, body: Record<string, unknown>): void {
    const id = String(body.id ?? '');
    const fn = rpcs.get(id);
    if (!fn) {
      errorReply(conn, cid, 6, `RPC function not found: ${id}`);
      return;
    }
    let input: unknown = {};
    try {
      input = typeof body.payload === 'string' && body.payload ? JSON.parse(body.payload) : {};
    } catch {
      errorReply(conn, cid, 3, 'Error: bad_json at mockRpc (mock)');
      return;
    }
    try {
      const result = fn({ userId: conn.presence.userId }, input);
      push(conn, { cid, rpc: { id, payload: typeof result === 'string' ? result : JSON.stringify(result ?? {}) } });
    } catch (error) {
      const message = error instanceof HubSdkError ? error.code : error instanceof Error ? error.message : String(error);
      errorReply(conn, cid, 7, `Error: ${message} at mockRpc (mock)`);
    }
  }

  function onClientMessage(conn: Conn, raw: string): void {
    let env: Env;
    try {
      env = JSON.parse(raw) as Env;
    } catch {
      return;
    }
    const cid = env.cid;
    const get = (key: string) => (env[key] && typeof env[key] === 'object' ? (env[key] as Record<string, unknown>) : null);
    let body: Record<string, unknown> | null;
    if ((body = get('match_join'))) return joinMatch(conn, cid, body);
    if ((body = get('match_leave'))) {
      const match = matches.get(String(body.match_id ?? ''));
      if (match) removeFromMatch(match, conn);
      push(conn, { cid });
      return;
    }
    if ((body = get('match_data_send'))) return dataSend(conn, body);
    if ((body = get('matchmaker_add'))) {
      seq += 1;
      const ticket = `mock-ticket-${seq}`;
      const request: MatchmakerRequest = {
        query: String(body.query ?? ''),
        minCount: Number(body.min_count ?? 2),
        maxCount: Number(body.max_count ?? 2),
        stringProperties: (body.string_properties as Record<string, string>) ?? {},
        numericProperties: (body.numeric_properties as Record<string, number>) ?? {},
      };
      if (body.count_multiple) request.countMultiple = Number(body.count_multiple);
      tickets.push({ ticket, conn, request });
      push(conn, { cid, matchmaker_ticket: { ticket } });
      tryMatchmake();
      return;
    }
    if ((body = get('matchmaker_remove'))) {
      const i = tickets.findIndex((t) => t.ticket === body!.ticket && t.conn === conn);
      if (i >= 0) tickets.splice(i, 1);
      push(conn, { cid });
      return;
    }
    if ((body = get('channel_join'))) return joinChannel(conn, cid, body);
    if ((body = get('channel_leave'))) {
      leaveChannel(conn, String(body.channel_id ?? ''));
      push(conn, { cid });
      return;
    }
    if ((body = get('channel_message_send'))) return sendChat(conn, cid, body);
    if (get('channel_message_update') || get('channel_message_remove')) {
      errorReply(conn, cid, 0, 'Error: chat_readonly at mock');
      return;
    }
    if ((body = get('rpc'))) return callRpc(conn, cid, body);
    if (get('ping')) {
      push(conn, { cid, pong: {} });
      return;
    }
    if (cid) errorReply(conn, cid, 1, 'Unrecognized payload');
  }

  function cleanup(conn: Conn): void {
    conn.open = false;
    conns.delete(conn);
    for (const id of [...conn.matches]) {
      const match = matches.get(id);
      if (match) removeFromMatch(match, conn);
    }
    for (const id of [...conn.channels]) leaveChannel(conn, id);
    for (let i = tickets.length - 1; i >= 0; i -= 1) if (tickets[i]!.conn === conn) tickets.splice(i, 1);
  }

  class FakeSocket implements FakeSocketLike {
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    private conn: Conn | null = null;

    constructor(url: string) {
      const token = new URL(url).searchParams.get('token') ?? '';
      const userId = token.startsWith('mock:') ? token.slice(5) : '';
      schedule(() => {
        if (!userId || this.readyState !== 0) {
          this.readyState = 3;
          this.onerror?.({});
          this.onclose?.({ code: 4001, reason: 'unauthorized' });
          return;
        }
        seq += 1;
        this.conn = {
          ws: this,
          presence: { userId, sessionId: `sess-${seq}`, username: usernames.get(userId) ?? userId },
          matches: new Set(),
          channels: new Set(),
          open: true,
        };
        conns.add(this.conn);
        this.readyState = 1;
        this.onopen?.({});
      });
    }

    send(data: string): void {
      if (this.readyState !== 1 || !this.conn) throw new Error('InvalidStateError');
      const conn = this.conn;
      schedule(() => {
        if (conn.open) onClientMessage(conn, data);
      });
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.conn) cleanup(this.conn);
      schedule(() => this.onclose?.({ code, reason }));
    }

    /** Server-side drop. */
    drop(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.conn) cleanup(this.conn);
      schedule(() => this.onclose?.({ code: 1006, reason: 'mock drop' }));
    }
  }

  async function mockFetch(input: string | URL | Request): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/v2/match') {
      const min = url.searchParams.get('min_size');
      const max = url.searchParams.get('max_size');
      const query = url.searchParams.get('query') ?? '';
      const label = url.searchParams.get('label');
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const list = [...matches.values()]
        .filter((m) => m.handler && !m.ended)
        .filter((m) => (min === null || m.members.size >= Number(min)) && (max === null || m.members.size <= Number(max)))
        .filter((m) => (label === null || m.label === label) && mockLabelMatches(m.label, query))
        .slice(0, limit)
        .map((m) => ({ match_id: m.id, authoritative: true, label: m.label ?? undefined, size: m.members.size }));
      return new Response(JSON.stringify({ matches: list }), { status: 200 });
    }
    if (url.pathname.startsWith('/v2/channel/')) {
      const id = decodeURIComponent(url.pathname.slice('/v2/channel/'.length));
      const channel = channels.get(id);
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const offset = Number(url.searchParams.get('cursor') ?? 0) || 0;
      const newestFirst = [...(channel?.history ?? [])].reverse();
      const page = newestFirst.slice(offset, offset + limit);
      const next = offset + limit < newestFirst.length ? String(offset + limit) : '';
      return new Response(JSON.stringify({ messages: page, next_cursor: next }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }

  return {
    connect(user) {
      usernames.set(user.userId, user.username ?? user.userId);
      const client = createRealtime({
        serverUrl: 'http://mock.realtime',
        getToken: () => `mock:${user.userId}`,
        WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket,
        fetchImpl: mockFetch as typeof fetch,
        reconnect: { baseDelayMs: 0, maxDelayMs: 0 },
        requestTimeoutMs: 5000,
      });
      return client;
    },

    registerMatch(name, handler) {
      handlers.set(name, handler as MockMatchHandler<unknown>);
    },

    createMatch(name, params) {
      return newMatch(name ?? null, params ?? {}).id;
    },

    onMatchmakerMatched(fn) {
      matchedFn = fn;
    },

    registerRpc(id, fn) {
      rpcs.set(id, fn);
    },

    allowRooms(pattern) {
      roomPatterns.push(pattern);
    },

    tick(count = 1) {
      for (let i = 0; i < count; i += 1) {
        for (const match of [...matches.values()]) {
          if (!match.handler || match.ended) continue;
          match.tick += 1;
          const batch = match.queue.splice(0);
          match.handler.loop?.(match.state, batch, dispatcherFor(match), match.tick);
        }
      }
    },

    async flush() {
      let idle = 0;
      for (let i = 0; i < 200 && idle < 3; i += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        idle = pending === 0 ? idle + 1 : 0;
      }
    },

    drop(userId) {
      for (const conn of [...conns]) {
        if (conn.presence.userId === userId) (conn.ws as FakeSocket).drop();
      }
    },

    matchesByLabel(query) {
      return [...matches.values()]
        .filter((m) => !m.ended && (!query || query(m.label)))
        .map((m) => ({ matchId: m.id, size: m.members.size, label: m.label, authoritative: !!m.handler }));
    },
  };
}
