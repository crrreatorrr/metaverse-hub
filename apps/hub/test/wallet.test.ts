// B1: Wallet tab helpers. The offer is the largest multiple of 10 within balance and cap,
// retries reuse their key, and the game list matches the server's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_IDS, TICKETS_PER_VERSE, VERSE_DAILY_CAP } from '@metaverse/hub-sdk';
import {
  WALLET_CLOSED_TEXT,
  WALLET_GAMES,
  WALLET_RATE_LINE,
  applyExchange,
  createExchangeKeys,
  exchangeErrorText,
  exchangeOffer,
  offerLabel,
  walletFromAnswer,
} from '../src/wallet';

assert.deepEqual([TICKETS_PER_VERSE, VERSE_DAILY_CAP], [10, 50]);

// Offer: largest multiple of 10 within balance and today's cap.
assert.deepEqual(exchangeOffer(0, 50), { tickets: 0, verse: 0, blocked: 'need_tickets' });
assert.deepEqual(exchangeOffer(9, 50), { tickets: 0, verse: 0, blocked: 'need_tickets' });
assert.deepEqual(exchangeOffer(10, 50), { tickets: 10, verse: 1, blocked: 'none' });
assert.deepEqual(exchangeOffer(37, 50), { tickets: 30, verse: 3, blocked: 'none' });
assert.deepEqual(exchangeOffer(240, 50), { tickets: 240, verse: 24, blocked: 'none' });
assert.deepEqual(exchangeOffer(1000, 50), { tickets: 500, verse: 50, blocked: 'none' });
assert.deepEqual(exchangeOffer(1000, 20), { tickets: 200, verse: 20, blocked: 'none' });
assert.deepEqual(exchangeOffer(1000, 0), { tickets: 0, verse: 0, blocked: 'cap' });
assert.deepEqual(exchangeOffer(-5, -5), { tickets: 0, verse: 0, blocked: 'need_tickets' });
for (let balance = 0; balance <= 620; balance += 7) {
  for (const cap of [0, 1, 20, 50]) {
    const offer = exchangeOffer(balance, cap);
    assert.equal(offer.tickets % TICKETS_PER_VERSE, 0);
    assert.equal(offer.tickets, offer.verse * TICKETS_PER_VERSE);
    assert.ok(offer.tickets <= balance && offer.verse <= cap);
  }
}
assert.equal(offerLabel(exchangeOffer(240, 50)), 'Exchange 240 for 24 Verse');
assert.equal(offerLabel(exchangeOffer(5, 50)), 'Need 10 Tickets');
assert.equal(offerLabel(exchangeOffer(500, 0)), 'Daily cap reached');
assert.ok(WALLET_RATE_LINE.includes('10 Tickets = 1 Verse') && WALLET_RATE_LINE.includes('50 Verse'));

// Eight rows, the server's list and order, and every SDK game id.
{
  const rpcs = readFileSync(new URL('../../../server/modules/src/rpcs.ts', import.meta.url), 'utf8');
  const match = /WALLET_GAMES: string\[\] = \[([^\]]*)\]/.exec(rpcs);
  assert.ok(match);
  const server = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(WALLET_GAMES.map((game) => game.id), server);
  assert.deepEqual([...WALLET_GAMES.map((game) => game.id)].sort(), [...GAME_IDS].sort());
  assert.equal(WALLET_GAMES.length, 8);
}

// Answer → rows. Missing games read as empty wallets; junk is clamped.
{
  const state = walletFromAnswer({
    verse: 12,
    wallets: [
      { game: 'sproto-coop-battle', balance: 240, verseCapLeft: 26 },
      { game: 'nobu', balance: 15.9, verseCapLeft: 999 },
      { game: 'vcoin', balance: 5, verseCapLeft: 50 },
    ],
  });
  assert.equal(state.rows.length, 8);
  assert.deepEqual(state.rows.find((row) => row.game === 'sproto-coop-battle'), { game: 'sproto-coop-battle', label: 'Sproto Coop Battle', balance: 240, verseCapLeft: 26 });
  assert.deepEqual(state.rows.find((row) => row.game === 'nobu'), { game: 'nobu', label: 'NOBU: Saviour Dog', balance: 15, verseCapLeft: 50 });
  assert.equal(state.rows.find((row) => row.game === 'hpos10i')?.balance, 0);
  assert.equal(state.verse, 12);
  const after = applyExchange(state, 'sproto-coop-battle', { verse: 36, gained: 24, ticketsLeft: 0, verseCapLeft: 2 });
  assert.equal(after.verse, 36);
  assert.deepEqual(after.rows.find((row) => row.game === 'sproto-coop-battle'), { game: 'sproto-coop-battle', label: 'Sproto Coop Battle', balance: 0, verseCapLeft: 2 });
  assert.equal(after.rows.find((row) => row.game === 'nobu')?.balance, 15, 'other rows untouched');
  assert.equal(walletFromAnswer({}).rows.every((row) => row.balance === 0 && row.verseCapLeft === 50), true);
  // The hub_exchange flag: only an explicit true from the server opens the buttons.
  assert.equal(state.exchangeEnabled, false, 'a missing field keeps the exchange closed');
  assert.equal(walletFromAnswer({ exchangeEnabled: true }).exchangeEnabled, true);
  assert.equal(walletFromAnswer({ exchangeEnabled: 'yes' as unknown as boolean }).exchangeEnabled, false);
  assert.equal(applyExchange(walletFromAnswer({ exchangeEnabled: true }), 'nobu', { verse: 1, ticketsLeft: 0, verseCapLeft: 49 }).exchangeEnabled, true);
  assert.equal(exchangeErrorText('exchange_off'), WALLET_CLOSED_TEXT);
  const menu = readFileSync(new URL('../src/menu.ts', import.meta.url), 'utf8');
  assert.match(menu, /const closed = !walletState\.exchangeEnabled;/);
  assert.match(menu, /button\.disabled = closed \|\|/, 'a closed exchange disables every Exchange button');
}

// A retry reuses its key until the server answers; a new request after that gets a new key.
{
  let made = 0;
  const keys = createExchangeKeys(() => `key-${made += 1}`);
  const first = keys.keyFor('nobu', 100);
  assert.equal(keys.keyFor('nobu', 100), first, 'retry after a dropped connection: same key');
  assert.notEqual(keys.keyFor('nobu', 50), first, 'another amount is another request');
  assert.notEqual(keys.keyFor('sproto', 100), first, 'another game is another request');
  keys.settle('nobu', 100);
  assert.notEqual(keys.keyFor('nobu', 100), first, 'after an answer the next click is a new exchange');
  assert.equal(made, 4);
}

for (const code of ['exchange_off', 'verse_cap', 'insufficient_tickets', 'below_rate', 'rate_limited', 'anything_else']) {
  const text = exchangeErrorText(code);
  assert.ok(text.length > 10 && !text.includes('_'), text);
}

console.log('wallet ok');
