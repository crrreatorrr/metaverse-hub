/**
 * Same-tab portal duplication. PR #22 opens a game in this tab:
 * `portal.enter` issues `#t=<ticket>`, the game redeems it, and `exit`
 * returns to `/hub/#from=<id>`.
 *
 * Fixtures stay inside the event_rule limits: sproto `win` / `duel_win` is 20,
 * hpos10i `level_end` is at most 200, the session cap is 200, and a UTC day is
 * 1000 Tickets and 50 Verse. Every accepted earn is credited in full.
 * `audit.sql` runs from the suite wrapper after each case.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalGameId, type GameId } from '../../../packages/hub-sdk/src/types.ts';
import {
  createHubSdk,
  createNakamaClient,
  HubSdkError,
  memoryKeyValue,
  type HubSdk,
  type HubSdkEnv,
  type KeyValue,
  type NakamaClient,
} from '../../../packages/hub-sdk/src/index.ts';
import { TICKET_DAILY_CAP, VERSE_DAILY_CAP } from './cases.ts';
import {
  call,
  ensureNakama,
  exchangeCount,
  guest,
  mints,
  num,
  outboxSend,
  psql,
  redeemPortalTicket,
  sqlId,
  ticketBalance,
  verseBalance,
  type RpcResult,
} from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SESSION_CAP = 200;
const SPROTO_WIN = 20;
const HPOS_LEVEL_END = 200;
const TERMINAL = new Set(['ticket_used', 'ticket_expired', 'ticket_invalid', 'ticket_game', 'unauthenticated', 'auth_failed']);

/** Same parser as `apps/hub/src/travel.ts`. Kept here so the suite does not load the hub bundle. */
function parseReturnGame(hash: string): GameId | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const from = new URLSearchParams(raw).get('from');
  if (!from) return null;
  return canonicalGameId(from);
}

function assertReturnParserMatchesHub(): void {
  const source = readFileSync(path.join(ROOT, 'apps/hub/src/travel.ts'), 'utf8');
  const start = source.indexOf('export function parseReturnGame');
  assert.ok(start >= 0, 'apps/hub/src/travel.ts no longer exports parseReturnGame');
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  assert.match(body, /URLSearchParams/);
  assert.match(body, /canonicalGameId\(from\)/);
  assert.match(body, /\.get\('from'\)/);
}

type Game = 'sproto' | 'hpos10i';

interface GameSpec {
  game: Game;
  reason: 'win' | 'level_end';
  /** One accepted earn. Fills the session cap without a partial credit. */
  chunk: number;
  relicId: 'tinubu_crown' | 'hpos10i_core';
  eventId: string;
  data: Record<string, unknown>;
}

const GAMES: readonly GameSpec[] = [
  {
    game: 'sproto',
    reason: 'win',
    chunk: SPROTO_WIN,
    relicId: 'tinubu_crown',
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12 },
  },
  {
    game: 'hpos10i',
    reason: 'level_end',
    chunk: HPOS_LEVEL_END,
    relicId: 'hpos10i_core',
    eventId: 'hpos10i.level_complete',
    data: { zone: 'z1_retro_rush_hills', act: 1, time: 40.125 },
  },
];

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

function gameId(game: string): string {
  if (game !== 'sproto' && game !== 'hpos10i' && game !== 'nobu' && game !== 'peoples-bitcoin') {
    throw new Error(`bad game ${game}`);
  }
  return game;
}

function assertLimits(): void {
  assert.equal(SESSION_CAP, 200);
  assert.equal(TICKET_DAILY_CAP, 1000);
  assert.equal(VERSE_DAILY_CAP, 50);
  assert.ok(SPROTO_WIN <= 20);
  assert.ok(HPOS_LEVEL_END <= 200);
  assert.equal(SESSION_CAP % SPROTO_WIN, 0);
  assert.equal(HPOS_LEVEL_END, SESSION_CAP);
  assert.equal(num('SELECT game.session_ticket_cap()'), SESSION_CAP);
}

function ticketLedger(userId: string, game: Game): number {
  return num(
    `SELECT COALESCE(SUM(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}'`,
  );
}

function positiveEarns(userId: string, game: Game): number {
  return num(
    `SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}' AND delta > 0`,
  );
}

function earnSessions(userId: string, game: Game): number {
  return num(
    `SELECT count(DISTINCT ref_id) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}' AND delta > 0`,
  );
}

function verseLedger(userId: string): number {
  return num(`SELECT COALESCE(SUM(delta), 0) FROM game.verse_ledger WHERE user_id = '${sqlId(userId)}'`);
}

