// M6 item grants: migration 0030_m6_item_grants stays in step with HubItems (item_grant.ts),
// and loadout.set_hub is registered. The live grant is covered by server/test/dup/pets.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './harness';

const here = dirname(fileURLToPath(import.meta.url));
const grantSource = readFileSync(resolve(here, '../../modules/src/item_grant.ts'), 'utf8');

const mod = loadModule();
const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
const migration = HubSchema.all().find((m) => m.id === '0030_m6_item_grants');
assert.ok(migration, 'migration 0030_m6_item_grants registered');
const sql = migration.statements.join('\n');

function block(name: string): string {
  const start = grantSource.indexOf(`var ${name}`);
  assert.ok(start >= 0, `item_grant.ts has ${name}`);
  return grantSource.slice(start, grantSource.indexOf('];', start));
}

// Every RULES row is seeded with the same match, and nothing else is.
{
  const rules = [...block('RULES').matchAll(/game: "([^"]+)", event: "([^"]+)", item: "([^"]+)", match: "((?:[^"\\]|\\.)*)"/g)]
    .map((m) => ({ game: m[1], event: m[2], item: m[3], match: JSON.parse(JSON.parse(`"${m[4]}"`)) as unknown }));
  assert.equal(rules.length, 7);
  const seeded = [...sql.matchAll(/\('([^']+)', '([^']+)', '([^']+)', '([^']+)'::jsonb\)/g)]
    .map((m) => ({ game: m[1], event: m[2], item: m[3], match: JSON.parse(m[4] as string) as unknown }));
  assert.deepEqual(seeded, rules);
}

// The excluded ids and canonical pairs in apply_event match HubItems.
{
  const excluded = [...block('EXCLUDED').matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  const notIn = /r\.item_id NOT IN \(([^)]*)\)/.exec(sql);
  assert.ok(notIn, 'apply_event excludes relics and derived pets');
  assert.deepEqual([...(notIn[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), excluded);
  const canonical = [...block('CANONICAL').matchAll(/event: "([^"]+)", game: "([^"]+)"/g)].map((m) => `${m[2]} ${m[1]}`).sort();
  const pairs = [...sql.matchAll(/\(p_game_id = '([^']+)' AND p_event_id = '([^']+)'\)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(pairs, canonical);
  // The grant runs before the idempotency insert so a replay returns the stored list.
  const grant = sql.indexOf("jsonb_build_object('granted_items'");
  const store = sql.indexOf('INSERT INTO game.idempotency');
  assert.ok(grant > 0 && store > grant, 'granted_items is stored with the idempotent response');
  assert.match(sql, /ON CONFLICT \(user_id, item_id\) DO NOTHING/);
}

// loadout.set_hub is registered and refuses a game session.
{
  assert.ok(mod.registered.rpcs.has('loadout.set_hub'));
  const res = mod.call<{ error?: string }>(
    'loadout.set_hub',
    { userId: '11111111-1111-4111-8111-111111111111', vars: { scope: 'game', game: 'hpos10i', sid: '33333333-3333-4333-8333-333333333333' } },
    { v: 1, pet: 'pet_honk_sproto', seq: 1 },
  );
  assert.equal(res.error, 'not_hub_session');
}

// Existing relic claims unlock the new cosmetics through profile and loadout,
// while item_owned rows alone cannot unlock a relic pet.
{
  const mappings = [
    ['tidebreaker_belt', 'pet_fighter'],
    ['breakwater_coin', 'pet_mecha'],
    ['genesis_shard', 'pet_president'],
    ['tinubu_crown', 'pet_wizard', 'pet_duelist_sproto'],
    ['hpos10i_core', 'pet_runner', 'pet_speed_sproto'],
    ['dragon_scale', 'pet_soldier'],
  ];
  for (const [relic, pet, legacy] of mappings) {
    const server = loadModule();
    const userId = '11111111-1111-4111-8111-111111111111';
    const ctx = { userId, vars: { scope: 'hub' } };
    const pets = server.global.HubPets as {
      profilePets(nk: unknown, user: string): { owned: string[]; active: string | null };
    };
    const profile = () => JSON.parse(JSON.stringify(pets.profilePets(server.nk, userId)));
    let claimed = false;
    server.nk.onSql(/SELECT COALESCE\(json_agg\(item_id ORDER BY item_id\)/, () => [{ result: JSON.stringify([pet]) }]);
    server.nk.onSql(/SELECT COALESCE\(json_agg\(relic_id\)/, () => [{ result: JSON.stringify(claimed ? [relic] : []) }]);
    server.nk.onSql(/SELECT to_char\(now\(\)/, [{ result: '2026-01-01T00:00:00Z' }]);
    assert.deepEqual(profile(), { owned: [], active: null });
    const equip = () => server.call<{ ok: boolean; reason?: string }>('loadout.set_hub', ctx, { v: 1, pet, seq: 1 });
    assert.equal(equip().reason, 'not_owned');
    claimed = true;
    const owned = legacy ? [legacy, pet].sort() : [pet];
    assert.deepEqual(profile(), { owned, active: null });
    assert.equal(equip().ok, true);
    assert.deepEqual(profile(), { owned, active: pet });
  }
}

console.log('item grant tests ok');
