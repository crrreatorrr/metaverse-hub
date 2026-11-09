/**
 * Interim hold (0033). The migration does not create `game.grant_pending`.
 * A row in `game.relic_claim_pending` or `game.item_owned_pending` is status
 * held (PK user + id, no status column). Promote deletes that row and writes
 * one live claim. init() is `profile.get`, which reads live tables only.
 *
 * Held: tidebreaker_belt, genesis_shard, pet_honk_sproto,
 * pet_spiral_sproto, pet_moon_sproto, pet_sproto_pup.
 * Live: cones_tip, tinubu_crown, pet_presidential_sproto, pet_mecha_sproto,
 * pet_conehead_sproto, breakwater_coin, hpos10i_core (live again since 0042).
 */
import assert from 'node:assert/strict';
import {
  call,
  login,
  mints,
  num,
  outboxSend,
  pendingItems,
  pendingRelics,
  psql,
  psqlAsync,
  relicClaims,
  sqlId,
  ticketBalance,
  verseBalance,
  type RpcBody,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const HELD_IDS = [
  'tidebreaker_belt',
  'genesis_shard',
  'pet_honk_sproto',
  'pet_spiral_sproto',
  'pet_moon_sproto',
  'pet_sproto_pup',
  'hub_life_medal',
] as const;

const SLUG = /^[a-z0-9_]+$/;
const GAME = /^[a-z0-9-]+$/;
const EVENT = /^[a-z0-9_.]+$/;

interface HeldPair {
  kind: 'relic' | 'item';
  game: string;
  eventId: string;
  id: string;
  data: Record<string, unknown>;
}

interface LivePair {
  game: string;
  eventId: string;
  data: Record<string, unknown>;
  kind: 'relic' | 'item';
  id: string;
}

const LIVE: LivePair[] = [
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'cone' }, kind: 'relic', id: 'cones_tip' },
  { game: 'sproto', eventId: 'sproto.boss_defeated', data: { boss: 'tinubu', elapsed: 12 }, kind: 'relic', id: 'tinubu_crown' },
  { game: 'sproto', eventId: 'sproto.boss_defeated', data: { boss: 'obama' }, kind: 'item', id: 'pet_presidential_sproto' },
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'bird' }, kind: 'item', id: 'pet_mecha_sproto' },
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'cat' }, kind: 'item', id: 'pet_conehead_sproto' },
  { game: 'sproto-arcade', eventId: 'arcade.boss_defeated', data: { boss: 'bront' }, kind: 'relic', id: 'breakwater_coin' },
  { game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z1_retro_rush_hills', act: 1, time: 12 }, kind: 'relic', id: 'hpos10i_core' },
];

interface PromoteBody {
  ok?: boolean;
  promoted?: boolean;
  reason?: string;
  kind?: string;
  id?: string;
}

function beltBody(key: string, data: Record<string, unknown> = { world: 1, stage: 'yacht' }): object {
  return { eventId: 'fighter.story_level_complete', data, key };
}

function assertNoop(body: RpcBody, detail = JSON.stringify(body)): void {
  assert.equal(body.error, undefined, detail);
  assert.equal(body.granted, undefined, detail);
  assert.deepEqual((body as { granted_items?: unknown }).granted_items ?? [], [], detail);
  assert.equal((body as { tickets?: unknown }).tickets, undefined, detail);
  assert.equal('pending' in body, false, detail);
  assert.equal('held' in body, false, detail);
}

function assertBeltHeld(userId: string, body: RpcBody): void {
  assertNoop(body);
  assert.equal(relicClaims(userId, 'tidebreaker_belt'), 0);
  assert.equal(mints(userId, 'tidebreaker_belt'), 0);
  assert.equal(pendingRelics(userId, 'tidebreaker_belt'), 1);
  assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-fighter'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(userId)}'`), 0);
  assert.equal(ticketBalance(userId, 'sproto-fighter'), 0);
  assert.equal(verseBalance(userId), 0);
  assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`), 0);
}