function duplicateKeys(userId: string): number {
  return num(
    `SELECT count(*) FROM (
       SELECT key FROM game.idempotency WHERE user_id = '${sqlId(userId)}' GROUP BY key HAVING count(*) > 1
     ) d`,
  );
}

function sessions(userId: string, game: Game): number {
  return num(
    `SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}'`,
  );
}

function redeemedSessions(userId: string, game: Game): number {
  return num(
    `SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}' AND game_id = '${gameId(game)}' AND ticket_redeemed_at IS NOT NULL`,
  );
}

/** Ledger total equals the credit we expect, and no idempotency key is stored twice. */
function assertCredit(userId: string, game: Game, tickets: number, verse = 0): void {
  assert.equal(ticketBalance(userId, game), tickets, `${game} ticket balance`);
  assert.equal(ticketLedger(userId, game), tickets, `${game} ticket ledger`);
  assert.equal(verseBalance(userId), verse, 'verse balance');
  assert.equal(verseLedger(userId), verse, 'verse ledger');
  assert.equal(duplicateKeys(userId), 0, 'duplicate idempotency keys');
}

function books(userId: string): string {
  return [
    `tickets=${num(`SELECT COALESCE(SUM(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`)}`,
    `items=${num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}'`)}`,
    `verse=${verseLedger(userId)}`,
    `exchanges=${exchangeCount(userId)}`,
    `keys=${num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}'`)}`,
  ].join(' ');
}

async function enter(hubToken: string, game: Game): Promise<{ ticket: string; sessionId: string }> {
  const opened = await call('portal.enter', { game, ranked: false }, hubToken);
  if (opened.body.error || !opened.body.ticket || !opened.body.sessionId) {
    throw new Error(`portal.enter ${opened.status} ${JSON.stringify(opened.body)}`);
  }
  return { ticket: opened.body.ticket, sessionId: opened.body.sessionId };
}

async function redeem(ticket: string, game: Game): Promise<RpcResult> {
  const result = await redeemPortalTicket(ticket, game);
  if (result.token) {
    const part = result.token.split('.')[1] ?? '';
    let sid: string | undefined;
    try {
      const json = JSON.parse(Buffer.from(part, 'base64url').toString()) as { vrs?: { sid?: string } };
      sid = json.vrs?.sid;
    } catch {
      sid = undefined;
    }
    return { status: result.status, body: { token: result.token, sid } };
  }
  return { status: result.status, body: { error: 'unauthenticated', message: result.body.slice(0, 300) } };
}

