// Owner godmode (server/modules/src/godmode.ts): migration 0042 and the top-up call on
// both Ticket balance reads. The SQL itself is exercised against Postgres by
// deploy/scripts/godmode.sh; here the module is checked with the fake nk.
import assert from 'node:assert/strict';
import { loadModule } from './harness';

const USER = '00000000-0000-4000-8000-0000000000aa';
const SID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const mod = loadModule();
const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
const HubGodmode = mod.global.HubGodmode as { GAME: string; DEFAULT_TICKETS: number };
const HubEconomy = mod.global.HubEconomy as {
  balance(nk: unknown, who: { userId: string; sid: string; game: string }): Record<string, unknown>;
};

mod.nk.onSql("SELECT json_build_object('balance'", [{ result: '{"balance":0,"sessionCapLeft":200,"dailyCapLeft":1000,"serverTime":0}' }]);

const topUps = () => mod.nk.sqlCalls.filter((c) => c.sql.includes('game.godmode_topup'));

// Migration: registered after 0041, widens the ledger kinds, and only ever targets peoples-bitcoin.
{
  const all = HubSchema.all();
  const ids = all.map((m) => m.id);
  assert.ok(ids.indexOf('0042_pb_godmode') > ids.indexOf('0041_coop_boss_receipt'));
  const sql = all.find((m) => m.id === '0042_pb_godmode')!.statements.join('\n');
  assert.match(sql, /'duel_refund', 'godmode'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS game\.godmode_user/);
  assert.match(sql, /IF p_game_id <> 'peoples-bitcoin' THEN RETURN NULL/);
  // The grant has no session ref, so it never counts toward the session earn cap.
  assert.match(sql, /'godmode', NULL, 'godmode'\)/);
  assert.equal(sql.includes('earn_window'), false);
  assert.equal(HubGodmode.GAME, 'peoples-bitcoin');
  assert.equal(HubGodmode.DEFAULT_TICKETS, 90_000_000_000);
}

// tickets.balance tops up before it reads, for peoples-bitcoin only.
{
  mod.nk.sqlCalls.length = 0;
  mod.call('tickets.balance', { userId: USER, vars: { scope: 'game', game: 'peoples-bitcoin', sid: SID } }, { game: 'peoples-bitcoin' });
  const calls = mod.nk.sqlCalls;
  const up = calls.findIndex((c) => c.sql.includes('game.godmode_topup'));
  const read = calls.findIndex((c) => c.sql.includes('FROM game.tickets_balance'));
  assert.ok(up >= 0 && read > up, 'top-up runs before the balance read');
  assert.deepEqual([...calls[up]!.args], [USER, 'peoples-bitcoin']);

  mod.nk.sqlCalls.length = 0;
  mod.call('tickets.balance', { userId: USER, vars: { scope: 'game', game: 'sproto', sid: SID } }, { game: 'sproto' });
  assert.equal(topUps().length, 0, 'other games never top up');
}

// Online worlds read through HubEconomy.balance.
{
  mod.nk.sqlCalls.length = 0;
  HubEconomy.balance(mod.nk, { userId: USER, sid: SID, game: 'peoples-bitcoin' });
  assert.equal(topUps().length, 1);
  mod.nk.sqlCalls.length = 0;
  HubEconomy.balance(mod.nk, { userId: 'not-a-uuid', sid: SID, game: 'peoples-bitcoin' });
  assert.equal(topUps().length, 0, 'a bad caller is rejected before any write');
}

console.log('godmode tests ok');
