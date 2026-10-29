/**
 * Cases for work that is specified and not landed yet. Each group stays
 * pending until its detector matches, then it runs and must pass.
 *
 * SDK outbox (live hub-sdk, IndexedDB — not the harness queue):
 * - Export `HUB_OUTBOX_DB` from `@metaverse/hub-sdk` with value `hub-outbox`.
 * - `packages/hub-sdk/src/live.ts` opens that database with `indexedDB` and
 *   object store `writes`.
 * - A record is `{ rpc: 'session.event' | 'tickets.earn' | 'tickets.exchange',
 *   body, key, token, gameId }`. The game passes `key` once. Retries, including
 *   after a new SDK instance, reuse that same key. Remove the record only
 *   after the RPC returns without throwing.
 * - `init` awaits a drain of every pending record, including when this tab has
 *   no sessionStorage session. Drain calls the same Nakama client with the
 *   stored token and key.
 *
 * Seq (`game.event_rule` exists). `seq` on `session.event` is optional so
 * older callers keep working. When `seq` is present the session accepts only
 * the next integer, starting at 1:
 * - same seq, new idempotency key → `{ error: 'seq_duplicate' }`
 * - seq lower than the next one, new key → `{ error: 'seq_stale' }`
 * - same key and same body, including the same seq, stays an idempotent replay
 * Seed `sproto.boss_defeated` so it still grants `tinubu_crown`.
 *
 * Per-session Tickets (`game.session_ticket_cap()` exists). The function
 * returns a bigint strictly below the daily cap of 1000, and `2 * cap` still
 * fits under that daily cap. `tickets.earn` past the cap returns
 * `{ error: 'session_ticket_cap' }` and does not credit. A new session the
 * same UTC day gets its own cap. Same-key retries do not credit again.
 *
 * Mock clock: `HubSdkEnv.serverNow?: () => number` in `env.ts`, and the mock
 * in `createHubSdk.ts` buckets `hub:earn:<game>:<utc-day>` and
 * `hub:verseDay:<game>:<utc-day>` with `serverNow`, never with `now`.
 */
declare module 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHubSdk,
  createNakamaClient,
  memoryKeyValue,
  mintMockTicket,
  type HubSdk,
  type HubSdkEnv,
  type KeyValue,
  type NakamaClient,
} from '../../../packages/hub-sdk/src/index.ts';
import { TICKET_DAILY_CAP } from './cases.ts';
import {
  arm,
  call,
  disarm,
  earnLedgerCount,
  exchangeCount,
  killDuringSleep,
  guest,
  login,
  mints,
  num,
  openGame,
  psql,
  relicClaims,
  sqlId,
  ticketBalance,
  verseBalance,
  type RpcResult,
} from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTBOX_DB = 'hub-outbox';
const OUTBOX_STORE = 'writes';

const OUTBOX_CASES = [
  'reload_lost_response',
  'second_tab_drains',
  'kill_between_send_and_ack',
] as const;

const SEQ_CASES = ['duplicate_seq_rejected', 'stale_seq_rejected', 'concurrent_duplicate_seq_one_mint'] as const;

const CAP_CASES = [
  'over_cap_rejected_under_daily',
  'retries_do_not_credit',
  'concurrent_cannot_exceed',
  'second_session_same_day',
] as const;