function tokenOf(result: RpcResult): string {
  if (!result.body.token || result.body.error) {
    throw new Error(`expected a game session, got ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body.token;
}

async function returnToHub(gameToken: string, hubToken: string): Promise<void> {
  const closed = await call('session.close', {}, gameToken);
  assert.equal(closed.body.error, undefined, JSON.stringify(closed.body));
  assert.equal(closed.body.ok, true, JSON.stringify(closed.body));
  const profile = await call('profile.get', {}, hubToken);
  assert.equal(profile.body.error, undefined, JSON.stringify(profile.body));
  const board = await call('verse.board', {}, hubToken);
  assert.equal(board.body.error, undefined, JSON.stringify(board.body));
}

async function fillSession(spec: GameSpec, token: string, prefix: string): Promise<void> {
  const steps = SESSION_CAP / spec.chunk;
  for (let i = 0; i < steps; i += 1) {
    const got = await call('tickets.earn', {
      amount: spec.chunk,
      reason: spec.reason,
      key: `${prefix}-fill-${i}`,
    }, token);
    assert.equal(got.body.error, undefined, JSON.stringify(got.body));
    assert.equal(got.body.capped, false, `partial credit on ${spec.game} fill ${i}: ${JSON.stringify(got.body)}`);
    assert.equal(got.body.balance, spec.chunk * (i + 1), JSON.stringify(got.body));
  }
}

/**
 * A second redeem must not hand out a new session. After the only session is
 * at its cap, every token from those redeems rejects another full earn.
 */
async function assertNoFreshCap(spec: GameSpec, userId: string, tokens: string[], prefix: string): Promise<void> {
  assert.equal(sessions(userId, spec.game), 1, `${spec.game} session rows`);
  assert.equal(redeemedSessions(userId, spec.game), 1, `${spec.game} redeemed sessions`);
  const first = tokens[0];
  if (!first) throw new Error('redeem produced no session');
  await fillSession(spec, first, prefix);
  assert.equal(positiveEarns(userId, spec.game), SESSION_CAP / spec.chunk);
  assert.equal(earnSessions(userId, spec.game), 1, `${spec.game} credited more than one session`);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const over = await call('tickets.earn', {
      amount: spec.chunk,
      reason: spec.reason,
      key: `${prefix}-over-${index}`,
    }, token);
    assert.equal(over.body.error, 'session_ticket_cap', `fresh cap via ${spec.game} token ${index}: ${JSON.stringify(over.body)}`);
  }
  assertCredit(userId, spec.game, SESSION_CAP);
  assert.equal(earnSessions(userId, spec.game), 1);
}

function acceptedSid(result: RpcResult, sessionId: string): string | null {
  if (result.body.token && !result.body.error) {
    assert.equal(result.body.sid, sessionId, JSON.stringify(result.body));
    return result.body.token;
  }
  assert.ok(TERMINAL.has(String(result.body.error)), `non-terminal redeem: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.token, undefined, JSON.stringify(result.body));
  return null;
}

function rpcOf(url: string): string {
  const marker = '/v2/rpc/';
  const at = url.indexOf(marker);
  if (at < 0) return '';
  return decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
}

interface Page {
  hash: { value: string };
  assigned: string[];
  session: KeyValue;
  sdk: HubSdk;
  closes: Promise<unknown>[];
}

function browserClient(dropOnce: Set<string>, closes: Promise<unknown>[]): NakamaClient {
  return createNakamaClient({
    serverUrl: 'http://127.0.0.1:7350',
    serverKey: 'defaultkey',
    fetchImpl: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const rpc = rpcOf(url);
      let key = '';
      if (typeof init?.body === 'string') {
        try {
          key = String((JSON.parse(init.body) as { key?: string }).key ?? '');
        } catch {
          key = '';
        }
      }
      const response = fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
      if (rpc === 'session.close') closes.push(response.then(() => undefined, () => undefined));
      const resolved = await response;
      if (key && dropOnce.has(`${rpc}:${key}`)) {
        dropOnce.delete(`${rpc}:${key}`);
        await resolved.arrayBuffer();
        throw new TypeError(`response lost ${rpc}:${key}`);
      }
      return resolved;
    },
  });
}

function openPage(hash: string, session: KeyValue, client: NakamaClient, closes: Promise<unknown>[]): Page {
  const holder = { value: hash };
  const assigned: string[] = [];
  const env: HubSdkEnv = {
    serverUrl: 'http://127.0.0.1:7350',
    client,
    local: memoryKeyValue(),
    session,
    hubUrl: '/hub/',
    now: () => Date.now(),
    readHash: () => holder.value,
    writeHash: (next) => {
      holder.value = next;
    },
    assign: (url) => {
      assigned.push(url);
    },
    releasePointer: () => undefined,
    clearBeforeUnload: () => undefined,
  };
  return { hash: holder, assigned, session, sdk: createHubSdk(env), closes };
}

async function resetOutbox(): Promise<void> {
  await import('fake-indexeddb/auto');
  const idb = indexedDB;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('indexedDB deleteDatabase timed out')), 5_000);
    const req = idb.deleteDatabase('hub-outbox');
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onsuccess = finish;
    req.onerror = finish;
    req.onblocked = finish;
  });
}

async function outboxHas(key: string): Promise<boolean> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('hub-outbox', 1);
    request.onupgradeneeded = () => {
      const created = request.result;
      if (!created.objectStoreNames.contains('writes')) created.createObjectStore('writes', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
  try {
    const row = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('writes', 'readonly');
      const request = tx.objectStore('writes').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB get failed'));
    });
    return row != null;
  } finally {
    db.close();
  }
}

function readCached(session: KeyValue, game: Game): { sid: string; token: string } | null {
  const raw = session.getItem(`hub:${game}:session`);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { sid?: string; token?: string };
  if (!parsed.sid || !parsed.token) return null;
  return { sid: parsed.sid, token: parsed.token };
}

function terminalCode(error: unknown): string | null {
  if (error instanceof HubSdkError && TERMINAL.has(error.code)) return error.code;
  return null;
}

