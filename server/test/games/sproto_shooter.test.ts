// Sproto Shooter registration. Migration 0039 widens session and auth tickets.
// It grants no Relic and no Tickets. 0038 stays unregistered.
import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';

const mod = loadModule();

{
  const HubGames = mod.global.HubGames as { list(): string[] };
  assert.ok(HubGames.list().includes('sproto-shooter'));
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  assert.equal(all.some((entry) => entry.id === '0038_sproto_shooter'), false);
  const migration = all.find((entry) => entry.id === '0039_sproto_shooter_coop');
  assert.ok(migration, 'migration 0039 registered');
  const sql = migration.statements.join('\n');
  assert.doesNotMatch(sql, /event_rule|relic_id|tickets/i);
  for (const table of ['game_session', 'auth_ticket']) {
    assert.match(sql, new RegExp(`${table} ADD CONSTRAINT \\w+ CHECK \\(game_id IN \\([^)]*'sproto-shooter'`));
    assert.match(sql, new RegExp(`${table} ADD CONSTRAINT \\w+ CHECK \\(game_id IN \\([^)]*'sproto-coop-battle'`));
  }
  assert.ok(all.indexOf(migration) > all.findIndex((entry) => entry.id === '0037_hub_life_medal'), 'runs after 0037');
}

console.log('sproto_shooter tests ok');
