// Sproto Shooter (server/modules/src/games/sproto_shooter.ts): registration and migration 0038.
// The portal accepts the game id. This migration grants no Relic and no Tickets.
import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';

const mod = loadModule();

{
  const HubGames = mod.global.HubGames as { list(): string[] };
  assert.ok(HubGames.list().includes('sproto-shooter'));
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  const m = all.find((entry) => entry.id === '0038_sproto_shooter');
  assert.ok(m, 'migration 0038 registered');
  const sql = m.statements.join('\n');
  assert.doesNotMatch(sql, /event_rule|relic_id|tickets/i);
  for (const table of ['game_session', 'game_beaten', 'auth_ticket']) {
    assert.match(sql, new RegExp(`${table} ADD CONSTRAINT \\w+ CHECK \\(game_id IN \\([^)]*'sproto-shooter'\\)\\)`));
  }
  assert.match(sql, /'vcoin', 'sproto-shooter'/);
  assert.ok(all.indexOf(m) > all.findIndex((entry) => entry.id === '0037_hub_life_medal'), 'runs after 0037');
}

console.log('sproto_shooter tests ok');
