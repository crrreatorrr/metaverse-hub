// B3: 0060_relic_unhold on a real Postgres. Held grants become live, pending claims are promoted
// exactly once, hub_life_medal stays held, and nothing pays Tickets or Verse.
// B2: the ten Fighter story bosses pay 20 Tickets once per boss per UTC day.
import assert from 'node:assert/strict';
import { addUser, count, freshPg, gameCtx, hubCtx, openGameSession, tickets, verse, type Pg } from './rig';

const pg = freshPg('relic_unhold');
const { mod } = pg;

interface EventAnswer { error?: string; granted?: string; granted_items?: string[]; tickets?: number }
interface Profile { relics: string[]; gameBeaten: string[]; pets?: { owned: string[] }; items?: string[] }

const RELICS = [
  { id: 'genesis_shard', game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_tutorial' } },
  { id: 'tidebreaker_belt', game: 'sproto-fighter', eventId: 'fighter.story_level_complete', data: { world: 1 } },
] as const;
const PETS = [
  { id: 'pet_honk_sproto', game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z1_retro_rush_hills', act: 2, time: 30 } },
  { id: 'pet_spiral_sproto', game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z2_wizard_academy', act: 2, time: 30 } },
  { id: 'pet_moon_sproto', game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_moonward' } },
  { id: 'pet_sproto_pup', game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_hatchery' } },
] as const;
const SIX = [...RELICS.map((r) => r.id), ...PETS.map((p) => p.id)];
const inList = SIX.map((id) => `'${id}'`).join(', ');

function fire(db: Pg, user: string, game: string, eventId: string, data: object, key: string): EventAnswer {
  const sid = openGameSession(db, user, game);
  return db.mod.call<EventAnswer>('session.event', gameCtx(user, game, sid), { eventId, data, key });
}
const claims = (user: string, relic: string) => count(pg, 'SELECT 1 FROM game.relic_claim WHERE user_id = $1::uuid AND relic_id = $2', [user, relic]);
const mints = (user: string, id: string, op: string) => count(pg, 'SELECT 1 FROM game.item_ledger WHERE user_id = $1::uuid AND item_id = $2 AND op = $3', [user, id, op]);
const owned = (user: string, item: string) => count(pg, 'SELECT 1 FROM game.item_owned WHERE user_id = $1::uuid AND item_id = $2', [user, item]);
const pendingRelic = (user: string, relic: string) => count(pg, 'SELECT 1 FROM game.relic_claim_pending WHERE user_id = $1::uuid AND relic_id = $2', [user, relic]);
const pendingItem = (user: string, item: string) => count(pg, 'SELECT 1 FROM game.item_owned_pending WHERE user_id = $1::uuid AND item_id = $2', [user, item]);
const profile = (user: string) => mod.call<Profile>('profile.get', hubCtx(user), {});

// After every migration: only hub_life_medal is held.
{
  assert.deepEqual(pg.run('SELECT relic_id FROM game.event_rule WHERE grant_hold ORDER BY 1').map((r) => r.relic_id), []);
  assert.deepEqual(pg.run('SELECT item_id FROM game.item_rule WHERE grant_hold ORDER BY 1').map((r) => r.item_id), ['hub_life_medal']);
  assert.equal(count(pg, "SELECT 1 FROM game.schema_migrations WHERE id = '0060_relic_unhold'"), 1);
}

// A fresh account gets each of the six at once, exactly once, with no Tickets and no Verse.
for (const relic of RELICS) {
  const user = addUser(pg, `fresh_${relic.id}`);
  const first = fire(pg, user, relic.game, relic.eventId, relic.data, `first-${relic.id}`);
  assert.equal(first.granted, relic.id, JSON.stringify(first));
  const again = fire(pg, user, relic.game, relic.eventId, relic.data, `again-${relic.id}`);
  assert.equal(again.granted, undefined, 'a second qualifying clear grants nothing');
  assert.equal(claims(user, relic.id), 1);
  assert.equal(mints(user, relic.id, 'grant_relic'), 1);
  assert.equal(pendingRelic(user, relic.id), 0);
  assert.equal(tickets(pg, user, relic.game), 0);
  assert.equal(verse(pg, user), 0);
  const seen = profile(user);
  assert.ok(seen.relics.includes(relic.id), JSON.stringify(seen));
  assert.ok(seen.gameBeaten.includes(relic.game));
}
for (const pet of PETS) {
  const user = addUser(pg, `fresh_${pet.id}`);
  const first = fire(pg, user, pet.game, pet.eventId, pet.data, `first-${pet.id}`);
  assert.deepEqual(first.granted_items, [pet.id], JSON.stringify(first));
  fire(pg, user, pet.game, pet.eventId, pet.data, `again-${pet.id}`);
  assert.equal(owned(user, pet.id), 1);
  assert.equal(mints(user, pet.id, 'grant_item'), 1);
  assert.equal(pendingItem(user, pet.id), 0);
  assert.equal(tickets(pg, user, pet.game), 0);
  assert.ok(profile(user).pets?.owned.includes(pet.id));
}

// hub_life_medal stays held: recorded as pending, not owned.
{
  const user = addUser(pg, 'medal_waits');
  const out = fire(pg, user, 'hpos10i', 'hpos10i.boss_defeated', { boss: 'deathbot' }, 'medal');
  assert.deepEqual(out.granted_items ?? [], []);
  assert.equal(pendingItem(user, 'hub_life_medal'), 1);
  assert.equal(owned(user, 'hub_life_medal'), 0);
}

// The migration itself: put the database back to the held state, park claims the way 0033 did,
// then let the real runner apply 0060 again (delete its ledger row and boot a second module).
const HOLD_RELICS = `UPDATE game.event_rule SET grant_hold = true WHERE relic_id IN ('genesis_shard', 'tidebreaker_belt')`;
const HOLD_PETS = `UPDATE game.item_rule SET grant_hold = true WHERE item_id IN ('pet_honk_sproto', 'pet_spiral_sproto', 'pet_moon_sproto', 'pet_sproto_pup')`;
{
  pg.run(HOLD_RELICS);
  pg.run(HOLD_PETS);

  // waiting: qualified for all six while they were held (two clears each, as replays would arrive).
  const waiting = addUser(pg, 'waiting_all');
  for (const row of [...RELICS, ...PETS]) {
    for (const n of [1, 2]) {
      const held = fire(pg, waiting, row.game, row.eventId, row.data, `held-${row.id}-${n}`);
      assert.equal(held.error, undefined, JSON.stringify(held));
      assert.equal(held.granted, undefined);
      assert.deepEqual(held.granted_items ?? [], []);
    }
  }
  for (const relic of RELICS) {
    assert.equal(pendingRelic(waiting, relic.id), 1);
    assert.equal(claims(waiting, relic.id), 0);
  }
  for (const pet of PETS) {
    assert.equal(pendingItem(waiting, pet.id), 1);
    assert.equal(owned(waiting, pet.id), 0);
  }
  assert.deepEqual(profile(waiting).relics, [], 'held claims are invisible before the migration');

  // owner: already holds a live Shard (granted above while live). Its claim must not be rewritten.
  const owner = addUser(pg, 'owner_keeps');
  pg.run(`UPDATE game.event_rule SET grant_hold = false WHERE relic_id = 'genesis_shard'`);
  assert.equal(fire(pg, owner, 'peoples-bitcoin', 'pb.quest_complete', { questId: 'quest_tutorial' }, 'owner-live').granted, 'genesis_shard');
  pg.run(HOLD_RELICS);
  const ownerEvent = pg.run("SELECT event_id FROM game.relic_claim WHERE user_id = $1::uuid AND relic_id = 'genesis_shard'", [owner])[0]!.event_id;
  // A stale pending row beside a live claim (possible if a hold was re-armed): promotion must only clear it.
  pg.run(
    `INSERT INTO game.relic_claim_pending (user_id, relic_id, session_id, game_id, event_type, data)
     VALUES ($1::uuid, 'genesis_shard', gen_random_uuid(), 'peoples-bitcoin', 'pb.quest_complete', '{}'::jsonb)`,
    [owner],
  );

  // bystander: a pending Life Medal must stay pending.
  const medalPending = count(pg, "SELECT 1 FROM game.item_owned_pending WHERE item_id = 'hub_life_medal'");
  assert.equal(medalPending, 1);
  const ledgerBefore = count(pg, 'SELECT 1 FROM game.tickets_ledger') + count(pg, 'SELECT 1 FROM game.verse_ledger');

  pg.run("DELETE FROM game.schema_migrations WHERE id = '0060_relic_unhold'");
  const rebooted = pg.reload();
  assert.deepEqual(rebooted.logger.lines.filter((line) => line.level === 'error'), []);
  assert.equal(count(pg, "SELECT 1 FROM game.schema_migrations WHERE id = '0060_relic_unhold'"), 1);

  // Promoted exactly once: one live claim, one ledger mint, no pending row, game_beaten written.
  for (const relic of RELICS) {
    assert.equal(claims(waiting, relic.id), 1, relic.id);
    assert.equal(mints(waiting, relic.id, 'grant_relic'), 1, relic.id);
    assert.equal(pendingRelic(waiting, relic.id), 0, relic.id);
    assert.equal(count(pg, 'SELECT 1 FROM game.game_beaten WHERE user_id = $1::uuid AND relic_id = $2', [waiting, relic.id]), 1, relic.id);
  }
  for (const pet of PETS) {
    assert.equal(owned(waiting, pet.id), 1, pet.id);
    assert.equal(mints(waiting, pet.id, 'grant_item'), 1, pet.id);
    assert.equal(pendingItem(waiting, pet.id), 0, pet.id);
  }
  assert.equal(count(pg, `SELECT 1 FROM game.relic_claim_pending WHERE relic_id IN (${inList})`), 0);
  assert.equal(count(pg, `SELECT 1 FROM game.item_owned_pending WHERE item_id IN (${inList})`), 0);
  assert.equal(count(pg, "SELECT 1 FROM game.item_owned_pending WHERE item_id = 'hub_life_medal'"), 1, 'the Life Medal is still pending');
  assert.equal(count(pg, 'SELECT 1 FROM game.event_rule WHERE grant_hold'), 0);
  assert.deepEqual(pg.run('SELECT item_id FROM game.item_rule WHERE grant_hold').map((r) => r.item_id), ['hub_life_medal']);

  // The owner's live claim is the same row; the stale pending shadow is gone; still one mint.
  assert.equal(pg.run("SELECT event_id FROM game.relic_claim WHERE user_id = $1::uuid AND relic_id = 'genesis_shard'", [owner])[0]!.event_id, ownerEvent);
  assert.equal(claims(owner, 'genesis_shard'), 1);
  assert.equal(mints(owner, 'genesis_shard', 'grant_relic'), 1);
  assert.equal(pendingRelic(owner, 'genesis_shard'), 0);

  // No currency moved, and the plan's side effects arrive with the Relics.
  assert.equal(count(pg, 'SELECT 1 FROM game.tickets_ledger') + count(pg, 'SELECT 1 FROM game.verse_ledger'), ledgerBefore);
  assert.equal(verse(pg, waiting), 0);
  const seen = mod.call<Profile>('profile.get', hubCtx(waiting), {});
  for (const relic of RELICS) assert.ok(seen.relics.includes(relic.id), JSON.stringify(seen.relics));
  for (const pet of ['pet_president', 'pet_fighter', ...PETS.map((p) => p.id)]) {
    assert.ok(seen.pets?.owned.includes(pet), `${pet} in ${JSON.stringify(seen.pets)}`);
  }
  const items = pg.run('SELECT unnest(game.owned_item_ids($1::uuid)) AS id', [waiting]).map((r) => r.id);
  assert.ok(items.length > 0, 'Relic-derived items (Moonward Staff, Fighter\'s Might) are owned');
  const before = pg.run('SELECT unnest(game.owned_item_ids($1::uuid)) AS id', [addUser(pg, 'nobody')]).map((r) => r.id);
  assert.ok(items.filter((id) => !before.includes(id)).length >= 2, `derived items: ${items.join(',')}`);

  // A promoted account's next clear is a no-op; the claim count stays 1.
  for (const relic of RELICS) {
    const next = fire(pg, waiting, relic.game, relic.eventId, relic.data, `after-${relic.id}`);
    assert.equal(next.granted, undefined);
    assert.equal(claims(waiting, relic.id), 1);
    assert.equal(mints(waiting, relic.id, 'grant_relic'), 1);
  }

  // Applying the migration once more changes nothing (no pending rows, same counts).
  pg.run("DELETE FROM game.schema_migrations WHERE id = '0060_relic_unhold'");
  pg.reload();
  for (const relic of RELICS) assert.equal(mints(waiting, relic.id, 'grant_relic'), 1);
  for (const pet of PETS) assert.equal(mints(waiting, pet.id, 'grant_item'), 1);
  pg.audit();
}

// Promotion races: two connections promote the same pending claim; one wins, one mint.
{
  pg.run(HOLD_RELICS);
  for (let round = 0; round < 4; round += 1) {
    const user = addUser(pg, `promote_race_${round}`);
    fire(pg, user, 'sproto-fighter', 'fighter.story_level_complete', { world: 1 }, `race-${round}`);
    assert.equal(pendingRelic(user, 'tidebreaker_belt'), 1);
    const sql = "SELECT game.promote_pending_grant($1::uuid, 'relic', 'tidebreaker_belt')::text AS r";
    const results = await Promise.all([pg.runAsync(sql, [user]), pg.runAsync(sql, [user]), pg.runAsync(sql, [user])]);
    const promoted = results.map((rows) => JSON.parse(rows[0]!.r!) as { promoted?: boolean }).filter((r) => r.promoted === true);
    assert.equal(promoted.length, 1, `round ${round}`);
    assert.equal(claims(user, 'tidebreaker_belt'), 1);
    assert.equal(mints(user, 'tidebreaker_belt', 'grant_relic'), 1);
    assert.equal(pendingRelic(user, 'tidebreaker_belt'), 0);
  }
  pg.run(`UPDATE game.event_rule SET grant_hold = false WHERE relic_id IN ('genesis_shard', 'tidebreaker_belt')`);
  pg.audit();
}

// B2: Fighter story bosses. Each of the ten pays 20 once per UTC day; a rematch and an unlisted opponent pay 0.
{
  const BOSSES = ['sproto3215', 'sproto2616', 'sproto3152', 'rivet', 'sproto865', 'sproto943', 'nick', 'guest07', 'vela', 'vaudream'];
  assert.deepEqual(
    pg.run("SELECT rule_key FROM game.event_rule WHERE game_id = 'sproto-fighter' AND event_type = 'fighter.boss_defeated' AND tickets = 20 AND day_limit = 1 ORDER BY 1").map((r) => r.rule_key),
    [...BOSSES].sort(),
  );
  const user = addUser(pg, 'fighter_story');
  const sid = openGameSession(pg, user, 'sproto-fighter');
  const ctx = gameCtx(user, 'sproto-fighter', sid);
  const win = (boss: string, key: string) => mod.call<EventAnswer>('session.event', ctx, { eventId: 'fighter.boss_defeated', data: { boss, world: 1, stage: 3 }, key });
  BOSSES.forEach((boss, index) => {
    assert.equal(win(boss, `win-${boss}`).tickets, 20, boss);
    assert.equal(tickets(pg, user, 'sproto-fighter'), (index + 1) * 20);
  });
  for (const boss of BOSSES) assert.equal(win(boss, `rematch-${boss}`).tickets ?? 0, 0, `${boss} rematch`);
  assert.equal(win('sproto3215', 'win-sproto3215').tickets, 20, 'a replayed key returns the stored answer');
  assert.equal(win('zephyr', 'win-zephyr').tickets ?? 0, 0, 'the Belt opponent is not a listed boss');
  assert.equal(tickets(pg, user, 'sproto-fighter'), 200);
  assert.equal(count(pg, 'SELECT 1 FROM game.tickets_ledger WHERE user_id = $1::uuid AND delta > 0', [user]), 10);
  // fighter_win still pays nothing (0031): the game must stop sending it.
  const refused = mod.call<{ error?: string }>('tickets.earn', ctx, { amount: 20, reason: 'fighter_win', key: 'fw' });
  assert.equal(refused.error, 'amount_over_rule');
  // The next UTC day pays again: move today's per-boss windows back one day, in a new session
  // (the first one is at its 200-Ticket session cap).
  pg.run("UPDATE game.earn_window SET day = day - 1 WHERE user_id = $1::uuid AND bucket LIKE 'boss:sproto-fighter:%'", [user]);
  pg.run("UPDATE game.earn_window SET day = day - 1 WHERE user_id = $1::uuid AND bucket = 'tickets:sproto-fighter'", [user]);
  const sid2 = openGameSession(pg, user, 'sproto-fighter');
  const tomorrow = mod.call<EventAnswer>('session.event', gameCtx(user, 'sproto-fighter', sid2), { eventId: 'fighter.boss_defeated', data: { boss: 'rivet' }, key: 'day2-rivet' });
  assert.equal(tomorrow.tickets, 20);
  assert.equal(tickets(pg, user, 'sproto-fighter'), 220);
  pg.audit();
}

console.log('pg relic unhold and fighter bosses ok');
