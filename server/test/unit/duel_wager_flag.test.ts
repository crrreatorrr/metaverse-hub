// sproto_duel_wager defaults off. A wager pair is not given a match. A free pair still is.
import assert from 'node:assert/strict';
import { loadModule } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const mod = loadModule();
const Duel = mod.global.SprotoDuel as {
  onMatched(ctx: unknown, logger: unknown, nk: unknown, matches: unknown[]): string | void;
};

function pair(wager: string) {
  return [
    { presence: { userId: A, username: 'ada', sessionId: 'sa', node: 'n' }, properties: { game: 'sproto-fighter', wager, sim: '1' } },
    { presence: { userId: B, username: 'bea', sessionId: 'sb', node: 'n' }, properties: { game: 'sproto-fighter', wager, sim: '1' } },
  ];
}

function duels() {
  return mod.nk.matchList(20, true, null, null, null, null).filter((row) => row.handlerName === 'sproto_duel').length;
}

const wager = Duel.onMatched(null, mod.logger, mod.nk, pair('1'));
assert.equal(wager, undefined);
assert.equal(duels(), 0);

const free = Duel.onMatched(null, mod.logger, mod.nk, pair('0'));
assert.equal(typeof free, 'string');
assert.equal(duels(), 1);

console.log('duel wager flag tests ok');