async function portalAndReturnDoNotCredit(test: TestFn): Promise<void> {
  await test('same-tab', 'portal.enter writes no ledger', async () => {
    assertLimits();
    const who = await guest();
    const before = books(who.userId);
    assert.equal(before, 'tickets=0 items=0 verse=0 exchanges=0 keys=0', before);
    await enter(who.token, 'sproto');
    await enter(who.token, 'sproto');
    await Promise.all([
      enter(who.token, 'hpos10i'),
      enter(who.token, 'hpos10i'),
      enter(who.token, 'sproto'),
      enter(who.token, 'sproto'),
    ]);
    assert.equal(books(who.userId), before, 'portal.enter credited this player');
    assertCredit(who.userId, 'sproto', 0);
    assertCredit(who.userId, 'hpos10i', 0);
    assert.equal(mints(who.userId, 'tinubu_crown'), 0);
    assert.equal(mints(who.userId, 'hpos10i_core'), 0);
  });

  await test('same-tab', 'return writes no ledger', async () => {
    assertLimits();
    const who = await guest();
    const opened = await enter(who.token, 'sproto');
    const session = tokenOf(await redeem(opened.ticket, 'sproto'));
    const before = books(who.userId);
    const [closedA, closedB] = await Promise.all([
      call('session.close', {}, session),
      call('session.close', {}, session),
    ]);
    assert.equal(closedA.body.error, undefined, JSON.stringify(closedA.body));
    assert.equal(closedB.body.error, undefined, JSON.stringify(closedB.body));
    await Promise.all([
      call('profile.get', {}, who.token),
      call('profile.get', {}, who.token),
      call('verse.board', {}, who.token),
    ]);
    await returnToHub(session, who.token);
    assert.equal(books(who.userId), before, 'return path credited this player');
    assertCredit(who.userId, 'sproto', 0);
    assert.equal(mints(who.userId, 'tinubu_crown'), 0);
  });
}

async function ticketReuse(test: TestFn): Promise<void> {
  await test('same-tab', 'ticket reuse sequential is one session', async () => {
    assertLimits();
    for (const spec of GAMES) {
      const who = await guest();
      const opened = await enter(who.token, spec.game);
      const first = await redeem(opened.ticket, spec.game);
      const tokens = [tokenOf(first)];
      assert.equal(first.body.sid, opened.sessionId, JSON.stringify(first.body));
      for (let i = 0; i < 4; i += 1) {
        const again = await redeem(opened.ticket, spec.game);
        const token = acceptedSid(again, opened.sessionId);
        if (token) tokens.push(token);
      }
      await assertNoFreshCap(spec, who.userId, tokens, `seq-${spec.game}`);
      const replay = await outboxSend('tickets.earn', {
        amount: spec.chunk,
        reason: spec.reason,
        key: `seq-${spec.game}-fill-0`,
      }, tokens[0] ?? tokenOf(first));
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
      assert.equal(replay.body.balance, spec.chunk, JSON.stringify(replay.body));
      assertCredit(who.userId, spec.game, SESSION_CAP);
      assert.equal(mints(who.userId, spec.relicId), 0);
    }
  });

  await test('same-tab', 'ticket reuse concurrent is one session', async () => {
    assertLimits();
    for (const spec of GAMES) {
      const who = await guest();
      const opened = await enter(who.token, spec.game);
      const results = await Promise.all([
        redeem(opened.ticket, spec.game),
        redeem(opened.ticket, spec.game),
      ]);
      const tokens: string[] = [];
      for (const result of results) {
        const token = acceptedSid(result, opened.sessionId);
        if (token) tokens.push(token);
      }
      assert.ok(tokens.length >= 1, JSON.stringify(results.map((item) => item.body)));
      const sids = new Set(results.filter((item) => item.body.sid).map((item) => item.body.sid));
      assert.ok(sids.size <= 1, JSON.stringify(results.map((item) => item.body)));
      await assertNoFreshCap(spec, who.userId, tokens, `race-${spec.game}`);
    }
  });
}

