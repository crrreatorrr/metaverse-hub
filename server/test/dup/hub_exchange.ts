/**
 * Hub-scope exchange (migration 0060_hub_exchange, RPCs verse.exchange and tickets.balances;
 * gameplay plan B1). The plaza turns one game's Tickets into Verse without a game session.
 * It shares the economy:<user> lock, the verse:<game> bucket (50 Verse per game per UTC day)
 * and the idempotency table with the in-game tickets.exchange, so these cases replay it,
 * race it against the in-game RPC and forge its scope. audit.sql runs after every case.
 * The same rules run against a bare Postgres in server/test/pg/hub_exchange.test.ts.
 */
import assert from 'node:assert/strict';
import {
  call,
  earn,
  exchangeCount,
  login,
  num,
  openGame,
  psql,
  sleep,
  sqlId,
  ticketBalance,
  verseBalance,
  type GameLogin,
  type RpcResult,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

interface HubExchangeBody {
  error?: string;
  verse?: number;
  gained?: number;
  ticketsLeft?: number;
  receiptId?: string;
  verseCapLeft?: number;
}

interface BalancesBody {
  error?: string;
  wallets?: { game: string; balance: number; verseCapLeft: number }[];
  verse?: number;
}

const NOBU = 'nobu';
const SESSION_CAP = 200;

function body(result: RpcResult): HubExchangeBody {
  return result.body as HubExchangeBody;
}

function hubExchange(session: GameLogin, game: string, tickets: number, key: string): Promise<RpcResult> {
  return call('verse.exchange', { game, tickets, key }, session.hub.token);
}

/** NOBU pays up to 20 per `level_end` call and 200 per session. */
async function fundNobuSession(session: GameLogin, tag: string): Promise<void> {
  for (let i = 0; i < SESSION_CAP / 20; i += 1) await earn(session.gameToken, 20, 'level_end', `${tag}-${i}`);
}

/** `sessions` capped NOBU sessions on one account. Returns the last one, still open. */
async function fundNobu(sessions: number, tag: string): Promise<GameLogin> {
  let session = await login(NOBU);
  await fundNobuSession(session, `${tag}-0`);
  for (let i = 1; i < sessions; i += 1) {
    session = await openGame(session.hub.token, NOBU);
    await fundNobuSession(session, `${tag}-${i}`);
  }
  assert.equal(ticketBalance(session.hub.userId, NOBU), sessions * SESSION_CAP);
  return session;
}

function verseWindow(userId: string, game: string): number {
  return num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(userId)}' AND bucket = 'verse:${game}' AND day = (now() AT TIME ZONE 'utc')::date), 0)`,
  );
}

/** The flag row as the owner sets it in SQL. Flags are cached for 5 s per node, so wait that out. */
async function setHubExchange(state: 'on' | 'off'): Promise<void> {
  psql(`UPDATE game.server_flags SET state = '${state}', updated_at = now() WHERE key = 'hub_exchange'`);
  await sleep(5500);
}

export async function runHubExchange(test: TestFn): Promise<void> {
  await test('hub-exchange', 'the exchange is closed while the hub_exchange flag is off', async () => {
    await setHubExchange('off');
    const session = await fundNobu(1, 'hx-closed');
    const userId = session.hub.userId;
    const closed = await hubExchange(session, NOBU, 100, 'hx-closed');
    assert.equal(body(closed).error, 'exchange_off', JSON.stringify(closed.body));
    const listed = (await call('tickets.balances', {}, session.hub.token)).body as BalancesBody & { exchangeEnabled?: boolean };
    assert.equal(listed.exchangeEnabled, false);
    assert.equal(listed.wallets?.find((wallet) => wallet.game === NOBU)?.balance, SESSION_CAP);
    assert.equal(exchangeCount(userId), 0);
    assert.equal(ticketBalance(userId, NOBU), SESSION_CAP);
    assert.equal(verseBalance(userId), 0);
  });
  await setHubExchange('on');
  try {
    await hubExchangeOpen(test);
  } finally {
    await setHubExchange('off');
  }
}

