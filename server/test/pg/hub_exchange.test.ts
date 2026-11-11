// B1: hub-scope exchange (0059_hub_exchange, verse.exchange, tickets.balances) on a real Postgres.
// Caps and idempotency are shared with the in-game tickets.exchange; these cases prove it,
// including two connections racing for the same day's cap.
import assert from 'node:assert/strict';
import { addUser, count, freshPg, gameCtx, hubCtx, openGameSession, seedTickets, tickets, verse } from './rig';

const pg = freshPg('hub_exchange');
const { mod } = pg;

interface Exchange { error?: string; verse?: number; gained?: number; ticketsLeft?: number; receiptId?: string; verseCapLeft?: number; game?: string }
interface Balances { wallets: { game: string; balance: number; verseCapLeft: number }[]; verse: number; ticketsPerVerse: number; verseDailyCap: number }

const hubExchange = (user: string, game: string, amount: number, key: string) =>
  mod.call<Exchange>('verse.exchange', hubCtx(user), { game, tickets: amount, key });
const gameExchange = (user: string, game: string, sid: string, amount: number, key: string) =>
  mod.call<Exchange>('tickets.exchange', gameCtx(user, game, sid), { tickets: amount, key });

const GAMES = ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle'];

// Balances: all eight games, zeros for a new account, hub scope only.
{
  const user = addUser(pg, 'wallet_reader');
  const fresh = mod.call<Balances>('tickets.balances', hubCtx(user), {});
  assert.deepEqual(fresh.wallets.map((w) => w.game), GAMES);
  assert.ok(fresh.wallets.every((w) => w.balance === 0 && w.verseCapLeft === 50));
  assert.equal(fresh.verse, 0);
  assert.deepEqual([fresh.ticketsPerVerse, fresh.verseDailyCap], [10, 50]);
  seedTickets(pg, user, 'sproto-coop-battle', 240);
  const after = mod.call<Balances>('tickets.balances', hubCtx(user), {});
  assert.equal(after.wallets.find((w) => w.game === 'sproto-coop-battle')?.balance, 240);
  const sid = openGameSession(pg, user, 'nobu');
  assert.equal(mod.call<{ error?: string }>('tickets.balances', gameCtx(user, 'nobu', sid), {}).error, 'not_hub_session');
  assert.equal(mod.call<{ error?: string }>('tickets.balances', { userId: '', vars: { scope: 'hub' } }, {}).error, 'unauthorized');
}

// The five stranded wallets and HPOS10I exchange from the plaza; the in-game HPOS10I refusal stays.
{
  const user = addUser(pg, 'five_wallets');
  for (const game of ['sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle', 'hpos10i']) {
    seedTickets(pg, user, game, 37);
    const out = hubExchange(user, game, 37, `x-${game}`);
    assert.equal(out.error, undefined, `${game}: ${String(out.error)}`);
    assert.equal(out.gained, 3, `${game}: 37 Tickets is 3 Verse`);
    assert.equal(out.ticketsLeft, 7, `${game}: only whole tens are debited`);
    assert.equal(out.verseCapLeft, 47);
    assert.equal(tickets(pg, user, game), 7);
  }
  assert.equal(verse(pg, user), 15);
  const sid = openGameSession(pg, user, 'hpos10i');
  seedTickets(pg, user, 'hpos10i', 20);
  assert.equal(gameExchange(user, 'hpos10i', sid, 20, 'in-game-hpos').error, 'exchange_not_allowed');
  pg.audit();
}