export interface GateRunner {
  test: (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
  pending: (category: string, name: string, reason: string) => void;
}

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

export function outboxLanded(): boolean {
  const live = source('packages/hub-sdk/src/live.ts');
  const index = source('packages/hub-sdk/src/index.ts');
  return live.includes(`'${OUTBOX_DB}'`) || live.includes(`"${OUTBOX_DB}"`)
    ? live.includes('indexedDB') && index.includes('HUB_OUTBOX_DB')
    : false;
}

export function eventRuleLanded(): boolean {
  return psql(`SELECT (to_regclass('game.event_rule') IS NOT NULL)`) === 't';
}

export function sessionCapLanded(): boolean {
  return psql(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'game' AND p.proname = 'session_ticket_cap'
     )`,
  ) === 't';
}

export function mockServerClockLanded(): boolean {
  const env = source('packages/hub-sdk/src/env.ts');
  const sdk = source('packages/hub-sdk/src/createHubSdk.ts');
  return env.includes('serverNow') && sdk.includes('serverNow');
}

type LooseRequest = {
  onsuccess: null | (() => void);
  onerror: null | (() => void);
  onblocked: null | (() => void);
  onupgradeneeded?: null | (() => void);
  result: {
    close(): void;
    objectStoreNames: { contains(name: string): boolean };
    transaction(store: string, mode: 'readwrite'): {
      objectStore(name: string): { clear(): void };
      oncomplete: null | (() => void);
      onerror: null | (() => void);
    };
  };
};

function browserIdb(): { deleteDatabase(name: string): LooseRequest; open(name: string): LooseRequest } {
  return (globalThis as unknown as {
    indexedDB: { deleteDatabase(name: string): LooseRequest; open(name: string): LooseRequest };
  }).indexedDB;
}

async function resetOutbox(): Promise<void> {
  const idb = browserIdb();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('indexedDB deleteDatabase timed out')), 5_000);
    const req = idb.deleteDatabase(OUTBOX_DB);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onsuccess = finish;
    req.onerror = finish;
    req.onblocked = finish;
  });
}

interface OutboxGame {
  game: 'sproto' | 'hpos10i';
  eventId: string;
  data: Record<string, unknown>;
  relicId: string;
  earnAmount: number;
  exchangeTickets: number;
  verse: number;
  ticketsLeft: number;
}

const SPROTO_OUTBOX: OutboxGame = {
  game: 'sproto',
  eventId: 'sproto.boss_defeated',
  data: { boss: 'tinubu', elapsed: 12 },
  relicId: 'tinubu_crown',
  earnAmount: 40,
  exchangeTickets: 20,
  verse: 2,
  ticketsLeft: 20,
};

const HPOS_OUTBOX: OutboxGame = {
  game: 'hpos10i',
  eventId: 'hpos10i.level_complete',
  data: { zone: 'z1_retro_rush_hills', act: 1, time: 40.125 },
  relicId: 'hpos10i_core',
  earnAmount: 20,
  exchangeTickets: 10,
  verse: 1,
  ticketsLeft: 10,
};

interface LiveKit {
  sdk: HubSdk;
  session: KeyValue;
  calls: string[];
  dropOnce: Set<string>;
  client: NakamaClient;
  playerId: string;
  spec: OutboxGame;
}

function rpcOf(url: string): string {
  const marker = '/v2/rpc/';
  const at = url.indexOf(marker);
  if (at < 0) return '';
  return decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
}

async function lose(kit: { dropOnce: Set<string> }, rpc: string, key: string, run: () => Promise<unknown>): Promise<void> {
  kit.dropOnce.add(`${rpc}:${key}`);
  await assert.rejects(run);
}

function quiet(promise: Promise<unknown>): Promise<RpcResult> {
  return promise.then(
    () => ({ status: 200, body: {} }),
    (error: unknown) => ({ status: 0, body: { message: error instanceof Error ? error.message : String(error) } }),
  );
}

function assertOneEconomy(userId: string, spec: OutboxGame, keys: { earn: string; exchange: string; crown: string }): void {
  assert.equal(mints(userId, spec.relicId), 1);
  assert.equal(relicClaims(userId, spec.relicId), 1);
  assert.equal(earnLedgerCount(userId), 1);
  assert.equal(exchangeCount(userId), 1);
  assert.equal(ticketBalance(userId, spec.game), spec.ticketsLeft);
  assert.equal(verseBalance(userId), spec.verse);
  for (const key of [keys.earn, keys.exchange, keys.crown]) {
    assert.equal(
      num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}' AND key = '${key}'`),
      1,
      key,
    );
  }
}

function times(calls: string[], id: string): number {
  return calls.filter((item) => item === id).length;
}