async function hubExchangeOpen(test: TestFn): Promise<void> {
  await test('hub-exchange', 'same key x6 sequential then x6 concurrent is one exchange', async () => {
    const session = await fundNobu(1, 'hx-seq');
    const userId = session.hub.userId;
    const first = await hubExchange(session, NOBU, 100, 'hx-same');
    assert.equal(body(first).error, undefined, JSON.stringify(first.body));
    assert.equal(body(first).gained, 10);
    for (let i = 0; i < 5; i += 1) {
      const replay = await hubExchange(session, NOBU, 100, 'hx-same');
      assert.equal(body(replay).receiptId, body(first).receiptId);
    }
    const burst = await Promise.all(Array.from({ length: 6 }, () => hubExchange(session, NOBU, 50, 'hx-burst')));
    assert.equal(new Set(burst.map((result) => body(result).receiptId)).size, 1, JSON.stringify(burst.map((r) => r.body)));
    assert.equal(exchangeCount(userId), 2);
    assert.equal(ticketBalance(userId, NOBU), SESSION_CAP - 150);
    assert.equal(verseBalance(userId), 15);
  });

  await test('hub-exchange', 'same key with another body is idempotency_mismatch and moves nothing', async () => {
    const session = await fundNobu(1, 'hx-mis');
    const userId = session.hub.userId;
    assert.equal(body(await hubExchange(session, NOBU, 100, 'hx-body')).gained, 10);
    assert.equal(body(await hubExchange(session, NOBU, 50, 'hx-body')).error, 'idempotency_mismatch');
    assert.equal(body(await hubExchange(session, 'sproto', 100, 'hx-body')).error, 'idempotency_mismatch');
    // A key the in-game RPC used cannot be replayed through the hub RPC, and the reverse.
    const inGame = await call('tickets.exchange', { tickets: 20, key: 'hx-shared-key' }, session.gameToken);
    assert.equal(inGame.body.error, undefined, JSON.stringify(inGame.body));
    assert.equal(body(await hubExchange(session, NOBU, 20, 'hx-shared-key')).error, 'idempotency_mismatch');
    const reverse = await call('tickets.exchange', { tickets: 100, key: 'hx-body' }, session.gameToken);
    assert.equal(reverse.body.error, 'idempotency_mismatch');
    assert.equal(exchangeCount(userId), 2);
    assert.equal(ticketBalance(userId, NOBU), SESSION_CAP - 120);
    assert.equal(verseBalance(userId), 12);
  });

  await test('hub-exchange', 'a game-scope token is refused and bad input moves nothing', async () => {
    const session = await fundNobu(1, 'hx-forge');
    const userId = session.hub.userId;
    for (const game of [NOBU, 'sproto-fighter']) {
      const forged = await call('verse.exchange', { game, tickets: 10, key: `hx-forged-${game}` }, session.gameToken);
      assert.equal(forged.body.error, 'not_hub_session', JSON.stringify(forged.body));
    }
    const balances = await call('tickets.balances', {}, session.gameToken);
    assert.equal(balances.body.error, 'not_hub_session');
    assert.equal(body(await hubExchange(session, 'vcoin', 10, 'hx-vcoin')).error, 'bad_game');
    assert.equal(body(await hubExchange(session, NOBU, 9, 'hx-below')).error, 'below_rate');
    assert.equal(body(await hubExchange(session, NOBU, -10, 'hx-neg')).error, 'bad_amount');
    assert.equal(body(await hubExchange(session, NOBU, SESSION_CAP + 10, 'hx-poor')).error, 'insufficient_tickets');
    assert.equal(body(await hubExchange(session, 'sproto-coop-battle', 10, 'hx-empty')).error, 'insufficient_tickets');
    // The client cannot name the Verse amount: extra fields are ignored, the rate is the server's.
    const named = await call('verse.exchange', { game: NOBU, tickets: 10, verse: 999, key: 'hx-named' }, session.hub.token);
    assert.equal(body(named).gained, 1, JSON.stringify(named.body));
    assert.equal(exchangeCount(userId), 1);
    assert.equal(ticketBalance(userId, NOBU), SESSION_CAP - 10);
    assert.equal(verseBalance(userId), 1);
  });

  await test('hub-exchange', 'hub and in-game exchange race for one day cap: 50 Verse is never passed', async () => {
    const session = await fundNobu(4, 'hx-race');
    const userId = session.hub.userId;
    // 30 + 30 + 30 Verse asked at once on three requests; only one fits under 50.
    const results = await Promise.all([
      hubExchange(session, NOBU, 300, 'hx-race-hub-a'),
      call('tickets.exchange', { tickets: 300, key: 'hx-race-game' }, session.gameToken),
      hubExchange(session, NOBU, 300, 'hx-race-hub-b'),
    ]);
    const won = results.filter((result) => !result.body.error);
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.filter((result) => result.body.error === 'verse_cap').length, 2);
    assert.equal(verseBalance(userId), 30);
    assert.equal(verseWindow(userId, NOBU), 30);
    // Fill the day through the hub, then both paths are closed.
    assert.equal(body(await hubExchange(session, NOBU, 210, 'hx-over')).error, 'verse_cap', 'refused whole, not trimmed');
    assert.equal(body(await hubExchange(session, NOBU, 200, 'hx-fill')).gained, 20);
    assert.equal(body(await hubExchange(session, NOBU, 10, 'hx-full-hub')).error, 'verse_cap');
    const inGame = await call('tickets.exchange', { tickets: 10, key: 'hx-full-game' }, session.gameToken);
    assert.equal(inGame.body.error, 'verse_cap');
    assert.equal(verseBalance(userId), 50);
    assert.equal(verseWindow(userId, NOBU), 50);
    assert.equal(ticketBalance(userId, NOBU), 4 * SESSION_CAP - 500);
    const listed = (await call('tickets.balances', {}, session.hub.token)).body as BalancesBody;
    assert.equal(listed.wallets?.find((wallet) => wallet.game === NOBU)?.verseCapLeft, 0);
    assert.equal(listed.wallets?.find((wallet) => wallet.game === NOBU)?.balance, 4 * SESSION_CAP - 500);
    assert.equal(listed.verse, 50);
  });

  await test('hub-exchange', 'HPOS10I Tickets exchange from the plaza; the in-game refusal stays', async () => {
    const session = await login('hpos10i');
    const userId = session.hub.userId;
    await earn(session.gameToken, 20, 'level_end', 'hx-hpos-earn');
    const inGame = await call('tickets.exchange', { tickets: 20, key: 'hx-hpos-game' }, session.gameToken);
    assert.equal(inGame.body.error, 'exchange_not_allowed');
    const hub = await hubExchange(session, 'hpos10i', 20, 'hx-hpos-hub');
    assert.equal(body(hub).gained, 2, JSON.stringify(hub.body));
    assert.equal(ticketBalance(userId, 'hpos10i'), 0);
    assert.equal(verseBalance(userId), 2);
    assert.equal(num(`SELECT COALESCE((SELECT lifetime FROM game.verse_earned WHERE user_id = '${sqlId(userId)}' AND game_id = 'hpos10i'), 0)`), 2);
  });
}