// Replay, mismatch, forged scope, bad input.
{
  const user = addUser(pg, 'replayer');
  seedTickets(pg, user, 'sproto-arcade', 200);
  const first = hubExchange(user, 'sproto-arcade', 100, 'dbl');
  const again = hubExchange(user, 'sproto-arcade', 100, 'dbl');
  assert.equal(first.gained, 10);
  assert.deepEqual(again, first, 'a double click returns the stored answer');
  assert.equal(tickets(pg, user, 'sproto-arcade'), 100, 'debited once');
  assert.equal(verse(pg, user), 10, 'credited once');
  assert.equal(count(pg, 'SELECT 1 FROM game.exchange_tx WHERE user_id = $1::uuid', [user]), 1);
  assert.equal(pg.run("SELECT rpc FROM game.idempotency WHERE user_id = $1::uuid AND key = 'dbl'", [user])[0]?.rpc, 'verse.exchange');

  assert.equal(hubExchange(user, 'sproto-arcade', 50, 'dbl').error, 'idempotency_mismatch', 'same key, other amount');
  assert.equal(hubExchange(user, 'nobu', 100, 'dbl').error, 'idempotency_mismatch', 'same key, other game');

  // A game-scope token cannot reach the hub exchange, whatever game it names.
  const sid = openGameSession(pg, user, 'nobu');
  for (const game of ['nobu', 'sproto-arcade']) {
    const forged = mod.call<Exchange>('verse.exchange', gameCtx(user, 'nobu', sid), { game, tickets: 10, key: `forged-${game}` });
    assert.equal(forged.error, 'not_hub_session');
  }
  assert.equal(mod.call<Exchange>('verse.exchange', { userId: '', vars: { scope: 'hub' } }, { game: 'nobu', tickets: 10, key: 'anon' }).error, 'unauthorized');
  assert.equal(tickets(pg, user, 'sproto-arcade'), 100);

  assert.equal(hubExchange(user, 'vcoin', 10, 'bad-game-1').error, 'bad_game');
  assert.equal(hubExchange(user, 'nope', 10, 'bad-game-2').error, 'bad_game');
  assert.equal(hubExchange(user, 'sproto-arcade', 0, 'zero').error, 'bad_amount');
  assert.equal(hubExchange(user, 'sproto-arcade', -10, 'neg').error, 'bad_amount');
  assert.equal(hubExchange(user, 'sproto-arcade', 9, 'below').error, 'below_rate');
  assert.equal(hubExchange(user, 'sproto-arcade', 10, '').error, 'bad_key');
  assert.equal(hubExchange(user, 'sproto-arcade', 110, 'too-many').error, 'insufficient_tickets');
  assert.equal(hubExchange(user, 'sproto-fighter', 10, 'empty-wallet').error, 'insufficient_tickets');
  assert.equal(tickets(pg, user, 'sproto-arcade'), 100, 'refusals move nothing');
  assert.equal(verse(pg, user), 10);
  // The SQL function refuses a game id on its own, without the handler's check.
  assert.match(pg.run("SELECT game.exchange_tickets_hub($1::uuid, 'vcoin', 10, 'direct', repeat('ab', 32))::text AS r", [user])[0]!.r!, /bad_game/);
  pg.audit();
}