async function makeKit(spec: OutboxGame = SPROTO_OUTBOX): Promise<LiveKit> {
  await import('fake-indexeddb/auto');
  await resetOutbox();
  const calls: string[] = [];
  const dropOnce = new Set<string>();
  const client = createNakamaClient({
    serverUrl: 'http://127.0.0.1:7350',
    fetchImpl: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const rpc = rpcOf(String(input));
      let key = '';
      if (typeof init?.body === 'string') {
        try {
          key = String((JSON.parse(init.body) as { key?: string }).key ?? '');
        } catch {
          key = '';
        }
      }
      const id = `${rpc}:${key}`;
      if (key) calls.push(id);
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
      if (key && dropOnce.has(id)) {
        dropOnce.delete(id);
        await response.arrayBuffer();
        throw new TypeError(`response lost ${id}`);
      }
      return response;
    },
  });
  const who = await guest();
  const opened = await call('portal.enter', { game: spec.game, ranked: false }, who.token);
  if (!opened.body.ticket) throw new Error(`portal.enter ${JSON.stringify(opened.body)}`);
  let hash = `#t=${opened.body.ticket}`;
  const session = memoryKeyValue();
  const env: HubSdkEnv = {
    serverUrl: 'http://127.0.0.1:7350',
    client,
    local: memoryKeyValue(),
    session,
    hubUrl: '/hub/',
    now: () => Date.now(),
    readHash: () => hash,
    writeHash: (next: string) => {
      hash = next;
    },
    assign: () => undefined,
    releasePointer: () => undefined,
    clearBeforeUnload: () => undefined,
  };
  const sdk = createHubSdk(env);
  const profile = await sdk.init(spec.game);
  if (!profile.playerId) throw new Error('init did not return a player');
  return { sdk, session, calls, dropOnce, client, playerId: profile.playerId, spec };
}

async function freshSdk(kit: LiveKit, session: KeyValue): Promise<HubSdk> {
  let hash = '';
  const env: HubSdkEnv = {
    serverUrl: 'http://127.0.0.1:7350',
    client: kit.client,
    local: memoryKeyValue(),
    session,
    hubUrl: '/hub/',
    now: () => Date.now(),
    readHash: () => hash,
    writeHash: (next: string) => {
      hash = next;
    },
    assign: () => undefined,
    releasePointer: () => undefined,
    clearBeforeUnload: () => undefined,
  };
  const sdk = createHubSdk(env);
  await sdk.init(kit.spec.game);
  return sdk;
}

async function loseAll(kit: LiveKit, keys: { earn: string; exchange: string; crown: string }): Promise<void> {
  const reason = kit.spec.game === 'hpos10i' ? 'level_end' : 'win';
  await lose(kit, 'tickets.earn', keys.earn, () => kit.sdk.earnTickets(kit.spec.earnAmount, reason, keys.earn));
  await lose(kit, 'tickets.exchange', keys.exchange, () => kit.sdk.exchange(kit.spec.exchangeTickets, keys.exchange));
  await lose(kit, 'session.event', keys.crown, () => kit.sdk.reportEvent(kit.spec.eventId, kit.spec.data, keys.crown));
}

async function reloadLost(kit: LiveKit, keys: { earn: string; exchange: string; crown: string }): Promise<void> {
  await loseAll(kit, keys);
  await freshSdk(kit, kit.session);
  assert.ok(times(kit.calls, `tickets.earn:${keys.earn}`) >= 2);
  assert.ok(times(kit.calls, `tickets.exchange:${keys.exchange}`) >= 2);
  assert.ok(times(kit.calls, `session.event:${keys.crown}`) >= 2);
  assertOneEconomy(kit.playerId, kit.spec, keys);
}

async function secondTab(kit: LiveKit, keys: { earn: string; exchange: string; crown: string }): Promise<void> {
  await loseAll(kit, keys);
  await freshSdk(kit, memoryKeyValue());
  assert.ok(times(kit.calls, `session.event:${keys.crown}`) >= 2);
  assert.ok(times(kit.calls, `tickets.earn:${keys.earn}`) >= 2);
  assert.ok(times(kit.calls, `tickets.exchange:${keys.exchange}`) >= 2);
  assertOneEconomy(kit.playerId, kit.spec, keys);
}

async function killOne(kit: LiveKit, point: string, effect: () => number, run: () => Promise<unknown>): Promise<void> {
  arm(kit.playerId, point, 'sleep');
  try {
    const during = await killDuringSleep(quiet(run()), kit.playerId, point, effect);
    assert.equal(during, 1, `${point} was not committed before the process died`);
  } finally {
    disarm(kit.playerId);
  }
}

