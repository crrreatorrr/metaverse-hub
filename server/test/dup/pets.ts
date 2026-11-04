/**
 * M6 item grants (migration 0030_m6_item_grants, docs/m6-server-prep.md).
 * session.event grants a pet once per player when a game.item_rule row matches. The grant runs
 * inside game.apply_event before the idempotency insert, so a replay returns the stored
 * granted_items. profile.get lists owned pets; loadout.set_hub equips one from a hub session.
 * audit.sql runs from the suite wrapper after every case (item_owned / grant_item checks included).
 */
import assert from 'node:assert/strict';
import { call, canonical, guest, login, num, openGame, psql, sqlId, type GameLogin, type RpcResult } from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

interface GrantBody {
  error?: string;
  granted?: string;
  granted_items?: string[];
}

interface ProfilePets {
  owned: string[];
  active: string | null;
}

const HPOS = 'hpos10i';
const LEVEL = 'hpos10i.level_complete';

function body(result: RpcResult): GrantBody {
  return result.body as GrantBody;
}

function owned(userId: string): string[] {
  const raw = psql(
    `SELECT COALESCE(string_agg(item_id || ':' || source, ',' ORDER BY item_id), '') FROM game.item_owned WHERE user_id = '${sqlId(userId)}'`,
  );
  return raw ? raw.split(',') : [];
}

function grantRows(userId: string): number {
  return num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}' AND op = 'grant_item'`);
}

async function clear(session: GameLogin, zone: string, act: number, key: string, time = 12.3): Promise<RpcResult> {
  return call('session.event', { eventId: LEVEL, data: { zone, act, time }, key }, session.gameToken);
}

async function honkOnce(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const key = crypto.randomUUID();
  const first = await clear(session, 'z1_retro_rush_hills', 2, key);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(body(first).error, undefined, JSON.stringify(first.body));
  assert.deepEqual(body(first).granted_items, ['pet_honk_sproto'], JSON.stringify(first.body));
  assert.equal(body(first).granted, undefined, JSON.stringify(first.body));
  assert.deepEqual(owned(user), ['pet_honk_sproto:event']);
  assert.equal(grantRows(user), 1);
  assert.equal(
    num(`SELECT count(*) FROM game.item_owned o JOIN game.item_ledger l ON l.ref_id = o.ref_id AND l.item_id = o.item_id
         WHERE o.user_id = '${sqlId(user)}' AND l.op = 'grant_item' AND l.source = 'event'`),
    1,
    'item_owned.ref_id does not match its grant_item ledger row',
  );

  const replay = await clear(session, 'z1_retro_rush_hills', 2, key);
  assert.equal(canonical(replay.body), canonical(first.body), 'replay of the same key changed the response');
  assert.deepEqual(body(replay).granted_items, ['pet_honk_sproto']);
  assert.deepEqual(owned(user), ['pet_honk_sproto:event']);
  assert.equal(grantRows(user), 1);

  const again = await clear(session, 'z1_retro_rush_hills', 2, crypto.randomUUID(), 11.1);
  assert.equal(body(again).error, undefined, JSON.stringify(again.body));
  assert.deepEqual(body(again).granted_items, [], JSON.stringify(again.body));
  assert.deepEqual(owned(user), ['pet_honk_sproto:event']);
  assert.equal(grantRows(user), 1);

  // A second session for the same player cannot grant it again either.
  const next = await openGame(session.hub.token, HPOS);
  const other = await clear(next, 'z1_retro_rush_hills', 2, crypto.randomUUID());
  assert.deepEqual(body(other).granted_items, [], JSON.stringify(other.body));
  assert.equal(grantRows(user), 1);
}

async function spiral(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const result = await clear(session, 'z2_wizard_academy', 2, crypto.randomUUID());
  assert.deepEqual(body(result).granted_items, ['pet_spiral_sproto'], JSON.stringify(result.body));
  assert.deepEqual(owned(user), ['pet_spiral_sproto:event']);
  const act1 = await clear(session, 'z2_wizard_academy', 1, crypto.randomUUID());
  assert.deepEqual(body(act1).granted_items, [], JSON.stringify(act1.body));
  assert.equal(grantRows(user), 1);
}

