// Sproto Arcade (server/modules/src/games/sproto_arcade.ts) and the generic cloud saves
// (save.get / save.put in rpcs.ts): registration, migration 0025, game id gates, save shape,
// size cap, owner-read / server-write storage and per-game isolation.
import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const arcade = (userId: string) => ({ userId, vars: { scope: 'game', game: 'sproto-arcade', sid: SID } });

const mod = loadModule();
mod.nk.onSql(/epoch FROM now\(\)/, () => [{ ms: '1700000000000' }]);

// Registration and migration.
{
  const HubGames = mod.global.HubGames as { list(): string[] };
  assert.ok(HubGames.list().includes('sproto-arcade'));
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  const m = all.find((entry) => entry.id === '0025_sproto_arcade');
  assert.ok(m, 'migration 0025 registered');
  const sql = m.statements.join('\n');
  assert.match(sql, /'sproto-arcade', 'arcade\.boss_defeated', 'breakwater_coin'.*\{"boss":"bront"\}/);
  assert.match(sql, /'sproto-arcade', 'arcade_clear', NULL.*20\)/);
  assert.match(sql, /relic_claim_known CHECK \(relic_id IN \([^)]*'breakwater_coin'\)\)/);
  for (const table of ['game_session', 'game_beaten', 'auth_ticket']) {
    assert.match(sql, new RegExp(`${table} ADD CONSTRAINT \\w+ CHECK \\(game_id IN \\([^)]*'sproto-arcade'\\)\\)`));
  }
  assert.ok(all.indexOf(m) > all.findIndex((entry) => entry.id === '0020_sproto_pvp'), 'runs after 0020');
  assert.ok(mod.registered.rpcs.has('save.get') && mod.registered.rpcs.has('save.put'));
}

// Empty save, then a write and a read back.
{
  assert.deepEqual(mod.call('save.get', arcade(A), {}), { data: null, updatedAt: 0 });
  const data = { v: 1, cleared: [0, 1], unlocked: ['rivet', 'sproto1668'] };
  const put = mod.call('save.put', arcade(A), { data });
  assert.deepEqual(put, { data, updatedAt: 1700000000000 });
  assert.deepEqual(mod.call('save.get', arcade(A), {}), { data, updatedAt: 1700000000000 });
  const row = mod.nk.storage.get(`game_save/sproto-arcade/${A}`);
  assert.ok(row);
  assert.equal(row.permissionRead, 1, 'owner can read');
  assert.equal(row.permissionWrite, 0, 'only the server writes');
  // Another player and another game see nothing.
  assert.deepEqual(mod.call('save.get', arcade(B), {}), { data: null, updatedAt: 0 });
  assert.deepEqual(mod.call('save.get', { userId: A, vars: { scope: 'game', game: 'nobu', sid: SID } }, {}), { data: null, updatedAt: 0 });
}

// Bad shapes and the size cap.
{
  assert.equal((mod.call('save.put', arcade(A), { data: [1, 2] }) as { error?: string }).error, 'bad_save');
  assert.equal((mod.call('save.put', arcade(A), { data: 'x' }) as { error?: string }).error, 'bad_save');
  assert.equal((mod.call('save.put', arcade(A), {}) as { error?: string }).error, 'bad_save');
  const big = { blob: 'é'.repeat(8200) }; // 16400 UTF-8 bytes
  assert.equal((mod.call('save.put', arcade(A), { data: big }) as { error?: string }).error, 'save_too_large');
  const fits = { blob: 'x'.repeat(16000) };
  assert.ok(!(mod.call('save.put', arcade(A), { data: fits }) as { error?: string }).error);
}

// Saves need a game session.
{
  const err = (fn: () => unknown): string => {
    try {
      return String((fn() as { error?: string }).error);
    } catch (e) {
      return String((e as { message?: string }).message ?? e);
    }
  };
  assert.match(err(() => mod.call('save.get', { userId: A, vars: { scope: 'hub' } }, {})), /not_game_session/);
  assert.match(err(() => mod.call('save.put', { vars: { scope: 'game', game: 'sproto-arcade', sid: SID } }, { data: {} })), /unauthorized|unauthenticated/);
}

console.log('sproto_arcade tests ok');