async function killBetween(kit: LiveKit, keys: { earn: string; exchange: string; crown: string }): Promise<void> {
  const reason = kit.spec.game === 'hpos10i' ? 'level_end' : 'win';
  await killOne(kit, 'earn.after_commit', () => earnLedgerCount(kit.playerId), () => kit.sdk.earnTickets(kit.spec.earnAmount, reason, keys.earn));
  await killOne(
    kit,
    'exchange.after_commit',
    () => exchangeCount(kit.playerId),
    () => kit.sdk.exchange(kit.spec.exchangeTickets, keys.exchange),
  );
  await killOne(
    kit,
    'grant.after_commit',
    () => mints(kit.playerId, kit.spec.relicId),
    () => kit.sdk.reportEvent(kit.spec.eventId, kit.spec.data, keys.crown),
  );
  await freshSdk(kit, kit.session);
  assert.ok(times(kit.calls, `tickets.earn:${keys.earn}`) >= 2);
  assert.ok(times(kit.calls, `tickets.exchange:${keys.exchange}`) >= 2);
  assert.ok(times(kit.calls, `session.event:${keys.crown}`) >= 2);
  assertOneEconomy(kit.playerId, kit.spec, keys);
}

function keysFor(prefix: string): { earn: string; exchange: string; crown: string } {
  return { earn: `${prefix}-earn`, exchange: `${prefix}-exchange`, crown: `${prefix}-crown` };
}

async function runOutbox(runner: GateRunner): Promise<void> {
  const reason = "waiting for HUB_OUTBOX_DB = 'hub-outbox' exported from @metaverse/hub-sdk and indexedDB in packages/hub-sdk/src/live.ts";
  if (!outboxLanded()) {
    for (const name of OUTBOX_CASES) runner.pending('outbox', name, reason);
    return;
  }
  const sdk = await import('../../../packages/hub-sdk/src/index.ts');
  const dbName = (sdk as { HUB_OUTBOX_DB?: string }).HUB_OUTBOX_DB;
  assert.equal(dbName, OUTBOX_DB);
  assert.equal(OUTBOX_STORE, 'writes');
  for (const spec of [SPROTO_OUTBOX, HPOS_OUTBOX]) {
    await runner.test('outbox', `${spec.game} reload_lost_response`, async () => {
      const kit = await makeKit(spec);
      await reloadLost(kit, keysFor(`${spec.game}-reload`));
    });
    await runner.test('outbox', `${spec.game} second_tab_drains`, async () => {
      const kit = await makeKit(spec);
      await secondTab(kit, keysFor(`${spec.game}-tab`));
    });
    await runner.test('outbox', `${spec.game} kill_between_send_and_ack`, async () => {
      const kit = await makeKit(spec);
      await killBetween(kit, keysFor(`${spec.game}-kill`));
    });
  }
}

const SEQ_EVENTS = [
  { game: 'sproto' as const, eventId: 'sproto.boss_defeated', data: { boss: 'tinubu', elapsed: 12 }, relicId: 'tinubu_crown' },
  {
    game: 'hpos10i' as const,
    eventId: 'hpos10i.level_complete',
    data: { zone: 'z1_retro_rush_hills', act: 1, time: 40.125 },
    relicId: 'hpos10i_core',
  },
];