function heldPairs(): HeldPair[] {
  const raw = psql(`
    SELECT kind, game_id, event_type, id, match::text
    FROM (
      SELECT 'relic' AS kind, game_id, event_type, relic_id AS id, match
      FROM game.event_rule WHERE grant_hold AND relic_id IS NOT NULL
      UNION ALL
      SELECT 'item', game_id, event_type, item_id, match
      FROM game.item_rule WHERE grant_hold
    ) s
    ORDER BY (id = 'tidebreaker_belt') DESC, id
  `);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [kind, game, eventId, id, ...rest] = line.split('|');
    if (kind !== 'relic' && kind !== 'item') throw new Error(`bad hold kind ${line}`);
    if (!GAME.test(game ?? '') || !EVENT.test(eventId ?? '') || !SLUG.test(id ?? '')) {
      throw new Error(`bad hold row ${line}`);
    }
    return {
      kind,
      game,
      eventId,
      id,
      data: JSON.parse(rest.join('|')) as Record<string, unknown>,
    };
  });
}

async function promote(userId: string, kind: 'relic' | 'item', id: string): Promise<PromoteBody> {
  if (!SLUG.test(id)) throw new Error(`bad id ${id}`);
  const raw = await psqlAsync(
    `SELECT game.promote_pending_grant('${sqlId(userId)}', '${kind}', '${id}')::text`,
  );
  return JSON.parse(raw) as PromoteBody;
}

function seedLiveBelt(userId: string, sessionId: string): string {
  const eventId = psql('SELECT gen_random_uuid()');
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error(`bad event id ${eventId}`);
  psql(`
    INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
    VALUES ('${sqlId(userId)}', 'tidebreaker_belt', '${sqlId(sessionId)}', '${eventId}');
    INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
    VALUES ('${eventId}', '${sqlId(userId)}', 'grant_relic', 'tidebreaker_belt', 'sproto-fighter', '${sqlId(sessionId)}');
    INSERT INTO game.game_beaten (user_id, game_id, relic_id)
    VALUES ('${sqlId(userId)}', 'sproto-fighter', 'tidebreaker_belt')
  `);
  return eventId;
}