async function reenter(test: TestFn): Promise<void> {
  await test('same-tab', 'reenter keeps earn keys and both caps', async () => {
    assertLimits();
    const who = await guest();
    const first = await enter(who.token, 'sproto');
    const firstToken = tokenOf(await redeem(first.ticket, 'sproto'));
    const win = await call('tickets.earn', { amount: SPROTO_WIN, reason: 'win', key: 'visit-win' }, firstToken);
    assert.equal(win.body.error, undefined, JSON.stringify(win.body));
    assert.equal(win.body.capped, false, JSON.stringify(win.body));
    assert.equal(win.body.balance, SPROTO_WIN);
    const duel = await call('tickets.earn', { amount: SPROTO_WIN, reason: 'duel_win', key: 'visit-duel' }, firstToken);
    assert.equal(duel.body.error, undefined, JSON.stringify(duel.body));
    assert.equal(duel.body.capped, false, JSON.stringify(duel.body));
    assert.equal(duel.body.balance, SPROTO_WIN * 2);
    const crown = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: 'visit-crown',
    }, firstToken);
    assert.equal(crown.body.granted, 'tinubu_crown', JSON.stringify(crown.body));
    await returnToHub(firstToken, who.token);

    const second = await enter(who.token, 'sproto');
    const secondToken = tokenOf(await redeem(second.ticket, 'sproto'));
    assert.notEqual(second.sessionId, first.sessionId);
    for (const key of ['visit-win', 'visit-duel']) {
      const reason = key === 'visit-duel' ? 'duel_win' : 'win';
      const replay = await call('tickets.earn', { amount: SPROTO_WIN, reason, key }, secondToken);
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
    }
    const crownReplay = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: 'visit-crown',
    }, secondToken);
    assert.equal(crownReplay.body.granted, 'tinubu_crown', JSON.stringify(crownReplay.body));
    assert.equal(positiveEarns(who.userId, 'sproto'), 2);
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    const again = await call('tickets.earn', { amount: SPROTO_WIN, reason: 'win', key: 'visit-2-win' }, secondToken);
    assert.equal(again.body.error, undefined, JSON.stringify(again.body));
    assert.equal(again.body.capped, false, JSON.stringify(again.body));
    assert.equal(again.body.balance, SPROTO_WIN * 3);
    const secondCrown = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: 'visit-2-crown',
    }, secondToken);
    assert.equal(secondCrown.body.granted, undefined, JSON.stringify(secondCrown.body));
    assertCredit(who.userId, 'sproto', SPROTO_WIN * 3);
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    assert.equal(earnSessions(who.userId, 'sproto'), 2);

    const capped = await guest();
    let expected = 0;
    let previous = '';
    for (let visit = 1; visit <= 5; visit += 1) {
      const opened = await enter(capped.token, 'hpos10i');
      const token = tokenOf(await redeem(opened.ticket, 'hpos10i'));
      if (visit === 2) {
        const replay = await call('tickets.earn', {
          amount: HPOS_LEVEL_END,
          reason: 'level_end',
          key: 'visit-1',
        }, token);
        assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
        assert.equal(ticketLedger(capped.userId, 'hpos10i'), HPOS_LEVEL_END);
        assert.equal(positiveEarns(capped.userId, 'hpos10i'), 1);
      }
      const got = await call('tickets.earn', {
        amount: HPOS_LEVEL_END,
        reason: 'level_end',
        key: `visit-${visit}`,
      }, token);
      assert.equal(got.body.error, undefined, JSON.stringify(got.body));
      assert.equal(got.body.capped, false, `partial level_end on visit ${visit}: ${JSON.stringify(got.body)}`);
      expected += HPOS_LEVEL_END;
      assert.equal(got.body.balance, expected, JSON.stringify(got.body));
      if (visit === 2) {
        const over = await call('tickets.earn', {
          amount: SPROTO_WIN,
          reason: 'level_end',
          key: 'visit-2-over',
        }, token);
        assert.equal(over.body.error, 'session_ticket_cap', JSON.stringify(over.body));
        assert.equal(ticketLedger(capped.userId, 'hpos10i'), expected);
      }
      previous = token;
      await returnToHub(token, capped.token);
      assert.equal(ticketLedger(capped.userId, 'hpos10i'), expected);
    }
    assert.equal(expected, TICKET_DAILY_CAP);
    assert.notEqual(previous, '');
    const sixth = await enter(capped.token, 'hpos10i');
    const sixthToken = tokenOf(await redeem(sixth.ticket, 'hpos10i'));
    const extra = await call('tickets.earn', {
      amount: HPOS_LEVEL_END,
      reason: 'level_end',
      key: 'visit-6',
    }, sixthToken);
    assert.ok(
      extra.body.error || extra.body.capped === true,
      `sixth session credited a full level_end: ${JSON.stringify(extra.body)}`,
    );
    assert.equal(positiveEarns(capped.userId, 'hpos10i'), 5);
    assert.equal(earnSessions(capped.userId, 'hpos10i'), 5);
    assertCredit(capped.userId, 'hpos10i', TICKET_DAILY_CAP);
    assert.equal(mints(capped.userId, 'hpos10i_core'), 0);
  });
}