async function runSeq(runner: GateRunner): Promise<void> {
  const reason = 'waiting for table game.event_rule (session.event seq: seq_duplicate and seq_stale)';
  if (!eventRuleLanded()) {
    for (const name of SEQ_CASES) runner.pending('seq', name, reason);
    return;
  }
  for (const event of SEQ_EVENTS) {
    const label = event.game;
    await runner.test('seq', `${label} duplicate_seq_rejected`, async () => {
      const session = await login(event.game);
      const body = { eventId: event.eventId, data: event.data };
      const first = await call('session.event', { ...body, key: 'seq-1', seq: 1 }, session.gameToken);
      assert.equal(first.body.granted, event.relicId, JSON.stringify(first.body));
      const again = await call('session.event', { ...body, key: 'seq-1b', seq: 1 }, session.gameToken);
      assert.equal(again.body.error, 'seq_duplicate', JSON.stringify(again.body));
      assert.equal(again.body.granted, undefined);
      const replay = await call('session.event', { ...body, key: 'seq-1', seq: 1 }, session.gameToken);
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
      assert.equal(replay.body.granted, event.relicId);
      assert.equal(mints(session.hub.userId, event.relicId), 1);
      assert.equal(verseBalance(session.hub.userId), 0);
      assert.equal(ticketBalance(session.hub.userId, event.game), 0);
    });
    await runner.test('seq', `${label} stale_seq_rejected`, async () => {
      const session = await login(event.game);
      const body = { eventId: event.eventId, data: event.data };
      const first = await call('session.event', { ...body, key: 'seq-ok', seq: 1 }, session.gameToken);
      assert.equal(first.body.granted, event.relicId, JSON.stringify(first.body));
      const stale = await call('session.event', { ...body, key: 'seq-old', seq: 0 }, session.gameToken);
      assert.equal(stale.body.error, 'seq_stale', JSON.stringify(stale.body));
      assert.equal(stale.body.granted, undefined);
      assert.equal(mints(session.hub.userId, event.relicId), 1);
      assert.equal(verseBalance(session.hub.userId), 0);
      assert.equal(ticketBalance(session.hub.userId, event.game), 0);
    });
    await runner.test('seq', `${label} concurrent_duplicate_seq_one_mint`, async () => {
      const session = await login(event.game);
      const body = { eventId: event.eventId, data: event.data };
      const [a, b] = await Promise.all([
        call('session.event', { ...body, key: 'seq-race-a', seq: 1 }, session.gameToken),
        call('session.event', { ...body, key: 'seq-race-b', seq: 1 }, session.gameToken),
      ]);
      const granted = [a, b].filter((item) => item.body.granted === event.relicId && !item.body.error);
      const rejected = [a, b].filter((item) => item.body.error === 'seq_duplicate');
      assert.equal(granted.length, 1, JSON.stringify([a.body, b.body]));
      assert.equal(rejected.length, 1, JSON.stringify([a.body, b.body]));
      assert.equal(mints(session.hub.userId, event.relicId), 1);
      assert.equal(relicClaims(session.hub.userId, event.relicId), 1);
    });
  }
}

function sessionCap(): number {
  return num('SELECT game.session_ticket_cap()');
}

async function runSessionCap(runner: GateRunner): Promise<void> {
  const reason = 'waiting for function game.session_ticket_cap() and error session_ticket_cap';
  if (!sessionCapLanded()) {
    for (const name of CAP_CASES) runner.pending('session-cap', name, reason);
    return;
  }
  const games = [
    { game: 'sproto' as const, reason: 'win' },
    { game: 'hpos10i' as const, reason: 'level_end' },
  ];
  for (const item of games) {
    await runner.test('session-cap', `${item.game} over_cap_rejected_under_daily`, async () => {
      const cap = sessionCap();
      assert.ok(cap > 0 && cap < TICKET_DAILY_CAP, `session cap ${cap} must sit strictly under the daily cap ${TICKET_DAILY_CAP}`);
      const session = await login(item.game);
      const filled = await call('tickets.earn', { amount: cap, reason: item.reason, key: 'cap-fill' }, session.gameToken);
      assert.equal(filled.body.error, undefined, JSON.stringify(filled.body));
      assert.equal(filled.body.balance, cap);
      const over = await call('tickets.earn', { amount: 1, reason: item.reason, key: 'cap-over' }, session.gameToken);
      assert.equal(over.body.error, 'session_ticket_cap', JSON.stringify(over.body));
      assert.equal(ticketBalance(session.hub.userId, item.game), cap);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
    });
    await runner.test('session-cap', `${item.game} retries_do_not_credit`, async () => {
      const cap = sessionCap();
      const session = await login(item.game);
      const filled = await call('tickets.earn', { amount: cap, reason: item.reason, key: 'cap-fill' }, session.gameToken);
      assert.equal(filled.body.error, undefined, JSON.stringify(filled.body));
      for (let i = 0; i < 5; i += 1) {
        const replay = await call('tickets.earn', { amount: cap, reason: item.reason, key: 'cap-fill' }, session.gameToken);
        assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
        assert.equal(replay.body.balance, cap);
      }
      for (let i = 0; i < 5; i += 1) {
        const over = await call('tickets.earn', { amount: 1, reason: item.reason, key: 'cap-over' }, session.gameToken);
        assert.equal(over.body.error, 'session_ticket_cap', JSON.stringify(over.body));
      }
      assert.equal(ticketBalance(session.hub.userId, item.game), cap);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
    });
    await runner.test('session-cap', `${item.game} concurrent_cannot_exceed`, async () => {
      const cap = sessionCap();
      const session = await login(item.game);
      const width = 20;
      const results = await Promise.all(Array.from({ length: width }, (_, index) => (
        call('tickets.earn', { amount: cap, reason: item.reason, key: `cap-race-${index}` }, session.gameToken)
      )));
      assert.equal(ticketBalance(session.hub.userId, item.game), cap);
      assert.equal(earnLedgerCount(session.hub.userId) >= 1, true);
      const winners = results.filter((row) => !row.body.error);
      const losers = results.filter((row) => row.body.error === 'session_ticket_cap');
      assert.ok(winners.length >= 1, JSON.stringify(results.map((row) => row.body)));
      assert.equal(winners.length + losers.length, width, JSON.stringify(results.map((row) => row.body)));
      await call('tickets.earn', { amount: cap, reason: item.reason, key: 'cap-race-0' }, session.gameToken);
      assert.equal(ticketBalance(session.hub.userId, item.game), cap);
    });
    await runner.test('session-cap', `${item.game} second_session_same_day`, async () => {
      const cap = sessionCap();
      assert.ok(cap * 2 <= TICKET_DAILY_CAP, `2 * session cap (${cap}) must fit under the daily cap so a second session is still under the daily limit`);
      const session = await login(item.game);
      const first = await call('tickets.earn', { amount: cap, reason: item.reason, key: 'day-a' }, session.gameToken);
      assert.equal(first.body.error, undefined, JSON.stringify(first.body));
      const next = await openGame(session.hub.token, item.game);
      const second = await call('tickets.earn', { amount: cap, reason: item.reason, key: 'day-b' }, next.gameToken);
      assert.equal(second.body.error, undefined, JSON.stringify(second.body));
      assert.equal(ticketBalance(session.hub.userId, item.game), cap * 2);
    });
  }
}