async function relicStillGrants(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const result = await clear(session, 'z1_retro_rush_hills', 1, crypto.randomUUID());
  assert.equal(body(result).granted, 'hpos10i_core', JSON.stringify(result.body));
  assert.deepEqual(body(result).granted_items, [], JSON.stringify(result.body));
  assert.deepEqual(owned(user), [], 'a relic clear wrote item_owned');
  assert.equal(grantRows(user), 0);
  assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(user)}'`), 1);
}

async function wrongGameOrPayload(): Promise<void> {
  // The hpos10i event from a nobu session, a client-named item, and a non-matching zone grant nothing.
  const nobu = await login('nobu');
  const foreign = await clear(nobu, 'z1_retro_rush_hills', 2, crypto.randomUUID());
  assert.deepEqual(body(foreign).granted_items ?? [], [], JSON.stringify(foreign.body));
  const named = await call('session.event', {
    eventId: 'nobu.boss_defeated',
    data: { boss: 'nope', itemId: 'pet_mecha_sproto', pet: 'pet_honk_sproto' },
    key: crypto.randomUUID(),
  }, nobu.gameToken);
  assert.deepEqual(body(named).granted_items, [], JSON.stringify(named.body));
  assert.deepEqual(owned(nobu.hub.userId), []);
  const hpos = await login(HPOS);
  const wrong = await clear(hpos, 'z9_nowhere', 2, crypto.randomUUID());
  assert.deepEqual(body(wrong).granted_items, [], JSON.stringify(wrong.body));
  assert.deepEqual(owned(hpos.hub.userId), []);
}

async function profileAndLoadout(): Promise<void> {
  const session = await login(HPOS);
  const hub = session.hub;
  const empty = await call('profile.get', {}, hub.token);
  assert.deepEqual((empty.body as { pets?: ProfilePets }).pets, { owned: [], active: null }, JSON.stringify(empty.body));
  await clear(session, 'z1_retro_rush_hills', 1, crypto.randomUUID());
  await clear(session, 'z1_retro_rush_hills', 2, crypto.randomUUID());
  const profile = await call('profile.get', {}, hub.token);
  assert.deepEqual(
    (profile.body as { pets?: ProfilePets }).pets,
    { owned: ['pet_honk_sproto', 'pet_speed_sproto'], active: null },
    JSON.stringify(profile.body),
  );

  const fromGame = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, session.gameToken);
  assert.equal(fromGame.body.error, 'not_hub_session', JSON.stringify(fromGame.body));
  const forged = await call('loadout.set_hub', { v: 1, pet: 'pet_coom_sproto', seq: 1 }, hub.token);
  assert.equal(forged.body.ok, false, JSON.stringify(forged.body));
  assert.equal((forged.body as { reason?: string }).reason, 'not_owned');
  const set = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, hub.token);
  assert.equal(set.body.ok, true, JSON.stringify(set.body));
  const stale = await call('loadout.set_hub', { v: 1, pet: 'pet_speed_sproto', seq: 1 }, hub.token);
  assert.equal((stale.body as { reason?: string }).reason, 'stale_seq', JSON.stringify(stale.body));
  const derived = await call('loadout.set_hub', { v: 1, pet: 'pet_speed_sproto', seq: 2 }, hub.token);
  assert.equal(derived.body.ok, true, JSON.stringify(derived.body));
  const after = await call('profile.get', {}, hub.token);
  assert.equal((after.body as { pets?: ProfilePets }).pets?.active, 'pet_speed_sproto', JSON.stringify(after.body));
  // Equipping writes no item row.
  assert.equal(grantRows(hub.userId), 1);

  const stranger = await guest();
  const notMine = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, stranger.token);
  assert.equal((notMine.body as { reason?: string }).reason, 'not_owned', JSON.stringify(notMine.body));
}

export async function runPets(test: TestFn): Promise<void> {
  await test('pets', 'hpos10i z1 act 2 grants pet_honk_sproto once and a replay keeps granted_items', honkOnce);
  await test('pets', 'hpos10i z2 act 2 grants pet_spiral_sproto', spiral);
  await test('pets', 'hpos10i z1 act 1 still grants hpos10i_core with no items', relicStillGrants);
  await test('pets', 'wrong game, named item, or other zone grants no pet', wrongGameOrPayload);
  await test('pets', 'profile.get lists pets and loadout.set_hub equips an owned one', profileAndLoadout);
}