async function reload(test: TestFn): Promise<void> {
  await test('same-tab', 'reload with #t= does not open a second session', async () => {
    assertLimits();
    await resetOutbox();
    for (const spec of GAMES) {
      const who = await guest();
      const opened = await enter(who.token, spec.game);
      const dropOnce = new Set<string>();
      const closes: Promise<unknown>[] = [];
      const client = browserClient(dropOnce, closes);
      const session = memoryKeyValue();
      const page = openPage(`#t=${opened.ticket}`, session, client, closes);
      await page.sdk.init(spec.game);
      assert.equal(page.hash.value.includes('t='), false);
      const cached = readCached(session, spec.game);
      assert.ok(cached);
      assert.equal(cached.sid, opened.sessionId);
      const earnKey = `reload-earn-${spec.game}`;
      dropOnce.add(`tickets.earn:${earnKey}`);
      await assert.rejects(() => page.sdk.earnTickets(spec.chunk, spec.reason, earnKey));
      assert.equal(await outboxHas(earnKey), true, `${earnKey} left the outbox before it was acked`);
      assert.equal(positiveEarns(who.userId, spec.game), 1);
      page.hash.value = `#t=${opened.ticket}`;
      const again = openPage(page.hash.value, session, client, closes);
      let redeemedAgain = false;
      try {
        await again.sdk.init(spec.game);
        redeemedAgain = true;
        const next = readCached(session, spec.game);
        assert.equal(next?.sid, opened.sessionId, 'reload minted a new session id');
      } catch (error) {
        assert.ok(terminalCode(error), error instanceof Error ? error.message : String(error));
      }
      assert.equal(sessions(who.userId, spec.game), 1, `${spec.game} reload created a session`);
      assert.equal(redeemedSessions(who.userId, spec.game), 1);
      if (!redeemedAgain || await outboxHas(earnKey)) {
        again.hash.value = '';
        const drained = openPage('', session, client, closes);
        await drained.sdk.init(spec.game);
      }
      assert.equal(await outboxHas(earnKey), false, `${earnKey} was not acked by the reload drain`);
      const replay = await outboxSend('tickets.earn', {
        amount: spec.chunk,
        reason: spec.reason,
        key: earnKey,
      }, cached.token);
      assert.equal(replay.body.balance, spec.chunk, JSON.stringify(replay.body));
      assert.equal(positiveEarns(who.userId, spec.game), 1);
      assertCredit(who.userId, spec.game, spec.chunk);
      if (spec.chunk === SESSION_CAP) {
        const over = await call('tickets.earn', {
          amount: spec.chunk,
          reason: spec.reason,
          key: `reload-over-${spec.game}`,
        }, cached.token);
        assert.equal(over.body.error, 'session_ticket_cap', `reload minted a fresh cap: ${JSON.stringify(over.body)}`);
        assertCredit(who.userId, spec.game, spec.chunk);
      }
      assert.equal(earnSessions(who.userId, spec.game), 1);
      assert.equal(duplicateKeys(who.userId), 0);
    }
  });
}

async function backButton(test: TestFn): Promise<void> {
  await test('same-tab', 'back button cannot redeem the old #t=', async () => {
    assertLimits();
    await resetOutbox();
    for (const spec of GAMES) {
      const who = await guest();
      const opened = await enter(who.token, spec.game);
      const closes: Promise<unknown>[] = [];
      const client = browserClient(new Set(), closes);
      const session = memoryKeyValue();
      const page = openPage(`#t=${opened.ticket}`, session, client, closes);
      await page.sdk.init(spec.game);
      const cached = readCached(session, spec.game);
      assert.ok(cached);
      await fillSession(spec, cached.token, `back-${spec.game}`);
      const granted = await call('session.event', {
        eventId: spec.eventId,
        data: spec.data,
        key: `back-relic-${spec.game}`,
      }, cached.token);
      assert.equal(granted.body.granted, spec.relicId, JSON.stringify(granted.body));
      page.sdk.exit('menu');
      await Promise.all(closes);
      assert.equal(page.assigned.at(-1), `/hub/#from=${spec.game}`);
      const state = psql(`SELECT state FROM game.game_session WHERE session_id = '${sqlId(opened.sessionId)}'`);
      assert.equal(state, 'closed');
      const returned = openPage(`#t=${opened.ticket}`, session, client, closes);
      try {
        await returned.sdk.init(spec.game);
        const next = readCached(session, spec.game);
        assert.equal(next?.sid, opened.sessionId, 'back button minted a new session');
      } catch (error) {
        assert.ok(terminalCode(error), error instanceof Error ? error.message : String(error));
      }
      assert.equal(sessions(who.userId, spec.game), 1);
      assert.equal(redeemedSessions(who.userId, spec.game), 1);
      const over = await call('tickets.earn', {
        amount: spec.chunk,
        reason: spec.reason,
        key: `back-over-${spec.game}`,
      }, cached.token);
      assert.ok(
        over.body.error === 'session_closed' || over.body.error === 'session_ticket_cap',
        `back button credited a new earn: ${JSON.stringify(over.body)}`,
      );
      const relicReplay = await call('session.event', {
        eventId: spec.eventId,
        data: spec.data,
        key: `back-relic-${spec.game}`,
      }, cached.token);
      const stored = relicReplay.body.granted === spec.relicId && !relicReplay.body.error;
      const rejected = relicReplay.body.error === 'session_closed';
      assert.ok(stored || rejected, JSON.stringify(relicReplay.body));
      const freshRelic = await call('session.event', {
        eventId: spec.eventId,
        data: spec.data,
        key: `back-relic-new-${spec.game}`,
      }, cached.token);
      assert.equal(freshRelic.body.granted, undefined, JSON.stringify(freshRelic.body));
      assert.equal(mints(who.userId, spec.relicId), 1);
      assertCredit(who.userId, spec.game, SESSION_CAP);
      assert.equal(earnSessions(who.userId, spec.game), 1);
    }
  });
}