async function runMockClock(runner: GateRunner): Promise<void> {
  const reason = 'waiting for HubSdkEnv.serverNow in packages/hub-sdk/src/env.ts and createHubSdk.ts (mock daily buckets)';
  if (!mockServerClockLanded()) {
    runner.pending('mock-clock', 'daily_bucket_uses_server_now', reason);
    return;
  }
  await runner.test('mock-clock', 'daily_bucket_uses_server_now', async () => {
    let clientMs = Date.parse('1999-01-01T00:00:00Z');
    let serverMs = Date.parse('2026-06-15T12:00:00Z');
    const local = memoryKeyValue();
    const session = memoryKeyValue();
    const ticket = await mintMockTicket({
      game: 'sproto',
      playerId: 'clock-player',
      now: serverMs,
      ttlSeconds: 86400,
    });
    let hash = `#t=${ticket}`;
    const env = {
      useMock: true,
      local,
      session,
      hubUrl: '/hub/',
      now: () => clientMs,
      serverNow: () => serverMs,
      readHash: () => hash,
      writeHash: (next: string) => {
        hash = next;
      },
      assign: () => undefined,
      releasePointer: () => undefined,
      clearBeforeUnload: () => undefined,
    } as HubSdkEnv;
    const sdk = createHubSdk(env);
    await sdk.init('sproto');
    await sdk.earnTickets(10, 'win', 'clock-earn-1');
    assert.equal(local.getItem('hub:earn:sproto:2026-06-15'), '10');
    assert.equal(local.getItem('hub:earn:sproto:1999-01-01'), null);
    clientMs = Date.parse('2001-05-05T00:00:00Z');
    await sdk.earnTickets(5, 'win', 'clock-earn-2');
    assert.equal(local.getItem('hub:earn:sproto:2026-06-15'), '15');
    assert.equal(local.getItem('hub:earn:sproto:2001-05-05'), null);
    await sdk.exchange(10, 'clock-ex-1');
    assert.equal(local.getItem('hub:verseDay:sproto:2026-06-15'), '1');
    assert.equal(local.getItem('hub:verseDay:sproto:2001-05-05'), null);
    serverMs = Date.parse('2026-06-16T12:00:00Z');
    await sdk.earnTickets(4, 'win', 'clock-earn-3');
    assert.equal(local.getItem('hub:earn:sproto:2026-06-16'), '4');
    assert.equal(local.getItem('hub:earn:sproto:2026-06-15'), '15');
    assert.equal(local.getItem('hub:earn:sproto:1999-01-01'), null);
    assert.equal(local.getItem('hub:earn:sproto:2001-05-05'), null);
  });
}

export async function runGated(runner: GateRunner): Promise<void> {
  await runOutbox(runner);
  await runSeq(runner);
  await runSessionCap(runner);
  await runMockClock(runner);
}
