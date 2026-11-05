/**
 * M6 item grants (migration 0030_m6_item_grants, docs/m6-server-prep.md).
 * session.event grants a pet once per player when a game.item_rule row matches. The grant runs
 * inside game.apply_event before the idempotency insert, so a replay returns the stored
 * granted_items. profile.get lists owned pets; loadout.set_hub equips one from a hub session.
 * audit.sql runs from the suite wrapper after every case (item_owned / grant_item checks included).
 */
import assert from 'node:assert/strict';
import {
  call,
  canonical,
  guest,
  login,
  num,
  openGame,
  pendingItems,
  pendingRelics,
  psql,
  sqlId,
  ticketBalance,
  verseBalance,
  type GameLogin,
  type RpcResult,
} from './harness.ts';

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

function assertHeldItem(userId: string, itemId: string, result: RpcResult): void {
  const detail = JSON.stringify(result.body);
  assert.equal(result.status, 200, detail);
  assert.equal(body(result).error, undefined, detail);
  assert.equal(body(result).granted, undefined, detail);
  assert.deepEqual(body(result).granted_items ?? [], [], detail);
  assert.deepEqual(owned(userId), []);
  assert.equal(grantRows(userId), 0);
  assert.equal(pendingItems(userId, itemId), 1);
  assert.equal(ticketBalance(userId, HPOS), 0);
  assert.equal(verseBalance(userId), 0);
  assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}' AND item_id = '${itemId}'`), 0);
}

async function honkOnce(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const key = crypto.randomUUID();
  const first = await clear(session, 'z1_retro_rush_hills', 2, key);
  assertHeldItem(user, 'pet_honk_sproto', first);

  const replay = await clear(session, 'z1_retro_rush_hills', 2, key);
  assert.equal(canonical(replay.body), canonical(first.body), 'replay of the same key changed the response');
  assert.deepEqual(body(replay).granted_items ?? [], []);
  assert.deepEqual(owned(user), []);
  assert.equal(grantRows(user), 0);
  assert.equal(pendingItems(user, 'pet_honk_sproto'), 1);

  const again = await clear(session, 'z1_retro_rush_hills', 2, crypto.randomUUID(), 11.1);
  assert.equal(body(again).error, undefined, JSON.stringify(again.body));
  assert.deepEqual(body(again).granted_items ?? [], [], JSON.stringify(again.body));
  assert.deepEqual(owned(user), []);
  assert.equal(grantRows(user), 0);
  assert.equal(pendingItems(user, 'pet_honk_sproto'), 1);

  const next = await openGame(session.hub.token, HPOS);
  const other = await clear(next, 'z1_retro_rush_hills', 2, crypto.randomUUID());
  assert.deepEqual(body(other).granted_items ?? [], [], JSON.stringify(other.body));
  assert.equal(grantRows(user), 0);
  assert.equal(pendingItems(user, 'pet_honk_sproto'), 1);
}

async function spiral(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const result = await clear(session, 'z2_wizard_academy', 2, crypto.randomUUID());
  assertHeldItem(user, 'pet_spiral_sproto', result);
  const act1 = await clear(session, 'z2_wizard_academy', 1, crypto.randomUUID());
  assert.deepEqual(body(act1).granted_items ?? [], [], JSON.stringify(act1.body));
  assert.equal(grantRows(user), 0);
  assert.equal(pendingItems(user, 'pet_spiral_sproto'), 1);
}

async function relicStillGrants(): Promise<void> {
  const session = await login(HPOS);
  const user = session.hub.userId;
  const result = await clear(session, 'z1_retro_rush_hills', 1, crypto.randomUUID());
  const detail = JSON.stringify(result.body);
  assert.equal(body(result).error, undefined, detail);
  assert.equal(body(result).granted, undefined, detail);
  assert.deepEqual(body(result).granted_items ?? [], [], detail);
  assert.deepEqual(owned(user), [], 'a held relic clear wrote item_owned');
  assert.equal(grantRows(user), 0);
  assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(user)}'`), 0);
  assert.equal(pendingRelics(user, 'hpos10i_core'), 1);
  assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}' AND item_id = 'hpos10i_core'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND game_id = 'hpos10i'`), 0);
  assert.equal(ticketBalance(user, HPOS), 0);
  assert.equal(verseBalance(user), 0);
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
    (profile.body as { pets?: ProfilePets; relics?: string[] }).pets,
    { owned: [], active: null },
    JSON.stringify(profile.body),
  );
  assert.equal(
    ((profile.body as { relics?: string[] }).relics ?? []).includes('hpos10i_core'),
    false,
    JSON.stringify(profile.body),
  );

  const fromGame = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, session.gameToken);
  assert.equal(fromGame.body.error, 'not_hub_session', JSON.stringify(fromGame.body));
  const forged = await call('loadout.set_hub', { v: 1, pet: 'pet_coom_sproto', seq: 1 }, hub.token);
  assert.equal(forged.body.ok, false, JSON.stringify(forged.body));
  assert.equal((forged.body as { reason?: string }).reason, 'not_owned');
  const heldPet = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, hub.token);
  assert.equal(heldPet.body.ok, false, JSON.stringify(heldPet.body));
  assert.equal((heldPet.body as { reason?: string }).reason, 'not_owned');

  // A live pet (not on the hold list) still grants and equips.
  const nobu = await openGame(hub.token, 'nobu');
  const mecha = await call('session.event', {
    eventId: 'nobu.boss_defeated',
    data: { boss: 'bird' },
    key: crypto.randomUUID(),
  }, nobu.gameToken);
  assert.deepEqual(body(mecha).granted_items, ['pet_mecha_sproto'], JSON.stringify(mecha.body));
  assert.deepEqual(owned(hub.userId), ['pet_mecha_sproto:event']);
  assert.equal(grantRows(hub.userId), 1);
  const set = await call('loadout.set_hub', { v: 1, pet: 'pet_mecha_sproto', seq: 1 }, hub.token);
  assert.equal(set.body.ok, true, JSON.stringify(set.body));
  const stale = await call('loadout.set_hub', { v: 1, pet: null, seq: 1 }, hub.token);
  assert.equal((stale.body as { reason?: string }).reason, 'stale_seq', JSON.stringify(stale.body));
  const after = await call('profile.get', {}, hub.token);
  assert.equal((after.body as { pets?: ProfilePets }).pets?.active, 'pet_mecha_sproto', JSON.stringify(after.body));
  assert.equal(grantRows(hub.userId), 1);

  const stranger = await guest();
  const notMine = await call('loadout.set_hub', { v: 1, pet: 'pet_honk_sproto', seq: 1 }, stranger.token);
  assert.equal((notMine.body as { reason?: string }).reason, 'not_owned', JSON.stringify(notMine.body));
}

export async function runPets(test: TestFn): Promise<void> {
  await test('pets', 'hpos10i z1 act 2 holds pet_honk_sproto once and a replay stays empty', honkOnce);
  await test('pets', 'hpos10i z2 act 2 holds pet_spiral_sproto', spiral);
  await test('pets', 'hpos10i z1 act 1 holds hpos10i_core with no items', relicStillGrants);
  await test('pets', 'wrong game, named item, or other zone grants no pet', wrongGameOrPayload);
  await test('pets', 'profile.get omits held pets and loadout.set_hub equips a live one', profileAndLoadout);
}