async function fromHash(test: TestFn): Promise<void> {
  await test('same-tab', 'return #from twice or forged grants nothing', async () => {
    assertLimits();
    assertReturnParserMatchesHub();
    assert.equal(parseReturnGame('#from=sproto'), 'sproto');
    assert.equal(parseReturnGame('#from=sproto'), 'sproto');
    assert.equal(parseReturnGame('#from=hpos10i'), 'hpos10i');
    assert.equal(parseReturnGame('#from=sproto&t=leftover'), 'sproto');
    assert.equal(parseReturnGame('#from=not-a-game'), null);
    assert.equal(parseReturnGame('#from=tinubu_crown'), null);
    assert.equal(parseReturnGame('#from=../sproto'), null);
    assert.equal(parseReturnGame('#t=only-a-ticket'), null);
    assert.equal(parseReturnGame(''), null);

    const who = await guest();
    const opened = await enter(who.token, 'sproto');
    const token = tokenOf(await redeem(opened.ticket, 'sproto'));
    const earned = await call('tickets.earn', { amount: SPROTO_WIN, reason: 'win', key: 'from-earn' }, token);
    assert.equal(earned.body.capped, false, JSON.stringify(earned.body));
    assert.equal(earned.body.balance, SPROTO_WIN);
    const crown = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: 'from-crown',
    }, token);
    assert.equal(crown.body.granted, 'tinubu_crown', JSON.stringify(crown.body));
    const [checkA, checkB] = await Promise.all([
      call('session.event', {
        eventId: 'sproto.boss_defeated',
        data: { boss: 'tinubu', elapsed: 12 },
        key: 'from-crown-check-a',
      }, token),
      call('session.event', {
        eventId: 'sproto.boss_defeated',
        data: { boss: 'tinubu', elapsed: 12 },
        key: 'from-crown-check-b',
      }, token),
    ]);
    assert.equal(checkA.body.granted, undefined, JSON.stringify(checkA.body));
    assert.equal(checkB.body.granted, undefined, JSON.stringify(checkB.body));
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    const beforeReturn = books(who.userId);
    const beforeSessions = sessions(who.userId, 'sproto');
    await returnToHub(token, who.token);
    await returnToHub(token, who.token);
    const forgedEvent = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12, from: 'hpos10i' },
      key: 'forged-from-event',
    }, who.token);
    assert.equal(forgedEvent.body.error, 'not_game_session', JSON.stringify(forgedEvent.body));
    const forgedEarn = await call('tickets.earn', {
      amount: SPROTO_WIN,
      reason: 'win',
      key: 'forged-from-earn',
      from: 'hpos10i',
    }, who.token);
    assert.equal(forgedEarn.body.error, 'not_game_session', JSON.stringify(forgedEarn.body));
    const replay = await call('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: 'from-crown',
    }, token);
    const stored = replay.body.granted === 'tinubu_crown' && !replay.body.error;
    const rejected = replay.body.error === 'session_closed';
    assert.ok(stored || rejected, JSON.stringify(replay.body));
    assert.equal(books(who.userId), beforeReturn, 'return changed the ledger');
    assert.equal(sessions(who.userId, 'sproto'), beforeSessions, 'return opened a session');
    assert.equal(sessions(who.userId, 'hpos10i'), 0, 'forged #from=hpos10i opened HPOS10I');
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    assert.equal(mints(who.userId, 'hpos10i_core'), 0);
    assertCredit(who.userId, 'sproto', SPROTO_WIN);
  });
}