// The 50 Verse per game per day cap: refused whole, shared with the in-game exchange, per game.
{
  const user = addUser(pg, 'capper');
  seedTickets(pg, user, 'nobu', 900);
  seedTickets(pg, user, 'sproto-coop-battle', 600);
  assert.equal(hubExchange(user, 'nobu', 510, 'over-whole').error, 'verse_cap', 'crossing the cap is refused whole, not trimmed');
  assert.equal(tickets(pg, user, 'nobu'), 900);

  const sid = openGameSession(pg, user, 'nobu');
  assert.equal(gameExchange(user, 'nobu', sid, 300, 'in-game-30').verse, 30, 'in-game exchange: 30 Verse');
  const blocked = hubExchange(user, 'nobu', 300, 'hub-30-more');
  assert.equal(blocked.error, 'verse_cap', '30 in game + 30 in the hub would be 60');
  assert.equal(blocked.verseCapLeft, 20);
  assert.equal(hubExchange(user, 'nobu', 200, 'hub-20').gained, 20, 'the hub takes the remaining 20');
  assert.equal(gameExchange(user, 'nobu', sid, 10, 'in-game-over').error, 'verse_cap', 'the in-game path sees the hub exchange');
  assert.equal(hubExchange(user, 'nobu', 10, 'hub-over').error, 'verse_cap');
  assert.equal(verse(pg, user), 50);
  assert.equal(tickets(pg, user, 'nobu'), 400);

  // Another game has its own 50.
  assert.equal(hubExchange(user, 'sproto-coop-battle', 500, 'coop-50').gained, 50);
  assert.equal(hubExchange(user, 'sproto-coop-battle', 10, 'coop-over').error, 'verse_cap');
  assert.equal(verse(pg, user), 100);
  const now = mod.call<Balances>('tickets.balances', hubCtx(user), {});
  assert.equal(now.wallets.find((w) => w.game === 'nobu')?.verseCapLeft, 0);
  assert.equal(now.wallets.find((w) => w.game === 'sproto-coop-battle')?.verseCapLeft, 0);
  assert.equal(now.wallets.find((w) => w.game === 'sproto')?.verseCapLeft, 50);
  assert.equal(now.verse, 100);

  // A key used by the in-game exchange cannot be replayed through the hub RPC.
  assert.equal(hubExchange(user, 'nobu', 300, 'in-game-30').error, 'idempotency_mismatch');

  // Tomorrow the cap is back: move today's window row to yesterday.
  pg.run("UPDATE game.earn_window SET day = day - 1 WHERE user_id = $1::uuid AND bucket = 'verse:nobu'", [user]);
  assert.equal(hubExchange(user, 'nobu', 400, 'next-day').gained, 40);
  pg.audit();
}

// Races on two connections. The advisory lock economy:<user> serialises them.
{
  const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
  const hubSql = "SELECT game.exchange_tickets_hub($1::uuid, $2, $3, $4, $5)::text AS r";
  const gameSql = "SELECT game.exchange_tickets($1::uuid, $2::uuid, $3, $4, $5, $6)::text AS r";
  for (let round = 0; round < 6; round += 1) {
    // Hub and in-game exchange, 30 Verse each, same game, same day: one fits under 50, never both.
    const user = addUser(pg, `racer_${round}`);
    seedTickets(pg, user, 'nobu', 1000);
    const sid = openGameSession(pg, user, 'nobu');
    const results = await Promise.all([
      pg.runAsync(hubSql, [user, 'nobu', 300, `hub-${round}`, hash(1)]),
      pg.runAsync(gameSql, [user, sid, 'nobu', 300, `game-${round}`, hash(2)]),
      pg.runAsync(hubSql, [user, 'nobu', 300, `hub2-${round}`, hash(3)]),
    ]);
    const answers = results.map((rows) => JSON.parse(rows[0]!.r!) as Exchange);
    assert.equal(answers.filter((a) => !a.error).length, 1, `round ${round}: exactly one exchange fits`);
    assert.equal(answers.filter((a) => a.error === 'verse_cap').length, 2);
    assert.equal(verse(pg, user), 30);
    assert.equal(tickets(pg, user, 'nobu'), 700);
    assert.equal(Number(pg.run("SELECT amount FROM game.earn_window WHERE user_id = $1::uuid AND bucket = 'verse:nobu'", [user])[0]!.amount), 30);

    // Double click: the same key on two connections credits once and both get the same receipt.
    const twin = await Promise.all([0, 1, 2].map(() => pg.runAsync(hubSql, [user, 'nobu', 100, `twin-${round}`, hash(4)])));
    const receipts = new Set(twin.map((rows) => (JSON.parse(rows[0]!.r!) as Exchange).receiptId));
    assert.equal(receipts.size, 1, `round ${round}: one receipt for one key`);
    assert.equal(verse(pg, user), 40);
    assert.equal(tickets(pg, user, 'nobu'), 600);
  }
  pg.audit();
}

// Invariant across everything above: no account passed 50 Verse for one game on one day.
assert.equal(count(pg, "SELECT 1 FROM game.earn_window WHERE bucket LIKE 'verse:%' AND amount > 50"), 0);

console.log('pg hub exchange ok');