export async function runHold(test: TestFn): Promise<void> {
  await test('hold', 'new tidebreaker_belt is held with 0 T and 0 V', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const result = await call('session.event', beltBody('belt-new'), session.gameToken);
    assertBeltHeld(user, result.body);
    const profile = await call('profile.get', {}, session.hub.token);
    const relics = (profile.body as { relics?: string[] }).relics ?? [];
    const beaten = (profile.body as { gameBeaten?: string[] }).gameBeaten ?? [];
    assert.equal(relics.includes('tidebreaker_belt'), false, JSON.stringify(profile.body));
    assert.equal(beaten.includes('sproto-fighter'), false, JSON.stringify(profile.body));
    assert.equal('pending' in profile.body, false, JSON.stringify(profile.body));
    assert.equal('held' in profile.body, false, JSON.stringify(profile.body));
  });

  await test('hold', 'a live tidebreaker_belt is not revoked or shadowed', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const eventId = seedLiveBelt(user, session.sessionId);
    const result = await call('session.event', beltBody('belt-live'), session.gameToken);
    assertNoop(result.body);
    assert.equal(relicClaims(user, 'tidebreaker_belt'), 1);
    assert.equal(mints(user, 'tidebreaker_belt'), 1);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 0);
    assert.equal(
      psql(`SELECT event_id::text FROM game.relic_claim WHERE user_id = '${sqlId(user)}' AND relic_id = 'tidebreaker_belt'`),
      eventId,
    );
    assert.equal(ticketBalance(user, 'sproto-fighter'), 0);
    assert.equal(verseBalance(user), 0);
    const profile = await call('profile.get', {}, session.hub.token);
    assert.equal(((profile.body as { relics?: string[] }).relics ?? []).includes('tidebreaker_belt'), true);
  });

  await test('hold', 'NULL belt tickets stay +0 T and do not revoke a live claim', async () => {
    const fresh = await login('sproto-fighter');
    const held = await call('session.event', beltBody('belt-null'), fresh.gameToken);
    assertBeltHeld(fresh.hub.userId, held.body);
    const owned = await login('sproto-fighter');
    seedLiveBelt(owned.hub.userId, owned.sessionId);
    const again = await call('session.event', beltBody('belt-null-live'), owned.gameToken);
    assertNoop(again.body);
    assert.equal(ticketBalance(owned.hub.userId, 'sproto-fighter'), 0);
    assert.equal(relicClaims(owned.hub.userId, 'tidebreaker_belt'), 1);
    assert.equal(pendingRelics(owned.hub.userId, 'tidebreaker_belt'), 0);
  });

  await test('hold', 'profile.get omits a held belt and pays nothing', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    await call('session.event', beltBody('belt-init'), session.gameToken);
    const profile = await call('profile.get', {}, session.hub.token);
    assert.equal(((profile.body as { relics?: string[] }).relics ?? []).includes('tidebreaker_belt'), false);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 1);
    assert.equal(relicClaims(user, 'tidebreaker_belt'), 0);
    assert.equal(ticketBalance(user, 'sproto-fighter'), 0);
    assert.equal(verseBalance(user), 0);
    const reread = await call('profile.get', {}, session.hub.token);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 1);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(((reread.body as { relics?: string[] }).relics ?? []).join(','), ((profile.body as { relics?: string[] }).relics ?? []).join(','));
  });

  await test('hold', 'replaying a held belt keeps one pending row', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const first = await call('session.event', beltBody('belt-replay'), session.gameToken);
    const replay = await call('session.event', beltBody('belt-replay'), session.gameToken);
    const again = await call('session.event', beltBody('belt-replay-2'), session.gameToken);
    assertBeltHeld(user, first.body);
    assertNoop(replay.body);
    assertNoop(again.body);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 1);
    assert.equal(mints(user, 'tidebreaker_belt'), 0);
  });

  await test('hold', 'two tabs hold one tidebreaker_belt row', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const [a, b] = await Promise.all([
      call('session.event', beltBody('belt-tab-a'), session.gameToken),
      call('session.event', beltBody('belt-tab-b'), session.gameToken),
    ]);
    assertNoop(a.body);
    assertNoop(b.body);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 1);
    assert.equal(relicClaims(user, 'tidebreaker_belt'), 0);
    assert.equal(mints(user, 'tidebreaker_belt'), 0);
    assert.equal(ticketBalance(user, 'sproto-fighter'), 0);
    assert.equal(verseBalance(user), 0);
  });

  await test('hold', 'a retried held belt pays 0 T and 0 V', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const result = await outboxSend('session.event', beltBody('belt-retry'), session.gameToken, { loseFirst: true });
    assertBeltHeld(user, result.body);
    const retry = await call('session.event', beltBody('belt-retry'), session.gameToken);
    assertNoop(retry.body);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 1);
  });

  await test('hold', 'promote_pending_grant moves a belt once', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    await call('session.event', beltBody('belt-promote'), session.gameToken);
    const first = await promote(user, 'relic', 'tidebreaker_belt');
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.promoted, true, JSON.stringify(first));
    assert.equal(relicClaims(user, 'tidebreaker_belt'), 1);
    assert.equal(mints(user, 'tidebreaker_belt'), 1);
    assert.equal(pendingRelics(user, 'tidebreaker_belt'), 0);
    assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = 'tidebreaker_belt'`), 1);
    assert.equal(ticketBalance(user, 'sproto-fighter'), 0);
    assert.equal(verseBalance(user), 0);
    const second = await promote(user, 'relic', 'tidebreaker_belt');
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.promoted, false, JSON.stringify(second));
    assert.equal(second.reason, 'already_live', JSON.stringify(second));
    assert.equal(relicClaims(user, 'tidebreaker_belt'), 1);
    assert.equal(mints(user, 'tidebreaker_belt'), 1);

    const other = await login('sproto-fighter');
    await call('session.event', beltBody('belt-race'), other.gameToken);
    const [left, right] = await Promise.all([
      promote(other.hub.userId, 'relic', 'tidebreaker_belt'),
      promote(other.hub.userId, 'relic', 'tidebreaker_belt'),
    ]);
    const wins = [left, right].filter((row) => row.promoted === true);
    assert.equal(wins.length, 1, JSON.stringify([left, right]));
    assert.equal(relicClaims(other.hub.userId, 'tidebreaker_belt'), 1);
    assert.equal(mints(other.hub.userId, 'tidebreaker_belt'), 1);
    assert.equal(pendingRelics(other.hub.userId, 'tidebreaker_belt'), 0);

    const honk = await login('hpos10i');
    const granted = await call('session.event', {
      eventId: 'hpos10i.level_complete',
      data: { zone: 'z1_retro_rush_hills', act: 2, time: 12 },
      key: 'honk-promote',
    }, honk.gameToken);
    assertNoop(granted.body);
    assert.equal(pendingItems(honk.hub.userId, 'pet_honk_sproto'), 1);
    const moved = await promote(honk.hub.userId, 'item', 'pet_honk_sproto');
    assert.equal(moved.promoted, true, JSON.stringify(moved));
    assert.equal(pendingItems(honk.hub.userId, 'pet_honk_sproto'), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto' AND op = 'grant_item'`), 1);
    const movedAgain = await promote(honk.hub.userId, 'item', 'pet_honk_sproto');
    assert.equal(movedAgain.promoted, false, JSON.stringify(movedAgain));
    assert.equal(movedAgain.reason, 'already_live');
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto' AND op = 'grant_item'`), 1);
  });

  await test('hold', 'each grant_hold pair is pending and the live list is not', async () => {
    const pairs = heldPairs();
    const ids = pairs.map((pair) => pair.id).sort();
    assert.deepEqual(ids, [...HELD_IDS].sort(), `SQL hold list ${ids.join(',')}`);
    assert.equal(pairs[0]?.id, 'tidebreaker_belt');
    for (const pair of pairs) {
      const session = await login(pair.game);
      const user = session.hub.userId;
      const result = await call('session.event', {
        eventId: pair.eventId,
        data: pair.data,
        key: `hold-${pair.id}`,
      }, session.gameToken);
      assertNoop(result.body, `${pair.id} ${JSON.stringify(result.body)}`);
      assert.equal(ticketBalance(user, pair.game), 0, pair.id);
      assert.equal(verseBalance(user), 0, pair.id);
      assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 0, pair.id);
      if (pair.kind === 'relic') {
        assert.equal(pendingRelics(user, pair.id), 1, pair.id);
        assert.equal(relicClaims(user, pair.id), 0, pair.id);
        assert.equal(mints(user, pair.id), 0, pair.id);
        assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = '${pair.id}'`), 0, pair.id);
      } else {
        assert.equal(pendingItems(user, pair.id), 1, pair.id);
        assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 0, pair.id);
      }
    }
  });

  await test('hold', 'Cone, Tinubu, presidential, mecha, conehead, Breakwater, and HPOS10I Core are live', async () => {
    for (const pair of LIVE) {
      const session = await login(pair.game);
      const user = session.hub.userId;
      const beforeTickets = ticketBalance(user, pair.game);
      const result = await call('session.event', {
        eventId: pair.eventId,
        data: pair.data,
        key: `live-${pair.id}`,
      }, session.gameToken);
      const detail = `${pair.id} ${JSON.stringify(result.body)}`;
      assert.equal(result.body.error, undefined, detail);
      assert.equal(pendingRelics(user, pair.kind === 'relic' ? pair.id : 'cones_tip'), 0, detail);
      assert.equal(pendingItems(user, pair.kind === 'item' ? pair.id : 'pet_mecha_sproto'), 0, detail);
      if (pair.kind === 'relic') {
        assert.equal(result.body.granted, pair.id, detail);
        assert.equal(relicClaims(user, pair.id), 1, detail);
        assert.equal(mints(user, pair.id), 1, detail);
        assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = '${pair.id}'`), 1, detail);
      } else {
        assert.deepEqual((result.body as { granted_items?: string[] }).granted_items, [pair.id], detail);
        assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 1, detail);
        assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}' AND op = 'grant_item'`), 1, detail);
      }
      const bossTickets = pair.game === 'sproto' ? 20 : 0;
      assert.equal((result.body as { tickets?: number }).tickets ?? 0, bossTickets, detail);
      assert.equal(ticketBalance(user, pair.game), beforeTickets + bossTickets, detail);
      assert.equal(verseBalance(user), 0, detail);
    }
  });

  await test('hold', 'a forged event outside the hold list mints nothing and writes no pending row', async () => {
    const session = await login('sproto');
    const user = session.hub.userId;
    const tickets = ticketBalance(user, 'sproto');
    const verse = verseBalance(user);
    const result = await call('session.event', {
      eventId: 'sproto.not_a_real_event',
      data: { boss: 'tinubu', relicId: 'tidebreaker_belt', itemId: 'pet_honk_sproto' },
      key: 'forged-outside',
    }, session.gameToken);
    assert.equal(result.body.granted, undefined, JSON.stringify(result.body));
    assert.equal((result.body as { granted_items?: string[] }).granted_items?.length ?? 0, 0, JSON.stringify(result.body));
    assert.equal(num(`SELECT count(*) FROM game.relic_claim_pending WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned_pending WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(ticketBalance(user, 'sproto'), tickets);
    assert.equal(verseBalance(user), verse);
  });
}