async function outboxAcrossVisits(test: TestFn): Promise<void> {
  await test('same-tab', 'outbox drain across enter return enter credits once', async () => {
    assertLimits();
    await resetOutbox();
    const who = await guest();
    const opened = await enter(who.token, 'sproto');
    const dropOnce = new Set<string>();
    const closes: Promise<unknown>[] = [];
    const client = browserClient(dropOnce, closes);
    const session = memoryKeyValue();
    const page = openPage(`#t=${opened.ticket}`, session, client, closes);
    await page.sdk.init('sproto');
    const cached = readCached(session, 'sproto');
    assert.ok(cached);
    const earnKey = 'tab-earn';
    const crownKey = 'tab-crown';
    const exchangeKey = 'tab-exchange';
    dropOnce.add(`tickets.earn:${earnKey}`);
    await assert.rejects(() => page.sdk.earnTickets(SPROTO_WIN, 'win', earnKey));
    dropOnce.add(`session.event:${crownKey}`);
    await assert.rejects(() => page.sdk.reportEvent('sproto.boss_defeated', { boss: 'tinubu', elapsed: 12 }, crownKey));
    dropOnce.add(`tickets.exchange:${exchangeKey}`);
    await assert.rejects(() => page.sdk.exchange(SPROTO_WIN, exchangeKey));
    assert.equal(await outboxHas(earnKey), true);
    assert.equal(await outboxHas(crownKey), true);
    assert.equal(await outboxHas(exchangeKey), true);
    assertCredit(who.userId, 'sproto', 0, 2);
    assert.equal(positiveEarns(who.userId, 'sproto'), 1);
    assert.equal(exchangeCount(who.userId), 1);
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    const beforeReturn = books(who.userId);
    page.sdk.exit('menu');
    await Promise.all(closes);
    assert.equal(page.assigned.at(-1), '/hub/#from=sproto');
    await call('profile.get', {}, who.token);
    await call('profile.get', {}, who.token);
    await call('verse.board', {}, who.token);
    assert.equal(books(who.userId), beforeReturn, 'return credited during the outbox drain');
    assert.equal(parseReturnGame('#from=not-a-game'), null);

    const next = await enter(who.token, 'sproto');
    const nextSession = memoryKeyValue();
    const nextPage = openPage(`#t=${next.ticket}`, nextSession, client, closes);
    await nextPage.sdk.init('sproto');
    assert.equal(await outboxHas(earnKey), false);
    assert.equal(await outboxHas(crownKey), false);
    assert.equal(await outboxHas(exchangeKey), false);
    assert.equal(readCached(nextSession, 'sproto')?.sid, next.sessionId);
    assert.notEqual(next.sessionId, opened.sessionId);
    assertCredit(who.userId, 'sproto', 0, 2);
    assert.equal(positiveEarns(who.userId, 'sproto'), 1);
    assert.equal(exchangeCount(who.userId), 1);
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    assert.equal(earnSessions(who.userId, 'sproto'), 1);
    const second = await nextPage.sdk.earnTickets(SPROTO_WIN, 'win', 'tab-earn-2');
    assert.equal(second.capped, false);
    assert.equal(second.balance, SPROTO_WIN);
    const drainedAgain = openPage('', nextSession, client, closes);
    await drainedAgain.sdk.init('sproto');
    await outboxSend('tickets.earn', { amount: SPROTO_WIN, reason: 'win', key: earnKey }, cached.token);
    await outboxSend('tickets.exchange', { tickets: SPROTO_WIN, key: exchangeKey }, cached.token);
    await outboxSend('session.event', {
      eventId: 'sproto.boss_defeated',
      data: { boss: 'tinubu', elapsed: 12 },
      key: crownKey,
    }, cached.token);
    assert.equal(positiveEarns(who.userId, 'sproto'), 2);
    assert.equal(exchangeCount(who.userId), 1);
    assert.equal(mints(who.userId, 'tinubu_crown'), 1);
    assert.equal(redeemedSessions(who.userId, 'sproto'), 2);
    assertCredit(who.userId, 'sproto', SPROTO_WIN, 2);
    assert.equal(duplicateKeys(who.userId), 0);
  });
}

export async function runSameTab(test: TestFn): Promise<void> {
  await ensureNakama();
  await portalAndReturnDoNotCredit(test);
  await ticketReuse(test);
  await reenter(test);
  await reload(test);
  await backButton(test);
  await fromHash(test);
  await outboxAcrossVisits(test);
}
